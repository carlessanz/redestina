-- Ofertas multiproducto (proceso 3.3; fase 6 del plan de noviembre de 2026), 6 de 7: SOLICITUD
-- del receptor y APROBACIÓN conjunta (entrega 6b).
--
-- 🔴 Ninguna regla se duplica: cada línea pasa por la puerta de siempre, en la misma transacción,
-- y si UNA falla no queda nada (todo o nada). Un solo producto sigue sin solicitud, como hoy.
--
--   · `manifestar_interes_multiple(p_disponibilitat, p_linies, p_recollida_at, p_entidad)` — la
--     entidad (panel): una solicitud + un interés por línea con `manifestar_interes()` (entidad
--     propia, albarán pendiente G1, propuesta pendiente, `comprova_interes()`: entidad activa,
--     oferta publicada/parcial, compatibilidad y P8, convenio, kg ≤ kg_total, precio mínimo de
--     venta, fecha: pasada, fuera de disponibilidad, `dia_fora_dies`, fuera de franja).
--   · `manifestar_interes_multiple_assistit(p_disponibilitat, p_entidad, p_linies, p_recollida_at)`
--     — el equipo en nombre de la entidad (`es_intern()`), por `manifestar_interes_assistit()`.
--   · `assignar_directe_multiple(p_disponibilitat, p_entidad, p_linies, p_recollida_at, p_motiu)` —
--     nivel 1 (`pot_aprovar()`): una solicitud ya resuelta + una asignación aprobada por línea con
--     `assignar_directe()` (venta: precio acordado y aceptado por línea). UN aviso.
--   · `resoldre_sollicitud(p_sollicitud, p_linies, p_recollida_at, p_motiu)` (`pot_aprovar()`):
--     por línea aprueba (`aprova_resposta_intern()`, ajustando kg/modalidad/precio) o rechaza
--     (motivo), con UNA fecha y hora para todas las aprobadas. Tiene que resolver TODAS las líneas
--     pendientes. UN aviso (`sollicitud_resolta`, 20270620100400).
--
-- `p_linies` (jsonb, array no vacío):
--   · manifestar*: `[{excedente_id, kg, modalitat?, preu?, caixes?}]`
--   · assignar_directe_multiple: `[{excedente_id, kg, modalitat?, preu?, preu_acceptat?, caixes?}]`
--   · resoldre_sollicitud: `[{resposta_id, accio: 'aprova'|'rebutja', kg?, modalitat?, preu?,
--     preu_acceptat?, motiu?}]`
--
-- Errores (además de los de las puertas reutilizadas, con su código y mensaje intactos):
--   · `42501`: sin sesión (manifestar_interes_multiple), entidad ajena, no es del equipo; el
--     PERMISO se comprueba ANTES que la existencia.
--   · `22023`: `disponibilitat_inexistent`, `entitat_inexistent`, `sollicitud_inexistent`,
--     `cal_entitat` (la cuenta tiene varias entidades y no dice cuál), `cal_recollida`,
--     `cal_linies`, `linia_invalida`, `linia_fora_disponibilitat`, `linia_fora_sollicitud`,
--     `linia_duplicada`, `linia_ja_resolta`, `accio_invalida`, `falten_linies`,
--     `sollicitud_pendent` (ya hay una pendiente de esa entidad en esa disponibilidad).
--   · Un error de una línea se re-lanza con su mismo SQLSTATE y mensaje y `detail` =
--     `{"linia": n, "excedente_id"|"resposta_id": "…"}` (JSON en texto) para marcarla en el diálogo.
--
-- Cada canalización que nace lleva `sollicitud_id`; cada interés también.

-- ---------------------------------------------------------------------------
-- 0. Internas
-- ---------------------------------------------------------------------------

