---
name: publicar
description: Publica Redestina en producción y verifica que ha quedado publicado — migraciones, Edge Functions y frontend en ese orden (de abajo arriba), más CORS y permisos. Úsalo cuando el usuario pida publicar, desplegar o subir a producción.
---

# Publicar Redestina

Publica el estado actual del repo en producción y **verifica que ha quedado publicado**.
Publicar no es «hacer push»: es dejar comprobado que la base tiene su esquema, que las Edge
Functions corren el código de `main` con sus flags de JWT, que el dominio sirve el commit
correcto y que los permisos siguen sanos.

Sigue los pasos en orden. **Cada paso se verifica, no se supone.** Si un paso falla, para y
cuenta qué falló; no sigas al siguiente.

Datos fijos del proyecto:

- Repo: `carlessanz/Redestina`, rama **`main`** (nunca crear ramas por tarea).
- Supabase ref: `uxppvaldhptdomvdhsmn` → funciones en `https://uxppvaldhptdomvdhsmn.supabase.co/functions/v1`
- Vercel: proyecto `prj_QtgrhEd6PvFeUxxaWgpulsRFuIlk`, equipo `team_cmB3eEiEdrGSZtrNOApRmP0u`
- Dominio de producción: `https://redestina.carlessanz.com`

---

## ⚠️ El orden: base de datos → funciones → frontend

**Se publica de abajo arriba, y no es una preferencia de estilo: es la única secuencia sin
ventana rota.** Cada capa solo puede depender de otra que ya esté publicada.

| Orden | Capa | Qué pasaría al revés |
| --- | --- | --- |
| 1.º | **Migraciones** (`supabase db push`) | Una función o una pantalla que consulte una tabla o una columna que todavía no existe responde `42P01`/`42703`. No es un error transitorio: dura hasta que se aplique la migración |
| 2.º | **Edge Functions** (`functions deploy`) | Una pantalla nueva que llame a una función que aún no está desplegada recibe 404 |
| 3.º | **Frontend** (`git push`, que dispara Vercel) | — Es la única capa que nadie más consume, así que va la última |

El frontend se publica **con el `git push`**, que es lo que dispara el deploy de Vercel. Por eso
el push va en el paso 5 y no antes: hacerlo al principio publica la interfaz nueva contra una
base y unas funciones viejas.

**La ventana existe igualmente, pero al derecho es inofensiva**: entre el paso 3 y el 5 la base y
las funciones están por delante del frontend, y una tabla de más o una función desplegada que
nadie llama todavía no rompen nada. Al revés, la interfaz pide cosas que no existen.

⚠️ **Esto obliga a que las migraciones sean compatibles hacia atrás**, porque durante esa ventana
el frontend viejo sigue en producción. Añadir tablas y columnas lo es; renombrar o borrar una
columna que el frontend vigente lee, no. Si alguna vez hace falta un cambio incompatible, son dos
publicaciones: primero añadir y publicar todo, después retirar.

---

## 1. Comprobaciones previas

```bash
git branch --show-current          # debe ser main
git status --short                 # ver qué hay sin commitear
git fetch origin && git status -sb # ¿ahead/behind?
npm run build                      # tsc strict + vite; debe acabar en verde
```

Y si el cambio toca `scripts/` o `supabase/functions/`, el typecheck que `tsc` no hace:

```bash
deno check scripts/*.ts
for d in supabase/functions/*/; do [ "$(basename $d)" = "_shared" ] && continue; \
  deno check --config "$d/deno.json" "$d/index.ts"; done
```

Si algo de esto falla, **para aquí**: no se publica lo que no compila.

Si el árbol ya está limpio y `main` sincronizada, no hay nada que commitear ni pushear — dilo y
salta al paso 3. Es un resultado normal, no un error: otra sesión pudo publicar antes.

## 2. Commit

Solo si hay cambios. Antes de commitear, comprueba la regla permanente del proyecto:
**si el cambio toca arquitectura, datos, contratos de funciones, rutas, convenciones, comandos
o deuda técnica, `AGENTS.md` tiene que quedar al día en el mismo commit** (`CLAUDE.md` lo importa).

Mensaje en **castellano**, describiendo el *qué* y el *por qué*, y terminando con la línea de
atribución que indique el sistema en esta sesión.

Antes de `git add`, revisa que no entre nada prohibido: `docs/`, `scripts/data/`, `.env*`,
`.claude/settings.local.json` y `.claude/launch.json` están en `.gitignore` — si aparecen en
`git status`, algo va mal.

**No hagas `push` todavía.** El push publica el frontend y aquí la base aún no está lista.

## 3. Base de datos

Primero mira qué falta y **qué datos hay que la migración va a tocar**. Una migración se aplica
sobre datos reales, y es la única capa de esta lista que no se puede revertir con un redespliegue:

```bash
supabase migration list --linked     # las locales sin pareja remota son las pendientes
```

