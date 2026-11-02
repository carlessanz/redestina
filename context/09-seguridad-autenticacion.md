# AGENTS.md §9 — 9. Seguridad y autenticación

> Detalle de la sección 9 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §9» del código apuntan aquí.

## 9. Seguridad y autenticación

### 🔴 La cortina: una contraseña delante de TODA la web (28-09-2026)

A petición del cliente, mientras Redestina esté en pruebas nadie que no tenga la contraseña ve
ni una página ni un fichero: ni la portada, ni `/login`, ni el bundle de JavaScript. Pantalla
verde con el logo y un campo de contraseña; acertarla deja una cookie **`redestina_cortina`**
de **7 días** (`HttpOnly; Secure; SameSite=Lax`).

- **La comprueba el SERVIDOR**, con Vercel Routing Middleware (`middleware.js` en la raíz, que
  delega en `cortina/cortina.ts`, puro y con 12 pruebas en `tests/cortina.test.ts`). Una
  contraseña comprobada en el navegador viajaría dentro del bundle; y así el bundle —que con
  `VITE_ACCESSOS_TEST` lleva las contraseñas de las cuentas de prueba— tampoco se sirve.
- **La contraseña no está en git**: solo `HASH_TOKEN` = SHA-256 del token, y el token es
  PBKDF2-SHA256 (100.000 vueltas) de la contraseña. Con el repo no se fabrica la cookie.
  **Para cambiarla**: `node scripts/cortina-hash.mjs 'nova'`, sustituir `HASH_TOKEN` y
  publicar; todas las cookies anteriores dejan de valer al momento. La contraseña vigente la
  tiene el cliente (no se escribe en ningún fichero del repo ni de la consultoría).
- **Se sirven sin cortina solo cinco cosas sin datos** (`esLliure()`): `logo-email.png` (los
  correos lo pintan desde la bandeja), `segell-redestina*.svg` (el sello vive en webs de
  terceros), `favicon.svg`, `sw.js` y `workbox-*.js`.
- **Un idioma cada vez, catalán por defecto**, con un selector CA/ES arriba a la derecha
  (`?idioma=es`, recordado en la cookie `redestina_idioma`, un año). La pantalla es una
  tarjeta blanca sobre el verde de marca, con el logo en negativo, «Mostra» para ver lo que
  se escribe y el aviso de la semana. Al elegir idioma escribe también `redestina-lang` en
  `localStorage`, así que la aplicación abre luego en ese mismo idioma.
- **`/__cortina/surt` borra la cookie** y vuelve a enseñar la cortina. Existe para probarla:
  el navegador integrado de la aplicación es compartido, y una prueba con la contraseña buena
  dejó la cookie de una semana al cliente, que «entró sin contraseña» (28-09-2026). Tras
  probar con la buena, pasar por esa ruta.
- **Una navegación ve la cortina con 401**; un script o una imagen, un 401 seco. `robots`
  `noindex`.
- 🔴 **Y desde el 29-09-2026 ya no hay service worker** (§2): se autodestruye. Lo de abajo
  explica el paso intermedio.
- 🔴 **El service worker ya NO guarda `index.html` ni tiene `navigateFallback`**
  (`vite.config.ts`): con la página en su caché, un móvil que ya hubiera entrado abriría la
  aplicación sin pasar por el servidor, o sea sin cortina, también pasada la semana. `sw.js`
  queda libre justamente para que los móviles con el service worker viejo se actualicen.
- ⚠️ **Consecuencias que hay que saber**: los enlaces que llegan por correo —acceso, cambio de
  contraseña, firma de convenio, confirmación de albarán, factura— y la página `/verificar` del
  sello **piden primero la contraseña**. Es lo que se pidió («que nadie pueda entrar»); para
  abrirlos a terceros habrá que retirar la cortina o eximir esas rutas.
- **En `npm run dev` también sale**: el plugin `cortinaDev()` de `vite.config.ts` engancha la
  misma `gestiona()` al servidor de desarrollo.
- 🔴 **`middleware.js` es JavaScript ya empaquetado, no `.ts`, y no es estilo**: el primer
  despliegue con `middleware.ts` FALLÓ en Vercel y producción se quedó en la versión anterior
  sin que nada avisara (solo se ve porque la cortina no sale). Vercel compila el `.ts` con su
  propio TypeScript, y este proyecto importa con extensión `.ts`. Tras tocar `cortina/`:
  `node scripts/construir-cortina.mjs`; una prueba falla si se olvida.

**Todo DATO exige una sesión de Supabase Auth.** Ya no hay lectura anónima: el
`PasswordGate` cosmético se sustituyó por un login real con `signInWithPassword`, las políticas RLS
y los GRANT pasaron de `anon` a `authenticated`, y `whatsapp-send` valida el JWT del usuario.

Desde el 31-07-2026 **hay páginas públicas** (landing, los dos accesos, el registro; §6quater), pero
eso no abre ningún dato: `anon` sigue sin un solo privilegio de tabla, y lo público es HTML estático
más dos Edge Functions con sus propios controles (`recuperar-password` y `registro`).

| Pieza | Cómo se protege |
| --- | --- |
| Datos (PostgREST) | RLS + GRANT sobre `authenticated`. `anon` no tiene ningún privilegio: responde `42501 permission denied` |
| **Rol y organización** | Tablas `usuario_roles` y `membresias` (§4bis). El rol **no viaja en el JWT**: se consulta en cada política, así que desactivar una cuenta corta el acceso al instante en vez de esperar a que caduque el token |
| **Edge Functions con JWT** | `exigirEquipo()` de `_shared/autorizacion.ts` en `whatsapp-send`, `enviar-email`, `priorizar-entidades` y `enviar-acceso`. Hace falta porque corren con `service_role`, que **ignora RLS** (§4bis) |
| `whatsapp-send` | Desplegada **con** verificación de JWT (sin `--no-verify-jwt`) y además comprueba `getUser(token)` |
| `whatsapp-webhook` | Sigue con `--no-verify-jwt` porque Meta no envía JWT; se valida la firma `X-Hub-Signature-256` |
| Alta de cuentas | Admin API (`scripts/crear-usuario.ts`) **o** la Edge Function pública `registro`, que crea la cuenta con la membresía **PENDIENTE**: el acceso real lo concede el equipo al aprobar. `enable_signup` sigue `false` y así debe seguir — la Admin API lo ignora, y así el alta pasa siempre por nuestro código |
| Login | `FormulariAcces.tsx`: `signInWithPassword` + botón «ojo» + «¿olvidaste la contraseña?». Se monta en `/login` (usuarios) y `/admin` (equipo). Los campos llevan `name` además de `autoComplete` (28-09-2026): sin él, Safari y el Llavero de iCloud no ofrecían guardar la contraseña en esta SPA. `RestablirClau` lleva el correo como campo `username` oculto, para que el gestor sepa de qué cuenta es la nueva |
| Recuperar contraseña | Edge Function `recuperar-password` (pública) + Resend; **no** usa el mailer nativo (§ abajo) |

### Correos: ahora sí, pero solo por Resend

Cambió la política del proyecto: el reset de contraseña y el envío de ofertas por email **sí
mandan correo**, pero **siempre por Resend** (nunca el mailer nativo de Supabase Auth, que sigue
apagado y en test). Detalle:

- El **mailer nativo de Auth sigue apagado**: `enable_confirmations=false`,
  `mailer_autoconfirm=true`, cuentas con `admin.createUser({email_confirm:true})` → el **alta no
  envía nada**. Sigue prohibido usar `resetPasswordForEmail()`, `inviteUserByEmail()` o magic
  links (esos disparan el mailer nativo).
- El **reset** usa `admin.generateLink({type:'recovery'})` (Admin API, **no** envía correo por sí
  mismo) y el enlace se manda por **Resend** desde `recuperar-password`. La app detecta el evento
  `PASSWORD_RECOVERY` (en `useSessio`, §6quater) y desvía a `/restablir`. La `redirectTo` (APP_URL)
  debe estar en la allow-list de Auth (Management API, **no** config push; §10).