-- El aviso único de una solicitud resuelta: uno a la entidad (todas las líneas resueltas en esta
-- llamada) y, si hay alguna aprobada, uno al productor (solo las aprobadas).
create or replace function public.avisa_sollicitud_resolta(p_sollicitud uuid, p_respostes uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s        sollicituds_recollida;
  d        disponibilitats;
  v_prod   text;
  v_mun    text;
  v_ent    text;
  v_linies jsonb;
  v_lprod  jsonb;
  v_napr   int;
  v_nreb   int;
  v_quan   timestamptz;
  v_n      int := 0;
begin
  select * into s from sollicituds_recollida where id = p_sollicitud;
  if s.id is null or cardinality(coalesce(p_respostes, '{}')) = 0 then return 0; end if;
  select * into d from disponibilitats where id = s.disponibilitat_id;
  select coalesce(nullif(p.empresa, ''), p.name), p.poblacion into v_prod, v_mun
    from productores p where p.id = d.productor_id;
  select e.nombre into v_ent from entidades e where e.id = s.entidad_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'resposta_id', r.id, 'excedente_id', e.id, 'producte', e.producto,
           'kg_sol', r.kg_solicitados, 'kg_apr', r.kg_aprovats, 'modalitat', r.modalitat,
           'estat', r.aprovacio,
           'motiu', case when r.aprovacio = 'rebutjada' then r.motiu_aprovacio end)
           order by e.producto, e.id), '[]'::jsonb),
         count(*) filter (where r.aprovacio = 'aprovada'),
         count(*) filter (where r.aprovacio = 'rebutjada'),
         max(r.recollida_at) filter (where r.aprovacio = 'aprovada'),
         coalesce(jsonb_agg(jsonb_build_object(
           'excedente_id', e.id, 'ref', e.id_excedente, 'producte', e.producto,
           'kg', r.kg_aprovats, 'modalitat', r.modalitat)
           order by e.producto, e.id) filter (where r.aprovacio = 'aprovada'), '[]'::jsonb),
         -- El municipio del lugar de la primera oferta (como `trg_respostes_avis`), o el de la ficha.
         coalesce(min(u.municipio), v_mun)
    into v_linies, v_napr, v_nreb, v_quan, v_lprod, v_mun
    from oferta_respuestas r
    join excedentes e on e.id = r.excedente_id
    left join productor_ubicaciones u on u.id = e.ubicacion_id
   where r.id = any (p_respostes);

  v_quan := coalesce(v_quan, s.recollida_at);

  if public.crear_avis('entidad', s.entidad_id, 'sollicitud_resolta', 'sollicitud_recollida', s.id,
       jsonb_build_object(
         'sollicitud_id', s.id, 'disponibilitat_id', d.id, 'codi', d.codi,
         'productor', v_prod, 'municipi', v_mun, 'recollida_at', v_quan,
         'n_aprovades', v_napr, 'n_rebutjades', v_nreb, 'linies', v_linies)) is not null then
    v_n := v_n + 1;
  end if;
  if v_napr > 0 and public.crear_avis('productor', d.productor_id, 'sollicitud_resolta',
       'sollicitud_recollida', s.id,
       jsonb_build_object(
         'sollicitud_id', s.id, 'disponibilitat_id', d.id, 'codi', d.codi,
         'entitat', v_ent, 'recollida_at', v_quan, 'n_aprovades', v_napr,
         'linies', v_lprod)) is not null then
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;

revoke execute on function public.avisa_sollicitud_resolta(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.avisa_sollicitud_resolta(uuid, uuid[]) to service_role;

-- Las líneas: array no vacío de objetos.
create or replace function public.comprova_linies_multiple(p_linies jsonb)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_linies is null or jsonb_typeof(p_linies) <> 'array' or jsonb_array_length(p_linies) = 0 then
    raise exception 'cal_linies: tria almenys un producte' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_linies) x where jsonb_typeof(x) <> 'object') then
    raise exception 'linia_invalida' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.comprova_linies_multiple(jsonb) from public, anon, authenticated;
grant execute on function public.comprova_linies_multiple(jsonb) to service_role;

