# AGENTS.md §2 — 2. Stack

> Detalle de la sección 2 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §2» del código apuntan aquí.

## 2. Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Vite 7 + React 19 + TypeScript 5.9 (`strict`) + **Tailwind v4 + shadcn/ui** + **react-router v7** |
| Datos / Realtime | Supabase (`@supabase/supabase-js` v2) |
| Backend | Edge Functions de Supabase (Deno / TypeScript) |
| Email | **Resend** (API HTTP, vía Edge Function `enviar-email`) |
| BD | Postgres (Supabase) con RLS |
| Scripts | Deno 2.x (`scripts/import-ara.ts`) |
| Hosting frontend | Vercel (proyecto `redestina`) |

> ⚠️ **La base de verdad es la remota; el clon local es una copia.** Producción manda: las
> migraciones se aplican allí (§11) y `npm run dev` apunta allí con `.env.local`. Desde el
> 07-10-2026 hay además un **clon local completo en Docker** —esquema, datos, cuentas, ficheros,
> Edge Functions y jobs— para desarrollar sin tocar producción: `npm run dev:local`, la skill
> `supabase-local` y `scripts/local/` (§11, «El clon local»). Entre el 14-09 y el 07-10-2026 el
> proyecto no tuvo stack local; lo que §4, §7 y §13 cuentan de esas fechas es histórico.

**Con router** (`react-router` v7, desde 2026-07-30: los paneles por rol necesitan URL propia,
enlace profundo y gesto «atrás»; el `useState<View>` anterior no daba ninguna de las tres) y sin
librería de estado. Desde el 31-07-2026 el router es además la **capa raíz**, con rutas públicas y
privadas (§6quater): ya no hay un `AuthGate` envolviéndolo todo. `vercel.json` añade el *rewrite* de SPA: sin él, recargar cualquier ruta que no
sea `/` devuelve 404 en producción. **UI con Tailwind v4 + shadcn/ui**: componentes en
`src/components/ui/` (generados con el CLI de shadcn, `components.json`), tokens del **sistema de
diseño REDESTINA** en `src/index.css` (verde `#4e6b45` / coral `#ef7d77` / crema `#f5f1ea`, Sora para
títulos e Inter para el cuerpo; la fuente de verdad es `design/tokens.json`, §2bis), alias `@/` →
`src/`. Iconos `lucide-react`, toasts `sonner`, `cn()` en `src/lib/utils.ts`. El logo en sus seis
variantes, el favicon y los iconos están en `public/` (§2bis).

⚠️ **La barra inferior de móvil admite CUATRO entradas, no cinco, y va al límite.** Reparte el
ancho a partes iguales con `flex-1`, así que a 360 px cada celda da ~90 px y las etiquetas de este
proyecto piden 66-112 px —son largas a propósito: `nav.ts` las elige únicas entre paneles para que
los tooltips del menú plegado no se repitan (§2bis, `text-nav`)—. Medido: con cuatro entradas la
barra pide **exactamente 360 px** en los dos paneles; con cinco pedía **393** y desbordaba.
Consecuencias: una entrada que no quepa se marca **`barra: false`** en `NavItem` y se queda solo en
el menú lateral (hoy, «Nova oferta» en productor —cabe dentro de Inici— e
«Històric» en receptor); y **cualquier etiqueta nueva o traducción más larga rompe la barra**, así
que al añadir una hay que medirla, no estimarla.
⚠️ **Cuando no cabe, etiqueta corta solo para la barra: `labelBarraKey`** (11-10-2026). «Excedents
disponibles» (el Mercat, revisión del cliente del 08-10-2026) mide ~118 px en catalán y ~125 en
castellano con Inter a 11 px, y a 360 px cada una de las tres celdas del receptor da 116: en la
barra dice «Excedents» (`nav.market_barra`) y el menú lateral y el título conservan el nombre
completo. Medido con la fuente del repo (`generar-documento/activos/Inter-*.ttf`, `pdf-lib`).
`tests/cobertura.test.ts` vigila que esas claves existan.

