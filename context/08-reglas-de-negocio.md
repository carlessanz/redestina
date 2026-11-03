# AGENTS.md §8 — 8. Reglas de negocio

> Detalle de la sección 8 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §8» del código apuntan aquí.

## 8. Reglas de negocio

> ⚠️ **Envío real ACTIVADO en remoto** (`WHATSAPP_ENVIO_REAL=true`, 2026-07-22). El interruptor
> (env var) gobierna el único punto que llama a la Graph API (`enviar()` en `_shared/whatsapp.ts`):
> solo si vale exactamente `"true"` sale algo. En remoto ya lo está, así que **sí se contacta con
> Meta**; sin el secreto, o con cualquier otro valor, se **simula** (`status='simulat'`). Lo que evita el desastre en
> remoto es que el número **sigue en el entorno de test de Meta**: Meta solo entrega a los ≤5
> verificados (los de `meta_test_recipients`); el resto lo rechaza con `131030`. **Aviso: si el
> número pasa a producción con el interruptor en `true`, enviaría a TODOS** — revisar lista y flujo
> antes. Afecta a TODO: intake, recordatorios, ALTA/BAJA y ofertas a entidades. Para volver a
> simular: `supabase secrets set WHATSAPP_ENVIO_REAL=false`. El webhook siempre recibe.

### Las notas internas nunca salen por ningún canal (plan 1, rebanada 1F, 02-11-2026)

🔴 `notes_internes` (§4) es el CRM del equipo: lo que se habla por teléfono, en una visita o por
WhatsApp con una entidad. **No sale por ningún canal**: ni correo, ni WhatsApp, ni documento, ni aviso,
ni la ficha del actor («La meva organització»). Ninguna Edge Function ni plantilla la lee, y la RLS
(`es_intern()`) se lo esconde a cualquier cuenta externa. Si un día una función necesitara leerla (con
`service_role`, que se salta la RLS), es una decisión de negocio que cambia esta regla, no un detalle.

### Interruptores de notificaciones: el general, el correo y WhatsApp (27-10-2026)

**Tres interruptores en Configuració › Notificacions, solo para el super_admin**: el **general**
(`notificacions_actives`), el **correo** (`email_activo`) y el de **WhatsApp** de abajo. El canal
EFECTIVO es «general Y canal», y así lo devuelven todos los helpers (SQL `email_activo()`/`whatsapp_activo()`,
Deno `canalsActius()`/`whatsappActivo()`, contexto `useCanals()`).
- **Apagar el general apaga los dos canales; encenderlo no los enciende**: se activan uno a uno.
  Lo impone la base (`fixar_notificacions`, `fixar_canal_notificacio`, §4bis), no la pantalla.
- **Cortan TODA comunicación operativa**, automática o pulsada por alguien (también el super_admin):
  ofertas, avisos, recordatorios, documentos con su PDF, enlaces de firma y de confirmación, el código
  de la firma asistida, la confirmación de oferta y los mensajes manuales.
- 🔴 **No cortan lo TRANSACCIONAL**: el acceso y la bienvenida al aprobar o crear un alta
  (`enviar-acceso`) y la recuperación de contraseña. Es una opción explícita de `sendEmail(…, traza,
  { transaccional: true })` que pasan **solo** esas dos funciones; `enviar-email` no puede, porque su
  propósito viene del cliente. Los gates de prueba (§8) siguen aplicando.
- **El correo de «Dona-li accés» (`donar-acces`, plan 1 1D, 02-11-2026) NO es transaccional**, por
  decisión del plan (§4 de 1D): con el correo apagado la función contesta 409 `correu_desactivat` **antes
  de crear nada**, y el botón sale gris con el motivo (`motiuCanal`). Con el modo test encendido solo da
  acceso a organizaciones cuyas fichas activas sean todas `es_test` (403 `no_test_user`). `sendEmail()` lo
  vuelve a mirar al enviar, y si entonces corta, se deshace todo (§9).
