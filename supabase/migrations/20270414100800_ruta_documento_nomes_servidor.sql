-- `ruta_documento()` vuelve a ser solo de `service_role`, que es lo que dice AGENTS.md §4bis.
--
-- QUÉ PASABA. La función nació solo para `service_role` (`20260928100800:497-502`), pero
-- `20270111100100:1403` la metió en la lista «consultas y puentes» de su bloque de GRANT y le
-- devolvió EXECUTE a `authenticated`. Medido en el clon local el 07-10-2026: una RECEPTORA
-- llamaba `ruta_documento('prova', null, 'PROVA', 'PROVA-2026-0001', 1, 'prueba', 2026)` y
-- recibía la ruta. Con un `objeto_id` real, la ruta compuesta incluye el uuid de la
-- organización PROPIETARIA del objeto (`productors/<productor_id>/…`): es un oráculo que, con
-- el uuid de un albarán o un convenio ajeno, dice de qué organización es. No da acceso al
-- fichero —los buckets no tienen ninguna política, §4—, pero cruza identidades que la RLS
-- separa.
--
-- QUIÉN LA LLAMA (07-10-2026):
--   · Las funciones que emiten documentos —`emitir_documento_prova()`,
--     `convenio_emet_document()`, `albaran_emet_document()`, `cierre_emet_document()`,
--     `plan_emet_document()`, `periodo_emet_document()`, `recepcio_emet_document()`— y
--     `ruta_documento_externo()`: TODAS `security definer`, así que la ejecutan como
--     propietario y el `revoke` no les afecta. Ninguna función `security invoker` la llama.
--   · La Edge Function `enlace-publico` (`convenio.ts:315`, la carpeta del trazo de la
--     firma), con la clave secreta → `service_role`.
--   · Ninguna política RLS, vista, default de columna ni CHECK (consultado en el catálogo).
--   · El navegador: cero llamadas.

revoke execute on function public.ruta_documento(text, uuid, text, text, int, text, int)
  from public, anon, authenticated;
grant execute on function public.ruta_documento(text, uuid, text, text, int, text, int)
  to service_role;

-- Verificación: con sesión de cualquier cuenta, `rpc/ruta_documento` → 42501; emitir un
-- documento de prueba desde el panel del super_admin (`emitir_documento_prova()`) sigue
-- componiendo su `ruta`.
