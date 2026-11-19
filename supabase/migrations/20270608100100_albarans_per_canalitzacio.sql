-- Fase 3 del plan de los puntos 4-6 (cambio C2, con D1): los albaranes nacen POR CANALIZACIÓN.
--
--   · Donación (sin espigolada): su ENT y SU PROPIO REC, los dos en borrador. El REC lleva
--     `canalizacion_id` y una línea con los kilos ASIGNADOS (`kg_confirmados`), no los de la
--     oferta entera. Si la oferta ya tiene un REC HEREDADO (uno por oferta, sin canalización),
--     sigue el modelo viejo —solo el ENT—: una oferta nunca mezcla los dos modelos.
--   · Espigolada: como hasta ahora, solo el ENT (el REC es el de la jornada).
--   · Venta y maquila (D): NADA. Redestina no emite albarán de una venta ni de una maquila: la
--     recogida se registra y se valida sobre la canalización (20270608100200) y los documentos
--     propios de las partes se adjuntan a la canalización (20270608100400).
--
-- El número solo se gasta al emitir (en `validar_recollida`): modificar y anular una asignación
-- ajustan o anulan el borrador sin dejar huecos.
--
-- Lo que lee «un REC por oferta» y se adapta aquí (mismas firmas y mismos `returns`):
--   1. `trg_canalizaciones_crea_albaranes` (lo de arriba).
--   2. `mes_albara_canalitzacio`: el mes del REC heredado; si no lo hay, el de la asignación.
--   3. `valor_linia_rec`: un REC con canalización vale lo que vale esa canalización.
--   4. `albarans_germans_rec`: el hermano de un REC nuevo es el ENT de su misma canalización.
--   5. `propuesta_conciliacion`: un REC nuevo se compara solo con su ENT.
--   6. `conciliar_albaran`: solo un ENT/OPE escribe en la canalización (un REC con canalización
--      ya no la pisa); la cascada no cambia.
--   7. `conciliacions_automatiques`: la rama 3 (OPE sin REC) mira solo el REC heredado.
--   8. `v_albaranes_bandeja`: `entidad_id` y `codigo_lote` a null en las filas REC (D3: el donante
--      que lee su REC no ve a qué entidad fue).
--   9. `operacio_detall`: el REC de la recogida (o el heredado) y `pot_registrar` también para
--      una venta o maquila sin albarán.
--  10. `pendents_equip`: los REC por canalización y la cola nueva `recollides_equip` (ventas y
--      maquilas cuya recogida ya es trabajo del equipo). Pasan a ser 19 colas.
--  11. `programar_albarans_recollida`: pide el registro también a las ventas y maquilas sin albarán.
--  12. `canalitzacio_assistida`: la canalización trae también el precio acordado, las cajas y la
--      anulación (claves nuevas; nada se quita).
-- Encaje con la fase 2 (B2):
--  13. `anular_albaran`: un REC con canalización viva no se anula suelto (`22023
--      anula_la_canalitzacio`): se anula la asignación.
--  14. `modificar_assignacio`: ajusta también la línea del REC propio en borrador.
--  15. `anula_canalitzacio`: anula también el REC propio y lo cuenta en `ja_validada` (ya lo hacía
--      por `canalizacion_id`; se recrea con la regla escrita y el comentario al día).
-- Datos (D):
--  16. Los OPE en `borrador` se anulan: sin número, así que sin hueco (`borrador → anulado` lo
--      admite `trg_albaranes_inmutable`). Los OPE ya emitidos no se tocan: siguen el camino heredado.

-- ---------------------------------------------------------------------------
-- 1. `trg_canalizaciones_crea_albaranes`
-- ---------------------------------------------------------------------------
create or replace function public.trg_canalizaciones_crea_albaranes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex          excedentes%rowtype;
  v_mod       text;
  v_albaran   uuid;
  v_rec       uuid;
  v_familia   text;
begin
  if new.excedente_id is null then
    return new;   -- una canalización sin registro no puede documentar nada
  end if;

  select * into ex from excedentes where id = new.excedente_id;
  if ex.id is null then
    return new;
  end if;

  -- 20270608100100 (D): venta y maquila NO llevan albarán de Redestina. Solo la donación.
  v_mod := coalesce(new.valorizacion, ex.modalitat);
  if v_mod is distinct from 'donacio' then
    return new;
  end if;

  select familia into v_familia from productos where nombre = ex.producto;
  v_familia := coalesce(v_familia, ex.familia);

  -- (1) La salida de esta canalización: el ENT.
  insert into albaranes (tipo, excedente_id, canalizacion_id, retorn_envasos, idioma)
  values ('ENT', ex.id, new.id, ex.retorn_envasos, 'ca')
  returning id into v_albaran;

  insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                              num_cajas, kg_previstos, lote_origen)
  values (v_albaran, 1, ex.producto, ex.variedad, v_familia, ex.causa,
          new.caixes_entregades, new.kg_confirmados, new.codigo_lote);

  -- (2) La entrada: el REC DE ESTA RECOGIDA (20270608100100), en borrador y con los kilos
  --     asignados. El índice `albaranes_rec_canalizacion_uidx` impide dos.
  --
  -- ⚠️ UN REGISTRO DE ESPIGOLADA NO LLEVA REC PROPIO: la jornada ya tiene el suyo
  --    (`crear_espigolada()`), que cuelga de `espigolada_id`.
  -- ⚠️ UNA OFERTA CON REC HEREDADO (uno por oferta, sin canalización) SIGUE EL MODELO VIEJO: su
  --    REC ya cuenta los kilos de toda la oferta, y un REC por recogida los contaría dos veces.
  if ex.espigolada_id is null
     and not exists (select 1 from albaranes a
                      where a.tipo = 'REC' and a.excedente_id = ex.id
                        and a.canalizacion_id is null
                        and a.estado <> 'anulado') then
    insert into albaranes (tipo, excedente_id, canalizacion_id, retorn_envasos, idioma)
    values ('REC', ex.id, new.id, ex.retorn_envasos, 'ca')
    returning id into v_rec;

    insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                                num_cajas, kg_previstos)
    values (v_rec, 1, ex.producto, ex.variedad, v_familia, ex.causa,
            new.caixes_entregades, new.kg_confirmados);
  end if;

  return new;
end;
$$;
revoke execute on function public.trg_canalizaciones_crea_albaranes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. `mes_albara_canalitzacio`: el mes del REC HEREDADO; si no lo hay, el de la asignación
-- ---------------------------------------------------------------------------
-- La llama `trg_canalizaciones_valoriza` (BEFORE INSERT), cuando el REC propio aún no existe.
-- Sin el filtro, una canalización nueva tomaba el mes del REC de OTRA recogida de la misma oferta.
create or replace function public.mes_albara_canalitzacio(p_excedente uuid, p_creada timestamptz)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select date_trunc('month', (coalesce(
           (select min(a.created_at)
              from albaranes a
              join excedentes e on e.id = p_excedente
             where a.tipo = 'REC' and a.estado <> 'anulado'
               and ((a.excedente_id = e.id and a.canalizacion_id is null)
                    or (e.espigolada_id is not null and a.espigolada_id = e.espigolada_id))),
           p_creada, now()) at time zone 'Europe/Madrid'))::date;
$$;