- **Un solo punto de corte por canal**: `sendEmail()` (correo) y `enviar()` (WhatsApp). Cortado,
  devuelve `ok:false`, `status 503`, `desactivado:true` y el código `email_desactivat` o
  `notificacions_desactivades` —nunca un simulado, por lo mismo que §8 explica del de WhatsApp— y lo
  traza en `documento_envios` con estado **`desactivat`**. Sin `traza`, falla cerrado.
- **Por llamador**: `enviar-avis` marca el aviso y **no lo reintenta** (al reactivar no sale una
  avalancha; el aviso sigue en la campana); `recollides-programades` con el correo apagado **no
  renueva los tokens** (`recordar_confirmacions_recollida`), porque dejaría muerto el enlace que la
  persona ya tiene; `generar-documento` genera el PDF y lo deja `desactivat` (se reenvía después desde
  Documents); `enlace-publico` `enviar_codi` responde 503; `decidirCanal()` recibe `email_activo` y
  `notificacions_actives` y devuelve `cap` con el motivo del interruptor, no «sense_canal».
- **La interfaz**: un apartado de un canal apagado desaparece (Missatgeria es WhatsApp: menú, barra,
  ruta —que vuelve al tablero—, KPI y cola del tablero, con `NavItem.requereix` y `filtraPerCanals`);
  **excepción (03-11-2026, decisión de Carles): en el listado «Entitats», «Missatge» y «Correu»
  desaparecen** con su canal apagado (o con todas las notificaciones apagadas), en vez de quedar
  grises: es una tabla de cientos de filas y un botón gris por fila solo ocupa sitio. «Correu» (icono
  `Mail`, «Envia un correu») sigue gris, con motivo, si la organización no tiene correo; «Missatge»
  (`MessageCircle`, «Envia un WhatsApp»), gris si no tiene teléfono. Fuera de ese listado,
  un botón que envía se queda gris con el motivo (`BotoAmbMotiu`, `motiuCanal()` de `lib/canals.ts`):
  «Correu» y «Enviar» de la oferta, «Envia un correu», enviar el enlace del convenio, la tanda de la
  campaña, «Reenvia». Emitir documentos no se bloquea (acto legal): `AvisCorreuDesactivat` avisa en el
  cierre y en el certificado a demanda, y la contrafirma lo dice en su confirmación. «Marcar entregat»
  sigue funcionando y dice que los enlaces no se han enviado. Aprobar un alta no cambia (transaccional).
  En el panel externo, el menú de la persona y la ficha solo ofrecen los canales encendidos.
- ✅ **Probado en el clon** (27-10-2026): reglas de la RPC, `enviar-email` → 503 y traza `desactivat`,
  `enviar-acceso` sale (simulado) con todo apagado, y la E2E `tests/e2e/notificacions.e2e.ts`.
- ✅ **Publicado el 27-10-2026** (`7a5f9b2`): migraciones, las 20 funciones (17 con bundle nuevo,
  `alta-assistida` nueva) y el frontend. En producción los tres interruptores quedan **encendidos**; CORS de
  `alta-assistida` correcto, `registro` rechaza un alta sin privacidad y `generar-documento` sigue generando
  (PDF de prueba de 123.610 bytes, retirado después).

### Interruptor global `whatsapp_activo` (14-09-2026)

**El super_admin puede apagar WhatsApp en toda la plataforma** desde Configuración
(`app_settings.whatsapp_activo`, §4). Apagado: **no sale ni un mensaje** por WhatsApp —intake,
recordatorios, ALTA/BAJA, ofertas, accesos— y todo lo que tiene equivalente sale por correo (§8bis).

**Por qué no servía ninguno de los interruptores que ya había.** `WHATSAPP_ENVIO_REAL` es un
secreto de entorno (no lo toca nadie desde el panel) y, sobre todo, **simula devolviendo
`ok:true`**: ningún respaldo a correo se dispara y el mensaje se pierde en silencio. `test_mode`
decide **a quién** se envía, no **por dónde**.