-- Un uuid de una línea (texto mal formado → `linia_invalida`, no un 22P02 suelto).
create or replace function public.uuid_de_linia(p_linia jsonb, p_clau text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  return nullif(btrim(coalesce(p_linia->>p_clau, '')), '')::uuid;
exception when invalid_text_representation then
  raise exception 'linia_invalida: % no es un identificador', p_clau using errcode = '22023';
end;
$$;

revoke execute on function public.uuid_de_linia(jsonb, text) from public, anon, authenticated;
grant execute on function public.uuid_de_linia(jsonb, text) to service_role;

-- El núcleo de las dos solicitudes (entidad y asistida). Sin guarda de rol: la ponen los envoltorios.
create or replace function public.manifestar_interes_multiple_intern(
  p_disponibilitat uuid, p_entidad uuid, p_linies jsonb, p_recollida_at timestamptz,
  p_assistit boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sol    uuid;
  v_item   jsonb;
  v_ord    bigint;
  v_ex     uuid;
  v_vistos uuid[] := '{}';
  r        oferta_respuestas;
  v_res    jsonb := '[]'::jsonb;
  v_state  text;
  v_msg    text;
begin
  if not exists (select 1 from disponibilitats where id = p_disponibilitat) then
    raise exception 'disponibilitat_inexistent' using errcode = '22023';
  end if;
  if not exists (select 1 from entidades where id = p_entidad) then
    raise exception 'entitat_inexistent' using errcode = '22023';
  end if;
  if p_recollida_at is null then
    raise exception 'cal_recollida: tria una data i hora de recollida' using errcode = '22023';
  end if;
  perform public.comprova_linies_multiple(p_linies);
  if exists (select 1 from sollicituds_recollida s
              where s.disponibilitat_id = p_disponibilitat and s.entidad_id = p_entidad
                and s.estat = 'pendent') then
    raise exception 'sollicitud_pendent: ja hi ha una sol.licitud pendent d''aquesta entitat'
      using errcode = '22023';
  end if;

  insert into sollicituds_recollida (disponibilitat_id, entidad_id, recollida_at, canal, created_by)
  values (p_disponibilitat, p_entidad, p_recollida_at,
          case when p_assistit then 'asistido' else 'panel' end, auth.uid())
  returning id into v_sol;

  for v_item, v_ord in select e, o from jsonb_array_elements(p_linies) with ordinality as t(e, o) loop
    v_ex := public.uuid_de_linia(v_item, 'excedente_id');
    if v_ex is null or not exists (select 1 from excedentes x
                                    where x.id = v_ex and x.disponibilitat_id = p_disponibilitat) then
      raise exception 'linia_fora_disponibilitat: aquest producte no es d''aquesta disponibilitat'
        using errcode = '22023',
              detail = jsonb_build_object('linia', v_ord, 'excedente_id', v_ex)::text;
    end if;
    if v_ex = any (v_vistos) then
      raise exception 'linia_duplicada' using errcode = '22023',
        detail = jsonb_build_object('linia', v_ord, 'excedente_id', v_ex)::text;
    end if;
    v_vistos := v_vistos || v_ex;

    begin
      if p_assistit then
        r := public.manifestar_interes_assistit(
               v_ex, p_entidad, nullif(v_item->>'kg', '')::numeric,
               nullif(v_item->>'preu', '')::numeric, nullif(v_item->>'caixes', '')::integer,
               nullif(v_item->>'modalitat', ''), p_recollida_at);
      else
        r := public.manifestar_interes(
               v_ex, p_entidad, nullif(v_item->>'kg', '')::numeric,
               nullif(v_item->>'preu', '')::numeric, nullif(v_item->>'caixes', '')::integer,
               nullif(v_item->>'modalitat', ''), p_recollida_at);
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      raise exception using errcode = v_state, message = v_msg,
        detail = jsonb_build_object('linia', v_ord, 'excedente_id', v_ex)::text;
    end;

    perform set_config('redestina.escriu_grup', 'on', true);
    update oferta_respuestas set sollicitud_id = v_sol where id = r.id;
    perform set_config('redestina.escriu_grup', 'off', true);

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'resposta_id', r.id, 'excedente_id', v_ex, 'kg', r.kg_solicitados, 'modalitat', r.modalitat));
  end loop;

  return jsonb_build_object(
    'sollicitud_id', v_sol, 'disponibilitat_id', p_disponibilitat, 'entidad_id', p_entidad,
    'recollida_at', p_recollida_at,
    'estat', (select s.estat from sollicituds_recollida s where s.id = v_sol),
    'linies', v_res);
end;
$$;

