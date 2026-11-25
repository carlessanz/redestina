# AGENTS.md §8bis — 8bis. Canal preferente: el correo es el canal por defecto

> Detalle de la sección 8bis de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §8bis» del código apuntan aquí.

## 8bis. Canal preferente: el correo es el canal por defecto

**Regla (2026-07-30):** WhatsApp solo se usa cuando de verdad se puede; en cualquier otro caso, **correo**.
Nadie se queda sin recibir una oferta porque su ficha no tenga WhatsApp o no lo haya aceptado nunca — y
eso son casi todos: de 345 productores, 61 no tienen móvil utilizable, y las 111 entidades importadas
tienen `opt_in = false`.

Vive en **`_shared/canal.ts`**, función **pura y sin red** (mismo criterio que `priorizacion.ts`):

| Situación | Canal |
| --- | --- |
| Móvil **y** ventana de 24 h abierta | **WhatsApp** (texto libre, gratis, consentimiento implícito: nos acaba de escribir) |
| Móvil **y** `opt_in = true` | **WhatsApp** (plantilla; fuera de ventana es lo único que entrega Meta) |
| Sin teléfono · teléfono fijo · sin opt-in y ventana cerrada | **Correo** |
| **Interruptor `whatsapp_activo` apagado** (§8) | **Correo**, con motivo `whatsapp_desactivat`, sea cual sea la ficha |
| Ni móvil útil ni correo | **ninguno**, y el panel lo dice para que se complete la ficha |

⚠️ **El interruptor se evalúa el PRIMERO**, antes incluso del teléfono: apagado, WhatsApp no es
viable para nadie y da igual qué tenga la ficha. Entra **por parámetro** (`whatsapp_activo`, ausente
= activo), así que el módulo sigue siendo puro y sin red; quien lee `app_settings` es `gate.ts`. Una
preferencia de WhatsApp cae entonces a correo con `preferenciaRespetada: false`, y una ficha sin
correo queda en `cap` — que es el precio de apagarlo, dicho en el panel en vez de fingir un envío.

`esMovil()` descarta los fijos españoles (`34` + algo que no sea `6`/`7`): son 6 en el import de ARA y no
reciben WhatsApp. Fuera de España no se puede saber por el prefijo, así que se acepta: más vale intentarlo
y que lo rechace Meta que descartarlo por nuestra cuenta.

**La organización puede DECIR su canal** (`organizaciones.canal_preferido`, desde la etapa 1 de la
organización unificada). `decidirCanal()` lo recibe **por parámetro** —el módulo sigue siendo puro y
sin red; quien lee la tabla es `_shared/organizacion.ts`— y lo respeta **cuando el canal pedido es
viable**. ⚠️ Una preferencia **no es un permiso**: pedir WhatsApp no abre la ventana de 24 h ni
sustituye al opt-in (son requisitos de Meta, no gustos), así que si no se puede se cae al otro canal
y la decisión lo dice con `preferenciaRespetada: false` — el panel y los logs lo enseñan, porque una
preferencia ignorada en silencio es peor que no tenerla. `null` = deducir como siempre, que es el
caso de todas las fichas que hay. Lo aplican `priorizar-entidades` (por entidad: `canal_preferit`,
`preferencia_respectada`) y `enviar-acceso` (`canal: 'auto'`, por la organización de la cuenta); se
escribe con `actualizar_meu_canal()` desde el perfil (§4bis).

**Quién PUEDE recibir (§8, `es_test`) y POR DÓNDE (esto) son cosas distintas y se aplican las dos.** Hoy,
con el modo test activo, la política de canal solo llega a alcanzar a los usuarios `es_test`.

**Lo decide el servidor, no el panel.** `priorizar-entidades` devuelve por entidad `canal`, `motiu_canal`,
`whatsapp_possible`, `email_possible`, más `email`, `es_test` y el `modo_test` global; `OfferDetail` los
pinta y los obedece, sin recalcular nada (antes tenía su propia heurística, que podía discrepar de lo que
haría el servidor al enviar). El botón **«Enviar»** usa el canal recomendado y **cae al correo si WhatsApp
falla**; los botones «WhatsApp» y «Correu» siguen ahí para forzar uno. `enviar-acceso` acepta
`canal: 'auto'` (el valor por defecto) con la misma política y el mismo respaldo.

**El intake conversacional ocurre siempre dentro de la ventana** (la abre el productor al
escribir), así que no necesita plantilla ni opt-in.

**Proceso de canalización** — cuatro momentos: entrada de oferta (intake) → distribución
(priorizar entidades y avisarlas individualmente) → confirmación (bloqueo al cubrir los kg) →
cierre real (kg reales, albaranes, o marcar `no_colocada` con motivo).

**Valoración**: `valor_eur = kg × productos.eur_kg` (hoy plano a 1 €/kg).


## Plantillas de oferta listas y apagadas (25-11-2026)

- Con la ventana cerrada y opt-in, la oferta puede salir por **plantilla de Meta**: `oferta_excedent` (simple,
  **revisada**: sin productor por D3, con modalidad, precio mínimo, comarca y días, botones «M'interessa»/«Ara no» con
  payload `accept:si|no`) y `oferta_disponibilitat` (multiproducto, nueva: 5 variables y botón de URL dinámica
  `/receptor/mercat?disponibilitat={{1}}`). El texto vive solo en `_shared/plantillasMeta.ts` (módulo hoja; `plantillas-meta.md`
  lo documenta y un test vigila que coincidan); `src/lib/ofertaTemplate.ts` construye los `components`.
- **Apagadas**: `PLANTILLA_OFERTA_APROVADA` y `PLANTILLA_DISPONIBILITAT_APROVADA` = `false` en `src/lib/plantillas.ts`; con
  ellas en `false` todo va como antes (texto en la ventana; si no, correo). Encendida, la multiproducto manda la plantilla
  sola (`EnviamentDisponibilitat`, `potPlantillaGrup`); la simple sigue pidiendo confirmación («Enviar com a plantilla»).
- La respuesta a un botón de plantilla (`type:"button"`, `button.payload`) la normaliza `leerRespuesta` (`_shared/intake.ts`)
  al mismo id que un botón interactivo.