| Capa | Qué hace con el interruptor apagado |
| --- | --- |
| `_shared/gate.ts` `whatsappActivo()` | La lectura. Fail-safe **encendido** (§4) |
| `_shared/canal.ts` `decidirCanal()` | `whatsapp_activo: false` → `whatsappPosible = false` y motivo `whatsapp_desactivat`; el resto de la cascada es la de siempre (§8bis) |
| `_shared/whatsapp.ts` `enviar()` | **Último cierre**: `503 {code:'whatsapp_desactivat'}` |
| `whatsapp-webhook` | Registra el entrante y abre la ventana; **no contesta nada** (§5) |
| `whatsapp-send` | `503 whatsapp_desactivat` **antes** de los gates de destinatario |
| `intake-recordatorios` | No-op, y el job de `pg_cron` ni la despierta (`disparar_recordatorios_intake()` lo comprueba en SQL) |
| `priorizar-entidades` / `enviar-acceso` | Pasan el flag a `decidirCanal()`; el sobre lleva `whatsapp_actiu` |
| Frontend | Lo recibe en `get_my_session_context()` (`useWhatsappActiu()`): botones de WhatsApp ocultos, composer bloqueado, lista de Meta atenuada |

⚠️ **`enviar()` devuelve `ok:false`, NO un simulado**, y ahí está todo el mecanismo: con `ok:true`
el intake avanzaría de paso sin haber preguntado nada (deuda 3), `enviar-acceso` no caería a correo
y el panel daría por enviada una oferta que nadie ha recibido.

✅ **Ejercitado en producción el 14-09-2026**, apagando y volviendo a encender desde la sesión del
super_admin. Lo medido, con el mismo envío en los dos estados: encendido, `whatsapp-send` responde
`403 no_test_user` (el gate del destinatario); apagado, **`503 whatsapp_desactivat`** —o sea que el
interruptor corta **antes**, como dice el orden de más abajo—. `priorizar-entidades` pasa a
`whatsapp_actiu: false` y el motivo de canal de cada entidad cambia de `telefon_no_mobil` a
`whatsapp_desactivat`. `get_my_session_context()` devuelve `whatsapp_actiu: false`, que es lo que
apaga los botones del panel. Y **ni un `wa_messages` nuevo** en toda la prueba. Dos cosas más que
quedaron comprobadas de paso: un `admin` que no es super_admin recibe **200 con cero filas
afectadas** al intentar escribir la clave (así deniega un `update` la RLS, §12.48), y el cambio es
**inmediato en los dos sentidos** sin redesplegar ni cerrar sesiones —los isolates calientes
obedecieron al instante—, que es justo lo que compra leerlo sin caché (§12.93).

⚠️ **No se registra nada en `wa_messages` al cortar.** Un corte nuestro no es un rechazo de Meta:
una fila `status='error'` pintada en rojo mandaría al equipo a diagnosticar un token que está
perfectamente (§8ter). Queda un `console.warn`.

⚠️ **Se lee en cada envío, sin caché**, a propósito: una caché de unos segundos dejaría a los
isolates calientes enviando después de apagarlo, que es exactamente lo que promete no pasar. El
coste es una lectura por clave primaria de una tabla de tres filas, y solo en el camino de salida.

⚠️ **El precio, y hay que verlo ANTES de pulsar**: las fichas con móvil y **sin correo** quedan
incontactables (`canal: 'cap'`). La confirmación de Configuración cuenta cuántas son
(`fitxesSenseCorreuAmbTelefon()`). Y el **intake conversacional no tiene equivalente por correo**
—no hay sesión de intake sin WhatsApp—: la vía para publicar es el panel del productor
(`crear-oferta`), que ya existía y no toca WhatsApp en ningún punto.

**Lo que gana el correo** para cubrir los momentos que eran solo de WhatsApp: el correo de la
oferta lleva botón **«Mostra interès»** a `/receptor/mercat` (donde `manifestar_interes()` cae en la
misma cola de aprobación); `crear-oferta` manda la **confirmación de oferta registrada** con su
referencia (`proposito='oferta_confirmacio'`), que es lo que el intake manda por WhatsApp; y las
fichas y los listados del equipo tienen **«Envia un correu»** (`DialegCorreu`), que sustituye a la
mensajería manual y queda en `documento_envios` (`proposito='missatge'`).

