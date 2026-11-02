# AGENTS.md §7 — 7. Convenciones

> Detalle de la sección 7 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §7» del código apuntan aquí.

## 7. Convenciones

- **Teléfonos**: E.164 **sin** `+`, solo dígitos → `34612345678`. Validación en el frontend:
  `/^[1-9]\d{6,14}$/`. El `+` se añade solo al *mostrar*. Móviles españoles = `346…`/`347…`.
- **Endpoint de Meta**: `https://graph.facebook.com/{WHATSAPP_API_VERSION}/{PHONE_ID}/messages`.
  La versión se lee del entorno (default `v23.0`), no está hardcodeada.
- **Idioma**: la **interfaz es bilingüe català/castellà** (sistema i18n propio en
  `src/lib/i18n.tsx`: `useT()`, diccionaris `ca`/`es`, **per defecte `ca`**, selector a la barra
  superior, preferència a `localStorage`). Els textos de la interfície viuen com a **claus**
  (p. ex. `nav.offers`, `f.email`); les etiquetes de camps del CRUD també (`crudCampos.ts` guarda
  claus `f.*`). Els **comentaris del codi** en castellà; els **missatges de WhatsApp**, en català
  (no passen per i18n). Identificadors en inglés salvo los del dominio (`productores`, `entidades`,
  `excedentes`, `canalizaciones`).
  ⚠️ **Un texto que cuenta cosas necesita su singular: `<clau>_1`** (15-09-2026). `t()` sirve esa
  variante cuando el parámetro **`n`** vale 1, y si no existe usa el plural de siempre — es opt-in,
  así que una clave nueva no obliga a escribir dos textos. Salió de leer la pantalla: el panel del
  productor decía «**1 entitats han mostrat interès**». Hoy la llevan cinco textos (`alb.days`,
  `alb.next_entregado_rec`/`_ent` y los dos `proc.*_publicada_gestio_passa`).
  ⚠️ **Solo mira `n`**, el contador principal: un texto con **varios** números que concuerden se
  **redacta para que no cante** en vez de multiplicar variantes — por eso
  `proc.e_publicada_gestio_passa` pasó de «{n} entitats · {m} interessades» a «Enviada a {n}
  entitats. Interès rebut: {m}.», donde `{m}` y `{k}` van tras dos puntos y no concuerdan con nada.
  Lo vigila `tests/i18n.test.ts`: la variante existe en los dos idiomas, su clave base existe, y no
  introduce ningún marcador que quien llama no pase.
  🔴 **Y una clave que se COMPONE a partir de un valor de la base hay que declararla en
  `tests/i18n.test.ts`** (22-09-2026). `cobertura.test.ts` recorre los literales `t('…')`, así
  que no ve un `t(\`od.ch_${fila.canal}\`)`, y ahí el diccionario se queda corto **en silencio**:
  la lista de valores no vive en el código sino en un CHECK de Postgres, o sea que el día que
  una migración añade uno, la pantalla pinta el identificador crudo y el build sigue en verde.
  Pasó: `oferta_respuestas.canal` ganó `asistido` en `20260921160749` y la cola de aprobaciones
  estuvo enseñando **`od.ch_asistido`** en las dos lenguas —siendo además el canal más
  frecuente, porque el modelo de la fase inicial es asistido—. El bloque «las claves compuestas
  cubren todo el vocabulario de la base» es el único sitio donde el diccionario y el dominio se
  comparan: **al ampliar uno de esos CHECK, ampliar también esa lista.**
- 🔴 **BORRAR UNA FICHA ES BORRAR TODO LO SUYO, Y NUNCA DEJAR HUÉRFANOS** (regla del
  16-09-2026, a petición del cliente). Da igual por dónde se pida —el botón de
  `RecordDetail`, una RPC, o SQL a mano desde una sesión de Claude Code—: al retirar un
  productor o una entidad **no puede quedar ni una fila apuntando a la ficha que ya no
  está**, ni una organización vacía, ni un objeto en Storage sin dueño. Y el borrado es
  **todo o nada**: media organización borrada es peor que ninguna.
  ⚠️ **La excepción que NO es negociable**: los documentos emitidos, los albaranes y los
  cierres **no se borran jamás** —`documentos_no_esborrar` lo impide por trigger y la
  numeración legal no puede tener huecos (§4)—. Así que una ficha con documentos emitidos
  **no se borra: se rechaza el borrado con el motivo**. «Cascada» significa arrastrar lo
  operativo (ofertas, respuestas, canalizaciones, ubicaciones, sesiones de intake,
  convenios, membresías, planes), nunca lo fiscal.
  ✅ **Lo cumple `borrar_ficha_completa()`** desde el 21-09-2026 (`20260921153439`), que es
  la **única** puerta: el panel y cualquier limpieza manual pasan por ella. Un `.delete()`
  suelto sobre `productores` o `entidades` vuelve a tener los tres comportamientos de
  antes, así que no se usa. Ver §4 «Borrado de una ficha» y §4bis.