-- ---------------------------------------------------------------------------
-- 3. `valor_linia_rec`: un REC con canalización vale lo que su canalización
-- ---------------------------------------------------------------------------
create or replace function public.valor_linia_rec(p_albaran uuid, p_producto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  a  albaranes%rowtype;
  c  record;
  v  record;
  v_mes date;
begin
  select * into a from albaranes where id = p_albaran;

  -- 20270608100100: el REC de una recogida, la valoración de ESA canalización.
  if a.canalizacion_id is not null then
    select x.coste_kg, x.preu_font, x.preu_mes_font, x.preu_mes_albara, x.preu_font_dies, x.preu_provisional
      into c
      from canalizaciones x
     where x.id = a.canalizacion_id;
    if found then
      return jsonb_build_object('valor_kg', c.coste_kg, 'font', c.preu_font, 'mes_font', c.preu_mes_font,
                                'mes_albara', c.preu_mes_albara, 'dies', c.preu_font_dies,
                                'provisional', c.preu_provisional);
    end if;
  end if;

  select x.coste_kg, x.preu_font, x.preu_mes_font, x.preu_mes_albara, x.preu_font_dies, x.preu_provisional
    into c
    from canalizaciones x
    join excedentes e on e.id = x.excedente_id
   where x.estado <> 'anulada' and coalesce(x.valorizacion, 'donacio') = 'donacio'
     and ((a.excedente_id is not null and x.excedente_id = a.excedente_id)
          or (a.excedente_id is null and a.espigolada_id is not null
              and e.espigolada_id = a.espigolada_id and e.producto is not distinct from p_producto))
   order by x.created_at
   limit 1;
  if found then
    return jsonb_build_object('valor_kg', c.coste_kg, 'font', c.preu_font, 'mes_font', c.preu_mes_font,
                              'mes_albara', c.preu_mes_albara, 'dies', c.preu_font_dies,
                              'provisional', c.preu_provisional);
  end if;
  v_mes := date_trunc('month', coalesce(a.created_at, now()) at time zone 'Europe/Madrid')::date;
  if a.excedente_id is not null then
    select * into v from public.valoracio_canalitzacio(a.excedente_id, v_mes);
    return jsonb_build_object('valor_kg', v.coste_kg, 'font', v.font, 'mes_font', v.mes_font,
                              'mes_albara', v_mes, 'dies', v.dies, 'provisional', v.provisional);
  end if;
  select r.eur_kg as coste_kg, r.font,
         case when r.exercici is not null then make_date(r.exercici, r.mes, 1) end as mes_font,
         r.provisional
    into v from public.preu_referencia_de(p_producto, v_mes) r limit 1;
  return jsonb_build_object('valor_kg', v.coste_kg, 'font', v.font, 'mes_font', v.mes_font,
                            'mes_albara', v_mes, 'dies', null,
                            'provisional', coalesce(v.provisional, true));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. `albarans_germans_rec`: el REC de una recogida tiene un solo hermano, su ENT
-- ---------------------------------------------------------------------------
-- La heredan sin tocarlas `rec_te_incidencia_recollida`, la cascada de `conciliar_albaran` y
-- las ramas 1 y 2 de `conciliacions_automatiques`.
create or replace function public.albarans_germans_rec(p_rec uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id
    from albaranes a
    join albaranes b on b.tipo in ('ENT', 'OPE')
   where a.id = p_rec and a.tipo = 'REC'
     and (
       -- 20270608100100: el REC de una recogida, su ENT (misma canalización).
       (a.canalizacion_id is not null and b.canalizacion_id = a.canalizacion_id)
       -- El heredado (uno por oferta) y el de una jornada, como siempre.
       or (a.canalizacion_id is null
           and ((a.excedente_id  is not null and b.excedente_id = a.excedente_id)
             or (a.espigolada_id is not null and b.excedente_id in
                   (select ex.id from excedentes ex where ex.espigolada_id = a.espigolada_id)))));
$$;

-- ---------------------------------------------------------------------------
-- 5. `propuesta_conciliacion`: un REC de recogida se compara solo con su ENT
-- ---------------------------------------------------------------------------
create or replace function public.propuesta_conciliacion(p_rec uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  a        albaranes%rowtype;
  par      parametros_documentales%rowtype;
  v_rec    numeric;
  v_ent    numeric;
  v_dif    numeric;
  v_pct    numeric;
  v_ents   jsonb;
  v_extern jsonb;
  v_plazo  boolean;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot veure la proposta de conciliacio' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_rec;
  if a.id is null or a.tipo <> 'REC' then
    raise exception 'La proposta de conciliacio es fa sobre un albara de recepcio' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  -- El neto del REC con lo que CONFIRMÓ quien entrega, si confirmó (11-10-2026).
  select coalesce(sum(coalesce(l.kg_confirmados, l.kg_neto, l.kg_previstos)), 0) into v_rec
    from albaran_lineas l where l.albaran_id = a.id;

  -- Las salidas con las que se compara: las de su canalización (REC de una recogida,
  -- 20270608100100) o las del mismo registro / espigolada (heredado y jornada).
  select coalesce(sum(x.kg), 0),
         jsonb_agg(jsonb_build_object('albara', x.numero, 'estat', x.estado,
                                      'entitat', x.entidad, 'kg', x.kg))
    into v_ent, v_ents
    from (
      select b.numero_completo as numero, b.estado as estado, e.nombre as entidad,
             coalesce(sum(coalesce(l.kg_confirmados, l.kg_neto, l.kg_previstos)), 0) as kg
        from albaranes b
        join canalizaciones c on c.id = b.canalizacion_id
        left join entidades e on e.id = c.entidad_id
        left join albaran_lineas l on l.albaran_id = b.id
       where b.tipo in ('ENT', 'OPE')
         and b.estado not in ('borrador', 'anulado', 'rectificado')
         and ((a.canalizacion_id is not null and b.canalizacion_id = a.canalizacion_id)
           or (a.canalizacion_id is null
               and ((a.excedente_id  is not null and b.excedente_id  = a.excedente_id)
                 or (a.espigolada_id is not null and c.excedente_id in
                       (select ex.id from excedentes ex where ex.espigolada_id = a.espigolada_id)))))
       group by b.id, b.numero_completo, b.estado, e.nombre
    ) x;

  select jsonb_agg(jsonb_build_object('numero', x.numero, 'data', x.fecha))
    into v_extern
    from documentos_externos x
   where x.objeto_tipo = 'albaran' and x.objeto_id = a.id and x.tipo = 'albaran_productor';

  v_dif := v_rec - v_ent;
  v_pct := case when v_rec > 0 then round(abs(v_dif) / v_rec * 100, 2) else null end;

  -- ¿Se puede conciliar sin confirmación? Solo si venció el plazo del parámetro.
  select bool_and(b.confirmado_at is not null
                  or b.entregado_at + make_interval(days => coalesce(par.plazo_conciliar_sin_confirmacion_dias, 7)) < now())
    into v_plazo
    from albaranes b
    join canalizaciones c on c.id = b.canalizacion_id
   where b.tipo in ('ENT', 'OPE')
     and b.estado in ('entregado', 'confirmado')
     and ((a.canalizacion_id is not null and b.canalizacion_id = a.canalizacion_id)
       or (a.canalizacion_id is null and b.excedente_id = a.excedente_id));

  return jsonb_build_object(
    'albara_rec',        a.numero_completo,
    'kg_recepcio',       v_rec,
    'kg_entregues',      v_ent,
    'entregues',         coalesce(v_ents, '[]'::jsonb),
    'document_productor', coalesce(v_extern, '[]'::jsonb),
    'diferencia',        v_dif,
    'diferencia_pct',    v_pct,
    'tolerancia_pct',    coalesce(par.tolerancia_conciliacion_pct, 2),
    'dins_tolerancia',   coalesce(v_pct, 0) <= coalesce(par.tolerancia_conciliacion_pct, 2),
    'termini_vencut',    coalesce(v_plazo, true)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. `conciliar_albaran`: solo un ENT/OPE escribe en la canalización
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270601100000). Único cambio: `and a.tipo in ('ENT', 'OPE')` en la
-- escritura de la canalización. El REC de una recogida lleva `canalizacion_id` y, sin el filtro,
-- conciliarlo escribiría la canalización con los kilos del REC; la escribe su ENT en la cascada.
create or replace function public.conciliar_albaran(
  p_id uuid, p_kg_validados jsonb default null, p_motivo text default null, p_destino_final text default null)
returns albaranes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a        albaranes%rowtype;
  par      parametros_documentales%rowtype;
  k        jsonb;
  v_total  numeric;
  v_prop   jsonb;
  v_inc    boolean;
  b        record;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot conciliar un albara' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado not in ('entregado', 'confirmado') then
    raise exception 'Nomes es concilia un albara entregat o confirmat' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  if a.confirmado_at is null then
    if a.entregado_at is null
       or a.entregado_at + make_interval(days => coalesce(par.plazo_conciliar_sin_confirmacion_dias, 7)) > now() then
      raise exception 'Encara no ha vencut el termini de confirmacio: cal esperar o rebre la confirmacio'
        using errcode = '22023';
    end if;
    if coalesce(btrim(p_motivo), '') = '' then
      raise exception 'Conciliar sense confirmacio necessita motiu' using errcode = '22023';
    end if;
  end if;

  -- Una diferencia de kilos declarada por la entidad receptora no se concilia sin motivo.
  if a.tipo = 'REC' then
    v_inc := public.rec_te_incidencia_recollida(a.id);
  else
    v_inc := a.canalizacion_id is not null and exists (
      select 1 from canalizaciones c
       where c.id = a.canalizacion_id and c.incidencia_recollida is not null);
  end if;
  if coalesce(v_inc, false) and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'cal_motiu_incidencia: l''entitat receptora ha declarat una diferencia de quilos en aquesta recollida; cal un motiu per conciliar'
      using errcode = '22023';
  end if;

  -- Un REC fuera de tolerancia se concilia, pero con motivo: arrastra sus salidas.
  if a.tipo = 'REC' then
    v_prop := public.propuesta_conciliacion(a.id);
    if not coalesce((v_prop->>'dins_tolerancia')::boolean, true)
       and coalesce(btrim(p_motivo), '') = '' then
      raise exception 'fora_de_tolerancia: la diferencia (% %%) supera la tolerancia (% %%); cal un motiu per conciliar',
        v_prop->>'diferencia_pct', v_prop->>'tolerancia_pct' using errcode = '22023';
    end if;
  end if;

  if p_kg_validados is null then
    update albaran_lineas
       set kg_validados = coalesce(kg_confirmados, kg_neto, kg_previstos)
     where albaran_id = a.id;
  else
    for k in select * from jsonb_array_elements(p_kg_validados) loop
      update albaran_lineas
         set kg_validados = (k->>'kg')::numeric
       where id = (k->>'linea_id')::uuid and albaran_id = a.id;
    end loop;
  end if;

  select coalesce(sum(kg_validados), 0) into v_total
    from albaran_lineas where albaran_id = a.id;

  update albaranes
     set estado              = 'conciliado',
         conciliado_at       = now(),
         conciliado_por      = auth.uid(),
         motivo_conciliacion = p_motivo,
         destino_final       = coalesce(p_destino_final, a.destino_final)
   where id = a.id
  returning * into a;

  -- La canalización: kilos conciliados (D2: el coste lo fijó la canalización al nacer; si seguía
  -- en null se valora una vez más con la misma regla). 20270608100100: SOLO desde su salida
  -- (ENT/OPE); el REC de una recogida también lleva `canalizacion_id` y no la escribe.
  if a.canalizacion_id is not null and a.tipo in ('ENT', 'OPE') then
    perform public.valora_canalitzacio_si_cal(a.canalizacion_id, 'conciliacio');

    update canalizaciones
       set kg_conciliados      = v_total,
           kg_reales           = coalesce(kg_reales, v_total),
           estado              = 'conciliada',
           conciliada_at       = now(),
           conciliada_por      = auth.uid(),
           motivo_conciliacion = p_motivo
     where id = a.canalizacion_id;
  end if;

  -- La versión definitiva del PDF, que sustituye a la emitida.
  perform public.albaran_emet_document(a.id, 'conciliat', null);

  -- La cascada: las salidas confirmadas de este REC (`albarans_germans_rec`: su ENT si es el REC
  -- de una recogida; las del registro o la jornada si es heredado).
  if a.tipo = 'REC' then
    for b in
      select s.id from albaranes s
       where s.id in (select public.albarans_germans_rec(a.id))
         and s.estado = 'confirmado'
       order by s.created_at
    loop
      perform public.conciliar_albaran(
        b.id, null,
        coalesce(nullif(btrim(p_motivo), ''),
                 'Conciliat amb l''albara de recepcio ' || coalesce(a.numero_completo, a.id::text)),
        null);
    end loop;
  end if;

  return a;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. `conciliacions_automatiques`: la rama 3 mira solo el REC HEREDADO
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270428100000). Sin el filtro, el REC de una donación de la misma oferta
-- (que ya no tiene nada que ver con el OPE) dejaba un OPE heredado sin conciliar para siempre.
create or replace function public.conciliacions_automatiques()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rec  record;
  b    record;
  prop jsonb;
  n    integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor concilia automaticament' using errcode = '42501';
  end if;

  -- 1. REC confirmado con todas sus salidas confirmadas (o ya cerradas), dentro de
  --    tolerancia y SIN incidencia de recogida. `conciliar_albaran()` concilia el REC y
  --    arrastra las salidas.
  for rec in
    select a.id
      from albaranes a
     where a.tipo = 'REC' and a.estado = 'confirmado'
       and not exists (
         select 1 from albaranes s
          where s.id in (select public.albarans_germans_rec(a.id))
            and s.estado not in ('confirmado', 'anulado', 'rectificado', 'conciliado'))
       and exists (
         select 1 from albaranes s
          where s.id in (select public.albarans_germans_rec(a.id))
            and s.estado = 'confirmado')
       and not public.rec_te_incidencia_recollida(a.id)
  loop
    begin
      prop := public.propuesta_conciliacion(rec.id);
      if coalesce((prop->>'dins_tolerancia')::boolean, false) then
        perform public.conciliar_albaran(rec.id, null, 'conciliacio automatica (dins de tolerancia)', null);
        n := n + 1;
      end if;
    exception when others then
      raise warning 'conciliacions_automatiques: REC %: %', rec.id, sqlerrm;
    end;
  end loop;

  -- 2. Salidas confirmadas cuyo REC ya está conciliado, salvo las que tienen una incidencia
  --    que ningún admin ha validado.
  for b in
    select s.id, a.numero_completo as rec_num
      from albaranes a
      join albaranes s on s.id in (select public.albarans_germans_rec(a.id))
      left join canalizaciones c on c.id = s.canalizacion_id
     where a.tipo = 'REC' and a.estado = 'conciliado'
       and s.estado = 'confirmado'
       and (c.incidencia_recollida is null or c.recollida_validada_at is not null)
  loop
    begin
      perform public.conciliar_albaran(
        b.id, null,
        'conciliacio automatica (recepcio ' || coalesce(b.rec_num, '?') || ' ja conciliada)', null);
      n := n + 1;
    exception when others then
      raise warning 'conciliacions_automatiques: sortida %: %', b.id, sqlerrm;
    end;
  end loop;

  -- 3. OPE (heredado) confirmado sin REC HEREDADO vivo en su excedente, sin incidencia por
  --    validar. 20270608100100: el REC de una recogida de donación no es del OPE.
  for b in
    select a.id from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
     where a.tipo = 'OPE' and a.estado = 'confirmado'
       and (c.incidencia_recollida is null or c.recollida_validada_at is not null)
       and not exists (
         select 1 from albaranes r
          where r.tipo = 'REC' and r.excedente_id = a.excedente_id
            and r.canalizacion_id is null
            and r.estado not in ('anulado', 'rectificado'))
  loop
    begin
      perform public.conciliar_albaran(b.id, null, 'conciliacio automatica (confirmat per totes les parts)', null);
      n := n + 1;
    exception when others then
      raise warning 'conciliacions_automatiques: OPE %: %', b.id, sqlerrm;
    end;
  end loop;

  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. `v_albaranes_bandeja`: mismas columnas; sin entidad ni lote en un REC
-- ---------------------------------------------------------------------------
-- Con el REC por recogida, `canalizacion_id` lleva a la entidad receptora. El donante lee su REC
-- (RLS de `albaranes`) y la vista es `security_invoker`: D3, no ve a qué entidad fue.
create or replace view public.v_albaranes_bandeja
with (security_invoker = true) as
 select a.id,
    a.tipo,
    a.numero_completo,
    a.estado,
    a.ejercicio,
    a.excedente_id,
    a.espigolada_id,
    a.canalizacion_id,
    e.id_excedente,
    coalesce(e.producto, l.productes) as producto,
    coalesce(e.productor_id, es.productor_id) as productor_id,
    case when a.tipo = 'REC' then null::uuid else c.entidad_id end as entidad_id,
    case when a.tipo = 'REC' then null::text else c.codigo_lote end as codigo_lote,
    a.emitido_at,
    a.entregado_at,
    a.confirmado_at,
    a.conciliado_at,
    a.rechazo,
    l.kg_previstos,
    l.kg_neto,
    l.kg_confirmados,
    l.kg_validados,
        case
            when a.entregado_at is not null and a.confirmado_at is null then extract(day from now() - a.entregado_at)::integer
            else null::integer
        end as dias_esperando
   from albaranes a
     left join excedentes e on e.id = a.excedente_id
     left join espigoladas es on es.id = a.espigolada_id
     left join canalizaciones c on c.id = a.canalizacion_id
     left join lateral ( select sum(albaran_lineas.kg_previstos) as kg_previstos,
            sum(albaran_lineas.kg_neto) as kg_neto,
            sum(albaran_lineas.kg_confirmados) as kg_confirmados,
            sum(albaran_lineas.kg_validados) as kg_validados,
            string_agg(distinct albaran_lineas.producto, ', '::text order by albaran_lineas.producto) as productes
           from albaran_lineas
          where albaran_lineas.albaran_id = a.id) l on true;

-- ---------------------------------------------------------------------------
-- 9. `operacio_detall`: el REC de la recogida y `pot_registrar` sin albarán en venta/maquila
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270428100000). Mismo `returns table`. Cambian:
--   · `rec`: primero el REC de ESTA canalización; si no lo hay, el heredado de la oferta;
--   · `pot_registrar`: también cierto para una venta o maquila SIN albarán (D), mientras no esté
--     conciliada. La regla de `registrar_recollida_escriu()` (20270608100200) es la misma.
create or replace function public.operacio_detall(p_canalizacion uuid)
returns table(canalizacion_id uuid, excedente_id uuid, resposta_id uuid, rol text, producte text, varietat text, modalitat text, kg_sollicitats numeric, kg_assignats numeric, kg_rebuts numeric, data_hora_recollida timestamptz, estat_recollida text, productor_nom text, productor_contacte text, productor_telefon text, entitat_nom text, entitat_contacte text, entitat_telefon text, lloc_alias text, lloc_adreca text, lloc_municipi text, lloc_maps text, lloc_contacte text, lloc_telefon text, lloc_horari text, lloc_observacions text, condicions text, albara_numero text, albara_estat text, pot_registrar boolean, recollida_real_at timestamptz, recollida_registrada_at timestamptz, incidencia_recollida jsonb, rec_numero text, rec_estat text, kg_declarats numeric, resultat_recollida text, recollida_validada_at timestamptz, recollida_retornada_at timestamptz, motiu_retorn text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select c.*, e.productor_id, e.producto, e.variedad, e.observacions, e.ubicacion_id,
           e.horari_recollida, e.espigolada_id,
           case
             when auth.uid() is null or public.es_intern() then 'equip'
             when e.productor_id in (select public.mis_productores()) then 'productor'
             when c.entidad_id in (select public.mis_entidades()) then 'entidad'
           end as qui
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
     where c.id = p_canalizacion
  ),
  alb as (
    select a.id, a.numero_completo, a.estado
      from albaranes a, c
     where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
       and a.estado not in ('anulado', 'rectificado')
     order by a.created_at desc
     limit 1
  ),
  rec as (
    -- 20270608100100: el REC de ESTA recogida; si no lo hay, el heredado de la oferta.
    select a.numero_completo, a.estado
      from albaranes a, c
     where a.tipo = 'REC' and a.estado not in ('anulado', 'rectificado')
       and (a.canalizacion_id = c.id
            or (a.canalizacion_id is null and a.excedente_id = c.excedente_id
                and a.espigolada_id is null))
     order by (a.canalizacion_id is null), a.created_at desc
     limit 1
  )
  select c.id, c.excedente_id, r.id, c.qui,
         c.producto, c.variedad, c.valorizacion,
         r.kg_solicitados,
         c.kg_confirmados,
         coalesce(c.kg_conciliados, c.kg_reales),
         c.data_hora_recollida,
         case
           -- Registrada por el receptor y esperando a que un admin la valide.
           when c.recollida_registrada_at is not null and c.recollida_validada_at is null then 'registrada'
           when c.estado = 'conciliada' or alb.estado = 'conciliado' then 'conciliada'
           when alb.estado = 'confirmado' then 'confirmada'
           when alb.estado = 'entregado' then 'entregada'
           when alb.estado = 'emitido' or c.data_hora_recollida is not null then 'programada'
           else 'pendent'
         end,
         coalesce(nullif(p.empresa, ''), p.name), p.name, p.phone,
         en.nombre, en.contacto, en.telefono,
         u.alias, u.direccion, coalesce(u.municipio, p.poblacion), u.gmaps_url,
         coalesce(u.contacto_nombre, p.name), coalesce(u.contacto_telefono, p.phone),
         coalesce(u.horario, c.horari_recollida), u.observaciones,
         c.observacions,
         alb.numero_completo, alb.estado,
         -- La misma condición que exige `registrar_recollida()`.
         (c.qui = 'entidad' and c.estado <> 'anulada' and c.recollida_registrada_at is null
          and c.recollida_validada_at is null
          and c.espigolada_id is null
          and (
            (alb.estado in ('borrador', 'emitido', 'entregado')
             and not exists (select 1 from enlaces_token t
                              where t.objeto_tipo = 'albaran' and t.objeto_id = alb.id
                                and t.proposito = 'confirmacion_albaran'
                                and t.usado_at is not null and t.rol_parte = 'recibe'))
            -- 20270608100100 (D): una venta o una maquila no tiene albarán.
            or (alb.id is null and c.valorizacion in ('venda', 'maquila')
                and c.estado <> 'conciliada'))),
         c.recollida_real_at, c.recollida_registrada_at, c.incidencia_recollida,
         rec.numero_completo, rec.estado,
         c.kg_declarats, c.resultat_recollida, c.recollida_validada_at,
         c.recollida_retornada_at, c.motiu_retorn
    from c
    left join alb on true
    left join rec on true
    left join productores p on p.id = c.productor_id
    left join entidades en on en.id = c.entidad_id
    left join productor_ubicaciones u on u.id = c.ubicacion_id
    left join oferta_respuestas r on r.canalizacion_id = c.id
   where c.qui is not null
     and (c.qui <> 'entidad' or c.estado <> 'anulada');
$$;

-- ---------------------------------------------------------------------------
-- 10. `pendents_equip`: REC por canalización y la cola `recollides_equip` (19 colas)
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270531100000). Cambian `albarans_esborrany` (rama c),
-- `albarans_conciliar` («su» REC: el de su canalización o el heredado) y la cola nueva 7.5.
create or replace function public.pendents_equip()
returns table(cua text, n integer, ref uuid, detall jsonb)
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la cua de treball' using errcode = '42501';
  end if;

  return query
  with param as (
    select extract(year from (now() at time zone 'Europe/Madrid'))::int as any_curs,
           (now() at time zone 'Europe/Madrid')::date                   as avui
  ),
  tanc as (
    select ci.id, ci.ejercicio, ci.modo, ci.estado
      from cierres_ejercicio ci
     where ci.estado in ('obert', 'provisional')
     order by ci.abierto_at desc, ci.created_at desc
     limit 1
  ),
  -- Canalizaciones cuya recogida es ya trabajo del EQUIPO (20270427100000): no anuladas, sin
  -- registrar por el receptor, y con la recogida pasada o, sin hora acordada, con más de 2 días.
  canal_equip as (
    select c.id, c.excedente_id
      from canalizaciones c
     where c.estado <> 'anulada'
       and c.recollida_registrada_at is null
       and c.recollida_validada_at is null
       -- 20270428100000: una que un admin acaba de retornar espera otra vez al receptor.
       and (c.recollida_retornada_at is null or c.recollida_retornada_at < now() - interval '2 days')
       and (c.data_hora_recollida <= now()
            or (c.data_hora_recollida is null and c.created_at < now() - interval '2 days'))
  ),
  cues as (
    -- ⚠️ Las columnas del CTE NO se llaman `cua`, `n`, `ref` ni `detall` (parámetros OUT).
    select 1::numeric as ordre, 'registres'::text as clau,
           (select count(*) from membresias m where m.aprovacio = 'pendent')::int as quants,
           null::uuid as objecte, null::jsonb as extra
    union all
    select 2, 'convenis_contrasignar',
           (select count(*) from convenios cv where cv.estado = 'firmat')::int, null, null
    union all
    select 2.5, 'ofertes_per_validar',
           (select count(*) from excedentes e where e.estado = 'pendent_validacio')::int,
           null, null
    union all
    select 3, 'respostes',
           (select count(*) from oferta_respuestas r
             where r.estado = 'acceptada' and r.aprovacio = 'pendent')::int, null, null
    union all
    select 3.5, 'recollides_per_validar',
           (select count(*) from canalizaciones c
             where c.estado <> 'anulada'
               and c.recollida_registrada_at is not null
               and c.recollida_validada_at is null)::int, null, null
    union all
    select 3.7, 'signatures_per_tancar',
           (select count(*) from firmes_document f where f.estat = 'signat')::int, null, null
    union all
    select 4, 'missatges',
           (select coalesce(sum(ms.pendents), 0)::int from missatges_sense_contestar() ms),
           null, null
    union all
    select 5, 'ofertes_sense_enviar',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and not exists (select 1 from oferta_respuestas r
                                where r.excedente_id = e.id))::int, null, null
    union all
    select 5.5, 'ofertes_modificades',
           (select count(distinct x.excedente_id) from excedentes_canvis x
             where x.revisat_at is null
               and not exists (select 1 from usuario_roles ur where ur.user_id = x.user_id))::int,
           null, null
    union all
    select 6, 'ofertes_vencudes',
           (select count(*) from excedentes e, param p
             where (e.estado = 'no_colocada'
                    or (e.estado in ('publicada', 'parcial') and e.disponible_hasta < p.avui))
               and (select dx.kg_sense_desti from public.desti_excedent(e.id) dx) > 0)::int,
           null, null
    union all
    -- Borradores que son trabajo del equipo:
    --   (a) los de espigolada (los emite siempre el equipo);
    --   (b) ENT/OPE cuya canalización está en `canal_equip`;
    --   (c) el REC de una recogida (20270608100100) si su canalización está en `canal_equip`, y el
    --       REC heredado de una oferta si alguna de sus canalizaciones lo está;
    --   (d) cualquier otro borrador que no cuelgue ni de una canalización ni de una espigolada.
    select 7, 'albarans_esborrany',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
             where a.estado = 'borrador'
               and (
                 -- (a)
                 (a.tipo = 'REC' and a.espigolada_id is not null)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is not null)
                 -- (b)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is null
                     and a.canalizacion_id in (select ce.id from canal_equip ce))
                 -- (c)
                 or (a.tipo = 'REC' and a.canalizacion_id is not null
                     and a.canalizacion_id in (select ce.id from canal_equip ce))
                 or (a.tipo = 'REC' and a.canalizacion_id is null
                     and a.espigolada_id is null and a.excedente_id is not null
                     and exists (select 1 from canal_equip ce where ce.excedente_id = a.excedente_id))
                 -- (d)
                 or (a.tipo in ('ENT', 'OPE') and a.canalizacion_id is null
                     and coalesce(ex.espigolada_id is null, true))
                 or (a.tipo = 'REC' and a.espigolada_id is null and a.excedente_id is null)
               ))::int, null, null
    union all
    -- NUEVA (20270608100100, D). Ventas y maquilas cuya recogida ya es trabajo del equipo
    -- (`canal_equip`) y que NO tienen albarán: no salen en `albarans_esborrany` (no hay borrador)
    -- y sin esta cola nadie las contaba. Se cierran con «Registrar la recollida».
    select 7.5, 'recollides_equip',
           (select count(*) from canalizaciones c
             where c.id in (select ce.id from canal_equip ce)
               and c.valorizacion in ('venda', 'maquila')
               and c.estado <> 'conciliada'
               and not exists (select 1 from albaranes b
                                where b.canalizacion_id = c.id and b.tipo in ('ENT', 'OPE')
                                  and b.estado not in ('anulado', 'rectificado')))::int,
           null, null
    union all
    -- Lo que tiene que conciliar el equipo:
    --   · los REC entregados o confirmados;
    --   · los ENT/OPE confirmados SIN «su» REC vivo —el de su canalización (20270608100100) o el
    --     heredado de la oferta / de la jornada—;
    --   · los ENT/OPE confirmados con incidencia de recogida cuyo REC ya está conciliado.
    select 8, 'albarans_conciliar',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
              left join canalizaciones c on c.id = a.canalizacion_id
             where (a.tipo = 'REC' and a.estado in ('entregado', 'confirmado'))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    and not coalesce(c.recollida_registrada_at is not null
                                     and c.recollida_validada_at is null, false)
                    and not exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado not in ('anulado', 'rectificado')
                         and ((r.canalizacion_id is not null and r.canalizacion_id = a.canalizacion_id)
                           or (r.canalizacion_id is null
                               and (r.excedente_id = a.excedente_id
                                    or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id))))))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    and c.incidencia_recollida is not null
                    and c.recollida_validada_at is null
                    and c.recollida_registrada_at is null
                    -- ⚠️ Sin `albarans_germans_rec()` (interna; esta función es invoker).
                    and exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado = 'conciliado'
                         and ((r.canalizacion_id is not null and r.canalizacion_id = a.canalizacion_id)
                           or (r.canalizacion_id is null
                               and (r.excedente_id = a.excedente_id
                                    or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id)))))))::int,
           null, null
    union all
    select 9, 'albarans_esperant',
           (select count(*) from albaranes a where a.estado = 'entregado')::int, null, null
    union all
    select 10, 'costos',
           (select count(distinct e.producto)
              from canalizaciones c
              join excedentes e on e.id = c.excedente_id
              cross join param p
             where extract(year from (c.created_at at time zone 'Europe/Madrid'))::int
                   = p.any_curs
               and e.producto is not null
               and c.coste_kg is null
               and not exists (select 1 from costes_producto cp
                                where cp.producto = e.producto))::int, null, null
    union all
    select 11, 'tancament',
           (select count(*) from cierres_ejercicio ci
             where ci.estado in ('obert', 'provisional'))::int,
           (select t.id from tanc t),
           (select jsonb_build_object(
                     'ejercicio',   t.ejercicio,
                     'modo',        t.modo,
                     'estado',      t.estado,
                     'bloquejats',
                     (select count(*) from cierres_donante d
                       where d.cierre_id = t.id
                         and exists (
                           select 1
                             from jsonb_array_elements(
                                    case when jsonb_typeof(d.bloqueos) = 'array'
                                         then d.bloqueos else '[]'::jsonb end) b
                            where coalesce((b ->> 'bloqueja')::boolean, false))))
              from tanc t)
    union all
    select 12, 'documents_error',
           (select count(*) from documentos d where d.estado = 'error')::int, null, null
    union all
    select 13, 'espigolades_per_convertir',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and e.producte_al_camp
               and e.espigolada_id is null)::int, null, null
    union all
    select 14, 'preus',
           ((select count(*) from preus_carregues pc where pc.font = 'gencat' and pc.estat = 'pendent')
            + (select count(*) from preus_fonts_estat pf where pf.darrer_resultat = 'error'))::int,
           null, null
  )
  select q.clau, q.quants, q.objecte, q.extra from cues q order by q.ordre;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. `programar_albarans_recollida`: también las ventas y maquilas sin albarán