Para cada migración pendiente que añada un `check`, cambie un tipo o rellene una columna,
**consulta antes las filas afectadas** (con la service key contra PostgREST, o por el SQL Editor)
y comprueba que la pasarían. Si alguna no, la migración no está lista: no se publica y se arregla.

Si no hay ninguna pendiente, dilo y salta al paso 4.

```bash
supabase db push
```

⚠️ **`--include-all` solo si el CLI lo pide.** Rechaza con `LegacyMigrationMissingRemoteError`
las migraciones «anteriores a la última aplicada», que aparecen cuando un spike adelantó ficheros
y dejó huecos por debajo (pasó con la tanda documental). Si no hay huecos, `db push` a secas basta
— y es preferible, porque `--include-all` reaplica lo que encuentre sin preguntar.

⛔ **Nunca `supabase config push`**: arrastra `enable_signup = false` y desactiva el login por
email en remoto, dejando al equipo fuera. Los flags de Auth se tocan por Management API.

**Verifica** que el esquema está de verdad, no que el comando no dio error: consulta una columna o
llama a una función de las que acaba de crear la migración.

## 4. Edge Functions

⚠️ **`updated_at` de `supabase functions list` NO dice si el código está al día.** Puede ser
viejo y el bundle estar al día (se despliega, se verifica en producción y se commitea después,
así que el commit queda con fecha posterior al despliegue). Y **la ausencia de `No change found`
tampoco prueba nada** (deuda §12.44): una función sin cambios puede volver a empaquetarse. Solo
`No change found in Function: X` es concluyente, y solo en un sentido.

**Qué redesplegar:**

- Si cambió el `index.ts` de una función → esa.
- Si cambió algo de **`supabase/functions/_shared/`** (salvo `pdf/`, que solo importa
  `generar-documento`) → **todas**, porque el código compartido entra en cada bundle.
- Si cambió el `deno.json` de una función → esa (el import map también entra en el bundle).
- Si cambió **cualquier secreto** (`ALLOWED_ORIGIN`, `APP_URL`, `RESEND_FROM`, `WHATSAPP_*`,
  `DOCUMENTOS_SECRET`) → **todas las que lo leen**, aunque no haya tocado una línea de código: son
  `const` de módulo evaluados al cargar, y un isolate caliente no ve el secreto nuevo.
- En la duda, redesplegarlas todas: es idempotente y no cuesta nada.

**Antes de desplegar, guarda las huellas** para poder saber después qué cambió de verdad
(deuda §12.44 — la salida del CLI no sirve):

```bash
deno run -A scripts/huellas-funciones.ts guardar
```

**Las catorce, cada una con su flag** (el flag tiene que coincidir con lo que declara
`config.toml`, que es quien manda):

```bash
supabase functions deploy whatsapp-send                              # verify_jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt           # Meta no manda JWT
supabase functions deploy priorizar-entidades                        # verify_jwt
supabase functions deploy intake-recordatorios --no-verify-jwt       # lo llama pg_cron
supabase functions deploy enviar-email                               # verify_jwt
supabase functions deploy recuperar-password --no-verify-jwt         # público
supabase functions deploy crear-oferta                               # verify_jwt
supabase functions deploy registro --no-verify-jwt                   # registro público
supabase functions deploy enviar-acceso                              # verify_jwt
supabase functions deploy generar-documento --no-verify-jwt          # la llama el trigger por pg_net
supabase functions deploy descargar-documento                        # verify_jwt
supabase functions deploy recordatorios-documentales --no-verify-jwt # lo llama pg_cron
supabase functions deploy enlace-publico --no-verify-jwt             # confirmación y firma públicas
supabase functions deploy subir-documento-externo                    # verify_jwt
```

Al terminar, **qué cambió de verdad**:

```bash
deno run -A scripts/huellas-funciones.ts comparar
```

Compara el `ezbr_sha256` de cada bundle con el de antes del despliegue. Es la única señal
fiable: `No change found` solo concluye cuando aparece, y su ausencia no prueba nada.
⚠️ Dice si el bundle **cambió entre dos momentos**, no si coincide con el código del repo.

Luego comprueba que las catorce quedaron `ACTIVE` y con el `verify_jwt` que toca:

```bash
supabase functions list
```

`true` en `whatsapp-send`, `priorizar-entidades`, `enviar-email`, `crear-oferta`, `enviar-acceso`,
`descargar-documento` y `subir-documento-externo`; `false` en `whatsapp-webhook`,
`intake-recordatorios`, `recuperar-password`, `registro`, `generar-documento`,
`recordatorios-documentales` y `enlace-publico`.

⚠️ El `verify_jwt` que acaba aplicándose sale de **`config.toml`**, no del flag de la línea de
comandos: si una función discrepa de esa lista, se corrige ahí y se vuelve a desplegar. Pasó con
`whatsapp-send`, que estuvo en `false` hasta el 10-09-2026 (deuda 43, ya cerrada).

## 5. Frontend

Ahora sí, y solo ahora: la base tiene su esquema y las funciones su código.

