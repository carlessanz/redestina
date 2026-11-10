-- =============================================================================
-- A1 · Diagnóstico único del productor, lectura en la ficha y retirada del plan básico
-- =============================================================================
--
-- Decisiones de la Fundació (Plan 2):
--   · D1: un solo diagnóstico por productor, que se SOBRESCRIBE. Vive en su tabla propia,
--         `diagnostics`, y deja de vivir en el borrador (`estado = 'esborrany'`) de
--         `planes_prevencion`, que era donde lo dejaba el plan básico.
--   · D4: el plan básico desaparece. El plan de prevención es el EXPEDIENTE
--         (`expedients_prevencion`, fase 11). Las RPC del plan básico quedan solo para
--         `service_role` (scripts de fixtures) y el catálogo de medidas y reglas, sin escritura.
--   · D5: el diagnóstico lo conduce el EQUIPO; la organización lo LEE. `desar_diagnostic`
--         da `42501` a una cuenta externa también sobre su propia ficha.
--   · P10: `diagnostics_historial` deja de escribirse (se conserva para leer; `drop` pendiente,
--         deuda nueva). El backfill la deja al día para que el frontend publicado, que cae al
--         historial cuando no encuentra borrador, siga viendo lo último durante la ventana
--         base → frontend.
--
-- Hallazgos que ordenan el backfill:
--   1. Un borrador no puede pasar a `substituit`: lo impiden `trg_planes_control()` (solo
--      `esborrany→emes` y `emes→substituit`) y el check `planes_numero_segons_estat`. Pero
--      `trg_planes_no_esborrar()` sí deja BORRAR un borrador sin número. Así que: copiar a
--      `diagnostics` (productores), dejar rastro en `diagnostics_historial` (todos, también
--      las entidades) y después borrar los borradores. `expedients_prevencion.pla_id` que
--      apunte a un borrador pasa a NULL por su `on delete set null`, después de rellenar
--      `diagnostic_id`.
--   2. Activar medidas o reglas no tiene RPC: era `update` directo desde el editor. Retirarlo
--      es `revoke insert, update` a `authenticated` (queda `select`).
--   3. `guardar_plan_basico` seguía abierta a `authenticated` y escribe un borrador: se revoca.
--
-- Compatibilidad con el frontend publicado: `desar_diagnostic`, `diagnostic_estat` y
-- `diagnostics_equip` conservan firma, tipo de retorno y claves (las del plan, a null/0/false).
-- Ninguna pantalla vieja deja de cargar; sus botones del plan dan `42501`, que es lo esperado.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. La tabla: un diagnóstico por productor
-- ---------------------------------------------------------------------------
create table if not exists public.diagnostics (
  id                  uuid primary key default gen_random_uuid(),
  productor_id        uuid not null unique references public.productores(id) on delete cascade,
  questionari_id      uuid references public.questionaris_diagnostic(id) on delete restrict,
  versio_questionari  int,
  -- Lo que se contestó, crudo: {pregunta_id: valor}. Es lo que reabre el formulario.
  respostes           jsonb not null default '{}'::jsonb,
  -- El sobre autocontenido (mismo formato que `planes_prevencion.respuestas`): la pregunta y
  -- la respuesta legible en las dos lenguas, para que el resumen y el PDF del expediente no
  -- dependan del cuestionario de mañana.
  sobre               jsonb not null,
  complet             boolean not null default false,
  falten              text[] not null default '{}',
  notes               text,
  idioma              text check (idioma in ('ca', 'es')),
  actualitzat_at      timestamptz not null default now(),
  actualitzat_per     uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint diagnostics_respostes_objecte check (jsonb_typeof(respostes) = 'object'),
  constraint diagnostics_sobre_forma check (
    jsonb_typeof(sobre) = 'object'
    and jsonb_typeof(coalesce(sobre -> 'respostes', '[]'::jsonb)) = 'array')
);
create index if not exists diagnostics_questionari_idx
  on public.diagnostics (questionari_id) where questionari_id is not null;

alter table public.diagnostics enable row level security;
-- Dos capas (§4): sin escritura directa para nadie con sesión; se escribe por `desar_diagnostic`.
revoke all on public.diagnostics from anon, authenticated;
grant select on public.diagnostics to authenticated;
grant all on public.diagnostics to service_role;

drop policy if exists "diagnostics: equip o propi" on public.diagnostics;
create policy "diagnostics: equip o propi" on public.diagnostics
  for select to authenticated
  using ((select public.es_intern())
         or productor_id in (select public.mis_productores()));

comment on table public.diagnostics is
  'Diagnòstic operatiu: UNO por productor, se sobrescribe (A1, D1). Lo escribe solo desar_diagnostic() (equipo, D5); lo leen el equipo y el propio productor. respostes = {pregunta_id: valor}; sobre = respuestas legibles autocontenidas. Desde 20270520100000.';

