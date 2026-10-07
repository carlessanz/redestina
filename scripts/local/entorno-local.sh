#!/bin/bash
# Imprime los `export` para ejecutar los scripts del repo contra el CLON LOCAL (07-10-2026).
#
#   eval "$(bash scripts/local/entorno-local.sh)"
#   deno run -A scripts/comprobar-rls.ts
#
# Sustituye, para el clon, al `source .env.local` + `.secrets.env` de siempre, que apunta
# a PRODUCCIÓN. Si el stack local no responde, no imprime nada útil y el `eval` no cambia
# ninguna variable: no hay forma de acabar apuntando a producción por un fallo aquí.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/comu.sh"
cargar_estado_local
cat <<EOF
export SUPABASE_URL='$API_URL'
export VITE_SUPABASE_URL='$API_URL'
export SB_SECRET_KEY='$SECRET_KEY'
export SUPABASE_PUBLISHABLE_KEY='$PUBLISHABLE_KEY'
export VITE_SUPABASE_PUBLISHABLE_KEY='$PUBLISHABLE_KEY'
echo 'Entorno apuntando al Supabase LOCAL ($API_URL).' >&2
EOF