```bash
git push origin main
```

El push a `main` **dispara solo el deploy de Vercel**. No hay que ejecutar `vercel --prod`.

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

## 6. Verificación funcional

**CORS.** Léelo en la cabecera, **nunca en el código de estado**: cuando el origen no está
permitido la función responde igualmente 204, pero devuelve *el primer origen de la lista* en vez
del pedido, y es el navegador quien bloquea.

```bash
SB=https://uxppvaldhptdomvdhsmn.supabase.co/functions/v1
O=https://redestina.carlessanz.com
for f in whatsapp-send priorizar-entidades enviar-email recuperar-password crear-oferta \
         enviar-acceso registro enlace-publico descargar-documento subir-documento-externo; do
  A=$(curl -sS -o /dev/null -D - -X OPTIONS "$SB/$f" -H "Origin: $O" \
      -H "Access-Control-Request-Method: POST" \
      -H "Access-Control-Request-Headers: authorization,content-type" \
      | grep -i '^access-control-allow-origin' | tr -d '\r' | sed 's/.*: //')
  printf "  %-24s %s\n" "$f" "${A:-— NINGUNA}"
done
```

Las diez deben devolver **exactamente** `https://redestina.carlessanz.com`. Cualquier otra cosa
—incluido `http://localhost:5173`— significa que esa función no ve el `ALLOWED_ORIGIN` bueno:
vuelve al paso 4 y redespliégala.

Contraprueba con un origen que no debe pasar (`-H "Origin: https://evil.example.com"`): tiene que
devolver algo distinto de ese origen.

**Endpoints públicos**, que son los únicos alcanzables sin sesión:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$SB/registro" -H 'Content-Type: application/json' -d '{}'          # 400 (validación)
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$SB/recuperar-password" -H 'Content-Type: application/json' -d '{"email":"noexiste@example.com"}'  # 200 genérico
curl -sS -o /dev/null -w '%{http_code}\n' "$SB/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1"  # 403
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$SB/generar-documento" -H 'Content-Type: application/json' -d '{"documento_id":"00000000-0000-0000-0000-000000000000"}'  # 401 (falta el secreto)
```

## 7. Permisos (si el cambio tocó datos, políticas o roles)

```bash
set -a; . ./.env.local; set +a
export SUPABASE_URL="${SUPABASE_URL:-$VITE_SUPABASE_URL}"   # el script pide SUPABASE_URL, .env.local trae VITE_SUPABASE_URL
deno run -A scripts/comprobar-rls.ts
```

**La referencia vigente está en `AGENTS.md §13`, no aquí** — este fichero se quedó desfasado una
vez y dio por buena una cifra de antes del sistema documental. Hoy en remoto son **329/329
correctas y 46 saltadas**, terminando en «Sin fallos de permisos» y con código de salida 0.

Las **saltadas son normales**: producción no tiene —ni debe tener— el fixture de
`crear-datos-documentales-prueba.ts`, así que los checks que necesitan albaranes, cierres o
convenios de prueba no tienen qué mirar. **Cualquier FALLA es una regresión**: no des la
publicación por buena.

Si algo se torció con los permisos: `deno run -A scripts/roles-activos.ts off` (10 segundos), y
si no basta, `scripts/sql/rls-emergencia.sql`.

## 8. Informe

Una línea por paso, con OK o FALLO y el detalle de lo que hiciste. Incluye siempre:

- el SHA publicado y si hubo commit o el árbol ya estaba limpio;
- **qué migraciones se aplicaron** y qué datos de producción se comprobaron antes;
- qué funciones se redesplegaron y por qué (código propio, `_shared/`, o un secreto nuevo);
- el resultado del arnés si lo ejecutaste, comparado con la referencia de `AGENTS.md §13`;
- los interruptores de producción que siguen pendientes, para que no se olviden:
  **`VITE_ACCESSOS_TEST`** (si está en `true`, las contraseñas de las cuentas de prueba viajan en
  el bundle y cualquiera que abra `/login` entra como ellas; es **variable de build**, así que
  cambiarla en Vercel **exige redesplegar**), el **modo test** (`app_settings.test_mode`) y las
  whitelists `meta_test_recipients` / `email_test_recipients`.

## Notas de esta máquina

- `timeout` no existe (macOS/zsh): no lo uses para acotar comandos.
- El arnés y los scripts de Deno leen las claves de `.env.local`; la service key está en
  `.secrets.env`. Los dos están fuera de git.
- Los **logs de las funciones** no se leen con el CLI (no tiene `functions logs`) sino con el
  Management API de analítica: la orden, con sus trampas, en `AGENTS.md §11`.
- El CLI de Vercel está autenticado como `upsocial`, que es **DEVELOPER**: puede desplegar y leer,
  pero no cambiar ajustes del proyecto (un `PATCH /v9/projects/{id}` responde 403). Para eso hace
  falta la cuenta `carlessanz`, que es OWNER.
