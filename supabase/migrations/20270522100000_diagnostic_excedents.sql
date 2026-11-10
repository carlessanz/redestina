-- =============================================================================
-- Plan 2 · A3 (10-11-2026): excedentes por producto principal × causa, gestión actual por
-- causa y una acción por destino con estado y seguimiento.
-- =============================================================================
--
-- Filas 2.3 y 2.4 de la Taula mestra (captura de Sebas, 09-11) y D7. Tras A4, el cuestionario
-- v3 del productor tenía 8 preguntas de excedentes GENERALES con un vocabulario de causas propio
-- que no cruzaba con las ofertas. A3 lo sustituye por un registro en TABLAS PROPIAS:
--   · `diagnostic_productes`  — un bloque por producto (principal hoy, o conservado): «sense
--                               excedent» u observaciones.
--   · `diagnostic_excedents`  — producto × causa del catálogo `causas` (el MISMO código que
--                               `excedentes.causa_codigo`: el diagnóstico cruza con las ofertas):
--                               frecuencia, kg (P7: libres, «aproximat, cada vegada»), gestión
--                               actual, destinos de interés (= modalidades) y `detall`.
--   · `diagnostic_accions`    — UNA acción por destino marcado (decisión b), con estado
--                               (pendent · en_curs · feta · descartada) y nota de seguimiento.
--
-- D5: lo escribe SOLO el equipo, por RPC (`desar_excedents_diagnostic`, `fixar_estat_accio`);
--     la organización lo LEE (RLS de solo lectura). Sin escritura directa para nadie con sesión.
-- D7: el diagnóstico habla el idioma de las ofertas: causa = `causas.codigo`, destino =
--     modalidad (donacio · venda · maquila).
--
-- Decisiones de Carles (10-11):
--   (a) si un producto deja de ser principal, su bloque, sus excedentes y sus acciones SE
--       CONSERVAN (la pantalla los pone aparte, «Ja no és principal», con botón para quitarlos);
--       no cuentan para `complet`. Por eso `producte_fora_principals` solo salta al CREAR un
--       bloque nuevo de un no-principal.
--   (b) una acción por destino: unicidad (excedent_id, desti); una acción con texto vacío no
--       existe (se borra si estaba).
--   (c) la pestaña Configuració › Diagnòstic se retira (frontend); `publicar_questionari` no se
--       revoca, así que el arnés no cambia ningún `permitir`.
-- Desviaciones aprobadas del texto del plan:
--   · `causa_altres` → `detall` (texto libre por causa, ≤500): el catálogo `causas` no tiene
--     «Altres» y añadirlo cambiaría la lista del intake publicado.
--   · P11: el frontend nuevo deja de llamar a `desar_diagnostic`; una sola RPC guarda
--     excedentes, notas e idioma en una transacción. `desar_diagnostic` se conserva (misma
--     firma) SOLO para la ventana base → frontend y ya no exige cuestionario vigente. Deuda 175:
--     `drop` de `desar_diagnostic` y del motor (`questionari_vigent`, `publicar_questionari`,
--     `questionari_problemes`, `diagnostic_falten`, `diagnostic_compon_sobre`), con autorización.
--   · `diagnostic_accions` lleva `actualitzat_at/actualitzat_per` (quién cambió el estado por
--     última vez).
--
-- `complet` deja de depender del cuestionario: lo calcula `diagnostic_falten_productor()` en
-- vivo (Operativa de la ficha + excedentes de los principales de HOY), así que un cambio de la
-- Operativa se refleja en la bandeja sin volver a guardar el diagnóstico.
--
-- VENTANA BASE → FRONTEND (el publicado es A2): el formulario viejo encuentra «sense
-- qüestionari» (el v3 queda `vigente = false`, sin v4) y ya no puede contestar las 8 preguntas
-- —lo buscado: ya no existen—; su «Desa» sigue sin error (`desar_diagnostic` guarda notas e
-- idioma). Resumen, bandeja, ficha y PDF siguen cargando: las funciones redefinidas conservan
-- firma, `returns` y claves, y solo AÑADEN claves (`excedents`, `excedents_n`,
-- `accions_pendents`), que el código publicado ignora.
--
-- Compatible hacia atrás y solo aditiva. Idempotente: se puede aplicar dos veces.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catálogo `causas`: el nombre en castellano en la base
-- ---------------------------------------------------------------------------
-- Hasta hoy vivía solo en `CAUSES_ES` (`supabase/functions/_shared/camposOferta.ts`), que se
-- conserva para el intake y `crear-oferta`. Mismos valores; un test de paridad los vigila.
alter table public.causas add column if not exists nombre_es text;
comment on column public.causas.nombre_es is
  'Nombre de la causa en castellano (A3, 20270522100000). Mismos valores que CAUSES_ES de _shared/camposOferta.ts (test de paridad). `nombre` es el catalán.';

update public.causas c
   set nombre_es = v.nombre_es
  from (values
    ('CE', 'Criterios estéticos'),
    ('CL', 'Clima'),
    ('CN', 'Canalización'),
    ('EX', 'Excedente'),
    ('FC', 'Final de cultivo'),
    ('GD', 'Gestión deficiente'),
    ('MQ', 'Maquila'),
    ('PR', 'Precio')
  ) as v(codigo, nombre_es)
 where c.codigo = v.codigo
   and c.nombre_es is distinct from v.nombre_es;

-- ---------------------------------------------------------------------------
-- 2. Las tres tablas
-- ---------------------------------------------------------------------------
-- Las tres cuelgan de `productores` con `on delete cascade` (directo o por la FK compuesta):
-- `borrar_ficha_completa()` las arrastra sin tocar su código.
create table if not exists public.diagnostic_productes (
  id              uuid primary key default gen_random_uuid(),
  productor_id    uuid not null references public.productores(id) on delete cascade,
  producte        text not null,
  sense_excedent  boolean not null default false,
  observacions    text,
  created_at      timestamptz not null default now(),
  constraint diagnostic_productes_unic unique (productor_id, producte),
  constraint diagnostic_productes_producte check (producte = btrim(producte) and producte <> ''),
  constraint diagnostic_productes_observacions check (char_length(observacions) <= 2000)
);
comment on table public.diagnostic_productes is
  'Diagnòstic (A3, 20270522100000): un bloque por producto del productor (principal hoy o conservado, decisión a): «sense excedent» y observaciones. Solo lectura por RLS (equipo o el propio productor); lo escribe desar_excedents_diagnostic() (equipo, D5).';

