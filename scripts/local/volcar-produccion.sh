#!/bin/bash
# Volcado de PRODUCCIÓN para el clon local (07-10-2026). SOLO LEE de producción.
#
# Se ejecuta dentro de la sesión temporal del token (AGENTS.md §11):
#   bash scripts/sesion-supabase-temporal.sh
#   bash scripts/local/volcar-produccion.sh
#
# Deja en supabase/.local-dump/ (ignorado por git, permisos 700):
#   esquema-public.sql     el esquema de `public`, para compararlo con el que construyen
#                          las migraciones en local
#   datos-public.sql       los datos de `public`, SIN `app_config` (son los secretos de
#                          producción: con ellos, los jobs locales llamarían a producción)
#   datos-auth.sql         las cuentas: `auth.users` e `auth.identities` (con el hash de la
#                          contraseña, así que en local se entra con la misma). Sin sesiones,
#                          tokens ni registros de auditoría
#   recompte-produccion.json  filas por tabla, buckets, extensiones, jobs y políticas
#
# ⚠️ Esos ficheros llevan datos personales de prueba y hashes de contraseñas: no se suben a
#    git ni se copian a la carpeta de consultoría.
#
# Si el CLI pide la contraseña de la base de datos: Supabase → Project Settings → Database.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/comu.sh"

[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || morir "Falta el token: abre antes bash scripts/sesion-supabase-temporal.sh"
ref="$(cat "$REPO/supabase/.temp/project-ref" 2>/dev/null || true)"
[ "$ref" = "$REF_PRODUCCION" ] || morir "El repo no está enlazado a $REF_PRODUCCION (enlazado: ${ref:-ninguno})."
docker info >/dev/null 2>&1 || morir "Docker no responde: el CLI lo necesita para ejecutar pg_dump."

mkdir -p "$DIR_VOLCADO"
chmod 700 "$DIR_VOLCADO"
cd "$REPO"

echo "1/4 Esquema de public…"
supabase db dump --linked --schema public -f "$DIR_VOLCADO/esquema-public.sql"

echo "2/4 Datos de public (sin app_config)…"
supabase db dump --linked --data-only --use-copy --schema public \
  -x public.app_config \
  -f "$DIR_VOLCADO/datos-public.sql"

echo "3/4 Cuentas (auth.users e auth.identities)…"
excluir_auth="auth.audit_log_entries,auth.custom_oauth_providers,auth.flow_state,auth.instances"
excluir_auth+=",auth.mfa_amr_claims,auth.mfa_challenges,auth.mfa_factors,auth.mfa_recovery_code_sets"
excluir_auth+=",auth.mfa_recovery_codes,auth.oauth_authorizations,auth.oauth_client_states"
excluir_auth+=",auth.oauth_clients,auth.oauth_consents,auth.one_time_tokens,auth.refresh_tokens"
excluir_auth+=",auth.saml_providers,auth.saml_relay_states,auth.scim_tokens,auth.scim_users"
excluir_auth+=",auth.sessions,auth.sso_domains,auth.sso_providers,auth.webauthn_challenges"
excluir_auth+=",auth.webauthn_credentials"
supabase db dump --linked --data-only --use-copy --schema auth \
  -x "$excluir_auth" \
  -f "$DIR_VOLCADO/datos-auth.sql"

echo "4/4 Recuento de producción…"
deno run -A "$REPO/scripts/local/recompte.ts" produccio

chmod 600 "$DIR_VOLCADO"/*
echo
echo "Hecho. Ficheros en supabase/.local-dump/:"
ls -lh "$DIR_VOLCADO"