- **Dominio `espigoladors.com` verificado en Resend** y `RESEND_FROM="Redestina <no-reply@espigoladors.com>"`
  configurado, así que **se envía a cualquier dirección** (verificado el envío a un correo externo).
  Si se cambia de dominio, verificarlo en `resend.com/domains` y ajustar `RESEND_FROM`. El gate
  `email_test_recipients` limita, mientras se está en pruebas, a los correos de esa whitelist.

### Maquetado de los correos — una sola plantilla, en el servidor

**`plantillaEmail()` en `_shared/resend.ts` es el único sitio donde se maqueta un correo**
(2026-07-30). Devuelve el documento completo: cabecera verde con el logo en negativo, tarjeta blanca con título,
cuerpo, botón y nota, filete coral, pie crema y la línea de por qué recibes esto. Está hecho con
**tablas y estilos en línea** —lo único que renderizan igual Gmail, Outlook y Apple Mail—, admite
`preheader` (la línea que la bandeja enseña junto al asunto) y pinta el botón con la técnica de
tabla + `bgcolor`, porque Outlook ignora el `padding` de un `<a>`.

**El logo es `public/logo-email.png`**, el logo **en color** —el principal— rasterizado a 410×120
con transparencia y pintado a 150×44: los clientes de correo no pintan SVG, no resuelven rutas
relativas y Gmail bloquea `data:`. Se sirve por URL absoluta desde `APP_URL`. El `alt` del `<img>`
va **estilado** (verde, 26px, bold), así que con las imágenes bloqueadas —lo normal en Gmail con un
remitente nuevo— se sigue leyendo «Redestina» en vez de un icono roto. Si se cambia de dominio,
basta con `APP_URL`.

🔴 **Y la cabecera es CLARA (`CREMA`) por culpa de eso, no por gusto** (15-09-2026). Nació verde,
acompañando a un negativo que **el fichero nunca fue**: un comentario decía que `logo-email.png`
era el negativo, y como el logo real lleva «DESTINA» y la hoja en el mismo `#4e6b45` del fondo,
durante cinco días **todos los correos salieron enseñando solo «RE»**, en coral. Nadie lo vio
porque para verlo hay que abrir un correo y el respaldo del `alt` sí funcionaba —con las imágenes
bloqueadas se leía «Redestina»; con ellas cargadas, media palabra—. Lo que manda es el fichero.
⚠️ **Fondo, logo, `alt` y subtítulo son CUATRO cosas que van juntas**: pasar la cabecera a oscura
exige rasterizar `logo-redestina-negativo.svg` y cambiar los dos colores de texto. Lo vigila
`tests/resend.test.ts`, que calcula el contraste WCAG de cada color de la cabecera contra su
propio fondo y exige ≥ 4.5 — con la cabecera verde y este logo, falla.

**Los colores se EXPORTAN desde `resend.ts`, y eso es parte del contrato**: el cuerpo de cada
correo lo compone su Edge Function, así que un `#4e6b45` escrito a mano ahí deja de obedecer al
sistema —el día que cambie el token, ese correo se queda con el color viejo y nadie lo nota—.
`enviar-acceso` llevaba tres y `recordatorios-documentales` diecisiete, **uno de ellos un
`#fdf1f0` que no existe en `design/tokens.json`** (el `coral-suave` real es `#fde9e6`). Hoy los
dos importan las constantes y no queda ningún hex suelto en ningún correo. **Los colores del correo son constantes al principio de
`resend.ts`** (`VERDE`, `CREMA`, `CORAL`, `FONDO`, `BORDE`, `TEXTO`, `SUAVE`) copiadas de
`design/tokens.json`: si cambia un token, se cambian ahí (y en `enviar-acceso/index.ts`, que lleva
dos en línea) y se redespliegan las funciones.

⚠️ **`textoAHtml(titulo, cuerpo)` ESCAPA su contenido**: es para texto plano (el `texto_oferta`, el
albarán). Pasarle HTML lo publica como markup literal — pasó con `enviar-acceso` el 30-07-2026 y el
correo llegó enseñando `<p>Hola…</p>`. Para HTML, `plantillaEmail()` directamente.

**El cliente no maqueta, y desde el 15-09-2026 tampoco puede.** `enviar-email` acepta un campo
opcional **`plantilla`** (`{ titulo, preheader?, boton?, nota? }`) y el `html`/`text` recibido es
siempre solo el *contenido*: el servidor lo envuelve **pase o no pase ese campo**, y sin él el
asunto hace de título. Antes, sin `plantilla` se mandaba el `html` tal cual «por compatibilidad
hacia atrás», y esa puerta no servía para nada —los tres llamantes del frontend la pasan— salvo
para que algún día saliera un correo sin cabecera ni pie sin que nadie se enterara. Por eso
`OfferDetail` no construye HTML de correo: pasa `plantilla` y el texto.

⚠️ **Los seis emisores usan `plantillaEmail()`** (`enviar-email`, `enviar-acceso`,
`recuperar-password`, `recordatorios-documentales`, `enlace-publico` y `_shared/correu-oferta.ts`),
así que tocar esa función cambia **todos** los correos a la vez — que es justamente para lo que
existe. Y como todas importan `_shared/resend.ts`, tocarla obliga a **redesplegar las siete
funciones** que la empaquetan, `registro` incluida (§11).

### Enlaces de acceso (`enviar-acceso`)

`POST /functions/v1/enviar-acceso { email, canal? }` genera el enlace con
`admin.generateLink({type:'magiclink'})` —Admin API, **no** manda nada— y lo envía por Resend, igual
que `recuperar-password`. Como el `redirectTo` es exactamente `APP_URL`, que ya está en
`uri_allow_list`, **no hay que tocar Auth por Management API** (§ arriba).

**Está restringida al equipo** (`exigirEquipo`: `401`/`403`) y respeta el gate de cuenta (`403
no_test_user` con el modo test activo, §8). `canal` es **opcional y por defecto `'auto'`**: decide con
la política de `_shared/canal.ts` (§8bis), admite `'ambos'`, y ante fallo de WhatsApp **cae a correo**,
devolviendo `motiu_canal`.

🔴 **Y el código SE PUEDE ESCRIBIR EN ALGÚN SITIO desde el 16-09-2026, que hasta entonces no
era cierto.** `enviar-acceso` llevaba desde julio diciendo «entra a redestina.carlessanz.com,
escriu el teu correu i fes servir aquest codi» y **no existía ninguna pantalla que lo
aceptara**: cero referencias a `verifyOtp` en `src/`. Lo vio el cliente al recibir el correo
y preguntar dónde se usaba. **Y no era solo cosmético: por WhatsApp se manda el código y NADA
MÁS, así que esa vía de acceso estaba rota entera.** El formulario es
`components/AccesAmbCodi`, dentro de `/login`, y canjea con `supabase.auth.verifyOtp({ email,
token, type: 'email' })` — la pareja del `admin.generateLink` que emitió el código, así que la
sesión es idéntica a la del enlace y no hay un segundo sistema de login que mantener.
⚠️ Los dos textos apuntaban a la **raíz**, que es la portada y no tiene dónde escribir nada;
ahora apuntan a `/login`.
⚠️ **El correo es parte de la credencial**, no un campo de más: seis cifras solo valen contra
la dirección a la que se enviaron, y pedirlo es lo que impide probarlas contra cualquier
cuenta. El error es uno solo para «malo», «caducado» y «no cuadra»: distinguirlos diría si
ese correo existe.

**Por correo va el enlace; por WhatsApp, solo el código de 6 cifras.** Un enlace mágico es una
credencial al portador, y `sendText()` guarda el cuerpo en `wa_messages`, que el equipo lee desde
Mensajería: el enlace quedaría publicado en la consola. Por eso `sendText()` acepta `bodyConsola`,
que redacta lo que se registra. El código caduca en 1 hora, es de un solo uso y no sirve sin conocer
el correo.

