-- `editar_oferta`: marcar o desmarcar «Espigolada» al editar (proceso 3.4 del cliente; fase 3 del
-- plan de noviembre de 2026).
--
-- Copia de la vigente (20270606100000; ninguna migración posterior la redefine). Solo cambia esto:
--
--   · `espigolada_demanada` (boolean) entra en `permeses`. Es la clave del jsonb de cambios que
--     manda `crear-oferta/editar` (contrato con `servidor`).
--   · Pasar a `true` (o seguir en `true`) hace de la oferta una DONACIÓN con el producto en el campo:
--     pone `producte_al_camp = true` y fuerza `modalitat = 'donacio'` / `modalitats = {donacio}`
--     (el check `excedentes_espigolada_donacio`, 20270617100000). Se rechaza con
--     `22023 espigolada_no_donacio` si hay asignaciones vivas (canalizaciones no anuladas) que no
--     son donación, o si el mismo cambio pide otras modalidades; y con
--     `22023 espigolada_sense_camp` si el mismo cambio pide `espigolada_demanada = true` y
--     `producte_al_camp = false`.
--   · Pasar a `false` está permitido y no toca nada más (las modalidades se quedan en donación
--     hasta que alguien las cambie).
--   · `producte_al_camp = false` sin decir nada de la espigolada la DESMARCA: sin producto en el
--     campo no hay espigolada (es la misma regla que la interfaz, donde la opción desaparece).
--   · Si es la PRODUCTORA quien marca la espigolada en una oferta ya fuera, vuelve a validación
--     aunque `validacio_ofertes_activa()` esté apagada: es la misma regla que el alta
--     (`trg_excedentes_validacio`, 20270614100000).
--   · `excedentes_canvis` guarda también lo que se derivó (modalidades, campo, marca), no solo las
--     claves que llegaron.
--
-- Misma firma y mismo `returns`: `create or replace` sirve y conserva los privilegios (solo
-- `service_role`; la llama `crear-oferta`). Se repiten igualmente.

CREATE OR REPLACE FUNCTION public.editar_oferta(p_id uuid, p_canvis jsonb, p_texto text, p_actor uuid)
 RETURNS excedentes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- 20270617100300: la espigolada al editar.
  v_esp     boolean;
  v_camp    boolean;
  v_forca   boolean := false;
  v_claus   text[];
  permeses  text[] := array['kg_total', 'modalitats', 'preu_minim', 'coste_kg', 'disponible_hasta',
                            'hora_recollida_inici', 'hora_recollida_fi', 'horari_recollida',
                            'observacions', 'variedad', 'num_caixes', 'subcausa_codigo',
                            -- 20270530100000 (punto 3, fase C):
                            'ubicacion_id', 'gmaps_url', 'format_entrega', 'retorn_envasos',
                            'retorn_envasos_detall', 'retorn_envasos_quantitat', 'producte_al_camp',
                            'dies_recollida', 'fotos', 'foto_producte',
                            -- 20270605100000 (fase 0 de los puntos 4-6):
                            'hectarees',
                            -- 20270617100300 (proceso 3.4):
                            'espigolada_demanada'];
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
  -- 20270617100300 (proceso 3.4): la espigolada es una donación con el producto en el campo.
  v_camp := case when p_canvis ? 'producte_al_camp'
                 then coalesce((p_canvis->>'producte_al_camp')::boolean, false)
                 else coalesce(ex.producte_al_camp, false) end;
  v_esp := case when p_canvis ? 'espigolada_demanada'
                then coalesce((p_canvis->>'espigolada_demanada')::boolean, false)
                else coalesce(ex.espigolada_demanada, false) end;
  if v_esp and not v_camp then
    if p_canvis ? 'espigolada_demanada' and p_canvis ? 'producte_al_camp' then
      raise exception 'espigolada_sense_camp: una espigolada te el producte al camp' using errcode = '22023';
    elsif p_canvis ? 'producte_al_camp' then
      -- Sin producto en el campo no hay espigolada: se desmarca.
      v_esp := false;
    else
      -- Marcarla pone el producto en el campo.
      v_camp := true;
    end if;
  end if;
  if v_esp then
    if p_canvis ? 'modalitats' and v_mods is distinct from array['donacio']::text[] then
      raise exception 'espigolada_no_donacio: una espigolada nomes es pot donar' using errcode = '22023';
    end if;
    if exists (select 1 from canalizaciones c where c.excedente_id = ex.id and c.estado <> 'anulada'
                and c.valorizacion is not null and c.valorizacion <> 'donacio') then
      raise exception 'espigolada_no_donacio: aquesta oferta te assignacions que no son donacio' using errcode = '22023';
    end if;
    if ex.modalitats is distinct from array['donacio']::text[] or ex.modalitat is distinct from 'donacio' then
      v_forca := true;
      v_mods := array['donacio']::text[];
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
    modalitats           = case when p_canvis ? 'modalitats' or v_forca then v_mods else e.modalitats end,
    modalitat            = case when p_canvis ? 'modalitats' or v_forca then v_mods[1] else e.modalitat end,
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
    producte_al_camp     = v_camp,
    espigolada_demanada  = v_esp,
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
  -- 20270617100300: y, como en el alta, siempre que la productora marque la espigolada.
  if not v_intern
     and ex.estado in ('publicada', 'parcial', 'bloqueada')
     and ((public.validacio_ofertes_activa()
           and (nou.kg_total is distinct from ex.kg_total
                or nou.modalitats is distinct from ex.modalitats))
          or (nou.espigolada_demanada and not coalesce(ex.espigolada_demanada, false))) then
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

  -- 20270617100300: lo que llegó y lo que se derivó de la espigolada.
  select array_agg(distinct k) into v_claus
    from (select jsonb_object_keys(p_canvis) k
          union all
          select unnest(array['modalitats', 'producte_al_camp', 'espigolada_demanada'])
           where p_canvis ? 'espigolada_demanada' or p_canvis ? 'producte_al_camp' or v_forca) s;

  insert into excedentes_canvis (excedente_id, user_id, abans, despres, revalidar)
  values (ex.id, p_actor,
          (select jsonb_object_agg(k, to_jsonb(ex) -> k) from unnest(coalesce(v_claus, '{}')) k),
          (select jsonb_object_agg(k, to_jsonb(nou) -> k) from unnest(coalesce(v_claus, '{}')) k),
          revalidar);
  return nou;
end;
$function$
;

revoke execute on function public.editar_oferta(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant  execute on function public.editar_oferta(uuid, jsonb, text, uuid) to service_role;
