-- `enlaces_token` y `evidencias`: firmar y confirmar sin tener cuenta.
--
-- EL PROBLEMA QUE RESUELVEN. Quien firma un convenio o confirma un albarán es una
-- persona de una organización que, casi siempre, **no tiene cuenta en Redestina** ni la
-- va a tener: recibe un correo, abre un enlace desde el móvil, mira lo que le hemos
-- enviado y dice sí o no. Todo el modelo de identidad del proyecto (§4bis) da por hecho
-- una sesión de Supabase Auth; aquí no la hay.
--
-- EL TOKEN ES LA CREDENCIAL, Y SOLO EXISTE EN EL CORREO. Se generan 32 bytes aleatorios,
-- se envían en base64url dentro del enlace y **en la base solo queda su sha256**. Un
-- volcado de la tabla, un backup extraviado o una fuga de PostgREST no permiten abrir
-- ningún enlace: hay que tener el original. Es el mismo razonamiento por el que una
-- contraseña no se guarda en claro, y por eso `token_hash` está **fuera del GRANT de
-- SELECT** incluso para el equipo (§ apartado 4): nadie necesita leerlo, ni siquiera
-- para dar soporte —reenviar un enlace es emitir otro—.
--
-- EL CÓDIGO DE 6 CIFRAS (`codigo_hash`) es el segundo factor de la firma de convenios
-- (fase 2): el enlace lleva al documento, el código autoriza la firma, y viaja por otro
-- camino. Se guarda igual, hasheado, y con su propia caducidad corta.
--
-- `evidencias` ES LO QUE HACE QUE LA FIRMA VALGA ALGO. Una firma electrónica propia no
-- vale por el trazo: vale por lo que se puede demostrar alrededor —cuándo se abrió el
-- enlace, desde qué IP y con qué navegador, quién dijo ser y con qué cargo, qué texto
-- exacto aceptó (`sha256_texto`)—. Cada acto deja su fila y ninguna se borra.
--
-- ⚠️ `documento_identidad` (el DNI de quien firma) es dato personal de categoría alta y
--    **no se puede leer desde el navegador**, ni siquiera siendo del equipo: solo lo lee
--    el renderizador con `service_role` para estamparlo en la copia congelada del
--    documento (§2.5 del plan funcional). Se aplica con GRANT por columnas, igual que
--    `perfiles` (20260730090000): RLS no sabe restringir columnas; el GRANT sí.
--
-- ESCRITURA: solo `service_role`. No hay GRANT de INSERT/UPDATE/DELETE para
-- `authenticated` en ninguna de las dos. Un enlace nace dentro de la RPC que emite el
-- documento al que pertenece, y una evidencia la escribe la Edge Function pública
-- después de comprobar el token. Desde el navegador no se puede ni crear un enlace ni
-- inventar una evidencia, que es precisamente lo que daría valor cero a las dos tablas.

-- ---------------------------------------------------------------------------
-- 1. enlaces_token
-- ---------------------------------------------------------------------------
create table if not exists enlaces_token (
  id                     uuid primary key default gen_random_uuid(),

  -- Para qué sirve este enlace. Decide qué pantalla pinta `enlace-publico` y qué RPC
  -- puede llamar: un token de confirmación no sirve para firmar un convenio.
  proposito              text not null check (proposito in (
                           'firma_convenio', 'confirmacion_albaran', 'subida_factura')),

  -- A qué apunta (polimórfico, misma decisión que `documentos`: hay tres objetos hoy y
  -- habrá más, y una columna nullable por tipo envejece mal).
  objeto_tipo            text not null check (objeto_tipo in (
                           'albaran', 'convenio', 'cierre_donante')),
  objeto_id              uuid not null,

  destinatario_email     text,
  destinatario_nombre    text,
  -- `asistido`: el enlace no se manda: lo abre el dinamizador delante de la persona (o
  -- por teléfono) y la evidencia queda con `asistido_por`. Es el modelo asistido del
  -- funcional (§1bis) llevado a la firma, no un atajo.
  canal                  text not null default 'email' check (canal in ('email', 'asistido')),

  -- Las dos credenciales, siempre hasheadas. El original solo existe en el correo.
  token_hash             text not null unique,
  codigo_hash            text,
  codigo_caduca_at       timestamptz,

  caduca_at              timestamptz not null,
  abierto_at             timestamptz,
  usado_at               timestamptz,

  -- Estado EXPLÍCITO. `caducado` aquí es el que alguien ha escrito (un job, o el equipo
  -- revocando); la caducidad por reloj no se guarda, se calcula (ver `resolver_enlace`).
  estado                 text not null default 'activo'
                           check (estado in ('activo', 'usado', 'caducado', 'revocado')),

  recordatorios          int  not null default 0,
  ultimo_recordatorio_at timestamptz,

  creado_por             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now()
);

