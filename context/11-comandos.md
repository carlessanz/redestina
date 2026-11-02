# AGENTS.md §11 — 11. Comandos

> Detalle de la sección 11 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §11» del código apuntan aquí.

## 11. Comandos

### Despliegues con token temporal (06-10-2026)

**Cualquier operación que necesite el token de gestión de Supabase** —`functions deploy`,
`migration list`, `scripts/aplicar-migracion.ts`, `secrets set`, las llamadas al Management API
de §7, §9 y §10ter— **se hace dentro de una sesión temporal abierta por el usuario**. El token ya
no vive en el llavero ni en ningún fichero.

- **Token**: Personal Access Token *scoped* de Supabase, **`Redestina - Admin - Producción`**
  (mismo nombre en 1Password). Cuenta `hola@carlessanz.com`, organización **Carles Sanz**,
  **solo** el proyecto `uxppvaldhptdomvdhsmn`. Caducidad **Never** (decisión del usuario, igual que
  Custodia360). Preset *Full access* con los siete permisos de *Account and organization* en
  **None**: 34 capacidades read-write y 5 read (Advisors, Logs, Usage Analytics, API Key Secrets,
  Data API JWT Secret) sobre 1 proyecto. Administra todo dentro de Redestina y nada fuera.
  ⚠️ No da `supabase projects list` (necesita *Projects account-wide*): no se amplía para eso.
- **Abrir la sesión**, en una terminal del usuario en el repo:
  ```bash
  bash scripts/sesion-supabase-temporal.sh
  ```
  Pide el token con entrada oculta (solo el valor `sbp_…`, sin comillas ni `export`), lo exporta
  como `SUPABASE_ACCESS_TOKEN` en una bash hija sin historial y con el prompt
  `[Token temporal · Redestina]`. **No despliega nada**: los comandos los prepara el asistente para
  cada entrega y el usuario los ejecuta ahí. Al terminar, **`exit`** (cerrar la sesión no revoca el
  token en Supabase).

Reglas para el asistente:

1. Antes de publicar, identifica rama (`main`), SHA, componentes y destino. Tener el token no
   autoriza por sí solo a publicar, cambiar datos o permisos: valen las reglas de `/publicar`.
2. **No pidas el token por chat, memoria, adjunto ni captura**, no leas el portapapeles, no uses el
   llavero (`security find-generic-password`) ni la CLI de 1Password.
3. Si hace falta token, da el comando de la sesión y luego los comandos concretos de la entrega.
   **Tus herramientas no heredan la variable** de esa terminal: no supongas que la tienes. Si ya hay
   una sesión de Redestina abierta, se reutiliza; si es de otro proyecto, `exit` antes.
4. **Si solo cambia el frontend**, no hace falta token de Supabase: basta el `git push` (Vercel).
5. No imprimas el entorno ni el token, ni actives `set -x` o `--debug`.
6. Si un paso falla, para los que dependen de él. Sigue la publicación hasta comprobar el estado
   final y recuerda `exit` al terminar.

Incidencias: `Invalid access token format` → `exit`, reabrir y pegar solo el token. `401`/`403` →
revisar vigencia y que el token sea el de Redestina; no cambiar a otro token ni ampliar permisos.

⚠️ **En la app de escritorio, una orden con `!` desde el chat NO llega a la sesión** (07-10-2026).
El `!` se ejecuta en la pestaña del panel Terminal **solo si está libre**; la sesión temporal la deja
ocupada (es una sub-shell), así que el `!` siguiente abre una pestaña nueva **sin token** y se lee como
`Format is Authorization: Bearer [token]` o `unexpected login role status 401`. Lo que funcionó: el
usuario escribe **en el panel**, dentro de la sesión, una sola línea `bash scripts/data/<fase>.sh`
—scripts de la entrega en `scripts/data/` (fuera de git), que dejan su salida en un `.log` que el
asistente lee— y para recargar el token sin abrir otra sesión, `source scripts/cargar-token.sh`
(bash o zsh). Cada pestaña nueva parte sin token: cerrar las que sobren y trabajar en una.