-- ---------------------------------------------------------------------------
-- 2. El cuestionario que cita un diagnóstico no se edita ni se borra
-- ---------------------------------------------------------------------------
-- Hasta hoy lo protegía que lo citara un plan (el borrador incluido). Como los borradores se
-- borran abajo, la protección pasa a mirar también `diagnostics` y el historial; si no, el
-- cuestionario vigente quedaría editable en cuanto desapareciera el borrador que lo citaba.
create or replace function public.trg_questionaris_inmutables()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Traspaso o borrado de una cuenta del equipo (20270514100000): solo cambia QUIEN, y solo las RPC
  -- `equip_*` ponen esta marca dentro de su transaccion.
  if tg_op = 'UPDATE' and coalesce(current_setting('redestina.traspas_autoria', true), '') = 'on' then
    return new;
  end if;
  if new.tipo_org  is distinct from old.tipo_org
  or new.versio    is distinct from old.versio
  or new.titol     is distinct from old.titol
  or new.preguntes is distinct from old.preguntes then
    if exists (select 1 from planes_prevencion pl where pl.questionari_id = old.id)
       or exists (select 1 from diagnostics d where d.questionari_id = old.id)
       or exists (select 1 from diagnostics_historial h where h.questionari_id = old.id) then
      raise exception
        'El questionari % (%/v%) ja ha generat diagnostics: publica una versio nova en comptes d''editar-lo.',
        old.id, old.tipo_org, old.versio using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.trg_questionaris_no_esborrar()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if exists (select 1 from planes_prevencion pl where pl.questionari_id = old.id)
     or exists (select 1 from diagnostics d where d.questionari_id = old.id)
     or exists (select 1 from diagnostics_historial h where h.questionari_id = old.id) then
    raise exception 'El questionari % ja ha generat diagnostics: retira''l (vigente = false) en comptes d''esborrar-lo.',
      old.id using errcode = '42501';
  end if;
  return old;
end;
$function$;
revoke execute on function public.trg_questionaris_inmutables() from public, anon, authenticated;
revoke execute on function public.trg_questionaris_no_esborrar() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helper interno: el sobre autocontenido
-- ---------------------------------------------------------------------------
-- Es el bloque que vivía dentro de `desar_diagnostic` (20270423100000): `compondre_respostes`
-- (pura) + el alias de cada lugar de recogida (que no es puro: lee `productor_ubicaciones`).
-- Sale a una función porque lo usan dos sitios: el guardado y el backfill del historial.
-- Invoker a propósito: solo la llaman funciones `security definer` y esta migración.
create or replace function public.diagnostic_compon_sobre(
  p_q public.questionaris_diagnostic, p_org uuid, p_respostes jsonb, p_notes text)
 returns jsonb
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'questionari',             'diagnostic_' || p_q.tipo_org,
    'questionari_id',          p_q.id,
    'versio_questionari',      p_q.versio,
    'questionari_provisional', p_q.provisional,
    'titol',                   p_q.titol,
    'respostes', (
      select coalesce(jsonb_agg(
               case when e.r ->> 'tipus' = 'ubicacio' and jsonb_typeof(e.r -> 'valor') = 'array' then
                 e.r || jsonb_build_object('etiquetes', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'ca', coalesce(pu.alias, pu.municipio, '—'),
                            'es', coalesce(pu.alias, pu.municipio, '—')) order by u.i), '[]'::jsonb)
                     from jsonb_array_elements_text(e.r -> 'valor') with ordinality as u(v, i)
                     join productor_ubicaciones pu
                       on u.v ~ '^[0-9a-f-]{36}$'
                      and pu.id = case when u.v ~ '^[0-9a-f-]{36}$' then u.v::uuid end
                      and pu.productor_id = p_org))
               else e.r end
             order by e.i), '[]'::jsonb)
        from jsonb_array_elements(public.compondre_respostes(p_q.preguntes, p_respostes))
             with ordinality as e(r, i)),
    'respostes_crues',         p_respostes,
    'notes',                   to_jsonb(p_notes),
    'desat_at',                to_jsonb(now()));