✅ **Y por debajo de 360 px ya no rompe: lo arregla `min-w-0`** (14-09-2026). Este párrafo decía que
«`truncate` **no** lo arregla», y solo era cierto a medias: el `truncate` estaba puesto desde el
principio y **no llegaba a actuar**, porque el `li` es `flex-1` con `min-width: auto` y un flex item
así no encoge por debajo de su contenido. O sea que el diagnóstico era correcto y la conclusión no:
lo que faltaba era `min-w-0` en el `li`, que es justo lo que desbloquea el recorte. Medido a 320 px
en català con Playwright sobre la aplicación desplegada: el panel del productor pedía **347 px** y el
del receptor **334**, y la última pestaña salía **cortada contra el borde** de la pantalla; con
`min-w-0` los dos piden **320**, las cuatro celdas miden exactamente un cuarto y lo que sobra se
recorta con puntos suspensivos, alineado («Els meus i…»). A 360 y 390 px no se recorta nada.
⚠️ Lo del productor era **anterior** a cualquier cambio de etiqueta —no lo había medido nadie a
320 px, porque la auditoría de 2026-08-01 midió el desbordamiento de la PÁGINA, que era y sigue
siendo 0: el `ul` se pasaba de ancho sin que el documento scrolleara—. Al medir una barra, mirar
`nav ul` (`scrollWidth` vs `clientWidth`), no solo `document.documentElement`.

**Layout** (desde 2026-07-30): **menú lateral vertical plegable** (`sidebar` de shadcn: 16rem ↔ 3rem
en modo icono, estado en cookie, atajo Ctrl/Cmd+B) + barra superior de 14 con el título de la
sección y el menú de la persona (idioma, ficha y salir). Desde el 14-09-2026 el menú lateral
tiene **pie con «Sortir»**: es la única acción duplicada a propósito, porque cruzar la pantalla
hasta el avatar para cerrar sesión es incómodo. Y su cabecera enseña **solo el logo** cuando la
cuenta tiene varios paneles: el nombre al lado repetía lo que ya dice el logo. Con un único
panel sigue saliendo el nombre de la organización, que ahí sí informa. En móvil el menú se abre como panel deslizante y,
**solo en los paneles de productor y receptor**, hay además **barra inferior** con sus 3-4 secciones
(el equipo tiene siete, no caben). La barra inferior es hermana flex `shrink-0`, no `fixed`: así
ninguna pantalla necesita padding inferior y el composer del chat nunca queda debajo.

⚠️ **Contrato de alturas**: el shell es una columna flex `h-dvh overflow-hidden`; `main` es
`min-h-0 flex-1` y scrollea él, salvo en las rutas marcadas `fullBleed` (Mensajería), que gestionan
su propio alto. **Ninguna pantalla vuelve a escribir `h-dvh`.**

🔴 **Y `main` lleva `scrollbar-gutter: stable`, que es lo que impide que la pantalla salte al
navegar** (16-09-2026). Como `main` es quien scrollea, su barra aparece en las pantallas altas y
no en las cortas; con el contenido centrado (`mx-auto`), cada aparición lo desplazaba unos 7 px y
al cambiar de sección volvía — «un movimiento no deseado», dicho por el cliente. Reservando el
hueco siempre, el ancho útil no cambia nunca.
⚠️ Va en `main` y **no en `html`**: el documento no scrollea, así que arriba no reservaría nada.
⚠️ **La barra lateral NUNCA se movió**: es `fixed inset-y-0 left-0` desde `md` (`ui/sidebar.tsx`).
Lo que se movía era el contenido, y desde fuera se lee igual.
⚠️ La otra mitad del salto era el **alto**: una ruta recién montada pedía sus datos y pintaba una
línea de «Carregant…», así que la página se desplomaba y la barra desaparecía. Lo arreglan
`min-h-full` en el contenedor y **`components/CarregantSeccio`**, un esqueleto con alto de verdad.
**No es un spinner a propósito**: un spinner no ocupa alto, así que no arregla el salto, solo lo
adorna. Hay un tercer flag de layout en el
`RouteHandle`, **`ample`** (no confundir con `fullBleed`): cambia el contenedor de `main` de
`max-w-6xl px-4` a `w-[96%] px-2` y lo llevan los tres listados del equipo (`productors`, `entitats`,
`ofertes`), que necesitan más ancho.