### El clon local (07-10-2026)

Una **copia completa de producción en Docker**, para desarrollar y probar sin tocarla. Todo lo que
crea Docker lleva «Redestina» en el nombre (`supabase_db_Redestina`, la red
`supabase_network_Redestina`…: el CLI lo toma de `project_id`) y usa los puertos 553xx:

| Servicio | Dirección |
| --- | --- |
| API (y Edge Functions en `/functions/v1`) | `http://127.0.0.1:55321` |
| Postgres | `127.0.0.1:55322` (`postgres`/`postgres`) |
| Studio | `http://127.0.0.1:55323` |
| Buzón de pruebas (Mailpit) | `http://127.0.0.1:55324` (los correos de Redestina NO llegan aquí: van por Resend y en local se simulan) |
| Frontend (`npm run dev:local`) | `http://localhost:5173`, con la cortina igual que producción |

**Qué es igual que producción, comprobado el 07-10-2026**:
- el esquema de `public`, **idéntico línea a línea** quitando comentarios: lo construyen las 148
  migraciones desde cero (deuda 125, cerrada);
- las 51 tablas, las cuentas (`auth.users` e `auth.identities`, con su contraseña), los 244
  ficheros de los buckets, los 8 jobs, las políticas de Storage, las extensiones y el historial
  de migraciones (`scripts/local/recompte.ts comparar`: «Ninguna diferencia»);
- el arnés de permisos: 1.052/1.052 y 26 sin datos, la misma cifra (§13).
✅ **Refrescado el 27-10-2026** con un volcado de ese día (183 migraciones, tras publicar `3907281`): las 67
tablas cuadran con producción y los ficheros se copiaron con `copiar-storage.ts`.

**Qué es distinto a propósito**:
- `app_config` **no se copia**: son los secretos de producción, y con ellos los jobs locales
  llamarían a las funciones de producción. El clon lleva secretos propios, y
  `functions_base_url = http://kong:8000/functions/v1`, así que **todos** los jobs y triggers
  llaman a las funciones LOCALES. El del intake también desde `20270413100000`, que lo pasó por
  `url_funciones()`: era la única llamada con la URL de producción escrita a mano.
- Correo y WhatsApp **simulados** (`RESEND_ENVIO_REAL=false`, `WHATSAPP_ENVIO_REAL=false`, y sin
  claves de Resend ni de Meta).
- `roles_activos` y `test_mode` encendidos siempre, aunque producción los cambie.
- El webhook de WhatsApp no recibe nada: Meta solo llama a producción (haría falta un túnel).
- Las URLs firmadas de Storage salen con `http://kong:8000`, que el navegador no abre; en local
  las reescribe `URL_PUBLICA_STORAGE` (`_shared/url-publica.ts`). En producción la variable no
  existe. ⚠️ No puede llamarse `SUPABASE_*`: el CLI descarta en silencio esas variables.

**Montarlo o refrescarlo** (el orden importa):

```bash
# 1. Arrancar el stack (la skill supabase-local, o `supabase start`). Con la base vacía
#    aplica las migraciones (160 a 07-10-2026).
# 2. Volcar producción: lo hace Carles, en la sesión del token (solo lee de producción).
bash scripts/local/volcar-produccion.sh            # → supabase/.local-dump/ (fuera de git)
# 3. Entorno local: secretos locales y claves del stack (ficheros .env* fuera de git).
bash scripts/local/preparar-entorno.sh
# 4. Cargar datos y cuentas (una transacción; sin triggers; comprueba las FK y compara con producción).
bash scripts/local/cargar-local.sh
# 5. Copiar los ficheros de los buckets (de producción solo lee).
deno run -A --node-modules-dir=none scripts/local/copiar-storage.ts
# 6. Servir las funciones y el frontend.
bash scripts/local/funciones-local.sh               # en una pestaña aparte; Ctrl+C para
npm run dev:local
# Scripts del repo contra el clon (en vez de `source .env.local`):
eval "$(bash scripts/local/entorno-local.sh)"; deno run -A --node-modules-dir=none scripts/comprobar-rls.ts
```

