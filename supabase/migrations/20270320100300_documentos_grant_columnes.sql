-- `documentos` pasa a GRANT de SELECT **por columnas**, sin `envio`. Cierra la deuda
-- §12.75 y tapa el cuarto agujero de la §12.55.
--
-- QUÉ GUARDA `envio`, y por qué no lo puede leer quien recibe el documento. Es el sobre
-- del correo que hay que mandar cuando el PDF esté listo: destinatario, asunto, plantilla
-- …y, en el resumen anual, **el token en claro del enlace de subida de factura**
-- (`emitir_resumen()`, `20261109100100:797`, `'token', v_token`). Ese token es una
-- credencial al portador: con él se sube la factura del donante sin tener cuenta. En
-- `enlaces_token` solo vive su sha256 —y la columna `token_hash` está fuera del GRANT
-- desde `20260928100300`— pero `documentos` tenía `grant select` **por tabla**
-- (`20260928100200:333`), así que el mismo secreto que se protege en una tabla se servía
-- en claro desde la otra: el donante lo leía por `documents_meus()` en su propio panel.
--
-- ES PREVENTIVO Y NO ROMPE NADA, medido en producción el 14-09-2026: de **15** documentos,
-- **2** tienen `envio` no nulo y son los dos convenios, con claves `destinatario` y
-- `motivo`; **cero** llevan token, porque todavía no se ha emitido ningún resumen anual.
-- O sea que hoy no hay ningún secreto expuesto — lo habría el día que alguien emitiera el
-- primer RES, que es exactamente el día en que nadie estaría mirando esto.
--
-- «ES SU PROPIO TOKEN, ASÍ QUE NO PASA NADA» ERA EL ARGUMENTO, y es el que caduca solo.
-- Vale mientras `envio` guarde únicamente cosas del destinatario; en cuanto guarde algo de
-- la otra parte —un documento a dos bandas tiene dos— pasa a ser una fuga, y para entonces
-- el cambio ya no sería de una línea. Cerrarlo ahora cuesta este fichero.
--
-- ⚠️ EFECTO LATERAL DESEADO, Y HAY QUE SABERLO ANTES DE AÑADIR UNA COLUMNA: a partir del
--    `revoke` de abajo, **toda columna nueva de `documentos` nace SIN SELECT** y quien la
--    añada tendrá que otorgarla a mano. Es la contrapartida exacta del
--    `alter default privileges in schema public grant select on tables to authenticated`
--    de `20260721160000:66`, que hace que cada TABLA nueva nazca con SELECT sobre todo:
--    ese default privilege actúa al crear la tabla, no al añadir una columna. El
--    precedente es `enlaces_token.rol_parte` (`20270304100200:39`), que necesitó su propio
--    `grant select (rol_parte)` para que el panel pudiera leerla. Si algún día una columna
--    nueva «no se ve» desde el navegador con un `42501 permission denied for column`, la
--    causa es esta y el arreglo es una línea.
--
-- ⚠️ Y LA CONSECUENCIA INMEDIATA PARA QUIEN CONSULTA: **`select('*')` sobre `documentos`
--    pasa a responder `42501 permission denied for column "envio"`**, igual que ya pasa en
--    `enlaces_token`, `evidencias` y `parametros_documentales` (§4). Hay que pedir columnas
--    explícitas, y en un solo literal (§7). Comprobado antes de escribir esto: los **ocho**
--    `select` sobre `documentos` que hay en `src/` piden columnas explícitas y ninguno pide
--    `envio` ni usa `*`; y las cuatro Edge Functions que la consultan
--    —`generar-documento` (la única que lee `envio`, para mandar el correo),
--    `descargar-documento`, `enlace-publico` y `limpiar-documentos-prueba`— usan
--    `service_role`, que no pasa por estos GRANT.
--
-- ⚠️ ESTO NO TOCA LA RLS. Quién ve qué documento lo siguen decidiendo `documents_meus()` y
--    la política de `20260928100800`. El GRANT por columnas es la otra capa: RLS sabe
--    restringir filas y no columnas; el GRANT, al revés (§4).

-- ---------------------------------------------------------------------------
-- 1. El GRANT por columnas
-- ---------------------------------------------------------------------------
-- PRIMERO REVOCAR, o el grant de abajo no quitaría nada: se sumaría a un permiso de tabla
-- que ya está concedido. Mismo orden que `20260928100300:223` y `20260928100400:146`.
revoke select on documentos from authenticated;

-- Las 27 columnas que quedan. La que falta es `envio`, y es la única.
grant select (
  id, tipo, subtipo, objeto_tipo, objeto_id,
  numero_completo, version, serie, ejercicio,
  modo, idioma, plantilla_id,
  datos, sha256_datos,
  ruta, sha256_fichero, bytes, paginas,
  estado, intentos, reencolados, ultimo_error,
  vigente, sustituido_por,
  emitido_por, emitido_at, fichero_at
) on documentos to authenticated;

comment on column documentos.envio is
  'Sobre del correo a enviar cuando el PDF esté listo. Puede llevar el token en claro del enlace (resumen anual): FUERA del GRANT de SELECT de authenticated, solo service_role.';

