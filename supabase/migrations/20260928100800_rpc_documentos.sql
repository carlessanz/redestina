-- RPC del sistema documental: dónde vive un documento, quién puede verlo, cómo se emite
-- uno de prueba y cómo el servidor cierra el círculo cuando el PDF ya está subido.
--
-- Este fichero completa 20260928100200_documentos.sql: allí quedó la tabla con RLS
-- habilitada y SIN política de SELECT, porque la política necesita `documents_meus()` y
-- esa función se declara aquí. Entre las dos migraciones la tabla está cerrada para
-- `authenticated`, que es el intermedio correcto.

-- ---------------------------------------------------------------------------
-- 1. documents_meus(): el puente entre `documentos` y las organizaciones del usuario
-- ---------------------------------------------------------------------------
-- POR QUÉ UNA FUNCIÓN PUENTE Y NO UN `exists` EN LA POLÍTICA (§A, deuda §12.23): un
-- `exists` correlacionado con la fila de `documentos` se evalúa como SubPlan una vez por
-- fila y, dentro, recorre `albaranes`/`excedentes` reevaluando la RLS de esas tablas.
-- Una función `security definer` que devuelve `setof uuid` se evalúa **una vez por
-- consulta** (InitPlan, envuelta en `(select …)`) y no reentra en ninguna política.
--
-- EN LA FASE 1 DEVUELVE VACÍO, y está escrita a propósito para que las fases siguientes
-- la reescriban con `create or replace` sin tocar la tabla ni su política:
--   fase 3: REC -> el productor del excedente; ENT/OPE -> la entidad de la canalización.
--   fase 2: CONV -> el productor o la entidad del convenio.
--   fase 4: RES/CD -> el productor del `cierres_donante`.
--
-- EL PARÁMETRO `p_user` existe para que `descargar-documento` pueda preguntar con
-- `service_role` por un usuario concreto (ya ha validado su JWT con `contextoUsuario()`).
-- Un `authenticated` que intente pasar el uuid de otra persona se lleva un 42501: el
-- parámetro es una comodidad del servidor, no un modo de suplantación.
create or replace function public.documents_meus(p_user uuid default null)
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
    raise exception 'No pots consultar els documents d''una altra persona'
      using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  -- Fase 1: ninguna organización tiene todavía documentos propios, porque no existe
  -- ningún documento de negocio. Se devuelve el conjunto vacío explícitamente en vez de
  -- no crear la función: así la política de `documentos` es la definitiva desde el
  -- primer día y las fases siguientes solo cambian este cuerpo.
  return;
end;
$$;

comment on function public.documents_meus(uuid) is
  'Ids de documentos que ve una organización del usuario. Fase 1: vacío. Cada fase la reescribe.';

-- ---------------------------------------------------------------------------
-- 2. La política de SELECT de `documentos`
-- ---------------------------------------------------------------------------
-- Los de `modo = 'prueba'` NO los ve ningún externo, ni siquiera los de su organización:
-- un certificado de ensayo con marca de agua en la carpeta de un donante es exactamente
-- el malentendido que el modo prueba existe para evitar.
drop policy if exists "documentos: intern o meus" on documentos;
create policy "documentos: intern o meus"
  on documentos for select to authenticated
  using (
       (select public.es_intern())
    or (modo <> 'prueba' and id in (select public.documents_meus()))
  );