🔴 **El volcado tiene que ser de las mismas migraciones que el clon** (27-10-2026). `cargar-local.sh`
vacía `public` entero antes de cargar, así que con un volcado más viejo que el esquema se lleva también lo
que sembraron las migraciones posteriores (la matriz de convenios, las plantillas `col_*`, los catálogos de
destinos, actividades e impacto, el cuestionario v2…) y el volcado no lo repone: queda el esquema de hoy con
los datos de antes. Pasó ese día (volcado del 07-10, 160 migraciones, sobre 183). Desde entonces el script se
niega si el volcado tiene menos migraciones que el clon; lo que toca es **volcar producción otra vez**
(`volcar-produccion.sh`, en la sesión del token). Si ya ha pasado, se arregla volviendo a pasar las
migraciones posteriores con `psql` sentencia a sentencia, sin `ON_ERROR_STOP` (lo que ya existe falla y
sigue; las siembras y los rellenos vuelven), que es como se recuperó: 28 errores, todos de «ya existe».
⚠️ **Y el servidor de funciones del clon se cae por memoria** (`exit 137`) cuando se generan varios PDF a la
vez: si las E2E empiezan a fallar en lo que llama a una función, mirar `scripts/data/funciones-local.log` y
volver a lanzar `funciones-local.sh`.

⚠️ **Probar una migración nueva**: `supabase migration up` (sin `--linked`) la aplica al clon; y
`supabase db reset` (sin `--linked`) reconstruye el clon desde cero, después de lo cual hay que
repetir los pasos 4 y 5. **Nunca `--linked`** con `db reset`: el repo está enlazado a producción.
⚠️ Los scripts de `scripts/local/` se niegan a seguir si la URL no es `127.0.0.1`/`localhost`.
⚠️ `supabase/.local-dump/` lleva datos personales de prueba y hashes de contraseñas: nunca a git
ni a la carpeta de consultoría.
⚠️ Al acabar, la skill `supabase-local` pregunta si se para el stack (libera ~1 GB; los datos se
conservan en los volúmenes).

### Referencia

