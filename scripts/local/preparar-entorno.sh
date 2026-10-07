#!/bin/bash
# Genera los dos ficheros de entorno del clon local a partir de `supabase status`
# (07-10-2026). Los dos están ignorados por git (regla `.env*`).
#
#   supabase/.env.funciones-local   lo lee `supabase functions serve` (funciones-local.sh)
#   .env.supabase-local.local       lo lee `npm run dev:local` (vite --mode supabase-local);
#                                   en Vite manda sobre `.env.local`, que sigue siendo producción
#
# Los dos secretos compartidos con la base (DOCUMENTOS_SECRET, RECORDATORIOS_SECRET) se
# generan la primera vez y se CONSERVAN después: cargar-local.sh escribe los mismos en
# `app_config`, y si cambiaran por separado los jobs locales dejarían de autenticarse.
# Nunca son los de producción.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/comu.sh"
cargar_estado_local

valor_actual() { [ -f "$ENV_FUNCIONES" ] && grep -E "^$1=" "$ENV_FUNCIONES" | head -1 | cut -d= -f2- || true; }
DOCS="$(valor_actual DOCUMENTOS_SECRET)"; [ -n "$DOCS" ] || DOCS="$(openssl rand -hex 32)"
RECS="$(valor_actual RECORDATORIOS_SECRET)"; [ -n "$RECS" ] || RECS="$(openssl rand -hex 32)"

umask 077
cat > "$ENV_FUNCIONES" <<EOF
# Entorno de las Edge Functions del CLON LOCAL. Generado por scripts/local/preparar-entorno.sh.
# Nunca lleva claves de producción, ni de Resend ni de Meta.
SB_SECRET_KEY=$SECRET_KEY
DOCUMENTOS_SECRET=$DOCS
RECORDATORIOS_SECRET=$RECS
APP_URL=http://localhost:5173
ALLOWED_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
# Las URLs firmadas de Storage salen con http://kong:8000 (red interna de Docker);
# esto las reescribe para que el navegador las abra (_shared/url-publica.ts).
URL_PUBLICA_STORAGE=$API_URL
# Correo y WhatsApp SIMULADOS: solo "true" exacto enviaría, y sin claves no podría.
RESEND_ENVIO_REAL=false
WHATSAPP_ENVIO_REAL=false
EOF

cat > "$ENV_FRONTEND" <<EOF
# Frontend contra el CLON LOCAL (npm run dev:local). Generado por scripts/local/preparar-entorno.sh.
VITE_SUPABASE_URL=$API_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY
VITE_ACCESSOS_TEST=true
EOF

echo "Escritos:"
echo "  supabase/.env.funciones-local"
echo "  .env.supabase-local.local"
