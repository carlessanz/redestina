-- `documentos`: el registro único de todo documento que Redestina emite.
--
-- QUÉ ES. Una fila por documento emitido —albarán, convenio, resumen de cierre,
-- certificado, plan— con su número de serie, el **snapshot congelado** de lo que dice
-- (`datos`), la huella de ese snapshot (`sha256_datos`), dónde vive el PDF (`ruta`) y la
-- huella de los bytes (`sha256_fichero`). El PDF es una consecuencia de la fila, no al
-- revés: la fila nace `pendiente_fichero` y una Edge Function la completa después.
--
-- POR QUÉ POLIMÓRFICA (`objeto_tipo` / `objeto_id`) y no una FK por tipo (decisión D del
-- plan): hay cinco tipos de objeto hoy y habrá más. Una FK por tipo obligaría a añadir
-- una columna nullable cada vez, y una FK inversa desde el dominio («este albarán tiene
-- este PDF») sería mentira en cuanto hubiera dos versiones. El dominio nunca apunta al
-- PDF: se consulta con `documento_vigente()` (20260928100800). El precio de no tener FK
-- es que nadie garantiza que el objeto exista, y por eso hay un trigger `before insert`
-- que lo comprueba —incluidas las tablas que todavía no existen (§ trigger 2)—.
--
-- POR QUÉ DOS HUELLAS Y NO UNA (§A del plan):
--   · `sha256_datos`   huella del snapshot canónico, calculada en SQL al emitir. Es la
--                      que se **imprime** en el documento como código de verificación.
--   · `sha256_fichero` huella de los bytes subidos, calculada en Deno antes del upload.
-- Un PDF no puede contener su propio hash: por eso la que se imprime es la del dato.
--
-- POR QUÉ EL NÚMERO SE COPIA AQUÍ. La numeración pertenece al **dominio**
-- (`albaranes.numero_completo`, `convenios.numero_completo`…); `documentos` copia
-- `numero_completo` + `version` porque el albarán conciliado es el mismo ENT-2026-00042
-- en su versión 2, no un documento nuevo. Número nuevo solo en rectificativos (serie
-- `R-`).
--
-- ⚠️ ORDEN DE ESTE FICHERO Y EL SIGUIENTE. Aquí se habilita RLS **sin ninguna política
--    de SELECT**: la política necesita `documents_meus()`, que vive en
--    20260928100800_rpc_documentos.sql (y que cada fase reescribe con `create or
--    replace` sin volver a tocar esta tabla). Entre las dos migraciones la tabla está
--    completamente cerrada para `authenticated`, que es el estado intermedio correcto:
--    RLS habilitada y sin política = nadie ve nada.