**Reglas de envío** (decisión D1 del manual; implementadas en `whatsapp-send`; se evalúan
antes del interruptor de arriba, así que en modo PoC un envío bloqueado por regla ni siquiera
llega a simularse):

| Tipo | Condición | Si no se cumple | Por qué |
| --- | --- | --- | --- |
| cualquiera | que no se haya dado de baja (`opt_out_at` ≤ `opt_in_at`) | `403 opt_out` | Escribió BAIXA: no se le escribe nada hasta que vuelva a escribir ALTA |
| `text` | ventana de 24 h abierta (`last_inbound_at` < 24 h) | `409 window_closed` | Es una respuesta de servicio; **no** requiere opt-in |
| `template` | `opt_in = true` | `403 no_opt_in` | La iniciamos nosotros: requiere consentimiento (RGPD + Meta) |

Contacto inexistente → `404 unknown_contact`. Sin sesión válida → `401 unauthorized`.

⚠️ **Orden real de las comprobaciones en `whatsapp-send`**: los gates `403` van **antes** que el
`404`/`409` de esta tabla. Secuencia: `exigirEquipo` (`401`) → validación de campos (`400`) →
**interruptor global (`503 whatsapp_desactivat`)** → gate
`es_test` (`403 no_test_user`) → gate `meta_test_recipients` (`403 no_test_recipient`) → contacto
inexistente (`404`) → ventana/opt-in (`409`/`403`). Un destinatario existente pero no-test recibe
`403`, nunca llega al `404`.

**Modo test global + gate `es_test`** — **fuente de verdad de la app** para permitir el envío,
**independiente de la fase de Meta**. Un interruptor global, **`app_settings.test_mode`** (default
`'true'`, editable desde **Configuració › Notificacions** como «Destinataris», §6ter), decide si se aplica el gate: con el **modo test
ACTIVADO** solo se envía a los usuarios `es_test`; **apagado**, a todos (producción). `es_test` (bool en
`productores` y `entidades`, `20260723110000_es_test.sql`) marca quién puede recibir; se edita por ficha
(CRUD) y decide los listados y los botones del panel. El gate vive en `_shared/gate.ts` (`modoTestActivo`,
`esTelefonoTest`, `esEmailTest`, `esCuentaPermitida`) y se aplica en **seis** sitios: el **webhook** (no
responde a quien no sea `es_test`), **whatsapp-send** y **enviar-email** (`403 no_test_user`),
**intake-recordatorios** (salta a los no-test) y —desde el 30-07-2026— **`enviar-acceso`** y
**`recuperar-password`**. Cubre **todo**: ofertas, intake, recordatorios, ALTA/BAJA, accesos y resets, por
WhatsApp y correo.
**Fail-safe**: si `test_mode` falta o no se puede leer, se trata como ACTIVADO (no se envía a no-test).
Sobrevive al paso a producción de Meta: al vaciar `meta_test_recipients`, el modo test sigue filtrando.
Se arrancó con `test_mode='true'` y `es_test=true` a quienes ya estaban en las whitelists. Solo el
`super_admin` puede togglear `test_mode` (§4bis): apagarlo es sensible y la UI pide confirmación.

⚠️ `esEmailTest` mira **productores y entidades** (antes solo entidades): con el correo como canal por
defecto (§8bis), mirar solo una tabla dejaba sin poder recibir nada a un productor de prueba sin WhatsApp.

🔴 **Revisado entero el 27-10-2026, antes de una importación masiva de productores y receptoras.**
- **Los quince puntos de envío aplican el gate**: `whatsapp-send`, `enviar-email`, `enviar-avis` (la
  ficha `es_test`), el webhook, `intake-recordatorios`, `recollides-programades` (correo y WhatsApp),
  `recordatorios-documentales` (enlaces y facturas), `generar-documento`/`reenviar-documento`
  (`envia-document.ts`), la confirmación de oferta (`correu-oferta.ts`, también la del intake),
  `enlace-publico` (código de firma y aviso de rechazo) y, transaccionales, `enviar-acceso` y
  `recuperar-password` (`esCuentaPermitida`).