$function$;
revoke execute on function public.diagnostic_compon_sobre(public.questionaris_diagnostic, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.diagnostic_compon_sobre(public.questionaris_diagnostic, uuid, jsonb, text)
  to service_role;
comment on function public.diagnostic_compon_sobre(public.questionaris_diagnostic, uuid, jsonb, text) is
  'Interna (A1): compone el sobre autocontenido de un diagnóstico (respuestas legibles + alias de los lugares). Sin EXECUTE para sesiones.';

-- ---------------------------------------------------------------------------
-- 4. Guardar el diagnóstico: solo el equipo, en `diagnostics`
-- ---------------------------------------------------------------------------
-- Misma firma y mismo `returns jsonb` que la vigente (20270423100000), para que el frontend
-- publicado siga guardando desde el equipo durante la ventana. Cambia:
--   · la guarda: `es_intern()` en vez de `puc_gestionar_pla()` (D5, también sobre la propia);
--   · solo productores (`nomes_productors`), y ficha inexistente → `fitxa_inexistent`;
--   · escribe en `diagnostics` (upsert) y NO en `planes_prevencion` ni en el historial (P10);
--   · devuelve las claves del plan a null/0/false, más `diagnostic_id`.
create or replace function public.desar_diagnostic(p_tipo_org text, p_org uuid, p_respostes jsonb,
  p_notes text default null::text, p_idioma text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q        questionaris_diagnostic%rowtype;
  d        diagnostics%rowtype;
  pr       jsonb;
  v_sobre  jsonb;
  v_falten text[];
  v_val    jsonb;
  v_etq    jsonb;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  -- D5: el diagnóstico lo conduce el equipo. `auth.uid() is null` = `service_role`.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'El diagnostic l''actualitza l''equip de Redestina' using errcode = '42501';
  end if;
  if p_tipo_org <> 'productor' then
    raise exception 'nomes_productors: el diagnostic operatiu es de les entitats productores'
      using errcode = '22023';
  end if;
  if p_respostes is null or jsonb_typeof(p_respostes) <> 'object' then
    raise exception 'Les respostes han de ser un objecte {pregunta_id: valor}' using errcode = '22023';
  end if;
  if p_idioma is not null and p_idioma not in ('ca', 'es') then
    raise exception 'Idioma desconegut: %', p_idioma using errcode = '22023';
  end if;
  if not exists (select 1 from productores where id = p_org) then
    raise exception 'fitxa_inexistent' using errcode = '22023';
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
            where u !~ '^[0-9a-f-]{36}$'
               or not exists (select 1 from productor_ubicaciones pu
                               where pu.id = u::uuid and pu.productor_id = p_org)) then
        raise exception 'ubicacio_aliena: algun lloc no es d''aquesta organitzacio' using errcode = '22023';
      end if;
    end if;
  end loop;

  v_falten := public.diagnostic_falten(q.preguntes, p_respostes);
  v_sobre  := public.diagnostic_compon_sobre(q, p_org, p_respostes, p_notes);

  insert into diagnostics (
    productor_id, questionari_id, versio_questionari, respostes, sobre,
    complet, falten, notes, idioma, actualitzat_at, actualitzat_per)
  values (
    p_org, q.id, q.versio, p_respostes, v_sobre,
    coalesce(array_length(v_falten, 1), 0) = 0, v_falten, p_notes, p_idioma, now(), auth.uid())
  on conflict (productor_id) do update
     set questionari_id     = excluded.questionari_id,
         versio_questionari = excluded.versio_questionari,
         respostes          = excluded.respostes,
         sobre              = excluded.sobre,
         complet            = excluded.complet,
         falten             = excluded.falten,
         notes              = excluded.notes,
         idioma             = coalesce(excluded.idioma, diagnostics.idioma),
         actualitzat_at     = excluded.actualitzat_at,
         actualitzat_per    = excluded.actualitzat_per
  returning * into d;

  -- Lo derivado a la ficha (hasta A4): solo lo que se ha contestado (no se borra lo que había
  -- si la pregunta está vacía). Los productos, de la primera `productes` que tira del
  -- catálogo; la temporada, de la primera `mesos` por producto.
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

  return jsonb_build_object(
    'pla',                     null,
    'diagnostic_id',           d.id,
    'questionari_id',          q.id,
    'versio_questionari',      q.versio,
    'questionari_provisional', q.provisional,
    'falten',                  to_jsonb(v_falten),
    'complet',                 d.complet,
    'mesures_editades',        false,
    'te_mesures',              false,
    'mesures_n',               0,
    'generacio',               null);
end;
$function$;
revoke execute on function public.desar_diagnostic(text, uuid, jsonb, text, text) from public, anon;
grant execute on function public.desar_diagnostic(text, uuid, jsonb, text, text) to authenticated, service_role;
comment on function public.desar_diagnostic(text, uuid, jsonb, text, text) is
  'Guarda (sobrescribe) el diagnóstico operativo de un productor en `diagnostics` (A1). Solo el equipo (42501 a cualquier externo, también sobre la suya: D5). 22023: tipo desconocido, nomes_productors, fitxa_inexistent, sense_questionari, massa_productes, ubicacio_aliena. Ya no escribe planes_prevencion ni diagnostics_historial (P10).';

-- ---------------------------------------------------------------------------
-- 5. El estado: cuatro valores, leído de `diagnostics`
-- ---------------------------------------------------------------------------
-- Mismas claves que la vigente (las del plan salen a null/0/false) más `actualitzat_at`,
-- `actualitzat_per_nom` y `diagnostic_id`. `falten` se calcula contra el cuestionario
-- VIGENTE, igual que antes: es «lo que falta hoy» (si se publica una versión nueva con
-- preguntas obligatorias nuevas, el diagnóstico vuelve a «incomplet»).
create or replace function public.diagnostic_estat(p_tipo_org text, p_org uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q        questionaris_diagnostic%rowtype;
  d        diagnostics%rowtype;
  v_falten text[] := '{}';
  v_estat  text;
  v_nom    text;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  -- El productor sigue leyendo el suyo: la guarda es la de siempre.
  if not public.puc_gestionar_pla(p_tipo_org, p_org) then
    raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
  end if;

  -- Una entidad receptora no tiene diagnóstico (fase 9): `q` y `d` se quedan vacíos.
  if p_tipo_org = 'productor' then
    select * into q from questionaris_diagnostic where tipo_org = 'productor' and vigente limit 1;
    select * into d from diagnostics where productor_id = p_org;
  end if;

  if d.id is not null and q.id is not null then
    v_falten := public.diagnostic_falten(q.preguntes, d.respostes);
  end if;

  v_estat := case
    when q.id is null then 'sense_questionari'
    when d.id is null then 'sense_comencar'
    when coalesce(array_length(v_falten, 1), 0) > 0 then 'incomplet'
    else 'complet'
  end;

  if d.actualitzat_per is not null then
    select nullif(btrim(p.nombre), '') into v_nom
      from perfiles p where p.id = d.actualitzat_per;
  end if;

  return jsonb_build_object(
    'estat',                 v_estat,
    'diagnostic_id',         d.id,
    'pla_esborrany',         null,
    'pla_vigent',            null,
    'numero',                null,
    'versio',                null,
    'emes_at',               null,
    'nivell',                null,
    'idioma',                case when d.id is not null then coalesce(d.idioma, 'ca') end,
    'falten',                to_jsonb(v_falten),
    'te_mesures',            false,
    'mesures_n',             0,
    'mesures_editades',      false,
    'questionari_id',        q.id,
    'versio_questionari',    q.versio,
    'darrera_actualitzacio', d.actualitzat_at,
    'actualitzat_at',        d.actualitzat_at,
    'actualitzat_per_nom',   v_nom,
    'provisional',           coalesce(q.provisional, true));
end;
$function$;
revoke execute on function public.diagnostic_estat(text, uuid) from public, anon;
grant execute on function public.diagnostic_estat(text, uuid) to authenticated, service_role;
comment on function public.diagnostic_estat(text, uuid) is
  'Estado del diagnóstico de un productor (A1): sense_questionari · sense_comencar · incomplet · complet. Una entidad → sense_questionari. Las claves del plan básico salen a null/0/false (compatibilidad). puc_gestionar_pla().';

-- La bandeja del equipo: mismo `returns table` (sin drop), leída de `diagnostics`.
-- Invoker: la RLS de `diagnostics` (equipo) le basta.
create or replace function public.diagnostics_equip()
 returns table(tipo_org text, org_id uuid, nom text, es_test boolean, estat text, falten_n integer,
   mesures_n integer, pla_esborrany uuid, pla_vigent uuid, numero text, versio integer,
   emes_at timestamp with time zone, versio_questionari integer, provisional boolean,
   darrera_actualitzacio timestamp with time zone)
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
#variable_conflict use_column
-- Todas las referencias van cualificadas; el pragma cubre la que se cuele (20270328101700).
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
  ),
  base as (
    select f.tipo_org, f.org_id, f.nom, f.es_test,
           q.id as q_id, q.versio as q_versio, q.provisional as q_provisional,
           dg.id as d_id, dg.actualitzat_at,
           case when q.id is not null and dg.id is not null
                then coalesce(array_length(public.diagnostic_falten(q.preguntes, dg.respostes), 1), 0)
                else 0 end as n_falten
      from fitxes f
      left join q on q.tipo_org = f.tipo_org
      left join diagnostics dg on dg.productor_id = f.org_id
  )
  select
    b.tipo_org,
    b.org_id,
    b.nom,
    b.es_test,
    case
      when b.q_id is null then 'sense_questionari'
      when b.d_id is null then 'sense_comencar'
      when b.n_falten > 0 then 'incomplet'
      else 'complet'
    end,
    b.n_falten,
    0,
    null::uuid,
    null::uuid,
    null::text,
    null::integer,
    null::timestamptz,
    b.q_versio,
    b.q_provisional,
    b.actualitzat_at
  from base b
  order by b.nom;
end;
$function$;
revoke execute on function public.diagnostics_equip() from public, anon;
grant execute on function public.diagnostics_equip() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Leer el diagnóstico entero (la ficha, el resumen del productor y el PDF de A2)
-- ---------------------------------------------------------------------------
-- El permiso va ANTES que la existencia (§4bis): un uuid inventado da 42501 a quien no puede.
--   · Con sesión: `puc_gestionar_pla()` (el equipo, o la cuenta de ese productor).
--   · Con `service_role` (Edge Function): `p_user` obligatorio y la MISMA comprobación para
--     ese usuario (patrón de `expedients_meus(p_user)`); un `p_user` ajeno con sesión → 42501.
create or replace function public.diagnostic_datos(p_tipo_org text, p_org uuid, p_user uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q     questionaris_diagnostic%rowtype;
  d     diagnostics%rowtype;
  v_org jsonb;
  v_nom text;
begin
  if auth.uid() is not null then
    if p_user is not null and p_user <> auth.uid() then
      raise exception 'No pots consultar el diagnostic com una altra persona' using errcode = '42501';
    end if;
    if not public.puc_gestionar_pla(p_tipo_org, p_org) then
      raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
    end if;
  else
    if p_user is null then
      raise exception 'falta_usuari: cal dir per a qui es la lectura' using errcode = '22023';
    end if;
    -- Lo mismo que `es_intern()` y `mis_productores()/mis_entidades()`, para `p_user`.
    if not (
         not public.roles_activos()
      or exists (select 1 from usuario_roles r join perfiles p on p.id = r.user_id
                  where r.user_id = p_user and p.activo
                    and r.rol in ('super_admin', 'admin', 'tecnic'))
      or exists (select 1 from membresias m join perfiles p on p.id = m.user_id
                  where m.user_id = p_user and m.activo and m.aprovacio = 'aprovada' and p.activo
                    and ((p_tipo_org = 'productor' and m.productor_id = p_org)
                      or (p_tipo_org <> 'productor' and m.entidad_id = p_org)))) then
      raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
    end if;
  end if;

  if p_tipo_org is distinct from 'productor' then
    raise exception 'nomes_productors: el diagnostic operatiu es de les entitats productores'
      using errcode = '22023';
  end if;
  select jsonb_build_object('nom', coalesce(pr.empresa, pr.name), 'nif', pr.nif, 'municipi', pr.poblacion)
    into v_org from productores pr where pr.id = p_org;
  if v_org is null then
    raise exception 'fitxa_inexistent' using errcode = '22023';
  end if;

  select * into d from diagnostics where productor_id = p_org;
  -- El cuestionario con el que se contestó; si no hay diagnóstico, el vigente.
  if d.questionari_id is not null then
    select * into q from questionaris_diagnostic where id = d.questionari_id;
  else
    select * into q from questionaris_diagnostic where tipo_org = 'productor' and vigente limit 1;
  end if;
  if d.actualitzat_per is not null then
    select nullif(btrim(p.nombre), '') into v_nom
      from perfiles p where p.id = d.actualitzat_per;
  end if;

  return jsonb_build_object(
    'diagnostic_id',       d.id,
    'organitzacio',        v_org,
    'questionari',         case when q.id is not null then
                             jsonb_build_object('titol', q.titol, 'versio', q.versio, 'provisional', q.provisional)
                           end,
    'respostes',           coalesce(d.sobre -> 'respostes', '[]'::jsonb),
    'notes',               d.notes,
    'complet',             coalesce(d.complet, false),
    'falten',              to_jsonb(coalesce(d.falten, '{}'::text[])),
    'actualitzat_at',      d.actualitzat_at,
    'actualitzat_per_nom', v_nom,
    'provisional',         coalesce(q.provisional, true));
end;
$function$;
revoke execute on function public.diagnostic_datos(text, uuid, uuid) from public, anon;
grant execute on function public.diagnostic_datos(text, uuid, uuid) to authenticated, service_role;
comment on function public.diagnostic_datos(text, uuid, uuid) is
  'El diagnóstico de un productor para leerlo (A1): organitzacio, questionari, respostes (legibles, del sobre), notes, complet, falten, actualitzat_at/per_nom, provisional. Con sesión: puc_gestionar_pla(); con service_role: p_user obligatorio (22023 falta_usuari) y la misma comprobación para él. 42501 antes que 22023 nomes_productors / fitxa_inexistent.';

-- ---------------------------------------------------------------------------
-- 7. El expediente cita el diagnóstico
-- ---------------------------------------------------------------------------
alter table public.expedients_prevencion
  add column if not exists diagnostic_id uuid references public.diagnostics(id) on delete set null;
comment on column public.expedients_prevencion.diagnostic_id is
  'El diagnóstico del productor al abrir el expediente (A1). Su contenido entra en el PDF (expedient_datos.diagnostic).';

-- `pla_id`: solo el plan VIGENTE (el borrador ya no existe); `diagnostic_id`: el diagnóstico.
create or replace function public.obrir_expedient(p_tipo_org text, p_org uuid, p_nivell text default 'basic'::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id   uuid;
  v_pla  uuid;
  v_diag uuid;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Obrir un expedient de prevencio es de l''admin' using errcode = '42501';
  end if;
  if p_tipo_org is distinct from 'productor' then
    raise exception 'nomes_productors: el pla de prevencio es de les entitats productores' using errcode = '22023';
  end if;
  if p_nivell not in ('basic', 'personalitzat') then
    raise exception 'nivell_desconegut' using errcode = '22023';
  end if;
  if not exists (select 1 from productores where id = p_org) then
    raise exception 'fitxa_inexistent' using errcode = '22023';
  end if;
  if exists (select 1 from expedients_prevencion
              where productor_id = p_org and estat <> 'tancat') then
    raise exception 'ja_te_expedient: aquesta organitzacio ja te un expedient obert' using errcode = '22023';
  end if;

  select id into v_pla from planes_prevencion
   where productor_id = p_org and vigente
   limit 1;
  select id into v_diag from diagnostics where productor_id = p_org;

  insert into expedients_prevencion (tipo_org, productor_id, nivell, tecnic_id, pla_id, diagnostic_id, created_by)
  values ('productor', p_org, p_nivell, auth.uid(), v_pla, v_diag, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

-- `diagnostic`: el del expediente o, si se abrió antes de que lo hubiera, el actual del
-- productor (es uno por productor: D1). Solo cuando lo hay. `mesures_pla_basic` solo sale
-- llena si el expediente cita un plan (los emitidos antes de A1).
create or replace function public.expedient_datos(p_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  ex    expedients_prevencion;
  par   parametros_documentales%rowtype;
  v_org jsonb;
  pl    planes_prevencion%rowtype;
  dg    diagnostics%rowtype;
  v_q_provisional boolean;
  v_out jsonb;
begin
  select * into ex from expedients_prevencion where id = p_id;
  if ex.id is null then
    raise exception 'expedient_inexistent' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;
  select jsonb_build_object('tipus', 'productor', 'nom', coalesce(pr.empresa, pr.name),
                            'rao_social', pr.razon_social, 'nif', pr.nif, 'poblacio', pr.poblacion,
                            'comarca', pr.area_geografica, 'email', pr.email)
    into v_org from productores pr where pr.id = ex.productor_id;
  if ex.pla_id is not null then
    select * into pl from planes_prevencion where id = ex.pla_id;
  end if;
  if ex.diagnostic_id is not null then
    select * into dg from diagnostics where id = ex.diagnostic_id;
  end if;
  if dg.id is null and ex.productor_id is not null then
    select * into dg from diagnostics where productor_id = ex.productor_id;
  end if;
  if dg.id is not null then
    select qd.provisional into v_q_provisional from questionaris_diagnostic qd where qd.id = dg.questionari_id;
  end if;

  v_out := jsonb_build_object(
    'format', 'expedient',
    'tipus', 'PLA',
    'nivell', ex.nivell,
    'estat', ex.estat,
    'numero', ex.numero_completo,
    'versio', ex.versio_document,
    'exercici', ex.ejercicio,
    'data_generacio', now(),
    'data_inici', ex.data_inici,
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'organitzacio', v_org,
    'tecnic', (select coalesce(p.nombre, p.email) from perfiles p where p.id = ex.tecnic_id),
    'objectius_estrategics', to_jsonb(ex.objectius_estrategics),
    'context', ex.context,
    'equip', ex.equip,
    'mesures_pla_basic', case when pl.id is not null
                              then coalesce(pl.mesures -> 'llista', '[]'::jsonb)
                              else '[]'::jsonb end,
    'visites', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.data)
                           from pla_visites v where v.expedient_id = p_id), '[]'::jsonb),
    'processos', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.ordre, v.created_at)
                             from pla_processos v where v.expedient_id = p_id), '[]'::jsonb),
    'quantificacio', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.mes, v.producte)
                                 from pla_quantificacio v where v.expedient_id = p_id), '[]'::jsonb),
    'objectius', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.created_at)
                             from pla_objectius v where v.expedient_id = p_id), '[]'::jsonb),
    'accions', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.data_objectiu nulls last, v.created_at)
                           from pla_accions v where v.expedient_id = p_id), '[]'::jsonb),
    'seguiments', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.trimestre)
                              from pla_seguiments v where v.expedient_id = p_id), '[]'::jsonb),
    'verificacions', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' - 'verificat_per' order by v."any")
                                 from pla_verificacions v where v.expedient_id = p_id), '[]'::jsonb));

  if dg.id is not null then
    v_out := v_out || jsonb_build_object('diagnostic', jsonb_build_object(
      'respostes',      coalesce(dg.sobre -> 'respostes', '[]'::jsonb),
      'actualitzat_at', dg.actualitzat_at,
      'provisional',    coalesce(v_q_provisional,
                                 (dg.sobre ->> 'questionari_provisional')::boolean, true)));
  end if;
  return v_out;
