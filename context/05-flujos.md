# AGENTS.md §5 — 5. Flujos

> Detalle de la sección 5 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §5» del código apuntan aquí.

## 5. Flujos

**Envío (saliente)** — `Conversation` → `sendWhatsApp()` → `POST /functions/v1/whatsapp-send`
(con el JWT de la sesión en `Authorization`) → aplica las reglas de envío (§8) → `POST
graph.facebook.com/{API_VERSION}/{PHONE_ID}/messages` → upsert en `wa_messages` → Realtime.
Si Meta devuelve error, la función lo reenvía **tal cual** con su status HTTP.

**Recepción (entrante)** — Meta → `POST /functions/v1/whatsapp-webhook` → valida
`X-Hub-Signature-256` (HMAC-SHA256 del cuerpo **crudo**, comparación en tiempo constante) →
upsert del contacto → **upsert** del mensaje por `wa_message_id` → actualiza
`last_inbound_at` → Realtime. Tras validar la firma **siempre responde 200**, para que Meta
no reintente. **Orden exacto**: registra el mensaje → actualiza `last_inbound_at` →
**interruptor `whatsapp_activo`** → gate `es_test` → ALTA/BAJA → **confirmación de albarán**
(desde el 11-10-2026: solo su id de botón `conf:<enlace>:ok|dif`, o un número cuando ese teléfono
tiene exactamente un enlace con `wa_pas = 'kg'`) → respuesta a oferta → intake.
**Gate `es_test`**: el mensaje se registra y abre la ventana, pero solo se **responde** (ALTA/BAJA,
respuesta a oferta, intake) si el número es de un productor/entidad marcado `es_test`; si no, se
deja en la consola para una persona (§8). **Con el interruptor apagado no se contesta a nadie**, y
el mensaje se registra igual: el entrante existió, y la consola es donde el equipo lo ve para
responder por correo.

**Estados** — los `value.statuses` actualizan `wa_messages.status` casando por
`wa_message_id`.

⚠️ **De un saliente INTERACTIVO se guardan además las opciones que se ofrecieron**
(`raw = { boton?, opciones }`, desde el 15-09-2026): `body` solo lleva la pregunta, así que sin
eso no había forma de saber después qué filas se mandaron ni si una descripción llegó cortada
(§12.107). Van **ya recortadas** a los topes de Meta, que corta sin avisar.

**Palabras clave** — `BAIXA` (o `BAJA`, la única que se reconocía hasta el 28-09-2026) pone
`opt_in=false` + `opt_out_at`; `ALTA` pone `opt_in=true` + `opt_in_at`. **Ambas responden
confirmación** por WhatsApp (estamos en ventana, es gratis) y se registran como `outbound`.
🔴 **Y la baja ya corta de verdad** (28-09-2026): `whatsapp-send` responde `403 opt_out` a
cualquier tipo —texto y botones incluidos— mientras `opt_out_at` sea posterior a `opt_in_at`.
Antes solo miraba el opt-in en las plantillas, y escribir BAIXA **abre** la ventana de 24 h:
la siguiente oferta con botones le llegaba igual a quien acababa de darse de baja.
La salutació (`textoSalutacio`, `plantillas-meta.md §0`) pide ahora responder **ALTA**, no «OK»:
un «OK» solo abría la ventana y, con una oferta pendiente, la aceptaba.

