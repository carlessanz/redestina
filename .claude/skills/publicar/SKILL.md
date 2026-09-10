---
name: publicar
description: Publica Redestina en producción — verifica, commitea, pushea, redespliega las Edge Functions que lo necesiten y comprueba que el dominio, el CORS y los permisos responden. Úsalo cuando el usuario pida publicar, desplegar o subir a producción.
---

# Publicar Redestina

Publica el estado actual del repo en producción y **verifica que ha quedado publicado**.
Publicar no es «hacer push»: es dejar comprobado que el dominio sirve el commit correcto, que
las nueve Edge Functions corren el código de `main` con sus flags de JWT, y que los permisos
siguen sanos.

Sigue los pasos en orden. **Cada paso se verifica, no se supone.** Si un paso falla, para y
cuenta qué falló; no sigas al siguiente.

Datos fijos del proyecto:

- Repo: `carlessanz/Redestina`, rama **`main`** (nunca crear ramas por tarea).
- Supabase ref: `uxppvaldhptdomvdhsmn` → funciones en `https://uxppvaldhptdomvdhsmn.supabase.co/functions/v1`
- Vercel: proyecto `prj_QtgrhEd6PvFeUxxaWgpulsRFuIlk`, equipo `team_cmB3eEiEdrGSZtrNOApRmP0u`
- Dominio de producción: `https://redestina.carlessanz.com`

---

## 1. Comprobaciones previas

```bash
git branch --show-current          # debe ser main
git status --short                 # ver qué hay sin commitear
git fetch origin && git status -sb # ¿ahead/behind?
npm run build                      # tsc strict + vite; debe acabar en verde
```

Si `npm run build` falla, **para aquí**: no se publica nada que no compile.

Si el árbol ya está limpio y `main` sincronizada, no hay nada que commitear ni pushear —
dilo y salta al paso 4. Es un resultado normal, no un error: otra sesión pudo publicar antes.

## 2. Commit

Solo si hay cambios. Antes de commitear, comprueba la regla permanente del proyecto:
**si el cambio toca arquitectura, datos, contratos de funciones, rutas, convenciones, comandos
o deuda técnica, `AGENTS.md` tiene que quedar al día en el mismo commit** (`CLAUDE.md` lo importa).

Mensaje en **castellano**, describiendo el *qué* y el *por qué*, y terminando con la línea de
atribución que indique el sistema en esta sesión.

Antes de `git add`, revisa que no entre nada prohibido: `docs/`, `scripts/data/`, `.env*` y
`.claude/settings.local.json` están en `.gitignore` — si aparecen en `git status`, algo va mal.

## 3. Push

```bash
git push origin main
```

El push a `main` **dispara solo el deploy de Vercel**. No hay que ejecutar `vercel --prod`.

## 4. Verificar el deploy de Vercel

Comprueba que el último deployment de producción corresponde al commit local, con las
herramientas de Vercel (`list_deployments` / `get_project` sobre el projectId y teamId de arriba):

- `state` debe ser `READY` y `target` `production`.
- `meta.githubCommitSha` debe empezar por el SHA de `git rev-parse HEAD`.

Si está en `BUILDING`, espera y vuelve a consultar. Si está en `ERROR`, pide los build logs
(`get_deployment_build_logs` con `errorsOnly`) y cuenta qué falló.

Después, que el dominio sirva de verdad y el rewrite de SPA funcione:

```bash
for r in / /login /admin /registre /panell; do
  printf "%-12s → %s\n" "$r" "$(curl -sS -o /dev/null -w '%{http_code}' "https://redestina.carlessanz.com$r")"
done   # los cinco deben dar 200; un 404 en una ruta profunda = falta el rewrite de vercel.json
```

## 5. Redesplegar las Edge Functions que lo necesiten

⚠️ **`updated_at` de `supabase functions list` NO dice si el código está al día.** Puede ser
viejo y el bundle estar al día (se despliega, se verifica en producción y se commitea después,
así que el commit queda con fecha posterior al despliegue). La única fuente fiable es intentar
el despliegue y leer la salida: **`No change found in Function: X`** significa que ya estaba al día.

Despliega **una por una y con su flag**, porque no todas llevan el mismo:

```bash
supabase functions deploy whatsapp-send                          # verify_jwt lo fija config.toml
supabase functions deploy whatsapp-webhook --no-verify-jwt       # Meta no manda JWT
supabase functions deploy priorizar-entidades                    # con verify_jwt
supabase functions deploy intake-recordatorios --no-verify-jwt   # lo llama pg_cron
supabase functions deploy enviar-email                           # con verify_jwt
supabase functions deploy recuperar-password --no-verify-jwt     # público
supabase functions deploy crear-oferta                           # con verify_jwt
supabase functions deploy registro --no-verify-jwt               # registro público
supabase functions deploy enviar-acceso                          # con verify_jwt
```

Es idempotente: las que no hayan cambiado dirán `No change found` y no se tocan.