create extension if not exists pgcrypto;
-- pgcrypto ya viene instalada en el esquema `extensions` de Supabase; la línea es
-- idempotente y deja constancia de la dependencia. Ojo: `sha256()` es **built-in** de
-- Postgres desde la 11 (vive en `pg_catalog`), así que las huellas se calculan con él y
-- no dependen del `search_path` restringido de las funciones `security definer`.
-- pgcrypto hace falta más adelante, para `gen_random_bytes()` de los tokens de enlace.

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists documentos (
  id               uuid primary key default gen_random_uuid(),

  -- Qué documento es. `tipo` manda en la plantilla, la carpeta y el renderizador.
  tipo             text not null check (tipo in (
                     'REC', 'ENT', 'OPE',            -- albaranes
                     'R-REC', 'R-ENT', 'R-OPE',      -- sus rectificativos
                     'CONV',                          -- convenio de colaboración
                     'RES',                           -- resumen anual al donante
                     'CD',                            -- certificado de donación
                     'CT',                            -- certificado de transacción
                     'PLA',                           -- plan de prevención
                     'PROVA')),                       -- documento de humo (spike/fase 1)
  -- En qué momento del ciclo se emitió esta versión. Null en los tipos de un solo acto.
  subtipo          text check (subtipo in (
                     'emes', 'conciliat', 'firmat', 'contrafirmat',
                     'provisional', 'definitiu')),

  -- A qué objeto del dominio pertenece (polimórfico, ver cabecera).
  objeto_tipo      text not null check (objeto_tipo in (
                     'albaran', 'convenio', 'cierre_donante', 'espigolada', 'plan', 'prova')),
  objeto_id        uuid not null,

  -- Numeración (§ 20260928100000).
  numero_completo  text not null,
  version          int  not null default 1 check (version >= 1),
  serie            text not null,
  ejercicio        int  not null,

  -- El modo vive en el dato (§A): decide serie con prefijo `P-`, marca de agua y
  -- destinatarios. NO depende de `test_mode` (§8): un cierre de prueba no debe llegar
  -- nunca a un donante real aunque el modo test global esté apagado.
  modo             text not null default 'real'   check (modo in ('real', 'prueba')),
  idioma           text not null default 'ca'     check (idioma in ('ca', 'es')),

  -- FK a `plantillas_documento`, que la crea 20260928100100 (fase 1). Aquí queda como
  -- uuid suelto a propósito: el spike no incluye esa migración y una FK a una tabla
  -- inexistente no se puede declarar. La añade esa migración con `alter table`.
  plantilla_id     uuid,

  -- El snapshot y su huella. `datos` es lo que dice el documento, congelado; el PDF se
  -- puede regenerar entero desde aquí y verificarse contra `sha256_datos`.
  datos            jsonb not null,
  sha256_datos     text  not null,

  -- El fichero. `ruta` la fija `ruta_documento()` AL INSERTAR (§B.3): la Edge Function
  -- sube exactamente ahí y no elige carpeta. Lo demás lo rellena al terminar.
  ruta             text,
  sha256_fichero   text,
  bytes            int,
  paginas          int,

  estado           text not null default 'pendiente_fichero'
                     check (estado in ('pendiente_fichero', 'emitido', 'error')),
  intentos         int  not null default 0,
  ultimo_error     text,

  -- Si no es null, al generar el PDF hay que enviarlo: {destinatario, asunto, plantilla…}.
  envio            jsonb,

  -- Versionado: emitir la versión 2 de un albarán apaga la 1. Nunca se borra nada.
  vigente          boolean not null default true,
  sustituido_por   uuid references documentos(id) on delete set null,

  emitido_por      uuid references auth.users(id) on delete set null,
  emitido_at       timestamptz not null default now(),
  fichero_at       timestamptz
);

comment on table documentos is
  'Un documento emitido. La fila manda: el PDF es asíncrono y se puede regenerar desde `datos`.';
comment on column documentos.sha256_datos is
  'Huella del snapshot canónico (datos::text). Es la que se IMPRIME como código de verificación.';
comment on column documentos.sha256_fichero is
  'Huella de los bytes del PDF, calculada en Deno antes del upload. Verifica la descarga.';
comment on column documentos.ruta is
  'Ruta dentro del bucket `documentos`, fijada por ruta_documento() al insertar (§B.3). La función de generación NO la elige.';
comment on column documentos.modo is
  'real | prueba. Decide serie P-*, marca de agua y destinatarios. Independiente de app_settings.test_mode.';

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------
-- Un número de serie identifica una y solo una versión de un documento.
create unique index if not exists documentos_numero_version_uidx
  on documentos (numero_completo, version);

-- Un objeto tiene como mucho UN documento vigente de cada tipo. Es lo que impide que la
-- conciliación deje dos ENT válidos del mismo albarán.
create unique index if not exists documentos_vigente_uidx
  on documentos (objeto_tipo, objeto_id, tipo) where vigente;

-- «Dame todo lo de este albarán» (la ficha del objeto).
create index if not exists documentos_objeto_idx
  on documentos (objeto_tipo, objeto_id);

-- La cola de trabajo del job de generación: lo pendiente y lo fallado son una fracción
-- minúscula de la tabla, así que índice parcial, no índice entero.
create index if not exists documentos_pendientes_idx
  on documentos (estado) where estado <> 'emitido';