end;
$function$;
-- Sigue siendo solo del servidor (`generar-documento` compone el PDF con el snapshot).
revoke execute on function public.expedient_datos(uuid) from public, anon, authenticated;
grant execute on function public.expedient_datos(uuid) to service_role;

-- El idioma del PDF: el del plan (expedientes anteriores a A1), el del diagnóstico o catalán.
create or replace function public.exportar_expedient(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  ex      expedients_prevencion;
  v_ej    int;
  v_n     int;
  v_prev  uuid;
  v_doc   uuid;
  v_datos jsonb;
  v_idioma text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Exportar el pla de prevencio es de l''admin' using errcode = '42501';
  end if;
  select * into ex from expedients_prevencion where id = p_id for update;
  if ex.id is null then
    raise exception 'expedient_inexistent' using errcode = '22023';
  end if;

  if ex.numero_completo is null then
    v_ej := extract(year from (now() at time zone 'Europe/Madrid'))::int;
    v_n  := public.siguiente_numero('PLA', v_ej);
    update expedients_prevencion
       set serie = 'PLA', ejercicio = v_ej, numero = v_n,
           numero_completo = public.formato_numero('PLA', v_ej, v_n)
     where id = p_id
    returning * into ex;
  end if;

  update expedients_prevencion
     set versio_document = versio_document + 1, exportat_at = now(), updated_at = now()
   where id = p_id
  returning * into ex;

  select id into v_prev from documentos
   where objeto_tipo = 'expedient' and objeto_id = p_id and tipo = 'PLA' and vigente;
  if v_prev is not null then
    update documentos set vigente = false where id = v_prev;
  end if;

  v_datos := public.expedient_datos(p_id);
  v_idioma := coalesce(
    (select pl.idioma from planes_prevencion pl where pl.id = ex.pla_id),
    (select dg.idioma from diagnostics dg
      where dg.id = ex.diagnostic_id
         or (ex.diagnostic_id is null and dg.productor_id = ex.productor_id)
      limit 1),
    'ca');

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos, ruta, envio, emitido_por
  ) values (
    'PLA', 'emes', 'expedient', p_id,
    ex.numero_completo, ex.versio_document, ex.serie, ex.ejercicio,
    'real', v_idioma, null, v_datos,
    encode(sha256(convert_to(v_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('expedient', p_id, 'PLA', ex.numero_completo, ex.versio_document, 'real', ex.ejercicio),
    null, auth.uid()
  ) returning id into v_doc;

  if v_prev is not null then
    update documentos set sustituido_por = v_doc where id = v_prev;
  end if;

  return jsonb_build_object('document', v_doc, 'numero', ex.numero_completo, 'versio', ex.versio_document,
                            'descarrega_immediata', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Backfill (misma transacción): borradores → diagnostics + historial, y fuera
-- ---------------------------------------------------------------------------
do $backfill$
declare
  pl      planes_prevencion%rowtype;
  q       questionaris_diagnostic%rowtype;
  qv      questionaris_diagnostic%rowtype;
  h       diagnostics_historial%rowtype;
  v_resp  jsonb;
  v_sobre jsonb;
  v_falt  text[];
  v_at    timestamptz;
  v_per   uuid;
begin
  select * into qv from questionaris_diagnostic where tipo_org = 'productor' and vigente limit 1;

  -- 8.1a Productores con borrador: el borrador es lo último que se guardó.
  for pl in select * from planes_prevencion
             where estado = 'esborrany' and tipo_org = 'productor' order by created_at loop
    select * into q from questionaris_diagnostic where id = pl.questionari_id;
    -- Formato v0 (sin `respostes_crues`): `respostes_planes()` convierte `respostes[]` en
    -- el mapa {id: valor} que reabre el formulario.
    v_resp := public.respostes_planes(pl.respuestas);
    if jsonb_typeof(v_resp) <> 'object' then
      v_resp := '{}'::jsonb;
    end if;
    v_falt := case when coalesce(q.id, qv.id) is null then '{}'::text[]
                   else public.diagnostic_falten(coalesce(q.preguntes, qv.preguntes), v_resp) end;
    -- «El último guardado»: el historial si es igual o más reciente que el borrador.
    select * into h from diagnostics_historial
     where productor_id = pl.productor_id order by desat_at desc limit 1;
    if h.id is not null and h.desat_at >= pl.updated_at then
      v_at := h.desat_at; v_per := h.desat_per;
    else
      v_at := pl.updated_at; v_per := pl.creado_por;
    end if;
    v_sobre := pl.respuestas;
    if not (v_sobre ? 'respostes_crues') then
      v_sobre := v_sobre || jsonb_build_object('respostes_crues', v_resp);
    end if;

    insert into diagnostics (
      productor_id, questionari_id, versio_questionari, respostes, sobre, complet, falten,
      notes, idioma, actualitzat_at, actualitzat_per, created_at)
    values (
      pl.productor_id, q.id, q.versio, v_resp, v_sobre,
      coalesce(q.id, qv.id) is not null and coalesce(array_length(v_falt, 1), 0) = 0, v_falt,
      pl.respuestas ->> 'notes', pl.idioma, v_at, v_per, pl.created_at)
    on conflict (productor_id) do nothing;
  end loop;

  -- 8.1b Productores sin borrador pero con historial: la última fila, con el sobre compuesto
  --      contra SU cuestionario.
  for h in select distinct on (dh.productor_id) dh.*
             from diagnostics_historial dh
            where dh.tipo_org = 'productor'
              and not exists (select 1 from diagnostics d where d.productor_id = dh.productor_id)
            order by dh.productor_id, dh.desat_at desc loop
    select * into q from questionaris_diagnostic where id = h.questionari_id;
    v_resp := case when jsonb_typeof(h.respostes) = 'object' then h.respostes else '{}'::jsonb end;
    v_sobre := public.diagnostic_compon_sobre(q, h.productor_id, v_resp, h.notes)
               || jsonb_build_object('desat_at', h.desat_at);
    insert into diagnostics (
      productor_id, questionari_id, versio_questionari, respostes, sobre, complet, falten,
      notes, idioma, actualitzat_at, actualitzat_per, created_at)
    values (
      h.productor_id, q.id, coalesce(h.versio_questionari, q.versio), v_resp, v_sobre,
      h.complet, h.falten, h.notes, null, h.desat_at, h.desat_per, h.desat_at)
    on conflict (productor_id) do nothing;
  end loop;
end;
$backfill$;

-- 8.2 Cada borrador (productor o entidad) deja una fila en el historial si no hay ninguna
--     igual o más reciente: no se pierde el de las entidades, y el frontend publicado ve lo
--     último cuando cae al historial.
insert into public.diagnostics_historial (
  tipo_org, productor_id, entidad_id, questionari_id, versio_questionari,
  respostes, complet, falten, notes, desat_per, desat_at)
select pl.tipo_org, pl.productor_id, pl.entidad_id, q.id, q.versio,
       public.respostes_planes(pl.respuestas),
       q.id is not null
         and coalesce(array_length(public.diagnostic_falten(q.preguntes, public.respostes_planes(pl.respuestas)), 1), 0) = 0,
       case when q.id is null then '{}'::text[]
            else public.diagnostic_falten(q.preguntes, public.respostes_planes(pl.respuestas)) end,
       pl.respuestas ->> 'notes', pl.creado_por, pl.updated_at
  from public.planes_prevencion pl
  left join public.questionaris_diagnostic q on q.id = pl.questionari_id
 where pl.estado = 'esborrany'
   and not exists (
         select 1 from public.diagnostics_historial h
          where h.tipo_org = pl.tipo_org
            and coalesce(h.productor_id, h.entidad_id) = coalesce(pl.productor_id, pl.entidad_id)
            and h.desat_at >= pl.updated_at);

-- 8.3 Los expedientes citan el diagnóstico de su productor.
update public.expedients_prevencion ex
   set diagnostic_id = d.id
  from public.diagnostics d
 where d.productor_id = ex.productor_id
   and ex.diagnostic_id is null;

-- 8.4 Fuera los borradores (`trg_planes_no_esborrar` deja borrar los que no tienen número;
--     un `pla_id` que los citara pasa a NULL por su FK).
delete from public.planes_prevencion where estado = 'esborrany';

-- ---------------------------------------------------------------------------
-- 9. Retirada del plan básico (T2, D4)
-- ---------------------------------------------------------------------------
-- Quedan para `service_role` (el script de fixtures emite planes con ellas).
revoke execute on function public.generar_pla_des_de_diagnostic(text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.emitir_plan_basico(uuid)                           from public, anon, authenticated;
revoke execute on function public.desar_mesures_pla(uuid, jsonb, text)                from public, anon, authenticated;
revoke execute on function public.fixar_nivell_pla(uuid, text)                        from public, anon, authenticated;
revoke execute on function public.guardar_plan_basico(text, uuid, jsonb, text, text)  from public, anon, authenticated;
grant execute on function public.generar_pla_des_de_diagnostic(text, uuid, boolean) to service_role;
grant execute on function public.emitir_plan_basico(uuid)                           to service_role;
grant execute on function public.desar_mesures_pla(uuid, jsonb, text)                to service_role;
grant execute on function public.fixar_nivell_pla(uuid, text)                        to service_role;
grant execute on function public.guardar_plan_basico(text, uuid, jsonb, text, text)  to service_role;

-- El editor de medidas y reglas hacía `update` directo (hallazgo 2): se le quita el GRANT y
-- queda la lectura. Las políticas de escritura se quedan (sin GRANT no alcanzan a nadie).
revoke insert, update on public.mesures_prevencio from authenticated;
revoke insert, update on public.regles_pla        from authenticated;

comment on table public.mesures_prevencio is
  'Catálogo de medidas de prevención. Se retira con activa=false, nunca se borra: un plan emitido cita su código. Sense camí en pantalla des de 20270520100000 (A1, D4): solo lectura para sesiones.';
comment on table public.regles_pla is
  'De una respuesta a una medida. La evalúa generar_pla_des_de_diagnostic() en SQL (solo service_role). Sense camí en pantalla des de 20270520100000 (A1, D4): solo lectura para sesiones.';
comment on table public.planes_prevencion is
  'Plan de prevención básico de una organización (histórico). Sense camí en pantalla des de 20270520100000 (A1, D4): el plan es el expediente (expedients_prevencion) y el diagnóstico vive en diagnostics. Los borradores se borraron en esa migración; quedan los emitidos y sustituidos.';
comment on table public.diagnostics_historial is
  'Historial del diagnóstico (fase 9). Deja de escribirse en 20270520100000 (A1, P10): se conserva para leer; drop pendiente.';