create table if not exists public.diagnostic_excedents (
  id               uuid primary key default gen_random_uuid(),
  productor_id     uuid not null references public.productores(id) on delete cascade,
  producte         text not null,
  causa_codi       text not null references public.causas(codigo),
  frequencia       text,
  volum_kg         numeric,
  gestio_actual    text[],
  destins_interes  text[] not null default '{}'::text[],
  detall           text,
  created_at       timestamptz not null default now(),
  constraint diagnostic_excedents_unic unique (productor_id, producte, causa_codi),
  constraint diagnostic_excedents_bloc foreign key (productor_id, producte)
    references public.diagnostic_productes (productor_id, producte) on delete cascade,
  constraint diagnostic_excedents_frequencia check (
    frequencia in ('puntual', 'estacional', 'mensual', 'setmanal', 'varies_setmana')),
  constraint diagnostic_excedents_volum_kg check (volum_kg >= 0),
  constraint diagnostic_excedents_gestio_actual check (
    gestio_actual <@ array['venda_alternativa', 'donacio', 'transformacio', 'altres_aprofitaments', 'residu', 'altres']),
  constraint diagnostic_excedents_destins check (
    destins_interes <@ array['donacio', 'venda', 'maquila']),
  constraint diagnostic_excedents_detall check (char_length(detall) <= 500)
);
comment on table public.diagnostic_excedents is
  'Diagnòstic (A3, 20270522100000): excedente por producto × causa del catálogo `causas` (mismo código que excedentes.causa_codigo, D7). Frecuencia, kg (P7: aproximados, cada vez), gestión actual y destinos de interés (= modalidades) nullable: se guarda a medias y `complet` los exige (diagnostic_falten_productor). `detall` sustituye a «causa_altres». Solo lectura por RLS; lo escribe desar_excedents_diagnostic().';
comment on column public.diagnostic_excedents.volum_kg is
  'Kilos aproximados cada vez que se produce el excedente (P7: «aproximat, cada vegada»; la frecuencia va al lado). Decisión abierta de la Fundació: por vez o anual.';

create table if not exists public.diagnostic_accions (
  id               uuid primary key default gen_random_uuid(),
  excedent_id      uuid not null references public.diagnostic_excedents(id) on delete cascade,
  desti            text not null,
  descripcio       text not null,
  estat            text not null default 'pendent',
  notes            text,
  feta_at          timestamptz,
  feta_per         uuid references auth.users(id) on delete set null,
  actualitzat_at   timestamptz,
  actualitzat_per  uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint diagnostic_accions_unic unique (excedent_id, desti),
  constraint diagnostic_accions_desti check (desti in ('donacio', 'venda', 'maquila')),
  constraint diagnostic_accions_descripcio check (descripcio = btrim(descripcio) and descripcio <> '' and char_length(descripcio) <= 2000),
  constraint diagnostic_accions_estat check (estat in ('pendent', 'en_curs', 'feta', 'descartada')),
  constraint diagnostic_accions_notes check (char_length(notes) <= 2000)
);
comment on table public.diagnostic_accions is
  'Diagnòstic (A3, 20270522100000): UNA acción por destino de un excedente (decisión b), con estado pendent · en_curs · feta · descartada y nota de seguimiento (visible para la organización). El texto lo escribe desar_excedents_diagnostic() (conserva id, estado, notas y feta_* por (excedente, destino)); el estado y la nota, fixar_estat_accio(). Solo equipo (D5). actualitzat_* = quién cambió el estado por última vez.';

-- Índices: los tres `unique` ya indexan por `productor_id` (las dos primeras) y por
-- `excedent_id` (acciones), que es por donde se lee y se borra. Solo falta la FK al catálogo.
create index if not exists diagnostic_excedents_causa_idx on public.diagnostic_excedents (causa_codi);

-- Dos capas (§4): SELECT para `authenticated`, nada de escritura; `anon`, nada.
alter table public.diagnostic_productes enable row level security;
alter table public.diagnostic_excedents enable row level security;
alter table public.diagnostic_accions   enable row level security;
revoke all on public.diagnostic_productes from anon, authenticated;
revoke all on public.diagnostic_excedents from anon, authenticated;
revoke all on public.diagnostic_accions   from anon, authenticated;
grant select on public.diagnostic_productes to authenticated;
grant select on public.diagnostic_excedents to authenticated;
grant select on public.diagnostic_accions   to authenticated;
grant all on public.diagnostic_productes to service_role;
grant all on public.diagnostic_excedents to service_role;
grant all on public.diagnostic_accions   to service_role;

drop policy if exists "diagnostic_productes: equip o propi" on public.diagnostic_productes;
create policy "diagnostic_productes: equip o propi" on public.diagnostic_productes
  for select to authenticated
  using ((select public.es_intern())
         or productor_id in (select public.mis_productores()));

drop policy if exists "diagnostic_excedents: equip o propi" on public.diagnostic_excedents;
create policy "diagnostic_excedents: equip o propi" on public.diagnostic_excedents
  for select to authenticated
  using ((select public.es_intern())
         or productor_id in (select public.mis_productores()));

-- Las acciones heredan la visibilidad de su excedente: la subconsulta pasa por la RLS de
-- `diagnostic_excedents` (que no mira esta tabla: sin recursión).
drop policy if exists "diagnostic_accions: equip o propi" on public.diagnostic_accions;
create policy "diagnostic_accions: equip o propi" on public.diagnostic_accions
  for select to authenticated
  using ((select public.es_intern())
         or excedent_id in (select de.id from public.diagnostic_excedents de));