-- ---------------------------------------------------------------------------
create or replace function public.programar_albarans_recollida()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c       record;
  v_resp  uuid;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor programa recollides' using errcode = '42501';
  end if;

  for c in
    select cz.id, cz.entidad_id, cz.kg_confirmados, cz.data_hora_recollida,
           ex.id as excedente_id, ex.producto,
           coalesce(nullif(p.empresa, ''), p.name) as productor
      from canalizaciones cz
      join excedentes ex on ex.id = cz.excedente_id
      left join productores p on p.id = ex.productor_id
     where cz.estado <> 'anulada'
       and cz.entidad_id is not null
       and cz.data_hora_recollida is not null
       and cz.data_hora_recollida <= now()
       and cz.registre_demanat_at is null
       and cz.recollida_registrada_at is null
       and ex.espigolada_id is null
       and (exists (select 1 from albaranes b
                     where b.canalizacion_id = cz.id and b.tipo in ('ENT', 'OPE')
                       and b.estado = 'borrador')
            -- 20270608100100 (D): una venta o una maquila no tiene albarán.
            or (cz.valorizacion in ('venda', 'maquila')
                and cz.estado <> 'conciliada'
                and cz.recollida_validada_at is null
                and not exists (select 1 from albaranes b
                                 where b.canalizacion_id = cz.id and b.tipo in ('ENT', 'OPE')
                                   and b.estado not in ('anulado', 'rectificado'))))
     order by cz.data_hora_recollida
     limit 100
  loop
    begin
      select r.id into v_resp from oferta_respuestas r where r.canalizacion_id = c.id limit 1;
      perform public.crear_avis('entidad', c.entidad_id, 'recollida_per_registrar',
        case when v_resp is null then 'canalizacion' else 'oferta_resposta' end,
        coalesce(v_resp, c.id),
        jsonb_build_object('producte', c.producto, 'kg', c.kg_confirmados,
                           'recollida_at', c.data_hora_recollida, 'productor', c.productor,
                           'excedente_id', c.excedente_id));
      update canalizaciones set registre_demanat_at = now() where id = c.id;
    exception when others then
      raise warning 'programar_albarans_recollida: %: %', c.id, sqlerrm;
    end;
  end loop;
  return '[]'::jsonb;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. `canalitzacio_assistida`: la canalización con precio, cajas y anulación
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270430100000 y siguientes). Solo se AÑADEN claves a cada canalización
-- (`preu_acordat_kg`, `preu_acceptat_at`, `caixes_entregades`, `anulada_at`, `motiu_anulacio`):
-- la tarjeta de una venta o maquila muestra su registro sin albarán. Los albaranes ya traían
-- `canalizacion_id` (también el REC de cada recogida).
create or replace function public.canalitzacio_assistida(p_excedente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  ex  excedentes%rowtype;
  res jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot veure una canalitzacio assistida'
      using errcode = '42501';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null then
    raise exception 'Aquesta oferta no existeix' using errcode = 'PT404';
  end if;

  select jsonb_build_object(
    'oferta', jsonb_build_object(
      'id', ex.id, 'id_excedente', ex.id_excedente, 'estado', ex.estado,
      'modalitat', ex.modalitat, 'producto', ex.producto, 'kg_total', ex.kg_total,
      'preu_minim', ex.preu_minim, 'disponible_hasta', ex.disponible_hasta,
      'origen', ex.origen, 'espigolada_id', ex.espigolada_id,
      'created_at', ex.created_at,
      'modalitats', to_jsonb(ex.modalitats)),

    'productor', (select jsonb_build_object('id', p.id,
                           'nom', coalesce(p.empresa, p.name),
                           'email', p.email, 'telefon', p.phone,
                           'organizacion_id', p.organizacion_id)
                    from productores p where p.id = ex.productor_id),

    'conveni_gen', (
      select jsonb_build_object('id', c.id, 'tipo', c.tipo, 'estado', c.estado,
                                'numero', c.numero_completo, 'enviado_at', c.enviado_at,
                                'origen', c.origen)
        from convenios c
        join convenios_exigidos ce
          on (ce.tipo_convenio = c.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce.tipo_convenio and eq.tipo_antic = c.tipo and eq.valorizacion = ex.modalitat)) and ce.valorizacion = ex.modalitat
         and ce.parte = 'entrega'
       where c.productor_id = ex.productor_id
         and c.estado <> 'substituit'
       order by case c.estado when 'vigent' then 0 when 'firmat' then 1
                              when 'pendent_firma' then 2 else 3 end
       limit 1),

    'respostes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'entidad_id', r.entidad_id,
               'entitat', coalesce(e.nombre, '(sense fitxa)'),
               'email', e.email, 'tipo_receptor', e.tipo_receptor,
               'canal', r.canal, 'estado', r.estado, 'aprovacio', r.aprovacio,
               'kg_solicitados', r.kg_solicitados, 'preu_ofert', r.preu_ofert,
               'canalizacion_id', r.canalizacion_id,
               'modalitat', r.modalitat, 'caixes_solicitades', r.caixes_solicitades,
               'recollida_at', r.recollida_at, 'kg_aprovats', r.kg_aprovats,
               'telefono', r.telefono, 'enviado_at', r.enviado_at,
               'conveni_rec', (
                 select jsonb_build_object('id', c2.id, 'estado', c2.estado,
                                           'numero', c2.numero_completo, 'tipo', c2.tipo,
                                           'origen', c2.origen)
                   from convenios c2
                   join convenios_exigidos ce2
                     on (ce2.tipo_convenio = c2.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce2.tipo_convenio and eq.tipo_antic = c2.tipo and eq.valorizacion = ex.modalitat)) and ce2.valorizacion = ex.modalitat
                    and ce2.parte = 'recibe'
                  where c2.entidad_id = r.entidad_id and c2.estado <> 'substituit'
                  order by case c2.estado when 'vigent' then 0 when 'firmat' then 1
                                          when 'pendent_firma' then 2 else 3 end
                  limit 1))
               order by r.created_at)
        from oferta_respuestas r
        left join entidades e on e.id = r.entidad_id
       where r.excedente_id = ex.id), '[]'::jsonb),

    'canalitzacions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ca.id, 'entidad_id', ca.entidad_id,
               'entitat', e.nombre,
               'kg_confirmados', ca.kg_confirmados, 'kg_reales', ca.kg_reales,
               'kg_conciliados', ca.kg_conciliados,
               'conciliada_at', ca.conciliada_at, 'coste_kg', ca.coste_kg,
               'valorizacion', ca.valorizacion,
               'estado', ca.estado, 'comentarios', ca.comentarios,
               'data_hora_recollida', ca.data_hora_recollida,
               'recollida_registrada_at', ca.recollida_registrada_at,
               'recollida_validada_at', ca.recollida_validada_at,
               'recollida_retornada_at', ca.recollida_retornada_at,
               'kg_declarats', ca.kg_declarats, 'resultat_recollida', ca.resultat_recollida,
               'incidencia', ca.incidencia_recollida is not null,
               'created_at', ca.created_at,
               -- Nuevas (20270608100100): el registro de una venta o maquila sin albarán y la
               -- anulación de la fase 2.
               'preu_acordat_kg', ca.preu_acordat_kg, 'preu_acceptat_at', ca.preu_acceptat_at,
               'caixes_entregades', ca.caixes_entregades,
               'anulada_at', ca.anulada_at, 'motiu_anulacio', ca.motiu_anulacio)
               order by ca.created_at)
        from canalizaciones ca
        left join entidades e on e.id = ca.entidad_id
       where ca.excedente_id = ex.id), '[]'::jsonb),

    'albarans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', al.id, 'tipo', al.tipo, 'estado', al.estado,
               'numero', al.numero_completo, 'canalizacion_id', al.canalizacion_id,
               'emitido_at', al.emitido_at, 'entregado_at', al.entregado_at,
               'confirmado_at', al.confirmado_at, 'conciliado_at', al.conciliado_at,
               'rechazo', al.rechazo,
               'fora_tolerancia', case when al.tipo = 'REC' and al.estado = 'confirmado'
                                       then not coalesce((public.propuesta_conciliacion(al.id)->>'dins_tolerancia')::boolean, true) end)
               order by al.tipo, al.created_at)
        from albaranes al
       where al.excedente_id = ex.id
          or al.canalizacion_id in (select id from canalizaciones where excedente_id = ex.id)
          or (ex.espigolada_id is not null and al.espigolada_id = ex.espigolada_id)),
      '[]'::jsonb),

    'cost_falten', (
      select count(*) from (select distinct ex.producto as prod) x
       where ex.coste_kg is null
         and not exists (select 1 from costes_producto cp where cp.producto = x.prod)),

    'exercici', (
      select jsonb_build_object('id', ce3.id, 'ejercicio', ce3.ejercicio,
                                'modo', ce3.modo, 'estado', ce3.estado)
        from cierres_ejercicio ce3
       where ce3.ejercicio = extract(year from coalesce(ex.created_at, now()))::int
       order by case ce3.modo when 'real' then 0 else 1 end,
                ce3.calculado_at desc nulls last,
                ce3.created_at desc,
                ce3.id
       limit 1)
  ) into res;

  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. `anular_albaran`: el REC de una recogida no se anula suelto
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270606100100). Nuevo: un REC con canalización VIVA → `22023
-- anula_la_canalitzacio` (se anula la asignación, que se lleva su ENT y su REC).
create or replace function public.anular_albaran(p_id uuid, p_motivo text)
returns albaranes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a albaranes%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden anul.lar un albara' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Cal indicar el motiu de l''anul.lacio' using errcode = '22023';
  end if;

  -- Un albarán ya conciliado NO se anula: se rectifica.
  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado in ('anulado', 'rectificado', 'conciliado') then
    raise exception 'Aquest albara no es pot anul.lar (%): si ja esta conciliat, rectifica''l',
      coalesce(a.estado, 'no existeix') using errcode = '22023';
  end if;

  -- 20270608100100: el REC de una recogida va con su asignación.
  if a.tipo = 'REC' and a.canalizacion_id is not null
     and exists (select 1 from canalizaciones c where c.id = a.canalizacion_id and c.estado <> 'anulada') then
    raise exception 'anula_la_canalitzacio: aquest albara de recepcio es d''una recollida; anul.la l''assignacio'
      using errcode = '22023';
  end if;

  if a.tipo in ('ENT', 'OPE') and a.canalizacion_id is not null
     and exists (select 1 from canalizaciones c where c.id = a.canalizacion_id and c.estado <> 'anulada') then
    perform public.anula_canalitzacio(a.canalizacion_id, p_motivo);
    select * into a from albaranes where id = p_id;
    return a;
  end if;

  update albaranes
     set estado = 'anulado', anulado_at = now(), motivo_anulacion = p_motivo
   where id = a.id
  returning * into a;

  update documentos set vigente = false
   where objeto_tipo = 'albaran' and objeto_id = a.id and vigente;

  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'albaran' and objeto_id = a.id and estado = 'activo';

  return a;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. `modificar_assignacio`: también la línea del REC propio en borrador
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270606100100). Cambia el ajuste de líneas: TODOS los albaranes de la
-- canalización en borrador (ENT y, desde 20270608100100, su REC). `albara_emes` ya miraba todos
-- los albaranes con `canalizacion_id` (también el REC propio); se deja escrito.
create or replace function public.modificar_assignacio(
  p_canalizacion uuid,
  p_kg           numeric     default null,
  p_recollida    timestamptz default null
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c      canalizaciones;
  ex     excedentes;
  v_kg   numeric;
  v_quan timestamptz;
  a      record;
  l      jsonb;
  v_n    int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden modificar una assignacio' using errcode = '42501';
  end if;
  if p_kg is null and p_recollida is null then
    raise exception 'cal_canvi: no hi ha res a canviar' using errcode = '22023';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if c.recollida_registrada_at is not null or c.recollida_validada_at is not null
     or c.estado = 'conciliada' then
    raise exception 'ja_registrada: la recollida ja esta registrada; no es pot modificar' using errcode = '22023';
  end if;
  -- Cualquier albarán vivo de la canalización (ENT/OPE y su REC propio) que ya no sea borrador.
  if exists (select 1 from albaranes al
              where al.canalizacion_id = c.id
                and al.estado not in ('borrador', 'anulado', 'rectificado')) then
    raise exception 'albara_emes: l''albara ja s''ha emes; anul.la l''assignacio' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = c.excedente_id;
  if p_kg is not null then
    if p_kg <= 0 then
      raise exception 'Cal indicar els kg a canalitzar' using errcode = '22023';
    end if;
    if ex.kg_total is not null and p_kg > ex.kg_total then
      raise exception 'kg_maxim: com a maxim % kg', ex.kg_total using errcode = '22023';
    end if;
  end if;
  -- La regla del equipo: solo «no pasada».
  if p_recollida is not null and p_recollida < now() - interval '1 hour' then
    raise exception 'hora_passada: la recollida no pot ser en el passat' using errcode = '22023';
  end if;

  v_kg   := coalesce(p_kg, c.kg_confirmados);
  v_quan := coalesce(p_recollida, c.data_hora_recollida);
  if v_kg is not distinct from c.kg_confirmados
     and v_quan is not distinct from c.data_hora_recollida then
    raise exception 'cal_canvi: no hi ha res a canviar' using errcode = '22023';
  end if;

  update canalizaciones
     set kg_confirmados      = v_kg,
         data_hora_recollida = v_quan,
         registre_demanat_at = case when v_quan is distinct from c.data_hora_recollida
                                    then null else registre_demanat_at end
   where id = c.id
  returning * into c;

  -- Las líneas de sus albaranes en borrador: el ENT/OPE y, desde 20270608100100, su REC propio.
  -- (El REC HEREDADO —uno por oferta, sin `canalizacion_id`— lleva los kilos de toda la oferta y
  -- no se toca.)
  if p_kg is not null then
    for a in select al.id from albaranes al
              where al.canalizacion_id = c.id and al.tipo in ('ENT', 'OPE', 'REC')
                and al.estado = 'borrador' loop
      select count(*) into v_n from albaran_lineas where albaran_id = a.id;
      if v_n = 1 then
        update albaran_lineas set kg_previstos = v_kg where albaran_id = a.id;
      elsif v_n > 1 then
        for l in select * from jsonb_array_elements(public.repartir_kg_linies(a.id, v_kg)) loop
          update albaran_lineas set kg_previstos = (l->>'kg')::numeric
           where id = (l->>'linea_id')::uuid;
        end loop;
      end if;
    end loop;
  end if;

  update oferta_respuestas
     set kg_aprovats = v_kg, recollida_at = v_quan
   where canalizacion_id = c.id;

  perform public.recalcula_estat_excedent(c.excedente_id);
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. `anula_canalitzacio`: su REC propio también
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270606100100). La lógica ya cubría el REC propio (filtra por
-- `canalizacion_id` sin mirar el tipo); se recrea para dejar la regla escrita: `ja_validada`
-- cuenta cualquier albarán de la canalización confirmado o conciliado (ENT/OPE o su REC), y se
-- anulan todos los vivos que no lo estén (en la práctica, el ENT y el REC en borrador).
create or replace function public.anula_canalitzacio(p_canalizacion uuid, p_motiu text)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c     canalizaciones;
  ex    excedentes;
  r     oferta_respuestas;
  v_ent text;
  v_mot text := nullif(btrim(coalesce(p_motiu, '')), '');
  v_par jsonb;
  a     record;
