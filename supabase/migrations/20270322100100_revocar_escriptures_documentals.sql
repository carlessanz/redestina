-- ---------------------------------------------------------------------------
-- Quitar el INSERT/UPDATE/DELETE que `authenticated` tenía sobre 33 relaciones que no
-- debe escribir — el circuito documental entero, entre ellas
-- ---------------------------------------------------------------------------
-- Deuda §12.103. Hermana exacta de `20270309100000` (el TRUNCATE), y se lee mejor con
-- aquella al lado: mismo origen, mismo tipo de arreglo, misma honestidad sobre el alcance.
--
-- DE DÓNDE VIENE. De ningún GRANT de este repo. El bootstrap de Supabase deja puesto un
-- `alter default privileges in schema public grant all on tables to authenticated` para el
-- rol `postgres`, que es con el que corren las migraciones, así que **cada `create table`
-- hereda `arwdxtm` sin que nadie escriba una línea**. Se ve de un vistazo:
--
--   select pg_get_userbyid(defaclrole), defaclacl from pg_default_acl
--    where defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r';
--   -- postgres → {…, authenticated=arwdxtm/postgres, …}
--
-- Ese `a w d` (INSERT, UPDATE, DELETE) es lo que esta migración retira. La `D` (TRUNCATE)
-- ya la quitó `20270309100000`, y por eso en el ACL de arriba ya no aparece: es la prueba
-- de que este mecanismo funciona y de que el problema era exactamente el mismo.
--
-- POR QUÉ IMPORTA. Toda la doctrina de §4 es «los GRANT dicen qué operaciones puede
-- intentar un rol; las políticas, sobre qué filas», y se apoya en que hacen falta **las
-- dos capas**. En estas 33 relaciones solo había una: la RLS. §4 afirma «ninguna escritura
-- en `documentos`, `documento_envios`, `series_documentales`, `enlaces_token`,
-- `evidencias` ni `municipios`», y «sin GRANT de DELETE» en `plantillas_documento`, y
-- «sin INSERT en `excedentes`», y «sin INSERT en `wa_messages`» — las cuatro frases
-- describían la intención, no el estado de la base.
--
-- ⚠️ NO ES ALCANZABLE HOY, y conviene decirlo con precisión para no exagerar el hallazgo.
--    Las 33 tienen RLS activa y **ninguna política que autorice la operación que se
--    revoca**, así que un `insert`/`update`/`delete` de `authenticated` no encuentra
--    política y PostgREST lo rechaza igual. El arnés ya lo comprueba en las que tienen
--    check (`documentos`, `convenios`, `planes_prevencion`, `plantillas_documento`,
--    `parametros_documentales`). Esto **no cierra una puerta abierta: repone la capa que
--    faltaba**. Lo que cambia en la práctica es el mensaje —`42501 permission denied` en
--    vez de «0 filas afectadas»— y que una política mal escrita mañana ya no baste para
--    abrir la escritura por accidente.
--
-- ---------------------------------------------------------------------------
-- EL CRITERIO, MEDIDO Y NO SUPUESTO
-- ---------------------------------------------------------------------------
-- Se revoca **(relación, operación)** cuando `authenticated` tiene ese privilegio **y no
-- existe ninguna política que se lo pueda autorizar** —ni de esa operación ni `for all`—.
-- Es por operación y no por tabla a propósito: `excedentes` tiene política de UPDATE pero
-- no de INSERT ni de DELETE, y §4 dice justamente eso («sin INSERT en excedentes»).
--
-- La consulta que produjo la lista, para poder repetirla:
--
--   with t as (select c.oid, c.relname from pg_class c join pg_namespace n
--                on n.oid = c.relnamespace
--               where n.nspname = 'public' and c.relkind in ('r','v')),
--        cmds as (select * from (values ('INSERT','a'),('UPDATE','w'),('DELETE','d'))
--                   as v(priv, code))
--   select t.relname, cmds.priv
--     from t cross join cmds
--    where has_table_privilege('authenticated', t.oid, cmds.priv)
--      and not exists (select 1 from pg_policy p
--                       where p.polrelid = t.oid
--                         and (p.polcmd = cmds.code or p.polcmd = '*')
--                         and 'authenticated' = any(
--                               select pg_get_userbyid(r) from unnest(p.polroles) r));
--
-- 🔴 LO QUE NO SE TOCA, QUE ES LO ÚNICO QUE PODRÍA ROMPER EL PANEL. Nueve tablas
--    conservan intacto todo lo que §4 les concede, porque tienen política que lo autoriza:
--
--   | Tabla                  | Conserva              | Quién la escribe                     |
--   |------------------------|-----------------------|--------------------------------------|
--   | wa_contacts            | INSERT, UPDATE, DELETE| Mensajería (`assegurarContacte`)     |
--   | productores            | INSERT, UPDATE, DELETE| `RecordDetail` (CRUD del equipo)     |
--   | entidades              | INSERT, UPDATE, DELETE| `RecordDetail` (CRUD del equipo)     |
--   | canalizaciones         | INSERT, UPDATE, DELETE| `OfferDetail`                        |
--   | oferta_respuestas      | INSERT, UPDATE, DELETE| `OfferDetail` (upsert al enviar)     |
--   | productor_ubicaciones  | INSERT, UPDATE, DELETE| fichas y ubicaciones                 |
--   | meta_test_recipients   | INSERT, UPDATE, DELETE| `src/lib/metaTest.ts`                |
--   | email_test_recipients  | INSERT, UPDATE, DELETE| `src/lib/emailTest.ts`               |
--   | app_settings           | INSERT, UPDATE, DELETE| `src/lib/settings.ts` (upsert)       |
--
--    Y cuatro más conservan **parte**: `excedentes` el UPDATE, `wa_messages` el DELETE,
--    `plantillas_documento` el INSERT y el UPDATE, `parametros_documentales` el UPDATE.
--
-- ⚠️ `perfiles` NO APARECE EN NINGUNA DE LAS DOS LISTAS, y es deliberado. Tiene
--    `grant update (nombre, telefono, idioma, vista_defecto)` —por columnas, §4bis— y
--    **ninguna** escritura a nivel de tabla (`20260730090000:125` hizo `revoke all` antes
--    de conceder). Un `revoke update on perfiles` se llevaría por delante ese grant de
--    columnas y la gente dejaría de poder editar su ficha. No hace falta tocarla: la
--    consulta de arriba no la devuelve, porque `has_table_privilege(…, 'UPDATE')` ya es
--    `false`. Lo mismo con `membresias`, `usuario_roles` y `app_config`.
--
-- ⚠️ Y por el mismo motivo **no se revoca el UPDATE de `parametros_documentales`**, que
--    sí tiene `grant update (…)` por columnas (`20260928100400:161`) además del de tabla.
--    Ahí solo se quitan INSERT y DELETE, que no tienen grant de columnas detrás.
--
-- QUÉ NO CAMBIA. `service_role` conserva todo: las Edge Functions, los jobs y las
-- funciones `security definer` —que corren con los privilegios de su propietario,
-- `postgres`— siguen escribiendo igual. Las RPC de emisión, conciliación, firma y cierre
-- son el único camino de escritura de estas tablas desde el primer día y no las toca nada
-- de esto.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Las 27 tablas sin ninguna política de escritura: fuera las tres operaciones
-- ---------------------------------------------------------------------------
-- El circuito documental completo (emisión, numeración, enlaces, evidencias, albaranes,
-- convenios, cierres, planes y externos), los catálogos que solo escribe `service_role` o
-- una migración (`productos`, `causas`, `factores_conversion`, `tipos_caja`, `municipios`,
-- `modalitat_receptor_compat`, `convenios_exigidos`), la identidad común
-- (`organizaciones`, que se escribe con `actualizar_meu_canal()` y con su trigger) y
-- `intake_sessions`, que es del webhook.
revoke insert, update, delete on
  albaran_lineas,
  albaranes,
  causas,
  cierre_donante_lineas,
  cierre_periodo_lineas,
  cierres_donante,
  cierres_ejercicio,
  cierres_periodo,
  convenios,
  convenios_exigidos,
  costes_producto,
  costes_producto_hist,
  documento_envios,
  documentos,
  documentos_externos,
  enlaces_token,
  espigoladas,
  evidencias,
  factores_conversion,
  intake_sessions,
  modalitat_receptor_compat,
  municipios,
  organizaciones,
  planes_prevencion,
  productos,
  series_documentales,
  tipos_caja