-- ---------------------------------------------------------------------------
-- 3. Lo que falta: `diagnostic_falten_productor` (security INVOKER)
-- ---------------------------------------------------------------------------
-- Códigos, en este orden:
--   operativa_productes          — sin productos habituales;
--   operativa_principals         — sin productos principales;
--   operativa_lloc               — ningún lugar principal con días o franjas;
--   excedents:<producte>         — principal sin causas ni «sense excedent»;
--   dades:<producte>:<causa>     — a esa causa le falta frecuencia, kg o gestión actual.
-- Solo cuentan los principales de HOY (`productores.productes_principals`), en su orden; los
-- bloques conservados de un ex-principal, no (decisión a). `complet = cardinality(falten) = 0`.
-- Invoker: bajo RLS para quien la llama (la bandeja, que es invoker). Dentro de una `security
-- definer` corre como el propietario y lo ve todo. Una ficha inexistente (o invisible) da los
-- tres códigos de Operativa: nunca sale «completa» por no ver nada.
create or replace function public.diagnostic_falten_productor(p_productor uuid)
 returns text[]
 language sql
 stable
 set search_path to 'public', 'pg_temp'
as $function$
  with pr as (
    select p.productos_habituales as hab, p.productes_principals as pri
      from (select 1) as uno
      left join productores p on p.id = p_productor
  ),
  pri as (
    select u.producte, u.ordre
      from pr, unnest(coalesce(pr.pri, '{}'::text[])) with ordinality as u(producte, ordre)
  ),
  codis as (
    select 0 as g, 0::bigint as o, ''::text as c, 'operativa_productes'::text as codi
      from pr where cardinality(coalesce(pr.hab, '{}'::text[])) = 0
    union all
    select 0, 1, '', 'operativa_principals'
      from pr where cardinality(coalesce(pr.pri, '{}'::text[])) = 0
    union all
    select 0, 2, '', 'operativa_lloc'
     where not exists (
       select 1 from productor_ubicaciones u
        where u.productor_id = p_productor
          and u.es_principal
          and (cardinality(coalesce(u.dies_setmana, '{}'::int[])) > 0
               or (jsonb_typeof(u.franges) = 'array' and jsonb_array_length(u.franges) > 0)))
    union all
    select 1, pri.ordre, '', 'excedents:' || pri.producte
      from pri
     where not exists (
       select 1 from diagnostic_productes dp
        where dp.productor_id = p_productor and dp.producte = pri.producte
          and (dp.sense_excedent
               or exists (select 1 from diagnostic_excedents de
                           where de.productor_id = p_productor and de.producte = pri.producte)))
    union all
    select 1, pri.ordre, de.causa_codi, 'dades:' || pri.producte || ':' || de.causa_codi
      from pri
      join diagnostic_excedents de
        on de.productor_id = p_productor and de.producte = pri.producte
     where de.frequencia is null
        or de.volum_kg is null
        or cardinality(coalesce(de.gestio_actual, '{}'::text[])) = 0
  )
  select coalesce(array_agg(codis.codi order by codis.g, codis.o, codis.c), '{}'::text[]) from codis;
$function$;
revoke execute on function public.diagnostic_falten_productor(uuid) from public, anon;
grant execute on function public.diagnostic_falten_productor(uuid) to authenticated, service_role;
comment on function public.diagnostic_falten_productor(uuid) is
  'Lo que falta del diagnóstico de un productor (A3), en vivo: operativa_productes · operativa_principals · operativa_lloc · excedents:<producte> · dades:<producte>:<causa>. Solo los principales de hoy. Security invoker (bajo RLS de quien llama). complet = cardinality(falten) = 0.';

-- ---------------------------------------------------------------------------
-- 4. El bloque de excedentes en JSON (interno; lo usan las `security definer`)
-- ---------------------------------------------------------------------------
-- [{producte, principal, ordre, sense_excedent, observacions,
--   causes:[{id, causa, causa_nom:{ca,es}, frequencia, volum_kg, gestio_actual, destins, detall,
--            accions:[{id, desti, descripcio, estat, notes, feta_at, actualitzat_at}]}]}]
-- `ordre` = posición (desde 1) en `productes_principals`, null si ya no es principal. Orden:
-- principales por su posición, después los conservados por nombre; causas por código; acciones
-- donacio · venda · maquila. Sin bloques: `[]`.
create or replace function public.diagnostic_excedents_json(p_productor uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with pri as (
    select u.producte, u.ordre
      from productores p, unnest(coalesce(p.productes_principals, '{}'::text[])) with ordinality as u(producte, ordre)
     where p.id = p_productor
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'producte',       dp.producte,
           'principal',      pri.ordre is not null,
           'ordre',          pri.ordre,
           'sense_excedent', dp.sense_excedent,
           'observacions',   dp.observacions,
           'causes', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id',            de.id,
                      'causa',         de.causa_codi,
                      'causa_nom',     jsonb_build_object(
                                         'ca', coalesce(c.nombre, de.causa_codi),
                                         'es', coalesce(c.nombre_es, c.nombre, de.causa_codi)),
                      'frequencia',    de.frequencia,
                      'volum_kg',      de.volum_kg,
                      'gestio_actual', to_jsonb(coalesce(de.gestio_actual, '{}'::text[])),
                      'destins',       to_jsonb(coalesce(de.destins_interes, '{}'::text[])),
                      'detall',        de.detall,
                      'accions', (
                        select coalesce(jsonb_agg(jsonb_build_object(
                                 'id',             a.id,
                                 'desti',          a.desti,
                                 'descripcio',     a.descripcio,
                                 'estat',          a.estat,
                                 'notes',          a.notes,
                                 'feta_at',        a.feta_at,
                                 'actualitzat_at', a.actualitzat_at)
                               order by array_position(array['donacio', 'venda', 'maquila'], a.desti)), '[]'::jsonb)
                          from diagnostic_accions a
                         where a.excedent_id = de.id))
                    order by de.causa_codi), '[]'::jsonb)
               from diagnostic_excedents de
               left join causas c on c.codigo = de.causa_codi
              where de.productor_id = dp.productor_id and de.producte = dp.producte))
         order by pri.ordre nulls last, dp.producte), '[]'::jsonb)
    from diagnostic_productes dp
    left join pri on pri.producte = dp.producte
   where dp.productor_id = p_productor;
$function$;
revoke execute on function public.diagnostic_excedents_json(uuid) from public, anon, authenticated;
grant execute on function public.diagnostic_excedents_json(uuid) to service_role;
comment on function public.diagnostic_excedents_json(uuid) is
  'Interna (A3): los bloques de excedentes de un productor en JSON (productos → causas → acciones). Sin EXECUTE para sesiones: la llaman diagnostic_datos() y expedient_datos(), que ya han autorizado.';