**PWA instalable, SIN service worker desde el 29-09-2026** (`vite-plugin-pwa` con
`selfDestroying: true`): manifest, iconos 192/512 + *maskable* (generados desde
`public/isotipo-redestina.svg`, la hoja sola; §2bis), `apple-touch-icon` y los metas de iOS —que no
lee el manifest—, `viewport-fit=cover` para que `env(safe-area-inset-*)` valga algo en iPhone.
🔴 **Por qué se retiró el service worker**: era la razón de que **el cliente no viera los
despliegues**, y no Vercel (que invalida su CDN en cada despliegue; los assets llevan hash e
`index.html` va con `must-revalidate`). El de antes del 28-09 guardaba `index.html` y el bundle en
el móvil y los servía **sin pasar por la red** —así que tampoco por la cortina (§9)—; el `sw.js`
nuevo sí llegaba, pero su precache pedía `/assets/*.js` **sin la cookie de la cortina**, recibía
401, la instalación fallaba y el viejo seguía mandando para siempre. Reproducido en el navegador el
29-09-2026. Ahora el `sw.js` publicado (libre de cortina, `esLliure()`) no descarga nada: se
instala, se da de baja, borra las cachés y recarga las pestañas; y `main.tsx` retira además
cualquier registro que quede (`retiraServiceWorkers()`). Sin red la aplicación no abre, igual que
desde el 28-09. ⚠️ **No volver a poner un service worker con precache mientras exista la cortina.**

**Versión nueva con la pestaña abierta** (`src/lib/versio.ts` + `hooks/useVersioNova.ts`, en
`ArrelApp`). Cada build compila su identificador (`__VERSIO__`, el SHA del commit en Vercel) y lo
publica en **`/version.json`** (`Cache-Control: no-store` en `vercel.json`). Se compara al abrir,
al volver a la pestaña y cada 5 minutos; si difiere, sale un aviso con «Actualitza» y **la página
se recarga sola al siguiente cambio de pantalla**, que es el primer momento en que no hay un
formulario a medias que perder. Con la cookie de la cortina caducada, `version.json` da 401 y no
se avisa de nada. **No hay que hacer nada en cada despliegue**: es automático.

**Aviso de instalación** (2026-08-01, `src/hooks/useInstalacio.ts` + `src/components/AvisInstallacio.tsx`).
La aplicación era instalable desde el principio, pero la opción vivía en un menú del navegador que
nadie abre. Ahora se ofrece **solo a productores y receptores en móvil** (`rolActiu !== 'intern'` +
`md:hidden`); el equipo trabaja desde el escritorio. **Dos caminos que no son intercambiables**:
Android/Chrome dispara `beforeinstallprompt` y se puede abrir el diálogo real del sistema; **iOS no lo
dispara y no lo hará**, así que ahí se explican los dos pasos de Compartir → «Afegir a pantalla
d'inici» — sin esa rama ningún iPhone vería nunca el aviso. ⚠️ El evento es **de un solo uso y llega
antes del primer render**, por eso lo captura `escoltaInstalacio()` desde `main.tsx` **antes de montar
React** y lo guarda en estado de módulo; escucharlo dentro de un componente llega tarde y el aviso no
saldría nunca. El banner es **hermano flex `shrink-0`, no `fixed`** —mismo contrato de alturas que la
barra inferior—, así que resta alto al `main` y no tapa nada. Quien lo descarta no lo vuelve a ver en
**30 días**: `redestina-install-descartat` guarda la **fecha**, no un booleano, porque un booleano no sabe
expresar eso.
🔴 **Desde el 29-09-2026 «móvil» es el DISPOSITIVO, no el ancho** (`esDispositiuMobil()`: iOS,
Android/`Mobi`, o `pointer: coarse` + `hover: none`), y **en escritorio no se enlaza el manifest**:
vive en `public/manifest.webmanifest` (el plugin tiene `manifest: false`) y lo añade
`escoltaInstalacio()` solo en móvil. Con el `<link rel="manifest">` en el HTML, Chrome de
escritorio pintaba su propio icono de instalar en la barra de direcciones, que no es nuestro y que
`md:hidden` no podía esconder.

**Responsive** (breakpoint `md`, 768px). Los **listados** van
en tabla con `overflow-x-auto` (scroll horizontal en móvil); los **detalles/CRUD** usan grids
`sm:grid-cols-2`. La **mensajería** usa patrón **lista↔conversación**: en móvil la lista ocupa toda
la pantalla y, al elegir un contacto, la conversación pasa a pantalla completa con botón «atrás»
(`Conversation` recibe `onBack`); en escritorio conviven las dos columnas. La mensajería **ya no
escribe `h-dvh` propio** (era texto residual de la arquitectura anterior, contradecía el contrato de
alturas de arriba): su alto lo aporta el shell porque su ruta va marcada `fullBleed` (§6ter).