from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Las cuatro que conservan parte, cada una con su motivo escrito
-- ---------------------------------------------------------------------------
-- `excedentes`: los crea el servidor, que es quien genera `id_excedente` y `texto_oferta`
-- (§4). El UPDATE se queda: es como el equipo normaliza `disponible_hasta` y cierra.
revoke insert, delete on excedentes from authenticated;

-- `wa_messages`: el envío pasa siempre por la Edge Function (§4). El DELETE se queda: es
-- el botón de borrar una conversación entera desde Mensajería.
revoke insert, update on wa_messages from authenticated;

-- `plantillas_documento`: «una plantilla se retira, no se borra» (§4). INSERT y UPDATE se
-- quedan, con su política de `pot_aprovar()`.
revoke delete on plantillas_documento from authenticated;

-- `parametros_documentales`: fila única con `check (id = 1)`, «sin INSERT ni DELETE: la
-- fila única ya existe y no se crea ni se destruye» (`20260928100400:170`). El UPDATE se
-- queda **y no se toca**, porque tiene grant por columnas detrás (ver la cabecera).
revoke insert, delete on parametros_documentales from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Las seis vistas: tercera capa, barata
-- ---------------------------------------------------------------------------
-- Las seis son `security_invoker = true`, así que una escritura a través de una vista
-- auto-actualizable ya se comprobaría contra la tabla de debajo —que acaba de perder el
-- privilegio— y contra su RLS. Se revoca igualmente por dos razones: para que la consulta
-- del criterio de arriba devuelva cero filas y el estado sea comprobable de un vistazo, y
-- porque el día que alguien cree una vista SIN `security_invoker` esa vista escribiría con
-- los permisos de su propietario, que es `postgres`.
revoke insert, update, delete on
  v_albaranes_bandeja,
  v_campanya_convenis,
  v_entidades_llistat,
  v_fitxes_incompletes_conveni,
  v_organizaciones,
  v_productores_llistat