**Aceptación de una oferta (diálogo)** — `procesarRespuestaOferta()` (`_shared/respuestas.ts`),
enganchada en el webhook **antes del intake y con prioridad sobre él**. Trabaja sobre la fila
`pendent` de `oferta_respuestas` más reciente para ese teléfono **con `canal = 'whatsapp'`**
(**la última oferta enviada por WhatsApp**; desde el 28-09-2026 —antes una oferta enviada por
correo también capturaba cualquier «ok» que la entidad escribiera por WhatsApp—) y
conduce un **diálogo corto**: un **sí** arranca `dialeg_pas='kg'` («quants kg vols?»); tras el número,
si la modalitat es `venda`/`maquila` con `preu_minim` pide **confirmar el preu** con botones
(`accept:preu_*`) y finaliza dejando `estado='acceptada'`, `kg_solicitados`, `preu_ofert` y
`aprovacio='pendent'`; un **no** claro en el paso inicial o en el paso `kg` pasa a `rebutjada`.
⚠️ **El paso `kg` tiene tope, y se dice antes de preguntar** (16-09-2026): la pregunta lleva
«El màxim són {n} kg» y un número mayor **no avanza el diálogo** —se responde con el aviso y el
máximo, y el paso sigue siendo `kg`—. Hicieron falta las dos mitades: decirlo no obliga a nadie, y
comprobarlo sin decirlo deja a la entidad adivinando. `disp <= 0` significa «no hay tope que
aplicar» y el número entra igual: un tope inventado rechazaría una petición legítima. El caso que
lo motivó está medido — una oferta de 300 kg aceptó **1000** en silencio, y el aviso de «canalitzar
de més» del panel es **no bloqueante**, así que el número podía llegar hasta el albarán.
⚠️ **Y reenviar una oferta reinicia el diálogo** (`registrarEnvio` en `OfferDetail`): el upsert
devolvía `estado` a `pendent` pero dejaba `dialeg_pas` donde estuviera, así que a quien ya había
contestado «sí» el botón «M'interessa» del reenvío le llegaba al paso de los kilos y el bot le
pedía «només el número» sin que nada explicara por qué.

✅ **Tres arreglos del 28-09-2026 en este diálogo**: en el paso `kg` se mira **primero el número**
y después el «no» («no més de 200» es una aceptación con cantidad, y se registraba como rechazo);
la pregunta dice **de qué oferta** se habla («Quants kg de Tomàquet (E-…) en vols?»); y un
mensaje que no es ni sí ni no, con la oferta enviada hace menos de **48 h**, recibe otra vez los
botones [M'interessa] [Ara no] en vez de silencio (o, con doble rol, la guía para publicar).
Quien rechaza el precio ya no recibe «Perfecte… coordinarà la recollida»: se le dice que el
equipo lo revisará.

⚠️ **Rechazar el preu mínimo NO marca `rebutjada`**: la fila queda `estado='acceptada'` con
`preu_ofert=null` y `mensaje_respuesta="L'entitat no accepta el preu mínim (a revisar per l'equip)."`,
y sigue en la cola de aprobación para que el equipo decida. **Mientras el diálogo
está en curso la fila sigue `pendent`** (así el emparejamiento la sigue encontrando). Solo consume
interactivos con prefijo `accept:` (los del intake, `familia:`…, se dejan pasar). **Resuelve el doble
rol**: un número productor **y** entidad con oferta pendiente que contesta se atiende aquí; sin oferta
pendiente o texto no clasificable, devuelve `false` y cae al intake. El **superadmin aprueba** la
aceptación desde el panel y la convierte en canalización (§6ter).

**Intake conversacional** — un productor escribe → el webhook lo identifica por `phone` en
`productores` → `procesarIntake()` (`_shared/intake.ts`). El estado vive en
`intake_sessions` (una fila por teléfono) y cada mensaje se interpreta según `paso_actual`.
Al completarse, `crearExcedenteDesdeSesion()` da de alta el excedente y avisa al productor.
Detalle en §6bis.

**Recordatorio de intake a medias** — la base **no** puede enviar WhatsApp, así que el aviso
de 10 min se dispara así: `pg_cron` (cada 2 min) → `disparar_recordatorios_intake()` →
`net.http_post` (**pg_net**) → Edge Function `intake-recordatorios` → busca sesiones inactivas
entre 10 min y 12 h sin avisar y manda `sendBotones` «Continuar / Cancel·lar», marcando
`recordatorio_enviado_at`. La función se despliega `--no-verify-jwt` y se protege con un secreto
compartido (cabecera `x-recordatorios-secret`) que vive en `app_config` (lo lee el job) y en el
secreto `RECORDATORIOS_SECRET` (lo valida la función). Si el productor pulsa **Continuar** se
reanuda el paso; **Cancel·lar** (o la palabra **`Stop`**) borra la sesión. Detalle en §6bis.

**"Sin contestar"** — `countUnanswered()` (`src/lib/mensajes.ts`, compartido): mensajes `inbound`
posteriores al último `outbound` de ese teléfono. Lo usan `ProducersList` (badge) y `ContactList`
(ordena los contactos con pendientes arriba y muestra el contador).