Límite real del canal WhatsApp (§8): solo llega a números de `meta_test_recipients`, de una ficha
`es_test`, **y con la ventana de 24 h abierta** —fuera de ella solo entran plantillas aprobadas, y
la única que hay es `hello_world`, que no admite variables—. Para el resto de las cuentas, correo.
Mandarlo por WhatsApp de forma general exigiría número de producción y una plantilla de categoría
`AUTHENTICATION` (checkpoint §12.2).

### Subida de la factura del donante (fase 4)

`GET /enlace-publico?t=` con propósito `subida_factura` devuelve el resumen del donante (número,
ejercicio, kg, **importe esperado**, bloqueos, modo y el PDF del resumen firmado 60 s).
`POST { t, accion:'subir_factura', numero, fecha?, importe?, fitxer }` acepta **multipart** o JSON
con `fitxer_base64` (PDF/JPG/PNG, ≤10 MB): sube a la ruta de `ruta_documento(… 'externs' …)` **con
el modo del cierre**, deja la fila en `documentos_externos` (`tipo='factura'`, `origen='enlace'`) y
llama a `registrar_factura()`, que decide `coincident`/`discrepancia`/`factura_rebuda`. Si el
registro falla se borran fichero y fila. Deja evidencia `subida` y **el token se consume**
(reintento → 409). El otro camino es el panel del donante, y los dos resuelven el permiso con
`puc_pujar_document_extern()`.

⚠️ **El DNI de la apoderada y los PNG de firma y sello no viajan en `documentos.datos`**: los lee
`generar-documento` con `service_role` de `parametros_documentales` y del bucket `activos`, y solo
para estamparlos. `documentos.datos` lo lee el donante por `documents_meus()`; meter ahí el DNI
anularía el GRANT por columnas. Para emitir un certificado real hacen falta, además de
`datos_provisionales = false`, el `apoderada_dni`, la `firma_ruta` y el `sello_ruta`.

⚠️ **El resumen anual SÍ lleva importes; los albaranes no.** La regla «ningún importe» es de los
documentos legales de entrega (REC/ENT/OPE), no del resumen: su función es justamente pedirle al
donante una factura por una cifra concreta (anexo B.1).

### Firma de convenios por enlace (fase 2)

🔴 **El formulario exige lo mismo que el servidor** (07-10-2026). `enlace-publico` rechaza la
firma con `400 dades_invalides` si el nombre o el cargo de quien firma tienen menos de 2
caracteres o el documento de identidad menos de 5, y dice el campo (`camp`). `FirmaConveni`
encendía el botón con cualquier texto no vacío y, al rechazarse, tiraba el motivo y pintaba
«No podem obrir aquest enllaç · Hi ha alguna dada que no quadra» — reportado por el cliente
probando con datos cortos, y leído como un bloqueo por convenio. Ahora valida los mismos
mínimos (`MIN_NOM`, `MIN_DNI`) con aviso bajo el campo, y un rechazo de datos se enseña junto
al botón con el campo traducido (`ERROR_CAMP`), sin la pantalla de enlace roto. Si se cambian
los mínimos del servidor, cambiarlos en los dos sitios.

`enlace-publico` gana el propósito `firma_convenio` con tres acciones: `firmar`, `enviar_codi` y
`validar_codi`. Es **firma electrónica simple**: lo que la acredita no es el trazo, es la evidencia.

**Tres vías para llegar al mismo sitio**, y el PDF las distingue: por **correo** (el enlace que
manda `enviar_convenio`), **asistida** (la abre el dinamizador delante de la persona, con
segundo factor si hay correo) y, desde el 14-09-2026, **desde el panel** con sesión
(`acunar_enllac_propi`, §6ter). La del panel **no lleva segundo factor** —`enviar_codi` y
`validar_codi` siguen rechazando cualquier canal que no sea `asistido`— porque el factor ya
es la sesión. La cuenta que la acuñó queda en `evidencias.payload.panell` y **no** en
`asistido_por`: esa columna significa «alguien del equipo condujo la firma», y decir eso de
una firma propia sería falso.

**El texto que se firma lo compone el servidor** (`_shared/pdf/convenio.ts`, el mismo módulo que
imprime el PDF, para que el texto hasheado y el impreso sean el mismo) y su sha256 se **recalcula**
en el POST: nunca se acepta la huella del cliente, y si no coincide, `409 document_canviat`.
⚠️ **La huella cubre el articulado y las dos declaraciones, no los datos que la persona teclea**: si
los cubriera cambiaría con cada tecla y el guardia dejaría de distinguir un cambio real. Lo tecleado
va a `evidencias.payload` y se congela en `convenios.datos_org`. **Precio conocido**: el NIF o el
domicilio que se corrigen al firmar salen luego en el PDF sin estar en esa huella.

El trazo es un PNG que se sube a `<org>/<ejercicio>/evidencies/<enlace>.png` **antes** de llamar a la
RPC, y se retira si esta falla. **El DNI de quien firma vive solo en `evidencias.documento_identidad`**
(§4): no está en `documentos.datos`, así que `sha256_datos` no lo cubre; lo lee `generar-documento`
con `service_role` solo para la página de evidencias.

El segundo factor (6 cifras, 10 min) es **solo** de la firma asistida. `enviar_codi` **manda el
correo antes de escribir `codigo_hash`**: al revés, un fallo de correo dejaría el enlace exigiendo un
código que nadie tiene. En un enlace por correo responde `409 no_cal_codi`.

🔴 **Y desde el 21-09-2026 `iniciar_firma_asistida()` NO genera ese código** (`20260921161008`), que
es lo que lo convierte en un segundo factor de verdad. Antes lo generaba y **se lo devolvía a quien
conduce la firma**, que ya tiene el enlace: dos factores en la misma mano no son dos factores, son un
actor con dos cosas. Y la interfaz lo empeoraba afirmando que «también se ha enviado por correo»
cuando **nada lo enviaba** — `iniciar_firma_asistida()` es SQL puro y solo lo devolvía; el único
código que llega al correo de la organización es el que acuña `enviar_codi` **cuando la persona
pulsa «Envia'm el codi» en su propia pantalla**.
⚠️ **La solución fue quitar, no añadir.** Con `codigo_hash` a null la guarda de
`firmar_convenio_por_enlace` no exige código (su condición es `if en.codigo_hash is not null`), así
que una organización sin correo sigue pudiendo firmar asistida —lo que ya decidió §3.2.5— y en cuanto
la persona pide el código desde su pantalla, el hash aparece y la puerta se cierra sola.
⚠️ La clave `codi` del retorno **se conserva, siempre `null`**, para no romper a quien ya la leía, y
se añade `pot_demanar_codi`. **Y la pantalla dejó de enseñar el código el 21-09-2026**
(`ConveniDetall`): con la RPC ya cambiada seguía pintando «Aquesta fitxa no té correu», que era
falso —el correo puede existir; lo que ya no existe es el código ahí—. Ahora dice **dónde lo va
a pedir la persona**, y la clave `conv.assisted_code` se retiró porque afirmaba que se había
enviado por correo. `enviado_at = now()` se queda como estaba aunque aquí no se envíe nada:
es incoherente con `acunar_enllac_propi()`, pero hay pantallas que leen esa fecha para decir «te lo
mandamos el día X» y cambiarlo es otro trabajo con su propia verificación.

**La confirmación de un albarán también tiene vía asistida** (`20260921160536`,
`acunar_enllac_assistit` en §4bis). Hasta entonces no la tenía, y la consecuencia no era cosmética:
`marcar_entregado()` inserta sin `canal` —o sea `'email'`— y `registrar_confirmacion()` nunca escribía
`asistido_por`, así que **una confirmación conducida por teléfono quedaba documentada en el PDF como
«enviada por correo»**. Ahora `registrar_confirmacion()` escribe `asistido_por` **solo cuando el
enlace es `asistido`**, y leyéndolo de `enlaces_token.creado_por`, nunca del cuerpo de la petición:
quien confirma no tiene sesión y podría mandar cualquier uuid.