- **Secretos**: nunca en el código. Env vars, siempre.
- 🔴 **Los módulos «hoja» de `_shared/` se IMPORTAN desde `src/`, no se copian** (27-10-2026).
  Un módulo hoja no usa `Deno.` ni importa nada que no sea otro módulo hoja (ni el cliente de
  Supabase, ni WhatsApp, ni Resend), así que el navegador lo puede cargar: el panel importa
  directamente `textAvis.ts`, `textOferta.ts`, `textRespostes.ts`, `textIntake.ts`,
  `textOfertaRegistrada.ts`… para enseñar y copiar EXACTAMENTE el texto que el servidor manda (R4
  del plan de gestión autónoma). La lista vive en `tests/puresa.test.ts`, que falla si un hoja
  importa algo de fuera o si `src/` importa de `supabase/functions/` un módulo que no está en ella.
  ⚠️ Cambia la convención anterior —copia en `src/lib` + test de paridad (`modalitats.ts`,
  `franja.ts`, `textosRgpd.ts`, `expedient.ts`)—: esas copias se quedan como están, pero lo nuevo
  se importa. Si un texto necesita un dato de la base, se le pasa por parámetro: no se mete red en
  un hoja.
- **Sin servicios externos nuevos** (10-09-2026). Cualquier capacidad nueva —generación de PDF, firma
  electrónica, almacenamiento de ficheros, colas, notificaciones— se resuelve con **librerías npm dentro
  del stack** (Edge Functions de Deno con `npm:`, React) y con lo que ya da Supabase (Storage, `pg_cron`,
  `pg_net`), nunca con un SaaS ni con un microservicio aparte. Los PDF se generan con `pdf-lib` en una
  Edge Function y van a Supabase Storage, en **una carpeta por organización** ordenada por ejercicio y
  tipo. Detalle en el plan de ejecución del sistema documental (§1).
- **Ejecución por fases con agentes** (10-09-2026). Los bloques de desarrollo del sistema documental
  se reparten entre los tres agentes de `.claude/agents/` —`dades` (migraciones, RPC, arnés),
  `servidor` (Edge Functions) e `interficie` (pantallas)— sobre **ficheros disjuntos del mismo árbol de
  trabajo**, sin worktrees ni ramas (se trabaja siempre en `main`). Los ficheros compartidos
  (`config.toml`, `src/types.ts`, `nav.ts`, `router`, `i18n.tsx`, `_shared/*.ts` salvo `pdf/`, este
  documento) los toca solo la sesión que orquesta. Todos en **Opus 5 a esfuerzo alto**.
- **`docs/` y `scripts/data/` nunca entran en git.** El primero es material de trabajo —incluye el
  **funcional de negocio** (`Documento funcional Redestina 2026.md` y `Documento funcional Redestina 2026 —
  adaptado.md`, resumidos en §1bis), `nuevas-funcionalidades/` y los siete documentos operativos
  de §1 (guía de producción de WhatsApp + su HTML visual, costes, flujo de la aplicación, la guía
  de prueba del ciclo y los dos
  de **usuarios, con contraseñas en claro**)—; el segundo son datos personales
  (teléfonos, emails y NIF de ~450 personas y entidades). `.env.local.example` sí se versiona: es la
  plantilla, sin valores.
  **`.claude/settings.local.json` tampoco**: lleva rutas de esta máquina (el
  `additionalDirectories` de la carpeta de consultoría, §1). Lo ignoraba solo el `~/.config/git/ignore`
  del usuario, que no viaja con el repo; desde el 10-09-2026 la regla está también en el `.gitignore`
  propio, para que un clon en otra máquina no lo suba sin querer. **Ni `.claude/launch.json`**, que
  lo genera el panel de navegador al arrancar `npm run dev` y fija el puerto de esta máquina.