**Siete reglas de móvil que se comprobaron midiendo, no leyendo** (2026-08-01; auditoría con
Playwright a 320/360/390 px sobre las 11 rutas, públicas y privadas — **0 px de desbordamiento
horizontal en todas**, que es la referencia a mantener; las reglas 4 y 5 salieron después, y las
dos con la página en esos mismos 0 px):

1. ⚠️ **Ningún control de formulario por debajo de 16 px en móvil.** iOS Safari amplía la página al
   enfocar un campo con `font-size < 16px` y, como el viewport renuncia a `maximum-scale` a propósito
   (accesibilidad), **no deshace el zoom al salir**. `Input`/`Textarea` de shadcn ya traen
   `text-base md:text-sm`; los `<select>` nativos de `NovaOferta` no, y tocar el primer desplegable
   dejaba los 13 campos restantes ampliados y desplazándose en horizontal. **Cualquier control
   estilado a mano tiene que repetir ese `text-base md:text-sm`.**
2. **`whitespace-nowrap` viene de serie en `Button`.** Una etiqueta larga dentro de un botón fija un
   ancho mínimo que se **propaga hacia arriba por los grids** y termina desplazando la página entera
   (pasó en `/login`: 47 px a 320 px de ancho). Si el texto de un botón puede crecer, `whitespace-normal`.
   🔴 **Y `shrink-0` TAMBIÉN viene de serie** (`ui/button.tsx:8`), así que
   **`whitespace-normal` solo NO BASTA**: el botón conserva su ancho preferido
   (`max-content`) y no se deja encoger, aunque el texto ya pueda partirse. Medido el
   22-09-2026 en `DocumentacioOrganitzacio`: «Registra un conveni signat en paper» pedía
   **264 px dentro de un contenedor de 238** y se salía de la tarjeta **con la página a 0 px
   de desbordamiento**. Lo que lo arregla es un **ancho explícito**, que sí manda sobre el
   preferido: `w-full sm:w-auto`. Es el mismo mecanismo de la regla 4 visto por el otro
   lado —allí `shrink-0` aplasta al texto vecino, aquí se sale el botón—, y la lección
   común es que **`scrollWidth` de la página no lo ve ninguno de los dos**.
3. **`env(safe-area-inset-left/right)` importa en horizontal.** `viewport-fit=cover` lleva el
   contenido hasta el borde físico; sin el `env()` lateral, en iPhone con muesca el contenido queda
   bajo el recorte. Se aplica con `max(padding, env(...))` en `AppShell` y `LayoutAcces`; la barra
   inferior ya cubría el `bottom`.
