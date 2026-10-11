-- Fase 9 de la revisión del 08-10-2026: «Diagnòstic operatiu» (ficha viva) y fin del
-- diagnóstico del receptor.
--
-- Lo que pidió la Fundació (§6 y §3 del documento):
--   · El diagnóstico NO genera un plan. Es una ficha operativa viva del ofertante —qué
--     productos trabaja, cuándo y cuánto excedente— para canalizar mejor. El Pla de
--     Prevenció es otro servicio (fase 11) y su generación queda SOLO para el equipo.
--   · El receptor no tiene diagnóstico: tiene «El meu perfil de recepció» (preferencias de
--     la fase 7). Su cuestionario se retira y sus planes pasan a `substituit`.
--
-- Qué cambia:
--   1. Cuatro tipos de pregunta nuevos: `productes` (catálogo filtrado por familias, o
--      subconjunto de otra pregunta, con máximo), `per_producte_num` (número por producto),
--      `mesos` (meses por producto) y `ubicacio` (lugares de recogida de la propia ficha).
--   2. `avaluar_regla('buit')` cuenta además el objeto vacío como «sin contestar»: las
--      respuestas por producto son objetos.
--   3. `desar_diagnostic()` ya no llama a `generar_pla_des_de_diagnostic()`, guarda cada
--      versión en `diagnostics_historial` y deriva en la ficha del productor
--      `productos_habituales` y `temporada`.
--   4. `generar_pla_des_de_diagnostic()` y `emitir_plan_basico()` pasan a ser del equipo.
--   5. `diagnostic_estat()` y `diagnostics_equip()` ganan el estado `complet` (contestado,
--      sin plan) y la bandeja del equipo solo lista productores.
--   6. Versión 2 del cuestionario del productor, «Diagnòstic operatiu» (provisional).

