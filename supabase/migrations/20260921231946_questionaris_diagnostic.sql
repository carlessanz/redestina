-- El **cuestionario de diagnóstico**: por fin en la base, versionado y con su contenido
-- validado, en vez de un sobre jsonb del que nadie sabía qué esperar.
--
-- QUÉ RESUELVE. Desde 20270301100000 existe `planes_prevencion` y su `respuestas jsonb`,
-- pero **no existe el cuestionario**: la base impone la forma del sobre y nada más, y
-- `versio_questionari = 0` marca «todavía no hay anexo B». Eso deja tres cosas sin poder
-- hacerse: no hay nada que pintar en una pantalla, no hay forma de saber si el
-- cuestionario está completo, y no hay de dónde derivar ninguna medida de prevención.
-- Esta migración pone el catálogo de preguntas donde tiene que estar.
--
-- ⚠️ EL CUESTIONARIO SEMBRADO ES PROVISIONAL Y ESTÁ MARCADO COMO TAL. El anexo B del
--    funcional sigue siendo material de la fase 0 y no va a llegar antes de que esto se
--    construya (decisión del 22-09-2026). La salida es la misma que ya tomaron los
--    convenios (20270111100200) y las plantillas: **texto de trabajo, versionado, marcado
--    borrador en el dato**, y una versión 2 el día que la Fundación valide el suyo. La
--    columna `provisional` lo hace comprobable por código, y viaja al snapshot del PDF:
--    un plan emitido con el cuestionario provisional lo dice impreso.
--
-- POR QUÉ EN LA BASE Y NO EN EL CÓDIGO. Exactamente el argumento de
-- `plantillas_documento` (20260928100100): lo redacta la Fundación, cambia sin que cambie
-- el software, y dentro de cinco años hay que poder responder «con qué cuestionario
-- EXACTO se hizo este diagnóstico». Un literal en TypeScript no cumple ninguna de las tres.
--
-- 🔴 Y AUN ASÍ, LAS RESPUESTAS SE GUARDAN **AUTOCONTENIDAS**, con la etiqueta de cada
--    pregunta y de cada opción en ca y es dentro del propio plan (20270405100200 y la RPC
--    `desar_diagnostic`). No es redundancia: un plan de hace cinco años no puede depender
--    de que su cuestionario siga vivo, ni vigente, ni legible para quien lo mira. Es el
--    mismo principio que `documentos.datos` y que `convenios.datos_org`. Corolario que
--    importa: la política de lectura de esta tabla puede ser estrecha —solo la vigente, o
--    el equipo— sin dejar a nadie sin poder leer su propio plan.