4. 🔴 **`shrink-0` en un botón anula el `whitespace-normal` que tiene al lado, y eso NO desborda:
   aplasta.** Medido el 22-09-2026 en el navegador (§12.117). `AvisDiagnostic` es una fila de cuatro
   elementos —icono, texto, botón, aspa de descarte— y el botón llevaba `shrink-0` *y*
   `whitespace-normal`: lo segundo no sirve de nada, porque `shrink-0` fija su **ancho preferido**
   (`max-content`, 136 px) y no lo deja encoger, así que todo el recorte se lo comía el `min-w-0`
   del párrafo. A 320 px al texto le quedaban **50 px y 16 líneas** —una palabra por línea—, a 360
   px 90 px y 11 líneas, y a 390 px 120 px y 8 líneas; `AvisConveni`, con tres elementos, 120 px y
   8 líneas a 320. **La página seguía en 0 px de desbordamiento**, que es exactamente por qué la
   auditoría de 2026-08-01 no lo habría encontrado: medía `scrollWidth`, y esto no desborda, se
   estrecha. Es el mismo mecanismo que el `li` de la barra inferior —donde `truncate` estaba
   puesto y tampoco llegaba a actuar— visto por el otro lado.
   **Lo que lo arregla**: que en móvil el botón ocupe su propia línea. Contenedor `flex-wrap` con
   `gap-x-*` y `gap-y-*`, párrafo `min-w-0 flex-1`, y el botón
   `order-1 w-full sm:order-none sm:ml-auto sm:w-auto` — `w-full` fuerza el salto, `order-1` lo
   deja debajo del aspa (que se queda arriba a la derecha, donde se espera un descarte), y desde
   `sm` todo vuelve a la fila de siempre, verificado sin cambio de anchos en escritorio. Resultado
   a 320 px: 226 px y 4 líneas en el convenio, 198 px y 4 en el diagnóstico.
   ⚠️ **Volvió a pasar en las tarjetas del Mercat** (28-09-2026): con la foto de 64 px y
   «M'interessa» en la misma fila, a 375 px al nombre le quedaban 69 px y «Carbassó» se salía
   4 px. Mismo arreglo (`w-full sm:w-auto` en el botón, la fila ya era `flex-wrap`): 170-191 px.
   ⚠️ **Corolario**: una fila con texto y botón **no se audita con `scrollWidth`**. Hay que mirar
   el ancho que le queda al párrafo, o mirarla.
   ⚠️ **Y `flex-1` a secas tampoco salva un `flex-wrap`** (17-10-2026, cola de intereses de
   Aprovacions): `flex-1` es `flex: 1 1 0%`, así que para decidir el salto de línea el texto
   cuenta como **0 px** y nunca obliga a bajar a los controles. A 1360 px con el menú abierto,
   los campos y botones (~944 px, que no encogen) dejaban al texto **25 px y 400 px de alto**,
   una palabra por línea. Lo que lo arregla es una **base mínima** en el bloque de texto
   (`min-w-0 flex-1 basis-80`): si texto y controles no caben juntos, los controles bajan a su
   propia línea (texto a 981 px, 2 líneas), y en móvil `min-w-0` lo deja encoger sin desbordar.
5. 🔴 **`grid ... sm:grid-cols-2` SIN `grid-cols-1` deja la columna de móvil en `auto`, y la
   dimensiona el contenido más ancho** (22-09-2026). Sin el breakpoint, `grid` a secas no
   declara ninguna plantilla de columnas, así que la única columna es `auto` —o sea
   `max-content`— y basta un control con ancho intrínseco grande para llevarse toda la
   rejilla por delante. El que lo dispara en este proyecto es **`input[type=file]`**, por el
   botón que pinta el navegador: medido en `DialegConveniPaper` a 320 px, **las siete celdas
   pedían 254 px dentro de 202** y el formulario se salía del diálogo. `grid-cols-1` genera
   `repeat(1, minmax(0, 1fr))`, que sí se deja encoger, y por eso va **explícito** aunque
   parezca redundante. Vale para cualquier rejilla de formulario, no solo para las que
   llevan un fichero: el día que a una celda le entre un texto largo, pasa lo mismo.
   ✅ **Y la portada pública la incumplía**, en «Per a qui és» y en «Com funciona»: a 320 px
   la rejilla se salía y la página se desplazaba de lado (28-09-2026). Ya lleva `grid-cols-1`.
   ⚠️ **Otra vez con la página a 0 px de desbordamiento.** Es el tercer defecto seguido que
   `scrollWidth` del documento no ve: lo que hay que mirar es `scrollWidth > clientWidth`
   **en los hijos**, que es la comprobación que encontró los tres.

6. 🔴 **Una celda de tabla de shadcn hereda `whitespace-nowrap`**, así que un `max-w-*` o un
   `break-all` dentro de ella NO parten el texto: el texto se sale de la celda y se pinta
   **encima de la columna siguiente** (28-09-2026: el «qué toca» del cierre, los correos de los
   listados de productoras y receptoras). Lo que lo arregla es `whitespace-normal` en la celda
   o en el bloque, y un `min-w-*` cuando el contenido no se puede partir (un botón con un
   número de documento). ⚠️ Tampoco se ve con `scrollWidth` de la página: la tabla vive en un
   `overflow-x-auto`.
7. 🔴 **La cabecera de la portada pública desbordaba desde que se rehízo el 16-09**: logo de
   136 px más idioma, «Entrar» y «Registra’t» pedían 403 px, y a 375 toda la página se
   desplazaba de lado. En móvil el logo, los márgenes y los botones encogen, y por debajo de
   360 px el selector de idioma pierde el icono; cabe desde 320. Medido el 28-09-2026.


## Criterio de las tablas (03-11-2026)

