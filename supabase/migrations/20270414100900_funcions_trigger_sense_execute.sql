-- Las funciones de TRIGGER dejan de ser ejecutables por `anon` y `authenticated`.
--
-- QUÉ PASABA (clon local, 07-10-2026): las 32 funciones `returns trigger` de `public` —29 de
-- ellas `security definer`— tenían EXECUTE para PUBLIC, `anon` y `authenticated`. Es el
-- `alter default privileges … on functions` de Supabase, que lo concede a toda función nueva,
-- más el EXECUTE a PUBLIC que Postgres pone por defecto; ninguna migración lo revocó porque
-- «una función de trigger no se puede llamar».
--
-- Y es casi cierto: PostgREST no expone una función que devuelve `trigger`, y llamarla fuera
-- de un trigger falla («trigger functions can only be called as triggers»). Así que esto NO
-- cierra un agujero alcanzable; repone la capa que falta, igual que el `revoke` de TRUNCATE
-- (`20270309100000`) y el de las escrituras por tabla (`20270322100100`). Lo que compra:
--   · que el ACL diga la verdad (nadie con sesión necesita ejecutar esto), y
--   · que la auditoría del arnés (`auditoria_funcions_obertes()`, `20270414101000`) pueda
--     exigir «ninguna función de trigger ejecutable por un rol de la API» sin una lista de
--     excepciones de 32 entradas.
--
-- ⚠️ ¿SIGUEN DISPARANDO? Sí: Postgres comprueba EXECUTE sobre la función de trigger al
--    CREAR el trigger (`create trigger`), no al dispararlo. Lo comprueba la prueba de
--    verificación de abajo: como `authenticated` (equipo) un `update` sobre `app_settings`
--    sigue moviendo `updated_at` (`set_updated_at`) y uno sobre `excedentes` sigue pasando
--    por `trg_excedentes_modalitats`; y como `supabase_auth_admin` —que perdía el EXECUTE
--    heredado de PUBLIC— el alta en `auth.users` sigue creando el perfil
--    (`crear_perfil_nuevo_usuario`).
--
-- ⚠️ `service_role` se conserva: no lo necesita, pero quitarlo no añade nada y es el rol con
--    el que trabajan las Edge Functions; el criterio del repo es no tocar lo que no estorba.
--
-- ⚠️ Una función de trigger NUEVA volverá a nacer con EXECUTE para `anon`/`authenticated`
--    (no se cambian los `default privileges` globales). La auditoría del arnés lo marcará
--    en rojo: la costumbre es añadir este mismo `revoke` en la migración que la crea.

revoke execute on function public.crear_perfil_nuevo_usuario() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.trg_albaranes_inmutable() from public, anon, authenticated;
revoke execute on function public.trg_albaranes_no_esborrar() from public, anon, authenticated;
revoke execute on function public.trg_avisos_encola_envio() from public, anon, authenticated;
revoke execute on function public.trg_canalizaciones_crea_albaranes() from public, anon, authenticated;
revoke execute on function public.trg_canalizaciones_estat_espigolada() from public, anon, authenticated;
revoke execute on function public.trg_canalizaciones_valoriza() from public, anon, authenticated;
revoke execute on function public.trg_cierres_donante_tipo() from public, anon, authenticated;
revoke execute on function public.trg_convenios_control() from public, anon, authenticated;
revoke execute on function public.trg_convenios_no_esborrar() from public, anon, authenticated;
revoke execute on function public.trg_convenios_organitzacio() from public, anon, authenticated;
revoke execute on function public.trg_costes_producto_hist() from public, anon, authenticated;
revoke execute on function public.trg_documentos_encola_generacion() from public, anon, authenticated;
revoke execute on function public.trg_documentos_inmutable() from public, anon, authenticated;
revoke execute on function public.trg_documentos_no_esborrar() from public, anon, authenticated;
revoke execute on function public.trg_documentos_objeto_existe() from public, anon, authenticated;
revoke execute on function public.trg_excedentes_avis_validacio() from public, anon, authenticated;
revoke execute on function public.trg_excedentes_modalitats() from public, anon, authenticated;
revoke execute on function public.trg_excedentes_ubica() from public, anon, authenticated;
revoke execute on function public.trg_excedentes_validacio() from public, anon, authenticated;
revoke execute on function public.trg_ficha_estrena_organizacion() from public, anon, authenticated;
revoke execute on function public.trg_fitxa_municipi() from public, anon, authenticated;
revoke execute on function public.trg_membresias_control_aprovacio() from public, anon, authenticated;
revoke execute on function public.trg_planes_control() from public, anon, authenticated;
revoke execute on function public.trg_planes_no_esborrar() from public, anon, authenticated;
revoke execute on function public.trg_plantillas_inmutables() from public, anon, authenticated;
revoke execute on function public.trg_plantillas_no_esborrar() from public, anon, authenticated;
revoke execute on function public.trg_questionaris_inmutables() from public, anon, authenticated;
revoke execute on function public.trg_questionaris_no_esborrar() from public, anon, authenticated;
revoke execute on function public.trg_respostes_avis() from public, anon, authenticated;
revoke execute on function public.trg_respuestas_control_aprovacio() from public, anon, authenticated;

-- Verificación:
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
--      and (has_function_privilege('anon', p.oid, 'EXECUTE')
--           or has_function_privilege('authenticated', p.oid, 'EXECUTE'));   -- 0