```bash
npm run dev                # Vite en tu máquina, contra PRODUCCIÓN (.env.local)
npm run dev:local          # Vite contra el CLON LOCAL (.env.supabase-local.local, §11 «El clon local»)
npm run build              # tsc && vite build  (solo mira src/: ni scripts ni Edge Functions)
npm run preview            # servir el build

# ⚠️ Producción es la base de verdad (§7). Una migración se prueba ANTES en el clon local
# (`supabase migration up`, sin --linked) y después se aplica en producción con dry-run y push.
# ⚠️ El login del CLI de esta máquina es de otra cuenta. Todo lo que pide token de Supabase va
# DENTRO de la sesión temporal (ver «Despliegues con token temporal», justo debajo). Ahí dentro,
# las migraciones van por el script, que las registra con el número del fichero:
#   deno run -A scripts/aplicar-migracion.ts supabase/migrations/<f>.sql --dry-run
#   deno run -A scripts/aplicar-migracion.ts supabase/migrations/<f>.sql

# Fotos del catálogo y de las ofertas (27-09-2026), desde scripts/fotos-cataleg.json. Primero en
# local para REVISARLAS a ojo; luego a la base (salta lo que ya tiene foto, salvo --forcar).
# Solo acepta CC0 / dominio público. Usa sips + cwebp (macOS) y curl con un User-Agent que dice
# el proyecto: Flickr da 403 a uno con «Bot» y Wikimedia 429 a uno anónimo.
deno run -A scripts/fotos-cataleg.ts --local /tmp/fotos [--manifest otro.json] [--nomes productes|ofertes]
SUPABASE_URL=… SB_SECRET_KEY=… deno run -A scripts/fotos-cataleg.ts [--forcar] [--dry-run]
supabase db push --dry-run                                # qué se aplicaría, sin aplicar nada
supabase db push                                          # aplicar migraciones en el remoto
supabase functions deploy whatsapp-send        # con verify_jwt
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy priorizar-entidades  # con verify_jwt
supabase functions deploy intake-recordatorios --no-verify-jwt   # lo llama pg_cron
supabase functions deploy enviar-email         # con verify_jwt (ofertas por email)
supabase functions deploy recuperar-password --no-verify-jwt     # login público
supabase functions deploy crear-oferta         # con verify_jwt (alta desde el panel del productor)
supabase functions deploy registro --no-verify-jwt               # registro público self-service (§9)
supabase functions deploy enviar-acceso        # con verify_jwt (enlace mágico / código de acceso)
supabase functions deploy donar-acces          # con verify_jwt («Dona-li accés», plan 1 1D, 02-11-2026)
# alta-assistida: retirada en 1D y borrada del remoto el 02-11-2026 (`functions delete`); ya no existe
# ⚠️ 27-10-2026: `_shared/resend.ts`, `gate.ts` y `canal.ts` cambiaron (interruptores de §8): hay que
#    redesplegar TODAS las que los importan, y `registro` (alta.ts). Tras `generar-documento`, el
#    documento de prueba de siempre.
supabase functions deploy generar-documento --no-verify-jwt      # la llama el trigger por pg_net
supabase functions deploy descargar-documento # con verify_jwt (URL firmada de 60 s)
supabase functions deploy reenviar-documento  # con verify_jwt (equipo: reenviar un documento)
supabase functions deploy recordatorios-documentales --no-verify-jwt  # lo llama pg_cron
supabase functions deploy enlace-publico --no-verify-jwt        # confirmación pública (§9)
supabase functions deploy subir-documento-externo               # con verify_jwt (multipart, 10 MB)
# ⚠️ `subir-documento-externo` y `descargar-documento` cambiaron el 22-09-2026 (documentación
#    de la organización y descarga de externos, §4): hay que redesplegar LAS DOS. La segunda
#    acepta ahora `{documento_extern_id}` además de `{documento_id}`.
supabase functions deploy limpiar-documentos-prueba            # con verify_jwt (super_admin; §12.51)
supabase functions deploy verificar-certificat --no-verify-jwt   # pública: comprobar un certificado (§9)
supabase functions deploy enviar-avis --no-verify-jwt            # la llama la base (avisos, 05-10-2026)
supabase functions deploy recollides-programades --no-verify-jwt # pg_cron cada 15 min (recogida programada)
supabase secrets set --env-file .secrets.env
# ⚠️ Los flags de arriba están además DECLARADOS en `supabase/config.toml`, que manda sobre el
# CLI: desde el 10-09-2026 las nueve tienen su `verify_jwt` escrito (antes, tres se apoyaban en
# el default del CLI, que es `true` — correcto, pero no escrito en ninguna parte, que es
# exactamente la distancia de la que nació la deuda 43).
#
# ⚠️ **Estos despliegues son la ÚNICA forma de publicar una función, desde el 14-09-2026.** Hasta
# ese día el proyecto tenía Supabase Branching conectado a `main` y cada `git push` desplegaba las
# quince por su cuenta (§12.44); se desactivó (§7) porque ese mismo mecanismo crea una rama de
# preview —otra base de datos— al abrir un PR. El coste aceptado es este: **si no las despliegas
# tú, no se despliegan**. Un `git push` con una función cambiada y sin `functions deploy` deja el
#
# 🔴 **Y UN REDESPLIEGUE PUEDE ROMPER LO QUE NO TOCASTE.** El 21-09-2026, redesplegar
# `generar-documento` sin cambiar una línea suya dejó la generación de PDF **rota en
# producción**: los ficheros de `static_files` —las cuatro fuentes y el logo— dejaron de
# llegar al isolate y `Deno.readFile` respondía `path not found` en TODOS los documentos.
# El CLI cambió el modo de empaquetado, y en el runtime nuevo no existe ni el directorio
# del propio módulo. Se arregló llevando los activos DENTRO del bundle
# (`activos/incrustats.ts`, que genera `scripts/incrustar-activos.ts`).
# ⚠️ **La lección operativa, que vale para cualquier función**: el despliegue no da ningún
# error —dice «Deployed Functions» igual— y el fallo solo se ve ejecutándola. Tras
# redesplegar `generar-documento`, **emitir un documento de prueba y comprobar que sale**
# (`emitir_documento_prova()` con sesión de super_admin; limpieza con
# `reiniciar_documentos_prova()` + la función `limpiar-documentos-prueba`). La referencia
# es un PDF de 6 páginas y ~123.600 bytes.

# Publicar en producción: el procedimiento completo vive en el skill `/publicar`
# (.claude/skills/publicar/SKILL.md). Ejecutarlo es preferible a repetir los pasos a mano:
# recoge los flags de cada función y las trampas de verificación.
# ⚠️ El orden es **base de datos → Edge Functions → frontend**, de abajo arriba, y cada capa
# solo depende de otra ya publicada. El `git push` es lo que dispara Vercel, así que va el
# ÚLTIMO: hacerlo antes publica la interfaz nueva contra un esquema viejo, y una pantalla que
# consulta una tabla que no existe responde 42P01 hasta que se aplique la migración. La
# consecuencia es que las migraciones tienen que ser compatibles hacia atrás —el frontend
# vigente sigue sirviéndose durante esa ventana—: añadir sí, renombrar o borrar exige dos
# publicaciones.

deno run -A scripts/import-ara.ts --dry-run   # analizar sin escribir
deno run -A scripts/import-ara.ts             # importar los CSV maestros

# Arnés de RLS: matriz de permisos por cuenta (§4bis). Abre sesión de verdad con cada
# cuenta de scripts/data/cuentas-prueba.json contra el proyecto remoto.
set -a; . ./.env.local; set +a
SUPABASE_URL="$VITE_SUPABASE_URL" deno run -A scripts/comprobar-rls.ts

# Numeración documental sin huecos (§4 «Sistema documental»). Necesita la service key y
# escribe solo documentos de prueba, que limpia `reiniciar_documentos_prova()`.
SUPABASE_URL="$VITE_SUPABASE_URL" SB_SECRET_KEY=sb_secret_… \
  deno run -A scripts/prueba-numeracion.ts                    # 5 pasadas × 50 emisiones
  deno run -A scripts/prueba-numeracion.ts --pasadas 2 --emisiones 200 --fallos 0.3

# Typecheck de lo que `tsc` NO mira. ⚠️ El --config es obligatorio: `deno check` toma la
# configuración del cwd, no la de la carpeta del módulo, y sin ella no resuelve los imports.
# ⚠️ Y los scripts van con --node-modules-dir=none (06-10-2026): al ver package.json, Deno
# resolvía los `npm:` de jsr:@supabase/supabase-js contra el node_modules de npm, y en cuanto
# JSR publicó una versión que pide un realtime-js que el lockfile no tiene, el check (y el CI,
# que hace `npm ci` antes) se rompió sin que nadie tocara nada.
deno check --node-modules-dir=none scripts/*.ts
for d in supabase/functions/*/; do [ "$(basename $d)" = "_shared" ] && continue; \
  deno check --config "$d/deno.json" "$d/index.ts"; done

# Pruebas de extremo a extremo (Playwright, 05-10-2026). NO van en `npm run check`: abren
# sesión de verdad contra el remoto con las cuentas de `scripts/data/cuentas-prueba.json`
# y necesitan la contraseña de la cortina. Sin ellas, se SALTAN. Las que escriben, solo con
# E2E_ESCRIU=1 (y modo test encendido; no fijan hora de recogida, así que no emiten albaranes).
E2E_CORTINA='…' npm run test:e2e                     # móvil 390 px y escritorio
E2E_CORTINA='…' E2E_ESCRIU=1 npm run test:e2e        # también el circuito que escribe
SUPABASE_URL=… SB_SECRET_KEY=… deno run -A scripts/limpiar-e2e.ts [--dry-run]  # cancela las [E2E] y borra fichas E2E-

# CONTRA EL CLON LOCAL (11-10-2026): `E2E_CLON=1` levanta `npm run dev:local` en el puerto
# 5174 SIN cortina (`REDESTINA_SENSE_CORTINA=1`, que el plugin de `vite.config.ts` solo acepta
# en modo `supabase-local`; producción y `npm run dev` la ponen siempre). Las pruebas que
# ESCRIBEN de verdad (`motiuSaltClon()` en `tests/e2e/ajuda.ts`) solo corren así, y comprueban
# que el frontend del clon apunta a 127.0.0.1; preparan datos y disparan jobs con `sql()`
# (`docker exec … psql` como `postgres`). Si Playwright pide un navegador que no está
# descargado, `PW_CHROMIUM_PATH` apunta a uno de la caché (`~/Library/Caches/ms-playwright`).
# Tras una tanda que consuma numeración legal, `scripts/local/cargar-local.sh` deja el clon
# como producción — con un volcado AL DÍA: con uno más viejo que las migraciones se niega (§11). Hoy: `desti-final.e2e.ts` (fase 1), `vocabulari.e2e.ts` (fase 0) y `operacio.e2e.ts`
# (fase 2). La tanda completa (`E2E_CLON=1 E2E_ESCRIU=1 npx playwright test`, 12-10-2026) son 96 pruebas:
# las de las fases 0-11 más `retocs.e2e.ts` (lectura, vale también en producción) y `foto-oferta.e2e.ts`
# (la foto de la oferta en WhatsApp y correo, con el envío SIMULADO: prueba el camino, no la entrega;
# el envío real a un número de Meta se hace a mano). Salida: `scripts/data/e2e-clon.log`. `ajuda.ts` da `sqlCom(rol, sql)` para actuar COMO una cuenta (claims de su `sub`) y
# `entidadDe`/`productorDe`; `compte()` acepta la etiqueta (`receptor-carles`, la receptora con
# convenio vigente: `Menjador Social de Prova` está a propósito sin él).
E2E_CLON=1 PW_CHROMIUM_PATH=… npx playwright test     # móvil y escritorio, contra el clon

# Pruebas unitarias (Vitest 4). Corren en Node sobre los módulos de negocio, que son
# TypeScript puro: ni una referencia a `Deno.`, ni un import `npm:`/`jsr:`.
npm test                      # vitest run
npm run test:watch            # durante el desarrollo
npm run test:cobertura        # con cobertura v8 sobre src/lib y _shared

# Los tres controles de una vez (lo que conviene ejecutar antes de dar nada por terminado):
npm run check                 # tipos (app + pruebas) + lint de hooks + vitest + deno check
npm run lint                  # solo ESLint: las dos reglas de react-hooks, línea base en cero
npm run check:tipos           # solo tsc: tsconfig.json y tsconfig.tests.json

# El hook de pre-commit se instala UNA VEZ por clon (git no ejecuta hooks versionados solo):
git config core.hooksPath .githooks

# Los activos del PDF viajan DENTRO del bundle, no en el disco (§11, 21-09-2026). Tras
# cambiar una fuente o el logo hay que regenerar el módulo y redesplegar generar-documento:
deno run -A scripts/incrustar-activos.ts

# Qué Edge Functions han cambiado DE VERDAD entre dos despliegues (§12.44). La salida del
# CLI no sirve para saberlo; el `ezbr_sha256` sí, pero hace falta guardar el de antes.
deno run -A scripts/huellas-funciones.ts guardar    # ANTES de desplegar
deno run -A scripts/huellas-funciones.ts comparar   # después
deno run -A scripts/huellas-funciones.ts listar     # solo mirar

deno run -A scripts/crear-usuarios-prueba.ts --dry-run   # simular el alta de los 12 usuarios de prueba
deno run -A scripts/crear-usuarios-prueba.ts             # crearlos (idempotente)
deno run -A scripts/crear-usuarios-whatsapp.ts --dry-run # simular las 5 cuentas de WhatsApp (§9)
deno run -A scripts/crear-usuarios-whatsapp.ts           # crearlas (no toca ninguna ficha)

# Fixtures de datos. El orden importa: las respuestas necesitan las ofertas y los convenios
# que deja el documental, y los dos necesitan las cuentas de arriba.
deno run -A scripts/crear-datos-documentales-prueba.ts --dry-run
deno run -A scripts/crear-datos-documentales-prueba.ts   # espigolada, lotes, albaranes y cierre
deno run -A scripts/crear-respuestas-prueba.ts --dry-run
deno run -A scripts/crear-respuestas-prueba.ts           # respuestas: aprobada, pendiente y rechazada

# El escenario de demostración (§9, §3): limpia, reparte papeles, firma convenios y crea
# las ofertas E-DEMO-*. Consume numeración legal de convenios; no hay --dry-run para todo
# el script porque cada bloque ya avisa de lo que HARÍA sin escribir cuando se pasa el flag.
set -a; . ./.env.local; . ./.secrets.env; set +a
SUPABASE_URL="$VITE_SUPABASE_URL" deno run -A scripts/escenari-demo.ts --dry-run
SUPABASE_URL="$VITE_SUPABASE_URL" deno run -A scripts/escenari-demo.ts

# ⚠️ Una tanda con huecos necesita --include-all. Pasó con la fase 1 documental: el spike
# aplicó 20260928100600 y ...100800 dejando huecos por debajo, así que las seis migraciones
# de la segunda mitad son «anteriores a la última aplicada» y el CLI las rechaza con
# LegacyMigrationMissingRemoteError. No es un error: es el precio de haber adelantado dos
# ficheros.
supabase db push --include-all --dry-run  # comprobarlo antes, siempre
supabase db push --include-all

# Secreto del sistema documental, en los DOS sitios (el job lo manda, la función lo valida):
deno run -A scripts/set-config.ts documentos_secret '<valor>'   # app_config
supabase secrets set DOCUMENTOS_SECRET='<el mismo valor>'       # secreto de la función
```