-- ---------------------------------------------------------------------------
-- 5. Guardar los excedentes: `desar_excedents_diagnostic` (solo el equipo, D5)
-- ---------------------------------------------------------------------------
-- p_productes = [{producte, sense_excedent, observacions,
--                 causes:[{causa, frequencia, volum_kg, gestio_actual:[], destins:[], detall,
--                          accions:[{desti, descripcio}]}]}]
-- REEMPLAZA el conjunto del productor en una transacción: lo ausente se borra (en cascada);
-- excedentes por (producte, causa) y acciones por (producte, causa, desti) CONSERVAN id,
-- estado, notas y feta_* (upsert por las claves únicas). Textos con trim; vacío = null; una
-- acción con descripción vacía no existe. Cabecera en `diagnostics`: notas, idioma, complet,
-- falten, actualitzat_*; `sobre` y `respostes` de una fila existente no se tocan.
create or replace function public.desar_excedents_diagnostic(
  p_productor uuid, p_productes jsonb, p_notes text default null::text, p_idioma text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  c_freq    constant text[] := array['puntual', 'estacional', 'mensual', 'setmanal', 'varies_setmana'];
  c_gestio  constant text[] := array['venda_alternativa', 'donacio', 'transformacio', 'altres_aprofitaments', 'residu', 'altres'];
  c_destins constant text[] := array['donacio', 'venda', 'maquila'];
  v_pri     text[];
  b         jsonb;
  c         jsonb;
  a         jsonb;
  v_prod    text;
  v_prods   text[] := '{}';
  v_sense   boolean;
  v_obs     text;
  v_causa   text;
  v_causes  text[];
  v_freq    text;
  v_volum   numeric;
  v_gestio  text[];
  v_destins text[];
  v_detall  text;
  v_desti   text;
  v_desc    text;
  v_accions text[];
  v_exc     uuid;
  v_x       text;
  v_falten  text[];
  d         diagnostics%rowtype;
begin
  -- D5: el diagnóstico lo conduce el equipo. `auth.uid() is null` = `service_role`.
  -- El permiso va ANTES que la existencia (§4bis): un uuid inventado da 42501 a un externo.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'El diagnostic l''actualitza l''equip de Redestina' using errcode = '42501';
  end if;
  -- Bloquea la ficha (sin chocar con las FK que la citan) para serializar dos guardados.
  select coalesce(pr.productes_principals, '{}'::text[]) into v_pri
    from productores pr where pr.id = p_productor
    for no key update;
  if not found then
    raise exception 'fitxa_inexistent' using errcode = '22023';
  end if;
  if p_idioma is not null and p_idioma not in ('ca', 'es') then
    raise exception 'idioma_desconegut: %', p_idioma using errcode = '22023';
  end if;
  if p_productes is null or jsonb_typeof(p_productes) <> 'array' then
    raise exception 'productes_no_llista: p_productes ha de ser una llista de blocs' using errcode = '22023';
  end if;

  for b in select e from jsonb_array_elements(p_productes) as x(e) loop
    if jsonb_typeof(b) <> 'object' then
      raise exception 'productes_no_llista: cada bloc ha de ser un objecte' using errcode = '22023';
    end if;
    v_prod := nullif(btrim(b ->> 'producte'), '');
    if v_prod is null then
      raise exception 'productes_no_llista: un bloc sense producte' using errcode = '22023';
    end if;
    if v_prod = any (v_prods) then
      raise exception 'producte_repetit: %', v_prod using errcode = '22023';
    end if;
    -- Un bloque NUEVO solo de un principal de hoy; uno que ya existe se puede conservar (a).
    if not (v_prod = any (v_pri))
       and not exists (select 1 from diagnostic_productes dp
                        where dp.productor_id = p_productor and dp.producte = v_prod) then
      raise exception 'producte_fora_principals: %', v_prod using errcode = '22023';
    end if;
    v_prods := v_prods || v_prod;

    if coalesce(jsonb_typeof(b -> 'sense_excedent'), 'null') not in ('boolean', 'null') then
      raise exception 'productes_no_llista: sense_excedent ha de ser true/false (%)', v_prod using errcode = '22023';
    end if;
    v_sense := coalesce((b ->> 'sense_excedent')::boolean, false);
    v_obs := nullif(btrim(b ->> 'observacions'), '');
    if char_length(v_obs) > 2000 then
      raise exception 'text_massa_llarg: observacions de % (maxim 2000)', v_prod using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(b -> 'causes'), 'null') not in ('array', 'null') then
      raise exception 'productes_no_llista: causes ha de ser una llista (%)', v_prod using errcode = '22023';
    end if;
    if v_sense and jsonb_array_length(coalesce(nullif(b -> 'causes', 'null'::jsonb), '[]'::jsonb)) > 0 then
      raise exception 'sense_excedent_amb_causes: %', v_prod using errcode = '22023';
    end if;

    insert into diagnostic_productes (productor_id, producte, sense_excedent, observacions)
    values (p_productor, v_prod, v_sense, v_obs)
    on conflict (productor_id, producte) do update
       set sense_excedent = excluded.sense_excedent,
           observacions   = excluded.observacions;

    v_causes := '{}';
    for c in select e from jsonb_array_elements(coalesce(nullif(b -> 'causes', 'null'::jsonb), '[]'::jsonb)) as x(e) loop
      if jsonb_typeof(c) <> 'object' then
        raise exception 'productes_no_llista: cada causa ha de ser un objecte (%)', v_prod using errcode = '22023';
      end if;
      v_causa := nullif(btrim(c ->> 'causa'), '');
      if v_causa is null or not exists (select 1 from causas ca where ca.codigo = v_causa) then
        raise exception 'causa_desconeguda: %', coalesce(v_causa, '(buida)') using errcode = '22023';
      end if;
      if v_causa = any (v_causes) then
        raise exception 'causa_repetida: %:%', v_prod, v_causa using errcode = '22023';
      end if;
      v_causes := v_causes || v_causa;

      v_freq := nullif(btrim(c ->> 'frequencia'), '');
      if v_freq is not null and not (v_freq = any (c_freq)) then
        raise exception 'frequencia_desconeguda: %', v_freq using errcode = '22023';
      end if;

      -- P7: kilos libres ≥ 0. Número, o texto numérico (coma o punto); vacío = sin contestar.
      case coalesce(jsonb_typeof(c -> 'volum_kg'), 'null')
        when 'null' then
          v_volum := null;
        when 'number' then
          v_volum := (c ->> 'volum_kg')::numeric;
        when 'string' then
          v_x := btrim(c ->> 'volum_kg');
          if v_x = '' then
            v_volum := null;
          elsif v_x ~ '^-?[0-9]+([.,][0-9]+)?$' then
            v_volum := replace(v_x, ',', '.')::numeric;
          else
            raise exception 'volum_negatiu: el volum de %:% ha de ser un nombre >= 0', v_prod, v_causa using errcode = '22023';
          end if;
        else
          raise exception 'volum_negatiu: el volum de %:% ha de ser un nombre >= 0', v_prod, v_causa using errcode = '22023';
      end case;
      if v_volum < 0 then
        raise exception 'volum_negatiu: %:%', v_prod, v_causa using errcode = '22023';
      end if;

      if coalesce(jsonb_typeof(c -> 'gestio_actual'), 'null') not in ('array', 'null') then
        raise exception 'productes_no_llista: gestio_actual ha de ser una llista (%:%)', v_prod, v_causa using errcode = '22023';
      end if;
      select array_agg(s.v order by s.i) into v_gestio
        from (select btrim(e) as v, min(i) as i
                from jsonb_array_elements_text(coalesce(nullif(c -> 'gestio_actual', 'null'::jsonb), '[]'::jsonb))
                     with ordinality as x(e, i)
               where btrim(e) <> ''
               group by btrim(e)) s;
      select g into v_x from unnest(coalesce(v_gestio, '{}'::text[])) as g where not (g = any (c_gestio)) limit 1;
      if found then
        raise exception 'gestio_desconeguda: %', v_x using errcode = '22023';
      end if;

      if coalesce(jsonb_typeof(c -> 'destins'), 'null') not in ('array', 'null') then
        raise exception 'productes_no_llista: destins ha de ser una llista (%:%)', v_prod, v_causa using errcode = '22023';
      end if;
      select coalesce(array_agg(s.v order by array_position(c_destins, s.v)), '{}'::text[]) into v_destins
        from (select distinct btrim(e) as v
                from jsonb_array_elements_text(coalesce(nullif(c -> 'destins', 'null'::jsonb), '[]'::jsonb)) as x(e)
               where btrim(e) <> '') s;
      select dd into v_x from unnest(v_destins) as dd where not (dd = any (c_destins)) limit 1;
      if found then
        raise exception 'desti_desconegut: %', v_x using errcode = '22023';
      end if;

      v_detall := nullif(btrim(c ->> 'detall'), '');
      if char_length(v_detall) > 500 then
        raise exception 'text_massa_llarg: detall de %:% (maxim 500)', v_prod, v_causa using errcode = '22023';
      end if;

      insert into diagnostic_excedents (productor_id, producte, causa_codi, frequencia, volum_kg,
                                        gestio_actual, destins_interes, detall)
      values (p_productor, v_prod, v_causa, v_freq, v_volum, v_gestio, v_destins, v_detall)
      on conflict (productor_id, producte, causa_codi) do update
         set frequencia      = excluded.frequencia,
             volum_kg        = excluded.volum_kg,
             gestio_actual   = excluded.gestio_actual,
             destins_interes = excluded.destins_interes,
             detall          = excluded.detall
      returning id into v_exc;

      -- Una acción por destino marcado (b). La de texto vacío no existe.
      if coalesce(jsonb_typeof(c -> 'accions'), 'null') not in ('array', 'null') then
        raise exception 'productes_no_llista: accions ha de ser una llista (%:%)', v_prod, v_causa using errcode = '22023';
      end if;
      v_accions := '{}';
      for a in select e from jsonb_array_elements(coalesce(nullif(c -> 'accions', 'null'::jsonb), '[]'::jsonb)) as x(e) loop
        if jsonb_typeof(a) <> 'object' then
          raise exception 'productes_no_llista: cada accio ha de ser un objecte (%:%)', v_prod, v_causa using errcode = '22023';
        end if;
        v_desc := nullif(btrim(a ->> 'descripcio'), '');
        if v_desc is null then
          continue;
        end if;
        v_desti := nullif(btrim(a ->> 'desti'), '');
        if v_desti is null or not (v_desti = any (c_destins)) then
          raise exception 'desti_desconegut: %', coalesce(v_desti, '(buit)') using errcode = '22023';
        end if;
        if not (v_desti = any (v_destins)) then
          raise exception 'accio_fora_destins: %:%:%', v_prod, v_causa, v_desti using errcode = '22023';
        end if;
        if v_desti = any (v_accions) then
          raise exception 'accio_repetida: %:%:%', v_prod, v_causa, v_desti using errcode = '22023';
        end if;
        if char_length(v_desc) > 2000 then
          raise exception 'text_massa_llarg: accio de %:%:% (maxim 2000)', v_prod, v_causa, v_desti using errcode = '22023';
        end if;
        v_accions := v_accions || v_desti;

        insert into diagnostic_accions (excedent_id, desti, descripcio)
        values (v_exc, v_desti, v_desc)
        on conflict (excedent_id, desti) do update
           set descripcio = excluded.descripcio;
      end loop;
      delete from diagnostic_accions da
       where da.excedent_id = v_exc and not (da.desti = any (v_accions));
    end loop;

    delete from diagnostic_excedents de
     where de.productor_id = p_productor and de.producte = v_prod
       and not (de.causa_codi = any (v_causes));
  end loop;

  -- Lo que no ha llegado, fuera (en cascada: excedentes y acciones).
  delete from diagnostic_productes dp
   where dp.productor_id = p_productor and not (dp.producte = any (v_prods));

  -- La cabecera. `diagnostic_falten_productor` es invoker: aquí corre como el propietario.
  v_falten := public.diagnostic_falten_productor(p_productor);
  insert into diagnostics (productor_id, respostes, sobre, complet, falten, notes, idioma,
                           actualitzat_at, actualitzat_per)
  values (p_productor, '{}'::jsonb, '{"respostes": []}'::jsonb, cardinality(v_falten) = 0, v_falten,
          nullif(btrim(p_notes), ''), p_idioma, now(), auth.uid())
  on conflict (productor_id) do update
     set complet         = excluded.complet,
         falten          = excluded.falten,
         notes           = excluded.notes,
         idioma          = coalesce(excluded.idioma, diagnostics.idioma),
         actualitzat_at  = excluded.actualitzat_at,
         actualitzat_per = excluded.actualitzat_per
  returning * into d;

  return jsonb_build_object(
    'diagnostic_id', d.id,
    'complet',       d.complet,
    'falten',        to_jsonb(v_falten),
    'productes_n',   (select count(*) from diagnostic_productes dp where dp.productor_id = p_productor),
    'excedents_n',   (select count(*) from diagnostic_excedents de where de.productor_id = p_productor),
    'accions_n',     (select count(*) from diagnostic_accions da
                        join diagnostic_excedents de on de.id = da.excedent_id
                       where de.productor_id = p_productor));
