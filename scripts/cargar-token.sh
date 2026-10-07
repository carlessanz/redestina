# Carga el token «Redestina - Admin - Producción» en ESTA shell (bash o zsh), sin sub-shell.
# Se usa con `source`. No imprime el token. Al acabar: `unset SUPABASE_ACCESS_TOKEN`.
__msg='Pega el token «Redestina - Admin - Producción» (entrada oculta) y pulsa Intro: '
if [ -n "${ZSH_VERSION:-}" ]; then
  read -rs "__tok?$__msg"
else
  read -rs -p "$__msg" __tok
fi
echo
case "$__tok" in
  sbp_*[!a-zA-Z0-9_-]*|'') echo "Entrada inválida: no se ha cambiado nada."; unset __tok __msg; return 1 2>/dev/null || exit 1 ;;
  sbp_*) export SUPABASE_ACCESS_TOKEN="$__tok"; echo "Token cargado en esta pestaña (Redestina). No se ha desplegado nada." ;;
  *) echo "Pega solo el token completo que empieza por sbp_. No se ha cambiado nada." ;;
esac
unset __tok __msg