Logs de las Edge Functions **en remoto**. ⚠️ Este CLI **no tiene `functions logs`** (`supabase
functions` solo trae list/delete/download/deploy/new/serve), así que durante un tiempo se dio por
hecho que había que abrir el panel. No hace falta: el **Management API de analítica** los sirve por
SQL, con el mismo token de la sesión temporal que se usa para Auth (§9, §11).

```bash
TOKEN="$SUPABASE_ACCESS_TOKEN"   # dentro de la sesión temporal (§11)
SQL="select timestamp, event_message from function_logs order by timestamp desc limit 20"
curl -sS -G "https://api.supabase.com/v1/projects/uxppvaldhptdomvdhsmn/analytics/endpoints/logs.all" \
  -H "Authorization: Bearer $TOKEN" --data-urlencode "sql=$SQL"
```

`function_logs` son los `console.*` de las funciones (ahí sale el JSON de tiempos de
`generar-documento`, medido más abajo) y `edge_logs` las peticiones HTTP. El `cpu_time_used`, la región y la
memoria de cada isolate viven en el evento `shutdown`, dentro de `metadata`, y hay que desplegarlo
con `unnest`. **Saca siempre `execution_id`**, o los números no se pueden atribuir:

```bash
SQL="select f.timestamp, f.event_message, m.execution_id, m.region, m.cpu_time_used
     from function_logs f cross join unnest(f.metadata) as m
     order by f.timestamp desc limit 30"
curl -sS -G "https://api.supabase.com/v1/projects/uxppvaldhptdomvdhsmn/analytics/endpoints/logs.all" \
  -H "Authorization: Bearer $TOKEN" --data-urlencode "sql=$SQL" \
  --data-urlencode "iso_timestamp_start=2026-09-11T00:50:00.000Z" \
  --data-urlencode "iso_timestamp_end=2026-09-11T00:58:00.000Z"
```