🔴 **Y el PDF del albarán imprimía la vía de confirmación de forma BINARIA, así que ya afirmaba
algo falso antes de existir la vía asistida.** `_shared/pdf/render/comu.ts` decía
`canal === 'asistido' ? assistit : enllac`, o sea que una confirmación hecha **desde el panel** con
sesión —que existe desde `20270318100000`— se imprimía como «Confirmat des de l'enllaç». Desde el
21-09-2026 son **tres vías**, el mismo criterio que el convenio ya aplicaba en `render/conv.ts`:
`confirmat_enllac`, `confirmat_assistit` y **`confirmat_panell`**. No es cosmético: esa línea ocupa
el sitio de la firma manuscrita y es lo que un tercero lee para saber cómo se acreditó la entrega.
⚠️ Toca **`_shared/pdf/`**, que solo importan tres funciones —`generar-documento`, `enlace-publico`
y `recordatorios-documentales`—, así que no hay que redesplegar las quince.

**Las tres vías en `enlace-publico`, y dónde se decide cada una** (21-09-2026). El canal lo dice
`enlaces_token.canal` y la función **no lo recibe del cuerpo**: quien confirma o sube una factura no
tiene sesión y podría escribir cualquier cosa.

| Canal | Qué deja | Quién lo compone |
| --- | --- | --- |
| `email` | Nada más que la evidencia normal | — |
| `panel` | `payload.panell` = `{user_id, email}` de la fila del enlace. **Nunca `asistido_por`** | `enlace-publico` |
| `asistido` | `evidencias.asistido_por` = `enlaces_token.creado_por` | **SQL** en la confirmación; `enlace-publico` en la factura |

⚠️ **La asimetría de la última columna no es un descuido.** La confirmación del albarán pasa por
`registrar_confirmacion()`, así que la regla vive dentro de SQL y ningún llamador futuro puede
saltársela; la subida de factura **inserta en `evidencias` directamente** desde la función, sin RPC,
así que ahí la garantía la sostiene TypeScript. Quien toque `subirFactura()` tiene que conservar las
dos mitades: solo con `canal='asistido'`, y leyendo la cuenta de la fila.

⚠️ **Y `panell` cambió de sitio**: iba en `p_payload` —«lo que respondió la persona»— y ahora va en
`p_evidencia.payload`, que es lo que el servidor **constata** sobre el acto. Los funde
`registrar_confirmacion()` con el segundo encima (`20260921160536`), igual que
`firmar_convenio_por_enlace` (`20270320100200`). Mezclar declarado y constatado en un mismo objeto es
lo que hace que después nadie sepa cuál de los dos es.

**Los dos GET exponen `assistida`**, como ya hacía el del convenio: el formulario tiene que poder
decir «aquesta confirmació quedarà registrada com a assistida» **antes** de que se firme nada. El
cliente lo lee en `DadesEnllac.assistida` y `DadesFactura.assistida` (`src/lib/enllacPublic.ts`), y
ante la duda vale `false` — afirmar un acompañamiento que no consta es justo el error que
`asistido_por` existe para evitar.

`registro` acepta los datos del convenio y crea el borrador con su enlace: devuelve el token **solo**
si firma quien registra (misma sesión, misma persona); si firma otra, el enlace queda esperando y lo
envía el equipo, porque `registro` sigue sin mandar ningún correo (§8).

### Recordatorios de enlaces (`recordatorios-documentales`)

`POST /functions/v1/recordatorios-documentales {}` — **pública** (`--no-verify-jwt`) porque la
llama `pg_cron` a las 7:00; se protege con el mismo secreto compartido que `generar-documento`
(`x-documentos-secret` / `DOCUMENTOS_SECRET`, en `app_config.documentos_secret` para el job).
Busca enlaces `activo`, sin `usado_at` y **con `caduca_at` en el futuro** —la caducidad se calcula,
no se guarda— que lleven 7 días (`recordatorios = 0`) o 14 (`recordatorios = 1`); a partir del
segundo aviso no manda nada más.

⚠️ **El recordatorio no puede llevar el enlace, y por eso va al equipo y no al destinatario.** De
`enlaces_token` solo existe `token_hash`: el token en claro vive únicamente en el correo original.
Emitir uno nuevo rompería en silencio el que la persona quizá ya tiene abierto —y revocar+crear es
una decisión del equipo, no de un cron—; mandar un correo sin enlace sería un aviso que no se puede
accionar. Así que se manda **un solo resumen diario** a `parametros_documentales.email_equipo` con
los enlaces vencidos, para que alguien reenvíe desde el panel o llame. Es el modelo asistido
(§1bis) aplicado al recordatorio.

Respeta los gates (§8): `modoTestActivo()` + `esEmailTest()` **sobre el destinatario**, aunque el
correo vaya al equipo —lo que el aviso desencadena es reenviar un enlace a esa persona—; un enlace
`asistido` (sin correo con que comprobarlo) también se salta con el modo test activo. **Los
contadores solo se suben si el correo salió**: si no, el hito sigue pendiente y se reintenta
mañana. Con `email_equipo` NULL (hoy lo es) no falla: lo registra, lo cuenta como
`sense_email_equip` y sigue. Devuelve `{ok, revisados, avisados, saltados, motivos}`.

### Confirmación por enlace (`enlace-publico`, fase 3)

`GET ?t=<token>` y `POST {t, accion}` — **pública** (`--no-verify-jwt`): quien confirma una entrega
no tiene cuenta. **El token es la única credencial**, y en la base solo vive su sha256. Anti-abuso
como `registro`: honeypot, 10 intentos/10 min por IP en memoria y freno durable (≥50 evidencias/hora
→ 429).

**`evidencias.sha256_texto` es la huella del acta que compone el SERVIDOR**, no la que manda el
cliente. El `GET` devuelve el acta entera en `text_confirmacio` —declaración, número, código de
verificación y una línea por producto con sus kg— y la página está obligada a mostrarla tal cual; el
`POST` la vuelve a componer y hashea la suya. Si la del cliente no cuadra, `409 document_canviat`.
Aceptar la huella del cliente convertiría la evidencia en una declaración suya sobre lo que dice
haber visto. Los kg tecleados **no** entran en la huella: eso es lo respondido, y va en `payload`.

⚠️ **D3 también se aplica en la API, no solo en el PDF.** El albarán de entrega filtraba la
identidad del generador por dos vías que no eran evidentes: `id_excedente` tiene el formato
`E-AAMMDD-XXX-YYY-N`, donde **XXX son las tres primeras letras del nombre del productor**, y
`recogida.lugar` (la finca) más `responsable_origen` (la persona en origen) salían tanto impresos
como en el JSON público. Los tres se tapan en ENT y el lugar se sustituye por el municipio. Si se
añade algún campo nuevo al snapshot, hay que preguntarse si nombra al donante.

### «Dona-li accés»: `donar-acces` (plan 1, rebanada 1D, 02-11-2026)

D5 + P1: el acceso se da **sobre una organización que ya existe**, nunca creando otra, y la persona
pone su propia contraseña. `POST /functions/v1/donar-acces` (`verify_jwt = true`) con
`{ organizacion_id, email? }` → `{ ok, compte_nou, email: '···@domini', correu: 'enviat'|'simulat' }`.

- **Autorización**: `exigirEquipo()` (401 sin sesión o cuenta desactivada; 403 si no es equipo) y
  después `rolesActivos() && !ctx.potAprovar` → 403 `forbidden`: el `tecnic` no da acceso (crear una
  cuenta aprobada es aprobar un alta). `SB_SECRET_KEY` solo dentro de la función.
- **Prechecks antes de crear nada**: organización (404 `organitzacio_inexistent`) con alguna ficha activa
  (409 `entitat_inactiva`); el correo, el del body o el único de las fichas activas (400 `falta_correu`,
  `correus_diferents`, `correu_invalid`); **interruptor de correo** apagado → 409 `correu_desactivat`
  (este correo **no es transaccional**, §8); **modo test** encendido y alguna ficha activa sin `es_test` →
  403 `no_test_user`; cuenta del equipo (409 `compte_equip`), registro pendiente (409
  `registre_pendent`), otra cuenta activa en la organización (409 `altre_compte_actiu`, D3: un contacto
  con acceso; antes hay que desactivar).