end;
$function$;
revoke execute on function public.desar_excedents_diagnostic(uuid, jsonb, text, text) from public, anon;
grant execute on function public.desar_excedents_diagnostic(uuid, jsonb, text, text) to authenticated, service_role;
comment on function public.desar_excedents_diagnostic(uuid, jsonb, text, text) is
  'Guarda los excedentes del diagnóstico de un productor (A3) y la cabecera de diagnostics (notas, idioma, complet, falten). Reemplaza el conjunto conservando id/estado/notas/feta_* por (producte, causa, desti). Solo el equipo: 42501 a cualquier externo (D5), antes que la existencia. 22023: fitxa_inexistent, idioma_desconegut, productes_no_llista, producte_repetit, producte_fora_principals (solo al crear un bloque), sense_excedent_amb_causes, causa_desconeguda, causa_repetida, frequencia_desconeguda, volum_negatiu, gestio_desconeguda, desti_desconegut, accio_fora_destins, accio_repetida, text_massa_llarg. Devuelve {diagnostic_id, complet, falten, productes_n, excedents_n, accions_n}.';

-- ---------------------------------------------------------------------------
-- 6. El estado de una acción: `fixar_estat_accio` (solo el equipo, D5)
-- ---------------------------------------------------------------------------
-- `feta` pone feta_at/feta_per (si ya lo estaba, los conserva); otro estado los limpia.
-- `p_notes` no nulo sustituye la nota (vacía = sin nota); nulo la deja. Siempre actualitzat_*.
create or replace function public.fixar_estat_accio(p_accio uuid, p_estat text, p_notes text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  r diagnostic_accions%rowtype;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'L''estat de les accions del diagnostic el porta l''equip de Redestina' using errcode = '42501';
  end if;
  if p_estat is null or p_estat not in ('pendent', 'en_curs', 'feta', 'descartada') then
    raise exception 'estat_desconegut: %', coalesce(p_estat, '(buit)') using errcode = '22023';
  end if;
  if char_length(btrim(p_notes)) > 2000 then
    raise exception 'text_massa_llarg: notes (maxim 2000)' using errcode = '22023';
  end if;
  select * into r from diagnostic_accions where id = p_accio for update;
  if r.id is null then
    raise exception 'accio_inexistent' using errcode = '22023';
  end if;

  update diagnostic_accions
     set estat           = p_estat,
         feta_at         = case when p_estat <> 'feta' then null
                                when r.estat = 'feta' then r.feta_at
                                else now() end,
         feta_per        = case when p_estat <> 'feta' then null
                                when r.estat = 'feta' then r.feta_per
                                else auth.uid() end,
         notes           = case when p_notes is not null then nullif(btrim(p_notes), '') else notes end,
         actualitzat_at  = now(),
         actualitzat_per = auth.uid()
   where id = p_accio
  returning * into r;

  return to_jsonb(r);
end;
$function$;
revoke execute on function public.fixar_estat_accio(uuid, text, text) from public, anon;
grant execute on function public.fixar_estat_accio(uuid, text, text) to authenticated, service_role;
comment on function public.fixar_estat_accio(uuid, text, text) is
  'Cambia el estado (pendent · en_curs · feta · descartada) y, si llega, la nota de seguimiento de una acción del diagnóstico (A3). Solo el equipo: 42501 a cualquier externo, antes que la existencia. 22023: estat_desconegut, text_massa_llarg, accio_inexistent. Devuelve la fila como jsonb.';

-- ---------------------------------------------------------------------------
-- 7. Redefinidas con la misma firma y las mismas claves (+ nuevas)
-- ---------------------------------------------------------------------------

-- 7.1 `diagnostic_estat`: sense_comencar sin cabecera; complet/incomplet EN VIVO. Una entidad,
--     sense_questionari (fase 9). + `excedents_n`, `accions_pendents` (pendent o en_curs).
--     `questionari_id`/`versio_questionari`, del cuestionario con el que se contestó (o null).
--     `provisional` = ese cuestionario es provisional Y sigue vigente: desde A3 el diagnóstico
--     ya no es el cuestionario provisional, así que uno retirado da false.
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
  v_exc    int := 0;
  v_pend   int := 0;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  -- El productor sigue leyendo el suyo: la guarda es la de siempre.
  if not public.puc_gestionar_pla(p_tipo_org, p_org) then
    raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
  end if;

  if p_tipo_org = 'productor' then
    select * into d from diagnostics where productor_id = p_org;
    if d.questionari_id is not null then
      select * into q from questionaris_diagnostic where id = d.questionari_id;
    end if;
    v_falten := public.diagnostic_falten_productor(p_org);
    select count(*) into v_exc from diagnostic_excedents de where de.productor_id = p_org;
    select count(*) into v_pend
      from diagnostic_accions da join diagnostic_excedents de on de.id = da.excedent_id
     where de.productor_id = p_org and da.estat in ('pendent', 'en_curs');
  end if;

  v_estat := case
    when p_tipo_org <> 'productor' then 'sense_questionari'
    when d.id is null then 'sense_comencar'
    when cardinality(v_falten) > 0 then 'incomplet'
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
    'provisional',           coalesce(q.provisional, false) and coalesce(q.vigente, false),
    'excedents_n',           v_exc,
    'accions_pendents',      v_pend);