Pedido por Carles: **todas las tablas responsive sin scroll horizontal, acciones en iconos que
dicen qué hacen al pasar por encima y títulos de columna centrados.** Primero **Productes**
(`routes/equip/Productes.tsx`, publicada en `171483f` y aprobada por Carles); el mismo día, **todas
las demás** (25 tablas en 18 ficheros: Entitats, Ofertes, Canalització, Espigolades, Albarans y su
detalle, Documents, Convenis y Campanya, Tancament y su detalle, Diagnòstics, Plans, el expediente
y las listas de documentos, convenios y albaranes de los paneles externos). Cómo se hace:

- **La base (`components/ui/table.tsx`) ya trae el criterio**: `TableHead` con `text-center
  whitespace-normal` y `TableCell` con `whitespace-normal wrap-anywhere` y los badges de shadcn
  (`[data-slot=badge]`) también partiendo. `wrap-anywhere` y no `break-words`: en una tabla de
  ancho automático solo `overflow-wrap: anywhere` deja encoger la columna por debajo de un código
  largo sin espacios (`E-E2E-PA-Car-1793652249346-A` desbordaba Canalització 21 px); parte solo
  si no cabe. Un badge de 133 px («Sense cost per quilo») desbordaba el detalle del cierre 28 px.
  Por eso un `TableHead` ya **no lleva** `text-right`/`text-left`, y `whitespace-nowrap` solo va
  donde partir rompe (un importe con su unidad).

- **Qué columnas quedan en móvil**: solo lo que identifica la fila, la cifra que importa y las
  acciones. Lo secundario va **debajo del nombre**, en `text-xs text-muted-foreground` (la familia
  del producto), o se esconde por ancho con `hidden md:table-cell` / `xl:table-cell` (fecha,
  motivo) **en la cabecera y en la celda a la vez**. El detalle sigue a un clic (nombre enlazado).
- **Títulos**: `text-center whitespace-normal` en cada `TableHead` (que parta un título largo en
  dos líneas en vez de ensanchar la columna). Cifras, fechas y acciones centradas; textos a la
  izquierda.
- **Acciones**: `components/BotoIcona.tsx` (icono `lucide-react`, `etiqueta` = tooltip y
  `aria-label`, `motiu` cuando está gris, 44 px en móvil y 32 desde `md`). En móvil las acciones
  se apilan (`flex-col md:flex-row`) para que la columna mida un icono. Solo acciones con icono
  inequívoco: en táctil no hay tooltip. Borrar va en `text-destructive`.
- **Editar en línea**: una segunda fila debajo con el formulario, nunca inputs repartidos por las
  celdas (con columnas escondidas, la mitad desaparecería). Su `colSpan` tiene que ser el número
  de columnas **visibles**: uno mayor crea columnas fantasma que se comen el ancho (visto con
  `table-fixed` y sin él). `hooks/usePuntTall.ts` da los puntos de corte de Tailwind por
  `matchMedia`.
- **Medir**: a 360 px, `scrollWidth > clientWidth` en todos los hijos de `main` (solo los `sr-only`
  pueden salir, son de 1 px). Productes: 0 desbordamientos, tres columnas visibles en móvil.
  Las barras de pestañas (`-mx-1 overflow-x-auto`, Ofertes y Albarans) scrollean de lado a
  propósito: no son tablas. Medido el 03-11-2026 en el clon: 0 en los 13 listados y detalles con
  datos, a 360, 1024 y 1440 px.
- **Iconos, los mismos en toda la aplicación**: abrir/detalle `Eye`, editar `Pencil`, fijar
  `CirclePlus`, borrar `Trash2` (rojo), ver PDF `FileText`, descargar `Download`, correo `Mail`,
  WhatsApp `MessageCircle`, aprobar `Check`, emitir certificado `FileCheck`, rectificar
  `RotateCcw`, firmar `PenLine`, marcar enviado `MailCheck`, generando `Loader2` girando. La
  etiqueta dice la acción entera («Obre l’albarà», «Envia un correu»): es el nombre accesible, y
  las E2E buscan por él (`getByRole('button', {name})`). En castellano, infinitivo («Abrir…»).
- **Lo que no se convierte**: las acciones de cabecera o de bloque (Nova…, calcular, emitir
  todos, enviar la tanda, filtros). Solo las de cada fila.