- **Pasos**: A `auth.admin.createUser` (si no hay cuenta; `email_confirm: true`, contraseña aleatoria de
  32 bytes que no se guarda) → B `concedir_acces_org()` (§4bis; vuelve a comprobar todo en una
  transacción y devuelve la foto de lo anterior) → C `generateLink({type:'recovery'})` → D `sendEmail()`
  **sin `transaccional`** (segunda barrera del interruptor y del modo test), con traza
  `documento_envios` `proposito = 'acces_entitat'`, `objeto_tipo = 'organizacion'`. **Compensación**: si
  falla C o D, `revertir_acces_org(foto)` y, si la cuenta la creó esta petición, `auth.admin.deleteUser`;
  el correo que no sale da 409 `correu_desactivat`, 403 `no_test_user` o 502 `correu_no_enviat`. Un
  `23505` del correo de `productores` → 409 `dades_en_us`. Logs con `enmascararEmail`, nunca el enlace.
- **«Torna a enviar»** es la misma llamada: con la cuenta activa y el mismo correo, B no cambia nada y se
  repiten C y D (si la organización ganó un papel, B le añade la membresía que falta).
- **Correo** (`donar-acces/correu.ts`, puro): «Benvingut/da a REDESTINA · Estableix la teva contrasenya»
  (ca/es por `perfiles.idioma`), `plantillaEmail()` con botón al enlace, datos escapados, **sin código
  de seis cifras** (es un enlace de recuperación, no un acceso mágico). El enlace lleva a `/restablir`.
- **Consentimientos: ninguno.** Nadie acepta la privacidad por la persona (P3); aceptarla en el primer
  acceso es la **deuda 152**, condición para apagar el modo test.
- **Mailpit del clon**: si el envío sale `simulado` y existe `MAILPIT_URL` (solo en
  `supabase/.env.funciones-local`), `_shared/bustiaLocal.ts` copia el correo al Mailpit del stack, y el
  E2E lee el enlace en `127.0.0.1:55324/api/v1/…`. En producción no existe la variable y el envío es real.
- **Retirada de `alta-assistida`**: la función, su bloque de `config.toml`, `DialegAltaAssistida` y el
  modo `assistit` de `FormulariAlta`. `registro/alta.ts` no se tocó (sería redesplegar la función
  pública): su rama `alta_assistida` queda muerta (**deuda 151**). `textosRgpd` conserva los textos
  `ASSISTITS` (reproducen la huella de consentimientos guardados) y `consentiments.origen` sigue
  admitiendo `alta_assistida` por las filas históricas.

### RGPD en el alta y alta asistida (27-10-2026)

**`/registre` pide, junto a la contraseña, aceptar la política de privacidad (obligatoria) y dos
consentimientos opcionales**: comunicaciones informativas de la plataforma y de la Fundació
Espigoladors. El texto de cada casilla es el de `_shared/textosRgpd.ts` (copia en `src/lib`, la
vigila `tests/notificacions.test.ts`); el servidor lo **recompone en el idioma de la pantalla** y guarda
su huella en `consentiments` (§4), nunca el texto del cliente. `validar()` devuelve `400` con
`camp = 'accepta_privacitat'` si falta, y solo `true` exacto vale. **No condicionan ninguna
notificación operativa** (§8): esas tienen como base el servicio.

**Alta asistida (RETIRADA el 02-11-2026, plan 1 1D; lo vigente es «Dona-li accés», abajo)**:
«Nova organització amb compte» (listados de productoras y receptoras, y
Aprovacions; `pot_aprovar()`) abre `DialegAltaAssistida` con el mismo `FormulariAlta` en modo
`assistit` —contraseña inicial, casillas en tercera persona («la persona ha acceptat…»), casilla de
usuario de prueba y «envia-li l'accés ara»— contra la Edge Function **`alta-assistida`** (JWT y
`pot_aprovar`). **Función propia y no una rama de `registro`** (dos regímenes de autorización en una
función es donde se esconde el fallo), pero el alta es **la misma**: `registro/alta.ts`
(`executarAlta`), con los mismos pasos, duplicados y compensación. Diferencias: la membresía nace
`aprovada` y `activo` con `aprovat_per`, y los consentimientos `origen = 'alta_assistida'` con
`registrat_per`. El acceso lo manda después `enviar-acceso`, transaccional.
⚠️ Los consentimientos se guardan **antes** de las fichas: si fallan, solo se deshacen la
organización y la cuenta, y no quedan convenios ni enlaces de una ficha borrada.

### Registro self-service (`registro`, 31-07-2026)

`POST /functions/v1/registro` — **pública** (`--no-verify-jwt`), porque la llama quien todavía no
tiene cuenta. Crea, en este orden: la cuenta (`admin.createUser`, `email_confirm: true`), la ficha
(`productores` o `entidades`, con `es_test = false`) y la **membresía `pendent` con `activo = false`**
(§4bis).

⚠️ **Y desde el 16-09-2026 se pueden pedir LOS DOS PAPELES a la vez.** El cuerpo acepta
**`rols: string[]`** (`rol` en singular se sigue aceptando: el contrato es público y una pantalla
servida desde una caché vieja no puede romperse en el alta). Con los dos, se crea **una sola
`organizaciones`** y bajo ella **dos fichas, dos membresías y dos convenios** —`don_gen` y
`don_rec`—, que es exactamente lo que el índice único parcial de esa tabla permite: una ficha de
cada tipo. Antes había que registrarse **dos veces con dos correos distintos**, y eso dejaba dos
organizaciones que el equipo tenía que fusionar a mano con `enllacar_organitzacio()` — el trabajo
que la brecha 2 de §1bis existe para evitar.
⚠️ **La detección de duplicados se decide una vez POR PAPEL y se combina con la regla más
estricta**: si cualquiera de los dos ya está cubierto, el alta entera se deniega con `409`. No se
puede partir —dar la ficha de productor y negar la de entidad— porque la persona pidió las dos y
quedarse a medias en silencio es peor que rechazar. La compensación sigue el mismo criterio: apila
las fichas creadas y las deshace todas en orden inverso. Contrato completo y códigos de error en el propio fichero; los mensajes van en catalán,
listos para mostrar.

**Abre el alta sin abrir el acceso.** La persona puede iniciar sesión y no ve absolutamente nada
—los helpers filtran por `membresias.activo`—: le sale la pantalla «Compte pendent de validació».
Quien concede el acceso de verdad es el equipo, desde Aprovacions (§6quater).

**Detecta que la organización ya existe, y aun así NO vincula** (etapa 2 de la brecha 2,
11-09-2026). Antes solo veía los choques con `productores` —y los veía porque allí `email` y `phone`
son UNIQUE—, así que una entidad ya fichada se registraba otra vez y solo lo notaba el equipo al
validar. Ahora consulta las fichas de las dos tablas y **`v_organizaciones`**, con el mismo criterio
que usó la migración de la etapa 1: **correo o teléfono exactos** (el teléfono, por sus últimas 9
cifras), **nunca el parecido del nombre** —juntar dos organizaciones distintas es mezclar los kilos y
el certificado fiscal de dos donantes—. Tres caminos:

⚠️ **Y no hay UNA columna de cada cosa por ficha, sino varias — con fuerzas distintas**
(§12.91 para los teléfonos, §12.102 para el correo, cerrada el 15-09-2026). Se miran las
**principales** (`productores.email`/`phone`, `entidades.email`/`telefono`) y las
**secundarias** (`productores.telefono_alt`, `entidades.telefono2`/`telefono3` y
**`entidades.email2`**), pero **solo una coincidencia por columna principal puede denegar**
un alta con `409 dades_en_us`: una secundaria lleva siempre al camino de «papel nuevo», con
su nota para el equipo. Lo impone `esForta()` en `coincidencies.ts`, y el tipo `MotiuFort`
hace que el compilador lo sostenga —un `409` no puede citar una columna débil ni por error de
refactor—. El motivo: esas columnas guardan **el contacto de otra persona de la casa**, no la
identidad de la organización. El caso que lo decidió está medido en producción: la entidad
«CS El Roser - Menjador i Rebost» lleva en `email2` el correo del **Ajuntament de Reus**, que
es un productor de **otra** organización — casi seguro el técnico municipal que lleva el
centro. Con `email2` denegando, ese ayuntamiento se habría quedado sin poder registrarse.