- **Claves de Supabase**: usar las **nuevas** — `sb_publishable_...` en el frontend,
  `sb_secret_...` en el servidor. Los *roles* de Postgres `anon`/`authenticated`/`service_role`
  sí se siguen usando en RLS: **no confundir rol con clave**.
  ✅ **Y ya no es solo una convención: las claves legacy están DESHABILITADAS** en el proyecto
  desde el 14-09-2026. Antes existían y seguían siendo válidas —o sea que cualquiera con la
  `anon` antigua podía usarla— aunque este repo no las usara en ningún sitio. Ahora una
  petición con la `anon` legacy responde **401**, comprobado.
  ```bash
  TOKEN="$SUPABASE_ACCESS_TOKEN"   # dentro de la sesión temporal (§11)
  REF=uxppvaldhptdomvdhsmn
  curl -sS -H "Authorization: Bearer $TOKEN" \
    https://api.supabase.com/v1/projects/$REF/api-keys/legacy        # → {"enabled":false}
  # Reactivar (solo si algo externo las necesitara): ...?enabled=true
  ```
  ⚠️ **El `enabled` va como parámetro de query, no en el cuerpo**: `PUT …/api-keys/legacy`
  con `-d '{"enabled":false}'` responde `400 expected string, received undefined`. Con
  `?enabled=false` funciona. Cuesta diez minutos averiguarlo si no está escrito.
  ⚠️ **`SB_SECRET_KEY` y `SUPABASE_SERVICE_ROLE_KEY` tienen HOY el mismo valor**, y eso
  despista: no significa que el servidor use la legacy. La plataforma inyecta sola las
  variables `SUPABASE_*` en cada Edge Function y rellena `SUPABASE_SERVICE_ROLE_KEY` con la
  clave **secreta nueva**. Se confirma comparando el sha256 del valor local de `SB_SECRET_KEY`
  —que empieza por `sb_secret_`— con el hash que muestra `supabase secrets list`.
  **Comprobado el 14-09-2026 en los cinco sitios**: `.env.local` y `.env.local.example`
  (publishable nueva), `.secrets.env` (secret nueva), el secreto `SB_SECRET_KEY` del servidor
  (nueva), las quince Edge Functions (todas leen `SB_SECRET_KEY`; **cero** referencias a
  `ANON_KEY` o `SERVICE_ROLE_KEY` en `src/`, `scripts/` y `supabase/functions/`) y **el bundle
  servido en producción**, que lleva `sb_publishable_…` y ningún JWT. Ese último es el que de
  verdad cierra la pregunta: mirar la variable en Vercel dice qué está configurado, mirar el
  bundle dice qué se está ejecutando.
- **Errores**: `sendWhatsApp()` nunca lanza; devuelve `{ ok, status, data }`. El mapeo a texto
  legible vive en `noticeFromError()` (`Conversation.tsx`), que cubre los códigos propios
  (`window_closed`, `no_opt_in`, `unknown_contact`, `unauthorized`) y el `131047` de Meta.
- **El tipo de una fila se queda en el fichero que hace ese `select`**, y solo sube a `types.ts`
  una forma que usen dos o más. Quedan ~12 `interface` escritas a mano en pantallas, y no son
  duplicación: describen **la forma de un `.select()` concreto**, no una entidad del dominio. Un
  tipo centralizado que se desvíe del literal de columnas **miente sin fallar**, que es peor que la
  interfaz local.
- **La lista de columnas de un `.select()` va en UN literal**, nunca concatenada ni interpolada.
  supabase-js deduce el tipo de la fila analizando ese literal; ante una expresión devuelve
  `GenericStringError` y la fila se queda sin columnas, con lo que todo uso posterior deja de
  compilar. Si la lista es larga, que la línea sea larga (deuda §12.46).
