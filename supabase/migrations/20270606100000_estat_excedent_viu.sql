-- Fase 2 del plan de los puntos 4-6 (cambio B1): el estado VIVO de una oferta.
--
-- Hasta aquí el estado publicada/parcial/bloqueada lo calculaba cada función a su manera, y
-- dos de ellas sumaban también las canalizaciones ANULADAS:
--
--   · `aprovar_resposta()` (20270412100000) sumaba `kg_confirmados` de todas las
--     canalizaciones de la oferta → una anulada seguía «cubriendo» kilos y la oferta podía
--     quedar `bloqueada` sin nada vivo;
--   · `editar_oferta()` (20270530100000/20270605100000) igual, en los kg cubiertos, en la
--     comprobación de modalidades y en su propio recálculo;
--   · `canalitzacions_actives()` sumaba las anuladas en `kg_canalitzats` y en `tot_conciliat`.
--
-- Y ninguna devolvía la oferta a `parcial`/`publicada` cuando una canalización se anulaba.
--
-- Esta migración:
--
--   1. Crea `recalcula_estat_excedent(p_excedente)`, INTERNA (sin EXECUTE para ninguna sesión):
--      la única fuente del estado publicada/parcial/bloqueada/cerrada. Usa `desti_excedent()`,
--      que ya excluye las anuladas, y la misma regla de cierre que `registrar_desti_final()`.
--   2. `aprovar_resposta()` (misma firma) delega el estado en ella.
--   3. `editar_oferta()` (misma firma; copia de la vigente de 20270605100000) filtra las
--      anuladas y delega el estado en ella.
--   4. `canalitzacions_actives()` (mismo `returns table`): sin anuladas en las sumas, el REC
--      vivo MENOS avanzado y sin las ofertas `cerrada` (el frontend ya las filtraba).
--
-- Compatible hacia atrás: ninguna firma cambia.