⚠️ **La ventana por defecto son minutos, no horas.** Sin `iso_timestamp_start`/`iso_timestamp_end`
solo se ve lo más reciente y una ejecución de hace un rato parece no existir. Esos dos parámetros
son la forma de ir a buscarla; van **fuera** del SQL, como parámetros de la petición.

⚠️ **El `cpu_time_used` de una ejecución NO es el del `shutdown` más reciente.** Un isolate sigue
vivo un rato tras responder, así que su `shutdown` llega minutos después y entremedias se apagan
otros. Hay que casar `execution_id` con el del log de la ejecución. Cómo salió mal esto la primera
vez, y cuál es la señal de haberse equivocado, en §12.87.

⚠️ Un `unnest` mal escrito responde `Backend error! Retry your query`, que **no** es un fallo
transitorio: es la consulta.

**Cuánto cuesta generar un documento, medido en producción** (11-09-2026, y es el criterio de
salida del spike): un PDF de 6 páginas y 123.614 bytes da **`ms_render` 174,3 ms** —el
presupuesto eran 800—, `ms_subida` 107,8 ms y `ms_total` 462,6 ms; el runtime declara
**`cpu_time_used` 390 ms** y 22 MB, o sea un **19,5 % del techo de 2 s de CPU** y un 8,7 % de los
256 MB. Cinco generaciones reales dan **325-572 ms de CPU**. ⚠️ **El margen no es de un factor 10,
es de 4**: los convenios de 8-10 páginas caben, pero no sobra tanto como parece. `generar-documento`
emite un `console.warn` con `avis: "render_lent"` por encima de 800 ms de `ms_render`, que es un
aviso **anticipado** —el día que se pase del techo real no habrá log que mirar—.
⚠️ **`cpu_time_used` es del ISOLATE entero, no de la petición**: incluye el arranque y la
evaluación de módulos con `pdf-lib` dentro, así que sale mayor que `ms_render` aunque una sea CPU
y el otro reloj de pared. Y los no-op del cron `documentos-pendientes` gastan **33-77 ms**: un
valor en esa horquilla es la señal característica de haber leído el isolate equivocado.