**Redespliega SIEMPRE, aunque no haya cambios de código, si se ha cambiado algún secreto**
(`ALLOWED_ORIGIN`, `APP_URL`, `RESEND_FROM`, `WHATSAPP_*`): son `const` de módulo evaluados al
cargar el isolate, y un isolate caliente no ve el secreto nuevo.

⛔ **Nunca `supabase config push`**: arrastra `enable_signup = false` y desactiva el login por
email en remoto, dejando al equipo fuera. Los flags de Auth se tocan por Management API.

Luego comprueba que las nueve quedaron `ACTIVE` y con el `verify_jwt` que toca:

```bash
supabase functions list
```

Esperado: `true` en `whatsapp-send`*, `priorizar-entidades`, `enviar-email`, `crear-oferta` y
`enviar-acceso`; `false` en `whatsapp-webhook`, `intake-recordatorios`, `recuperar-password` y
`registro`.

\* **Discrepancia conocida**: `config.toml` declara `verify_jwt = false` para `whatsapp-send`
mientras `AGENTS.md` §9 y §11 dicen que va con JWT. Hoy queda en `false`. No rompe nada —la
función comprueba la sesión por su cuenta con `exigirEquipo()` y devuelve `401 unauthorized`—,
pero si sigue sin resolverse, señálalo en el informe en vez de cambiarlo por tu cuenta.

## 6. Verificación funcional

**CORS.** Léelo en la cabecera, **nunca en el código de estado**: cuando el origen no está
permitido la función responde igualmente 204, pero devuelve *el primer origen de la lista* en vez
del pedido, y es el navegador quien bloquea.

```bash
SB=https://uxppvaldhptdomvdhsmn.supabase.co/functions/v1
O=https://redestina.carlessanz.com
for f in whatsapp-send priorizar-entidades enviar-email recuperar-password crear-oferta enviar-acceso registro; do
  A=$(curl -sS -o /dev/null -D - -X OPTIONS "$SB/$f" -H "Origin: $O" \
      -H "Access-Control-Request-Method: POST" \
      -H "Access-Control-Request-Headers: authorization,content-type" \
      | grep -i '^access-control-allow-origin' | tr -d '\r' | sed 's/.*: //')
  printf "  %-22s %s\n" "$f" "${A:-— NINGUNA}"
done
```

Las siete deben devolver **exactamente** `https://redestina.carlessanz.com`. Cualquier otra cosa
—incluido `http://localhost:5173`— significa que esa función no ve el `ALLOWED_ORIGIN` bueno:
vuelve al paso 5 y redespliégala.

Contraprueba con un origen que no debe pasar (`-H "Origin: https://evil.example.com"`): tiene que
devolver algo distinto de ese origen.

**Endpoints públicos**, que son los únicos alcanzables sin sesión:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$SB/registro" -H 'Content-Type: application/json' -d '{}'          # 400 (validación)
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$SB/recuperar-password" -H 'Content-Type: application/json' -d '{"email":"noexiste@example.com"}'  # 200 genérico
curl -sS -o /dev/null -w '%{http_code}\n' "$SB/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1"  # 403
```

## 7. Permisos (si el cambio tocó datos, políticas o roles)

```bash
set -a; . ./.env.local; set +a
export SUPABASE_URL="${SUPABASE_URL:-$VITE_SUPABASE_URL}"   # el script pide SUPABASE_URL, .env.local trae VITE_SUPABASE_URL
deno run -A scripts/comprobar-rls.ts
```

Referencia: **56/57**. El único rojo aceptable es `receptor-comercial · excedentes · leer`
(no hay ninguna oferta de `venda` publicada, así que ver 0 filas es correcto). **Cualquier otro
rojo es una regresión**: no des la publicación por buena.

Si algo se torció con los permisos: `deno run -A scripts/roles-activos.ts off` (10 segundos), y
si no basta, `scripts/sql/rls-emergencia.sql`.

## 8. Informe

Una línea por paso, con OK o FALLO y el detalle de lo que hiciste. Incluye siempre:

- el SHA publicado y si hubo commit o el árbol ya estaba limpio;
- qué funciones se redesplegaron de verdad y cuáles dijeron `No change found`;
- el resultado del arnés (`56/57`) si lo ejecutaste;
- los interruptores de producción que siguen pendientes, para que no se olviden:
  **`VITE_ACCESSOS_TEST`** (si está en `true`, las contraseñas de las cuentas de prueba viajan en
  el bundle y cualquiera que abra `/login` entra como ellas; es **variable de build**, así que
  cambiarla en Vercel **exige redesplegar**), el **modo test** (`app_settings.test_mode`) y las
  whitelists `meta_test_recipients` / `email_test_recipients`.

## Notas de esta máquina

- `timeout` no existe (macOS/zsh): no lo uses para acotar comandos.
- El arnés y los scripts de Deno leen las claves de `.env.local`, que está fuera de git.
- El CLI de Vercel está autenticado como `upsocial`, que es **DEVELOPER**: puede desplegar y leer,
  pero no cambiar ajustes del proyecto (un `PATCH /v9/projects/{id}` responde 403). Para eso hace
  falta la cuenta `carlessanz`, que es OWNER.