| Coincidencia | Qué hace |
| --- | --- |
| Ninguna | Alta normal. La ficha **estrena su fila en `organizaciones`** (`creada_por` = la cuenta recién creada) |
| Con una organización que **no** tiene ficha de ese tipo | **Es la misma organización estrenando papel.** El alta sigue, la ficha estrena **identidad provisional propia** y se le deja una nota en el comentario; responde `200 { revisio_equip: true }`. El equipo las une después con `enllacar_organitzacio()` (§4bis) |
| Con una organización que **ya** tiene ficha de ese tipo | `409 dades_en_us` con `camp`, como hasta ahora — **y ahora también para entidades** |

⚠️ **El papel nuevo no se enlaza solo, y no es timidez.** Enlazar sería convertir «conozco el correo
de esta organización» en «soy esta organización» por un rodeo: hoy el acceso lo da `membresias`, que
apunta a una ficha, así que el enlace no abriría nada **todavía**; pero la unificación existe para
que mañana los convenios, los albaranes y los certificados se resuelvan **por organización**, y ese
día el enlace se convierte —sin que nadie lo vuelva a mirar— en acceso a los kilos y al certificado
fiscal de la otra ficha, creado por un POST sin sesión. Aprobar un alta es un clic y nada en esa
pantalla diría que además se confirma una identidad. Tampoco se le crea una organización propia: eso
fabricaría el duplicado que esto viene a detectar; pero **tampoco puede quedarse sin ninguna**:
desde `20270313100000` la columna es `not null` y el trigger le pone una. Así que nace con una
**identidad provisional propia** —que es, de hecho, ese duplicado, solo que **con una nota que lo
dice**— y el equipo la une a la buena desde Aprovacions. Unir es **fusionar**, no rellenar un hueco:
lo hace `enllacar_organitzacio()` (§4bis).

⚠️ **Y esto no siempre estuvo bien contado.** La etapa 2 se escribió creyendo que la ficha quedaba
con `organizacion_id` NULL, y así lo decían su código y esta sección: era falso desde el momento en
que se publicó, porque el trigger de la etapa 1 va delante. No tenía consecuencia visible —la nota
seguía siendo el marcador— salvo una: en ese camino la organización la creaba el trigger, fuera del
alcance de la compensación, así que si fallaba el alta de la membresía la ficha se borraba y esa
organización **quedaba huérfana**. Desde el 11-09-2026 `registro` la crea siempre él.

**Las consultas van a las fichas, no a la vista**, y después la vista. `v_organizaciones` expone un
solo correo y un solo teléfono por organización (el del productor cuando hay las dos, por el
`coalesce`), así que filtrar por ella dejaría invisible el correo de la otra ficha — que es justo el
caso a cazar. Las fichas dicen QUIÉN casa; la vista, QUÉ PAPELES tiene ya esa organización, que es lo
único que separa el papel nuevo del duplicado. Si la vista falla, se trata como duplicado: rechazar
un alta legítima lo arregla el equipo; dar por nueva una organización que ya está, no.

**La compensación cubre cuatro pasos** (cuenta → organización → ficha → membresía): si falla la ficha
se borran organización y cuenta; si falla la membresía, ficha, organización y cuenta. La organización
es además **best-effort**: si no se puede crear, la ficha nace sin ella antes que perder un alta —y
desde `20270313100000` ni eso, porque el trigger se la pone igual.

**Enumeración aceptada a propósito.** Un correo ya registrado devuelve `409 email_ja_registrat`, al
revés que `recuperar-password`, que siempre responde 200 genérico. La incoherencia es deliberada: la
respuesta genérica solo funciona si puedes rematar el flujo por correo («si ya tenías cuenta, te
hemos escrito») y **este registro no envía ningún correo**; un genérico dejaría a la persona legítima
esperando una validación que no llegaría nunca.

🔴 **El alta pide MENOS y a la vez EXIGE MÁS** (16-09-2026, pedido por el cliente):
- **Fuera la población.** Se rellena después en la ficha, donde sale sola del código postal
  (`codis_postals`). En la puerta había que teclearla a mano, sin validar, y corregirla
  igual — y es la que produce «Sant Cugat» / «St. Cugat del Vallès» / «SANT CUGAT».
  **Se sigue aceptando** en el cuerpo por si llega de una pantalla vieja: el contrato es
  público.
- **El teléfono pasa a OBLIGATORIO.** Era opcional, y eso dejaba entrar organizaciones a
  las que **el canal principal del producto no alcanza**: sin móvil no hay intake, ni
  recordatorio, ni oferta por WhatsApp, y la ficha nace muda sin que nada lo diga. Se exige
  *tenerlo*, no que sea un móvil: fuera de España el prefijo no lo dice y rechazar un
  número extranjero legítimo sería peor.
- **Confirmación de contraseña** en la pantalla. No viaja al servidor —comprobarla allí no
  añade nada, quien manda el POST a mano manda las dos iguales—: es una guarda contra la
  errata, y en un alta la errata no se descubre al momento sino al intentar volver, cuando
  ya hay cuenta, ficha y membresía creadas.

**Anti-abuso proporcionado** (sin captcha, deuda §12.26): honeypot `web` —que responde 200 falso—,
límite de 5 intentos/10 min por IP **en memoria** (best-effort: se pierde en cada arranque en frío y
no se comparte entre instancias) y un freno global durable: ≥20 registros pendientes en la última
hora → 429. A la escala de Redestina, ese freno no molesta a nadie legítimo y corta un abuso masivo aunque
roten las IP.

**Compensación**: si falla el insert de la ficha se borra la cuenta; si falla la membresía se borran
ficha y cuenta. El orden está elegido para que el peor residuo posible sea una cuenta de Auth sin
membresía —inocua, no sale en ningún listado— y nunca una ficha huérfana contaminando los 345
productores reales.

⚠️ **El REGISTRO no manda ningún correo** —ni de bienvenida ni de verificación—, y sigue
siendo deliberado (§12.27). **Pero APROBAR sí, desde el 16-09-2026**: al validar un alta
desde Aprovacions se llama a `enviar-acceso` con el correo de la persona y se le manda el
**enlace mágico a su panel**, que es lo que el cliente pidió («al aceptar una organización,
un correo con el acceso directo»). `canal: 'email'` y no `'auto'` a propósito: por WhatsApp
`enviar-acceso` manda solo el código de 6 cifras, no el enlace (§9), y lo que aquí se
promete es el acceso directo.
🔴 **Y la fila trae una casilla «usuari de prova» que se marca ANTES de aprobar**
(16-09-2026). Una organización recién registrada nace `es_test = false`, así que con el modo
test activo el correo de acceso **se descarta**: pasó de verdad —se aprobó un alta, el aviso
no salió y nadie se enteró hasta que la persona preguntó—. Marcarlo antes exigía ir a la
ficha, volver y acordarse, o sea no hacerlo. El `update` va **antes** de `aprovar_registre`
porque el envío ocurre dentro de la misma función; al revés, la marca llegaría tarde.
⚠️ Si ese `update` falla **no se aborta la aprobación** —es una marca de pruebas, no el
alta— pero se avisa, porque entonces el correo tampoco saldrá y hay que saber por qué.

⚠️ **Y si el correo no sale, la pantalla lo dice.** El caso más probable no es un error: con
el modo test activo la organización recién aprobada nace `es_test = false` y el gate la
descarta con `403 no_test_user` — exactamente el motivo por el que el registro nunca mandó
nada. Tragárselo repetiría el error con otra cara, porque el equipo creería haber avisado;
así que el toast distingue «li hem enviat l'accés a X», «amb el mode test actiu no el pot
rebre: avisa-la tu» y «no ha sortit: avisa-la tu». **Aprobar no depende del correo**: la
aprobación ya ha ocurrido cuando se intenta enviar.