-- ---------------------------------------------------------------------------
-- 1. `recalcula_estat_excedent()`: interna
-- ---------------------------------------------------------------------------
create or replace function public.recalcula_estat_excedent(p_excedente uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex        excedentes;
  d         record;
  v_obertes int;
  v_estat   text;
begin
  select * into ex from excedentes where id = p_excedente for update;
  if ex.id is null then
    return null;
  end if;
  -- Solo los estados del ciclo vivo. Un borrador, una oferta por validar, cerrada, cancelada o
  -- no colocada no se tocan: su estado lo deciden otras puertas.
  if ex.estado not in ('publicada', 'parcial', 'bloqueada') then
    return ex.estado;
  end if;

  select * into d from public.desti_excedent(ex.id);       -- sin las anuladas
  select count(*) into v_obertes from canalizaciones c
   where c.excedente_id = ex.id and c.estado in ('confirmada', 'entregada');

  v_estat := case
    -- Todo con destino y nada en curso: cerrada (la regla de `registrar_desti_final()` y de
    -- `trg_excedentes_tanca_si_complet()`).
    when d.kg_total > 0 and d.kg_sense_desti = 0 and v_obertes = 0 then 'cerrada'
    -- Todo con destino pero falta alguna recogida: bloqueada.
    when d.kg_total > 0 and d.kg_sense_desti = 0 then 'bloqueada'
    -- Algo canalizado o con destino externo: parcial.
    when d.kg_redestina + d.kg_externs > 0 then 'parcial'
    else 'publicada'
  end;

  if v_estat is distinct from ex.estado then
    update excedentes
       set estado = v_estat,
           tancada_at = case when v_estat = 'cerrada' then now() else tancada_at end
     where id = ex.id;
  end if;
  return v_estat;
end;
$$;
revoke execute on function public.recalcula_estat_excedent(uuid) from public, anon, authenticated;
grant  execute on function public.recalcula_estat_excedent(uuid) to service_role;

comment on function public.recalcula_estat_excedent(uuid) is
  'Interna (20270606100000): única fuente del estado publicada/parcial/bloqueada/cerrada de una oferta, contando solo canalizaciones vivas (no anuladas) y destinos externos.';

-- ---------------------------------------------------------------------------
-- 2. `aprovar_resposta()`: misma firma; el estado, por `recalcula_estat_excedent()`
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270412100000). Solo cambia el final: la suma (que contaba las
-- anuladas) y el `update` del estado se sustituyen por la función de arriba. La guarda se
-- queda como estaba, `pot_aprovar()` sin salida para `service_role`: aprobar es un acto con
-- autor (scripts/escenari-demo.ts lo documenta).
create or replace function public.aprovar_resposta(
  p_resposta  uuid,
  p_kg        numeric     default null,
  p_preu      numeric     default null,
  p_motiu     text        default null,
  p_modalitat text        default null,
  p_recollida timestamptz default null
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        oferta_respuestas;
  ex       excedentes;
  c        canalizaciones;
  kg       numeric;
  v_mods   text[];
  v_val    text;
  v_aviso  text;
  v_quan   timestamptz;
begin
  if not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden aprovar' using errcode = '42501';
  end if;

  select * into r from oferta_respuestas where id = p_resposta for update;
  if r.id is null or r.estado <> 'acceptada' or r.aprovacio <> 'pendent' then
    raise exception 'Aquesta resposta no es pot aprovar' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = r.excedente_id for update;
  kg := coalesce(p_kg, r.kg_solicitados);
  if kg is null or kg <= 0 then
    raise exception 'Cal indicar els kg a canalitzar' using errcode = '22023';
  end if;

  v_mods := coalesce(ex.modalitats, array[coalesce(ex.modalitat, 'donacio')]);
  v_val := coalesce(p_modalitat, r.modalitat,
                    case when cardinality(v_mods) = 1 then v_mods[1] end);
  if v_val is null then
    raise exception 'cal_modalitat: tria la modalitat d''aquesta entrega' using errcode = '22023';
  end if;
  if not (v_val = any(v_mods)) then
    raise exception 'Aquesta oferta no s''ofereix en modalitat %', v_val using errcode = '22023';
  end if;

  -- La hora: la del equipo manda y se comprueba; la de la entidad ya se comprobó al pedirla.
  if p_recollida is not null and p_recollida < now() - interval '1 hour' then
    raise exception 'hora_passada: la recollida no pot ser en el passat' using errcode = '22023';
  end if;
  v_quan := coalesce(p_recollida, r.recollida_at);

  v_aviso := public.exigir_convenio('productor', ex.productor_id, v_val, 'entrega');
  if v_aviso is not null then raise notice '%', v_aviso; end if;
  v_aviso := public.exigir_convenio('entidad', r.entidad_id, v_val, 'recibe');
  if v_aviso is not null then raise notice '%', v_aviso; end if;

  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, estado, valorizacion, data_hora_recollida)
  values (r.excedente_id, r.entidad_id, kg, 'confirmada', v_val, v_quan)
  returning * into c;

  update oferta_respuestas
     set aprovacio       = 'aprovada',
         aprovat_at      = now(),
         motiu_aprovacio = p_motiu,
         canalizacion_id = c.id,
         kg_aprovats     = kg,
         modalitat       = v_val,
         recollida_at    = v_quan,
         preu_ofert      = case when v_val = 'donacio' then null
                                else coalesce(p_preu, r.preu_ofert) end
   where id = r.id;

  -- 20270606100000: el estado, contando solo lo vivo.
  perform public.recalcula_estat_excedent(ex.id);

  return c;