-- ---------------------------------------------------------------------------
-- 3. Trigger de inmutabilidad
-- ---------------------------------------------------------------------------
-- Un documento emitido es un hecho, no un registro editable. Lo único que puede pasarle
-- después de nacer es (a) que aparezca su fichero o falle, (b) que una versión posterior
-- lo sustituya. Todo lo demás está congelado, y lo impone la base: ni una RPC con un
-- `update` mal escrito, ni la service_role de una Edge Function, pueden reescribir el
-- contenido de un documento ya emitido.
--
-- Transiciones de estado permitidas:
--   pendiente_fichero -> emitido | error       (la Edge Function subió el PDF, o falló)
--   error             -> pendiente_fichero     (reencolado por el job, máx. 5 intentos)
--   error             -> emitido               (el reintento salió bien)
--   emitido           -> ninguna               (es terminal: el fichero ya existe)
-- Y `vigente` solo puede ir de true a false.
--
-- ⚠️ `error -> emitido` tiene que estar: el job de reintento vuelve a llamar a
--    `generar-documento` **sin** devolver la fila a `pendiente_fichero`, así que sin esa
--    transición un documento que falla una vez no se podría recuperar nunca.
create or replace function trg_documentos_inmutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Columnas congeladas: la identidad y el contenido del documento.
  if new.tipo            is distinct from old.tipo
  or new.subtipo         is distinct from old.subtipo
  or new.objeto_tipo     is distinct from old.objeto_tipo
  or new.objeto_id       is distinct from old.objeto_id
  or new.numero_completo is distinct from old.numero_completo
  or new.version         is distinct from old.version
  or new.serie           is distinct from old.serie
  or new.ejercicio       is distinct from old.ejercicio
  or new.modo            is distinct from old.modo
  or new.idioma          is distinct from old.idioma
  or new.datos           is distinct from old.datos
  or new.sha256_datos    is distinct from old.sha256_datos
  or new.ruta            is distinct from old.ruta
  or new.emitido_at      is distinct from old.emitido_at
  or new.emitido_por     is distinct from old.emitido_por then
    raise exception 'Un document emes no es pot modificar (%). Emet una versio nova.',
      new.numero_completo using errcode = '42501';
  end if;

  -- Estado: solo las transiciones de arriba. `emitido` es terminal.
  if new.estado is distinct from old.estado
     and not (
          (old.estado = 'pendiente_fichero' and new.estado in ('emitido', 'error'))
       or (old.estado = 'error'             and new.estado in ('emitido', 'pendiente_fichero'))) then
    raise exception 'Transicio d''estat no permesa: % -> %', old.estado, new.estado
      using errcode = '22023';
  end if;

  -- Vigencia: solo se apaga, nunca se vuelve a encender.
  if old.vigente = false and new.vigente = true then
    raise exception 'Un document substituit no torna a ser vigent (%)', new.numero_completo
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists documentos_inmutable on documentos;
create trigger documentos_inmutable
  before update on documentos
  for each row execute function trg_documentos_inmutable();

-- Borrar está prohibido, y la ÚNICA excepción es el reinicio del ciclo de prueba, que
-- fija `redestina.reinicio_prueba` dentro de su propia RPC (`set_config(..., true)`, o
-- sea local a la transacción: no se puede dejar encendido «por si acaso»).
create or replace function trg_documentos_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('redestina.reinicio_prueba', true), 'off') <> 'on' then
    raise exception 'Els documents no s''esborren (%). Emet una versio que el substitueixi.',
      old.numero_completo using errcode = '42501';
  end if;
  -- Y ni siquiera con el interruptor puesto se borra un documento real.
  if old.modo <> 'prueba' then
    raise exception 'El reinici de proves nomes esborra documents en modo prueba (% es %)',
      old.numero_completo, old.modo using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists documentos_no_esborrar on documentos;
create trigger documentos_no_esborrar
  before delete on documentos
  for each row execute function trg_documentos_no_esborrar();