comment on table enlaces_token is
  'Enlaces de un solo uso para firmar, confirmar o subir sin cuenta. El token en claro solo vive en el correo.';
comment on column enlaces_token.token_hash is
  'sha256 hex de 32 bytes aleatorios base64url. FUERA del GRANT de SELECT: nadie lo lee, ni el equipo.';
comment on column enlaces_token.codigo_hash is
  'sha256 del código de 6 cifras (2º factor de la firma, fase 2). Fuera del GRANT, como el token.';
comment on column enlaces_token.estado is
  'Estado escrito. La caducidad por reloj NO se guarda: la calcula resolver_enlace() como estado_efectivo.';

-- «Los enlaces de este albarán» (la ficha del objeto).
create index if not exists enlaces_token_objeto_idx
  on enlaces_token (objeto_tipo, objeto_id);

-- La cola de los recordatorios (7 y 14 días) y del contador de la bandeja: lo vivo sin
-- usar es una fracción pequeña de la tabla, así que índice parcial.
create index if not exists enlaces_token_vius_idx
  on enlaces_token (caduca_at) where estado = 'activo' and usado_at is null;

-- ---------------------------------------------------------------------------
-- 2. evidencias
-- ---------------------------------------------------------------------------
create table if not exists evidencias (
  id                         uuid primary key default gen_random_uuid(),
  enlace_id                  uuid not null references enlaces_token(id) on delete cascade,

  tipo                       text not null check (tipo in (
                               'apertura', 'firma', 'confirmacion', 'subida', 'codigo')),

  -- Quién dice ser y con qué cargo. Se copia tal cual a la copia congelada del documento.
  nombre                     text,
  cargo                      text,
  documento_identidad        text,
  declaracion_representacion boolean not null default false,

  -- PNG del trazo, en la carpeta de la organización: …/<ejercicio>/evidencies/<enlace_id>.png (§B.3).
  trazo_firma_ruta           text,

  ip                         inet,
  user_agent                 text,
  -- Huella del texto EXACTO que se aceptó. Sin esto, «firmó» no dice qué firmó.
  sha256_texto               text,
  payload                    jsonb,

  -- Firma asistida (§15 del funcional): la cuenta del equipo que condujo el acto.
  asistido_por               uuid references auth.users(id) on delete set null,
  created_at                 timestamptz not null default now()
);

comment on table evidencias is
  'Trazas de cada acto sobre un enlace. No se borran nunca: son lo que hace demostrable una firma propia.';
comment on column evidencias.documento_identidad is
  'DNI de quien firma. FUERA del GRANT de SELECT de authenticated: solo lo lee el renderizador con service_role.';
comment on column evidencias.sha256_texto is
  'Huella del texto aceptado. Es lo que convierte un «va firmar» en un «va firmar AIXO».';