-- ---------------------------------------------------------------------------
-- 1. questionari_problemes(): QUÉ está mal, en una lista legible
-- ---------------------------------------------------------------------------
-- Dos funciones y no una, a propósito:
--   · `questionari_problemes()` devuelve los problemas concretos y la usa la RPC de
--     publicación para levantar un `22023` que diga qué arreglar.
--   · `questionari_valid()` es el booleano, y es lo que va en el CHECK de la tabla — la
--     última red, la que actúa aunque algún día alguien escriba por otro camino.
-- Un CHECK solo sabe decir `23514`; un mensaje que no dice qué pregunta está mal, en un
-- jsonb de doce preguntas, no sirve para nada.
--
-- IMMUTABLE y sin `security definer`: no toca ninguna tabla, solo su argumento. Las dos
-- condiciones son obligatorias para poder usarla en un CHECK.
create or replace function public.questionari_problemes(p_preguntes jsonb)
returns text[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
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
    if v_tipus is null or v_tipus not in ('opcio', 'multi', 'boolea', 'numero', 'text') then
      v_problemes := v_problemes || format(
        'Pregunta %s: tipus desconegut "%s" (opcio|multi|boolea|numero|text)',
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

  return v_problemes;
end;
$$;

comment on function public.questionari_problemes(jsonb) is
  'Lista legible de lo que está mal en las preguntas de un cuestionario. Vacía = válido. La usa publicar_questionari() para decir QUÉ arreglar.';

create or replace function public.questionari_valid(p_preguntes jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_length(public.questionari_problemes(p_preguntes), 1), 0) = 0;
$$;

comment on function public.questionari_valid(jsonb) is
  'El booleano de questionari_problemes(). Va en el CHECK de questionaris_diagnostic: la última red, no el mensaje.';

-- El CHECK necesita poder ejecutarla con el rol que inserta; `authenticated` no escribe
-- aquí, pero sí le sirve para validar un borrador desde la pantalla antes de publicarlo.
revoke execute on function public.questionari_problemes(jsonb) from public, anon;
revoke execute on function public.questionari_valid(jsonb)     from public, anon;
grant  execute on function public.questionari_problemes(jsonb) to authenticated, service_role;
grant  execute on function public.questionari_valid(jsonb)     to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. La tabla
-- ---------------------------------------------------------------------------
create table if not exists questionaris_diagnostic (
  id          uuid primary key default gen_random_uuid(),

  -- Un cuestionario es de un tipo de organización: lo que se le pregunta a quien genera
  -- producto y a quien lo recibe no se parece en nada. Mismo vocabulario que
  -- `planes_prevencion.tipo_org` y `membresias.tipo`.
  tipo_org    text not null check (tipo_org in ('productor', 'entidad')),

  versio      int  not null check (versio >= 0),

  -- 🔴 `true` = texto de trabajo NO validado por la Fundación. Viaja al snapshot del plan
  --    y se imprime: un diagnóstico hecho con un cuestionario provisional lo dice.
  provisional boolean not null default true,

  vigente     boolean not null default false,
  valida_desde date   not null default current_date,

  titol       jsonb not null,
  preguntes   jsonb not null,

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint questionaris_titol_forma check (
        jsonb_typeof(titol) = 'object'
    and jsonb_typeof(titol -> 'ca') = 'string'
    and jsonb_typeof(titol -> 'es') = 'string'),

  -- La última red (ver §1). El mensaje legible lo da `publicar_questionari()`.
  constraint questionaris_preguntes_valides check (public.questionari_valid(preguntes))
);

comment on table questionaris_diagnostic is
  'El cuestionario de diagnóstico, versionado y por tipo de organización. Escritura solo por RPC (20270405100400). provisional=true mientras no lo valide la Fundación.';
comment on column questionaris_diagnostic.preguntes is
  'Array de {id, tipus, seccio, etiqueta{ca,es}, ajuda{ca,es}?, obligatoria, opcions[{valor,etiqueta{ca,es}}]?, aplica_a{pregunta,operador,valor}?, prefill?}.';
comment on column questionaris_diagnostic.provisional is
  'true = texto de trabajo sin validar por la Fundación. Se imprime en el plan que lo use.';
comment on column questionaris_diagnostic.versio is
  'La versión del cuestionario. 0 es el provisional sembrado desde git; el anexo B real será la 1.';

-- Una versión de un cuestionario es única…
create unique index if not exists questionaris_tipus_versio_uidx
  on questionaris_diagnostic (tipo_org, versio);

-- …y solo una está vigente por tipo. Índice parcial: es la regla de negocio entera, igual
-- que en `plantillas_documento`.
create unique index if not exists questionaris_vigent_uidx
  on questionaris_diagnostic (tipo_org) where vigente;

-- ---------------------------------------------------------------------------
-- 3. Inmutabilidad en cuanto un plan lo referencia
-- ---------------------------------------------------------------------------
-- Mismo criterio y mismo mensaje que `plantillas_inmutables` (20260928100100): mientras
-- nadie lo haya contestado es un borrador y se edita; en cuanto un plan lo cita, su
-- contenido queda congelado. Reescribir las preguntas haría que un diagnóstico dijera
-- haberse hecho con un cuestionario que ya no es el que dice.
--
-- ⚠️ `vigente`, `valida_desde` y `provisional` SÍ se pueden seguir moviendo, y el tercero
--    merece explicación: `provisional` no describe el contenido, describe si la Fundación
--    ya lo ha validado. Que valide el texto tal cual está no es editarlo. Y los planes ya
--    emitidos no cambian por eso: llevan el valor congelado en su snapshot.
create or replace function trg_questionaris_inmutables()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.tipo_org  is distinct from old.tipo_org
  or new.versio    is distinct from old.versio
  or new.titol     is distinct from old.titol
  or new.preguntes is distinct from old.preguntes then
    if exists (select 1 from planes_prevencion pl where pl.questionari_id = old.id) then
      raise exception
        'El questionari % (%/v%) ja ha generat diagnostics: publica una versio nova en comptes d''editar-lo.',
        old.id, old.tipo_org, old.versio using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ⚠️ El trigger se crea aquí pero `planes_prevencion.questionari_id` la añade
--    20270405100200, que va DESPUÉS. Si se creara ya, el primer `update` sobre esta tabla
--    fallaría con `42703 column pl.questionari_id does not exist`. Por eso el trigger se
--    engancha allí, junto a la columna que consulta: es el mismo motivo por el que la FK
--    de `documentos.plantilla_id` vive en su propio fichero (20260928100250).

-- Y un cuestionario usado tampoco se borra.
create or replace function trg_questionaris_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from planes_prevencion pl where pl.questionari_id = old.id) then
    raise exception 'El questionari % ja ha generat diagnostics: retira''l (vigente = false) en comptes d''esborrar-lo.',
      old.id using errcode = '42501';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- SELECT explícito (§4: sin GRANT, PostgREST responde `permission denied` ANTES de evaluar
-- RLS). **Sin escritura para nadie**: publicar un cuestionario mueve a la vez la versión
-- nueva y la retirada de la anterior, y eso no se hace con dos `update` desde el navegador.
grant select on questionaris_diagnostic to authenticated;
revoke insert, update, delete, truncate on questionaris_diagnostic from authenticated;
revoke all on questionaris_diagnostic from anon;

alter table questionaris_diagnostic enable row level security;

-- ⚠️ `vigente or es_intern()`, no `es_intern()` a secas: la organización tiene que poder
--    LEER el cuestionario que va a contestar. Lo que no ve son las versiones retiradas ni
--    los borradores de la próxima, que son trabajo interno.
--    Y no deja a nadie sin poder leer su plan viejo: las respuestas van autocontenidas
--    dentro del plan (ver cabecera), así que un plan de 2026 se sigue leyendo entero
--    cuando su cuestionario lleve años retirado.
drop policy if exists "questionaris: vigent o intern" on questionaris_diagnostic;
create policy "questionaris: vigent o intern"
  on questionaris_diagnostic for select to authenticated
  using (vigente or (select public.es_intern()));

-- Verificación:
--   select has_table_privilege('authenticated','public.questionaris_diagnostic','SELECT');  -- t
--   select has_table_privilege('authenticated','public.questionaris_diagnostic','INSERT');  -- f
--   select public.questionari_problemes('[{"id":"X"}]'::jsonb);  -- lista de problemas