end;
$function$;
revoke execute on function public.diagnostic_estat(text, uuid) from public, anon;
grant execute on function public.diagnostic_estat(text, uuid) to authenticated, service_role;
comment on function public.diagnostic_estat(text, uuid) is
  'Estado del diagnóstico de un productor (A3): sense_comencar (sin cabecera) · incomplet · complet, en vivo con diagnostic_falten_productor() (falten = esos códigos, también antes de empezar). Una entidad → sense_questionari. + excedents_n, accions_pendents. Las claves del plan básico salen a null/0/false (compatibilidad). puc_gestionar_pla().';

-- 7.2 `diagnostics_equip`: mismo `returns table` (sin drop), sigue invoker. `estat`/`falten_n`
--     del cálculo nuevo (falten_n = 0 si no se ha empezado, como antes).
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
  with base as (
    select 'productor'::text as b_tipo, pr.id as b_org, coalesce(pr.empresa, pr.name) as b_nom,
           pr.es_test as b_test, dg.id as d_id, dg.actualitzat_at as d_at,
           qd.versio as q_versio,
           coalesce(qd.provisional, false) and coalesce(qd.vigente, false) as q_provisional,
           case when dg.id is not null
                then coalesce(cardinality(public.diagnostic_falten_productor(pr.id)), 0)
                else 0 end as n_falten
      from productores pr
      left join diagnostics dg on dg.productor_id = pr.id
      left join questionaris_diagnostic qd on qd.id = dg.questionari_id
  )
  select
    b.b_tipo,
    b.b_org,
    b.b_nom,
    b.b_test,
    case
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
    b.d_at
  from base b
  order by b.b_nom;
