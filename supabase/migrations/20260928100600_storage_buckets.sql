-- Los dos buckets del sistema documental. Privados y sin una sola política.
--
-- LA REGLA (§A del plan): **nadie toca Storage directo**. No hay ninguna política en
-- `storage.objects` para `authenticated`, así que la publishable key no puede leer,
-- escribir ni listar nada de estos buckets: PostgREST/Storage responden 400/403 antes de
-- llegar a ningún fichero. El único que entra es `service_role`.
--
-- Cómo se lee un documento, entonces: la Edge Function `descargar-documento` (con JWT)
-- pregunta a `puede_ver_documento()` (20260928100800) y, si la respuesta es sí, firma
-- una URL de 60 segundos. **La carpeta ordena; la tabla autoriza** (§B.3): la ruta
-- agrupa por organización para que un humano y un backup se entiendan, pero quien
-- decide quién ve qué es siempre la fila de `documentos`, nunca el prefijo del nombre.
--
-- Por eso mismo un fichero se guarda UNA sola vez, bajo su organización propietaria: la
-- otra parte de un documento a dos bandas (el receptor de un ENT, el comprador de un
-- OPE) lo ve por `documents_meus()`, no por tener copia en su carpeta.

-- ---------------------------------------------------------------------------
-- `documentos`: todo lo que Redestina genera o le suben
-- ---------------------------------------------------------------------------
-- 20 MB: un convenio de 10 páginas con dos PNG de firma no pasa de 1 MB; el techo es
-- para los `externs/` (el albarán en papel escaneado del productor, una factura).
-- Los MIME son los tres que el circuito acepta: el PDF que generamos y las fotos o
-- escaneos que aportan las organizaciones.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 20971520,
        array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- `activos`: la firma y el sello de la apoderada de Espigoladors
-- ---------------------------------------------------------------------------
-- Bucket APARTE y no la carpeta de la función: una firma escaneada no puede viajar en
-- el bundle de una Edge Function (queda en el repositorio y en cada despliegue). Aquí la
-- lee `generar-documento` con `service_role` en el momento de estampar, y solo ahí.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('activos', 'activos', false, 5242880,
        array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Sin `create policy … on storage.objects` a propósito. Si algún día hace falta que el
-- navegador suba un fichero, la vía es una Edge Function que valide y suba con
-- service_role (`subir-documento-externo`, fase 3), no una política aquí.

-- Verificación:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets
--    where id in ('documentos','activos');
--   select count(*) from pg_policies where schemaname='storage' and tablename='objects';
--   curl -H "apikey: <publishable>" "$URL/storage/v1/object/documentos/qualsevol" -> 400/403