revoke execute on function public.manifestar_interes_multiple_intern(uuid, uuid, jsonb, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.manifestar_interes_multiple_intern(uuid, uuid, jsonb, timestamptz, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 1. `manifestar_interes_multiple` — la entidad, desde el Mercat
-- ---------------------------------------------------------------------------
create or replace function public.manifestar_interes_multiple(
  p_disponibilitat uuid,
  p_linies         jsonb,
  p_recollida_at   timestamptz,
  p_entidad        uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ent  uuid := p_entidad;
  v_n    int;
begin
  if auth.uid() is null then
    raise exception 'Cal una sessio' using errcode = '42501';
  end if;
  if v_ent is null then
    select count(*), min(x::text)::uuid into v_n, v_ent from public.mis_entidades() x;
    if v_n = 0 then
      raise exception 'No pertanys a cap entitat' using errcode = '42501';
    elsif v_n > 1 then
      raise exception 'cal_entitat: tria amb quina entitat demanes' using errcode = '22023';
    end if;
  end if;
  if v_ent not in (select public.mis_entidades()) then
    raise exception 'No pertanys a aquesta entitat' using errcode = '42501';
  end if;
  return public.manifestar_interes_multiple_intern(p_disponibilitat, v_ent, p_linies, p_recollida_at, false);
end;
$$;

revoke execute on function public.manifestar_interes_multiple(uuid, jsonb, timestamptz, uuid) from public, anon;
grant execute on function public.manifestar_interes_multiple(uuid, jsonb, timestamptz, uuid) to authenticated, service_role;

comment on function public.manifestar_interes_multiple(uuid, jsonb, timestamptz, uuid) is
  'Fase 6b (3.3, 20270620100500): la entidad pide varios productos de una disponibilidad con una '
  'fecha de recogida. Una solicitud + un interés por línea (manifestar_interes), todo o nada. '
  'p_linies = [{excedente_id, kg, modalitat?, preu?, caixes?}].';

-- ---------------------------------------------------------------------------
-- 2. `manifestar_interes_multiple_assistit` — el equipo en nombre de la entidad
-- ---------------------------------------------------------------------------
create or replace function public.manifestar_interes_multiple_assistit(
  p_disponibilitat uuid,
  p_entidad        uuid,
  p_linies         jsonb,
  p_recollida_at   timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot registrar un interes assistit' using errcode = '42501';
  end if;
  return public.manifestar_interes_multiple_intern(p_disponibilitat, p_entidad, p_linies, p_recollida_at, true);
end;
$$;

revoke execute on function public.manifestar_interes_multiple_assistit(uuid, uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.manifestar_interes_multiple_assistit(uuid, uuid, jsonb, timestamptz) to authenticated, service_role;

comment on function public.manifestar_interes_multiple_assistit(uuid, uuid, jsonb, timestamptz) is
  'Fase 6b (3.3, 20270620100500): el equipo registra una solicitud multiproducto en nombre de la '
  'entidad (manifestar_interes_assistit por línea), todo o nada.';

-- ---------------------------------------------------------------------------
-- 3. `assignar_directe_multiple` — nivel 1
-- ---------------------------------------------------------------------------
create or replace function public.assignar_directe_multiple(
  p_disponibilitat uuid,
  p_entidad        uuid,
  p_linies         jsonb,
  p_recollida_at   timestamptz default null,
  p_motiu          text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sol    uuid;
  v_item   jsonb;
  v_ord    bigint;
  v_ex     uuid;
  v_vistos uuid[] := '{}';
  v_resp   uuid[] := '{}';
  c        canalizaciones;
  v_rid    uuid;
  v_res    jsonb := '[]'::jsonb;
  v_state  text;
  v_msg    text;
  v_avisos int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden assignar directament' using errcode = '42501';
  end if;
  if not exists (select 1 from disponibilitats where id = p_disponibilitat) then
    raise exception 'disponibilitat_inexistent' using errcode = '22023';
  end if;
  if not exists (select 1 from entidades where id = p_entidad) then
    raise exception 'entitat_inexistent' using errcode = '22023';
  end if;
  perform public.comprova_linies_multiple(p_linies);
  if exists (select 1 from sollicituds_recollida s
              where s.disponibilitat_id = p_disponibilitat and s.entidad_id = p_entidad
                and s.estat = 'pendent') then
    raise exception 'sollicitud_pendent: resol primer la sol.licitud pendent d''aquesta entitat'
      using errcode = '22023';
  end if;

  insert into sollicituds_recollida (disponibilitat_id, entidad_id, recollida_at, canal, created_by)
  values (p_disponibilitat, p_entidad, p_recollida_at, 'asistido', auth.uid())
  returning id into v_sol;

  perform set_config('redestina.agrupa_sollicitud', 'on', true);

  for v_item, v_ord in select e, o from jsonb_array_elements(p_linies) with ordinality as t(e, o) loop
    v_ex := public.uuid_de_linia(v_item, 'excedente_id');
    if v_ex is null or not exists (select 1 from excedentes x
                                    where x.id = v_ex and x.disponibilitat_id = p_disponibilitat) then
      raise exception 'linia_fora_disponibilitat: aquest producte no es d''aquesta disponibilitat'
        using errcode = '22023',
              detail = jsonb_build_object('linia', v_ord, 'excedente_id', v_ex)::text;
    end if;
    if v_ex = any (v_vistos) then
      raise exception 'linia_duplicada' using errcode = '22023',
        detail = jsonb_build_object('linia', v_ord, 'excedente_id', v_ex)::text;
    end if;
    v_vistos := v_vistos || v_ex;

    begin
      c := public.assignar_directe(
             v_ex, p_entidad, nullif(v_item->>'kg', '')::numeric, nullif(v_item->>'modalitat', ''),
             p_recollida_at, nullif(v_item->>'caixes', '')::integer,
             nullif(v_item->>'preu', '')::numeric,
             coalesce(nullif(v_item->>'preu_acceptat', '')::boolean, false), p_motiu);
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      raise exception using errcode = v_state, message = v_msg,
        detail = jsonb_build_object('linia', v_ord, 'excedente_id', v_ex)::text;
    end;

    perform set_config('redestina.escriu_grup', 'on', true);
    update oferta_respuestas set sollicitud_id = v_sol where canalizacion_id = c.id
    returning id into v_rid;
    update canalizaciones set sollicitud_id = v_sol where id = c.id;
    perform set_config('redestina.escriu_grup', 'off', true);

    v_resp := v_resp || v_rid;
    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'resposta_id', v_rid, 'canalizacion_id', c.id, 'excedente_id', v_ex,
      'kg', c.kg_confirmados, 'modalitat', c.valorizacion));
  end loop;

  perform set_config('redestina.agrupa_sollicitud', 'off', true);
  v_avisos := public.avisa_sollicitud_resolta(v_sol, v_resp);

  return jsonb_build_object(
    'sollicitud_id', v_sol, 'disponibilitat_id', p_disponibilitat, 'entidad_id', p_entidad,
    'recollida_at', p_recollida_at,
    'estat', (select s.estat from sollicituds_recollida s where s.id = v_sol),
    'avisos', v_avisos, 'linies', v_res);
end;
$$;

revoke execute on function public.assignar_directe_multiple(uuid, uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.assignar_directe_multiple(uuid, uuid, jsonb, timestamptz, text) to authenticated, service_role;

comment on function public.assignar_directe_multiple(uuid, uuid, jsonb, timestamptz, text) is
  'Fase 6b (3.3, 20270620100500): nivel 1 (pot_aprovar). Una solicitud resuelta + una asignación '
  'aprobada por línea (assignar_directe), todo o nada, con un solo aviso sollicitud_resolta. '
  'p_linies = [{excedente_id, kg, modalitat?, preu?, preu_acceptat?, caixes?}].';

-- ---------------------------------------------------------------------------
-- 4. `resoldre_sollicitud` — aprobar y rechazar por línea, en un acto
-- ---------------------------------------------------------------------------
create or replace function public.resoldre_sollicitud(
  p_sollicitud   uuid,
  p_linies       jsonb,
  p_recollida_at timestamptz default null,
  p_motiu        text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s        sollicituds_recollida;
  v_item   jsonb;
  v_ord    bigint;
  v_rid    uuid;
  v_acc    text;
  v_vistos uuid[] := '{}';
  r        oferta_respuestas;
  c        canalizaciones;
  v_apr    jsonb := '[]'::jsonb;
  v_reb    jsonb := '[]'::jsonb;
  v_state  text;
  v_msg    text;
  v_mot    text;
  v_avisos int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden aprovar' using errcode = '42501';
  end if;
  select * into s from sollicituds_recollida where id = p_sollicitud for update;
  if s.id is null then
    raise exception 'sollicitud_inexistent' using errcode = '22023';
  end if;
  perform public.comprova_linies_multiple(p_linies);

  -- Validación de las líneas antes de escribir nada.
  for v_item, v_ord in select e, o from jsonb_array_elements(p_linies) with ordinality as t(e, o) loop
    v_rid := public.uuid_de_linia(v_item, 'resposta_id');
    select * into r from oferta_respuestas where id = v_rid;
    if r.id is null or r.sollicitud_id is distinct from p_sollicitud then
      raise exception 'linia_fora_sollicitud' using errcode = '22023',
        detail = jsonb_build_object('linia', v_ord, 'resposta_id', v_rid)::text;
    end if;
    if r.aprovacio <> 'pendent' then
      raise exception 'linia_ja_resolta' using errcode = '22023',
        detail = jsonb_build_object('linia', v_ord, 'resposta_id', v_rid)::text;
    end if;
    if v_rid = any (v_vistos) then
      raise exception 'linia_duplicada' using errcode = '22023',
        detail = jsonb_build_object('linia', v_ord, 'resposta_id', v_rid)::text;
    end if;
    v_vistos := v_vistos || v_rid;
    if coalesce(v_item->>'accio', '') not in ('aprova', 'rebutja') then
      raise exception 'accio_invalida: aprova o rebutja' using errcode = '22023',
        detail = jsonb_build_object('linia', v_ord, 'resposta_id', v_rid)::text;
    end if;
  end loop;

  -- Todas las pendientes, de una vez: un solo aviso por solicitud.
  if exists (select 1 from oferta_respuestas x
              where x.sollicitud_id = p_sollicitud and x.aprovacio = 'pendent'
                and not (x.id = any (v_vistos))) then
    raise exception 'falten_linies: cal resoldre tots els productes pendents de la sol.licitud'
      using errcode = '22023';
  end if;

  perform set_config('redestina.agrupa_sollicitud', 'on', true);

  for v_item, v_ord in select e, o from jsonb_array_elements(p_linies) with ordinality as t(e, o) loop
    v_rid := (v_item->>'resposta_id')::uuid;
    v_acc := v_item->>'accio';
    v_mot := coalesce(nullif(btrim(coalesce(v_item->>'motiu', '')), ''),
                      nullif(btrim(coalesce(p_motiu, '')), ''));
    begin
      if v_acc = 'aprova' then
        -- La fecha común: la del equipo manda (`aprova_resposta_intern` solo exige que no sea
        -- pasada); sin ella, la que pidió la entidad (la misma en todas las líneas).
        c := public.aprova_resposta_intern(
               v_rid, nullif(v_item->>'kg', '')::numeric, nullif(v_item->>'preu', '')::numeric,
               v_mot, nullif(v_item->>'modalitat', ''), p_recollida_at,
               nullif(v_item->>'preu_acceptat', '')::boolean, false);
        perform set_config('redestina.escriu_grup', 'on', true);
        update canalizaciones set sollicitud_id = p_sollicitud where id = c.id;
        perform set_config('redestina.escriu_grup', 'off', true);
        v_apr := v_apr || jsonb_build_array(jsonb_build_object(
          'resposta_id', v_rid, 'canalizacion_id', c.id, 'excedente_id', c.excedente_id,
          'kg', c.kg_confirmados, 'modalitat', c.valorizacion));
      else
        update oferta_respuestas
           set aprovacio       = 'rebutjada',
               motiu_aprovacio = left(v_mot, 1000),
               aprovat_at      = now(),
               aprovat_per     = auth.uid()
         where id = v_rid and aprovacio = 'pendent'
        returning * into r;
        v_reb := v_reb || jsonb_build_array(jsonb_build_object(
          'resposta_id', v_rid, 'excedente_id', r.excedente_id));
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      raise exception using errcode = v_state, message = v_msg,
        detail = jsonb_build_object('linia', v_ord, 'resposta_id', v_rid)::text;
    end;
  end loop;

  if p_recollida_at is not null and jsonb_array_length(v_apr) > 0 then
    update sollicituds_recollida set recollida_at = p_recollida_at where id = p_sollicitud;
  end if;

  perform set_config('redestina.agrupa_sollicitud', 'off', true);
  v_avisos := public.avisa_sollicitud_resolta(p_sollicitud, v_vistos);

  select * into s from sollicituds_recollida where id = p_sollicitud;
  return jsonb_build_object(
    'sollicitud_id', s.id, 'estat', s.estat, 'recollida_at', s.recollida_at,
    'avisos', v_avisos, 'aprovades', v_apr, 'rebutjades', v_reb);
end;
$$;

revoke execute on function public.resoldre_sollicitud(uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.resoldre_sollicitud(uuid, jsonb, timestamptz, text) to authenticated, service_role;

comment on function public.resoldre_sollicitud(uuid, jsonb, timestamptz, text) is
  'Fase 6b (3.3, 20270620100500): pot_aprovar. Resuelve TODAS las líneas pendientes de una solicitud '
  'en un acto (aprova_resposta_intern o rechazo con motivo), una fecha común para las aprobadas, '
  'canalizaciones con sollicitud_id y un solo aviso sollicitud_resolta. '
  'p_linies = [{resposta_id, accio: aprova|rebutja, kg?, modalitat?, preu?, preu_acceptat?, motiu?}].';
