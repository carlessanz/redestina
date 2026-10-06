#!/bin/bash
# Sesión temporal de Supabase para Redestina (06-10-2026).
#
# Pide el token personal «Redestina - Admin - Producción» con entrada oculta y abre una
# terminal hija con SUPABASE_ACCESS_TOKEN exportado SOLO en ella. No despliega nada:
# los comandos de cada publicación los prepara el asistente y se ejecutan a mano aquí.
# El token no se escribe en ningún fichero, ni en el historial, ni en git. `exit` lo descarta.
#
# Uso:  bash scripts/sesion-supabase-temporal.sh
# Detalle: AGENTS.md §11 («Despliegues con token temporal»).
set +x
set -eu

[ "$#" -eq 0 ] || { echo 'Este script no admite argumentos.'; exit 2; }
nombre='Redestina - Admin - Producción'
ref_esperado='uxppvaldhptdomvdhsmn'
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
[ -t 0 ] || { echo 'Ejecuta el script en una terminal interactiva.'; exit 1; }
command -v supabase >/dev/null || { echo 'Falta Supabase CLI.'; exit 1; }

if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo 'Ya hay un SUPABASE_ACCESS_TOKEN en esta terminal. Ciérrala con exit antes de abrir otra sesión.'
  exit 1
fi

ref_enlazado="$(cat "$repo/supabase/.temp/project-ref" 2>/dev/null || true)"
if [ "$ref_enlazado" != "$ref_esperado" ]; then
  echo "Aviso: el repo no está enlazado a $ref_esperado (enlazado: ${ref_enlazado:-ninguno})."
  echo "Dentro de la sesión, ejecuta primero: supabase link --project-ref $ref_esperado"
fi

unset SUPABASE_ACCESS_TOKEN
printf 'Pega el token «%s» (entrada oculta) y pulsa Intro: ' "$nombre"
IFS= read -r -s SUPABASE_ACCESS_TOKEN || {
  printf '\nEntrada cancelada.\n'; exit 1;
}
printf '\n'

case "$SUPABASE_ACCESS_TOKEN" in
  sbp_*) ;;
  *) unset SUPABASE_ACCESS_TOKEN
     echo 'Pega solo el token completo que empieza por sbp_.'; exit 1 ;;
esac
case "$SUPABASE_ACCESS_TOKEN" in
  *[!a-zA-Z0-9_-]*) unset SUPABASE_ACCESS_TOKEN
    echo 'Entrada inválida: contiene espacios, comillas u otros caracteres.'
    exit 1 ;;
esac

unset BASH_ENV ENV PROMPT_COMMAND
export SUPABASE_ACCESS_TOKEN
export HISTFILE=/dev/null HISTSIZE=0 HISTFILESIZE=0
export BASH_SILENCE_DEPRECATION_WARNING=1
export PS1="[Token temporal · Redestina] \\w $ "
cd "$repo"
printf 'Sesión preparada para Redestina (%s). No se ha desplegado nada.\n' "$ref_esperado"
printf 'Ejecuta aquí los comandos revisados y escribe exit al terminar.\n'
exec /bin/bash --noprofile --norc -i