- 🔴 **Y ahora también en las dos únicas puertas de salida**, como red para el envío que se olvide del
  gate: `enviar()` (WhatsApp) y `sendEmail()` (correo) devuelven `ok:false` con `no_test_user` si el
  modo test está activo y el destinatario no es `es_test`. Pasan el buzón del equipo (`bustiaEquip`) y
  lo **transaccional** (`sendText(…, { transaccional: true })` del código de acceso,
  `sendEmail(…, { transaccional: true })`), que filtra `esCuentaPermitida`.
- 🔴 **Fallo cerrado ese día**: `esEmailTest` y `esCuentaPermitida` pasaban el correo a `ilike` sin
  escapar, y el `_` vale por cualquier carácter: `joan_puig@x.cat` casaba con una ficha de prueba
  `joan.puig@x.cat`, o sea que un correo real podía pasar por «de prueba». Ahora `patroLiteral()`.
- **Insertar fichas no dispara nada**: los únicos triggers de `productores`/`entidades` son
  organización, municipio y NIF. Ningún job actúa sobre una ficha sin ofertas, enlaces ni avisos.
  `import-ara.ts` no escribe `es_test` ni `opt_in`, así que las fichas importadas nacen `false`.
- **Abrir a todos** («Tots els usuaris») exige el general encendido y pide confirmar con la cifra de
  fichas que no son de prueba (`fitxesNoProva()`); volver a «solo prueba» no pide nada.

**Gate de cuenta** (`esCuentaPermitida`) — los correos de **acceso** y de **recuperación de contraseña**
no van a un productor ni a un receptor, sino a alguien con credenciales de la plataforma, así que `es_test`
no les aplica directamente. Con el modo test activo pasa quien sea **equipo interno** (tiene fila en
`usuario_roles`) **o** esté vinculado por `membresias` a una organización `es_test`. El equipo interno pasa
siempre **a propósito**: dejarlos sin poder recuperar su contraseña los bloquearía fuera de la aplicación
que administran, y para recibir algo hay que tener ya una cuenta con un rol concedido a mano.
`recuperar-password` es **pública** (`--no-verify-jwt`), así que sin este gate cualquiera podría provocar
un correo nuestro a cualquier dirección con cuenta; sigue respondiendo el 200 genérico de siempre, que no
revela si el correo existe ni si pasó el gate.

**Barrera del modo prueba de un documento** (`destinatariosPrueba` en `_shared/gate.ts`, fase 4) —
con `documentos.modo = 'prueba'` solo pasan las direcciones de una organización `es_test` y el buzón
`parametros_documentales.email_equipo`, **aunque `test_mode` esté apagado**. Y esa es toda la
cuestión: el modo test global se apaga el día que Redestina sale a producción, pero los cierres de
prueba se siguen ensayando **cada diciembre**, así que un resumen o un certificado de ensayo no
puede llegar nunca a un donante real. Es la **segunda** barrera —`cierre_destinatario()` en SQL ya
elige a quién se escribe—, y su fail-safe es el de siempre: si no se puede leer el buzón del equipo,
esa dirección se bloquea.

**Gate de la lista de test de Meta** (segunda barrera, requisito técnico del entorno de test): si
`meta_test_recipients` tiene alguna fila y el destinatario **no** está en ella →
`403 no_test_recipient`. Si la tabla está **vacía**, no restringe (§4). Es defensa en
profundidad: la UI ya desactiva el botón, pero el servidor corta aunque la UI fallara. Es
**independiente** del interruptor `WHATSAPP_ENVIO_REAL`: el gate limita **a quién** se podría
enviar; el interruptor, si sale **algo** (hoy, no).

Consecuencia práctica: se puede responder a cualquiera que escriba espontáneamente aunque no
tenga opt-in, pero no iniciar una conversación sin consentimiento.