create index if not exists evidencias_enlace_idx on evidencias (enlace_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. resolver_enlace(): abrir un enlace sin sesión
-- ---------------------------------------------------------------------------
-- La llama `enlace-publico` (Edge Function con `verify_jwt = false`) tras hashear el
-- token que viene en la URL. Devuelve la fila **sin las credenciales** y con el
-- `estado_efectivo` calculado al vuelo.
--
-- POR QUÉ EL ESTADO SE CALCULA Y NO SE GUARDA. Un enlace caduca por el paso del tiempo,
-- no por un evento: si el estado `caducado` hubiera que escribirlo, entre el instante en
-- que vence y el instante en que un job lo marca habría una ventana en la que el enlace
-- sigue diciendo `activo` y funcionaría. Con el cálculo al vuelo esa ventana no existe.
-- El `estado` escrito sigue mandando cuando dice algo que el reloj no sabe (`usado`,
-- `revocado`).
--
-- NO DEVUELVE `token_hash` NI `codigo_hash` a propósito, aunque quien la llama sea
-- `service_role` y pudiera leerlos igual: la validación del código de 6 cifras será su
-- propia RPC en la fase 2 (comparar el hash dentro de la base, no sacarlo de ella), así
-- que nada de lo que existe hoy necesita ver esas dos columnas.
--
-- `security definer` y EXECUTE solo para `service_role`: quien la llama no tiene sesión,
-- así que ninguna política puede protegerla; lo que la protege es tener el token.
create or replace function public.resolver_enlace(p_token_hash text)
returns table (
  id                     uuid,
  proposito              text,
  objeto_tipo            text,
  objeto_id              uuid,
  destinatario_email     text,
  destinatario_nombre    text,
  canal                  text,
  caduca_at              timestamptz,
  codigo_caduca_at       timestamptz,
  tiene_codigo           boolean,
  abierto_at             timestamptz,
  usado_at               timestamptz,
  estado                 text,
  estado_efectivo        text,
  recordatorios          int,
  ultimo_recordatorio_at timestamptz,
  created_at             timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id,
         e.proposito,
         e.objeto_tipo,
         e.objeto_id,
         e.destinatario_email,
         e.destinatario_nombre,
         e.canal,
         e.caduca_at,
         e.codigo_caduca_at,
         (e.codigo_hash is not null)          as tiene_codigo,
         e.abierto_at,
         e.usado_at,
         e.estado,
         case
           when e.estado <> 'activo'    then e.estado
           when e.usado_at is not null  then 'usado'
           when e.caduca_at < now()     then 'caducado'
           else 'activo'
         end                                   as estado_efectivo,
         e.recordatorios,
         e.ultimo_recordatorio_at,
         e.created_at
    from enlaces_token e
   where e.token_hash = p_token_hash;
$$;

comment on function public.resolver_enlace(text) is
  'Abre un enlace por el hash de su token. Devuelve estado_efectivo (caducidad al vuelo) y nunca las credenciales.';

-- ---------------------------------------------------------------------------
-- 4. Las dos capas: GRANT (por columnas) + RLS
-- ---------------------------------------------------------------------------
-- ⚠️ PRIMERO REVOCAR. `20260721160000` dejó puesto `alter default privileges in schema
--    public grant select on tables to authenticated`, así que **estas dos tablas nacen
--    con SELECT sobre TODAS sus columnas**, incluidas `token_hash` y
--    `documento_identidad`. Sin este `revoke`, el `grant select (columnas)` de abajo no
--    quitaría nada: se sumaría a un permiso que ya está concedido.
revoke select on enlaces_token from authenticated;
revoke select on evidencias    from authenticated;

-- Todo menos `token_hash` y `codigo_hash`.
grant select (
  id, proposito, objeto_tipo, objeto_id,
  destinatario_email, destinatario_nombre, canal,
  codigo_caduca_at, caduca_at, abierto_at, usado_at, estado,
  recordatorios, ultimo_recordatorio_at, creado_por, created_at
) on enlaces_token to authenticated;

-- Todo menos `documento_identidad`.
grant select (
  id, enlace_id, tipo, nombre, cargo, declaracion_representacion,
  trazo_firma_ruta, ip, user_agent, sha256_texto, payload,
  asistido_por, created_at
) on evidencias to authenticated;

-- Sin GRANT de escritura para `authenticated` en ninguna de las dos, a propósito (ver
-- cabecera). `service_role` entra por su acceso total y por `BYPASSRLS`.

alter table enlaces_token enable row level security;
alter table evidencias    enable row level security;

-- Solo el equipo. Un externo con cuenta no tiene nada que hacer aquí: si le corresponde
-- un enlace, lo tiene en su correo, y el estado de sus documentos lo ve por `documentos`.
drop policy if exists "enllacos: intern" on enlaces_token;
create policy "enllacos: intern"
  on enlaces_token for select to authenticated
  using ((select public.es_intern()));

drop policy if exists "evidencies: intern" on evidencias;
create policy "evidencies: intern"
  on evidencias for select to authenticated
  using ((select public.es_intern()));

-- ---------------------------------------------------------------------------
-- 5. EXECUTE: quitar el PUBLIC por defecto
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Sin este revoke, `anon` podría abrir
--    cualquier enlace probando hashes contra PostgREST, sin ni siquiera tener sesión.
revoke execute on function public.resolver_enlace(text) from public, anon, authenticated;
grant  execute on function public.resolver_enlace(text) to service_role;

-- Verificación:
--   select has_table_privilege('authenticated','public.enlaces_token','SELECT');              -- f (tabla entera)
--   select has_column_privilege('authenticated','public.enlaces_token','estado','SELECT');    -- t
--   select has_column_privilege('authenticated','public.enlaces_token','token_hash','SELECT');-- f
--   select has_column_privilege('authenticated','public.evidencias','documento_identidad','SELECT'); -- f
--   select has_function_privilege('authenticated','public.resolver_enlace(text)','EXECUTE');  -- f
