-- 🔴 Dos funciones de JOB se podían ejecutar SIN SESIÓN (rol `anon`) y con cualquier sesión.
--
-- QUÉ PASABA (clon local, 07-10-2026). ACL de las dos:
--   {=X/postgres, postgres, anon, authenticated, service_role}
-- o sea EXECUTE para PUBLIC, `anon` y `authenticated`. Medido con `set local role anon` en
-- una transacción de solo lectura: las dos pasaron la comprobación de privilegios y solo las
-- paró el `read only` (25006 al intentar el INSERT de `net.http_post` / el UPDATE). Con la
-- publishable key, cualquiera podía:
--
--   · `rpc/disparar_recordatorios_intake` → despertar la Edge Function de recordatorios de
--     intake con el secreto de `app_config` (la llamada la hace la base, no quien pide), tantas
--     veces como quisiera: WhatsApp a productores con un intake a medias.
--   · `rpc/marcar_excedentes_vencidos` → cancelar/no_colocar las ofertas vencidas antes de
--     que toque. Hace lo mismo que el job diario, pero a voluntad de un tercero.
--
-- Por qué estas dos y no las demás `disparar_*`: el resto nació con
-- `revoke execute … from public, anon, authenticated` (ACL `{postgres, service_role}`); estas
-- dos son de `20260722130000` y `20260722100000`, anteriores a esa costumbre, y las
-- recreaciones posteriores (`20270317100000`, `20270413100000`, `20270409100000`) usaron
-- `create or replace`, que conserva el ACL viejo. La causa de fondo es el
-- `alter default privileges … on functions` de Supabase, que concede EXECUTE a `anon` y
-- `authenticated` a toda función nueva salvo `revoke` explícito.
--
-- QUIÉN LAS LLAMA: solo `pg_cron` (`recordatorios-intake` cada 2 min y `marcar-vencidas` a
-- diario), y los jobs corren como `postgres` (`cron.job.username`), el propietario. Ni el
-- frontend, ni los scripts, ni las Edge Functions las llaman (grep, 07-10-2026).
--
-- Y de paso, `search_path`: las dos tenían `set search_path = public`, sin `pg_temp` al
-- final. En una `security definer` eso deja `pg_temp` implícitamente DELANTE de `public`, y
-- un objeto temporal con el nombre de una tabla podría suplantarla. Se fija el idioma del
-- repo (§4bis): `public, pg_temp`.

revoke execute on function public.disparar_recordatorios_intake() from public, anon, authenticated;
revoke execute on function public.marcar_excedentes_vencidos()     from public, anon, authenticated;
grant execute on function public.disparar_recordatorios_intake() to service_role;
grant execute on function public.marcar_excedentes_vencidos()     to service_role;

alter function public.disparar_recordatorios_intake() set search_path = public, pg_temp;
alter function public.marcar_excedentes_vencidos()     set search_path = public, pg_temp;

-- Verificación: `select cron.schedule` no se toca; el job sigue llamando como `postgres`.
--   set local role anon;          select disparar_recordatorios_intake();  -- 42501
--   set local role authenticated; select marcar_excedentes_vencidos();     -- 42501
--   como postgres (lo que hace pg_cron): las dos funcionan.