- **Migraciones**: `supabase/migrations/AAAAMMDDHHMMSS_descripcion.sql`. Nunca editar una ya
  aplicada; añadir una nueva.
  ⚠️ **Si se aplica con `apply_migration` del MCP de Supabase (no `db push`), el timestamp que
  queda registrado en `supabase_migrations.schema_migrations` es el de la FECHA REAL en que se
  ejecuta** (`AAAAMMDDHHMMSS` de verdad), no el que lleve el nombre del fichero local —
  confirmado el 21-09-2026 con `20260921153439_borrar_ficha_completa.sql`. Este repo escribe
  sus migraciones con fechas «de proyecto» muy por delante del calendario real (iba por
  `20270328…`), así que el nombre local y la versión remota **discreparán** si no se corrige a
  mano: hay que renombrar el fichero local a la versión que devolvió el MCP en cuanto se aplica,
  o el repo y la base dejan de cuadrar (§ nota de memoria «acceso-supabase-por-mcp-no-por-cli»).
  🔴 **Y ese renombrado TIENE UN PRECIO, porque el timestamp no es solo un nombre: es el orden
  de aplicación.** Al traer una migración de una fecha de proyecto (`20270329…`) a su fecha real
  (`20260921…`) se la mueve **hacia atrás**, y puede quedar por delante de las tablas que usa.
  Pasó al renombrar las cinco de la vía asistida el 22-09-2026 (deuda 125): usan `enlaces_token`,
  `albaranes`, `convenios` y `cierres_donante`, creadas en `20260928…`-`20270111…`, así que en un
  entorno recreado desde cero se aplicarían antes de que existan. **Contra el remoto de hoy no
  pasa nada** —ya están aplicadas y `db push` las ve al día—, y es el mismo fallo latente que
  arrastra la FK `20260928100250` (§4). **Lo que evita el dilema es no llegar a él**: al aplicar
  por MCP, renombrar **en el acto**, cuando la migración todavía es la última y su fecha real
  sigue siendo mayor que todo lo demás.
  ✅ **Y hay una segunda salida, que es la que se usó el 22-09-2026 y funciona mejor**: dejar el
  fichero local con su fecha de proyecto y **corregir la versión registrada en remoto** con un
  `update supabase_migrations.schema_migrations set version = '<la del fichero>'`. Es metadata
  del historial, no esquema —la migración ya está aplicada y su DDL no se toca—, y ya se había
  tocado esa tabla al cerrar la deuda §12.118. Lo que compra es el orden: las cuatro de
  `20270329…` usan `convenios` (`20270111100000`) y `documentos_externos` (`20261012100400`), así
  que con su fecha real (`20260922…`) habrían quedado **por debajo de las tablas que necesitan** y
  una recreación desde cero fallaría. Al renombrar hacia adelante, no.
  ⚠️ **El fichero local y el historial remoto tienen que casar 1:1.** Si una migración se aplica
  partida en varias llamadas —como pasó ese día, porque el clasificador de permisos cortó la que
  llevaba `drop constraint` y hubo que trocearla— el fichero local **se parte igual**, con el
  mismo número de trozos y el mismo orden.
  ✅ **Y el CLI NO está roto: lo que le faltaba era un `HOME` escribible** (21-09-2026). Dentro
  del sandbox de una sesión de Claude Code, `supabase` muere con
  `EPERM … /Users/<tu>/.supabase/telemetry.json.tmp` **antes de hacer nada**, y eso se leyó
  durante días como «el CLI está bloqueado, hay que ir por el MCP». No lo está: el fallo es que
  no puede escribir su fichero de telemetría. Con un HOME temporal y el token en
  `SUPABASE_ACCESS_TOKEN` funciona entero —`functions list`, `functions deploy`, `migration list`—:
  ```bash
  mkdir -p "$TMPDIR/sbhome"
  HOME="$TMPDIR/sbhome" supabase functions deploy <funcio>   # con SUPABASE_ACCESS_TOKEN ya exportado
  ```
  🔁 **Desde el 06-10-2026 el token ya no sale del llavero** (§11, «Despliegues con token
  temporal»): el usuario lo pega en una sesión de terminal suya y los comandos autenticados se
  ejecutan **en esa terminal**, que no tiene sandbox. Este rodeo del HOME queda solo como
  explicación del `EPERM`, por si vuelve a salir.
  ⚠️ Hace falta además **declarar `api.supabase.com` en los dominios permitidos** del comando:
  el sandbox filtra la salida de red y la denegación se lee como `403 Connection blocked by
  network allowlist`, que parece un problema de permisos de la cuenta y no lo es.
  ⚠️ El token va por `SUPABASE_ACCESS_TOKEN` porque el login del CLI vive en `~/.supabase`, que
  es justo lo que el HOME nuevo deja de ver.
  🔴 **Pero esto NO alcanza a `db push`, y la diferencia importa**: `functions deploy` habla por
  HTTPS con `api.supabase.com` y pasa por el proxy del sandbox; `db push` abre una **conexión
  Postgres directa** al pooler (`aws-0-eu-west-1.pooler.supabase.com:5432`), que no va por el
  proxy y ni siquiera resuelve — falla con `getaddrinfo ENOTFOUND`, que parece un problema de
  DNS y es el sandbox. O sea: **las Edge Functions se publican con el CLI, las migraciones
  siguen yendo por `apply_migration` del MCP**, con el renombrado que eso obliga. **Esto importa para las Edge Functions**: son la única capa que
  el MCP no puede publicar cómodamente —habría que pasarle a mano cada fichero de `_shared/`,
  incluido el `activos/incrustats.ts` con las fuentes en base64—, así que sin este rodeo no hay
  forma de desplegarlas desde una sesión con sandbox.