end;
$$;
revoke execute on function public.aprovar_resposta(uuid, numeric, numeric, text, text, timestamptz) from public, anon;
grant  execute on function public.aprovar_resposta(uuid, numeric, numeric, text, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. `editar_oferta()`: la vigente (20270605100000) sin las anuladas y con el estado delegado
-- ---------------------------------------------------------------------------
create or replace function public.editar_oferta(p_id uuid, p_canvis jsonb, p_texto text, p_actor uuid)
returns excedentes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex        excedentes;
  nou       excedentes;
  v_intern  boolean;
  v_prod    boolean;
  cubierto  numeric;
  v_mods    text[];
  v_sub     text;
  v_ubi     uuid;
  v_format  text;
  v_retorn  text;
  v_detall  text;
  v_quant   integer;
  v_dies    smallint[];
  v_maps    text;
  v_hect    numeric;
  v_fotos   text[];
  v_f       text;
  revalidar boolean := false;
  clau      text;
  permeses  text[] := array['kg_total', 'modalitats', 'preu_minim', 'coste_kg', 'disponible_hasta',
                            'hora_recollida_inici', 'hora_recollida_fi', 'horari_recollida',
                            'observacions', 'variedad', 'num_caixes', 'subcausa_codigo',
                            -- 20270530100000 (punto 3, fase C):
                            'ubicacion_id', 'gmaps_url', 'format_entrega', 'retorn_envasos',
                            'retorn_envasos_detall', 'retorn_envasos_quantitat', 'producte_al_camp',
                            'dies_recollida', 'fotos', 'foto_producte',
                            -- 20270605100000 (fase 0 de los puntos 4-6):
                            'hectarees'];
begin
  if p_actor is null then
    raise exception 'Cal actor' using errcode = '42501';
  end if;
  select * into ex from excedentes where id = p_id for update;
  if ex.id is null then
    raise exception 'Oferta inexistent' using errcode = '22023';
  end if;

  v_intern := exists (select 1 from usuario_roles ur where ur.user_id = p_actor);
  v_prod := exists (select 1 from membresias m
                     where m.user_id = p_actor and m.activo and m.productor_id = ex.productor_id);
  if not v_intern and not v_prod then
    raise exception 'No pots editar aquesta oferta' using errcode = '42501';
  end if;
  -- Un esborrany NO se edita por aquí: se guarda por `crear-oferta/esborrany` y se publica.
  if ex.estado not in ('pendent_validacio', 'publicada', 'parcial', 'bloqueada') then
    raise exception 'oferta_no_editable: una oferta % no es pot editar', ex.estado using errcode = '22023';
  end if;

  for clau in select jsonb_object_keys(p_canvis) loop
    if not (clau = any(permeses)) then
      raise exception 'camp_no_editable: %', clau using errcode = '22023';
    end if;
  end loop;

  -- 20270606100000: una canalización anulada ya no cubre nada.
  select coalesce(sum(kg_confirmados), 0) into cubierto from canalizaciones
   where excedente_id = ex.id and estado <> 'anulada';
  if p_canvis ? 'kg_total' then
    if (p_canvis->>'kg_total')::numeric is null or (p_canvis->>'kg_total')::numeric <= 0 then
      raise exception 'kg_invalids' using errcode = '22023';
    end if;
    if (p_canvis->>'kg_total')::numeric < cubierto then
      raise exception 'kg_menys_canalitzats: ja n''hi ha % kg canalitzats', cubierto using errcode = '22023';
    end if;
  end if;
  if p_canvis ? 'modalitats' then
    select array_agg(m order by array_position(array['donacio','venda','maquila'], m))
      into v_mods
      from (select distinct jsonb_array_elements_text(p_canvis->'modalitats') m) s;
    if v_mods is null or cardinality(v_mods) = 0 then
      raise exception 'modalitats_buides' using errcode = '22023';
    end if;
    -- Una entrega ya aprobada en una modalidad no puede quedar fuera de la oferta.
    -- (20270606100000: las anuladas no cuentan.)
    if exists (select 1 from canalizaciones c where c.excedente_id = ex.id and c.estado <> 'anulada'
                and c.valorizacion is not null and not (c.valorizacion = any(v_mods))) then
      raise exception 'modalitat_amb_canalitzacions' using errcode = '22023';
    end if;
  end if;
  -- La subcausa (fase B del punto 3): una del catálogo y activa; no se vacía.
  if p_canvis ? 'subcausa_codigo' then
    v_sub := nullif(btrim(p_canvis->>'subcausa_codigo'), '');
    if v_sub is null or not exists (select 1 from subcausas s where s.codigo = v_sub and s.activa) then
      raise exception 'subcausa_invalida: %', coalesce(v_sub, '(buida)') using errcode = '22023';
    end if;
  end if;

  -- El lugar: de ESTE productor (la función corre como definer: la RLS no lo mira por ella).
  if p_canvis ? 'ubicacion_id' then
    v_ubi := nullif(p_canvis->>'ubicacion_id', '')::uuid;
    if v_ubi is null or not exists (select 1 from productor_ubicaciones u
                                     where u.id = v_ubi and u.productor_id = ex.productor_id) then
      raise exception 'ubicacio_aliena' using errcode = '22023';
    end if;
  end if;
  if p_canvis ? 'gmaps_url' then
    v_maps := nullif(btrim(coalesce(p_canvis->>'gmaps_url', '')), '');
    if v_maps is not null and (v_maps !~* '^https?://\S+$' or char_length(v_maps) > 500) then
      raise exception 'maps_invalid' using errcode = '22023';
    end if;
  end if;
  if p_canvis ? 'format_entrega' then
    v_format := nullif(p_canvis->>'format_entrega', '');
    if v_format is not null and v_format not in ('caixes', 'palet', 'envasos_propis', 'altres') then
      raise exception 'format_invalid' using errcode = '22023';
    end if;
  end if;
  -- El retorno y su detalle: sin «Sí», el detalle y la cantidad se vacían (como en el alta).
  v_retorn := case when p_canvis ? 'retorn_envasos' then nullif(p_canvis->>'retorn_envasos', '')
                   else ex.retorn_envasos end;
  if v_retorn is not null and v_retorn not in ('Sí', 'No') then
    raise exception 'retorn_invalid' using errcode = '22023';
  end if;
  v_detall := case when p_canvis ? 'retorn_envasos_detall'
                   then left(nullif(btrim(coalesce(p_canvis->>'retorn_envasos_detall', '')), ''), 400)
                   else ex.retorn_envasos_detall end;
  if p_canvis ? 'retorn_envasos_quantitat' then
    if nullif(p_canvis->>'retorn_envasos_quantitat', '') is null then
      v_quant := null;
    elsif (p_canvis->>'retorn_envasos_quantitat') !~ '^[0-9]+$'
          or (p_canvis->>'retorn_envasos_quantitat')::integer <= 0 then
      raise exception 'retorn_quantitat_invalid' using errcode = '22023';
    else
      v_quant := (p_canvis->>'retorn_envasos_quantitat')::integer;
    end if;
  else
    v_quant := ex.retorn_envasos_quantitat;
  end if;
  if v_retorn is distinct from 'Sí' then
    v_detall := null;
    v_quant := null;
  end if;
  if p_canvis ? 'dies_recollida' then
    if jsonb_typeof(p_canvis->'dies_recollida') = 'array' then
      select array_agg(distinct d::smallint order by d::smallint) into v_dies
        from jsonb_array_elements_text(p_canvis->'dies_recollida') d;
      if exists (select 1 from unnest(coalesce(v_dies, '{}')) d where d not between 1 and 7) then
        raise exception 'dies_invalids' using errcode = '22023';
      end if;
    end if;
  end if;
  -- Hectáreas (opcional, > 0): solo tienen sentido con el producto en el campo, pero no se
  -- vacían al cambiar esa respuesta: el panel deja de enseñarlas y el texto no las imprime.
  if p_canvis ? 'hectarees' then
    if nullif(btrim(coalesce(p_canvis->>'hectarees', '')), '') is null then
      v_hect := null;
    elsif (p_canvis->>'hectarees') !~ '^[0-9]+([.][0-9]+)?$'
          or (p_canvis->>'hectarees')::numeric <= 0 then
      raise exception 'hectarees_invalid' using errcode = '22023';
    else
      v_hect := round((p_canvis->>'hectarees')::numeric, 2);
    end if;
  end if;
  if p_canvis ? 'fotos' then
    select coalesce(array_agg(f), '{}') into v_fotos
      from jsonb_array_elements_text(coalesce(p_canvis->'fotos', '[]'::jsonb)) f;
    if cardinality(v_fotos) > 3 then
      raise exception 'massa_fotos' using errcode = '22023';
    end if;
    foreach v_f in array v_fotos loop
      if split_part(v_f, '/', 1) <> ex.productor_id::text then
        raise exception 'foto_aliena' using errcode = '22023';
      end if;
    end loop;
  end if;

  update excedentes e set
    kg_total             = case when p_canvis ? 'kg_total' then (p_canvis->>'kg_total')::numeric else e.kg_total end,
    modalitats           = case when p_canvis ? 'modalitats' then v_mods else e.modalitats end,
    modalitat            = case when p_canvis ? 'modalitats' then v_mods[1] else e.modalitat end,
    preu_minim           = case when p_canvis ? 'preu_minim' then nullif(p_canvis->>'preu_minim', '')::numeric else e.preu_minim end,
    coste_kg             = case when p_canvis ? 'coste_kg' then nullif(p_canvis->>'coste_kg', '')::numeric else e.coste_kg end,
    disponible_hasta     = case when p_canvis ? 'disponible_hasta' then nullif(p_canvis->>'disponible_hasta', '')::date else e.disponible_hasta end,
    hora_recollida_inici = case when p_canvis ? 'hora_recollida_inici' then nullif(p_canvis->>'hora_recollida_inici', '')::time else e.hora_recollida_inici end,
    hora_recollida_fi    = case when p_canvis ? 'hora_recollida_fi' then nullif(p_canvis->>'hora_recollida_fi', '')::time else e.hora_recollida_fi end,
    horari_recollida     = case when p_canvis ? 'horari_recollida' then nullif(p_canvis->>'horari_recollida', '') else e.horari_recollida end,
    observacions         = case when p_canvis ? 'observacions' then nullif(p_canvis->>'observacions', '') else e.observacions end,
    variedad             = case when p_canvis ? 'variedad' then nullif(p_canvis->>'variedad', '') else e.variedad end,
    num_caixes           = case when p_canvis ? 'num_caixes' then nullif(p_canvis->>'num_caixes', '')::integer else e.num_caixes end,
    subcausa_codigo      = case when p_canvis ? 'subcausa_codigo' then v_sub else e.subcausa_codigo end,
    ubicacion_id         = case when p_canvis ? 'ubicacion_id' then v_ubi else e.ubicacion_id end,
    gmaps_url            = case when p_canvis ? 'gmaps_url' then v_maps else e.gmaps_url end,
    format_entrega       = case when p_canvis ? 'format_entrega' then v_format else e.format_entrega end,
    retorn_envasos       = v_retorn,
    retorn_envasos_detall    = v_detall,
    retorn_envasos_quantitat = v_quant,
    producte_al_camp     = case when p_canvis ? 'producte_al_camp' then coalesce((p_canvis->>'producte_al_camp')::boolean, false) else e.producte_al_camp end,
    dies_recollida       = case when p_canvis ? 'dies_recollida' then v_dies else e.dies_recollida end,
    fotos                = case when p_canvis ? 'fotos' then v_fotos else e.fotos end,
    foto_producte        = case when p_canvis ? 'foto_producte' then coalesce((p_canvis->>'foto_producte')::boolean, true) else e.foto_producte end,
    hectarees            = case when p_canvis ? 'hectarees' then v_hect else e.hectarees end,
    texto_oferta         = coalesce(nullif(p_texto, ''), e.texto_oferta)
  where e.id = ex.id
  returning * into nou;

  -- D4: el productor cambia lo que decide a quién le sirve la oferta → vuelve a validación,
  -- si la validación está encendida y la oferta ya estaba fuera. El equipo no revalida: es
  -- quien valida.
  if not v_intern and public.validacio_ofertes_activa()
     and ex.estado in ('publicada', 'parcial', 'bloqueada')
     and (nou.kg_total is distinct from ex.kg_total
          or nou.modalitats is distinct from ex.modalitats) then
    revalidar := true;
    update excedentes set estado = 'pendent_validacio', validada_at = null, validada_per = null
     where id = ex.id
    returning * into nou;
  end if;

  -- Cubierto o no, con los kg nuevos: lo decide `recalcula_estat_excedent()` (20270606100000),
  -- la única fuente del estado publicada/parcial/bloqueada/cerrada.
  if not revalidar and nou.estado in ('publicada', 'parcial', 'bloqueada') then
    perform public.recalcula_estat_excedent(ex.id);
    select * into nou from excedentes where id = ex.id;
  end if;

  insert into excedentes_canvis (excedente_id, user_id, abans, despres, revalidar)
  values (ex.id, p_actor,
          (select jsonb_object_agg(k, to_jsonb(ex) -> k) from jsonb_object_keys(p_canvis) k),
          (select jsonb_object_agg(k, to_jsonb(nou) -> k) from jsonb_object_keys(p_canvis) k),
          revalidar);
  return nou;
end;
$$;
revoke execute on function public.editar_oferta(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant  execute on function public.editar_oferta(uuid, jsonb, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. `canalitzacions_actives()`: mismo `returns table`
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270530100000) con tres cambios:
--   · `kg_canalitzats` y `tot_conciliat` sin las canalizaciones anuladas;
--   · `rec_estado`: el del REC vivo MENOS avanzado (hoy hay uno por oferta, así que no cambia
--     nada; deja preparado el REC por recogida de la fase 3);
--   · las ofertas `cerrada` dejan de salir (son el Històric; el frontend ya las filtraba).
create or replace function public.canalitzacions_actives(p_limit integer default 200)
returns table(excedente_id uuid, id_excedente text, productor text, estado text, modalitat text,
              kg_total numeric, kg_canalitzats numeric, n_per_aprovar integer, rec_estado text,
              ents_pendents integer, conveni_gen text, created_at timestamptz, origen text,
              sortida_estado text, tot_conciliat boolean, n_respostes integer,
              n_per_aprovar_sense_conveni integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot llistar canalitzacions' using errcode = '42501';
  end if;

  return query
  select ex.id,
         ex.id_excedente,
         coalesce(p.empresa, p.name),
         ex.estado,
         ex.modalitat,
         ex.kg_total,
         coalesce((select sum(ca.kg_confirmados) from canalizaciones ca
                    where ca.excedente_id = ex.id and ca.estado <> 'anulada'), 0)::numeric,
         (select count(*) from oferta_respuestas r
           where r.excedente_id = ex.id
             and r.estado = 'acceptada' and r.aprovacio = 'pendent')::int,
         (select al.estado from albaranes al
           where al.tipo = 'REC'
             and (al.excedente_id = ex.id
                  or (ex.espigolada_id is not null and al.espigolada_id = ex.espigolada_id))
             and al.estado not in ('anulado', 'rectificado')
           order by case al.estado when 'borrador' then 0 when 'emitido' then 1
                                   when 'entregado' then 2 when 'confirmado' then 3
                                   else 4 end,
                    al.created_at desc
           limit 1),
         (select count(*) from albaranes al
           where al.tipo in ('ENT', 'OPE')
             and al.canalizacion_id in (select c2.id from canalizaciones c2 where c2.excedente_id = ex.id)
             and al.estado in ('emitido', 'entregado'))::int,
         -- El convenio que la modalidad EXIGE al generador (`convenios_exigidos`, parte
         -- `entrega`), igual que `canalitzacio_assistida()`.
         (select c.estado from convenios c
            join convenios_exigidos ce
              on (ce.tipo_convenio = c.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce.tipo_convenio and eq.tipo_antic = c.tipo and eq.valorizacion = ex.modalitat)) and ce.valorizacion = ex.modalitat
             and ce.parte = 'entrega'
           where c.productor_id = ex.productor_id and c.estado <> 'substituit'
           order by case c.estado when 'vigent' then 0 when 'firmat' then 1
                                  when 'pendent_firma' then 2 else 3 end
           limit 1),
         ex.created_at,
         ex.origen,
         (select al.estado from albaranes al
           where al.tipo in ('ENT', 'OPE')
             and al.canalizacion_id in (select c3.id from canalizaciones c3 where c3.excedente_id = ex.id)
             and al.estado not in ('anulado', 'rectificado')
           order by case al.estado when 'borrador' then 0 when 'emitido' then 1
                                   when 'entregado' then 2 when 'confirmado' then 3
                                   else 4 end
           limit 1),
         (select bool_and(c4.kg_conciliados is not null) from canalizaciones c4
           where c4.excedente_id = ex.id and c4.estado <> 'anulada'),
         (select count(*) from oferta_respuestas r2 where r2.excedente_id = ex.id)::int,
         -- Intereses por aprobar de una receptora SIN el convenio vigente que la modalidad
         -- le exige (parte `recibe`): `aprovar_resposta()` los rechazaría.
         (select count(*) from oferta_respuestas r3
           where r3.excedente_id = ex.id
             and r3.estado = 'acceptada' and r3.aprovacio = 'pendent'
             and not exists (
               select 1 from convenios c5
                 join convenios_exigidos ce5
                   on (ce5.tipo_convenio = c5.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce5.tipo_convenio and eq.tipo_antic = c5.tipo and eq.valorizacion = ex.modalitat)) and ce5.valorizacion = ex.modalitat
                  and ce5.parte = 'recibe'
                where c5.entidad_id = r3.entidad_id and c5.estado = 'vigent'))::int
    from excedentes ex
    left join productores p on p.id = ex.productor_id
   -- Los esborranys no son lotes del ciclo (20270530100000) y las cerradas ya no están en
   -- curso (20270606100000).
   where ex.estado not in ('cancelada', 'no_colocada', 'esborrany', 'cerrada')
   order by ex.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;
revoke execute on function public.canalitzacions_actives(integer) from public, anon;
grant  execute on function public.canalitzacions_actives(integer) to authenticated, service_role;