### Usuarios de prueba

`scripts/crear-usuarios-prueba.ts` crea **5 organizaciones ficticias** —2 productores (`TEST-PROD-1`,
`TEST-PROD-2`) y 3 receptores (`TEST-ENT-SOCIAL`, `TEST-ENT-OBRADOR` transformador,
`TEST-ENT-COMERCIAL`), todas `es_test`— y **7 cuentas**: una por organización, más las 2 del equipo
(`super_admin` y `tecnic`). Ficticias a propósito: un fallo de permisos no expone entonces ninguna
organización real, y ningún botón manda un WhatsApp a un receptor de verdad. Sin teléfono
(`productores.phone` es UNIQUE y los números del equipo ya están dados de alta): para WhatsApp están
las cuentas de la sección siguiente.

**El juego se recortó dos veces el 31-07-2026** (era 7 organizaciones y 13 cuentas):

1. Fuera los pares **titular/operador**, porque el producto **no tiene cargos dentro de la
   organización**: todos los usuarios de una empresa ven el mismo panel, y el registro público
   siempre crea `titular`. `rol_org` sigue en el esquema (§4bis) pero de facto vale siempre
   `titular`, así que **ninguna cuenta ejercita ya el caso `operador`** —y `PerfilOrganitzacio` sigue
   condicionando el guardado a `rol_org === 'titular'`, o sea que esa rama es código sin cobertura—.
2. Fuera el receptor de **alimentación animal** (esa línea no se usa todavía) y las dos de
   **control** —la cuenta sin rol y la del registro pendiente—, que salían en `/login` sin ser un
   caso de uso.

Cada cuenta que sobra es una ficha más de ruido en los listados del equipo y en la priorización.

⚠️ **Lo que costó el segundo recorte**: el arnés se quedó sin cuenta que recorriera los bloques
`sense_rol` y `pendent`, y **143 comprobaciones dejaron de ejecutarse en silencio** durante mes y
medio. Se recuperó el 14-09-2026 dando de alta las dos cuentas de la sección siguiente —y al
recorrerlos por primera vez desde julio **cuatro salieron en rojo**, que es exactamente para lo que
sirve esa cobertura—. Y al borrar las dos organizaciones quedaron **dos filas huérfanas en
`email_test_recipients`**, que no tiene FK (§4, deuda §12.33).

### Cuentas para probar WhatsApp (31-07-2026)

Ninguna de esas 7 puede usar WhatsApp: sus fichas nacen **sin teléfono** a propósito. Las únicas
fichas con móvil verificado en Meta son las de **cinco personas del equipo de Espigoladors** (Carles
Sanz, Sebas Sale, Raquel Diaz, Anna Garreta, Laura Masdeu), y tres de ellas solo tenían **cuenta de
equipo** (`super_admin`/`admin`), que no puede ir a los accesos de `/login`.

`scripts/crear-usuarios-whatsapp.ts` resuelve eso creando **cuentas de organización aparte**
(`hola+wa-{carles,sebas,raquel,anna,laura}@carlessanz.com`, sin fila en `usuario_roles`) enlazadas
por membresía a esas mismas fichas. **Nunca crea ni modifica una ficha**: solo enlaza, busca por
correo, y si una no existe avisa y no la inventa — es lo que lo distingue del fixture, que sí crea
organizaciones ficticias, y por eso es un script aparte.

~~**Cuatro de las cinco quedan con doble rol real**~~ — **cierto hasta el 21-09-2026**. Las
cinco fichas siguen existiendo con sus dos papeles (productor y entidad) tal cual las dejó este
script: el doble rol es un HECHO del negocio, no algo que dependa de qué cuenta lo use. Lo que
cambió es el **acceso**: `scripts/escenari-demo.ts` («una cuenta, un papel», §1bis) dejó cada
cuenta con una sola membresía activa —Sebas y Raquel como productores, Laura y Carles como
receptores—, desactivando la del otro papel. La ficha que se queda sin cuenta la sigue operando
el equipo, que es el modelo asistido. Laura Masdeu no tiene teléfono ni está en la whitelist de
Meta: su cuenta sirve para recorrer el panel, no para el canal.

🔴 **Y eso cerró la última cuenta que ejercitaba el doble rol del panel (§6ter) y el arnés
(bloque `doble_rol`, §13).** No queda ninguna cuenta de prueba con dos papeles activos. Si algún
día hace falta volver a comprobar «ver dos paneles a la vez no es ver dos veces la base», hay que
dar de alta una cuenta interna DEDICADA para eso —nunca mostrada en ninguna demo—, con el mismo
criterio que ya se usó para los bloques `pendent` y `sense_rol`.

⚠️ Es idempotente pero **no cambia la contraseña de una cuenta que ya exista**: si se pierden, hay
que resetearlas por la Admin API. Y el aislamiento depende de que `roles_activos` esté encendido
(§4bis): con el interruptor apagado, estas cuentas verían toda la base como cualquier otra.

### Dos cuentas más, y una NO se debe aprobar (14-09-2026)

🔴 **`hola+pendent-arnes@carlessanz.com` tiene una membresía en `pendent` que hay que dejar
como está.** Se dio de alta desde `/registre` —organización `TEST-PENDENT-ARNES`— para que el
arnés vuelva a recorrer el bloque `pendent`, que llevaba desde julio escrito y sin ejecutar. Si
alguien la **aprueba** desde «Registres pendents», ese bloque se queda otra vez sin ninguna
cuenta que lo recorra y **73 comprobaciones dejan de ejecutarse en silencio**. Su compañera,
`hola+senserol-arnes@carlessanz.com`, es una cuenta de Auth sin membresía ni rol, y cubre el
bloque `sense_rol` (70 más).

🔴 **Y YA HA PASADO DOS VECES: el 16-09-2026 y otra vez el 23-09-2026 a las 16:41 (UTC)** —la
segunda, casi seguro, durante la revisión funcional de ese día, que recorrió la cola de
«Registres pendents»—. Restaurada el 27-09-2026 con el procedimiento de abajo. **La primera vez alguien la aprobó** —sin mala intención, probando
la cola— y el arnés pasó a sacar **cuatro FALLA** que parecían una regresión de permisos y no
lo eran: una membresía aprobada y activa *sí* debe ver su ficha, así que la RLS estaba
haciendo lo correcto. Lo destapó el paso 7 de `/publicar`. **Se restaura poniéndola otra vez
en `pendent` con `activo = false`** (y limpiando `aprovat_at`/`aprovat_per`/`motiu_aprovacio`);
desde una sesión con `service_role` el trigger `membresias_control_aprovacio` no estorba,
porque solo exige `pot_aprovar()` cuando hay `auth.uid()`.
⚠️ **La señal para reconocerlo**: las FALLA son todas de la cuenta `pendent-arnes` y dicen
«ve 1 fila(s)» donde se esperaba ninguna. Si además falla `doble-rol` al iniciar sesión, eso
es otra cosa (la cuenta no existe o cambió de contraseña), no esto.

⚠️ **Son datos REALES en producción y hay que saberlo**: la primera aparece en el listado de
productores del equipo y en la cola de «Registres pendents», donde se queda para siempre. Es el
precio de tener esa cobertura, y está aceptado. Sus credenciales viven en
`scripts/data/cuentas-prueba.json`, fuera de git.

### La cuenta de los accesos de prueba de Carles Sanz, reenlazada (21-09-2026)

🔴 **El botón «Carles Sanz» de `/login` llevaba cinco días sin abrir nada.** El borrado con doble
rol del 16-09-2026 (§6) se llevó las fichas a las que colgaba `hola+wa-carles@carlessanz.com`, y
la cuenta se quedó **en Auth pero sin ninguna membresía**: quien pulsaba el botón aterrizaba en
«Compte pendent de validació». El mismo día se registraron desde `/registre` las fichas nuevas
—`Carles Sanz Cardelus` (productor) y `Organització Carles Sanz` (entidad), bajo una sola
`organizaciones`— pero colgando de **otra** cuenta, `hola+productor-receptor@carlessanz.com`, que
**no está en `accessosTest.ts`** y a la que solo se entra escribiendo correo y contraseña.