-- ---------------------------------------------------------------------------
-- 3. ruta_documento(): la carpeta por organización, decidida en SQL
-- ---------------------------------------------------------------------------
-- §B.3 del plan. La ruta se calcula **al insertar** y se guarda en `documentos.ruta`;
-- la Edge Function sube exactamente ahí y no elige carpeta. Si la eligiera ella, la
-- estructura del bucket dependería del código desplegado en cada momento en vez del
-- dato, y dos versiones de la función podrían dejar el mismo documento en dos sitios.
--
-- FORMA DE LAS RUTAS (dentro del bucket `documentos`):
--
--   productors/<productor_id>/<ejercicio>/<CARPETA>/<numero_completo>-v<version>.pdf
--   entitats/<entidad_id>/<ejercicio>/<CARPETA>/<numero_completo>-v<version>.pdf
--   productors/<productor_id>/proves/<ejercicio>/<CARPETA>/…      (modo = 'prueba')
--   proves/<ejercicio>/PROVA/<numero_completo>-v<version>.pdf     (tipo = 'PROVA')
--
-- `<CARPETA>` es el `tipo` sin el prefijo `R-`: un rectificativo se archiva **junto al
-- original** (`R-REC-2026-00007-v1.pdf` vive en `REC/`), que es donde lo busca quien
-- revisa ese albarán.
--
-- PROPIETARIO POR TIPO (dónde vive el fichero, §B.3):
--   REC, RES, CD, CT, PLA        -> productors/<id>   (el generador)
--   OPE                          -> productors/<id>   (el vendedor; el comprador lo ve
--                                                      por `documents_meus()`)
--   ENT                          -> entitats/<id>     (la entidad receptora)
--   CONV                         -> la parte que firma: productor o entidad
--   PROVA                        -> sin organización: `proves/`
--
-- ⚠️ NO es `immutable`, aunque el plan lo insinuara: resolver el propietario exige leer
--    `albaranes`, `excedentes` o `convenios`. Es `stable`, que es lo correcto y lo que
--    permite usarla dentro de la misma transacción de emisión.
--
-- El día que exista la `organizacion` unificada (§1bis, brecha 2), pasar de
-- `productors/`+`entitats/` a `organitzacions/` es una migración de
-- `storage.objects.name` y `documentos.ruta`, no un cambio de diseño: la ruta la decide
-- esta función y nada más.
create or replace function public.ruta_documento(
  p_objeto_tipo     text,
  p_objeto_id       uuid,
  p_tipo            text,
  p_numero_completo text,
  p_version         int,
  p_modo            text,
  p_ejercicio       int
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_carpeta text;
  v_fichero text;
  v_org     text;
begin
  -- El rectificativo se archiva con el original.
  v_carpeta := regexp_replace(p_tipo, '^R-', '');
  v_fichero := p_numero_completo || '-v' || p_version::text || '.pdf';

  -- Documento de humo: no pertenece a ninguna organización.
  if p_tipo = 'PROVA' or p_objeto_tipo = 'prova' then
    return 'proves/' || p_ejercicio::text || '/PROVA/' || v_fichero;
  end if;

  -- Resolución del propietario. Cada fase rellena su rama con `create or replace`:
  --
  --   when 'albaran'        -> select case a.tipo
  --                                     when 'ENT' then 'entitats/'   || c.entidad_id
  --                                     else            'productors/' || e.productor_id
  --                                   end
  --                              from albaranes a … (fase 3)
  --   when 'convenio'       -> 'productors/'||c.productor_id  o  'entitats/'||c.entidad_id (fase 2)
  --   when 'cierre_donante' -> 'productors/'||cd.productor_id (fase 4)
  --   when 'espigolada'     -> 'productors/'||es.productor_id (fase 3)
  --   when 'plan'           -> según la organización del plan   (fase 5)
  --
  -- En la fase 1 no existe ninguna de esas tablas, así que el mensaje dice qué falta en
  -- vez de inventarse una carpeta: un fichero mal archivado es mucho más caro de
  -- arreglar que una emisión que no llega a ocurrir.
  v_org := null;
  if v_org is null then
    raise exception
      'ruta_documento(): el tipus % encara no te propietari resoluble en la fase 1 (falta la taula de %). Nomes PROVA esta implementat.',
      p_tipo, p_objeto_tipo using errcode = '0A000';
  end if;

  if p_modo = 'prueba' then
    return v_org || '/proves/' || p_ejercicio::text || '/' || v_carpeta || '/' || v_fichero;
  end if;
  return v_org || '/' || p_ejercicio::text || '/' || v_carpeta || '/' || v_fichero;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. puede_ver_documento(): la autorización de la descarga
-- ---------------------------------------------------------------------------
-- La usa `descargar-documento` antes de firmar la URL de 60 s. Se escribe entera aquí en
-- vez de apoyarse en la RLS de la tabla porque la Edge Function corre con `service_role`,
-- que tiene `BYPASSRLS` (§4bis): sin una comprobación propia, cualquier sesión válida
-- podría descargar cualquier documento.
--
-- Respeta el interruptor `roles_activos` con el mismo fail-open que `es_intern()`: con
-- el modelo de roles apagado, cualquier cuenta con sesión es equipo a todos los efectos.
create or replace function public.puede_ver_documento(
  p_documento uuid,
  p_user      uuid default null
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  d      documentos%rowtype;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots comprovar els permisos d''una altra persona'
      using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return false;
  end if;

  select * into d from documentos where id = p_documento;
  if d.id is null then
    return false;   -- no existe: se responde igual que «no puedes», sin filtrar nada
  end if;

  -- Equipo interno.
  if exists (select 1
               from usuario_roles r
               join perfiles p on p.id = r.user_id
              where r.user_id = v_user
                and p.activo
                and r.rol in ('super_admin', 'admin', 'tecnic')) then
    return true;
  end if;

  -- Fail-open del interruptor, igual que es_intern(): con `roles_activos` apagado, la
  -- base entera es permisiva y esto no debe ser la única cosa que siga cerrada.
  if not public.roles_activos() then
    return exists (select 1 from perfiles p where p.id = v_user and p.activo);
  end if;

  -- Los documentos en modo prueba no salen nunca de las manos del equipo.
  if d.modo = 'prueba' then
    return false;
  end if;

  return d.id in (select public.documents_meus(v_user));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. documento_vigente(): qué PDF vale hoy para este objeto
-- ---------------------------------------------------------------------------
-- Es la consulta que sustituye a la FK inversa que el dominio no tiene: un albarán no
-- guarda «mi PDF», se le pregunta a esto. `security invoker` a propósito —no lleva
-- `security definer`—: así la RLS de `documentos` se aplica igual que en cualquier
-- `select`, y un externo no puede sacar por aquí un documento que la política le niega.
create or replace function public.documento_vigente(
  p_objeto_tipo text,
  p_objeto_id   uuid,
  p_tipo        text
) returns documentos
language sql
stable
set search_path = public, pg_temp
as $$
  select d.*
    from documentos d
   where d.objeto_tipo = p_objeto_tipo
     and d.objeto_id   = p_objeto_id
     and d.tipo        = p_tipo
     and d.vigente
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. emitir_documento_prova(): el documento de humo
-- ---------------------------------------------------------------------------
-- Emite un documento que no pertenece a ningún objeto de negocio y recorre exactamente
-- el mismo camino que un albarán: pide número a la serie, congela un snapshot, calcula
-- su huella, decide la ruta y queda `pendiente_fichero` para que la Edge Function haga
-- el PDF. Sirve para dos cosas:
--
--   1. Probar el circuito entero antes de que exista ningún documento de negocio.
--   2. `p_fallar` levanta una excepción DESPUÉS de haber pedido el número. Es lo que
--      necesita `scripts/prueba-numeracion.ts`: si el contador fuera una `sequence`, ese
--      número quedaría quemado y la serie tendría un hueco permanente; con el
--      `insert … on conflict` de `siguiente_numero()`, el `rollback` lo devuelve y el
--      siguiente que llega se lo lleva. La prueba comprueba justo eso.
--
-- AUTORIZACIÓN: `es_super_admin()`, con la salida de siempre para el servidor —cuando
-- `auth.uid()` es null quien llama es `service_role` (Edge Function, script), y ahí no
-- hay rol de plataforma que consultar—. Es el mismo criterio que
-- `trg_membresias_control_aprovacio` (20260731100000).
create or replace function public.emitir_documento_prova(p_fallar boolean default false)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ejercicio int;
  v_n         int;
  v_numero    text;
  v_objeto    uuid := gen_random_uuid();
  v_datos     jsonb;
  v_id        uuid;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot emetre documents de prova'
      using errcode = '42501';
  end if;

  -- El ejercicio es el año natural en hora de Madrid: un documento emitido el 31/12 a
  -- las 23:30 pertenece a ese ejercicio, no al siguiente (§ cierre anual).
  v_ejercicio := extract(year from (now() at time zone 'Europe/Madrid'))::int;

  -- (1) El número, dentro de esta transacción.
  v_n      := public.siguiente_numero('PROVA', v_ejercicio);
  v_numero := public.formato_numero('PROVA', v_ejercicio, v_n);

  -- (2) El snapshot. Lleva una tabla de 40 líneas a propósito: es el caso que el
  --     maquetador de PDF tiene que resolver con cabecera repetida y pie paginado.
  v_datos := jsonb_build_object(
    'titol',      'Document de prova',
    'numero',     v_numero,
    'ejercici',   v_ejercicio,
    'emes_at',    to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'nota',       'Document de fum del sistema documental. No te cap valor legal ni fiscal.',
    'linies',     (select jsonb_agg(jsonb_build_object(
                            'ordre',    i,
                            'concepte', 'Linia de prova ' || i::text,
                            'unitats',  i,
                            'kg',       round((i * 7.5)::numeric, 2)))
                     from generate_series(1, 40) as i)
  );

  -- (3) La huella del snapshot. `jsonb::text` es canónico (claves ordenadas, sin
  --     espacios superfluos), así que el mismo contenido da siempre el mismo hash.
  --     `sha256()` es built-in de Postgres: no depende del search_path restringido.
  -- (4) La ruta, decidida aquí y congelada en la fila.
  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, datos, sha256_datos, ruta, estado, emitido_por
  ) values (
    'PROVA', 'emes', 'prova', v_objeto,
    v_numero, 1, 'PROVA', v_ejercicio,
    'prueba', 'ca', v_datos,
    encode(sha256(convert_to(v_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('prova', v_objeto, 'PROVA', v_numero, 1, 'prueba', v_ejercicio),
    'pendiente_fichero',
    auth.uid()
  ) returning id into v_id;

  -- (5) El fallo simulado, con el número ya pedido y la fila ya insertada: al deshacerse
  --     la transacción, el contador vuelve atrás y no queda hueco.
  if p_fallar then
    raise exception 'Fallada simulada despres de demanar el numero (%)', v_numero
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. reiniciar_documentos_prova(): dejar el ejercicio de prueba como estaba
-- ---------------------------------------------------------------------------
-- Es la ÚNICA excepción a la inmutabilidad de `documentos` (§A). El interruptor
-- `redestina.reinicio_prueba` se fija con `set_config(..., is_local => true)`: vive solo
-- dentro de esta transacción, así que no se puede dejar encendido por descuido ni
-- reutilizar desde otra sesión.
--
-- Solo toca lo de prueba: los documentos `modo = 'prueba'` y los contadores `PROVA` y
-- `P-*` del ejercicio en curso. Las series reales no se reinician nunca.
create or replace function public.reiniciar_documentos_prova()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ejercicio int;
  v_borrados  int;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot reiniciar el cicle de proves'
      using errcode = '42501';
  end if;

  v_ejercicio := extract(year from (now() at time zone 'Europe/Madrid'))::int;

  perform set_config('redestina.reinicio_prueba', 'on', true);

  -- `documento_envios` cae por cascada.
  delete from documentos where modo = 'prueba';
  get diagnostics v_borrados = row_count;

  update series_documentales
     set ultimo = 0
   where ejercicio = v_ejercicio
     and (serie = 'PROVA' or serie like 'P-%');

  return v_borrados;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Cierre del círculo: lo que escribe el servidor cuando el PDF ya existe
-- ---------------------------------------------------------------------------
-- Solo `service_role`. La `ruta` NO se pasa: ya estaba fijada al insertar, y la función
-- de generación no puede elegir dónde deja el fichero (§B.3).
--
-- `marcar_documento_generado` es idempotente: si el documento ya está `emitido` devuelve
-- la fila sin tocar nada, porque `generar-documento` puede llegar dos veces (el trigger
-- de encolado y el job de reintento) y la segunda no debe pisar la huella de la primera.
create or replace function public.marcar_documento_generado(
  p_id      uuid,
  p_sha     text,
  p_bytes   int,
  p_paginas int
) returns documentos
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  d documentos%rowtype;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor marca un document com a generat'
      using errcode = '42501';
  end if;

  select * into d from documentos where id = p_id for update;
  if d.id is null then
    raise exception 'No existeix el document %', p_id using errcode = '22023';
  end if;
  if d.estado = 'emitido' then
    return d;   -- ya estaba: idempotente
  end if;

  update documentos
     set estado         = 'emitido',
         sha256_fichero = p_sha,
         bytes          = p_bytes,
         paginas        = p_paginas,
         fichero_at     = now(),
         ultimo_error   = null
   where id = p_id
  returning * into d;
  return d;
end;
$$;

create or replace function public.marcar_documento_error(
  p_id    uuid,
  p_error text
) returns documentos
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  d documentos%rowtype;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor marca un document com a fallat'
      using errcode = '42501';
  end if;

  update documentos
     set estado       = case when estado = 'emitido' then estado else 'error' end,
         intentos     = intentos + 1,
         ultimo_error = left(coalesce(p_error, 'error desconegut'), 2000)
   where id = p_id
  returning * into d;

  if d.id is null then
    raise exception 'No existeix el document %', p_id using errcode = '22023';
  end if;
  return d;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. EXECUTE: quitar el PUBLIC por defecto y conceder lo justo
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Sin estos revoke, `anon` podría llamar
--    a cualquiera de estas funciones sin ni siquiera tener sesión.
do $$
declare
  f text;
begin
  -- Las que puede usar una sesión normal (la RLS y la Edge Function de descarga).
  foreach f in array array[
    'documents_meus(uuid)',
    'puede_ver_documento(uuid,uuid)',
    'documento_vigente(text,uuid,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Las del super_admin: se conceden a `authenticated` porque la comprobación de rol la
  -- hace la propia función (y el arnés verifica que un `tecnic` se lleva un 42501).
  foreach f in array array[
    'emitir_documento_prova(boolean)',
    'reiniciar_documentos_prova()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Las del servidor: `authenticated` no las ve ni existiendo.
  foreach f in array array[
    'ruta_documento(text,uuid,text,text,int,text,int)',
    'marcar_documento_generado(uuid,text,int,int)',
    'marcar_documento_error(uuid,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- PENDIENTE DE LA FASE 1 (deliberadamente fuera del spike)
-- ---------------------------------------------------------------------------
--   · Trigger `documentos_encola_generacion` (`after insert` -> `net.http_post` a la
--     Edge Function `generar-documento` con `x-documentos-secret` de `app_config`,
--     patrón de 20260722130000_intake_recordatorios.sql). En el spike la función se
--     llama a mano, para poder medir el tiempo de generación sin el cron de por medio.
--   · `20260928100700_jobs_documentales.sql`: reintento cada 5 min y recordatorios.
--   · `reiniciar_documentos_prova()` borra las FILAS, no los objetos de `proves/` en
--     Storage: eso lo hará la RPC de reinicio del cierre (fase 4) a través de la Edge
--     Function, porque SQL no puede borrar del bucket.

-- Verificación:
--   select public.emitir_documento_prova();                       -- uuid
--   select numero_completo, ruta, estado from documentos;         -- PROVA-2026-0001, proves/…
--   select public.emitir_documento_prova(true);                   -- excepcion 22023
--   select ultimo from series_documentales where serie = 'PROVA'; -- NO ha avanzado
--   select public.reiniciar_documentos_prova();                   -- nº de filas borradas
