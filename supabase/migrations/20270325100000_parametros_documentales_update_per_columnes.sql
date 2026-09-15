-- ---------------------------------------------------------------------------
-- `parametros_documentales`: el UPDATE vuelve a ser por columnas (deuda §12.104)
-- ---------------------------------------------------------------------------
-- `20260928100400:161` concede `grant update (…)` dejando `id` fuera a propósito —«la fila 1
-- es la fila 1»—, pero esa tabla arrastraba además un `UPDATE` **a nivel de tabla** llegado
-- por los privilegios por defecto que Supabase deja puestos para `postgres`, y un privilegio
-- de tabla **subsume el de columnas**: `has_table_privilege('authenticated', …, 'UPDATE')`
-- respondía `true`, así que la lista de columnas no restringía nada.
--
-- POR QUÉ NO SE HIZO EN `20270322100100` (la tanda de la deuda 103), que revocó las
-- escrituras de 33 relaciones: allí el criterio fue «revocar solo donde no hay grant de
-- columnas detrás», porque un `revoke update` se lleva por delante los dos —el de tabla y el
-- de columnas— y habría dejado la tabla sin poder escribirse en absoluto. Es el mismo motivo
-- por el que aquella migración no tocó `perfiles`. La única forma segura es esta: revocar y
-- **volver a conceder la lista exacta**, que es una decisión aparte y merece su fichero.
--
-- ⚠️ LO QUE SE COMPROBÓ ANTES DE ESCRIBIRLO, porque de eso depende que no rompa nada:
--
--   1. **Hoy no la escribe nadie desde la aplicación.** Ni una pantalla ni un script con
--      sesión: la única referencia en `src/` es una LECTURA de `fecha_corte_convenios`
--      (`CampanyaConvenis.tsx:84`), y quien la rellena es el fixture con la service key, que
--      ignora GRANT y RLS. O sea que el `revoke` no puede romper ningún camino vivo.
--      ⚠️ El comentario de `20260928100400` dice «hay que poder rellenarlo desde
--      Configuració» — y esa pantalla **no existe todavía**. Por eso se reconcede la lista en
--      vez de cerrar la tabla del todo: el día que se construya, el permiso ya está, con la
--      forma correcta.
--
--   2. **El arnés sigue midiendo lo mismo.** Sus tres checks sobre esta tabla leen
--      `id, razon_social, cif…` (todas en el `grant select` por columnas) y el UPDATE que
--      lanza reescribe **`caducidad_enlace_dias`** con su propio valor (`COLUMNA_INOCUA`),
--      que sigue concedida. El «denegar» del técnico lo seguirá imponiendo la RLS
--      (`es_super_admin()`) y no el GRANT, que es justo lo que ese check existe para
--      verificar: si lo cortara el GRANT, saldría verde sin haber probado la política.
--
-- NO ERA ALCANZABLE, y conviene decirlo sin exagerar: el `check (id = 1)` remata el único
-- daño que el hueco permitía —mover la fila a otro id—, y la política de UPDATE ya exige
-- `es_super_admin()`. Esto no cierra una puerta abierta: **repone la capa que faltaba**, para
-- que el día que alguien relaje esa política el GRANT siga diciendo qué columnas se tocan.
--
-- `id` se queda fuera, como en la migración original. Y `apoderada_dni` se queda DENTRO:
-- es el campo que se escribe y no se lee (§4), y sin él no se podría rellenar nunca.
-- ---------------------------------------------------------------------------

-- Se lleva los dos: el de tabla (que sobraba) y el de columnas (que se repone abajo).
revoke update on parametros_documentales from authenticated;

-- La lista EXACTA de `20260928100400:161`, sin `id`.
grant update (
  razon_social, cif, domicilio, codigo_postal, poblacion, inscripcion,
  apoderada_nombre, apoderada_cargo, apoderada_dni, firma_ruta, sello_ruta,
  email_equipo, caducidad_enlace_dias, caducidad_confirmacion_dias,
  tolerancia_conciliacion_pct, plazo_conciliar_sin_confirmacion_dias,
  fecha_corte_convenios, cierre_apertura, cierre_provisional, datos_provisionales,
  actualizado_at, actualizado_por
) on parametros_documentales to authenticated;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
-- El privilegio de TABLA tiene que haber desaparecido (antes: t):
--   select has_table_privilege('authenticated', 'public.parametros_documentales', 'UPDATE');
--   -- esperado: f
--
-- Y el de columna seguir ahí, con `id` fuera:
--   select has_column_privilege('authenticated', 'public.parametros_documentales',
--                               'caducidad_enlace_dias', 'UPDATE') as inocua,
--          has_column_privilege('authenticated', 'public.parametros_documentales',
--                               'apoderada_dni', 'UPDATE') as dni,
--          has_column_privilege('authenticated', 'public.parametros_documentales',
--                               'id', 'UPDATE') as id_fora;
--   -- esperado: t, t, f
--
-- Que las 22 columnas concedidas son las que se querían, y ninguna más:
--   select string_agg(column_name, ', ' order by column_name)
--     from information_schema.column_privileges
--    where grantee = 'authenticated' and table_name = 'parametros_documentales'
--      and privilege_type = 'UPDATE';