-- ---------------------------------------------------------------------------
-- 4. Trigger: el objeto referenciado tiene que existir
-- ---------------------------------------------------------------------------
-- Es lo que sustituye a la FK que el modelo polimórfico no puede tener. Resuelve la
-- tabla con `to_regclass`, así que **no hay que editarlo en cada fase**: cuando la fase
-- 3 cree `albaranes`, este trigger empieza a comprobarlos solo. Mientras la tabla no
-- exista, emitir ese tipo de documento falla con un mensaje que dice exactamente por qué.
--
-- `prova` está exento a propósito: el documento de humo no tiene objeto de dominio
-- —lleva un uuid inventado— y su función es probar el circuito de numeración y ficheros
-- sin depender de ninguna tabla de negocio.
create or replace function trg_documentos_objeto_existe()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tabla  text;
  v_existe boolean;
begin
  if new.objeto_tipo = 'prova' then
    return new;
  end if;

  v_tabla := case new.objeto_tipo
               when 'albaran'        then 'albaranes'
               when 'convenio'       then 'convenios'
               when 'cierre_donante' then 'cierres_donante'
               when 'espigolada'     then 'espigoladas'
               when 'plan'           then 'planes_prevencion'
             end;

  if to_regclass('public.' || v_tabla) is null then
    raise exception 'Encara no existeix la taula %: no es pot emetre cap document de tipus %',
      v_tabla, new.objeto_tipo using errcode = '0A000';
  end if;

  execute format('select exists (select 1 from public.%I where id = $1)', v_tabla)
    into v_existe using new.objeto_id;

  if not v_existe then
    raise exception 'No existeix cap % amb id %', new.objeto_tipo, new.objeto_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists documentos_objeto_existe on documentos;
create trigger documentos_objeto_existe
  before insert on documentos
  for each row execute function trg_documentos_objeto_existe();

-- ---------------------------------------------------------------------------
-- 5. documento_envios: qué se mandó, a quién y si llegó
-- ---------------------------------------------------------------------------
-- Cierra parcialmente la deuda §12.25: hoy un envío por correo que Resend rechaza solo
-- deja rastro en los logs de la Edge Function, y en el panel es indistinguible de un
-- envío correcto. Aquí queda la fila, con el id del proveedor y el error.
--
-- `canal` solo admite 'email' a propósito (§9, decisión D): un documento —o el enlace
-- para firmarlo— es una credencial o un dato personal, y por WhatsApp quedaría publicado
-- en la consola de Mensajería, que lee todo el equipo.
create table if not exists documento_envios (
  id           uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documentos(id) on delete cascade,
  destinatario text not null,
  canal        text not null default 'email' check (canal in ('email')),
  estado       text not null default 'pendent' check (estado in ('pendent', 'enviat', 'error')),
  proveedor_id text,
  error        text,
  enviado_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists documento_envios_documento_idx on documento_envios (documento_id);
create index if not exists documento_envios_pendientes_idx
  on documento_envios (created_at) where estado <> 'enviat';

comment on table documento_envios is
  'Trazabilidad de los correos con documento adjunto. Lo escribe la Edge Function con service_role.';

-- ---------------------------------------------------------------------------
-- 6. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- SELECT explícito aunque el `alter default privileges` de 20260721160000 ya lo daría:
-- sin GRANT, PostgREST responde `permission denied` antes de mirar RLS (§4).
grant select on documentos       to authenticated;
grant select on documento_envios to authenticated;

-- Sin GRANT de escritura, ni aquí ni en ninguna fase posterior. La superficie de
-- escritura son las RPC `security definer` y `service_role`: un documento no se crea
-- desde el navegador porque el navegador no puede garantizar la transacción que ata el
-- número al documento.

alter table documentos       enable row level security;
alter table documento_envios enable row level security;

-- ⚠️ La política de SELECT de `documentos` NO está aquí: necesita `documents_meus()` y
--    se declara en 20260928100800_rpc_documentos.sql. Hasta entonces la tabla está
--    cerrada para `authenticated` (RLS habilitada sin política = nadie ve nada), que es
--    el intermedio correcto.

drop policy if exists "envios: intern" on documento_envios;
create policy "envios: intern"
  on documento_envios for select to authenticated
  using ((select public.es_intern()));

-- Verificación:
--   select has_table_privilege('authenticated','public.documentos','SELECT');  -- t
--   select has_table_privilege('authenticated','public.documentos','INSERT');  -- f
--   \d documentos