-- ---------------------------------------------------------------------------
-- 2. documento_vigente(): la única función que se rompía con el revoke
-- ---------------------------------------------------------------------------
-- 🔴 SIN ESTO, EL REVOKE DEJA UNA FUNCIÓN PÚBLICA ROTA. `documento_vigente()` es
--    `security invoker` **a propósito** —así la RLS de `documentos` se aplica igual que en
--    cualquier `select`, y un externo no puede sacar por aquí un documento que la política
--    le niega— y su cuerpo era `select d.* from documentos d …`. Un `d.*` es una
--    referencia de fila entera y exige SELECT sobre TODAS las columnas: en cuanto `envio`
--    sale del GRANT, cualquier cuenta con sesión que la llame se lleva un
--    `42501 permission denied for column`.
--
--    Y aunque el privilegio no cortara, `returns documentos` **devuelve el tipo compuesto
--    entero, `envio` incluido**: la función era, ella sola, la puerta trasera del GRANT que
--    esta migración acaba de poner. O sea que no bastaba con que siguiera funcionando:
--    tenía que dejar de devolver esa columna.
--
-- POR ESO CAMBIA EL TIPO DE RETORNO, y eso obliga a `drop` + `create` (`create or replace`
-- no admite cambiarlo). Se puede hacer sin romper nada porque **no la llama nadie**:
-- comprobado el 14-09-2026, cero referencias en `src/`, `scripts/` y
-- `supabase/functions/`, y cero dependencias en `pg_depend`. Es API documentada (§4bis)
-- que todavía no ha estrenado consumidor, y este es el momento barato de ajustarla.
--
-- Lo que cambia para quien la llame algún día: devuelve las mismas 27 columnas que puede
-- leer con un `select`, en vez de un compuesto `documentos`. Por PostgREST eso es un array
-- de cero o una fila en vez de un objeto o `null`.
--
-- ⚠️ Se queda `security invoker`, que es lo que la hace segura. Convertirla en
--    `security definer` para «arreglar» el privilegio habría hecho justo lo contrario:
--    saltarse la RLS y devolver el documento de cualquiera.
drop function if exists public.documento_vigente(text, uuid, text);

create function public.documento_vigente(
  p_objeto_tipo text,
  p_objeto_id   uuid,
  p_tipo        text
)
returns table (
  id              uuid,
  tipo            text,
  subtipo         text,
  objeto_tipo     text,
  objeto_id       uuid,
  numero_completo text,
  version         int,
  serie           text,
  ejercicio       int,
  modo            text,
  idioma          text,
  plantilla_id    uuid,
  datos           jsonb,
  sha256_datos    text,
  ruta            text,
  sha256_fichero  text,
  bytes           int,
  paginas         int,
  estado          text,
  intentos        int,
  reencolados     int,
  ultimo_error    text,
  vigente         boolean,
  sustituido_por  uuid,
  emitido_por     uuid,
  emitido_at      timestamptz,
  fichero_at      timestamptz
)
language sql
stable
-- Sin `security definer`: ver arriba. Es lo que hace que la RLS se aplique.
set search_path = public, pg_temp
as $$
  select d.id, d.tipo, d.subtipo, d.objeto_tipo, d.objeto_id,
         d.numero_completo, d.version, d.serie, d.ejercicio,
         d.modo, d.idioma, d.plantilla_id,
         d.datos, d.sha256_datos,
         d.ruta, d.sha256_fichero, d.bytes, d.paginas,
         d.estado, d.intentos, d.reencolados, d.ultimo_error,
         d.vigente, d.sustituido_por,
         d.emitido_por, d.emitido_at, d.fichero_at
    from documentos d
   where d.objeto_tipo = p_objeto_tipo
     and d.objeto_id   = p_objeto_id
     and d.tipo        = p_tipo
     and d.vigente
   limit 1;
$$;

comment on function public.documento_vigente(text, uuid, text) is
  'Qué PDF vale hoy para este objeto. security invoker a propósito: la RLS de documentos se aplica. NO devuelve `envio` (puede llevar un token).';

-- `drop` + `create` pierde los privilegios: se reponen los mismos que tenía
-- (`20260928100800:479`).
revoke execute on function public.documento_vigente(text, uuid, text) from public, anon;
grant  execute on function public.documento_vigente(text, uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
-- 1. El GRANT quedó como se quería: 27 columnas y ninguna de tabla.
--
--   select has_table_privilege('authenticated','public.documentos','SELECT');      -- f
--   select has_column_privilege('authenticated','public.documentos','id','SELECT');    -- t
--   select has_column_privilege('authenticated','public.documentos','envio','SELECT'); -- f
--   select count(*) from information_schema.column_privileges
--    where table_schema='public' and table_name='documentos'
--      and grantee='authenticated' and privilege_type='SELECT';                    -- 27
--
-- 2. Desde el navegador, con una sesión del equipo y otra de un donante:
--      select * from documentos  →  42501 permission denied for column "envio"
--      select id, tipo, numero_completo from documentos  →  las filas de siempre
--    Lo comprueban cuatro checks nuevos de `scripts/comprobar-rls.ts`.
--
-- 3. Y que la función sigue en pie para una cuenta con sesión:
--   select * from documento_vigente('convenio', '<uuid d''un conveni propi>', 'CONV');