begin
  if v_mot is null then
    raise exception 'cal_motiu: cal indicar el motiu de l''anul.lacio' using errcode = '22023';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if c.estado = 'conciliada' or c.recollida_validada_at is not null
     or exists (select 1 from albaranes al
                 where al.canalizacion_id = c.id
                   and al.tipo in ('ENT', 'OPE', 'REC')
                   and al.estado in ('confirmado', 'conciliado')) then
    raise exception 'ja_validada: aquesta recollida ja esta validada; no es pot anul.lar' using errcode = '22023';
  end if;

  -- Sus albaranes vivos (ENT/OPE y su REC propio), como `anular_albaran()`: anulados, sin
  -- documento vigente y sin enlaces de confirmación que sirvan. El REC HEREDADO de la oferta
  -- (sin `canalizacion_id`) no se toca: sirve a las demás canalizaciones.
  for a in select al.id from albaranes al
            where al.canalizacion_id = c.id
              and al.tipo in ('ENT', 'OPE', 'REC')
              and al.estado in ('borrador', 'emitido', 'entregado')
            for update loop
    update albaranes
       set estado = 'anulado', anulado_at = now(), motivo_anulacion = v_mot
     where id = a.id;
    update documentos set vigente = false
     where objeto_tipo = 'albaran' and objeto_id = a.id and vigente;
    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'albaran' and objeto_id = a.id and estado = 'activo';
  end loop;

  perform set_config('redestina.escriu_assignacio', 'on', true);
  update canalizaciones
     set estado = 'anulada', anulada_at = now(), anulada_per = auth.uid(), motiu_anulacio = v_mot
   where id = c.id
  returning * into c;
  perform set_config('redestina.escriu_assignacio', 'off', true);

  select * into r from oferta_respuestas where canalizacion_id = c.id limit 1;
  if r.id is not null then
    perform set_config('redestina.anula_assignacio', 'on', true);
    update oferta_respuestas
       set aprovacio = 'rebutjada',
           motiu_aprovacio = left('anul·lada: ' || v_mot, 1000)
     where id = r.id;
    perform set_config('redestina.anula_assignacio', 'off', true);
  end if;

  select * into ex from excedentes where id = c.excedente_id;
  select e.nombre into v_ent from entidades e where e.id = c.entidad_id;
  v_par := jsonb_build_object(
    'producte', ex.producto, 'kg', c.kg_confirmados, 'motiu', v_mot, 'entitat', v_ent,
    'excedente_id', ex.id);
  perform public.crear_avis('entidad', c.entidad_id, 'assignacio_anulada',
    case when r.id is null then 'canalizacion' else 'oferta_resposta' end,
    coalesce(r.id, c.id), v_par);
  if ex.id is not null then
    perform public.crear_avis('productor', ex.productor_id, 'assignacio_anulada', 'excedente', ex.id, v_par);
    perform public.recalcula_estat_excedent(ex.id);
  end if;

  return c;
end;
$$;
revoke execute on function public.anula_canalitzacio(uuid, text) from public, anon, authenticated;
grant  execute on function public.anula_canalitzacio(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 16. Datos (D): los OPE en borrador se anulan
-- ---------------------------------------------------------------------------
-- Sin número (`albaranes_estado_numero_check`), así que no dejan hueco en la serie; sin
-- documento ni enlaces (nacen al emitir). Las ventas y maquilas siguen `confirmada` y se
-- registran y validan sin albarán (20270608100200). Los OPE ya emitidos no se tocan.
update public.albaranes
   set estado = 'anulado',
       anulado_at = now(),
       motivo_anulacion = 'Venda i maquila sense albara de Redestina (20270608100100)'
 where tipo = 'OPE' and estado = 'borrador' and numero_completo is null;
