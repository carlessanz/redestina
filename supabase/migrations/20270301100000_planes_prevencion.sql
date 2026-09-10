-- El plan de prevención básico: la tabla, su ciclo y sus dos capas de permisos.
--
-- QUÉ ES. El servicio de diagnóstico y prevención (línea 5 del funcional) empieza por un
-- cuestionario corto que la organización contesta —o que el dinamizador rellena con ella—
-- y que produce un documento descargable, el **plan de prevención básico** (serie `PLA`).
-- El plan personalizado, sus revisiones y el histórico que los alimenta son fases
-- posteriores; aquí solo está el básico.
--
-- ⚠️ EL CUESTIONARIO NO EXISTE TODAVÍA. Es el **anexo B del funcional**, material de la
--    fase 0 que la Fundación aún no ha cerrado, igual que pasó con los textos de las
--    plantillas y con las taras de los tipos de caja. Inventarse aquí unas preguntas de
--    negocio sería peor que no tener ninguna: quedarían sembradas, alguien las daría por
--    válidas y el día que llegue el anexo habría que migrar respuestas reales.
--    Por eso `respuestas` es **jsonb con un sobre mínimo y sin vocabulario de preguntas**:
--
--      {
--        "questionari":         "basic",     -- qué cuestionario se contestó
--        "versio_questionari":  0,           -- 0 = todavía no hay anexo B
--        "respostes": [ { "id": "...", "pregunta": "...", "valor": ... }, ... ],
--        "notes":               "..."        -- texto libre del dinamizador
--      }
--
--    Lo único que impone la base es la **forma** del sobre (objeto, y `respostes` array):
--    ni qué preguntas hay, ni cuántas, ni qué valores admiten. Cuando llegue el anexo B,
--    el catálogo de preguntas será una tabla propia y `versio_questionari` subirá a 1;
--    las filas con `versio_questionari = 0` son, por construcción, reconocibles.
--
-- POR QUÉ NO CUELGA DE `convenios` NI DE `cierres_*`. Un plan no es un acuerdo entre dos
-- partes ni un acumulado anual: es una foto del estado de una organización en un momento.
-- Comparte con el convenio la **clave excluyente** productor/entidad y el patrón de
-- numeración al emitir, y ahí acaba el parecido.
--
-- EL NÚMERO SE PIDE AL EMITIR, no al guardar el borrador (§A del plan: el número pertenece
-- a la fila). Un cuestionario que alguien empieza y abandona no quema un número de `PLA`.
--
-- ⚠️ SIN NINGÚN GRANT DE ESCRITURA. Igual que `convenios` y `cierres_*`: se escribe por las
--    RPC de 20270301100200, porque emitir un plan mueve a la vez la fila, el número y la
--    fila de `documentos`, y eso no se puede garantizar desde el navegador.

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists planes_prevencion (
  id             uuid primary key default gen_random_uuid(),

  -- La organización, con la misma clave excluyente que `membresias` y `convenios`.
  tipo_org       text not null check (tipo_org in ('productor', 'entidad')),
  productor_id   uuid references productores(id) on delete cascade,
  entidad_id     uuid references entidades(id)   on delete cascade,

  -- `personalitzat` está en el vocabulario desde el principio a propósito: el funcional
  -- distingue los dos niveles y el día que llegue el segundo no debe hacer falta un
  -- `alter` sobre una tabla con planes ya emitidos. Hoy solo se emite `basic`.
  nivel          text not null default 'basic' check (nivel in ('basic', 'personalitzat')),

  -- El sobre del cuestionario (ver cabecera). La forma la impone el check de más abajo;
  -- el contenido, el anexo B cuando exista.
  respuestas     jsonb not null default '{}'::jsonb,

  -- Versión del PLAN de esa organización (no del PDF: esa es `documentos.version`). Se
  -- fija al emitir: 1 el primero, 2 el siguiente diagnóstico, y así.
  version        int not null default 1 check (version >= 1),

  -- El plan que rige hoy para esa organización. Como mucho uno (índice único parcial).
  vigente        boolean not null default false,

  estado         text not null default 'esborrany' check (estado in (
                   'esborrany',    -- se está contestando
                   'emes',         -- emitido, con número y PDF
                   'substituit')), -- lo reemplaza un diagnóstico posterior

  idioma         text not null default 'ca' check (idioma in ('ca', 'es')),

  -- Numeración (serie `PLA`, 4 dígitos, sembrada en 20260928100000).
  serie          text,
  ejercicio      int,
  numero         int,
  numero_completo text unique,

  creado_por     uuid references auth.users(id) on delete set null,
  emitido_por    uuid references auth.users(id) on delete set null,
  emitido_at     timestamptz,
  sustituido_por uuid references planes_prevencion(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint planes_fk_excluyente check (
       (tipo_org = 'productor' and productor_id is not null and entidad_id  is null)
    or (tipo_org = 'entidad'   and entidad_id   is not null and productor_id is null)),

  -- LA FORMA DEL SOBRE, y nada más (ver cabecera). `coalesce` para que un plan sin
  -- respuestas todavía —el borrador recién abierto— sea válido.
  constraint planes_respuestas_forma check (
        jsonb_typeof(respuestas) = 'object'
    and jsonb_typeof(coalesce(respuestas -> 'respostes', '[]'::jsonb)) = 'array'),

  -- Un plan emitido tiene número; un borrador, no. Misma garantía que en `convenios`.
  constraint planes_numero_segons_estat check (
       (estado = 'esborrany' and numero_completo is null)
    or (estado in ('emes', 'substituit')
        and numero_completo is not null and serie is not null and ejercicio is not null)),

  -- Vigente solo puede estarlo un plan emitido: un borrador no rige nada.
  constraint planes_vigent_nomes_emes check (not vigente or estado = 'emes')
);

comment on table planes_prevencion is
  'Plan de prevención de una organización. Escritura solo por RPC (20270301100200). El cuestionario real es el anexo B, pendiente.';
comment on column planes_prevencion.respuestas is
  'Sobre del cuestionario: {questionari, versio_questionari, respostes:[{id,pregunta,valor}], notes}. versio_questionari=0 = sin anexo B.';
comment on column planes_prevencion.version is
  'Versión del PLAN de esa organización, fijada al emitir. La del PDF es documentos.version.';
comment on column planes_prevencion.numero_completo is
  'null mientras es borrador: el número se pide al emitir y un cuestionario abandonado no deja hueco en la serie.';

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------
-- Un solo plan vigente por organización: es lo que hace que «el pla de la meva
-- organització» sea una pregunta con una sola respuesta.
create unique index if not exists planes_vigent_uidx
  on planes_prevencion (coalesce(productor_id, entidad_id)) where vigente;

-- Un solo borrador por organización. No es cosmética: es lo que permite que
-- `guardar_plan_basico()` sea idempotente sin recibir el id del borrador —quien contesta
-- el formulario en dos sesiones no debe acabar con dos cuestionarios a medias—.
create unique index if not exists planes_esborrany_uidx
  on planes_prevencion (coalesce(productor_id, entidad_id)) where estado = 'esborrany';

create index if not exists planes_productor_idx on planes_prevencion (productor_id) where productor_id is not null;
create index if not exists planes_entidad_idx   on planes_prevencion (entidad_id)   where entidad_id   is not null;

-- ---------------------------------------------------------------------------
-- 3. Inmutabilidad y transiciones
-- ---------------------------------------------------------------------------
-- Un plan emitido es un documento entregado: lo que puede pasarle después es que otro lo
-- sustituya, nunca que cambien sus respuestas. Un diagnóstico nuevo es una fila nueva.
create or replace function trg_planes_control()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.estado in ('emes', 'substituit') then
    if new.tipo_org        is distinct from old.tipo_org
    or new.productor_id    is distinct from old.productor_id
    or new.entidad_id      is distinct from old.entidad_id
    or new.nivel           is distinct from old.nivel
    or new.respuestas      is distinct from old.respuestas
    or new.version         is distinct from old.version
    or new.idioma          is distinct from old.idioma
    or new.serie           is distinct from old.serie
    or new.ejercicio       is distinct from old.ejercicio
    or new.numero          is distinct from old.numero
    or new.numero_completo is distinct from old.numero_completo
    or new.emitido_at      is distinct from old.emitido_at then
      raise exception 'Un pla emes no es pot modificar (%). Fes un diagnostic nou.',
        coalesce(old.numero_completo, old.id::text) using errcode = '42501';
    end if;
  end if;

  if new.estado is distinct from old.estado
     and not (
          (old.estado = 'esborrany' and new.estado = 'emes')
       or (old.estado = 'emes'      and new.estado = 'substituit')) then
    raise exception 'Transicio d''estat no permesa en un pla: % -> %', old.estado, new.estado
      using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists planes_control on planes_prevencion;
create trigger planes_control
  before insert or update on planes_prevencion
  for each row execute function trg_planes_control();

-- Un plan con número no se borra: se sustituye. Un borrador sí —es un cuestionario a
-- medias, no un documento—.
create or replace function trg_planes_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.numero_completo is not null then
    raise exception 'El pla % te numero: substitueix-lo, no l''esborris.',
      old.numero_completo using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists planes_no_esborrar on planes_prevencion;
create trigger planes_no_esborrar
  before delete on planes_prevencion
  for each row execute function trg_planes_no_esborrar();

-- ---------------------------------------------------------------------------
-- 4. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- SELECT explícito: una tabla nueva sin GRANT responde `permission denied` ANTES de
-- evaluar RLS (§4). Sin ningún GRANT de escritura (ver cabecera).
grant select on planes_prevencion to authenticated;

alter table planes_prevencion enable row level security;

-- El equipo lo ve todo; una organización ve **los suyos**. Como en `convenios`, la tabla
-- referencia `productores`/`entidades` por columna propia, así que la política compara
-- uuid contra uuid: ningún `exists` correlacionado y ninguna reentrada en otra RLS
-- (deuda §12.23). Los helpers van en `(select …)` para que sean InitPlan.
drop policy if exists "plans: intern o meus" on planes_prevencion;
create policy "plans: intern o meus"
  on planes_prevencion for select to authenticated
  using (
       (select public.es_intern())
    or productor_id in (select public.mis_productores())
    or entidad_id   in (select public.mis_entidades())
  );

-- ---------------------------------------------------------------------------
-- 5. El puente: qué planes son de cada organización
-- ---------------------------------------------------------------------------
-- Función puente `security definer` que devuelve `setof uuid`, para que
-- `documents_meus()` pueda cruzar `documentos` con los planes **sin** un `exists`
-- correlacionado sobre `planes_prevencion` (§A del plan, deuda §12.23).
--
-- ⚠️ Solo los planes **emitidos**. Un borrador no tiene documento, así que incluirlo aquí
--    no serviría de nada y ampliaría sin motivo lo que la función deja ver.
create or replace function public.planes_meus(p_user uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els plans d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  return query
    select pl.id
      from planes_prevencion pl
     where pl.estado in ('emes', 'substituit')
       and (   pl.productor_id in (select m.productor_id from membresias m
                                    where m.user_id = v_user and m.activo
                                      and m.tipo = 'productor')
            or pl.entidad_id   in (select m.entidad_id   from membresias m
                                    where m.user_id = v_user and m.activo
                                      and m.tipo = 'entidad'));
end;
$$;

comment on function public.planes_meus(uuid) is
  'Ids de planes de prevención emitidos de las organizaciones del usuario. Puente para documents_meus().';

revoke execute on function public.planes_meus(uuid) from public, anon;
grant  execute on function public.planes_meus(uuid) to authenticated, service_role;

-- Verificación:
--   select has_table_privilege('authenticated','public.planes_prevencion','SELECT');  -- t
--   select has_table_privilege('authenticated','public.planes_prevencion','INSERT');  -- f
--   select public.planes_meus();                                                      -- 0 filas sin sesión
