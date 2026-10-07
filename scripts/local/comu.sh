#!/bin/bash
# Piezas comunes de los scripts del clon local (AGENTS.md §11, «El clon local»).
# Se carga con `source`; no se ejecuta solo.

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
DIR_VOLCADO="$REPO/supabase/.local-dump"
ENV_FUNCIONES="$REPO/supabase/.env.funciones-local"
ENV_FRONTEND="$REPO/.env.supabase-local.local"
CONTENEDOR_DB="supabase_db_Redestina"
REF_PRODUCCION="uxppvaldhptdomvdhsmn"

morir() { echo "⛔ $*" >&2; exit 1; }

# Carga las variables del stack local (API_URL, PUBLISHABLE_KEY, SECRET_KEY, DB_URL…) y
# se niega a seguir si no apuntan a esta máquina. Es la barrera que impide que un script
# local escriba en producción por un `source .env.local` olvidado.
cargar_estado_local() {
  local salida
  salida="$(cd "$REPO" && supabase status -o env 2>/dev/null)" \
    || morir "El Supabase local no responde. Arráncalo con la skill supabase-local."
  eval "$(printf '%s\n' "$salida" | grep -E '^(API_URL|DB_URL|PUBLISHABLE_KEY|SECRET_KEY)=')"
  exigir_local "$API_URL"
  [ -n "${SECRET_KEY:-}" ] && [ -n "${PUBLISHABLE_KEY:-}" ] || morir "supabase status no devuelve las claves."
}

exigir_local() {
  case "$1" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) morir "La URL no es local ($1). Los scripts de scripts/local/ nunca tocan producción." ;;
  esac
  case "$1" in *supabase.co*) morir "URL de producción detectada: $1" ;; esac
}

exigir_contenedor_db() {
  docker inspect "$CONTENEDOR_DB" >/dev/null 2>&1 \
    || morir "No existe el contenedor $CONTENEDOR_DB. Arranca el Supabase local."
}

# psql dentro del contenedor de la base local: no hace falta tener psql instalado.
psql_local() {
  docker exec -i "$CONTENEDOR_DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}