end;
$function$;
revoke execute on function public.diagnostics_equip() from public, anon;
grant execute on function public.diagnostics_equip() to authenticated, service_role;

-- 7.3 `diagnostic_datos`: la de A4 (20270521100000) + `excedents`. `complet`/`falten`, en vivo
--     (los mismos que `diagnostic_estat`); `questionari`, el cuestionario con el que se contestó
--     (ya no hay vigente al que caer); `provisional`, solo si ese cuestionario es provisional Y
--     sigue vigente (misma regla que `diagnostic_estat`). `respostes` (las del v3) se mantiene:
--     la función A2 ya desplegada sigue funcionando en la ventana.
create or replace function public.diagnostic_datos(p_tipo_org text, p_org uuid, p_user uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q        questionaris_diagnostic%rowtype;
  d        diagnostics%rowtype;
  v_org    jsonb;
  v_op     jsonb;
  v_nom    text;
  v_falten text[];
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
  select jsonb_build_object('nom', coalesce(pr.empresa, pr.name), 'nif', pr.nif, 'municipi', pr.poblacion),
         jsonb_build_object(
           'activitat',               to_jsonb(pr.tipus_activitat),
           'productes',               to_jsonb(pr.productos_habituales),
           'principals',              to_jsonb(pr.productes_principals),
           'varietats',               pr.varietats,
           'volum',                   pr.volum_produccio,
           'temporada',               pr.temporada,
           'envasos',                 to_jsonb(pr.envasos_habituals),
           'canals',                  to_jsonb(pr.canals_comercials),
           'clients',                 to_jsonb(pr.tipologia_clients),
           'facturacio_eur',          pr.facturacio_anual_eur,
           'facturacio_rang',         pr.facturacio_rang,
           'volum_comercialitzat_kg', pr.volum_comercialitzat_kg,
           'suport',                  to_jsonb(pr.suport_interes),
           'llocs', (select coalesce(jsonb_agg(jsonb_build_object(
                              'alias', u.alias, 'municipi', u.municipio, 'principal', coalesce(u.es_principal, false),
                              'dies', to_jsonb(u.dies_setmana), 'franges', u.franges, 'horari', u.horario)
                            order by coalesce(u.es_principal, false) desc, coalesce(u.alias, ''), u.id), '[]'::jsonb)
                       from productor_ubicaciones u where u.productor_id = pr.id))
    into v_org, v_op from productores pr where pr.id = p_org;
  if v_org is null then
    raise exception 'fitxa_inexistent' using errcode = '22023';
  end if;

  select * into d from diagnostics where productor_id = p_org;
  -- El cuestionario con el que se contestó (A3: ya no hay vigente al que caer).
  if d.questionari_id is not null then
    select * into q from questionaris_diagnostic where id = d.questionari_id;
  end if;
  if d.actualitzat_per is not null then
    select nullif(btrim(p.nombre), '') into v_nom
      from perfiles p where p.id = d.actualitzat_per;
  end if;
  v_falten := public.diagnostic_falten_productor(p_org);

  return jsonb_build_object(
    'diagnostic_id',       d.id,
    'organitzacio',        v_org,
    'operativa',           v_op,
    'questionari',         case when q.id is not null then
                             jsonb_build_object('titol', q.titol, 'versio', q.versio, 'provisional', q.provisional)
                           end,
    'respostes',           coalesce(d.sobre -> 'respostes', '[]'::jsonb),
    'excedents',           public.diagnostic_excedents_json(p_org),
    'notes',               d.notes,
    'complet',             d.id is not null and cardinality(v_falten) = 0,
    'falten',              to_jsonb(v_falten),
    'actualitzat_at',      d.actualitzat_at,
    'actualitzat_per_nom', v_nom,
    'provisional',         coalesce(q.provisional, false) and coalesce(q.vigente, false));
end;
$function$;
revoke execute on function public.diagnostic_datos(text, uuid, uuid) from public, anon;
grant execute on function public.diagnostic_datos(text, uuid, uuid) to authenticated, service_role;
comment on function public.diagnostic_datos(text, uuid, uuid) is
  'El diagnóstico de un productor para leerlo (A1), su Operativa de la ficha (A4, `operativa`) y sus excedentes (A3, `excedents`, forma de diagnostic_excedents_json): organitzacio, operativa, questionari, respostes (legado v3, del sobre), excedents, notes, complet y falten (en vivo), actualitzat_at/per_nom, provisional (cuestionario contestado provisional y vigente; si no, false). Con sesión: puc_gestionar_pla(); con service_role: p_user obligatorio (22023 falta_usuari) y la misma comprobación para él. 42501 antes que 22023 nomes_productors / fitxa_inexistent.';

-- 7.4 `expedient_datos`: la de A1 (20270520100000) con `excedents` dentro de `diagnostic`, que
--     sale también si hay bloques de excedentes aunque no haya cabecera ni respuestas v3.
--     `provisional`: solo si el cuestionario contestado es provisional Y sigue vigente (misma
--     regla que `diagnostic_estat`); sin cuestionario o retirado, false (antes, true).
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
  v_exc jsonb := '[]'::jsonb;
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
    select coalesce(qd.provisional, false) and coalesce(qd.vigente, false) into v_q_provisional
      from questionaris_diagnostic qd where qd.id = dg.questionari_id;
  end if;
  if ex.productor_id is not null then
    v_exc := public.diagnostic_excedents_json(ex.productor_id);
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

  if dg.id is not null or jsonb_array_length(v_exc) > 0 then
    v_out := v_out || jsonb_build_object('diagnostic', jsonb_build_object(
      'respostes',      coalesce(dg.sobre -> 'respostes', '[]'::jsonb),
      'excedents',      v_exc,
      'actualitzat_at', dg.actualitzat_at,
      'provisional',    coalesce(v_q_provisional, false)));
  end if;
  return v_out;
end;
$function$;
-- Sigue siendo solo del servidor (`generar-documento` compone el PDF con el snapshot).
revoke execute on function public.expedient_datos(uuid) from public, anon, authenticated;
grant execute on function public.expedient_datos(uuid) to service_role;

-- 7.5 `desar_diagnostic`: SOLO para la ventana base → frontend (deuda 175). Ya no exige
--     cuestionario vigente: sin él, guarda la cabecera (notas, idioma) y recalcula complet/falten
--     con el cálculo nuevo; con él (si alguien publicara uno), lo de antes, pero complet/falten
--     también del cálculo nuevo. Misma firma y mismas claves de vuelta.
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
    -- A3: sin cuestionario vigente. Solo la cabecera; `sobre` y `respostes` no se tocan.
    v_falten := public.diagnostic_falten_productor(p_org);
    insert into diagnostics (productor_id, respostes, sobre, complet, falten, notes, idioma,
                             actualitzat_at, actualitzat_per)
    values (p_org, '{}'::jsonb, '{"respostes": []}'::jsonb, cardinality(v_falten) = 0, v_falten,
            p_notes, p_idioma, now(), auth.uid())
    on conflict (productor_id) do update
       set complet         = excluded.complet,
           falten          = excluded.falten,
           notes           = excluded.notes,
           idioma          = coalesce(excluded.idioma, diagnostics.idioma),
           actualitzat_at  = excluded.actualitzat_at,
           actualitzat_per = excluded.actualitzat_per
    returning * into d;

    return jsonb_build_object(
      'pla',                     null,
      'diagnostic_id',           d.id,
      'questionari_id',          null,
      'versio_questionari',      null,
      'questionari_provisional', false,
      'falten',                  to_jsonb(v_falten),
      'complet',                 d.complet,
      'mesures_editades',        false,
      'te_mesures',              false,
      'mesures_n',               0,
      'generacio',               null);
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

  v_sobre  := public.diagnostic_compon_sobre(q, p_org, p_respostes, p_notes);

  insert into diagnostics (
    productor_id, questionari_id, versio_questionari, respostes, sobre,
    complet, falten, notes, idioma, actualitzat_at, actualitzat_per)
  values (
    p_org, q.id, q.versio, p_respostes, v_sobre,
    false, '{}'::text[], p_notes, p_idioma, now(), auth.uid())
  on conflict (productor_id) do update
     set questionari_id     = excluded.questionari_id,
         versio_questionari = excluded.versio_questionari,
         respostes          = excluded.respostes,
         sobre              = excluded.sobre,
         notes              = excluded.notes,
         idioma             = coalesce(excluded.idioma, diagnostics.idioma),
         actualitzat_at     = excluded.actualitzat_at,
         actualitzat_per    = excluded.actualitzat_per;

  -- A3: `complet`/`falten` del cálculo nuevo (Operativa + excedentes), no de las preguntas.
  v_falten := public.diagnostic_falten_productor(p_org);
  update diagnostics
     set complet = cardinality(v_falten) = 0, falten = v_falten
   where productor_id = p_org
  returning * into d;

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
  'LEGADO (A3, deuda 175: drop pendiente). Solo para la ventana base → frontend: el frontend nuevo usa desar_excedents_diagnostic(). Sin cuestionario vigente guarda notas e idioma en la cabecera; complet/falten salen de diagnostic_falten_productor(). Solo el equipo (42501 a cualquier externo, D5). 22023: tipo desconocido, nomes_productors, fitxa_inexistent, massa_productes, ubicacio_aliena.';

-- ---------------------------------------------------------------------------
-- 8. El cuestionario del productor se retira (sin v4) y el motor se queda sin camino
-- ---------------------------------------------------------------------------
-- `trg_questionaris_inmutables` solo vigila tipo_org, versio, titol y preguntes: `vigente` se
-- puede cambiar aunque el cuestionario lo cite un diagnóstico.
update public.questionaris_diagnostic set vigente = false where tipo_org = 'productor' and vigente;

comment on table public.questionaris_diagnostic is
  'Cuestionarios del diagnóstico (fase 9). Sense camí en pantalla des de 20270522100000 (A3): el del productor queda vigente = false (sin v4); el diagnóstico es la Operativa de la ficha + diagnostic_productes/excedents/accions. Se conservan porque diagnostics.questionari_id los cita (legado v3). Drop del motor: deuda 175.';
comment on table public.mesures_prevencio is
  'Catálogo de medidas de prevención. Se retira con activa=false, nunca se borra: un plan emitido cita su código. Sin escritura para sesiones desde 20270520100000 (A1, D4); sense camí en pantalla des de 20270522100000 (A3).';
comment on table public.regles_pla is
  'De una respuesta a una medida. La evalúa generar_pla_des_de_diagnostic() en SQL (solo service_role). Sin escritura para sesiones desde 20270520100000 (A1, D4); sense camí en pantalla des de 20270522100000 (A3).';