from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Y que no vuelva con la siguiente tabla
-- ---------------------------------------------------------------------------
-- Sin esta línea el problema se reintroduce solo: es literalmente lo que pasó con las 33
-- de arriba. Gemelo de `20270309100000:38`.
--
-- 🔴 CONSECUENCIA QUE HAY QUE TENER PRESENTE AL CREAR UNA TABLA NUEVA: a partir de aquí
--    `authenticated` nace con **SELECT y nada más** (el SELECT lo concede el
--    `alter default privileges … grant select` de `20260721160000`). Una tabla nueva que
--    SÍ deba ser escribible desde el panel necesita su `grant insert, update, delete on …
--    to authenticated` **explícito**, además de su política. Eso es exactamente lo que se
--    quiere: que escribir sea una decisión que alguien toma y se lee en el diff, no algo
--    que se hereda. Las seis tablas de §4 que hoy son escribibles ya lo tienen escrito así
--    (`20260722140000`, `20260723100000`, `20260724100000`, `20260730095000`…).
alter default privileges in schema public
  revoke insert, update, delete on tables from authenticated;

-- ⚠️ QUEDA UNO FUERA, y es deliberado, igual que los cinco de `20270309100000`: hay un
--    segundo juego de privilegios por defecto en `public` **para el rol `supabase_admin`**
--    (`{…, authenticated=arwdDxtm/supabase_admin, …}`), que es el andamiaje de la
--    plataforma. No se puede tocar desde aquí —`postgres` no es miembro de
--    `supabase_admin`, comprobado con `pg_has_role`, así que el `alter default privileges
--    for role supabase_admin` fallaría y tumbaría la migración— y no hace falta: las
--    tablas de este proyecto las crea `postgres` al aplicar las migraciones, no
--    `supabase_admin`. Es el mismo blind spot que tiene el arreglo del TRUNCATE, y por el
--    mismo motivo.

-- ---------------------------------------------------------------------------
-- Verificación (con la service key; `select` sobre el catálogo, no escribe nada)
-- ---------------------------------------------------------------------------
--   -- 1. LA COMPROBACIÓN QUE IMPORTA: las trece que SÍ escriben conservan lo suyo.
--   --    Tiene que devolver exactamente estas trece filas, con esos valores.
--   select c.relname,
--          has_table_privilege('authenticated', c.oid, 'INSERT') as ins,
--          has_table_privilege('authenticated', c.oid, 'UPDATE') as upd,
--          has_table_privilege('authenticated', c.oid, 'DELETE') as del
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('wa_contacts','productores','entidades','canalizaciones',
--                        'oferta_respuestas','productor_ubicaciones','meta_test_recipients',
--                        'email_test_recipients','app_settings','excedentes','wa_messages',
--                        'plantillas_documento','parametros_documentales')
--    order by 1;
--   -- esperado: las nueve primeras t/t/t; excedentes f/t/f; wa_messages f/f/t;
--   --           plantillas_documento t/t/f; parametros_documentales f/t/f
--
--   -- 2. Y el grant por columnas de `perfiles` sigue intacto (cuatro filas: nombre,
--   --    telefono, idioma, vista_defecto).
--   select column_name from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'perfiles'
--      and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 1;
--
--   -- 3. El invariante, con la consulta del criterio: cero filas.
--   with t as (select c.oid, c.relname from pg_class c join pg_namespace n
--                on n.oid = c.relnamespace
--               where n.nspname = 'public' and c.relkind in ('r','v')),
--        cmds as (select * from (values ('INSERT','a'),('UPDATE','w'),('DELETE','d'))
--                   as v(priv, code))
--   select t.relname, cmds.priv
--     from t cross join cmds
--    where has_table_privilege('authenticated', t.oid, cmds.priv)
--      and not exists (select 1 from pg_policy p
--                       where p.polrelid = t.oid
--                         and (p.polcmd = cmds.code or p.polcmd = '*')
--                         and 'authenticated' = any(
--                               select pg_get_userbyid(r) from unnest(p.polroles) r))
--    order by 1, 2;   -- 0 filas
--
--   -- 4. Los privilegios por defecto ya no conceden escritura a `authenticated`.
--   select defaclacl::text from pg_default_acl
--    where defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r'
--      and defaclrole = 'postgres'::regrole;   -- authenticated=rxtm/postgres