Emergencia de RLS (§4bis), por orden: primero el interruptor,

```bash
deno run -A scripts/roles-activos.ts off     # o, en el SQL Editor:
# update app_settings set value = 'false' where key = 'roles_activos';
```

y si no basta, `scripts/sql/rls-emergencia.sql` en el SQL Editor.

**Apagar WhatsApp en toda la plataforma** (§8) es la pantalla de Configuración; la vía de
emergencia, cuando no se puede entrar, es la misma tabla:

```sql
update app_settings set value = 'false' where key = 'whatsapp_activo';
```

No hace falta redesplegar ni cerrar sesiones: el interruptor se lee en cada envío.

`npm run build` corre `tsc` con `strict`, `noUnusedLocals` y `noUnusedParameters`, **pero solo
sobre `src/`**: ni los scripts de Deno ni las Edge Functions entran en ese `tsconfig`, así que
durante meses no los comprobó nadie. Hoy hay **cuatro** comprobaciones automáticas: `tsc` (de la
aplicación **y** de las pruebas, con `tsconfig.tests.json`), **`vitest`**, `deno check` (scripts y
las 14 funciones) y `scripts/comprobar-rls.ts`, que verifica los permisos de verdad, contra la
base y con sesiones reales. Las tres primeras van juntas en `npm run check` y en el hook de
pre-commit; el arnés se queda fuera porque necesita credenciales. Si tocas algo de
`supabase/functions/_shared/`, **redespliega todas** las funciones que lo importan.

⚠️ **Las pruebas no viven en `src/` y eso es deliberado.** Importan dos mundos que la aplicación
no conoce —los módulos Deno de `_shared/`, que se referencian con extensión `.ts`, y utilidades de
Node— así que tienen su propio `tsconfig`. Meter `"node"` en los tipos del `tsconfig` de la
aplicación dejaría `process`, `Buffer` y `fs` visibles dentro de `src/`, que se empaqueta para el
navegador: haría compilar código que revienta en producción.