- **En git solo existen `main` y `staging` (norma del 07-10-2026).** `main` es donde se trabaja y
  lo que publica Vercel; `staging`, si existe, se conserva. Cualquier otra rama sobra: antes de
  borrarla se comprueba con `git log origin/main..origin/<rama>` que no le falte nada a `main`, y se
  borra en local y en remoto. Al publicar no se crea ninguna. Comprobado el 07-10-2026: en GitHub
  solo había `main` (`reunio-sebastian-2026-10` ya estaba borrada).
- **Una sola rama en Supabase, siempre `main` (norma del 14-09-2026).** No se crean ramas en
  el proyecto remoto: ni de preview, ni persistentes, ni para probar una migración. Todo el
  esquema vive en la base de producción y se llega a ella por `db push`, igual que el código
  vive en `main` y se llega por push. **Si aparece una rama de preview, se integra en `main` y
  se borra del proyecto de Supabase.**
  ✅ **Y ya no puede aparecer sola: el branching está DESACTIVADO** desde el 14-09-2026
  (`supabase branches disable`). Hasta ese día el proyecto lo tenía conectado a GitHub, y eso
  hacía dos cosas: desplegar las quince funciones en cada push (§12.44) y —el motivo de
  apagarlo— **crear una rama de preview, con su propia base de datos, al abrir un PR**. Se
  apagó a propósito, aceptando el coste: **el despliegue de funciones pasa a ser siempre
  manual** (§11 y paso 4 de `/publicar`).
  ```bash
  TOKEN="$SUPABASE_ACCESS_TOKEN"   # dentro de la sesión temporal (§11)
  curl -sS -H "Authorization: Bearer $TOKEN" \
    https://api.supabase.com/v1/projects/uxppvaldhptdomvdhsmn/branches
  # Correcto hoy: []  (lista vacía = branching desactivado)
  ```
  ⚠️ **Si algún día vuelve a listar algo, hay que saber leerlo.** Una entrada con
  `is_default: true` y **`project_ref` igual a `parent_project_ref`** *es* el proyecto de
  producción, no una copia: eso significa que alguien ha vuelto a activar el branching, y se
  desactiva otra vez. Una entrada con **otro `project_ref`** es una rama de preview de verdad
  —**otra base de datos**, y además un proyecto aparte en la cuenta—: esa se integra en `main`
  y se borra. Verificado tras desactivar: la lista quedó vacía, el proyecto sigue
  `ACTIVE_HEALTHY`, la base responde y las quince funciones siguen `ACTIVE`.
- **Producción y el clon local (07-10-2026)**. Producción es la base de verdad y la primera
  donde se aplica de verdad una migración (con `scripts/aplicar-migracion.ts`, §11), así que el
  SQL tiene que ser revisable e idempotente. Lo nuevo es que **antes** se puede probar en el
  **clon local** (§11, «El clon local»): `supabase/config.toml` vuelve a tener las secciones del
  stack local (puertos 553xx, Auth como producción, sin analítica) y todo lo que crea Docker
  lleva «Redestina» en el nombre (`project_id`). Entre el 14-09 y el 07-10-2026 no hubo stack
  local: se retiró aquel día y se recuperó como clon de producción.
  🔴 **Las migraciones (148 el 07-10-2026 por la mañana, 160 tras la revisión completa) reconstruyen producción desde cero** desde el 07-10-2026 (deuda 125,
  cerrada): las 22 que llevaban la fecha real del 21/22-09 se renumeraron a
  `20270328100100`…`102200` —el sitio en que producción las aplicó de verdad, según git— en el
  repo **y** en el historial de producción a la vez (`scripts/historial-migraciones.ts`).
  ⚠️ **Al aplicar una migración, su número es el del fichero, siempre**: `aplicar-migracion.ts`
  lo registra así. Lo que obligó a renumerar fue `apply_migration` del MCP, que registra la
  fecha real; no se vuelve a usar para migraciones.

