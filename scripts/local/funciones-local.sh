#!/bin/bash
# Sirve las Edge Functions del repo contra el Supabase LOCAL (07-10-2026).
#
#   bash scripts/local/funciones-local.sh
#
# Usa supabase/.env.funciones-local (preparar-entorno.sh): clave secreta local, secretos
# locales y correo/WhatsApp simulados. Se queda en primer plano mostrando los registros;
# Ctrl+C lo para (el resto del stack sigue en marcha).
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/comu.sh"
cargar_estado_local
[ -f "$ENV_FUNCIONES" ] || morir "Falta supabase/.env.funciones-local: ejecuta antes preparar-entorno.sh."
grep -qE '^(RESEND|WHATSAPP)_ENVIO_REAL=true' "$ENV_FUNCIONES" \
  && morir "supabase/.env.funciones-local activa envíos reales: el clon local no envía nada."
cd "$REPO"
exec supabase functions serve --env-file "$ENV_FUNCIONES"