-- ---------------------------------------------------------------------------
-- 1. «Sin contestar» también es un objeto vacío
-- ---------------------------------------------------------------------------
create or replace function public.avaluar_regla(p_operador text, p_valor jsonb, p_resposta jsonb)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tipus text;
begin
  if p_operador = 'sempre' then
    return true;
  end if;

  v_tipus := jsonb_typeof(p_resposta);

  -- «Sin contestar» incluye el null de SQL, el null de JSON, la cadena vacía, el array
  -- vacío y —desde la fase 9— el objeto vacío (las respuestas por producto son objetos).
  if p_operador = 'buit' then
    return p_resposta is null
        or v_tipus = 'null'
        or (v_tipus = 'string' and btrim(p_resposta #>> '{}') = '')
        or (v_tipus = 'array'  and jsonb_array_length(p_resposta) = 0)
        or (v_tipus = 'object' and p_resposta = '{}'::jsonb);
  end if;

  if p_resposta is null or v_tipus = 'null' then
    return false;
  end if;

  if p_operador = '=' then
    return p_resposta = p_valor;
  elsif p_operador = '!=' then
    return p_resposta <> p_valor;
  elsif p_operador = 'in' then
    if jsonb_typeof(p_valor) <> 'array' then
      return false;
    end if;
    return exists (select 1 from jsonb_array_elements(p_valor) e where e = p_resposta);
  elsif p_operador = 'conte' then
    if v_tipus <> 'array' then
      return false;
    end if;
    return exists (select 1 from jsonb_array_elements(p_resposta) e where e = p_valor);
  elsif p_operador in ('>=', '<=') then
    if v_tipus <> 'number' or jsonb_typeof(p_valor) <> 'number' then
      return false;
    end if;
    if p_operador = '>=' then
      return (p_resposta #>> '{}')::numeric >= (p_valor #>> '{}')::numeric;
    end if;
    return (p_resposta #>> '{}')::numeric <= (p_valor #>> '{}')::numeric;
  end if;

  return false;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. El validador del cuestionario conoce los tipos nuevos
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.questionari_problemes(p_preguntes jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_problemes text[] := '{}';
  v_ids       text[] := '{}';
  q           jsonb;
  o           jsonb;
  v_id        text;
  v_tipus     text;
  v_i         int := 0;
begin
  if p_preguntes is null or jsonb_typeof(p_preguntes) <> 'array' then
    return array['Les preguntes han de ser un array JSON'];
  end if;
  if jsonb_array_length(p_preguntes) = 0 then
    return array['Un questionari sense cap pregunta no es un questionari'];
  end if;

  for q in select * from jsonb_array_elements(p_preguntes) loop
    v_i := v_i + 1;

    if jsonb_typeof(q) <> 'object' then
      v_problemes := v_problemes || format('Pregunta %s: ha de ser un objecte', v_i);
      continue;
    end if;

    v_id := q ->> 'id';
    -- El id viaja a `regles_pla.pregunta_id` y a la clave del objeto de respuestas, así
    -- que se restringe a lo que no puede dar sorpresas en ninguno de los dos sitios.
    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{1,40}$' then
      v_problemes := v_problemes || format(
        'Pregunta %s: l''id ha de ser minuscules, xifres i guions baixos (te %s)',
        v_i, coalesce(v_id, 'cap'));
    elsif v_id = any (v_ids) then
      v_problemes := v_problemes || format('Pregunta %s: l''id "%s" esta repetit', v_i, v_id);
    else
      v_ids := v_ids || v_id;
    end if;

    v_tipus := q ->> 'tipus';
    if v_tipus is null or v_tipus not in ('opcio', 'multi', 'boolea', 'numero', 'text',
                                          'productes', 'per_producte_num', 'mesos', 'ubicacio') then
      v_problemes := v_problemes || format(
        'Pregunta %s: tipus desconegut "%s" (opcio|multi|boolea|numero|text|productes|per_producte_num|mesos|ubicacio)',
        coalesce(v_id, v_i::text), coalesce(v_tipus, 'cap'));
    end if;

    if q ->> 'seccio' is null then
      v_problemes := v_problemes || format('Pregunta %s: falta la seccio', coalesce(v_id, v_i::text));
    end if;

    -- ⚠️ LAS DOS LENGUAS SON OBLIGATORIAS, y no es celo: la interfaz es bilingüe y el
    --    plan se emite en el idioma de la organización. Una etiqueta que solo existe en
    --    catalán produce un PDF en castellano con una frase en catalán dentro, y eso no
    --    se ve hasta que alguien lee el documento emitido.
    if jsonb_typeof(q -> 'etiqueta') <> 'object'
       or jsonb_typeof(q -> 'etiqueta' -> 'ca') <> 'string'
       or jsonb_typeof(q -> 'etiqueta' -> 'es') <> 'string' then
      v_problemes := v_problemes || format(
        'Pregunta %s: etiqueta ha de portar {ca, es}', coalesce(v_id, v_i::text));
    end if;

    if q ? 'ajuda' and q -> 'ajuda' <> 'null'::jsonb then
      if jsonb_typeof(q -> 'ajuda') <> 'object'
         or jsonb_typeof(q -> 'ajuda' -> 'ca') <> 'string'
         or jsonb_typeof(q -> 'ajuda' -> 'es') <> 'string' then
        v_problemes := v_problemes || format(
          'Pregunta %s: ajuda ha de portar {ca, es}', coalesce(v_id, v_i::text));
      end if;
    end if;

    if jsonb_typeof(q -> 'obligatoria') <> 'boolean' then
      v_problemes := v_problemes || format(
        'Pregunta %s: obligatoria ha de ser true o false', coalesce(v_id, v_i::text));
    end if;

    -- Las opciones solo tienen sentido —y son imprescindibles— en `opcio` y `multi`.
    if v_tipus in ('opcio', 'multi') then
      if jsonb_typeof(q -> 'opcions') <> 'array' or jsonb_array_length(coalesce(q -> 'opcions', '[]'::jsonb)) = 0 then
        v_problemes := v_problemes || format(
          'Pregunta %s: un %s necessita opcions', coalesce(v_id, v_i::text), v_tipus);
      else
        for o in select * from jsonb_array_elements(q -> 'opcions') loop
          if jsonb_typeof(o) <> 'object' or o ->> 'valor' is null
             or jsonb_typeof(o -> 'etiqueta') <> 'object'
             or jsonb_typeof(o -> 'etiqueta' -> 'ca') <> 'string'
             or jsonb_typeof(o -> 'etiqueta' -> 'es') <> 'string' then
            v_problemes := v_problemes || format(
              'Pregunta %s: cada opcio ha de ser {valor, etiqueta:{ca,es}}', coalesce(v_id, v_i::text));
            exit;
          end if;
        end loop;
      end if;
    elsif q ? 'opcions' and q -> 'opcions' <> 'null'::jsonb then
      v_problemes := v_problemes || format(
        'Pregunta %s: un %s no pot portar opcions', coalesce(v_id, v_i::text), coalesce(v_tipus, '?'));
    end if;

    -- Los tipos de la ficha viva (fase 9, 11-10-2026). Sus referencias a otra pregunta se
    -- comprueban en la segunda pasada, igual que `aplica_a`.
    if v_tipus = 'per_producte_num' and q ->> 'productes_de' is null then
      v_problemes := v_problemes || format(
        'Pregunta %s: un per_producte_num necessita productes_de', coalesce(v_id, v_i::text));
    end if;
    if q ? 'max' and q -> 'max' <> 'null'::jsonb
       and (jsonb_typeof(q -> 'max') <> 'number' or (q ->> 'max')::numeric < 1
            or (q ->> 'max')::numeric > 50 or (q ->> 'max')::numeric <> trunc((q ->> 'max')::numeric)) then
      v_problemes := v_problemes || format(
        'Pregunta %s: max ha de ser un enter entre 1 i 50', coalesce(v_id, v_i::text));
    end if;
    if q ? 'unitat' and q -> 'unitat' <> 'null'::jsonb
       and (jsonb_typeof(q -> 'unitat') <> 'object'
            or jsonb_typeof(q -> 'unitat' -> 'ca') <> 'string'
            or jsonb_typeof(q -> 'unitat' -> 'es') <> 'string') then
      v_problemes := v_problemes || format(
        'Pregunta %s: unitat ha de portar {ca, es}', coalesce(v_id, v_i::text));
    end if;

    -- Pregunta condicional. El operador es el mismo vocabulario que `regles_pla`
    -- (20270405100100) a propósito: una condición es una condición, y tener dos
    -- gramáticas para lo mismo garantiza que un día se comporten distinto.
    if q ? 'aplica_a' and q -> 'aplica_a' <> 'null'::jsonb then
      if jsonb_typeof(q -> 'aplica_a') <> 'object'
         or q -> 'aplica_a' ->> 'pregunta' is null
         or coalesce(q -> 'aplica_a' ->> 'operador', '=') not in
            ('=', '!=', 'in', 'conte', '>=', '<=', 'buit') then
        v_problemes := v_problemes || format(
          'Pregunta %s: aplica_a ha de ser {pregunta, operador, valor}', coalesce(v_id, v_i::text));
      end if;
    end if;

    if q ? 'prefill' and q -> 'prefill' <> 'null'::jsonb
       and jsonb_typeof(q -> 'prefill') <> 'string' then
      v_problemes := v_problemes || format(
        'Pregunta %s: prefill ha de ser un text "taula.columna"', coalesce(v_id, v_i::text));
    end if;
  end loop;

  -- Segunda pasada: que la pregunta de la que depende otra exista de verdad. No se puede
  -- hacer en la primera porque `aplica_a` puede apuntar hacia atrás o hacia delante.
  for q in select * from jsonb_array_elements(p_preguntes) loop
    if jsonb_typeof(q) = 'object' and q ? 'aplica_a' and q -> 'aplica_a' <> 'null'::jsonb
       and (q -> 'aplica_a' ->> 'pregunta') is not null
       and not ((q -> 'aplica_a' ->> 'pregunta') = any (v_ids)) then
      v_problemes := v_problemes || format(
        'Pregunta %s: depen de "%s", que no existeix en aquest questionari',
        coalesce(q ->> 'id', '?'), q -> 'aplica_a' ->> 'pregunta');
    end if;
  end loop;

  -- Y las referencias de los tipos nuevos: `familia_de`, `opcions_de` y `productes_de`
  -- apuntan a otra pregunta del mismo cuestionario.
  for q in select * from jsonb_array_elements(p_preguntes) loop
    if jsonb_typeof(q) = 'object' then
      for v_id in select k from unnest(array['familia_de', 'opcions_de', 'productes_de']) k loop
        if q ->> v_id is not null and not ((q ->> v_id) = any (v_ids)) then
          v_problemes := v_problemes || format(
            'Pregunta %s: %s apunta a "%s", que no existeix en aquest questionari',
            coalesce(q ->> 'id', '?'), v_id, q ->> v_id);
        end if;
      end loop;
    end if;
  end loop;

  return v_problemes;
end;
$function$;

-- Los nombres cortos de los meses, para lo que se imprime. 1..12; lo demás se ignora.
create or replace function public.noms_mesos(p_mesos jsonb, p_lang text)
 returns text
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(string_agg(
           (case when p_lang = 'es'
                 then array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
                 else array['gen','feb','mar','abr','mai','jun','jul','ago','set','oct','nov','des'] end)[m],
           ', ' order by m), '')
    from (select distinct (e #>> '{}')::int as m
            from jsonb_array_elements(case when jsonb_typeof(p_mesos) = 'array' then p_mesos else '[]'::jsonb end) e
           where jsonb_typeof(e) = 'number' and (e #>> '{}')::numeric between 1 and 12) s;
$function$;
revoke execute on function public.noms_mesos(jsonb, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Lo que se imprime de cada respuesta, también de los tipos nuevos
-- ---------------------------------------------------------------------------
create or replace function public.compondre_respostes(p_preguntes jsonb, p_respostes jsonb)
 returns jsonb
 language plpgsql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out jsonb := '[]'::jsonb;
  q     jsonb;
  o     jsonb;
  v     jsonb;
  v_el  jsonb;
  v_etq jsonb;
  v_ca  text;
  v_es  text;
begin
  for q in select * from jsonb_array_elements(coalesce(p_preguntes, '[]'::jsonb)) loop
    if not public.pregunta_aplica(q, p_respostes) then
      continue;
    end if;
    v := coalesce(p_respostes, '{}'::jsonb) -> (q ->> 'id');
    if public.avaluar_regla('buit', null::jsonb, v) then
      continue;
    end if;

    v_el := jsonb_build_object(
      'id',       q ->> 'id',
      'tipus',    q ->> 'tipus',
      'seccio',   q ->> 'seccio',
      'pregunta', q -> 'etiqueta',
      'valor',    v);

    if q ->> 'tipus' = 'opcio' then
      select o2 -> 'etiqueta' into v_etq
        from jsonb_array_elements(coalesce(q -> 'opcions', '[]'::jsonb)) o2
       where to_jsonb(o2 ->> 'valor') = v
       limit 1;
      v_el := v_el || jsonb_build_object('etiqueta', v_etq);

    elsif q ->> 'tipus' = 'multi' then
      v_etq := '[]'::jsonb;
      for o in select * from jsonb_array_elements(coalesce(q -> 'opcions', '[]'::jsonb)) loop
        if jsonb_typeof(v) = 'array'
           and exists (select 1 from jsonb_array_elements(v) e where e = to_jsonb(o ->> 'valor')) then
          v_etq := v_etq || jsonb_build_array(o -> 'etiqueta');
        end if;
      end loop;
      v_el := v_el || jsonb_build_object('etiquetes', v_etq);

    elsif q ->> 'tipus' = 'boolea' then
      v_el := v_el || jsonb_build_object('etiqueta',
        case when v = 'true'::jsonb
             then '{"ca":"Sí","es":"Sí"}'::jsonb
             else '{"ca":"No","es":"No"}'::jsonb end);

    elsif q ->> 'tipus' = 'productes' and jsonb_typeof(v) = 'array' then
      -- Los nombres del catálogo no se traducen (§6bis): el mismo nombre en las dos lenguas.
      select coalesce(jsonb_agg(jsonb_build_object('ca', e #>> '{}', 'es', e #>> '{}')), '[]'::jsonb)
        into v_etq from jsonb_array_elements(v) e;
      v_el := v_el || jsonb_build_object('etiquetes', v_etq);

    elsif q ->> 'tipus' = 'per_producte_num' and jsonb_typeof(v) = 'object' then
      select string_agg(k || ': ' || (v ->> k) || coalesce(' ' || (q -> 'unitat' ->> 'ca'), ''), ' · ' order by k),
             string_agg(k || ': ' || (v ->> k) || coalesce(' ' || (q -> 'unitat' ->> 'es'), ''), ' · ' order by k)
        into v_ca, v_es
        from jsonb_object_keys(v) k
       where jsonb_typeof(v -> k) = 'number';
      v_el := v_el || jsonb_build_object('etiqueta', jsonb_build_object('ca', coalesce(v_ca, ''), 'es', coalesce(v_es, '')));

    elsif q ->> 'tipus' = 'mesos' then
      if jsonb_typeof(v) = 'object' then
        select string_agg(k || ': ' || public.noms_mesos(v -> k, 'ca'), ' · ' order by k),
               string_agg(k || ': ' || public.noms_mesos(v -> k, 'es'), ' · ' order by k)
          into v_ca, v_es
          from jsonb_object_keys(v) k;
      else
        v_ca := public.noms_mesos(v, 'ca');
        v_es := public.noms_mesos(v, 'es');
      end if;
      v_el := v_el || jsonb_build_object('etiqueta', jsonb_build_object('ca', coalesce(v_ca, ''), 'es', coalesce(v_es, '')));
    end if;
    -- `ubicacio`: sus etiquetas (el alias de cada lugar) las pone `desar_diagnostic()`, que
    -- es quien sabe de qué organización son. Esta función es pura.

    v_out := v_out || jsonb_build_array(v_el);
  end loop;

  return v_out;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. El historial de la ficha viva y lo que se deriva a la ficha del productor
-- ---------------------------------------------------------------------------
create table public.diagnostics_historial (
  id               uuid primary key default gen_random_uuid(),
  tipo_org         text not null check (tipo_org in ('productor', 'entidad')),
  productor_id     uuid references public.productores(id) on delete cascade,
  entidad_id       uuid references public.entidades(id) on delete cascade,
  questionari_id   uuid references public.questionaris_diagnostic(id) on delete restrict,
  versio_questionari int,
  respostes        jsonb not null,
  complet          boolean not null,
  falten           text[] not null default '{}',
  notes            text,
  desat_per        uuid references auth.users(id) on delete set null,
  desat_at         timestamptz not null default now(),
  constraint diagnostics_historial_fk_excloent check (
    (tipo_org = 'productor' and productor_id is not null and entidad_id is null)
    or (tipo_org = 'entidad' and entidad_id is not null and productor_id is null))
);
create index diagnostics_historial_org_idx
  on public.diagnostics_historial (coalesce(productor_id, entidad_id), desat_at desc);

alter table public.diagnostics_historial enable row level security;
revoke all on public.diagnostics_historial from anon, authenticated;
grant select on public.diagnostics_historial to authenticated;
grant all on public.diagnostics_historial to service_role;
create policy "diagnostics_historial: equip o propi" on public.diagnostics_historial
  for select to authenticated
  using ((select public.es_intern())
         or productor_id in (select public.mis_productores())
         or entidad_id in (select public.mis_entidades()));

-- La temporada por producto, derivada del diagnóstico: {producte: [mesos]}. La lee el
-- equipo para anticiparse («sol tenir tomàquet de juny a setembre»).
alter table public.productores add column if not exists temporada jsonb;

-- ---------------------------------------------------------------------------
-- 5. Guardar el diagnóstico: sin plan, con historial y con lo derivado
-- ---------------------------------------------------------------------------
create or replace function public.desar_diagnostic(p_tipo_org text, p_org uuid, p_respostes jsonb,
  p_notes text default null::text, p_idioma text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q        questionaris_diagnostic%rowtype;
  pl       planes_prevencion%rowtype;
  pr       jsonb;
  v_sobre  jsonb;
  v_resp   jsonb;
  v_falten text[];
  v_val    jsonb;
  v_etq    jsonb;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(p_tipo_org, p_org) then
    raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
  end if;
  if p_respostes is null or jsonb_typeof(p_respostes) <> 'object' then
    raise exception 'Les respostes han de ser un objecte {pregunta_id: valor}' using errcode = '22023';
  end if;
  if p_idioma is not null and p_idioma not in ('ca', 'es') then
    raise exception 'Idioma desconegut: %', p_idioma using errcode = '22023';
  end if;

  select * into q from questionaris_diagnostic
   where tipo_org = p_tipo_org and vigente limit 1;
  if q.id is null then
    raise exception 'sense_questionari: no hi ha cap questionari vigent per a % ', p_tipo_org
      using errcode = '22023';
  end if;

  -- Lo que la base comprueba de los tipos nuevos: el máximo de productos y que los lugares
  -- sean de esta organización (si no, el diagnóstico citaría la finca de otro).
  for pr in select * from jsonb_array_elements(q.preguntes) loop
    v_val := p_respostes -> (pr ->> 'id');
    if v_val is null or jsonb_typeof(v_val) = 'null' then
      continue;
    end if;
    if pr ->> 'tipus' = 'productes' and pr ? 'max' and jsonb_typeof(v_val) = 'array'
       and jsonb_array_length(v_val) > (pr ->> 'max')::int then
      raise exception 'massa_productes: com a maxim % a "%"', pr ->> 'max', pr ->> 'id'
        using errcode = '22023';
    end if;
    if pr ->> 'tipus' = 'ubicacio' then
      if jsonb_typeof(v_val) <> 'array' or exists (
           select 1 from jsonb_array_elements_text(v_val) u
            where p_tipo_org <> 'productor'
               or u !~ '^[0-9a-f-]{36}$'
               or not exists (select 1 from productor_ubicaciones pu
                               where pu.id = u::uuid and pu.productor_id = p_org)) then
        raise exception 'ubicacio_aliena: algun lloc no es d''aquesta organitzacio' using errcode = '22023';
      end if;
    end if;
  end loop;

  v_falten := public.diagnostic_falten(q.preguntes, p_respostes);
  v_resp := public.compondre_respostes(q.preguntes, p_respostes);

  -- Las etiquetas de los lugares: su alias, leído aquí porque `compondre_respostes` es pura.
  select coalesce(jsonb_agg(
           case when r ->> 'tipus' = 'ubicacio' then
             r || jsonb_build_object('etiquetes', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'ca', coalesce(pu.alias, pu.municipio, '—'),
                        'es', coalesce(pu.alias, pu.municipio, '—'))), '[]'::jsonb)
                 from jsonb_array_elements_text(r -> 'valor') u
                 join productor_ubicaciones pu on pu.id = u::uuid))
           else r end), '[]'::jsonb)
    into v_resp
    from jsonb_array_elements(v_resp) r;

  v_sobre := jsonb_build_object(
    'questionari',             'diagnostic_' || p_tipo_org,
    'questionari_id',          q.id,
    'versio_questionari',      q.versio,
    'questionari_provisional', q.provisional,
    'titol',                   q.titol,
    'respostes',               v_resp,
    'respostes_crues',         p_respostes,
    'notes',                   to_jsonb(p_notes),
    'desat_at',                to_jsonb(now()));

  update planes_prevencion
     set respuestas     = v_sobre,
         questionari_id = q.id,
         idioma         = coalesce(p_idioma, idioma)
   where estado = 'esborrany'
     and tipo_org = p_tipo_org
     and coalesce(productor_id, entidad_id) = p_org
  returning * into pl;

  if pl.id is null then
    insert into planes_prevencion (
      tipo_org, productor_id, entidad_id, nivel, respuestas, questionari_id, idioma, creado_por)
    values (
      p_tipo_org,
      case when p_tipo_org = 'productor' then p_org end,
      case when p_tipo_org = 'entidad'   then p_org end,
      'basic', v_sobre, q.id, coalesce(p_idioma, 'ca'), auth.uid())
    returning * into pl;
  end if;

  -- 🔴 YA NO SE GENERA EL PLAN AQUÍ (revisión del 08-10-2026, §6.4: «ara està redactat com
  --    si del diagnòstic et generés un pla»). Guardar es guardar la ficha viva; el plan lo
  --    prepara el equipo (`generar_pla_des_de_diagnostic`, solo equipo desde esta migración).

  insert into diagnostics_historial (
    tipo_org, productor_id, entidad_id, questionari_id, versio_questionari,
    respostes, complet, falten, notes, desat_per)
  values (
    p_tipo_org,
    case when p_tipo_org = 'productor' then p_org end,
    case when p_tipo_org = 'entidad'   then p_org end,
    q.id, q.versio, p_respostes,
    coalesce(array_length(v_falten, 1), 0) = 0, v_falten, p_notes, auth.uid());

  -- Lo derivado a la ficha: solo lo que se ha contestado (no se borra lo que había si la
  -- pregunta está vacía). Los productos, de la primera `productes` que tira del catálogo;
  -- la temporada, de la primera `mesos` por producto.
  if p_tipo_org = 'productor' then
    select p_respostes -> (e ->> 'id') into v_val
      from jsonb_array_elements(q.preguntes) e
     where e ->> 'tipus' = 'productes' and e ->> 'opcions_de' is null
     limit 1;
    if v_val is not null and jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) > 0 then
      update productores
         set productos_habituales = array(select jsonb_array_elements_text(v_val))
       where id = p_org;
    end if;

    select p_respostes -> (e ->> 'id') into v_etq
      from jsonb_array_elements(q.preguntes) e
     where e ->> 'tipus' = 'mesos' and e ->> 'productes_de' is not null
     limit 1;
    if v_etq is not null and jsonb_typeof(v_etq) = 'object' and v_etq <> '{}'::jsonb then
      update productores set temporada = v_etq where id = p_org;
    end if;
  end if;

  return jsonb_build_object(
    'pla',                     pl.id,
    'questionari_id',          q.id,
    'versio_questionari',      q.versio,
    'questionari_provisional', q.provisional,
    'falten',                  to_jsonb(v_falten),
    'complet',                 coalesce(array_length(v_falten, 1), 0) = 0,
    'mesures_editades',        coalesce((pl.mesures ->> 'editat')::boolean, false),
    'te_mesures',              jsonb_array_length(coalesce(pl.mesures -> 'llista', '[]'::jsonb)) > 0,
    'mesures_n',               jsonb_array_length(coalesce(pl.mesures -> 'llista', '[]'::jsonb)),
    'generacio',               null);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. El plan es del equipo: generar y emitir
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generar_pla_des_de_diagnostic(p_tipo_org text, p_org uuid, p_forcar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  pl        planes_prevencion%rowtype;
  v_flat    jsonb;
  v_llista  jsonb;
  v_regles  jsonb;
  v_oblig   int;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  -- 🔴 Desde la fase 9 (revisión del 08-10-2026) el plan lo prepara el EQUIPO: el
  --    diagnóstico de la organización es una ficha viva y ya no genera nada por sí solo.
  --    `auth.uid() is null` es `service_role` (script): decide él.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'El pla de prevencio el prepara l''equip' using errcode = '42501';
  end if;

  -- `tipo_org` en el filtro no es redundante aunque el uuid ya sea único: hace que la
  -- consulta diga lo que quiere decir, y que un borrador del otro papel de la misma
  -- organización no se pueda colar nunca por un enlace mal hecho.
  select * into pl
    from planes_prevencion
   where estado = 'esborrany'
     and tipo_org = p_tipo_org
     and coalesce(productor_id, entidad_id) = p_org
   for update;

  if pl.id is null then
    raise exception 'sense_esborrany: aquesta organitzacio no te cap diagnostic obert'
      using errcode = '22023';
  end if;

  if coalesce((pl.mesures ->> 'editat')::boolean, false) and not coalesce(p_forcar, false) then
    raise exception 'mesures_editades: les mesures d''aquest pla s''han ajustat a ma. Torna-ho a generar amb forcar = true si vols descartar-ho.'
      using errcode = '22023';
  end if;

  v_flat := public.respostes_planes(pl.respuestas);

  with aplica as (
    select g.id as regla_id, g.mesura_codi, g.obligatoria, g.prioritat
      from regles_pla g
     where g.activa
       and g.tipo_org = pl.tipo_org
       and public.avaluar_regla(g.operador, g.valor, v_flat -> g.pregunta_id)
  ),
  triades as (
    select distinct on (a.mesura_codi)
           a.mesura_codi,
           (a.obligatoria or m.obligatoria_per_defecte) as obligatoria,
           m.bloc, m.ordre, m.titol, m.descripcio
      from aplica a
      join mesures_prevencio m
        on m.codi = a.mesura_codi and m.tipo_org = pl.tipo_org
     where m.activa
     order by a.mesura_codi, (a.obligatoria or m.obligatoria_per_defecte) desc, a.prioritat asc
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
                'codi',        t.mesura_codi,
                'bloc',        t.bloc,
                -- ⚠️ Resuelto AL IDIOMA DEL PLAN y copiado dentro (§20270405100200): el
                --    documento no puede depender del catálogo dentro de cinco años.
                'titol',       coalesce(t.titol      ->> pl.idioma, t.titol      ->> 'ca'),
                'descripcio',  coalesce(t.descripcio ->> pl.idioma, t.descripcio ->> 'ca'),
                'obligatoria', t.obligatoria,
                'origen',      'regla')
              order by t.ordre, t.mesura_codi)
             from triades t), '[]'::jsonb),
    coalesce((select jsonb_agg(a.regla_id) from aplica a), '[]'::jsonb),
    coalesce((select count(*) from triades t where t.obligatoria), 0)
  into v_llista, v_regles, v_oblig;

  update planes_prevencion
     set mesures = jsonb_build_object(
           'generat_at',       to_jsonb(now()),
           'regles_aplicades', v_regles,
           'editat',           false,
           'observacions',     pl.mesures -> 'observacions',
           'llista',           v_llista)
   where id = pl.id
  returning * into pl;

  return jsonb_build_object(
    'pla', pl.id,
    'mesures_n', jsonb_array_length(v_llista),
    'obligatories_n', v_oblig,
    'regles_aplicades_n', jsonb_array_length(v_regles));
end;
$function$;

CREATE OR REPLACE FUNCTION public.emitir_plan_basico(p_plan uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  pl        planes_prevencion%rowtype;
  q         questionaris_diagnostic%rowtype;
  v_falten  text[];
  v_org     uuid;
  v_ej      int;
  v_n       int;
  v_version int;
  v_prev    uuid;
  v_doc     uuid;
begin
  -- La guarda va ANTES de buscar el plan (un uuid inventado da 42501, no 22023).
  -- Desde la fase 9, emitir un plan es del equipo (ver `generar_pla_des_de_diagnostic`).
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'El pla de prevencio l''emet l''equip' using errcode = '42501';
  end if;
  select * into pl from planes_prevencion where id = p_plan for update;
  if pl.id is null then
    raise exception 'Aquest pla no existeix' using errcode = '22023';
  end if;
  if pl.estado <> 'esborrany' then
    raise exception 'Aquest pla ja esta emes (%)', coalesce(pl.numero_completo, pl.id::text)
      using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(pl.respuestas -> 'respostes', '[]'::jsonb)) = 0 then
    raise exception 'No es pot emetre un pla sense cap resposta' using errcode = '22023';
  end if;

  if pl.questionari_id is not null then
    select * into q from questionaris_diagnostic where id = pl.questionari_id;
    v_falten := public.diagnostic_falten(q.preguntes, public.respostes_planes(pl.respuestas));
    if coalesce(array_length(v_falten, 1), 0) > 0 then
      raise exception 'falten_obligatories: el diagnostic no esta complet (%)',
        array_to_string(v_falten, ', ') using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(pl.mesures -> 'llista', '[]'::jsonb)) = 0 then
      raise exception 'sense_mesures: un pla sense cap mesura no es un pla de prevencio'
        using errcode = '22023';
    end if;
  end if;

  v_org := coalesce(pl.productor_id, pl.entidad_id);
  v_ej  := extract(year from (now() at time zone 'Europe/Madrid'))::int;

  select coalesce(max(version), 0) + 1 into v_version
    from planes_prevencion
   where coalesce(productor_id, entidad_id) = v_org and estado <> 'esborrany';

  select id into v_prev
    from planes_prevencion
   where coalesce(productor_id, entidad_id) = v_org and vigente and id <> p_plan;

  if v_prev is not null then
    update planes_prevencion
       set vigente = false, estado = 'substituit'
     where id = v_prev;
  end if;

  v_n := public.siguiente_numero('PLA', v_ej);

  update planes_prevencion
     set serie           = 'PLA',
         ejercicio       = v_ej,
         numero          = v_n,
         numero_completo = public.formato_numero('PLA', v_ej, v_n),
         version         = v_version,
         estado          = 'emes',
         vigente         = true,
         emitido_at      = now(),
         emitido_por     = auth.uid()
   where id = p_plan
  returning * into pl;

  if v_prev is not null then
    update planes_prevencion set sustituido_por = p_plan where id = v_prev;
  end if;

  v_doc := public.plan_emet_document(p_plan);

  return jsonb_build_object(
    'pla', p_plan,
    'document', v_doc,
    'numero', pl.numero_completo,
    'versio', pl.version,
    'mesures_n', jsonb_array_length(coalesce(pl.mesures -> 'llista', '[]'::jsonb)),
    'substitueix', v_prev,
    'descarrega_immediata', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. El estado: «complet» es contestado y sin plan, y la bandeja solo lista productores
-- ---------------------------------------------------------------------------
create or replace function public.diagnostic_estat(p_tipo_org text, p_org uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q        questionaris_diagnostic%rowtype;
  pe       planes_prevencion%rowtype;
  pv       planes_prevencion%rowtype;
  v_falten text[] := '{}';
  v_estat  text;
  v_mes    int := 0;
  v_ult    timestamptz;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(p_tipo_org, p_org) then
    raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
  end if;

  select * into q  from questionaris_diagnostic where tipo_org = p_tipo_org and vigente limit 1;
  select * into pe from planes_prevencion
   where estado = 'esborrany'
     and tipo_org = p_tipo_org
     and coalesce(productor_id, entidad_id) = p_org;
  select * into pv from planes_prevencion
   where vigente
     and tipo_org = p_tipo_org
     and coalesce(productor_id, entidad_id) = p_org;
  select max(h.desat_at) into v_ult from diagnostics_historial h
   where h.tipo_org = p_tipo_org and coalesce(h.productor_id, h.entidad_id) = p_org;

  if pe.id is not null then
    v_mes := jsonb_array_length(coalesce(pe.mesures -> 'llista', '[]'::jsonb));
    if q.id is not null then
      v_falten := public.diagnostic_falten(q.preguntes, public.respostes_planes(pe.respuestas));
    end if;
  end if;

  -- `complet` (fase 9): el diagnóstico está contestado y nadie ha preparado plan. Para la
  -- organización es el final del camino; `a_punt` y `emes` son ya cosa del equipo.
  if q.id is null then
    v_estat := 'sense_questionari';
  elsif pe.id is null then
    v_estat := case when pv.id is not null then 'emes' else 'sense_comencar' end;
  elsif coalesce(array_length(v_falten, 1), 0) > 0 then
    v_estat := 'incomplet';
  elsif v_mes = 0 then
    v_estat := 'complet';
  else
    v_estat := 'a_punt';
  end if;

  return jsonb_build_object(
    'estat',          v_estat,
    'pla_esborrany',  pe.id,
    'pla_vigent',     pv.id,
    'numero',         pv.numero_completo,
    'versio',         pv.version,
    'emes_at',        pv.emitido_at,
    'nivell',         coalesce(pe.nivel, pv.nivel),
    'idioma',         coalesce(pe.idioma, pv.idioma),
    'falten',         to_jsonb(v_falten),
    'te_mesures',     v_mes > 0,
    'mesures_n',      v_mes,
    'mesures_editades', coalesce((pe.mesures ->> 'editat')::boolean, false),
    'questionari_id', q.id,
    'versio_questionari', q.versio,
    'darrera_actualitzacio', v_ult,
    'provisional',    coalesce(q.provisional, true));
end;
$function$;

drop function public.diagnostics_equip();
create function public.diagnostics_equip()
 returns table(tipo_org text, org_id uuid, nom text, es_test boolean, estat text, falten_n integer,
   mesures_n integer, pla_esborrany uuid, pla_vigent uuid, numero text, versio integer,
   emes_at timestamp with time zone, versio_questionari integer, provisional boolean,
   darrera_actualitzacio timestamp with time zone)
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
-- El pragma de arriba es el de siempre (20270328101700): todas las referencias van
-- cualificadas y el pragma cubre la que se cuele.
-- ⚠️ Desde la fase 9 SOLO PRODUCTORES: el receptor ya no tiene diagnóstico (tiene su
--    «perfil de recepció»), y su cuestionario está retirado.
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Els diagnostics de la base son de l''equip' using errcode = '42501';
  end if;

  return query
  with fitxes as (
    select 'productor'::text as tipo_org, pr.id as org_id,
           coalesce(pr.empresa, pr.name) as nom, pr.es_test
      from productores pr
  ),
  q as (
    select qd.tipo_org, qd.id, qd.versio, qd.provisional, qd.preguntes
      from questionaris_diagnostic qd where qd.vigente and qd.tipo_org = 'productor'
  )
  select
    f.tipo_org,
    f.org_id,
    f.nom,
    f.es_test,
    case
      when q.id is null then 'sense_questionari'
      when pe.id is null then case when pv.id is not null then 'emes' else 'sense_comencar' end
      when coalesce(array_length(
             public.diagnostic_falten(q.preguntes, public.respostes_planes(pe.respuestas)), 1), 0) > 0 then 'incomplet'
      when jsonb_array_length(coalesce(pe.mesures -> 'llista', '[]'::jsonb)) = 0 then 'complet'
      else 'a_punt'
    end as estat,
    case when pe.id is null or q.id is null then 0
         else coalesce(array_length(
                public.diagnostic_falten(q.preguntes, public.respostes_planes(pe.respuestas)), 1), 0)
    end as falten_n,
    coalesce(jsonb_array_length(coalesce(pe.mesures -> 'llista', '[]'::jsonb)), 0) as mesures_n,
    pe.id, pv.id, pv.numero_completo, pv.version, pv.emitido_at,
    q.versio, q.provisional,
    (select max(h.desat_at) from diagnostics_historial h where h.productor_id = f.org_id)
  from fitxes f
  left join q on q.tipo_org = f.tipo_org
  left join planes_prevencion pe
    on pe.tipo_org = f.tipo_org
   and pe.productor_id = f.org_id
   and pe.estado = 'esborrany'
  left join planes_prevencion pv
    on pv.tipo_org = f.tipo_org
   and pv.productor_id = f.org_id
   and pv.vigente
  order by f.nom;
end;
$function$;
revoke execute on function public.diagnostics_equip() from public, anon;
grant execute on function public.diagnostics_equip() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. El receptor ya no tiene diagnóstico
-- ---------------------------------------------------------------------------
-- El cuestionario se retira (no se borra: los diagnósticos hechos lo citan) y los planes
-- emitidos pasan a `substituit` (transición admitida por `planes_control`). Los PDF se
-- quedan: un documento emitido no se toca (§4). Los borradores de entidad se quedan como
-- están; ya no hay pantalla que los abra.
update public.questionaris_diagnostic set vigente = false
 where tipo_org = 'entidad' and vigente;

update public.planes_prevencion set estado = 'substituit', vigente = false
 where tipo_org = 'entidad' and estado = 'emes';

-- ---------------------------------------------------------------------------
-- 9. Versión 2 del productor: «Diagnòstic operatiu»
-- ---------------------------------------------------------------------------
-- Provisional, como la 1: texto de trabajo de la consultoría sobre la tabla del documento
-- del 08-10-2026 (§6.2). Las reglas del plan que citaban preguntas retiradas quedan
-- huérfanas y no disparan (el editor de Configuració lo dice); el plan es del equipo.
select public.publicar_questionari(
  'productor',
  '{"ca":"Diagnòstic operatiu","es":"Diagnóstico operativo"}'::jsonb,
  $q2$[{"id": "families", "tipus": "multi", "seccio": "productes", "obligatoria": true, "etiqueta": {"ca": "Quines famílies de productes treballeu habitualment?", "es": "¿Qué familias de productos trabajáis habitualmente?"}, "opcions": [{"valor": "Fruita Dolça", "etiqueta": {"ca": "Fruita dolça", "es": "Fruta dulce"}}, {"valor": "Fruita Cítrics", "etiqueta": {"ca": "Cítrics", "es": "Cítricos"}}, {"valor": "Fruita Vermella", "etiqueta": {"ca": "Fruita vermella", "es": "Frutos rojos"}}, {"valor": "Fruita Exòtica", "etiqueta": {"ca": "Fruita exòtica", "es": "Fruta exótica"}}, {"valor": "Fruita Seca", "etiqueta": {"ca": "Fruita seca", "es": "Frutos secos"}}, {"valor": "Horta Fulla", "etiqueta": {"ca": "Hortalissa de fulla", "es": "Hortaliza de hoja"}}, {"valor": "Horta Fruit", "etiqueta": {"ca": "Hortalissa de fruit", "es": "Hortaliza de fruto"}}, {"valor": "Horta Flor", "etiqueta": {"ca": "Hortalissa de flor", "es": "Hortaliza de flor"}}, {"valor": "Horta Tub/Bul/Arr", "etiqueta": {"ca": "Tubercles, bulbs i arrels", "es": "Tubérculos, bulbos y raíces"}}, {"valor": "Bolets", "etiqueta": {"ca": "Bolets", "es": "Setas"}}, {"valor": "Varis", "etiqueta": {"ca": "Altres", "es": "Otros"}}], "ajuda": null}, {"id": "productes", "tipus": "productes", "seccio": "productes", "obligatoria": true, "familia_de": "families", "etiqueta": {"ca": "Quins productes concrets treballeu?", "es": "¿Qué productos concretos trabajáis?"}, "ajuda": {"ca": "Només surten els de les famílies que has marcat.", "es": "Solo salen los de las familias que has marcado."}, "prefill": "productores.productos_habituales"}, {"id": "productes_principals", "tipus": "productes", "seccio": "productes", "obligatoria": true, "opcions_de": "productes", "max": 5, "etiqueta": {"ca": "Quins són els vostres productes principals per volum?", "es": "¿Cuáles son vuestros productos principales por volumen?"}, "ajuda": {"ca": "Com a màxim cinc, dels que has marcat a dalt.", "es": "Como máximo cinco, de los que has marcado arriba."}}, {"id": "volum_producte", "tipus": "per_producte_num", "seccio": "productes", "obligatoria": false, "productes_de": "productes_principals", "unitat": {"ca": "kg/any", "es": "kg/año"}, "etiqueta": {"ca": "Quin volum aproximat treballeu a l'any de cada producte principal?", "es": "¿Qué volumen aproximado trabajáis al año de cada producto principal?"}, "ajuda": null}, {"id": "temporada", "tipus": "mesos", "seccio": "temporalitat", "obligatoria": false, "productes_de": "productes_principals", "etiqueta": {"ca": "En quina època de l'any treballeu principalment aquests productes?", "es": "¿En qué época del año trabajáis principalmente estos productos?"}, "ajuda": {"ca": "Marca els mesos de cada producte principal.", "es": "Marca los meses de cada producto principal."}}, {"id": "situacions_excedent", "tipus": "multi", "seccio": "excedents", "obligatoria": true, "etiqueta": {"ca": "En quines situacions us queda producte fora del vostre circuit habitual?", "es": "¿En qué situaciones se os genera producto fuera de vuestro circuito habitual?"}, "opcions": [{"valor": "exces_produccio", "etiqueta": {"ca": "Excés de producció o d'oferta", "es": "Exceso de producción u oferta"}}, {"valor": "qualitat_estetica", "etiqueta": {"ca": "Criteris de qualitat o estètica", "es": "Criterios de calidad o estética"}}, {"valor": "baixa_demanda", "etiqueta": {"ca": "Baixa demanda", "es": "Baja demanda"}}, {"valor": "deteriorament", "etiqueta": {"ca": "Proximitat al deteriorament", "es": "Proximidad al deterioro"}}, {"valor": "devolucions", "etiqueta": {"ca": "Devolucions", "es": "Devoluciones"}}, {"valor": "logistica", "etiqueta": {"ca": "Problemes logístics", "es": "Problemas logísticos"}}, {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}], "ajuda": null}, {"id": "frequencia_excedent", "tipus": "opcio", "seccio": "excedents", "obligatoria": true, "etiqueta": {"ca": "Amb quina freqüència es generen aquests excedents?", "es": "¿Con qué frecuencia se generan estos excedentes?"}, "opcions": [{"valor": "puntual", "etiqueta": {"ca": "Puntualment", "es": "Puntualmente"}}, {"valor": "estacional", "etiqueta": {"ca": "Estacionalment", "es": "Estacionalmente"}}, {"valor": "mensual", "etiqueta": {"ca": "Cada mes", "es": "Cada mes"}}, {"valor": "setmanal", "etiqueta": {"ca": "Cada setmana", "es": "Cada semana"}}, {"valor": "varies_setmana", "etiqueta": {"ca": "Diverses vegades per setmana", "es": "Varias veces por semana"}}], "ajuda": null}, {"id": "volum_excedent", "tipus": "opcio", "seccio": "excedents", "obligatoria": true, "etiqueta": {"ca": "Quin volum aproximat d'excedent es genera habitualment?", "es": "¿Qué volumen aproximado de excedente se genera habitualmente?"}, "opcions": [{"valor": "menys_50", "etiqueta": {"ca": "Menys de 50 kg", "es": "Menos de 50 kg"}}, {"valor": "50_250", "etiqueta": {"ca": "50–250 kg", "es": "50–250 kg"}}, {"valor": "250_500", "etiqueta": {"ca": "250–500 kg", "es": "250–500 kg"}}, {"valor": "500_1000", "etiqueta": {"ca": "500–1.000 kg", "es": "500–1.000 kg"}}, {"valor": "mes_1000", "etiqueta": {"ca": "Més de 1.000 kg", "es": "Más de 1.000 kg"}}], "ajuda": null}, {"id": "previsio", "tipus": "opcio", "seccio": "previsio", "obligatoria": false, "etiqueta": {"ca": "Podeu preveure amb antelació quan tindreu excedents?", "es": "¿Podéis prever con antelación cuándo tendréis excedentes?"}, "opcions": [{"valor": "si", "etiqueta": {"ca": "Sí, normalment", "es": "Sí, normalmente"}}, {"valor": "a_vegades", "etiqueta": {"ca": "A vegades", "es": "A veces"}}, {"valor": "dificil", "etiqueta": {"ca": "Difícil de preveure", "es": "Difícil de prever"}}], "ajuda": null}, {"id": "antelacio", "tipus": "opcio", "seccio": "previsio", "obligatoria": false, "aplica_a": {"pregunta": "previsio", "operador": "in", "valor": ["si", "a_vegades"]}, "etiqueta": {"ca": "Amb quanta antelació ho podeu saber?", "es": "¿Con cuánta antelación lo podéis saber?"}, "opcions": [{"valor": "mes_setmana", "etiqueta": {"ca": "Més d'una setmana", "es": "Más de una semana"}}, {"valor": "3_7_dies", "etiqueta": {"ca": "De 3 a 7 dies", "es": "De 3 a 7 días"}}, {"valor": "1_2_dies", "etiqueta": {"ca": "D'1 a 2 dies", "es": "De 1 a 2 días"}}, {"valor": "mateix_dia", "etiqueta": {"ca": "El mateix dia", "es": "El mismo día"}}], "ajuda": null}, {"id": "canals_actuals", "tipus": "multi", "seccio": "gestio_actual", "obligatoria": true, "etiqueta": {"ca": "Què feu actualment amb aquests excedents?", "es": "¿Qué hacéis actualmente con estos excedentes?"}, "opcions": [{"valor": "venda_alternativa", "etiqueta": {"ca": "Venda alternativa", "es": "Venta alternativa"}}, {"valor": "donacio", "etiqueta": {"ca": "Donació", "es": "Donación"}}, {"valor": "transformacio", "etiqueta": {"ca": "Transformació", "es": "Transformación"}}, {"valor": "altres_aprofitaments", "etiqueta": {"ca": "Altres aprofitaments", "es": "Otros aprovechamientos"}}, {"valor": "residu", "etiqueta": {"ca": "Residu", "es": "Residuo"}}, {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}], "ajuda": null}, {"id": "causes", "tipus": "multi", "seccio": "causes", "obligatoria": false, "etiqueta": {"ca": "Quines són les causes principals d'aquests excedents?", "es": "¿Cuáles son las principales causas de estos excedentes?"}, "opcions": [{"valor": "exces_oferta", "etiqueta": {"ca": "Excés d'oferta", "es": "Exceso de oferta"}}, {"valor": "qualitat_estetica", "etiqueta": {"ca": "Qualitat o estètica", "es": "Calidad o estética"}}, {"valor": "baixa_demanda", "etiqueta": {"ca": "Baixa demanda", "es": "Baja demanda"}}, {"valor": "deteriorament", "etiqueta": {"ca": "Deteriorament", "es": "Deterioro"}}, {"valor": "devolucions", "etiqueta": {"ca": "Devolucions", "es": "Devoluciones"}}, {"valor": "logistica", "etiqueta": {"ca": "Logística", "es": "Logística"}}, {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}], "ajuda": null}, {"id": "sortides_interes", "tipus": "multi", "seccio": "sortides", "obligatoria": true, "etiqueta": {"ca": "Quines sortides us interessen per a aquests productes?", "es": "¿Qué salidas os interesan para estos productos?"}, "opcions": [{"valor": "venda", "etiqueta": {"ca": "Venda", "es": "Venta"}}, {"valor": "donacio", "etiqueta": {"ca": "Donació", "es": "Donación"}}, {"valor": "maquila", "etiqueta": {"ca": "Maquila o transformació", "es": "Maquila o transformación"}}, {"valor": "indiferent", "etiqueta": {"ca": "Indiferent", "es": "Indiferente"}}], "ajuda": null}, {"id": "ubicacions", "tipus": "ubicacio", "seccio": "ubicacio", "obligatoria": false, "etiqueta": {"ca": "On es troba habitualment el producte?", "es": "¿Dónde se encuentra habitualmente el producto?"}, "ajuda": {"ca": "Els llocs de recollida que tens a «La meva organització».", "es": "Los lugares de recogida que tienes en «Mi organización»."}}, {"id": "logistica_modes", "tipus": "opcio", "seccio": "logistica", "obligatoria": false, "etiqueta": {"ca": "Com es pot recollir o lliurar el producte?", "es": "¿Cómo puede recogerse o entregarse el producto?"}, "opcions": [{"valor": "recollida_origen", "etiqueta": {"ca": "Recollida a origen", "es": "Recogida en origen"}}, {"valor": "entrega_ofertant", "etiqueta": {"ca": "Entrega per part vostra", "es": "Entrega por vuestra parte"}}, {"valor": "ambdues", "etiqueta": {"ca": "Totes dues", "es": "Ambas"}}], "ajuda": null}, {"id": "condicions_logistiques", "tipus": "text", "seccio": "logistica", "obligatoria": false, "etiqueta": {"ca": "Quines condicions logístiques hem de tenir en compte?", "es": "¿Qué condiciones logísticas debemos tener en cuenta?"}, "ajuda": {"ca": "Horaris, càrrega i descàrrega, mínims, accés…", "es": "Horarios, carga y descarga, mínimos, acceso…"}}, {"id": "suport", "tipus": "multi", "seccio": "relacio", "obligatoria": false, "etiqueta": {"ca": "En què us agradaria que REDESTINA us ajudés?", "es": "¿En qué os gustaría que REDESTINA os ayudara?"}, "opcions": [{"valor": "compradors", "etiqueta": {"ca": "Trobar compradors", "es": "Encontrar compradores"}}, {"valor": "donacions", "etiqueta": {"ca": "Gestionar donacions", "es": "Gestionar donaciones"}}, {"valor": "transformacio", "etiqueta": {"ca": "Trobar transformació o maquila", "es": "Encontrar transformación o maquila"}}, {"valor": "logistica", "etiqueta": {"ca": "Logística", "es": "Logística"}}, {"valor": "prevencio", "etiqueta": {"ca": "Prevenció", "es": "Prevención"}}, {"valor": "anticipar", "etiqueta": {"ca": "Anticipar sortides", "es": "Anticipar salidas"}}, {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}], "ajuda": null}]$q2$::jsonb,
  true,
  true);