Se reparó **enlazando**, no recreando: dos membresías `titular` aprobadas y activas de
`wa-carles` a esas dos fichas, que es exactamente lo que hace `scripts/crear-usuarios-whatsapp.ts`.

🔴 **Y aun así el botón SEGUÍA sin abrir nada, porque eran DOS fallos encadenados** (21-09-2026).
Enlazar arregló las membresías, pero la cuenta se había **recreado el 16-09 con otra contraseña**, y
`crear-usuarios-whatsapp.ts` es idempotente **y no toca la contraseña de una cuenta que ya existe**
(§9): así que el botón seguía llevando la del repo y la base tenía otra. El login respondía
`invalid_credentials`, no «pendent de validació» — el mismo síntoma para dos causas distintas.
**Lo que manda es el repo**, y sin ambigüedad: `accessosTest.ts` y `scripts/data/cuentas-prueba.json`
decían la **misma** contraseña, así que lo desincronizado era la base. Se alineó con la Admin API
(`PUT /auth/v1/admin/users/<id>`), no al revés — cambiar los dos ficheros dejaría el de `scripts/data/`
fuera de git y otra vez a merced de que alguien se acuerde (deuda 32).
⚠️ **El orden de comprobación que ahorra el rodeo**: primero `POST /auth/v1/token` con la credencial
del botón (¿entra?), después `membresias` (¿tiene panel?) y solo entonces
`get_my_session_context()`. Al revés se diagnostica el segundo fallo sin ver el primero.
⚠️ Y al leer ese contexto, la clave es **`organizaciones`** (castellano), no `organitzacions`: leer
la catalana devuelve vacío y parece que la cuenta no tiene panel cuando sí lo tiene.

⚠️ **Las dos fichas tienen ahora DOS cuentas titulares**, `wa-carles` y `productor-receptor`. No
es un problema —`membresias` admite varios usuarios por ficha y el producto no distingue cargos
(§9)— pero conviene saberlo al leer un listado: son dos accesos a **una** organización, no dos
organizaciones.

**Y se completó lo que el registro no pregunta**, para que la organización pudiera operar de
verdad: NIF, domicilio, CP y población en las dos fichas (Barcelona / Barcelonès, valores de
prueba), y en la entidad además `tipo_receptor` de `comercial` a **`social`** —con `comercial` no
veía ni una oferta de donación (`modalitat_receptor_compat`, §4bis)—, `estat = 'Signat'`,
`prioritat = 1`, `modalitat = 'Donació'`, `opt_in` y las capacidades. Sin `estat`, la entidad
**quedaba fuera del ranking** (`priorizacion.ts` excluye estado vacío), así que no era candidata
de ningún excedente.

**Sus dos convenios están vigentes** desde el 21-09-2026, `CONV-DON-GEN-2026-0002` y
`CONV-DON-REC-2026-0001`, firmados y contrafirmados desde la base con el mismo camino que usa la
aplicación (`convenio_datos_org` → `firmat` con número → `contrafirmar_convenio()`). Era necesario:
con `fecha_corte_convenios` encendida (§4bis) la única organización que podía operar era
`Mas de Prova SCP`, y **ninguna entidad podía pulsar «M'interessa»**.
⚠️ `Menjador Social de Prova` se deja a propósito en `pendent_firma`: es la única que queda para
enseñar la firma en directo desde el panel y la contrafirma desde la cola.

✅ **`hola+pendent-arnes@` vuelve a estar en `pendent`** (21-09-2026). Estuvo aprobada por error
desde el 16-09 y eso sacaba las cuatro FALLA descritas arriba; se restauró con el procedimiento de
esta sección —`aprovacio='pendent'`, `activo=false` y `aprovat_at`/`aprovat_per`/`motiu_aprovacio`
a NULL, desde `service_role`— y el arnés volvió a **668/668 sin fallos**. La cola de «Registres
pendents» vuelve a marcar 1, que es lo correcto: **esa fila se queda ahí para siempre y no se
aprueba**.

### Lo que sigue pendiente

- ~~El modelo de roles existe pero está apagado~~ — **`roles_activos` está ENCENDIDO** desde el
  30-07-2026 y verificado (§4bis): cada cuenta ve solo lo suyo, y `hola@carlessanz.com` es
  `super_admin`. Dar de alta una cuenta ya **no** equivale a dar acceso total: sin rol ni membresía
  activa no se ve nada. Se revierte con `deno run -A scripts/roles-activos.ts off`.
- `enable_signup = false` vive en el proyecto remoto (Management API) y, desde el 07-10-2026,
  también en `[auth]` del `config.toml` para el clon local. **Debe seguir así**: el alta pasa siempre por
  nuestro código (Admin API o la Edge Function `registro`, que la ignora porque usa `service_role`).
  Si alguien reactivara el flag, cualquiera podría registrarse **saltándose la validación del
  equipo** y quedaría con una cuenta sin membresía —que hoy no ve nada, pero tampoco pasa por la
  cola—. No es una vía de escalada, es una vía de ruido.
- **Los accesos de prueba llevan contraseñas en el bundle** mientras `VITE_ACCESSOS_TEST` esté a
  `true` (hoy lo está, también en Vercel producción). Son solo de organizaciones ficticias `TEST-*`
  (§6quater), pero cualquiera que abra `/login` puede entrar como ellas y ver lo que ellas ven.
  Apagar la variable al salir de la fase de demo.
- **Las claves legacy (`anon` y `service_role` en formato JWT) están deshabilitadas** desde el
  14-09-2026: una petición con la `anon` antigua responde 401. El proyecto ya usaba solo las
  nuevas en los cinco sitios, pero las viejas seguían siendo válidas — que es distinto de no
  usarlas. Detalle, comprobación y cómo revertir, en §7.
- ~~Los datos personales **ya están en remoto**: 341 productores y 111 entidades~~ — **se
  borraron el 16-09-2026** (§6): en la base solo quedan las 15 fichas de prueba. La frase sobre
  la protección sigue valiendo para lo que haya dentro —lo único que lo protege es la
  autenticación de arriba, y está verificado que con la publishable key las tablas responden
  `42501`—, pero **el alcance de una cuenta comprometida ya no son 452 fichas de terceros**. El
  día que se vuelvan a importar (`scripts/import-ara.ts`), vuelve a serlo.
- La app de Vercel tiene además Deployment Protection (SSO), que es una capa de
  plataforma independiente de todo lo anterior.

### ⚠️ No hacer `supabase config push`

Los flags de auth de **remoto** (`external_email_enabled`, `disable_signup`) se gestionan
por el **Dashboard o el Management API**, no por `config.toml`. Dos razones:

1. `config push` ya falla a mitad (error de Storage con esta versión del CLI).
2. Peor: arrastra `enable_signup = false` del toml y **desactiva el login por email en
   remoto** — GoTrue responde entonces "Email logins are disabled", que no es un error de
   contraseña sino del proveedor apagado. Pasó el 21-07-2026 y dejó fuera al equipo.

Para reactivarlo (Management API, con el token de la sesión temporal, §11):

```bash
TOKEN="$SUPABASE_ACCESS_TOKEN"   # dentro de la sesión temporal (§11)
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://api.supabase.com/v1/projects/<ref>/config/auth \
  -d '{"external_email_enabled": true}'
```

Los dos flags se gobiernan **solo desde el proyecto remoto**, con el Management API de arriba.
⚠️ Desde el 07-10-2026 `config.toml` vuelve a tener `[auth]` —para el clon local, con
`site_url` en localhost—, así que un `config push` sería **todavía más dañino** que el de
julio. Sigue prohibido. Y en el clon, `[auth.email] enable_signup` va a `true` a propósito: es el
interruptor del proveedor, y en `false` el stack local apaga el login con contraseña.

