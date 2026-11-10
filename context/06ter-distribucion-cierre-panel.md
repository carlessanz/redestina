# AGENTS.md §6ter — 6ter. Distribución, cierre y panel

> Detalle de la sección 6ter de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §6ter» del código apuntan aquí.

## 6ter. Distribución, cierre y panel

**Tres paneles, un mismo dato.** Desde 2026-07-30 la navegación es un **menú lateral plegable**
(§2) cuyo contenido depende del rol (`src/lib/nav.ts`), con rutas propias:

| Panel | Rutas | Qué ve |
| --- | --- | --- |
| **Equip** (`intern`) | `/equip/tauler · ofertes[/:id] · aprovacions · productors[/:id] · entitats[/:id] · missatgeria[/:phone] · **documents** · **albarans[/:id]** · **espigolades/nova[/:id]** · configuracio` | Todo lo que ya existía, más la **cola global de aprobaciones** y la **bandeja de documentos** (§4) |
| **Productor** | `/productor/inici · ofertes · ofertes/nova · ofertes/:id · **documents**` | Sus ofertas, su progreso, el **alta con el mismo cuestionario del intake** y sus **documentos** |
| **Receptor** | `/receptor/mercat · interessos · historic · **documents**` | Las ofertas **compatibles con su `tipo_receptor`** (el filtro NO es de cliente: lo aplica la RLS de `excedentes` con la matriz `modalitat_receptor_compat`, §4bis), su interés, su histórico y sus **documentos** |

### Reunión de seguimiento del 05-10-2026: rebanada 0

Primera rebanada del plan `3. Claude Code/2026-10-05-plan-ejecucion-reunion-seguimiento.md`
(revisión del perfil ofertante con Sebastián). Lo que cambia en los paneles:

- **Equip → Ofertes** tiene botón **«Nova oferta»**: abre `DialegNovaOfertaAssistida`, el mismo
  diálogo de Canalització (no hay segundo formulario), y al crearla lleva a `/equip/ofertes/:id`.
  `OffersList` acepta una prop `accio` para el botón de cabecera.
- **Detalle de oferta → Entitats prioritzades**: ya no se corta en 15. «Veure'n N més» de 15 en 15
  y un desplegable **«Tipus d'entitat»** (`tipo_receptor`) que solo aparece si el ranking tiene más
  de un tipo. `priorizar-entidades` devuelve `tipo_receptor` por fila (no puntúa: solo filtra).
  Lógica pura en `lib/rankingEntitats.ts`; el filtro **no reordena**.
- **Receptor → Mercat**: filtros **Zona** (comarca) y **Tipus de producte** (fruita · verdura ·
  tubercles · fruita seca · altres, agrupando las familias del catálogo con
  `categoriaDeFamilia()`). Sin filtro por defecto; solo se ofrecen valores que dan resultado; se
  recuerdan por entidad en `localStorage` (comodidad: si falla, sin filtro). Lógica pura en
  `lib/filtresMercat.ts`. ⚠️ Las categorías son las de `perfil_receptor.productes_*` a propósito:
  el día que el filtro se preseleccione con lo que declaró la entidad, ya hablan igual.
- **Alta de oferta → Varietat**: ayuda con ejemplos («els quilos es demanen després») en el
  descriptor —la ven panel y bot— y aviso ámbar en el panel si la respuesta es solo un número o un
  peso (`varietatSemblaQuantitat`). No bloquea: el campo es opcional.
- **Convenis**: «Descarta l'esborrany» (`descartar_convenio_esborrany`, §4bis).

### Reunión de seguimiento del 05-10-2026: rebanada 1 (validación, modalidades, franja)

Migración `20270409100000_validacio_i_modalitats.sql`. Tres cambios que van juntos porque los
tres tocan el alta de la oferta y su paso al Mercat:

1. **«Pendent de validació»**. Estado nuevo de `excedentes`. Lo pone el trigger
   `excedentes_validacio` (before insert) cuando una oferta llega `publicada` con `origen`
   `intake` o `panel` **y** `app_settings.validacio_ofertes` no es `'false'` (fail-safe hacia
   validar: `validacio_ofertes_activa()`). Las del equipo (`asistido`) y las de espigolada no
   esperan. La regla vive en la base y no en `crearExcedente()` porque las ofertas entran por
   dos caminos. **No sale al Mercat**: la rama del receptor de la RLS solo admite
   `publicada`/`parcial`. El equipo la valida o la rechaza (con motivo → `cancelada`) con
   `validar_oferta()` / `rebutjar_oferta()` (`pot_aprovar()`), desde la banda
   `components/equip/ValidacioOferta` del detalle; la lista de Ofertes tiene la pestaña
   **«Per validar»** (`?tab=validar`), el menú un badge (`comptador: 'ofertes'`) y el tablero
   la cola **`ofertes_per_validar`** (la 14.ª de `pendents_equip()`). El productor la ve como
   «En revisió» (`estatSimpleOferta` → `validacio`) y la puede cancelar. Interruptor en
   Configuració (solo super_admin). El job de vencidas cancela las que caducan sin validar.
2. **Modalidad múltiple** (D2: el receptor elige, el equipo confirma). `excedentes.modalitats
   text[]` en orden canónico; `modalitat` sigue siendo **la principal** (la primera: la
   donación si está) y la mantiene sincronizada el trigger `trg_excedentes_modalitats`, así
   que todo lo que lee una sola sigue funcionando. La RLS del receptor compara por
   **solapamiento** (`modalitats && modalitats_compatibles_meves()`). El interés lleva
   `oferta_respuestas.modalitat` (`manifestar_interes(…, p_modalitat)` y la asistida); si la
   oferta tiene varias y no se dice, `cal_modalitat`. Aprobar fija la de la entrega en
   `canalizaciones.valorizacion` (`aprovar_resposta(…, p_modalitat)`: la del equipo, la de la
   respuesta o la única), que es la que decide ENT/OPE y el cierre. En el panel: selector
   `components/SelectorModalitat` en el Mercat (solo las modalidades compatibles y, desde el
   corte, con convenio), en Aprovacions y en el detalle de oferta. Módulo puro
   `_shared/modalitats.ts` con copia `src/lib/modalitats.ts` (las vigila
   `tests/modalitats.test.ts`). El descriptor sirve `modalitat` con `multiple: true` (sigue
   siendo `tipo: "opcions"` para el panel anterior) y el bot ofrece una cuarta fila «Totes».
   El alta avisa de las modalidades sin convenio (`modalitats_sense_conveni`) pero **no
   bloquea**.
3. **Franja de recogida**: `hora_recollida_inici`/`_fi` (`time`, check fi > inici). El panel
   pide dos horas con cuartos (06–22 h, `src/lib/franja.ts`); el bot sigue en texto libre y
   `_shared/franja.ts` lo intenta leer («de 9 a 12», «matí»…), y si no lo entiende se guarda
   solo el texto. `horari_recollida` se sigue escribiendo («de 9:00 a 12:30»).

⚠️ **Limitación conocida (deuda 130)**: la pantalla guiada (`/equip/canalitzacio/:id`) no
tiene selector de modalidad. Si la oferta tiene varias y la respuesta no trae la suya, aprobar
desde ahí falla con `cal_modalitat` y hay que hacerlo desde Aprovacions o el detalle.

### Reunión de seguimiento del 05-10-2026: rebanada 2 (avisos, badges y edición)

Migración `20270410100000_avisos_i_edicio.sql` y Edge Function nueva **`enviar-avis`**.

- **Tabla `avisos`**: lo que la aplicación le cuenta a una organización. Cinco tipos
  (`oferta_validada`, `oferta_rebutjada`, `sortida_trobada`, `interes_aprovat`,
  `interes_rebutjat`), destinatario = ficha (`productor`/`entidad`). **Los crean TRIGGERS**
  (`oferta_respuestas_avis` al cambiar `aprovacio`; `excedentes_avis_validacio` al salir de
  `pendent_validacio`), no las RPC: las respuestas se rechazan con un `update` del panel y
  así ningún camino se queda sin aviso. Solo SELECT para `authenticated` (RLS: los de mis
  fichas, o el equipo); se marcan leídos con `marcar_avisos_llegits(ids?, objecte_tipo?)`.
  `crear_avis()` solo `service_role`. Al insertar, `net.http_post` a **`enviar-avis`** con el
  **mismo secreto** que los documentos (`x-documentos-secret`); sin secreto, no-op. Job
  `avisos-pendents` cada 15 min (tres intentos). `enviar-avis` decide canal con
  `decidirCanal()`: WhatsApp solo con ventana abierta, si no correo; respeta `test_mode`
  (`es_test`) y `email_test_recipients`; deja `canal_enviat`/`error_envio`. Los textos:
  `_shared/textAvis.ts` (correo/WhatsApp) y `avis.t_<tipus>` (panel), vigilados por
  `tests/textAvis.test.ts`.
- **Panel**: campana en la barra superior (`components/CampanaAvisos`, solo cuentas con
  organización) y badges `avisos_ofertes` («Les meves ofertes») y `avisos_interessos`
  («Els meus interessos»), del store `lib/avisos.ts` que `AppShell` recarga al navegar.
  Entrar en esas pantallas los da por leídos.
- **`kg_aprovats`** en `oferta_respuestas`: `aprovar_resposta()` ya no pisa `kg_solicitados`.
  «Els meus interessos» enseña «Sol·licitats X · Aprovats Y» y el aviso lo dice.
- **D1** (`contraparts_canalitzacions()`): una vez aprobada la canalización, la entidad ve
  la productora, el municipio y el enlace de Maps; la productora, la entidad de cada entrega.
  Antes de aprobar sigue rigiendo D3.
- **Mercat «noves»**: `perfiles.mercat_vist_at` + `marcar_mercat_vist()`, que se llama al
  SALIR del Mercat. Badge `mercat_noves` en el menú (ofertas con `created_at` o
  `validada_at` posteriores) y chip «Nova» en cada tarjeta durante la visita.
- **Editar una oferta** (`components/DialegEditaOferta`, en el detalle del productor y del
  equipo): kilos, modalidades, precio mínimo, disponibilidad, franja, variedad y
  observaciones; **el producto no**. Va por `POST crear-oferta/editar`, que recompone el
  `texto_oferta` (`textoOfertaDeFila()`) y llama a **`editar_oferta(id, canvis, texto,
  actor)`** (solo `service_role`): kg ≥ canalizado, no quitar una modalidad con entregas,
  historial en `excedentes_canvis`, y **D4**: si el productor cambia kilos o modalidades,
  vuelve a `pendent_validacio`. `validar_oferta()` devuelve entonces `parcial`/`bloqueada`
  si ya había canalizaciones.

### Reunión de seguimiento del 05-10-2026: rebanada 3 (recogida, confirmación y bloqueo)

Migración `20270412100000_recollida_programada.sql` y Edge Function nueva
**`recollides-programades`**.

- **Hora de recogida**: `oferta_respuestas.recollida_at`. El receptor la elige al mostrar
  interés (día ≤ disponibilidad, hora por cuartos dentro de la franja; opcional) y
  `manifestar_interes(…, p_recollida)` la comprueba con `comprova_hora_recollida()`
  (`hora_passada`, `hora_fora_disponibilitat`, `hora_fora_franja`). El equipo la ve y la
  puede cambiar al aprobar (Aprovacions y detalle de oferta, `datetime-local`):
  `aprovar_resposta(…, p_recollida)` la escribe en **`canalizaciones.data_hora_recollida`**
  (la del equipo solo se exige que no sea pasada: puede salirse de la franja si lo ha hablado).
- 🔁 **Sustituida el 17-10-2026** (`20270426100000`, «La recogida la cierra el receptor», más abajo):
  el job ya no emite; los albaranes se generan al registrar los kilos reales. Lo que sigue es histórico.
  **Emisión automática (D3)**: pg_cron `recollides-programades` (cada 15 min) → Edge Function
  → `programar_albarans_recollida()` (solo `service_role`): para cada albarán en borrador cuya
  recogida ha llegado, rellena las líneas con los kilos previstos (el REC con la suma de las
  canalizaciones, no el `kg_total` publicado), **emite y marca entregado** y devuelve los
  enlaces en claro, que la función manda por correo a cada parte (`textConfirmacioRecollida`
  en `_shared/textAvis.ts`; gates de §8). ⚠️ **Consume numeración legal** en cuanto llega la
  hora; un error se corrige con `anular_albaran`/`rectificar_albaran`.
- **Reenvío a las 4 h**: `recordar_confirmacions_recollida()` renueva el token en la MISMA
  fila de `enlaces_token` (`reenviat_at`, una sola vez, solo `canal='email'`); el correo dice
  que el enlace anterior ya no vale.
- **Conciliación automática (D6)**: pg_cron `conciliacions-automatiques` →
  `conciliacions_automatiques()` (reescrita el 07-10-2026, `20270414100100`, tres ramas): (1) REC
  `confirmado` con todas sus salidas confirmadas y `propuesta_conciliacion()` dentro de tolerancia →
  concilia el REC, que arrastra las salidas en cascada (motivo «conciliació automàtica»); (2) ENT/OPE
  `confirmado` cuyo REC ya está `conciliado`; (3) OPE `confirmado` sin REC vivo (venta o maquila puras).
  Un OPE solo llega a `confirmado` cuando han confirmado las dos partes (o la única con enlace; §4bis
  `registrar_confirmacion`). Fuera de tolerancia, la cola `albarans_conciliar` de siempre. El equipo
  también concilia a mano ENT y OPE desde `AlbaraDetall` (con motivo y plazo vencido si no están
  confirmados). ⚠️ Los albaranes de **espigolada** no se emiten solos: el cron los excluye y los lotes no
  llevan hora de recogida; los emite el equipo.
- **Bloqueo 48 h (G1)**: `bloqueig_per_albara(tipo, org)` = albaranes entregados con enlace
  activo sin usar desde hace > 48 h. `crear-oferta` (no asistida) responde `409
  albara_pendent` y `manifestar_interes()` levanta `albara_pendent`; los paneles lo
  traducen y mandan a «Documents → Pendent de tu». ⚠️ El intake por WhatsApp **no** lo
  comprueba todavía.
- **Confirmación asistida con nota**: en `canal='asistido'`, `enlace-publico` exige `nota`
  (con quién y cómo) y la guarda en `evidencias.payload.nota_assistida`; el formulario la pide.
- ⬜ **PDF de una página (F5)**: espera el modelo de Sebastián. Plantillas de WhatsApp
  `confirmacio_recollida_*` redactadas en `plantillas-meta.md §4`, sin dar de alta.

### Reunión de seguimiento del 05-10-2026: rebanada 4 (interés por producto, v1)

- **C3 v1** (D5 todavía abierta, así que con lo que ya hay): las categorías de producto que la
  entidad declara en su perfil (`perfil_receptor.productes_rebre` / `productes_interes` /
  `productes_transformar`, con `tots` = todas) entran en la priorización:
  **`PESO_PRODUCTE` = 2** si la categoría de la oferta (`categoriaDeFamilia()`, copia en
  `_shared/priorizacion.ts` del mismo vocabulario que el Mercat) está entre ellas, con el
  motivo «Li interessa aquest producte». `priorizar-entidades` devuelve
  `interessa_producte` (`true`/`false`, o `null` si no ha declarado nada) y el detalle de
  oferta ofrece la casilla «Només les que diuen que els interessa aquest tipus de producte»
  (`filtraRanking(…, nomesProducte)`), que deja fuera a las que no han dicho nada.
- ⬜ **La v2** (pregunta por producto del catálogo en el cuestionario de entidad) espera a D5.
- ⬜ **H2, convenio único** (`col_productor`/`col_receptor`): espera el texto legal de la
  asesoría (`1. Fuentes/Convenis de colaboracio/`). No hay código.

### Revisión del cliente del 08-10-2026 — fase 1: el destino final de los kilos (11-10-2026)

Plan completo en `3. Claude Code/2026-10-11-plan-revision-avances-08-10.md` (12 fases). La fase 0
(vocabulario) está en «Vocabulario fijado» más arriba. Migraciones `20270416100000` y `…100100`.

**Qué pide la Fundació**: una oferta no puede acabar «Cancel·lada» sin más; cuando pasa la fecha,
Redestina tiene que saber qué pasó con el producto, con **varios destinos y sus kilos**, también
cuando la salida no la gestionó Redestina («trazabilidad del 100 %»).

**El diseño, sin estados nuevos**:

| Estado | Significa ahora | Lo escribe |
|---|---|---|
| `cerrada` | Todos los kilos tienen destino (Redestina + externos) | `registrar_desti_final()` y el trigger `canalizaciones_tanca_excedent` al conciliarse la última canalización |
| `no_colocada` («Sense sortida») | Vencida con kilos sin destino: **falta decir qué pasó** | El job de vencidas (solo desde `borrador`/`publicada`) y el equipo a mano |
| `cancelada` | Retirada por **error o incidencia**, con motivo | `cancelar_meva_oferta()` (sin canalizaciones), el equipo |

- **`excedente_destins`** guarda los destinos externos (`destins_finals`: venda externa, donació
  externa, transformació, alimentació animal, subproducte, compostatge, valorització energètica,
  eliminació, altres). Sin GRANT de escritura: solo `registrar_desti_final()` (§4bis).
- **El job de vencidas ya no toca `parcial`/`bloqueada`**: a esas, si les faltan kilos sin destino,
  solo les pone `desti_reclamat_at` y avisa; la recogida en marcha sigue su curso. Una `publicada`
  vencida pasa a `no_colocada`. Aviso nuevo **`oferta_sense_desti`** al productor, una sola vez
  (`desti_reclamat_at`). ⚠️ **`enviar-avis` se publica ANTES que la migración** (si no, marca el
  tipo desconocido como definitivo).
- La cola `ofertes_vencudes` del tablero (misma clave) pasa a contar «ofertes sense destí registrat»:
  `no_colocada` con kilos sin destino, o `publicada`/`parcial` vencidas con kilos sin destino.
- **Relleno**: la migración pasa a `cerrada` las ofertas ya canalizadas y conciliadas del todo (dos en
  el clon el 11-10-2026), que es lo que el trigger habría hecho.
- **Interfaz**: `components/DestiFinal.tsx`, el mismo en el detalle del productor y en el del equipo
  (modelo asistido). Banda roja cuando hay que pedirlo (`calDemanarDesti`), filas fijas con lo que
  salió por Redestina y filas editables para el resto; `src/lib/destiFinal.ts` puro, con la misma
  regla que `desti_excedent()`. En el modelo del proceso: «Sense sortida» le toca al productor y al
  equipo mientras falte algún kilo y cuenta como «en curs» en Inici; `cerrada` sin REC es la variante
  `tancada`/`desti` («Tancada amb destí»), y con REC conciliado el estado simple se llama ahora
  **«Producte recollit»**; una `parcial` vencida con kilos sin destino lleva la nota
  `proc.*_nota_desti`, sin cambiar de etapa.
- **Venda ≠ donació** en el aviso `sortida_trobada` (correo/WhatsApp): en venta, «contacta amb
  l'empresa per acordar la venda i després indica què ha passat amb els quilos»; en donación, el
  equipo coordina la recogida.
- ⚠️ **Lo que queda**: con un destino externo parcial registrado mientras la oferta sigue
  `publicada`, el Mercat sigue enseñando los kilos totales (no resta los externos). La cola del
  tablero lleva a `/equip/ofertes` sin filtro propio (fase 8 del plan).
- E2E: `tests/e2e/desti-final.e2e.ts` contra el clon (§11).

### Revisión del cliente del 08-10-2026 — fase 2: la ficha de la operación y los avisos (11-10-2026)

Migraciones `20270417100000` (ficha) y `…100100` (avisos, cola y «no m'interessa»).

- **La ficha de la operación** (`components/FitxaOperacio.tsx`, `operacio_detall()`, §4bis): una
  para el receptor y el productor. Lo primero, en grande, la **cantidad asignada** y la recogida;
  después la contraparte con persona y teléfono, y el **punto de recogida completo** —dirección,
  contacto, teléfono, horario, observaciones y Maps— que sale de la ubicación del ofertante.
  `productor_ubicaciones` gana `direccion`, `contacto_nombre`, `contacto_telefono`, `horario` y
  `observaciones`, y `LlocsRecollida` deja editarlos (el municipio y el mapa solo al dar de alta:
  cambiarlos movería la comarca de las ofertas que ya lo usan).
- **Receptor** (`Interessos.tsx`): «Quantitat assignada» destacada y «Sol·licitats» debajo
  (`puntInteres` recibe ya lo asignado, no lo pedido); al abrir un interés asignado manda la ficha
  de la operación y la oferta original queda plegada debajo. Pestaña **«Ofertes per a tu»** con
  las filas `pendent` de ofertas vivas (enviadas por WhatsApp, correo o el panel) y
  **«No m'interessa»** (`declinar_oferta`). El **Històric** es solo lo recibido (ENT/OPE
  confirmado o conciliado), sin «pendents de rebre», ordenado por recepción, con kg asignados y
  recibidos, ofertante y la ficha.
- **Productor**: cada oferta con salida dice, en la lista, en Inici y en el detalle, «Fundació X ·
  250 kg · Recollida 10/10 · 10:00 · Recollida pendent» (`components/LiniesSortida.tsx`, de
  `contraparts_canalitzacions()` en UNA llamada); en el detalle cada línea abre la ficha.
- **Avisos nuevos** (CHECK `avisos.tipus`, `_shared/textAvis.ts`, `avis.t_*`): `recollida_canviada`
  y `kg_assignats_canviats` a las dos partes (trigger en `canalizaciones`, solo si ya había un
  valor), `recollida_confirmada` al productor (trigger en `albaranes` cuando el ENT/OPE queda
  confirmado o conciliado), `oferta_modificada` a las entidades con interés vivo o entrega (trigger
  en `excedentes_canvis`) y `oferta_enviada` al receptor cuando el equipo le propone una oferta por
  el panel (`OfferDetail`, botón «Panell»). `avisos.objecte_tipo` admite `canalizacion` (una
  entrega sin interés previo). `textAvis()` recibe el destinatario: los avisos de las dos partes
  llevan a la pantalla de cada una. ⚠️ **`enviar-avis` antes que la migración**, como en la fase 1.
- **Equipo**: cola nueva `ofertes_modificades` (15 colas; badge de Ofertes) y en el detalle de la
  oferta `components/equip/CanvisOferta.tsx` con lo que cambió (antes → después) y «Marca com a
  revisat». Los cambios del propio equipo no cuentan.
- E2E: `tests/e2e/operacio.e2e.ts` contra el clon (§11).

### Revisión del cliente del 08-10-2026 — fase 3: confirmar la recogida y el albarán de una página (11-10-2026)

Migraciones `20270418100000` (`albaran_datos` v2 y el neto del REC en la propuesta) y `…100100`
(WhatsApp, `registrar_confirmacion` asistida y `confirmar_recollida`).

- **El albarán de UNA página** (`_shared/pdf/render/albara1p.ts`): reproduce el «Albarà de recepció»
  de Espigoladors que mandó el cliente —caja del título con número, logo, frase de trazabilidad de
  las donaciones, caja de la parte, «Data d'elaboració», rótulo DONACIÓ/VENDA/MAQUILA/ESPIGOLAMENT,
  tabla de 8 filas fijas con su total, nota legal y caja de firma con la confirmación—.
  `albaran_datos()` marca los nuevos con `format: 'albara-1p'` y `generar-documento` ramifica por
  él: **lo emitido antes sigue saliendo con `rec.ts`/`ent.ts`/`ope.ts`**. Con más de 8 líneas
  (espigolada grande) pasa a más páginas. Captura del modelo y de la muestra en
  `3. Claude Code/capturas/`.
  🔴 **El REC de DONACIÓN lleva euros** (valor de referencia por kilo e importe), y es decisión del
  cliente: es su modelo, art. 18 Llei 49/2002. El valor sale de `coalesce(excedentes.coste_kg,
  costes_producto.coste_kg)` en el snapshot (`linies[].valor_kg`) y **el importe se calcula al
  renderizar** (kilos validados, confirmados o netos × valor), así `emès` y `conciliat` no
  discrepan. **Nunca en el ENT** —lo lee la entidad: sería el coste del donante— **ni en el
  OPE**. `albaran_lineas` sigue sin columna de importe (el arnés lo vigila igual). La nota legal
  sale de la plantilla `REC` si existe; si no, un texto de trabajo marcado «provisional».
- **`propuesta_conciliacion()`** cuenta lo que confirmó quien entrega (`kg_confirmados` del REC):
  antes lo ignoraba.
- 🔁 **Sustituido el 27-10-2026** por «Registra la recollida en nom de l'entitat»
  (`components/equip/DialegRegistraRecollida.tsx`, `registrar_recollida_assistida()`; §6ter, gestión
  autónoma): `DialegConfirmaRecollida` ya no existe. Lo que sigue es histórico.
  **«Confirma la recollida»** (`components/equip/DialegConfirmaRecollida.tsx`, en `AlbaraDetall` y
  en la fase 5 de la canalización guiada): kilos reales (con la diferencia frente a lo asignado),
  fecha y hora, observaciones y foto (se sube después como `foto_incidencia` del albarán ya
  emitido). Una llamada, `confirmar_recollida()` (§4bis). Avisa antes si el albarán aún es un
  borrador: confirmarlo consume número.
- **WhatsApp como vía de confirmación**: `enlaces_token.canal` admite `whatsapp`, con
  `destinatario_telefono`, `wa_pas` y `wa_preguntat_at`. `recollides-programades` (cada 15 min)
  manda a cada enlace vivo sin pregunta los botones «Tot correcte» / «Hi ha diferències»
  **solo con la ventana de 24 h abierta** —fuera de ella Meta exige una plantilla que no está
  aprobada (`plantillas-meta.md §4`)— y con los gates de §8. El webhook registra con
  `registrar_confirmacion()`; el PDF imprime «Confirmat per WhatsApp». Sin token: lo que autoriza
  es que el botón llega desde el teléfono de la ficha.
- **Cada parte firma lo suyo**: el acta de `enlace-publico` y el formulario dicen «he lliurat» /
  «Confirma l'entrega» a quien entrega, y «he rebut» / «Confirma la recepció» a quien recibe
  (antes el productor firmaba «he rebut»). «Pendent de tu» dice «Confirma l'entrega».
- `AlbaraDetall`: transportista, matrícula y temperatura, plegados en «Dades addicionals».
- Pruebas: `tests/confirmacions.test.ts` (Vitest), `tests/pdf/albara1p_test.ts` (Deno: una página,
  euros solo en el REC de donación, varias páginas con 40 líneas), y E2E
  `tests/e2e/recollida.e2e.ts` contra el clon (equipo confirma con 5 kg menos → todo conciliado y
  PDF de 1 página; productor «Producte recollit»; receptora en Històric; la productora confirma
  su entrega desde «Pendent de tu»).
- ⚠️ **Queda para después**: la plantilla de Meta para preguntar fuera de la ventana, y el texto
  legal del REC validado por la asesoría (§12.71).

### La recogida la cierra el receptor (17-10-2026)

Migración `20270426100000_registrar_recollida_receptor.sql`. Pedido de Carles para cerrar el flujo
de principio a fin: (1) el ofertante publica y el equipo valida; (2) el receptor muestra interés y
el equipo lo aprueba; (3) el receptor va a recoger; (4) **después, el receptor registra los kilos
reales** —«coincideixen», «menys» o «més»—; (5) **con esa cantidad se generan los dos albaranes**,
REC (ofertante → Espigoladors) y ENT (Espigoladors → receptor), por los mismos kilos. **Sin segunda
confirmación del ofertante**; una diferencia se registra como incidencia y la revisa el equipo.

🔴 **Y desde `20270428100000` (mismo día) los albaranes los genera la VALIDACIÓN DEL ADMIN, no el
registro** (decisión de Carles: «los albaranes solo se generan cuando el admin aprueba que el
receptor ha recibido la cantidad que indica»; confirmada para todos los casos, coincidan o no los
kilos). Lo que sigue en esta sección sobre «emite en una transacción» describe lo que hacía el
registro hasta esa migración: **ahora lo hace `validar_recollida()`**. El flujo vigente:

1. **El receptor DECLARA** con `registrar_recollida()` (misma firma y mismos rechazos): guarda
   `kg_declarats`, `resultat_recollida`, `observacions_recollida`, `recollida_real_at`,
   `recollida_registrada_at/per` y, con menys/més, `incidencia_recollida`. **No emite, no gasta
   número, no concilia ni toca `kg_reales`**; revoca los enlaces de confirmación vivos. Devuelve
   `{estat:'pendent_validacio', kg_declarats, kg_assignats, resultat}`. La ficha dice «Pendent de
   validació de l'equip» y ya no ofrece el formulario.
2. **Un ADMIN valida** (`pot_aprovar()`; el `tecnic` no: `42501`) desde la cuarta cola de
   **Aprovacions, «Recollides per validar»** (`#recollides`; cola `recollides_per_validar` de
   `pendents_equip()`, que pasa a 16 filas, y badge del menú): `validar_recollida(canalizacion,
   kg?, motiu?)`. Puede corregir los kilos; el motivo es obligatorio si los corrige o si lo declarado
   no coincide con lo asignado (`cal_motiu_validacio`). Solo entonces emite el ENT/OPE con los kg
   validados, confirma las partes por declaración (la evidencia dice que lo validó el equipo, y si
   corrigió, kg declarados frente a validados), emite el REC cuando ya no falta ninguna salida por
   validar (`esperant_altres`) y **concilia** (la validación es la revisión: motivo o «Validat per
   l'equip»). Una corrección queda en `incidencia_recollida` como `tipus:'correccio_equip'`.
3. **O la retorna** con `retornar_recollida(canalizacion, motiu)`: limpia el registro (lo declarado
   pasa a `historial_recollida`), deja `recollida_retornada_at`/`motiu_retorn` y avisa a la entidad
   (`recollida_retornada`, §6ter avisos). El receptor la vuelve a registrar.

🔴 **El candado lo pone la base, no la pantalla**: `emitir_albaran()` responde `22023
recollida_no_validada` a cualquier albarán del flujo de recogida (ENT/OPE de una canalización y REC
de su oferta, salvo espigolada) fuera del contexto `redestina.validacio_recollida`, que solo fijan
`validar_recollida()`, `confirmar_recollida()` (que pasa a `pot_aprovar()` y marca la canalización
validada) y `rectificar_albaran()`. Y el trigger `canalizaciones_protegeix_recollida` impide escribir
las columnas de la recogida fuera de esas RPC (el GRANT de UPDATE de `canalizaciones` es de tabla).
El botón «Emet» de `AlbaraDetall` queda gris en esos borradores y su «què toca» dice que espera la
validación (`alb.next_borrador_validacio`). ⚠️ **El borrador sin número sigue naciendo al aprobar el
interés** (trigger `canalizaciones_crea_albaranes`): no es un documento —ni número ni PDF ni lo ve
ningún externo—, es la ficha que la validación rellena. Las espigoladas no cambian: no hay receptor
que declare, el equipo emite como siempre. Relleno: lo ya registrado con el flujo anterior y
conciliado pasa a validado; lo que tenía incidencia sin conciliar queda «per validar».
⚠️ Los fixtures `crear-respuestas-prueba.ts` (ya no emite el ENT) y `crear-datos-documentales-prueba.ts`
(la venta del CT pasa por registrar + validar con sesiones) se adaptaron en el mismo cambio.
Probado en el clon: E2E `recollida.e2e.ts` 24 correctas (registrar no consume número; el admin
valida y salen ENT y REC conciliados; menys sin motivo rechazado; técnico 42501; retornar y volver a
registrar) y arnés 1.474/1.474.

- **`registrar_recollida(canalizacion, resultat, kg_reals, data, observacions)`** (§4bis), desde
  **la ficha de la operación** del receptor (`components/RegistraRecollida.tsx`, dentro de
  `FitxaOperacio`: Interessos e Històric; no es un diálogo porque la ficha ya va dentro de uno).
  Solo una cuenta con membresía activa en la entidad receptora de ESA canalización (permiso antes
  que existencia: `42501`). En UNA transacción: emite y entrega la salida (ENT/OPE) con los kilos
  REALES (`kg_neto`; `kg_previstos` se queda con lo asignado), confirma la parte `recibe` con un
  enlace `canal='panel'` acuñado y consumido al momento (`creado_por` = la cuenta, sin
  `asistido_por`), y cuando ya no falta ninguna salida del registro emite y confirma el **REC** con
  la suma de lo real **por declaración del receptor** (rol `entrega`, cargo «Recollida declarada
  per <entitat>», que es lo que imprime el PDF). En un OPE, las dos partes, igual. Revoca cualquier
  enlace de correo o WhatsApp que quedara vivo. Con varias entidades sobre una misma oferta, el REC
  lo cierra la última que registra (`esperant_altres`).
- **«Coincideixen»** → `propuesta_conciliacion()` dentro de tolerancia → **concilia en cascada**: los
  PDF definitivos (versión `conciliat`) salen con los kilos reales y la oferta pasa a `cerrada`.
  **«Menys»/«Més»** exigen motivo (`falta_motiu_diferencia`) y guardan la incidencia en
  `canalizaciones.incidencia_recollida` y en `albaranes.incidencias` (ENT y REC): los albaranes
  salen por lo real pero **no se concilian**; quedan en la cola `albarans_conciliar` y el equipo
  los concilia a mano con motivo desde `AlbaraDetall`. ✅ **Ese «con motivo» lo impone la base
  desde `20270427100000`**: antes no lo exigía nadie, porque el REC (suma de lo real) y las salidas
  (kg reales) cuadran entre sí y la propuesta salía dentro de tolerancia. Ahora `conciliar_albaran()`
  responde `22023 cal_motiu_incidencia` sin motivo, y `AlbaraDetall` pinta la banda
  «Incidència de recollida» (menys/més, assignats → reals, el motivo de la entidad y cuándo),
  marca el motivo como obligatorio en el diálogo y la lista de Albarans lleva el badge «Incidència». `conciliacions_automatiques()` salta todo
  REC con una salida con incidencia (`rec_te_incidencia_recollida()`), y las ramas 2 y 3 también.
  Cero kilos no se registra (`kg_zero`): no se recogió, es cosa del equipo, y no se gasta número.
- **El job de la hora de recogida YA NO EMITE** (D3 de la rebanada 3, sustituida a petición de
  Carles: «los albaranes se deberían generar en el punto 4, no antes»). `programar_albarans_recollida()`
  ahora solo crea, una vez por canalización (`registre_demanat_at`), el aviso nuevo
  **`recollida_per_registrar`** a la entidad, y devuelve `[]`, así que `recollides-programades` no
  manda ningún enlace. Ningún número legal se gasta con kilos previstos y al ofertante no le llega
  nada que confirmar. La migración marca como ya avisadas las recogidas de hace más de 2 días.
  ⚠️ **Una entidad sin panel** (solo WhatsApp/correo) no puede registrar: recibe el aviso, que le
  dice que avise al equipo, y el equipo usa **«Confirma la recollida»** (`confirmar_recollida()`,
  que ya emitía desde borrador). La cola `albarans_esborrany` del tablero es donde se ven.
- **Lo que ya estaba en marcha sigue funcionando**: un ENT/REC emitidos por el job antiguo
  (`entregado`, con enlaces) también se cierran con el registro del receptor —los enlaces vivos se
  revocan— o por el camino de siempre (enlace del correo, «Pendent de tu», WhatsApp).
- **`operacio_detall()`** gana `pot_registrar` (la misma condición que la RPC), `recollida_real_at`,
  `recollida_registrada_at`, `incidencia_recollida`, `rec_numero` y `rec_estat`. La ficha enseña
  «Has registrat la recollida: X kg» y, con incidencia, la banda ámbar «Diferència en revisió»; al
  productor le añade «Si no hi estàs d'acord, digues-l'hi» y el número del REC.
- **El proceso del receptor** (`procesOferta.ts`): «Assignada» pasa a `emToca = true` («Quan l'hagis
  recollit, registra els quilos a la fitxa de l'operació»).
- Lógica pura de la validación en `src/lib/registreRecollida.ts` (la misma regla que la RPC, para
  avisar bajo el campo), con `tests/registreRecollida.test.ts`.
- **Probado** contra una réplica de la base (las 175 migraciones sobre PostgreSQL 16 con un shim de
  Supabase) en todos los casos —coincideix, menys, més, varias entidades, OPE, albaranes ya
  entregados por el job antiguo, permisos de las tres cuentas ajenas y del equipo, y el job— y en
  el navegador con el frontend real servido contra PostgREST. E2E `tests/e2e/recollida.e2e.ts`
  reescrita para el flujo nuevo (clon).
- **Lo que el equipo ve, el receptor y el ofertante** (`20270427100000`, mismo día, tras las notas
  del cliente que pedían «registrar como incidencia y revisar con el admin»):
  - `pendents_equip()`: **`albarans_esborrany`** ya no cuenta todos los borradores —con este flujo
    cada operación asignada lo es, esperando al receptor—, solo los que son trabajo del equipo:
    espigoladas, ENT/OPE con la recogida pasada sin registrar (o sin hora y más de 2 días), los REC
    de esas ofertas y los borradores sueltos. El tablero los llama «recollides passades sense
    registrar». **`albarans_conciliar`** suma los ENT/OPE confirmados sin REC vivo (venta y maquila
    con incidencia: antes no subían el contador) y los que tienen incidencia con el REC ya conciliado.
  - El Històric del receptor decide «rebuda/tancada» **solo por el estado del albarán**: antes
    `kg_reales != null` daba la entrega por cerrada, y ahora ese campo lo escribe el registro, así
    que una incidencia en revisión salía cerrada. Con incidencia, badge «Diferència en revisió»;
    en «Els meus interessos», la variante `proc.r_confirmada_incidencia_*`. Lectura pura de la
    incidencia (objeto o lista) en `src/lib/incidenciaRecollida.ts`.
  - El aviso `recollida_confirmada` al ofertante lleva `kg_assignats` y `diferencia` (calculada con
    los kg de las líneas, porque cuando salta el trigger `incidencia_recollida` aún no está escrita):
    con diferencia dice lo recogido frente a lo asignado y que el equipo lo revisa
    (`_shared/textAvis.ts` y `avis.t_recollida_confirmada_dif` en el panel).
  - Probado en el clon con la E2E `recollida.e2e.ts` (16 correctas, 2 saltadas a propósito), que
    ahora comprueba la banda y que conciliar sin motivo se rechaza.
- ⚠️ **Publicar**: `enviar-avis` **antes** que las dos migraciones (tipo de aviso nuevo y params
  nuevos, como en las fases 1 y 2), y `20270427100000` después de `20270426100000`.
  `recollides-programades` no cambia.

### Revisión del cliente del 08-10-2026 — fase 4: el certificado se revisa antes de firmarse (11-10-2026)

Migración `20270419100000`. Hasta hoy emitir el certificado de donación ERA firmarlo (la emisión
estampa la firma de la apoderada) y el donante no veía nada antes. Ahora hay un paso en medio:

- **`revisio_estat`** en `cierres_donante` y `cierres_periodo` (`pendent_revisio` →
  `aprovat_ofertant` | `aprovat_equip`), **un eje aparte de `estado`**, que no se toca. Lo pone un
  trigger: el anual cuando el cierre pasa a `tancat` y el donante tiene kilos y valor sin
  bloqueos; el a demanda al calcularse. Si un recálculo cambia los kilos o el valor de uno ya
  aprobado, **vuelve a «per revisar»**. Al entrar en revisión, aviso `certificat_per_revisar` al
  donante (campana y correo; `avisos.objecte_tipo` admite `cierre_donante` y `cierre_periodo`).
  ⚠️ El aviso va en un trigger `after update` **a secas**: `update of revisio_estat` no salta
  cuando quien pone la columna es el trigger BEFORE.
- **El donante aprueba** desde «Els meus certificats» (`components/documents/RevisioCertificat`,
  en ámbar: le toca a él) con `aprovar_certificat_ofertant()`; **el equipo puede aprobar en su
  nombre** con una nota (`aprovar_certificat_equip()`, `pot_aprovar()`), en `TancamentDetall`
  («Aprova en nom del donant») y en el diálogo del certificado a demanda.
- **En REAL, `emitir_certificado()`, `emitir_certificado_periodo()` y la tanda exigen la revisión
  (`22023 sense_revisio`; la tanda lo salta con ese código) y que firme el `super_admin`**
  (`42501`; el botón pasa a «Signa i emet»). **En prueba no se exige nada**: el ensayo se recorre
  entero como antes.
- **El PDF del CD imprime la revisión**: «Xifres revisades i aprovades pel donant el …» o
  «aprovades per l'equip … en nom del donant (persona, data): nota» (`datos.revisio`, que añade
  `certificat_revisio_snapshot()`; lo emitido antes no la lleva y no imprime nada).
- «Els meus certificats» del productor y los documentos del receptor estrenan títulos con icono
  (`components/documents/TitolSeccio`). Veure / Descarrega ya estaban.
- ⚠️ **Corregido de paso**: la fase 3 había sobrescrito `crec.title`, `crec.desc` y `crec.err_kg`
  —son del CERTIFICADO DE RECEPCIÓN— con los textos de «Confirma la recollida». Esos pasan a
  `recol.*` y los `crec.*` vuelven a su valor.
- E2E `tests/e2e/certificats.e2e.ts` (clon, solo escritorio: toca el cierre de prueba compartido,
  y lo deja como estaba con `reiniciar_cierre_prueba()`).

### Revisión del cliente del 08-10-2026 — fase 5: el Conveni de col·laboració único (11-10-2026)

Migración `20270420100000`. Una organización necesitaba hasta dos convenios —el de donación de su
papel (`don_gen`/`don_rec`) y el comercial (`com`)—; ahora firma **uno**, el **Conveni de
col·laboració**, uno por papel: `col_productor` y `col_receptor` (series `CONV-COL-PROD` y
`CONV-COL-REC`), que cubren donació, venda y maquila.

- **`convenios_exigidos` solo pide `col_*`.** Los convenios **anteriores siguen valiendo exactamente
  para lo que valían** gracias a `convenis_equivalents` (`tipo_nou`, `tipo_antic`, `valorizacion`):
  un `don_gen`/`don_rec` vigente cubre la donación y un `com` la venta y la maquila, ni más ni menos
  —lo firmado con un texto de donación no pasa a autorizar una venta por cambiar de nombre—. La
  equivalencia la aplican `convenio_vigente()` (y con ella `exigir_convenio()`),
  `canalitzacio_assistida()`, `canalitzacions_actives()`, las vistas de la campaña y, en el cliente,
  `src/lib/convenisEquivalents.ts` (puro, con prueba) en Nova oferta y el Mercat.
- **Plantillas**: `CONV` variante `col_productor`/`col_receptor` en ca y es, derivadas de las de
  donación con otro título y una cláusula que dice que cubren las tres modalidades; texto de
  trabajo marcado como borrador (§12.77). Las seis anteriores, `vigente = false`. La cláusula del
  albarán dice ya que en las donaciones lleva el valor de referencia (fase 3).
- **`signar_conveni_propi()`** prepara el `col_*` del papel y **conserva la guarda de `d8b25d1`**
  con la equivalencia: «ja tens un conveni vigent» solo si lo vigente ya cubre TODAS las modalidades
  (`conveni_cobreix_tot()`). Con solo el `don_gen`, puede firmar el nuevo para vender. Nova oferta y
  el Mercat enseñan ese caso con un botón «Signa el conveni» (el aviso general no sale: para esa
  organización el convenio ya está «vigent»).
- **Los convenios anteriores a medio firmar** (borrador o enviado, sin número ni escaneado) se
  borran con sus enlaces, como `descartar_convenio_esborrany()`: si no, «Pendent de tu» pediría dos.
- `registro`, la campaña de convenios, la canalización guiada y el registro en papel preparan el
  tipo nuevo (en papel se pueden seguir registrando los anteriores). Los tres anteriores se nombran
  «(anterior)» en la interfaz.
- **Dos defectos reales que destapó el E2E**: (1) los diálogos que acuñan un enlace
  (`DialegFirmaConveni`, `DialegAssistit`, `DialegFirmaAssistida`) lo acuñaban **dos veces** si el
  efecto se repetía —`StrictMode`, o un cambio de `t`—, y como acuñar revoca el anterior la pantalla
  podía quedarse con el revocado («Aquest enllaç s'ha anul·lat»): ahora una petición por apertura;
  (2) el formulario de firma tenía **dos campos con `id="sig-carrec"`** (el cargo de la ficha y el de
  quien firma): los de quien firma pasan a `sig-signant-*`.
- Los frenos anti-abuso de `enlace-publico` (10 por IP cada 10 min, 50 evidencias por hora) se
  pueden subir con `ANTIABUS_MAX_PER_IP` y `ANTIABUS_MAX_EVIDENCIES_HORA`, **que solo define el
  clon** (`preparar-entorno.sh`): la batería E2E los agotaba.
- E2E `tests/e2e/conveni.e2e.ts` (clon, solo escritorio).
- ⚠️ Queda: el texto legal de la asesoría, y unificar los mínimos de la firma (`MIN_NOM`/`MIN_DNI`,
  repetidos en `FirmaConveni.tsx` y `enlace-publico/convenio.ts`).

### Revisión del cliente del 08-10-2026 — fase 6: filtros y orden comunes en los listados (11-10-2026)

Sin migración. Una misma lógica de filtros en todos los listados:

- **`src/lib/filtres.ts`** (puro, con prueba): un listado declara sus dimensiones (`Dimensio`:
  zona, producto, modalidad, estado…) y un rango de fechas opcional; `filtraLlistat()` acota en
  cliente lo que ya llegó, `opcionsDisponibles()` solo ofrece valores que dan resultado con los
  demás filtros puestos (y conserva el elegido), y **`ordenaPerDisponibilitat()`**: primero lo que
  sigue en marcha, la que se acaba antes arriba (sin fecha, al final del grupo); después lo
  cerrado, lo más reciente arriba.
- **`components/BarraFiltres.tsx`** + **`hooks/useFiltresLlistat.ts`**: desplegables nativos
  (`text-base md:text-sm`), rango de fechas, «Neteja els filtres», «Mostrant N de M»; en móvil,
  plegada detrás de «Filtres (n)». Se recuerda por pantalla y organización en `localStorage`
  (comodidad, no estado). ⚠️ El hook usa actualizaciones funcionales: con `{ ...estat }`, «Neteja»
  volvía a poner los filtros que acababa de quitar (lo destapó el E2E).
- **Dónde**: «Les meves ofertes» (estado simple, producto, modalidad, fecha de alta; orden por
  disponibilidad, también en lo «en marcha» de Inici), Ofertes del equipo (zona, tipo de producto,
  producto, modalidad, fecha de alta, y «Ordena per» disponibilidad o más recientes), el Històric
  del receptor (producto, modalidad, entidad productora, zona y fecha de recepción; el total de
  kilos es el de lo filtrado), Entitats productores y receptores (zona). El Mercat conserva sus
  filtros de la rebanada 0, que ya eran estos.
- **Entitats prioritzades**: zona y **última recepción** (últimos 3 meses / último año / nunca),
  además del tipo de entidad y el interés por producto; cada fila dice «Última recepció: …».
  `priorizar-entidades` devuelve `comarca` y `ultima_recepcio` (la última canalización
  conciliada). No puntúan. ⚠️ Redesplegar `priorizar-entidades`.
- ⚠️ El tipo de entidad en el listado del equipo espera a la fase 7: `v_entidades_llistat` todavía
  no trae `tipo_receptor`.
- E2E `tests/e2e/filtres.e2e.ts` (lectura).

### Revisión del cliente del 08-10-2026 — fase 7: la ficha de la organización (11-10-2026)

Migración `20270421100000`.

- **Tipus d'activitat** (selección múltiple, separada de «Tipus d'empresa o entitat»): catálogo
  `tipus_activitat` con las dos listas del documento y a qué papel aplica cada opción;
  `productores.tipus_activitat` y `entidades.tipus_activitat` (`text[]`), validadas por las RPC de la
  ficha (`tipus_activitat_desconegut`).
- **Modalitats que m'interessen** del receptor (`entidades.modalitats_interes`, compra = `venda`):
  su PREFERENCIA. La elegibilidad sigue en `tipo_receptor × modalitat_receptor_compat` (no hay una
  segunda regla por tipo de entidad: si la Fundació decide que una SL no recibe donaciones, es una
  fila en la matriz). El listado del equipo dice «Modalitats» y filtra por tipo de entidad.
- **Com podem oferir-te excedents?** (receptor): `PREFERENCIES_RECEPCIO` en `perfilReceptor.ts`
  —productos, cantidad habitual y periodo, capacidad máxima por recepción, frecuencia, si puede
  recoger, zona máxima, conservación y equipamiento—, en el mismo `perfil_receptor`; el bloque propio
  del tipo ya no repite esas claves. `priorizar-entidades` devuelve `tipus_activitat`,
  `capacitat_maxima` y `quantitat_habitual`, y «Entitats prioritzades» filtra por actividad y por
  «poden rebre N kg d'una vegada». ⚠️ Redesplegar `priorizar-entidades`.
- **Persones de contacte**: `organizacion_contactos` (nombre, función, teléfono, correo, tipo
  `general·administratiu·recollides·altres`), por organización, sin escritura directa: RPC
  `desar_contacte_org()` y `esborrar_contacte_org()` (titular de alguna ficha de la organización,
  `soc_titular_org()`, o el equipo). `components/ContactesOrganitzacio`.
  ⚠️ **Retirado el 02-11-2026 (plan 1 1A, D3: un contacto por ficha)**: la sección y el componente ya
  no existen y las dos RPC solo las ejecuta `service_role`; la tabla se conserva (P6, deuda 146).
- **NIF válido y único por organización**: `nif_valid()` (la misma regla que `errorNif()` de
  `validacio.ts`) y el trigger `*_nif` en las dos tablas de fichas, al insertar o cambiar el NIF:
  `nif_invalid` o `nif_en_us` (otra organización). Las dos fichas de un doble rol lo comparten. El
  registro los traduce. ⚠️ Una ficha con un NIF inválido de antes **no deja guardar** la ficha propia
  hasta corregirlo (el cliente lo pide así); las de prueba de producción tienen NIF como `B00000001`.
- **Raó social obligatoria**: en rojo en la ficha y en la banda de «fitxa incompleta»
  (`CAMPS_NECESSARIS`). Es el nombre de convenios, albaranes y certificados.
- **Rol a REDESTINA**: «Ofereixo excedents» / «Busco / rebo excedents». Marcar el otro papel
  (`afegir_paper_organitzacio()`) crea la ficha hermana en la misma organización con los datos comunes
  y una membresía **pendiente**, que el equipo valida en «Registres pendents» como un alta. Una
  entidad nueva nace sin `tipo_receptor` (lo fija el equipo). Desmarcar no se ofrece.
- `v_productores_llistat` y `v_entidades_llistat` añaden las columnas nuevas al final.
- ⚠️ Queda: que la ficha de la operación use el contacto de recogidas de la organización cuando el
  lugar no tiene contacto propio. (Editar actividad y modalidades desde la ficha del equipo: hecho
  en 1C, 02-11-2026.)
- E2E `tests/e2e/organitzacio.e2e.ts` (clon, solo escritorio).

### Revisión del cliente del 08-10-2026 — fase 8: tablero, canalización guiada y foto por WhatsApp (11-10-2026)

Migración `20270422100000`.

- **Indicadores con periodo** (`components/equip/IndicadorsPeriode`, `kpis_equip(desde, hasta)`):
  año, mes o rango, en hora de Madrid. Kg canalizados (conciliados, D13), kg asignados,
  canalizaciones y a cuántas entidades, ofertas nuevas y sus kg, y ofertas sin salida. `security
  invoker` con guarda de equipo, como `pendents_equip()`. El bloque de «d'un cop d'ull» se queda.
- **Badge de Ofertes** = por validar + modificadas + **publicadas sin enviar** (una oferta que crea
  el equipo nace publicada y no marcaba nada).
- **Colas del tablero**: todas con la fórmula «què ha passat → què falta → acció»; las cuatro que
  no tenían segunda línea (mensajes, ofertas sin enviar, albaranes por emitir, PDF con error) ya la
  tienen.
- **Canalización guiada**: columna «Acció pendent» en el índice (qué toca y, si está bloqueado, por
  qué). Y **la deuda 130 se cierra**: al aprobar un interés de una oferta con varias modalidades, la
  pantalla pide la modalidad de esa entrega.
- **La foto de la oferta por WhatsApp y por correo**: `whatsapp-send` (tipo `botones`) y
  `enviar-email` aceptan `foto_excedente`; el servidor firma la foto principal del bucket
  `fotos-ofertes` (`_shared/fotoOferta.ts`, 24 h en WhatsApp, 7 días en correo) y la pone como
  cabecera de imagen del mensaje con botones o encima del texto del correo. La consola de
  Mensajería registra `[imatge] …` y nunca la URL. Sin foto propia no se manda nada (el icono del
  producto es SVG). ⚠️ Redesplegar `whatsapp-send` y `enviar-email`. ✅ **Envío real verificado el 12-10-2026**:
  un WhatsApp con botones y la foto de una oferta real, desde producción a un número de prueba de Meta —
  entregado y la foto vista en el móvil—. ⚠️ Los botones de una prueba así llevan ids `prova:*`, no `accept:*`:
  una pulsación con `accept:` entraría en el diálogo de aceptación de una oferta real.
- E2E `tests/e2e/tauler.e2e.ts` (clon, escritorio).

### Revisión del cliente del 08-10-2026 — fase 11: el Pla de Prevenció como expediente (12-10-2026)

> 🔴 **Plan 2 A1 (10-11-2026, `20270520100000`)**: el expediente **es** el plan (D4). `obrir_expedient` enlaza
> `pla_id` solo a un plan básico **vigente** (ya no al borrador, que no existe) y rellena `diagnostic_id`; el PDF
> exportado lleva la sección «Diagnòstic operatiu» (`render/expedient.ts`, `respostesLlegibles()` de `render/pla.ts`),
> después de «Context/Objectius/Equip» y antes de «Visites». La pantalla del diagnóstico del equipo
> (`/equip/diagnostics/productor/:id`) enseña arriba el expediente abierto (`ExpedientVista`) o «Obre l'expedient».

Migración `20270425100000`. La Fundació (§7): «hauria de funcionar com un expedient de seguiment de
l'empresa, no com un únic formulari», en una sección DISTINTA de «El meu diagnòstic». Recorrido:
diagnòstic → visita tècnica → quantificació → anàlisi de causes → pla d'accions → seguiment trimestral →
verificació anual.

- **Tablas**: `expedients_prevencion` (uno no cerrado por organización; nivel, estado
  `obert`→`en_seguiment`→`verificat`→`tancat`, técnico, contexto, objetivos estratégicos, equipo, el plan
  básico enlazado y su numeración `PLA`) y siete hijas: `pla_visites`, `pla_processos` (con puntos
  críticos), `pla_quantificacio` (mes, producto, categoría `perdua|excedent|residu`, kg, destino, causa,
  fuente `manual|redestina`), `pla_objectius`, `pla_accions`, `pla_seguiments` (`AAAA-Tn`) y
  `pla_verificacions`. Lectura: equipo y la propia organización (`expedients_meus()`); **sin GRANT de
  escritura**. Solo productores (`obrir_expedient` rechaza entidades: fase 9).
- **RPC**: `obrir_expedient`, `verificar_expedient`, `tancar_expedient` y `exportar_expedient` son de
  `pot_aprovar()`; `desar_expedient`, `desar_element_expedient` (genérica sobre la lista blanca
  `columnes_element_expedient`, tipada con `jsonb_populate_record`), `esborrar_element_expedient` y
  `volcar_quantificacio_redestina` del equipo. Un expediente `tancat` ya no se edita. Job
  **`quantificacio-expedients`** (`15 5 1 * *`, `volcar_quantificacio_expedients()`, solo servidor): el
  mes anterior de cada expediente abierto, desde canalizaciones conciliadas y `excedente_destins`.
- **Evidencias**: `documentos_externos` con `objeto_tipo = 'expedient'` y `tipo = 'evidencia'`
  (`subir-documento-externo` y `puc_veure_document_extern` las conocen; solo sube el equipo).
- **Exportar**: `documentos` tipo `PLA` con `objeto_tipo = 'expedient'` (nuevo en el CHECK, en
  `trg_documentos_objeto_existe`, `ruta_documento` y `documents_meus`), numerado en la serie `PLA` la
  primera vez y versionado después; snapshot de `expedient_datos()` (`format: 'expedient'`, solo
  servidor). `generar-documento` lo pinta con **`render/expedient.ts`** cuando `datos.format` es
  `expedient` (el plan básico sigue con `render/pla.ts`). La comparativa anual y el avance de acciones
  viven en `_shared/expedient.ts` con su copia `src/lib/expedient.ts` (`tests/expedient.test.ts` exige
  que den lo mismo). ⚠️ Estructura **provisional** hasta el modelo PPPMA: el PDF lo dice.
- **Pantallas**: `/equip/plans` (lista y «Obre l'expedient») y `/equip/plans/:id`
  (`components/expedient/ExpedientVista` + `TaulaElements`, por pestañas); `/organitzacio/pla` («El meu pla
  de prevenció», solo lectura, `paper: 'productor'`).
- ⚠️ **Publicar**: redesplegar `generar-documento` (renderizador) y `subir-documento-externo`
  (evidencias). Deuda **140**: el borrado de fichas no conoce los expedientes.
- E2E `tests/e2e/pla-prevencio.e2e.ts` (clon, escritorio): abre, llena, exporta y la productora lo lee.

### Revisión del cliente del 08-10-2026 — fase 10: «El meu impacte» (11-10-2026)

Migración `20270424100000`.

- **`factors_impacte`** (catálogo, lo lee cualquiera con sesión; sin GRANT de escritura): CO₂e,
  agua y raciones **por kilo aprovechado**, sembrados **provisionales** con su fuente (FAO 2013 para
  el CO₂e, huella hídrica media de fruta y hortaliza, ración de 400 g). Los fija solo el super_admin
  con `fixar_factor_impacte()` desde Configuració (`components/equip/FactorsImpacte`).
- **`impacte_receptor` / `impacte_productor` / `impacte_global(desde, hasta)`**, envoltorios de
  `impacte_calcula(ambit, …)` (`security invoker`: agrega lo que quien pregunta ya puede leer, y
  filtra por sus fichas; el global exige equipo). Kilos **conciliados** (D13) con la recogida en hora
  de Madrid, como `kpis_equip`; por modalidad, entregas, contrapartes, CO₂e, agua, raciones y serie
  mensual. **El valor en € (kg × `coste_kg` de las donaciones) nunca va al receptor**: expondría la
  valoración del donante.
- **Pantallas**: `/receptor/impacte` («El meu impacte», `barra: false`), bloque «El teu impacte» en
  el Inici del productor (año en curso, compacto) e «Impacte de Redestina» en el tablero del equipo,
  con su periodo. `components/ImpacteBloc` (cifras, kg por mes y por modalidad con `chart-*`) y
  `ImpacteAmbPeriode`; el selector de periodo se extrae a `components/SelectorPeriode`, que ahora
  usa también `IndicadorsPeriode`. Lo puro, en `src/lib/impacte.ts` (`tests/impacte.test.ts`).
- E2E `tests/e2e/impacte.e2e.ts` (clon, lectura): la cifra de cada pantalla es la que da la base
  para esa cuenta.

### Revisión del cliente del 08-10-2026 — fase 9: «Diagnòstic operatiu» y «El meu perfil de recepció» (11-10-2026)

> 🔴 **Plan 2 A1 (10-11-2026, `20270520100000`) cambia esta fase** (detalle de datos en `context/04`, «Diagnóstico
> único»):
> - **Un diagnóstico por productor que se sobrescribe** (`diagnostics`, D1), sin historial nuevo (P10) ni plan básico:
>   «Prepara el pla», «Emet el pla» y `PlaPrevencio` se retiran (D4); Configuració › Diagnòstic conserva solo el
>   «Qüestionari» (fuera «Mesures» y «Regles»).
> - **Lo contesta el equipo** (D5): `FormulariDiagnostic` vive en `/equip/diagnostics/productor/:id`, con **un solo
>   botón «Desa»** (completo o no lo dice el servidor, como badge) y **`NavSeccionsDiagnostic`** —un chip por sección,
>   punto lleno si está completa, clic = ir a la sección— en lugar del stepper (`PasosProces` + `QueTocaAra`, T3):
>   con un único diagnóstico no hay proceso que recorrer, solo longitud.
> - **Lectura**: `ResumDiagnostic` (pregunta → respuesta por sección, «Actualitzat el … per …») en la ficha del
>   equipo (pestaña «Diagnòstic i perfil») y en «El meu diagnòstic» del productor, que ya no edita: sus datos
>   operativos los edita en «La meva organització». El PDF bajo demanda llega en A2.
> - **Receptoras** (D3): su diagnóstico es el perfil de recepción; la pestaña «Diagnòstic i perfil» de la ficha
>   enseña primero las modalidades (`modalitats_interes`, que pasa a `bloc: 'diagnostic'`) y las preferencias
>   comunes (`PREFERENCIES_RECEPCIO`), y después los campos de su tipo.
> - Bandeja `/equip/diagnostics`: cuatro estados (`sense_questionari · sense_comencar · incomplet · complet`) y la
>   columna «Actualitzat».

Migración `20270423100000`. Lo que pidió la Fundació (§6 y §3 del documento): **el diagnóstico no
genera un plan** —«ara està redactat com si del diagnòstic et generés un pla»— y **el receptor no
tiene diagnóstico**.

- **Diagnòstic operatiu (productor)**: cuestionario **v2** (`publicar_questionari`, provisional) con
  los bloques de la tabla del documento: famílies → productes concrets → principals (máx. 5) →
  volum per producte → temporada (mesos per producte) → situacions, freqüència i volum d'excedent →
  previsió i antelació → gestió actual → causes → sortides → ubicació → logística → suport. Cuatro
  **tipos de pregunta nuevos** en el motor (`questionari_problemes`, `compondre_respostes`,
  `diagnostic.ts`, `FormulariDiagnostic`): `productes` (catálogo filtrado por `familia_de` o
  subconjunto de `opcions_de`, con `max`), `per_producte_num` (`productes_de` + `unitat`), `mesos`
  (por producto si lleva `productes_de`) y `ubicacio` (lugares de la propia ficha; `22023
  ubicacio_aliena` si no). `avaluar_regla('buit')` cuenta además el **objeto vacío**.
- **Ficha viva**: `desar_diagnostic()` **ya no llama** a `generar_pla_des_de_diagnostic()`; guarda
  cada versión en **`diagnostics_historial`** (solo lectura: equipo y la propia organización; sin
  GRANT de escritura) y deriva en `productores` **`productos_habituales`** y **`temporada`** (jsonb
  `{producte: [mesos]}`), solo con lo contestado. El formulario se abre con el borrador o, si el
  equipo ya emitió un plan, con la última versión del historial. Al guardar se limpia lo que ya no
  toca (`netejaRespostes`: productos fuera de su lista, meses fuera de 1..12).
- **El plan es del equipo**: `generar_pla_des_de_diagnostic()` y `emitir_plan_basico()` pasan a
  `es_intern()` (`42501` a cualquier externo; la guarda de emitir va antes de buscar el plan).
  `diagnostic_estat()`/`diagnostics_equip()` ganan el estado **`complet`** (contestado, sin plan) y
  `darrera_actualitzacio`; la bandeja del equipo lista **solo productores** (columna «Última
  actualització» en vez del papel). En `PlaPrevencio` (solo pantallas del equipo) «Prepara el pla»
  cuando aún no se ha generado. La organización ya no ve ningún plan en su diagnóstico: su escalera
  acaba en «Contestat» (`puntDiagnostic(…, 'org')`, `estatPerOrganitzacio`), y la banda y la marca
  del menú solo avisan de `sense_comencar`/`incomplet`.
- **Receptor → «El meu perfil de recepció»** (`/organitzacio/perfil-recepcio`, `routes/PerfilRecepcio`):
  modalidades que interesan, preferencias de recepción (fase 7) y las condiciones de su tipo; se
  guarda con `actualitzar_fitxa_entitat` (solo esas claves). **Salen de «La meva organització»**
  (queda un puntero) para no tener dos formularios del mismo dato. El menú filtra por papel
  (`NavItem.paper`): el diagnóstico solo a quien tiene ficha de productor y el perfil de recepción
  solo a quien tiene ficha de entidad; `/organitzacio/diagnostic` redirige al perfil a una receptora.
  El cuestionario de `entidad` queda **retirado** (`vigente = false`) y sus planes emitidos pasan a
  `substituit` (los PDF no se tocan). `TargetaDiagnostic` ya no se monta para entidades
  (`TargetaPerfilRecepcio` en su lugar).
- El PDF del plan (`render/pla.ts`) conoce las secciones de la v2.
- E2E `tests/e2e/diagnostic.e2e.ts` (clon, escritorio) y `organitzacio.e2e.ts` ajustada.

### Revisión completa del 07-10-2026: errores de flujo, certificado de transacción y auditoría

Revisión exhaustiva del código y de los flujos (informe en `3. Claude Code/2026-10-07-auditoria-completa.md`).
Lo que se cambió en las pantallas y la lógica del circuito; las migraciones, en §4bis.

- **El certificado de transacción (CT) tiene pantalla.** `TancamentDetall` gana la tarjeta «Certificats de
  transacció», debajo de la de donantes: tabla por entidad productora (kg, estado con el siguiente paso,
  `Bloquejos`, número `CT-…`, documentos y acciones), «Emet certificat» por fila (con confirmación: consume número
  y se envía por correo), «Emet tots els certificats de transacció» (`emitir_certificados_transaccion_cierre`,
  con confirmación que dice la serie `CT` o `P-CT` y el panel de resultado emitidos/saltados con su motivo) y
  «Rectifica el certificat» con motivo obligatorio. Los botones salen siempre y a quien no tiene
  `pot_aprovar()` se le ven grises con el motivo (`BotoAmbMotiu`). Los PDF se abren con el componente
  `BotonsDocuments`, compartido con las filas de CD. «Calcula» enseña también el resumen de transacciones. Sigue
  sin existir «Marca com a enviat» para el CT (deuda 138). Antes de hoy el CT no tenía ninguna pantalla —un
  comentario de la propia pantalla decía «el CT tiene la suya»— y la única forma de emitir uno era SQL a mano.
- **Conciliar un albarán desde la pantalla** (`AlbaraDetall`): «Concilia» se activa para **REC, ENT y OPE** en
  `entregado` o `confirmado` (antes solo REC, así que una venta o una maquila no se podía conciliar nunca). El
  diálogo lee el plazo y la tolerancia de `parametros_documentales` (7 días y 2 % si la lectura falla); sin
  confirmar y con el plazo sin vencer dice hasta qué fecha esperar y apaga el botón; con el plazo vencido pide
  motivo; en un REC fuera de tolerancia el motivo es obligatorio (lo exige la base) y el diálogo avisa de
  cuántas salidas confirmadas se conciliarán en cascada y cuántas se quedan esperando.
- **Contexto de sesión cerrado por defecto, `useConveni` que no bloquea ante un error, «Envia tanda» con
  confirmación, errores de carga que ya no se pintan como «sin datos»** (Dashboard, `OfferDetail`, documentos
  de productor y de receptor —ahora en `Promise.all`—, documentación y certificados de la ficha): §6quater y
  los propios componentes. `useConveni` gana el estado `desconegut` (ante un fallo de lectura no avisa ni
  bloquea y reintenta a los 3, 10, 30 y 60 s; la base sigue cortando con `exigir_convenio()` si de verdad
  falta el convenio). Confirmación antes de borrar un lugar de recogida, una foto o una entrada de whitelist.
- **Tokens de diseño**: `text-accent`/`border-accent` (crema de hover, ≈1,2:1 sobre blanco) dejan de usarse
  como color de texto o borde; seis rejillas ganan `grid-cols-1` (regla 5 de §2); tres celdas de tabla
  `whitespace-normal` (regla 6); siete diálogos usan `dvh` en vez de `vh`.
- **Seguridad de la interfaz de datos**: `csv182` neutraliza fórmulas (un texto que empieza por `=`, `+`, `-` o `@`
  lleva un apóstrofo delante; los negativos no se tocan). Pruebas nuevas de `textError`, de `tancamentFormat.ts` (lo
  puro de `tancament.ts`, que lo reexporta) y de `esborranyOferta.ts` (borrador y fechas de `FormulariNovaOferta`;
  un borrador sin la marca `desat` ahora se descarta). `tests/cobertura.test.ts` gana la comprobación inversa
  («ninguna clave de i18n se queda huérfana», generosa a propósito: cuenta como usada cualquier clave literal o con
  prefijo de plantilla, también en `supabase/functions` y `supabase/migrations`).
- **Código muerto retirado**: `cargarNumerosTest`, `cargarEmailsTest` y ~43 claves i18n de funciones retiradas (fotos del
  catálogo, subida de factura por el productor). Quedan **anotados sin tocar**: `SuggerimentPoblacio.tsx` (0
  importadores), `mensajes.ts` (solo vive por su test), y las dos funciones del CR de la deuda 138.
- **Refactor sin cambio de comportamiento**: ver §3 (`cerca.ts`, `format.ts`, `_shared/http.ts`, módulos de
  `enlace-publico`, `registro` y `recordatorios-documentales`). 5 `eslint-disable` retirados y 9 de los 14
  `as unknown as` de `src/`.

### El equipo gestiona el ciclo solo y avisa a mano (27-10-2026)

✅ **Publicado el 27-10-2026** (`3907281`): las migraciones `20270430100000`…`100300`, seis funciones
(`crear-oferta`, `enlace-publico`, `enviar-avis`, `generar-documento`, `recollides-programades` y
`whatsapp-webhook`, las que empaquetan un módulo cambiado) y el frontend. El PDF de prueba sale (6 páginas,
123.618 bytes) y el arnés da 1.556/1.556 contra producción.

Plan en cinco fases (`docs/Plan gestió autònoma superadmin (2026-10-27).md`, fuera de git): con
las notificaciones apagadas (§8), el super_admin lleva una oferta de punta a punta en nombre de
las partes —convenio, interés, aprobación, recogida, albaranes— con **las mismas filas y los
mismos documentos** que si lo hicieran ellas, y en cada paso copia el WhatsApp (o el correo) que
la plataforma habría mandado. Ofertante y receptor siguen viendo en su panel la oferta, la
canalización y su estado.

- ✅ **Fase 0, cimientos**: los textos que manda el servidor salen a módulos hoja que el panel
  importa (§7); `src/lib/missatgesOferta.ts` compone los mensajes de una oferta (de cada fila de
  `avisos`, el texto exacto de `enviar-avis`; los demás, de los datos) y `MissatgeACopiar` los
  pinta. `OfferDetail` copia con `BotoCopiar`, y RECOLLIDA CONFIRMADA lleva ya la fecha (hora de
  Madrid) y los comentarios de las entregas vivas: salían en blanco.
- ✅ **Fases 1-3, capa de datos** (`20270430100000`…`100200`, §4bis): `declarar_conveni()` (convenio
  vigente sin firma, con PDF que lo declara); `comprova_interes()` compartida por el interés del receptor y el
  asistido (que gana la hora de recogida) y `registrar_envio_manual()` (`canal = 'manual'`);
  `registrar_recollida_assistida()` (registrar + validar en una transacción, con el mismo código que el
  receptor) y `fixar_hora_recollida()`. `canalitzacio_assistida()` devuelve además el origen del convenio, el
  interés con modalidad y hora, y el estado de la recogida. `tests/e2e/paritat-assistida.e2e.ts` compara, sobre
  dos ofertas gemelas, el camino propio y el asistido: mismas filas, mismos albaranes y líneas, y solo cambia
  quién lo hizo.
- ✅ **Fase 1, pantallas**: «Dona'l per vigent» (`components/equip/DialegConveniDeclarat`, molde de
  `DialegConveniPaper`) en la ficha (`DocumentacioOrganitzacio`), en `ConveniDetall` (solo `col_*`), en las fases
  1 y 4 del ciclo guiado y como acción del aviso de después del alta asistida. Precarga quién firma del último
  convenio con firmante (o la persona de contacto) y avisa antes si faltan NIF o domicilio; los rechazos, por su
  código (`src/lib/conveniDeclarat.ts`, con prueba). `BadgeConveni` lo pinta verde con «declarat (sense
  signatura)»; en el panel externo, `LlistaConvenis` ofrece al titular «Signa’l electrònicament».
- ✅ **Fase 2, pantallas**: `components/equip/FormulariInteresAssistit` (entidad, kilos, modalidad entre las
  compatibles, precio si es venta o maquila, `components/CampsRecollida` —día y hora dentro de la franja, el mismo
  del Mercat— y cajas) en el ciclo guiado y en `OfferDetail`; `components/equip/FormulariAprovacio` en
  `OfferDetail`, `Aprovacions` y el ciclo guiado; y «Copia i marca com a enviada» por entidad. 🔴 **Se retiraron
  los tres atajos de `OfferDetail`** que rompían la paridad (deuda 109): marcar una respuesta «acceptada» a mano,
  el alta directa de canalizaciones y teclear los kilos reales. Lo aprobado se enseña con `kg_aprovats`.
- ✅ **Fase 4, mensajes en los tres paneles**: `hooks/useMissatgesOferta` (con `avisos_de_oferta()`) y
  `components/MissatgesDelPunt`. En `OfferDetail`, «Missatges de l’oferta (n)», plegado salvo que alguno no haya
  salido, con «Copia el WhatsApp» y el correo plegado. En el panel del ofertante (detalle de su oferta) y de la
  receptora (ficha de la operación y diálogo del interés), **solo los avisos y solo en lectura** («El que t’hem
  dit»): el `texto_oferta` lleva «PRODUCTOR: …» (D3) y el agradecimiento del alta el código `E-…`, que ellos no
  ven, así que el hook ni los pide fuera del equipo (`perspectiva`). La campana marca en ámbar los avisos que no
  salieron (`canal_enviat = 'cap'`). `tests/e2e/missatges.e2e.ts` lo recorre con las notificaciones apagadas.
- ✅ **Fases 3 y 5, la recogida y el ciclo guiado sin enlaces**: «Registra la recollida (en nom de X)»
  (`components/equip/DialegRegistraRecollida`) monta la ficha de la operación y el MISMO `RegistraRecollida` de
  la receptora con `mode="assistit"` (motivo obligatorio con diferencia, foto opcional que se sube después
  sobre el albarán emitido, «Registra i valida»), que llama a `registrar_recollida_assistida()`; si la receptora
  ya registró, lo que se abre es validarla. Sale en la fase 5 del ciclo guiado y en `AlbaraDetall` («Registra la
  recollida en nom de l'entitat» / «Valida la recollida»), que además ya no borra `kg_previstos`, `familia` ni
  `causa` al editar líneas. `DialegConfirmaRecollida` se retiró, y `confirmarRecollida` de `albarans.ts` con él
  (la RPC se queda como envoltorio). La escalera pasa a 17 pasos y el ciclo guiado se partió en
  `components/equip/fases/` (§6ter, «La canalización asistida»); el índice gana la columna «Missatges per
  enviar» (`avisos_sense_enviar_per_oferta()`). `tests/e2e/recollida.e2e.ts` registra desde el ciclo guiado y
  `tests/e2e/gestio-autonoma.e2e.ts` recorre el convenio declarado y el interés desde las pantallas.
- De paso: el agradecimiento del alta y los avisos en catalán apostrofan el producto («d’Alvocat»): decían «de
  Alvocat». `de()` vive ahora en `_shared/textIntake.ts` (hoja) y `intake.ts` la reexporta.

### La meva organització con listas cerradas (27-09-2026)

Revisión funcional del 23-09: la ficha tiene que servir al ERP, así que **lo que se cruza va en
listas cerradas y lo demás en texto**. `PerfilOrganitzacio` va por secciones —Qui sou, Contacte,
Adreça, Llocs de recollida (productor), el perfil de su tipo (receptor) y Canal— y guarda con
**`actualitzar_fitxa_productor` / `actualitzar_fitxa_entitat`** (`20270402100000`), que reciben un
jsonb y escriben solo las claves de su lista blanca (las `actualizar_mi_*` anteriores se quedan).

| Dato | Cómo |
| --- | --- |
| Nom comercial / Persona de contacte | Productor: **`empresa` / `name`** (así lo guarda `registro`: `name` es la persona). Entidad: `nombre` / `contacto`. Si `empresa` está vacío se sugiere `name` como placeholder, sin escribirlo. ✅ **Desde el 28-09-2026 la ficha del equipo usa las mismas etiquetas** (`crudCampos`, `empresa` primero) y el **listado de productoras y la cabecera de la ficha enseñan `empresa || name`**, con la persona debajo si es otra (`RecordDetail.titolKey`). Las fichas de prueba `TEST-PROD-*` tenían la organización en `name` y `empresa` vacío: se copió a `empresa`, y `crear-usuarios-prueba.ts` ya la escribe. ✅ Y desde el mismo día `id_excedente` toma sus tres letras de **`empresa || name`**, la organización y no la persona (`crearExcedente()`; en SQL ya lo hacían `crear_espigolada()` y el alta de albaranes) |
| Raó social | `razon_social`, nueva en las dos fichas |
| NIF, correo, teléfono, CP | **Validados antes de guardar** (`validacio.ts`, con pruebas): el NIF con su dígito de control, el teléfono normalizado a E.164 sin «+» (un móvil de 9 cifras recibe el 34). Es ayuda contra la errata, no seguridad: la RPC no valida el NIF |
| Tipus d'empresa | Desplegable cerrado (`cooperativa`·`sl`·`sa`·`autonom`·`fundacio`·`associacio`·`altres`). La RPC acepta además **el valor que ya estaba** (texto libre del import): rechazarlo impediría guardar el resto |
| Municipi | `municipio_ine` con `SelectorMunicipi`. El trigger `*_municipi` rellena **`poblacion`** (forma legible, `nom_municipi_llegible()`) y **`area_geografica` = comarca**, que ya no se teclea. Si el CP apunta a un único municipio, se elige solo |
| Llocs de recollida | Las `productor_ubicaciones` del productor: alta y baja desde la ficha. Borrar uno que usa una oferta devuelve `23503` y se explica |
| Perfil del receptor | `entidades.perfil_receptor` (jsonb), campos por `tipo_receptor` en `perfilReceptor.ts`. **`tipo_receptor` no lo edita la entidad**: decide qué ofertas ve |
| Canal | Añade **`telefon`**: preferencia para el equipo. Los avisos automáticos la tratan como `auto` (`normalizarPreferencia()`), y el menú de usuario la pinta con las dos casillas marcadas |

⚠️ **Lo que queda fuera, a propósito**: las «altres ubicacions» de un **receptor** (no hay tabla
para ellas; `horari` sigue siendo texto), el «área Redestina» como segmentación propia distinta
de la comarca (no está definida: hoy área = comarca, que es lo que compara la priorización).
✅ **La ficha del equipo ya tiene la razón social y el perfil del receptor** (28-09-2026): el
perfil lo pinta **`components/CampsPerfilReceptor`**, el MISMO componente que usa
`PerfilOrganitzacio` —estaba escrito dentro de esta, y copiarlo habría dado dos formularios del
mismo dato—. En `RecordDetail` es el tipo de campo `perfil_receptor` de `crudCampos.ts`, y sus
campos dependen del `tipo_receptor` que haya en el formulario. ⚠️ Vacío se guarda `{}` y no
null: la columna es `not null`. Y desde el mismo día tiene **el resto**: el tipo de empresa (y el
tipo de entidad) como **lista cerrada** que conserva un valor antiguo de texto libre —tipo de campo
`tipus_empresa`—, el **municipio del nomenclátor** (`municipi`, con `SelectorMunicipi`; el trigger
`*_municipi` rellena población y comarca, que siguen editables) y los **lugares de recogida** de la
productora, con **`components/LlocsRecollida`**, el mismo componente de la ficha propia. Los lugares
se guardan al momento, cada uno es una fila de `productor_ubicaciones`.
⚠️ **Las listas del perfil son provisionales**: las fijó la consultoría a partir de la revisión y
las tiene que validar la Fundació. Cambiarlas es cambiar `perfilReceptor.ts` (el `id` es lo que
se guarda; el texto se puede reescribir).

### La ficha de la organización sale de los paneles (16-09-2026)

**`/organitzacio` es un apartado propio, fuera de `/productor` y de `/receptor`.** Estaba
dentro de cada panel —«La meva explotació» y «La meva entitat»— y con **doble rol eso daba
dos entradas de menú, con dos nombres, para una misma organización**. Ahora hay una sola
entrada («La meva organització»), se pinta después de todos los paneles y **el equipo no la
ve**: opera en nombre de otros y no tiene organización propia.

Con **un papel** la pantalla es la de siempre. Con **los dos**, dos pestañas sobre el mismo
`PerfilOrganitzacio`: `productores` y `entidades` siguen siendo dos filas con columnas
propias —una tiene explotación y la otra capacidad de recepción— y cada una se guarda con su
RPC. Lo que se unifica es **dónde se entra**, que es la misma dirección de la brecha 2 de
§1bis vista desde la interfaz.

⚠️ **`key` por pestaña, y ahora importa más que antes.** Es el mismo componente con otro
`tipus`; sin `key`, React reutiliza la instancia y cambian la tabla y los campos pero **la
fila sigue siendo la anterior**, así que «Desar» sobrescribe una ficha con los datos de la
otra. Con las dos rutas separadas ya pasó una vez (§6ter); conviviendo en una pantalla el
riesgo es mayor.

⚠️ `/productor/perfil` y `/receptor/perfil` **se quedan como redirección**: hay enlaces y
marcadores hechos.

**Y una banda nueva, `AvisRegistreIncomplet`**, avisa de lo que el registro no preguntó
—NIF, domicilio, código postal, población— y lleva a esa pantalla. El alta pide lo mínimo a
propósito (un formulario largo en la puerta no lo termina nadie), pero esos cuatro campos
son lo que el convenio imprime: sin ellos, la primera firma se encuentra el formulario a
medias. **No duplica la lista de obligatorios del convenio**, que la decide el servidor.

🔴 **Va en ROJO, y la entrada del menú lleva badge** (16-09-2026). Nació en tono de aviso
porque «no bloquea nada», y eso **dejó de ser cierto el mismo día**: con
`fecha_corte_convenios` puesta, sin convenio vigente no se puede publicar ni mostrar
interés, y sin estos campos el convenio no se firma en condiciones. O sea que una ficha a
medias sí impide operar, con un paso de por medio.
⚠️ **Se calcula UNA vez, en `AppShell` (`useFitxaIncompleta`), y se reparte** a la banda y al
badge. Calculado por separado, el contador del menú y la banda podrían decir cosas distintas
— es la misma razón por la que los contadores del equipo salen todos de `pendents_equip()`.
🔴 **La marca del menú es un SÍMBOLO DE ALERTA, no una cifra**, aunque la cifra exista. En
esa posición **todos los demás badges son contadores de cosas pendientes** —aprovacions,
missatges, albarans, documents—, así que un «3» ahí se lee como «tres avisos» y no como «te
faltan tres campos»: información de más pagada con un significado equivocado. Lo que hace
falta decir es «esto está a medias»; QUÉ falta ya lo dicen la banda roja y la propia ficha.
Por eso `AppSidebar` recibe un **booleano** y no un número.
⚠️ La banda se lee una vez y se ignora; la marca sigue ahí hasta que se arregla. Por eso
están las dos.

### El modelo del proceso: la aplicación lo narra, no solo lo ejecuta (14-09-2026)

Hasta hoy ninguna pantalla contaba en qué punto estaba una oferta ni qué tocaba después: los
únicos textos de «qué pasa ahora» vivían en WhatsApp y en un correo que reciben 78 de 345
productores. **`src/lib/procesOferta.ts` lo define UNA vez y lo consumen los tres paneles**: de
los estados reales (`excedentes.estado`, `oferta_respuestas.estado × aprovacio`,
`albaranes.estado`) a un `PuntProces` —etapa, «què passa», «què toca ara», «qui»— en **claves
i18n**, para que `tests/procesOferta.test.ts` pueda exigir que existan en `ca` y `es` (las claves
se componen, y `cobertura.test.ts` solo ve literales).

Cinco etapas y dos salidas para la oferta (`publicada → assignada → recollida → confirmada →
tancada`; `sense_desti`, `cancellada`) y seis para el **interés** del receptor. Tres reglas que
no son obvias: **`vencuda` no es etapa ni salida** (la oferta sigue viva; conserva el índice de
la etapa que sustituye); **un REC anulado o rectificado no cuenta como recogida**; y **«en
gestió» se dispara con un hecho distinto según quién mira** (al equipo le basta haberla enviado;
al productor solo le importa que alguien haya mostrado interés). `seguentPas.ts` hace lo mismo
para albarà, conveni, exercici y donant, **con claves propias en tercera persona**: las
`mydoc.next_*` del cierre están en segunda persona hacia el donante y compartirlas obligaría a una
de las dos voces a mentir.

Lo pintan cinco componentes de `src/components/proces/`, con una regla heredada de
`PendentsDeTu`: **lo que te toca a ti va en `aviso`; lo demás, neutro** (`QueTocaAra` solo pinta
`aviso-fondo` cuando `emToca`). `BotoAmbMotiu` pone tooltip a un botón deshabilitado con su
porqué, pero el porqué va **además** visible en `QueTocaAra`: en táctil no hay hover.

**El menú del equipo sigue el camino de una oferta** (`nav.ts`): Operació (Ofertes, Espigolades,
Aprovacions, Missatgeria, Albarans) → Tancament anual (Costos **antes** que Tancament: es su
prerrequisito) → Organitzacions (Productors, Entitats, Convenis) → Sistema (Documents,
Configuració). Sin números en las etiquetas: son también el título de la barra y el tooltip
plegado. Y **los badges salen de una sola fuente**, la RPC `pendents_equip()` guardada en
`pendentsEquip.ts` (store de módulo, `useSyncExternalStore`), la misma que lee el tablero: se
refrescan en cada cambio de ruta y con `refrescaComptadors()` tras cada acción. Sin Realtime.

**Vocabulario fijado**: «oferta» (no «excedent») en la interfaz operativa; «Coberta» en vez de
«Bloquejada» para los kg cubiertos —colisionaba con el bloqueo por convenio—; «interès» para lo
que hace el receptor; «l'equip de Redestina» cuando actúa alguien. `design/DESIGN.md §5`.

**Vocabulario de la revisión del cliente del 08-10-2026 (fase 0, 11-10-2026)**: el Mercat se llama
«Excedents disponibles» también en el menú (no es un marketplace); las fases de la canalización
guiada son Conveni · Entrada · **Cerca de receptors** · **Assignació** · **Recollida** ·
**Tancament** (claves `fase.*` sin cambiar); tras asignar, el receptor lee «recollida pendent» y no
«prepara't per rebre-la»; la tarjeta del detalle de oferta es «Canalitzacions assignades»; los
documentos del ofertante y del receptor se titulan «Els meus certificats»; el CT se llama
«Certificat d'aprofitament alimentari» (el `documentos.tipo` sigue siendo `CT`); «Cancel·lada» se
describe como retirada por error o incidencia. **El ofertante ya no ve el código `E-…`**: ni en la
lista, ni en el detalle, ni en el bloque de publicada, ni en los avisos (`textAvis.ts`; el código
sigue en `avisos.params.ref` por trazabilidad y el equipo lo ve en su panel). Los campos del
formulario de aprobación de `OfferDetail` llevan etiqueta y unidad (`od.f_kg_assignats`,
`od.rs_preu_venda`): con solo placeholder, un precio por defecto de «2» no decía qué era.
**Retoques tras la revisión en producción (12-10-2026)**: el certificado de transacción se llama «certificat d'aprofitament alimentari» en TODOS los textos de la interfaz (ca y es), y también el título del PDF `CT` y los correos que lo acompañan (`render/cierre.ts`, `correu-document.ts`; prueba de Deno `tests/pdf/ct_test.ts`); los motivos que escribe el job de vencidas («vencida sin cubrir») ya no se pintan en la etapa «Sense sortida» (`motiuVisible()` en `procesOferta.ts`); la receptora no ve el enlace «Obre el diagnòstic» en sus documentos (`LlistaPlans` con `ambDiagnostic={false}`); y el formulario del diagnóstico no dice «contestat» a la organización si faltan obligatorias del cuestionario vigente (plan emitido con la v1).
⚠️ **Transitorio hasta la fase 5 del plan** (`3. Claude Code/2026-10-11-plan-revision-avances-08-10.md`):
`sig.model_don_gen` ya dice «Conveni de col·laboració», pero `sig.model_don_rec`/`sig.model_com` y el
título del PDF del convenio (plantillas `CONV`) siguen con los nombres de los tres tipos actuales.

### «Productes»: el catálogo con icono, y qué enseña una oferta (27-09-2026, iconos desde el 29-09)

**`/equip/productes`** sustituye a «Costos per quilo» (`/equip/costos` redirige: había enlaces
guardados). Misma posición en el menú —antes del Tancament— y mismo contador `costos`. La lista
enseña el **icono** de cada producto, el **coste de referencia** y ya **no tiene desplegable de
ejercicio**. **`/equip/productes/:nom`** es el detalle: el icono en grande y el coste de referencia
con su histórico y el formulario para cambiarlo (`pot_aprovar()`).

🔴 **Desde el 29-09-2026 el catálogo NO tiene fotos: tiene un ICONO PROPIO por producto**, a
petición del cliente. Los 90 los dibuja `scripts/icones-productes.ts` —SVG plano de 64×64, colores
naturales del producto, contorno en los claros para que no se pierdan sobre el crema— y viven en
`public/icones-productes/<slug>.svg`; el nombre del fichero es `slugProducte()`
(`lib/iconaProducte.ts`), la misma función en el script y en la pantalla. **Sin licencias de
terceros y sin red.** Se revisaron a ojo renderizados. Un producto nuevo en la base sin su dibujo
sale con el icono genérico de su familia (el `<img>` falla y pinta `FotoGenerica`), y
`tests/fotoOferta.test.ts` comprueba que los 90 del catálogo tienen fichero.
⚠️ **Lo que quedó en la base sin uso**: `productos.foto`/`foto_mini`/`foto_credit` (vaciadas el
29-09; copia de las rutas fuera del repo), el bucket `fotos-productes` con sus ficheros (no se
borraron), la RPC `fixar_foto_producte()` y `excedentes.foto_producte`. `crear-oferta` sigue
sirviendo `foto_mini` (null). La parte de productos de `scripts/fotos-cataleg.ts` no se debe
volver a ejecutar: rellenaría columnas que ya no lee nadie.

**La regla de una oferta** (`lib/fotoOferta.ts`, pura y con test; la aplican Mercat, Interessos,
Històric, la lista de ofertas del equipo y las dos listas del productor):

1. Si la oferta tiene fotos propias, la primera.
2. Si no, el **icono de su producto** (`IconaProducte`), y si no tiene dibujo, el de su familia.

Ya no hay casilla «mostra la foto genèrica del producte» ni etiqueta «foto orientativa»: un dibujo
no se confunde con la foto del lote. En el alta, sin fotos, se enseña el icono con «Sense fotos,
l’oferta es veurà amb la icona del producte».

Las **24 fotos de ejemplo** que el 28-09 se pusieron a las 19 ofertas de prueba (WebP de
`scripts/fotos-cataleg.ts`, ninguna subida desde la app) **se retiraron también el 29-09**: con
ellas esas ofertas no enseñaban el icono. Hoy ninguna oferta tiene foto (`excedentes.fotos = '{}'`);
los ficheros siguen en el bucket `fotos-ofertes`. Las fotos que suba un productor desde la app
(JPEG) funcionan como siempre. **`scripts/fotos-cataleg.ts` ya no se debe ejecutar**, ni la parte
de productos ni la de ofertas.

### Los estados SIMPLES de los paneles externos (27-09-2026)

Salió de la revisión funcional del 23-09-2026 (documento de Carles Pulido): los badges del
productor enseñaban el estado crudo del excedente —«Publicada», «Parcial», «Coberta»— sin saber
nada del albarán, así que una oferta recogida y conciliada seguía diciendo «Coberta». Ahora
`estatSimpleOferta()` y `estatSimpleInteres()` (`procesOferta.ts`) **derivan el estado de
`puntOferta()`/`puntInteres()`**, no del estado crudo, y los pinta `BadgeEstat` (píldora con un
punto del mismo color):

| Productor | Cuándo | Receptor | Cuándo |
| --- | --- | --- | --- |
| Buscant sortida (ámbar) | publicada, nadie la ha pedido | Per respondre (coral) | le llegó la oferta, no ha contestado |
| En gestió (crema) | alguien ha mostrado interés | Interès enviat · dd/mm (ámbar) | contestó; el equipo decide |
| Sortida trobada (verde) | asignada, recogida o confirmada | Assignada (verde) | aprobada, entrega en marcha |
| Finalitzada (contorno) | REC conciliado | Tancada (contorno) | ENT conciliado |
| Cancel·lada / Sense sortida (rojo) | salidas | No disponible (rojo) · Descartada | no aprobada o retirada · dijo que no |

⚠️ **En estos badges el ámbar significa «esperando», no «et toca a tu»**: lo pidió la Fundación
(🟡) y, probado en pantalla, el coral suave se confundía con el rojo de «Cancel·lada». Lo que es
acción de quien mira va en coral. El bloque `QueTocaAra` **no cambia** y sigue en ámbar.
⚠️ **El equipo NO los usa**: sus listados necesitan el estado exacto para operar.

**La home del productor** (`ProductorInici`) tiene ahora dos secciones que no se solapan:
«Què passa amb les teves ofertes» con las que están **en curso** (buscant, en gestió, sortida
trobada) —producto, kg, estado, «X kg amb sortida · Y pendents», «repartida entre N
destinacions» y qué toca— y «Les teves darreres ofertes» con el **histórico** (finalizadas,
canceladas, sin salida), que se oculta si está vacío. Los indicadores llevan año («Kg
canalitzats el 2026», por el año de la oferta en hora de Madrid) y «Kg pendents de sortida».
Para el estado, la lista carga el REC y el embudo **en una consulta cada uno para todas las
ofertas**, nunca una por oferta (§12.5). De la entidad que recibe se dice cuántas, nunca cuáles.

**Y de paso**: el receptor ya no ve el código interno `E-…` en Interessos ni en Històric (la
fecha va siempre); el Mercat se titula «Excedents disponibles»; «Nova oferta» del menú lateral
se pinta igual que las demás entradas (29-09-2026: sin fondo ni contorno, a petición del cliente); el alta de
oferta pide la disponibilidad con **calendario** (guarda «dd/mm/aaaa», que es lo que entiende
`parseDisponibleFins()`); el productor ya no tiene la subida de factura en Documentació; y los
certificados de recepción del receptor dicen que **no** son certificados de donación.

### La canalización asistida: el ciclo entero en una pantalla (21-09-2026)

`/equip/canalitzacio` (índice) y `/equip/canalitzacio/:id` (el ciclo), primera entrada del
grupo **Operació**, antes de Ofertes: ese grupo sigue «el camino de una oferta» y esto es ese
camino entero. `:id` es `excedentes.id` —la clave natural: el convenio cuelga de su productor,
las respuestas y canalizaciones del excedente, los albaranes de las canalizaciones—.
`barra: false`: el equipo tiene siete secciones y la barra de móvil admite cuatro (§2).

**POR QUÉ EXISTE.** El panel del equipo ya tenía todas las piezas del circuito, pero repartidas
en siete pantallas, y **tres actos del ciclo solo los podía hacer un usuario externo**: firmar
el convenio, confirmar un albarán y subir la factura. Cuando el equipo intentaba cubrir esos
huecos lo hacía por atajos que **se saltan el circuito documental** — `update` directo a
`oferta_respuestas`, `insert` directo en `canalizaciones`—, y eso produce lotes que se ven
idénticos en el listado y llegan al certificado sin haber pasado por la compatibilidad de
modalidad, el precio mínimo ni la comprobación de convenio.

🔴 **Los documentos y los correos NO se construyen aquí, y ese es el hallazgo que ordena todo.**
Cada RPC del circuito llama ya a su `*_emet_document(...)` con su `envio` jsonb; el trigger
`documentos_encola_generacion` llama a `generar-documento`, que genera el PDF. O sea que
**si el equipo ejecuta las RPC reales, todo sale igual**.
✅ **Y desde el 28-09-2026 `generar-documento` sí manda el correo** (§12.129, cerrada): hasta
ese día no lo hacía, y esta frase decía que sí. Ver «Envío de documentos por correo» en §4. El trabajo era otro: dar una
puerta a los tres actos que no la tenían, que quedaran registrados como **asistidos** y no como
otra cosa, y orquestarlo para que el atajo deje de ser el camino cómodo.

🔁 **Desde el 27-10-2026 son 17 pasos, y las fases 2, 3, 5 y 6 ya no mandan a otra pantalla**
(gestión autónoma, fases 3 y 5 del plan; ver la sección «El equipo gestiona el ciclo solo» más
abajo). La pantalla es solo el orquestador (`CanalitzacioDetall`, 269 líneas: carga, escalera y
punto) y cada fase vive en `components/equip/fases/` con sus acciones y su `MissatgesDelPunt`.
⚠️ **Al recargar tras una acción se congela qué fase está abierta**: una fase sin paso pendiente
se pliega sola, y plegarse desmontaba el diálogo que el equipo tenía abierto dentro, con su
resultado. Lo que sigue en esta sección describe la escalera de 21 pasos y las fases de antes.

**Seis fases, 21 pasos** (07-10-2026; eran 19). La escalera reutiliza `FASES_EQUIP` (`procesOferta.ts`) —`conveni ·
entrada · distribucio · aprovacio · lliurament · tancament`— en vez de inventar un segundo
vocabulario para el mismo proceso. Los pasos y lo que los bloquea viven en
`src/lib/passosCanalitzacio.ts`, puro y con su propio test (§3).
Los dos pasos nuevos y el cambio de fondo del 07-10-2026: **`oferta_validar`** —una oferta en
`pendent_validacio` ya no cuenta como publicada: ese paso queda «ara» y `distribuir` queda bloqueado con
`canal.bl_pendent_validacio`— y **`ent_conciliar`** —conciliar las salidas, necesario sobre todo en venta y
maquila, donde no hay REC que las arrastre—. **Venta y maquila:** `certificatsDelLot()` decide si el lote
necesita CD, CT o los dos (primero espigolada o REC vivo, después los albaranes de salida ENT/OPE, y solo si no
hay ninguno la modalidad principal de la oferta); sin donación los cuatro pasos del REC salen `fet` con el motivo
`canal.bl_sense_rec_venda`, el coste por kilo sale `fet` con `canal.bl_cost_no_cal` y no frena el cierre, y el
último escalón es el **CT**. `FetsCanal.certificats` dice si el certificado ya está emitido (mira el número) y un
certificado con bloqueos en el cierre da `canal.bl_certificat_bloquejat`. `canalitzacio_assistida()` elige el
cierre del ejercicio con desempate determinista (`calculado_at desc nulls last, created_at desc`,
`20270414101100`) y devuelve además, como claves opcionales que el frontend actual ignora, `oferta.modalitats` y
`canalitzacions[].valorizacion` —lo que necesitaría la deuda 130—.

| Fase | Qué se hace desde aquí |
| --- | --- |
| **1 · conveni** | `preparar_convenio` · **firma asistida** (diálogo) · `contrafirmar_convenio` |
| **2 · entrada** | La oferta ya existe; se enlaza a su detalle. El alta asistida usa `FormulariNovaOferta` |
| **3 · distribucio** | Se enlaza al detalle de la oferta, donde viven priorizar y enviar |
| **4 · aprovacio** | **`manifestar_interes_assistit`** (lo que la entidad dice por teléfono) y `aprovar_resposta`, con el mismo aviso previo de convenio que `Aprovacions` |
| **5 · lliurament** | `marcar_entregado` y la **confirmación asistida** (diálogo). Emitir y conciliar enlazan a `AlbaraDetall` |
| **6 · tancament** | Enlaces a Costos y Tancament, y el certificado **explicado como bloqueado** |

🔁 **La tabla es la del 21-09-2026.** Desde el 27-10-2026: la fase 2 valida la oferta y la convierte en
espigolada ahí mismo; la 3 lleva el texto para copiar y las diez primeras entidades con «Copia i marca
com a enviada»; la 4, `FormulariInteresAssistit` y `FormulariAprovacio`, más «Dona'l per vigent»; la 5,
la hora (`fixar_hora_recollida()`), «Registra la recollida (en nom de X)» (`DialegRegistraRecollida`: la
ficha de la operación y el MISMO `RegistraRecollida` de la receptora en modo asistido, o validar si ella
ya registró), los albaranes que salen solos y «Concilia» (`DialegConciliar`, extraído de `AlbaraDetall`);
y la 6, el coste de referencia y el destino final (`DestiFinal`). Solo el cierre anual sigue en su
pantalla: es del ejercicio, no del lote.

⚠️ **Lo que NO se hace aquí es deliberado.** Emitir un albarán con sus líneas y el cierre anual
tienen sus pantallas con sus editores; esta enlaza a ellas. Un segundo editor de líneas es un segundo
sitio donde el número de kilos puede acabar siendo otro. 🔁 Conciliar sí se hace aquí desde el
27-10-2026, con el mismo diálogo (`DialegConciliar`) que la ficha del albarán.

⚠️ **El certificado REAL está bloqueado, y no por código.** `emitir_certificado()` se niega
mientras `parametros_documentales.datos_provisionales` sea `true`, y hoy lo es: es material de
la fase 0 lo que falta (§12.10), no software. La pantalla lo enseña como el último escalón,
visible y con su motivo, en vez de esconder el botón. `dadesFiscalsProvisionals()` responde
`true` ante cualquier duda — decir «ya puedes certificar» cuando no se puede es el único error
caro.
✅ **En modo PRUEBA sí se emite** desde el 21-09-2026 (`20260921214526`), así que el ciclo
guiado se puede recorrer **entero**, certificado incluido. Lo decide
`bloquejaProvisionals(provisionals, mode)`, no `dadesFiscalsProvisionals()` a secas.

⚠️ **Una espigolada no recorre las seis fases**: entra por la 5 con su REC ya creado
(`crear_espigolada`). Sus fases 2-4 salen `fet` **con su motivo**, nunca `pendent`.

⚠️ **La fase del ÍNDICE es una aproximación honesta.** `canalitzacions_actives()` devuelve un
resumen —no las respuestas ni los albaranes uno a uno—, así que la fila afirma solo lo que ese
resumen permite afirmar y lo que no viene se deja **vacío**, nunca inventado. El detalle manda.
✅ **Y desde el 28-09-2026 coincide con la ficha en los 12 lotes de prueba**, medido fila a fila
(`20270406100400` y `…100500`). Antes discrepaba en cinco: no sabía nada de los albaranes de
salida (una espigolada conciliada entera salía «Emet els albarans de sortida»), ni de los envíos
sin respuesta, ni de los intereses por aprobar, y daba por bueno **cualquier** convenio del
generador cuando una venta o maquila exige el `com`. La RPC devuelve ahora `origen`,
`sortida_estado` (el ENT/OPE menos avanzado), `tot_conciliat`, `n_respostes` y
`n_per_aprovar_sense_conveni`, y elige el convenio con `convenios_exigidos`, como
`canalitzacio_assistida()`. El texto del paso de cierre se reescribió en condicional: bajo
«Bloquejat» afirmaba que el lote «ja pot entrar» al cierre.

🔴 **Y la pantalla es una CONVENCIÓN, NO UNA IMPOSICIÓN** (deuda §12.109). `authenticated`
conserva escritura directa sobre `oferta_respuestas` y `canalizaciones`, así que los atajos de
`OfferDetail` siguen ahí. «Salen los mismos documentos y los mismos correos» es cierto **cuando
se usa esta pantalla**, y no se puede afirmar que siempre se use mientras los atajos estén
abiertos.

**Los tres diálogos asistidos** (`components/equip/`) clonan `DialegFirmaConveni`: 80 vw × 88 vh,
no se cierran al pinchar fuera —con los kilos tecleados y a media llamada, un clic despistado
sería caro— y **acuñan el enlace AL ABRIR, no al montar**: `acunar_enllac_assistit()` revoca el
enlace anterior de ese objeto, así que acuñarlo de más le rompería a esa persona el enlace que
tiene en el correo (§12.97). `DialegAssistit` sirve para el albarán **y** para la factura —es el
mismo gesto y solo cambia el propósito—; `DialegFirmaAssistida` se queda aparte porque su enlace
lo acuña otra RPC y lleva segundo factor.

✅ **Y el tercero, `DialegNovaOfertaAssistida`, abre el ciclo en vez de continuarlo**
(21-09-2026). Hasta ese día el alta asistida solo se alcanzaba **desde dentro de un lote que ya
existiera**: `FormulariNovaOferta` aceptaba `productorId` por prop desde julio, pero no había
ninguna puerta para estrenar uno. El botón vive en el índice —que es donde alguien va a buscar
«un lote nuevo»— y al crear la oferta **navega a su ciclo**, así que el recorrido empieza donde
termina el alta. No es un segundo formulario: es el mismo que usa el productor en su panel, con
el mismo descriptor de `crear-oferta/campos`. ⚠️ Lleva **`key` por productor**: al cambiar de
organización hay que volver a pedir el descriptor —los catálogos dependen de sus ubicaciones— y
sin ella React reutilizaría la instancia con las respuestas de la anterior dentro, que es el
mismo fallo que ya costó una vez en `PerfilOrganitzacio` (§6ter).

✅ **La fase 4 enseña el convenio de CADA receptora, y lo resuelve ahí mismo** (21-09-2026).
`aprovar_resposta()` exige convenio vigente desde la fecha de corte (`42501 sense_conveni`), y
la pantalla decía «prepara i fes signar el seu conveni» mandando a otra: el interés se aprobaba
a ciegas y se chocaba contra la base. Ahora cada interés pendiente lleva el badge de su convenio
y los botones que lo arreglan —preparar, firma asistida, contrafirmar—, y «Aprova i canalitza»
está apagado hasta que sea `vigent`. El **tipo** de convenio se deriva de la modalidad del lote
(`conveniQueCalRebre`, la fila `parte = 'recibe'` de `convenios_exigidos`) en vez de preguntarlo:
la RPC ya devuelve el convenio de cada entidad, y lo único que faltaba para poder crearlo era su
tipo. ⚠️ Si algún día esa matriz deja de ser función de la modalidad, esto ya no se puede derivar.

✅ **Y un bloqueo lleva a donde se arregla.** El motivo `canal.bl_sense_conveni_gen` se nombraba
y ahí acababa: había que adivinar que se resuelve una tarjeta más arriba. Ahora el aviso trae el
botón que **abre la fase 1 y baja hasta ella** (`id="fase-<clau>"` + `scroll-mt-20` en cada
tarjeta). Decir el motivo sin decir dónde se resuelve es la mitad del trabajo.

**Y los dos actos asistidos están TAMBIÉN donde ya se trabajaba**, no solo en la pantalla
guiada: `AlbaraDetall` lleva «Confirmació assistida» cuando el albarán está `entregado`, y
`TancamentDetall` lleva «Factura amb acompanyament» junto al botón de factura de cada donante.
Quien está revisando un albarán no tiene por qué salir a otra pantalla para llamar por teléfono.

⚠️ **En el albarán eso cierra un hueco real, no añade un atajo**: `marcar_entregado()` solo crea
enlace `where d.email is not null`, así que **una ficha sin correo no tenía forma de confirmar
nunca**. La vía asistida no necesita correo — el enlace no se manda, se abre.

✅ **Comprobado end-to-end contra producción el 21-09-2026**, con la vía de factura sobre un
cierre de prueba: `acunar_enllac_assistit()` deja la fila con `canal = 'asistido'` y
`creado_por` = la cuenta que la acuñó, y el GET de `enlace-publico` **sin `Authorization`**
—que es exactamente lo que hace el formulario embebido en el diálogo— responde
`assistida: true` y sin ningún hash. Después se revocó el enlace: el ensayo no deja rastro
más que su fila.

⚠️ **Lo que NO se ha ejercitado todavía es el ciclo entero**, y no por falta de ganas: cada
recorrido **quema numeración legal** (REC/ENT/OPE, CONV) de forma irreversible, igual que ya ocurre
con cualquier prueba de albarán. El guion de la demo —`Horta de Prova SL` como generador, con su
`don_gen` en `esborrany`, y `Menjador Social de Prova` como receptora, con su `don_rec` en
`pendent_firma` a propósito (§9)— está listo para cuando se decida pagar ese precio. **No usar
`Mas de Prova SCP`**: su `don_gen` ya está `vigent` y la fase 1 saldría resuelta.

✅ **Y ese guion ya está escrito paso a paso**, para que quien lo recorra no tenga que
reconstruirlo de este documento: **`docs/Guía de prueba — ciclo completo asistido.md`**
(21-09-2026, fuera de git como todo `docs/`). Lleva las seis fases con la cuenta, la pantalla y
el texto literal de cada botón, qué comprobar en pantalla y en el correo, y **la tabla que
contrasta el camino propio con el asistido** —firma, interés, confirmación y factura— que es la
única forma de demostrar la afirmación de esta sección: que los dos producen el mismo documento
y solo cambia la vía impresa en la página de evidencias. El certificado final aparece ahí
**bloqueado y explicado**, y la guía dice que ese es el resultado correcto, no una avería.

### «Producte al camp»: convertir una oferta en espigolada (22-09-2026)

**El caso real más común del espigueo es el intermedio**, y hasta hoy no tenía camino: un generador
avisa de que tiene un campo **sin cosechar**, eso se publica como oferta para ver quién la quiere,
y **después** se monta la jornada. Sin esto, el equipo tenía dos salidas y las dos eran malas:
repartir la oferta como si el producto estuviera recogido —y entonces el REC que nace del trigger
de `canalizaciones` declara una entrada que **nadie ha pesado**—, o crear la espigolada aparte, con
lo que quedaban **dos entradas del mismo producto** y la conciliación contaba los kilos dos veces.

Lo que se añade es mínimo a propósito: una marca en la oferta (`producte_al_camp`, §4), un enlace
en la jornada (`oferta_origen_id`) y una rama en `crear_espigolada()` que **reutiliza** la oferta en
vez de crear otra (§4bis).

| Dónde | Qué |
| --- | --- |
| Alta de oferta (panel **y** WhatsApp) | El paso `producte_al_camp`, con el mismo texto por los dos canales (§6bis) |
| `OffersList` | Chip «Producte al camp» en las convertibles, para que el destino del tablero sea honesto |
| `OfferDetail` y fase 2 del ciclo guiado | Botón **«Converteix en espigolada»**, solo si `producte_al_camp` y sin `espigolada_id`; abre `DialegEspigolada` (80 vw × 88 vh, sin cerrarse al pinchar fuera) con productora, finca y la línea de producto **prellenadas** |
| `Espigolades` | Badge «Ve d'una oferta» y enlace inverso a la oferta de origen |
| Tablero | La cola 13, `espigolades_per_convertir`, que va al listado de ofertas: la jornada **todavía no existe** |

⚠️ **El generador nunca decide el destino.** En su panel la oferta enseña el `PasosProces` de
siempre más una nota —«L'equip decidirà si organitza una espigolada»—, que es una **variante de
texto en `procesOferta.ts`, sin etapa nueva**. Y esa nota se pinta en `bg-secondary`, **nunca en
`aviso`**: no es nada que le toque hacer a quien mira, y gastar el ámbar ahí rompería la única
señal de «te toca a ti» (§2bis).

⚠️ **Los siete rechazos se traducen por su CÓDIGO**, no por el mensaje crudo de Postgres
(`src/lib/conversioEspigolada.ts`, puro y con test). El panel además **anticipa** dos de ellos
—`ja_te_canalitzacions` y `ja_te_albarans`— con el motivo visible, pero eso es un aviso: **la
autoridad sigue siendo la RPC**, y si el panel se quedara corto el diálogo enseña el rechazo.

⚠️ **Y una oferta convertida admite UNA sola línea.** Más de una obligaría a decidir en silencio
qué se hace con las demás —¿excedentes nuevos? ¿se descartan?—, y eso no se decide dentro de un
bucle: la base se niega con `massa_linies`. Si algún día una jornada tiene que recoger varios
productos partiendo de una oferta, se añade explícito.

### Diagnòstic i pla de prevenció: la banda, la marca y la tarjeta (22-09-2026)

> 🔴 **Plan 2 A1 (10-11-2026)**: la banda deja de pedir «fes el teu diagnòstic» (el productor ya no lo contesta,
> D5) y pasa a **«Completa la teva Operativa»**, solo cuando el productor **no tiene ningún lugar de recogida**, con
> enlace a la pestaña Operativa de «La meva organització». Es la parte de P3 que cabe en A1: los productos
> habituales son `edita: 'equip'` hasta A4, así que pedírselos al productor le pediría algo que no puede hacer; A4
> añade «sin productos habituales» y «sin lugar principal». La clave de descarte en `localStorage` cambia para que
> la banda nueva no herede un descarte viejo (`redestina-operativa-descartat`). Componentes: `AvisOperativa` +
> `useOperativaPendent` (sustituyen a `AvisDiagnostic`/`useDiagnosticPendent`); `LlocsRecollida` llama a
> `refrescaAvisos()` al añadir o borrar un lugar. **El punto del menú pasa a «La meva organització»**: es donde se
> arregla (en «El meu diagnòstic» el productor ya no puede hacer nada); si la ficha está incompleta manda el
> triángulo rojo (una sola marca por entrada). `TargetaDiagnostic` queda solo en modo `extern` y en lectura.

**El diagnóstico se pide en el panel TRAS validar el alta**, no en `/registre`: un formulario de
doce preguntas en la puerta no lo termina nadie. Y **el equipo puede rellenarlo en nombre de la
organización** desde su ficha, antes o después de aprobar — es el modelo asistido (§1bis).

Un solo `FormulariDiagnostic` para los tres sitios, que es el patrón de `FirmaConveni`. Dos
botones, porque **la base guarda siempre, completo o no**: «Desa i genera el pla» y «Desa i
continua més tard».

⚠️ **Un booleano se pinta con DOS casillas (Sí / No), no con una.** Una casilla sola tiene dos
estados y aquí hacen falta tres: sí, no y **«todavía no lo he dicho»** — que es justo lo que mide
`diagnostic_falten()`. Con una sola, «responder que no» y «no responder» serían el mismo píxel, y
una obligatoria contestada con «no» quedaría pendiente para siempre.

⚠️ **La banda va en tono `aviso`, no en rojo**, al revés que la del convenio: el diagnóstico **no
bloquea operar**. Y **se puede descartar 30 días**, con el mecanismo exacto de `AvisInstallacio`
—la **fecha** en `localStorage`, no un booleano, porque un booleano no sabe expresar eso—: es la
tercera banda que se pinta encima de `AvisConveni` y `AvisRegistreIncomplet`, y las dos rojas se
van solas al hacer lo que piden mientras que el diagnóstico es opcional y la mayoría no lo va a
tener nunca. Es el mismo argumento por el que **no** se le dio cola en `pendents_equip()`, y sería
incoherente aplicarlo en un lado y no en el otro.
⚠️ **La marca del menú lateral NO se descarta**: descartar no es haberlo hecho. Y se calcula **una sola vez en `AppShell`** y se reparte a la banda y a la marca
del menú — calculadas por separado, el contador y la banda podrían decir cosas distintas (§6ter).

🔴 **Y una banda NO se pinta en la pantalla a la que manda** (22-09-2026, medido en el
navegador, §12.117). `AvisDiagnostic` se montaba en `AppShell`, o sea encima de **todas** las
pantallas del panel, y eso incluía `/organitzacio/diagnostic` —te invitaba a ir donde ya
estabas— y `/organitzacio`, donde `TargetaDiagnostic` ya dice lo mismo con el mismo botón un
palmo más abajo. No era cosmético: a 320×812, con `AvisConveni` y el aviso de cuestionario
provisional encima, el **primer encabezado de contenido del cuestionario caía a 794 px de los
812 de la ventana** — se abría el diagnóstico y no se veía ni una pregunta. La lista vive en
`RUTES_MUDES`, dentro del propio componente y no en `AppShell`: la regla es de la banda, y
quien añada mañana una pantalla que repita ese mensaje tiene que encontrarla donde la banda
está. Con el arreglo, ese encabezado sube a **404 px**.
⚠️ Esto **no** aplica a las dos bandas rojas: `AvisConveni` anuncia un bloqueo que afecta a
cualquier pantalla, no una invitación a ir a un sitio.

⚠️ **El prefill solo propone lo que la pregunta puede aceptar**, y hoy eso es **uno de los cinco
sembrados**: `productos_habituales` son nombres de producto contra opciones que son familias, y
dos booleanos de la ficha apuntan a preguntas de selección múltiple. Donde no encaja **no se
propone nada**, y lo que sí se propone se marca como propuesto hasta que alguien lo toca: un valor
sugerido que se queda sin revisar acaba siendo una respuesta que la persona no ha dado.

✅ **Y el botón dice lo que falta** (28-09-2026): en la banda (`diag.banner_go_<estat>`) y en la
tarjeta de la ficha (`TargetaDiagnostic`: «Fes-lo», «Continua», «Revisa i emet el pla», «Obre’l»).
Antes las dos decían «fes el diagnòstic» con el diagnóstico ya contestado. La lista del equipo
(`/equip/diagnostics`) ya no recorta los nombres: con el recorte, la marca «Prova» desaparecía
justo en los largos.

⚠️ **Regenerar el plan se intenta SIN forzar**, y solo se pregunta cuando la base contesta
`22023 mesures_editades`. Y **las obligatorias no llevan casilla de quitar**: la base rechaza la
lista que las pierda, y ofrecer un control que va a fallar es peor que no ofrecerlo.

✅ **Ejercitado contra producción el 22-09-2026** con `Mas de Prova SCP`: un diagnóstico incompleto
guarda y devuelve las ocho obligatorias que faltan sin generar nada; completo, **9 reglas disparan
→ 6 medidas tras desduplicar, 1 obligatoria** (la de registro), y las seis son coherentes con lo
respondido — calibre y estético → segunda categoría y revisión de criterios; sin frío → cadena de
frío mínima. Queda ese plan en borrador, que además da fixture a los checks que §12.116 no cubre.

### Documentació de l'organització: el archivo de antes de Redestina (22-09-2026)

**`RecordDetail` gana un segundo slot, `seccions`**, que se pinta **fuera** del `<Card>`. El de
siempre, `avisos`, es «lo que hay que saber antes de tocar la ficha» —convenio, organización
enlazada, diagnóstico, certificados—; esto es un **apartado de trabajo** con tarjeta propia. El
componente genérico sigue sin saber de convenios ni de documentos: los dos slots reciben nodos.

`components/equip/DocumentacioOrganitzacio` (en ese slot, solo con `id`) hace tres cosas:

| | |
| --- | --- |
| **Lista** | Los externos de la ficha **y los de sus convenios**, agrupados por ejercicio —manda la fecha del papel, no la de subida— y cada uno con su botón de **descarga** (§4) |
| **Puja documentació** | Formulario en línea: tipo (`certificat_previ` · `pla_previ` · `altre`), ejercicio, número y fecha del documento ajeno, y el fichero |
| **Registra un conveni signat en paper** | Abre `DialegConveniPaper`. Con `BotoAmbMotiu`: a quien no es super_admin se le deja gris **con el motivo**, no se le esconde |

⚠️ **El ejercicio se teclea, y es el único objeto donde pasa.** Un albarán, un cierre o un
convenio tienen el suyo en la base; una ficha no tiene ninguno, y lo que se archiva ahí es papel
viejo: sin ese campo, un certificado de 2023 iría a la carpeta del año en que alguien lo escanea.

🔴 **Un plan previo en PDF NO marca el diagnóstico como hecho**, y el formulario lo dice en cuanto
se elige ese tipo, con el enlace a `/equip/diagnostics/:tipus/:id` al lado. El diagnóstico se
contesta —hay cuestionario, reglas y plan generado (§4)—; un PDF antiguo es contexto, no respuesta.

**`DialegConveniPaper`** clona `DialegFirmaAssistida` (80 vw × 88 vh, no se cierra al pinchar
fuera) y ejecuta los tres pasos **en orden**: `preparar_conveni_en_paper` → subir el escaneado →
`registrar_conveni_en_paper`. Si falla el tercero, el convenio se queda en `esborrany` —inocuo, y
el siguiente intento lo reutiliza— con su PDF ya colgado. Los rechazos se traducen **por su
código** (`motiuConveniPaper`), nunca por el texto de Postgres, como en `conversioEspigolada.ts`.

⚠️ **`BadgeConveni` pinta el papel VERDE**, igual que cualquier vigente, con el texto «signat en
paper» y su referencia. No es un matiz estético: es vigente de verdad, y pintarlo en otro tono
diría que vale menos. El badge histórico heredado del Excel no cambia y sigue siendo lo que era.

**Y en el panel externo**, `components/documents/DocumentsDeLEquip` —la quinta pieza compartida por
los dos paneles— lista lo mismo bajo «Documentació aportada per l'equip», solo lectura y con
descarga. **Se calla si no hay ninguno**: una tarjeta vacía más en un panel que ya tiene seis no
informa de nada.

✅ **Ejercitado de punta a punta contra producción el 22-09-2026**: un certificado de 2023 subido a
la ficha de `Horta de Prova SL` cae en `productors/<id>/2023/externs/` y **se descarga** (610 B,
`%PDF-1.4`, nombre `certificat_previ-CERT-2023-007.pdf`); un ejercicio de 1874 responde 400 y una
ficha inventada, 404. Y el convenio `com` de `Obrador de Prova`: sin escaneado se niega con
`falta_escanejat`, con fecha futura con `data_futura`, y con el papel subido queda **`vigent`,
`origen='paper'`, `serie` y `numero_completo` NULL** y `referencia_paper = CONV-OBR-2024-003`.
`convenio_vigente(...,'venda','recibe')` pasa a `true` y `exigir_convenio()` devuelve `null`: la
organización puede operar, por el camino de siempre y sin haber tocado esas dos funciones.

### Els meus documents: lo pendiente y el archivo (14-09-2026)

Las dos pantallas de documentos (`/productor/documents`, `/receptor/documents`) enseñan lo
mismo salvo los importes, y comparten los cuatro componentes de `src/components/documents/`:

| Bloque | Productor | Receptor |
| --- | --- | --- |
| **Pendent de tu** (`PendentsDeTu`) | ✅ | ✅ |
| Convenis (`LlistaConvenis`) | ✅ | ✅ |
| Acumulado del año, factura y certificado | ✅ **con importe** (venta y maquila, sin importe ni resumen anual: el CT no tiene) | ❌ **por diseño** |
| Albarans (`TaulaAlbarans`) | REC | ENT y R-ENT |
| Certificats a demanda (`cierre_periodo`) | ✅ | ❌ |
| **Quilos rebuts de l'exercici** (`kg_rebuts_exercici()`) | ❌ | ✅ **leído en SQL**, no sumado en cliente |
| **Certificats de recepció** (`cierre_receptor`) | ❌ | ✅ |
| Pla de prevenció (`LlistaPlans`: el sustituido sale «Substituït», enlace al diagnóstico) | ✅ | ✅ |

⚠️ **Listar no necesitaba nada de base**: `documents_meus()` ya devolvía convenios, planes y
certificados a demanda desde la fase 5, y **las pantallas los descartaban en silencio** (el
productor los cargaba y los tiraba; el receptor los filtraba en el `select`). Lo que faltaba
de verdad era lo **pendiente**, porque `enlaces_token` es invisible para un externo.

**Firmar y confirmar desde el panel**, sin salir de la aplicación: el botón llama a
`acunar_enllac_propi()` y navega a `/signar/:token` o `/confirmar/:token` con
`state.tornar`. **No hay un segundo circuito de firma**: mismo texto compuesto por el
servidor, misma huella, misma evidencia, y las páginas siguen siendo públicas —lo que
autoriza es el token—. Con sesión enseñan además «Torna al panell».

🔴 **«Pendent de tu» firma EL CONVENIO DE LA FILA, no «el del papel»** (bug del 08-10-2026, Mas
de Prova SCP: `don_gen` vigente y `com` pendiente). El diálogo llamaba siempre a
`signar_conveni_propi()`, que deduce `don_gen`/`don_rec`, así que firmar el `com` abría y
firmaba un `don_gen` nuevo sobre el vigente (CONV-DON-GEN-2026-0005 a 0008, cuatro números
legales quemados) y el `com` seguía pendiente: la persona leía «firmo, me lo aceptan, y me
vuelve a pedir el convenio». Ahora `PendentsDeTu` pasa `conveniId` a `DialegFirmaConveni`, que
usa `acunarEnllacConveni()` (`acunar_enllac_propi`, que admite cualquier tipo), y la base se
niega a abrir un convenio encima de un vigente (§4bis). Solo `AvisConveni`, que no tiene un
convenio concreto delante, sigue por el camino del papel. ⚠️ Queda sin cubrir un caso límite:
`useConveni` mezcla tipos al calcular el estado, así que una organización SIN `don_gen` y con un
`com` pendiente vería el aviso «pendent» y su botón prepararía/firmaría el `don_gen`. Es lo que
le falta de verdad, pero el texto del aviso no lo dice.

⚠️ **Acuñar desde el panel REVOCA el enlace del correo.** Es el precio, y es aceptable
porque quien acuña es esa misma persona y lo usa al momento; si lo pierde, el panel le da
otro. El corolario es que **no hay check del arnés que lo ejercite en positivo**: correría
también contra producción y le rompería el enlace a alguien real.

**El acumulado del año de la receptora sale de `kg_rebuts_exercici()`, no de una suma en
cliente**, y eso no es una preferencia: si se sumara en la pantalla, esa cifra y la del
certificado acabarían discrepando sobre lo mismo. Los **pendientes de conciliar** van en banda
ámbar aparte, diciendo que **no cuentan como oficiales ni entran en ningún certificado** (D13) —
ámbar y no rojo, porque no está roto, está a medias.

⚠️ **Solo se listan los certificados EMITIDOS** (`certificado_numero not null`): un borrador es el
equipo probando una ventana, no un papel (§12.112).

**El sello y su verificación.** El panel de la receptora ofrece un fragmento copiable —un `<a>`
envolviendo al `<img>`, con **URL absoluta**: lo que acredita no es la imagen, que se copia, sino
el enlace; un `/verificar/…` relativo pegado en otra web apuntaría al dominio de esa web—. La
página pública tiene **cuatro finales, no tres**: válido y vigente (verde), **sustituido** (ámbar:
es auténtico, pero hay uno posterior que ya incluye esos kilos), no consta (rojo) y **«no lo
sabemos»** (neutro) cuando la consulta falla. El cuarto no se puede omitir: pintar un fallo de red
como «no consta» **acusa de falsificador** a quien enseña un certificado bueno.

⚠️ **`codiVerificacio()` es la SEGUNDA implementación del mismo formato** —la primera es
`codigoVerificacion()` en `_shared/pdf/render/`, que es la que imprime—. Están duplicadas a la
fuerza, porque aquella es Deno y arrastra el motor de PDF, y **divergir no fallaría**: el sello
enlazaría a un código que no es el del papel. Por eso tiene prueba propia.

⚠️ **Lo pendiente lo decide el estado del OBJETO, no el del enlace.** Un convenio en
`pendent_firma` está pendiente aunque su enlace haya caducado, y como el botón acuña uno
nuevo, el viejo deja de importar. El último enlace se enseña solo como información («te lo
mandamos el día X»).

**`AvisConveni`** ya no dice «mira el correu», y desde el 16-09-2026 **lleva un botón que firma,
no un enlace a otra pantalla**: llama a `signar_conveni_propi()` y navega a `/signar/:token`. Hasta
ese día solo actuaban los dos casos que el equipo ya había enviado, y **el caso normal del alta
self-service no tenía nada que pulsar** —`registro` deja el convenio en `esborrany` y ahí se
quedaba—, así que la persona leía que le faltaba el convenio y no podía hacer nada. `firmat` es el
único estado sin botón: ahí la pelota es del equipo (falta la contrafirma). Distingue el cuarto
caso (`retornat`). El menú de los dos paneles lleva contador
(`pendents_productor` / `pendents_receptor`, uno por panel para que el doble rol no los
mezcle) y la barra inferior de móvil un **punto**, no una cifra: la celda mide ~85 px y ya
va justa con la etiqueta (§2). La etiqueta del receptor pasa de «Albarans» a «Documents»
porque ahora también hay convenios y plan.

Los tres cuelgan de `RequireSessio` y de `/panell`, que es la raíz por rol (§6quater); la raíz `/`
es desde el 31-07-2026 la página pública.

Las pantallas del equipo son **los mismos componentes de siempre** (`Dashboard`, `OffersList`,
`OfferDetail`, `ProducersList`, `EntitiesList`, `RecordDetail`, `ContactList`, `Conversation`,
`Settings`), sin tocar: lo único que cambió es quién los monta y de dónde sale el `id`.

### Doble rol: borrar una ficha pregunta por los dos papeles (16-09-2026)

En la ficha del equipo (`RecordDetail`, rutas `/equip/productors/:id` y `/equip/entitats/:id`),
**Esborrar** busca primero la ficha del otro papel con el mismo `organizacion_id`. Si existe, en
vez del «¿seguro?» abre `useTria()` (nuevo, en `DialegConfirma.tsx`, mismo patrón de promesa;
resuelve `null` al cancelar) con tres salidas: cancelar, **solo esta ficha** o **las dos**. Se
borra primero la ficha abierta y luego la hermana; si la segunda falla se avisa con
`rec.dual_partial` y se vuelve al listado. Solo frontend: sin migración (el `delete` sobre las dos
tablas ya lo tenía `authenticated`). La fila de `organizaciones` no se toca, igual que antes.

**Aviso de cuentas afectadas (16-09-2026).** Antes de abrir cualquiera de los dos diálogos se
cuentan las `membresias` de las fichas que se van a borrar; si hay alguna, la descripción avisa de
que esas cuentas se quedarán sin panel y sin acceso (las membresías caen en cascada). Motivo: se
borraron las dos fichas de Carles Sanz y la cuenta de prueba `hola+wa-carles@` se quedó sin entrar
a ningún sitio. Para recuperarla: recrear las dos fichas con `hola@carlessanz.com` (y `es_test`)
y relanzar `scripts/crear-usuarios-whatsapp.ts`, que enlaza por correo sin tocar la contraseña.
En el login, las etiquetas del grupo WhatsApp pasan a «Productor + Receptor (social)».

**Vocabulario (16-09-2026).** En el menú del equipo, grupo «Organitzacions», «Productors» y
«Entitats» pasan a **«Entitats productores»** y **«Entitats receptores»** (es: «Entidades
productoras/receptoras»), porque las dos son entidades y una misma puede ser las dos cosas. Cambian
`nav.producers`, `nav.entities`, `prod.title`, `rec.producer` y `rec.entity` (ambos en femenino).
Los KPI del tablero (`dash.k_*`) no se han tocado.

**Carrera del acceso directo → «Encara no tens panell» (16-09-2026).** Con datos correctos
(verificado en producción: `hola+wa-sebas@` tiene sus dos membresías activas y la RPC devuelve
las dos organizaciones), una cuenta podía quedarse en `/sense-acces`: `/panell` se resolvía con
el contexto previo al login (vacío) y `SenseAcces` no volvía a mirar al llegar el bueno. Arreglo:
`SenseAcces` redirige a `/panell` si el contexto ya trae paneles, y `carrega()` de
`useAppContext` descarta respuestas de cargas anteriores (contador `darrera`).

**«Entitat productora» en toda la interfaz (16-09-2026).** Todo el texto visible que decía
«productor/a» pasa a «entitat productora» (es: «entidad productora»): portada, registro, login y
sus accesos de prueba, filtros de Missatgeria, Espigolades, Aprovacions, textos del proceso y del
tablero. Solo textos (`i18n.tsx`, `accessosTest.ts`); rutas (`/productor/…`), tipos y columnas no
cambian. Cabecera pública rehecha: 64px, navegación junto al logo (antes centrada y lejos de la
marca), enlaces en peso medio con hover y foco, divisor entre idioma y acciones. Solo los títulos de sección (h2) llevan el color de marca; los círculos numerados y los
títulos de tarjeta (h3) van en verde (`bg-primary` / `text-primary`).
🔴 **Y desde el 16-09-2026 esos h2 van en `coral-oscuro` (#e56a5c), que es el color EXACTO
del «RE» del logo, no en `coral-texto`.** Es decisión del cliente tomada sabiendo el precio:
sobre el crema de la portada da **2,85:1**, por debajo del 3:1 que WCAG pide incluso para
texto grande. Se midió, se le dijo, y su respuesta fue «me da igual la legibilidad, quiero
ese naranja». **No se «arregla» volviendo a `coral-texto`** —eso ya estuvo y se cambió
justamente porque no se parecía al logo—: quien vuelva a medirlo y quiera corregirlo, que lo
hable antes con él. Vale **solo** para esos dos títulos. Escala responsive equilibrada: cabecera 64px (móvil) / 80px (md+), logo
h-10/11/12 según ancho, navegación `text-sm` → 15px en lg, y el título del hero baja a
`sm:text-4xl xl:text-5xl` con `max-w-4xl` y `text-balance` para no dominar sobre la marca
(los anclajes usan `scroll-mt-16 md:scroll-mt-20`, a juego con la altura).

**Home (16-09-2026).** Los títulos de sección bajo el hero de `Landing.tsx` van en
`text-coral-texto` (los de tarjeta, en verde) (el coral de marca en su variante de texto accesible, no `text-coral`).

### Doble rol: los paneles se ven todos a la vez (31-07-2026)

Una cuenta puede tener más de un panel —productor y receptor, y también el del equipo—. Hasta hoy el
menú enseñaba **uno cada vez**, con un conmutador en el pie. Ahora los enseña **todos**, uno debajo
de otro, cada uno con su cabecera (`panel.producer` / `panel.receiver` / `app.team`) y separados por
un `SidebarSeparator`. Con **un solo panel la interfaz es idéntica a antes**: sin cabeceras y con el
nombre de la organización arriba, que es el caso de casi todas las cuentas.

El conmutador, además, **no funcionaba**: solo llamaba a `setRolActiu` sin navegar, y el `RoleGuard`
de la ruta en la que estabas lo revertía en el render siguiente. No se notaba porque hasta hoy no
había ninguna cuenta real con doble rol.

**El panel activo se deriva de la URL** (`rolDeLaRuta()` en `src/lib/rols.ts`, inversa de
`rutaArrel()`, comparando el **primer segmento entero**, no un prefijo). Antes era un `useState` que
tres sitios distintos tenían que mantener en fase con la ruta, y se desincronizaba de verdad: cada
`SIGNED_IN` devolvía el panel activo al preferido, así que a una cuenta de doble rol se le vaciaba el
mercado hasta que la guarda lo corregía. Tres consecuencias, todas deliberadas:

- **`RoleGuard` ya no escribe estado durante el render** (era un efecto en render, que React 19
  señala). Y cuando deniega, redirige a **`/panell`**, no a `rutaArrel(rolActiu)`: con el rol
  derivado, ese destino sería la propia ruta denegada y la pantalla se quedaría **en blanco sin
  ningún error**. `/panell` es el único sitio que no pertenece a ningún panel.
- **Las pantallas declaran qué organización quieren** con `useOrganitzacio('productor'|'entidad')`,
  en vez de heredar la del panel activo. Invierte el contrato: una pantalla de productor ya no puede
  acabar leyendo la ficha de la entidad porque el panel activo fuera otro.
- **`PerfilOrganitzacio` recibe el tipo por prop y las dos rutas llevan `key`.** Es la misma pantalla
  en `/productor/perfil` y `/receptor/perfil`, y react-router no pone `key` a rutas de la misma
  forma: React reutilizaba la instancia. Al saltar de una a otra cambiaban la tabla y los campos pero
  **la fila seguía siendo la anterior**, así que pulsar «Desar» en esa ventana sobrescribía la ficha
  de la entidad con la dirección del productor y vaciaba cinco campos. Con el conmutador roto era
  casi inalcanzable; el menú unificado lo habría puesto a un clic.

**En móvil la barra inferior sigue enseñando solo el panel de la URL** (8 secciones no caben en 5
huecos); el menú lateral deslizante los enseña todos. Y los **contadores** del menú dependen ahora de
*tener* el panel de equipo, no de estar mirándolo: si no, los badges quedarían en blanco justo cuando
avisan de algo. De paso, la consulta —que se trae todos los `wa_messages`, deuda §12.5— deja de
relanzarse cada vez que se cruza de panel.

**El productor publica con el mismo cuestionario que el bot**, y no por copia: el formulario pide el
descriptor a `GET /functions/v1/crear-oferta/campos`, que lo sirve desde `_shared/camposOferta.ts`,
el mismo módulo del que el intake saca sus pasos. El alta llama a `POST /crear-oferta`, que reutiliza
`crearExcedente()` de `_shared/oferta.ts`: **un solo sitio genera `id_excedente` y `texto_oferta`**.
`authenticated` no tiene INSERT sobre `excedentes`, así que el correlativo no es falsificable.

**El receptor muestra interés** con la RPC `manifestar_interes()`, que deja la fila de
`oferta_respuestas` igual que el diálogo de WhatsApp (`acceptada` + `aprovacio='pendent'`, con
`canal='panel'`): **cae en la misma cola** que el equipo ya aprueba desde `OfferDetail`, con su
Realtime ya cableado.

Navegación anterior (barra superior de 6 secciones en `App.tsx`): retirada. **Configuració** (`Settings.tsx`)
va **por pestañas desde el 27-10-2026** (submenú horizontal, `?tab=` como en Albarans): **General**
(validación de ofertas, idioma), **Notificacions** (los tres interruptores de §8, el **modo test** como
«Destinataris» —«Només usuaris de prova» / «Tots els usuaris»—, las whitelists y «Com es decideix a qui
s'envia»), **Fundació**, **Impacte** y **Diagnòstic**. ⚠️ El contenedor de las
pestañas lleva `min-w-0` (es hijo flex del `Tabs`): sin él, a 320 px se pasaba 4 px (medido). Antes
reunía en una sola página el interruptor del **modo test** (§8), el de WhatsApp, el idioma, —desde el 21-09-2026— las
**dades de la Fundació** (`DadesFundacio`, §12.10: es lo que desbloquea el certificado real) y
—desde el 15-09-2026— las **dos whitelists de prueba** (`GestorWhitelist`), que antes ocupaban media pantalla del tablero. El
**Dashboard** (`Dashboard.tsx`) es la landing tras el login y desde el 15-09-2026 es una **cola de
trabajo**, en este orden: banner del modo test (solo si está activo), **«Pendent de l'equip»**
(`components/equip/PendentsEquip.tsx`, una fila por cola de `pendents_equip()` con cifra, por qué
importa y botón a donde se resuelve; «Res pendent» si todo es 0), **«Com funciona»** (seis pasos de
`FASES_EQUIP`, enlazados) y los KPIs agregados, ahora clicables. `OffersList` lleva pestañas
**Actives / Tancades / Totes** —antes las cerradas no eran alcanzables desde ninguna pantalla— y
`Albarans` lee `?tab=`, que es a donde apuntan los botones del tablero. `OffersList`, `ProducersList`
y `EntitiesList` llevan **buscador**; `ProducersList` **y** `EntitiesList` separan en dos grupos —primero los usuarios de
prueba (`es_test`, badge "Test", pueden recibir), luego el resto—. Mensajería muestra la lista
completa de contactos (ya no la conversación única), con **buscador** bajo el título «Contactes»,
un **filtro por tipo** (Tots / Productors / Receptors: clasifica cada contacto cruzando su teléfono
—normalizado a solo dígitos— con `productores.phone` y `entidades.telefono`; un doble-rol sale en
ambos), filas compactas (nombre y teléfono en una línea) y **orden por pendientes** (los contactos
con mensajes sin contestar arriba, con contador). La columna de contactos queda **fija** con scroll
interno propio (no scrollea la página). Desde la cabecera de la conversación se puede **borrar el
hilo entero** (papelera): elimina los `wa_messages` del contacto y su `wa_contact` (si vuelve a
escribir, el webhook lo recrea; §4). Layout responsive (§2).

**CRUD de productores y entidades.** Cada listado tiene, por fila, «Detalle» y «Enviar
mensaje», y en la cabecera «Nuevo/Nueva». «Detalle» abre `RecordDetail`, una ficha a pantalla
completa (como el detalle de oferta) con **todos los campos editables**; guarda (insert/update),
borra (con confirmación) y puede abrir la mensajería con el teléfono de la ficha. `RecordDetail`
es **genérico**: recibe las definiciones de `src/lib/crudCampos.ts` (`PRODUCTOR_CAMPOS` /
`ENTIDAD_CAMPOS`) y la tabla destino. Necesita los GRANT/RLS de escritura del §4. «Enviar
mensaje» (en listado y ficha) asegura el teléfono como `wa_contact` y abre Mensajería, tanto
para productores como para entidades.

**Envío de la oferta y feedback.** Los botones **«WhatsApp»/«Correu»** del detalle son **siempre
clicables** (rollover) y **cada clic da un toast**: enviado, o el motivo exacto (sense telèfon/correu,
opt-in, `es_test` amb mode test, finestra tancada). El gate `es_test` del **cliente** ahora **respeta
`test_mode`**: con el modo test apagado (producción) se puede enviar a cualquier entidad; el servidor
lo revalida (§8). ⚠️ `OfferDetail` toma ese `test_mode` del `modo_test` que devuelve
`priorizar-entidades` (no de `getTestMode()`, que sí usan otras pantallas). El envío intenta primero el **texto de la oferta**
(`texto_oferta`) dentro de la ventana de 24 h (gratis). Si el servidor responde `window_closed`, se
**ofrece enviarla como plantilla `oferta_excedent`** (acción explícita en el toast, porque tiene
coste), única vía de Meta para llegar a un receptor que no ha escrito: `enviarOfertaPlantilla` asegura
el `wa_contact`, construye los `components` con `construirComponentsOferta` (`src/lib/ofertaTemplate.ts`,
mapeo de `plantillas-meta.md §1`) y envía `type:'template'`. Está tras el flag
**`PLANTILLA_OFERTA_APROVADA`** (`src/lib/plantillas.ts`, hoy `false`): mientras esté apagado, el
toast avisa honestamente de que hace falta la plantilla aprobada + número de producción; el envío por
plantilla real se activa poniendo el flag a `true` cuando Meta la apruebe (§12.2). **Mensajería** también
confirma el envío de la salutació/plantilla (toast de éxito) y **bloquea reenvíos ~30 s** («Enviada ✓»),
para no duplicar plantillas de pago.

**Aceptación y aprobación de la oferta (panel).** Cada envío desde `OfferDetail` (WhatsApp o email)
deja una fila `pendent` en `oferta_respuestas`. La entidad que responde por WhatsApp la actualiza sola
mediante el diálogo (§5) —con `kg_solicitados` y `preu_ofert`— y el detalle lo refleja **en vivo**
(Realtime) en «Respostes de les entitats», con badge de `estado` **y** de `aprovacio`. El técnico puede
**marcar a mano** acceptada/rebutjada (imprescindible para el email, sin respuesta automática). Para una
fila `acceptada` pendiente de aprobar, el **superadmin** ajusta kg/preu y pulsa **«Aprovar i
canalitzar»**: se crea la `canalización` (`kg_confirmados`), se enlaza (`canalizacion_id`) y el
excedente avanza a `parcial`/`bloqueada` (misma regla que el alta manual); o **«Rebutjar»** con motiu.
Si los kg superan los que **faltan** por cubrir, pide **confirmación** (aviso no bloqueante, igual que
el alta manual): evita canalizar de más sin querer, pero permite hacerlo si es intencionado. Hoy
cualquier `authenticated` puede aprobar (no hay roles; §12). La aprobación/canalización necesita las
políticas de escritura de `canalizaciones`/`excedentes` (§4; se añadieron en
`20260724100000_…`, antes fallaba con «row-level security policy»).

**Copiar el texto de la oferta** escribe al portapapeles `text/plain` (con `\n`) **y** `text/html`
con **cada línea en su propio `<div>`** (`textoAHtmlPortapapeles`): así los saltos se conservan al
pegar en WhatsApp, correo o documentos. Un único `<div>` con `<br>` no basta: WhatsApp lo aplana al
pegar. El **composer del chat** (`Conversation`) es un `<textarea>` multilínea (`field-sizing`
crece con el contenido): conserva los saltos al pegar; **Enter envía**, **Shift/Alt+Enter** inserta
salto de línea.

**Primer contacto / salutació.** El botón de `Conversation` hace dos cosas según la ventana de
24 h: si está **abierta**, envía el **texto de salutació** en català con «respon OK» como texto
libre (`textoSalutacio`, `src/lib/plantillas.ts`) —así en pruebas se ve el mensaje real sin
depender de la aprobación de Meta—; si está **cerrada**, envía una **plantilla** por rol
(`plantillaPrimerContacte`): en test siempre `hello_world` (la única aprobada, contenido fijo en
inglés), en producción `salutacio_entitat`/`salutacio_productor` cuando `PLANTILLES_CA_APROVADES=true`.
En la consola una plantilla se registra con su **texto legible** si está en el mapa
`TEXTO_PLANTILLA` (`_shared/whatsapp.ts`); hoy ese mapa **solo cubre `hello_world`**, así que
`salutacio_*` y `oferta_excedent` caerían al fallback `[plantilla: nombre]` — al aprobarlas hay que
darlas de alta ahí (§12.2). Contenido de las plantillas en `_shared/plantillas-meta.md` (§12).

**Cancelar / anular una oferta ya creada.** `OfferDetail` ofrece dos acciones de anulación:
«Marcar como no colocada» (no se encontró destino, exige motivo) y «Cancelar oferta»
(estado `cancelada`). Un intake a medias no llega aquí: al cancelar se borra la sesión sin
crear excedente. Las ofertas `cancelada`/`cerrada`/`no_colocada` salen del listado de activas y
se cuentan en el Dashboard.

**Cabecera del detalle.** `OfferDetail` muestra en la cabecera la **modalitat**
(Donació/Venda/Maquila, claves `od.mod_*`) y, en `venda`/`maquila`, el **preu mínim** (€/kg). El
campo «Disponible fins» es un input de fecha **controlado** que arranca con la fecha parseada por el
intake (§6bis) y persiste al editar (se re-sincroniza con `exc.disponible_hasta` tras recargar).

**Priorización** (`priorizar-entidades` + `_shared/priorizacion.ts`, función pura). Dado un
excedente, ordena las entidades candidatas. Pesos: misma área +3 (mismo municipio +2 extra);
`transport_plataforma` +1 y `descarrega_toro` +1 (peso doble si `kg_total > 500`); producto
fresco + entidad que acepta frescos +2; `prioritat` suma `max(0, 3 - prioritat)`. Sobre el
orden por bloques (desde el 09-11-2026, deuda 168): **con el convenio que pide la modalidad**
arriba; **sin él**, al final con aviso «⚠️ Conveni pendent» (es lo mismo que `sense_conveni`); el
`estat` del Excel solo cuenta para **excluir** con `No procedeix` (antes `Signat`/`Pendent*` decidían el
bloque y un estado vacío excluía). Sin `opt_in` no se excluye, se
marca (no se le puede enviar por API). Sobre ese ranking, `OfferDetail` aplica un **reorden de
presentación estable**: primero las **contactables**, sin tocar la puntuación del servidor; y añade a
la línea de motivos «No és usuari de prova» en las que no lo son, para que se vea *por qué* el botón
está gris. ⚠️ La condición real de «contactable» es `(!testMode || es_test) && canal !== 'cap'`
(`OfferDetail.tsx`): se apoya en el `canal` que decide el servidor (§8bis), no en opt-in+teléfono/email
por separado, y con el modo test **apagado todas** son contactables. El `testMode` sale del `modo_test`
que devuelve `priorizar-entidades`, no de `getTestMode()`.

**Opt-in de entidades**: las 111 importadas tenían `opt_in=false` (hoy ya no están en la base, §6). Se marca a mano con un toggle en el
detalle (mecánica de PoC). En producción se combinará con el ALTA por WhatsApp.

**Canalizaciones**: el panel registra kg por entidad; al cubrir `kg_total` el excedente pasa a
`bloqueada` y se ofrece copiar "RECOLLIDA CONFIRMADA". El cierre registra `kg_reales` (marca si
difieren) y genera el albarán (plantilla con placeholders, `src/lib/textos.ts`).

**No colocadas**: manual desde el panel (motivo obligatorio) o automático por el **job de
vencidas** (`pg_cron`, `marcar_excedentes_vencidos()`), que marca `no_colocada` los excedentes
con `disponible_hasta` vencida >24 h y kg sin cubrir. Ahora el intake **rellena** `disponible_hasta`
cuando la respuesta es una fecha reconocible (§6bis); si no lo es, queda `null` y el job no actúa
hasta que el panel la normalice.



### Notas internas en «Gestió interna» y «Darrer contacte» (plan 1, rebanada 1F, 02-11-2026)

D4, el CRM mínimo:

- **Bloque «Gestió interna REDESTINA» de `EntitatDetall`** (`components/fitxa/NotesInternes.tsx`): un
  formulario de una línea —canal (por defecto Telèfon), fecha (hoy por defecto, sin futuro) y texto— y
  el hilo debajo, **lo más reciente arriba**: «fa 3 dies · WhatsApp · Nom» (la fecha completa en el
  `title`). Sin edición; el super_admin ve la papelera (con confirmación). Fecha de hoy → no se manda
  `p_data` (la RPC pone `now()` y el orden del día es el de escritura); otro día → ese día a las 12:00
  locales.
- **Listado «Entitats»**: columna «Darrer contacte» (`darrer_contacte_at`/`_canal` de
  `v_entitats_llistat`), «fa 3 dies · WhatsApp» o «Cap».
- `lib/notesInternes.ts` (puro, `tests/notesInternes.test.ts`): `CANALS_NOTA` (paridad con el CHECK y la
  RPC, leída del SQL), `faTemps()` por días de calendario locales (avui · ahir · fa N dies/mesos/anys),
  `dataPerEnviar()`, `textValid()`. Claves `ni.*` (ca/es) y `ni.canal_*` declarada en `tests/i18n.test.ts`;
  los cinco códigos de error, en `textError.ts`.
- La ficha del actor (`PerfilOrganitzacio`) **no pinta el bloque** (es de `EntitatDetall`, rutas del
  equipo) y, si pidiera la tabla, le llegarían 0 filas. E2E `tests/e2e/crm.e2e.ts` (clon, móvil y
  escritorio, 8/8).

### «Dona-li accés»: el acceso se da sobre la ficha que ya existe (plan 1, rebanada 1D, 02-11-2026)

D5 + P1. Hasta 1D, la única forma de que una organización tuviera cuenta desde el equipo era «Nova
organització amb compte» (`alta-assistida`), que **siempre creaba una organización nueva** con contraseña
inicial puesta por el equipo. Desde 1D el alta del equipo es siempre sin acceso («Nova entitat», 1B) y el
acceso se da después:

- **Bloque «Contacte i accés» de `EntitatDetall`** (`components/fitxa/AccesEntitat.tsx`): el estado por
  `estat_acces_org()` (§4bis) —«Sense accés» · «Pendent de validar» · «Accés enviat» (con la fecha) ·
  «Accés actiu» (con el último acceso) · «Desactivat»—, con el correo de la cuenta **enmascarado**
  (`data-testid="compte-estat"`, `data-estat`). Botones con `BotoAmbMotiu`: «Dona-li accés» (sin cuenta o
  desactivada), «Torna a enviar» y «Desactiva l'accés» (con el acceso dado; desactivar pide confirmación).
  Con un registro pendiente no sale nada: se decide en Aprovacions. Gris con motivo, en este orden: sin
  `pot_aprovar` (el técnico ve el estado pero no da ni quita acceso), organización inactiva, sin correo,
  correo cambiado sin desar, correo apagado (`motiuCanal`, §8). Desactivar solo depende del permiso. La
  decisión, pura y con test, en `src/lib/accesEntitat.ts`.
- **«Nova entitat»**: casilla «Dona-li accés a la plataforma ara» (`data-testid="ne-acces"`, apagada por
  defecto, solo con `pot_aprovar`, gris si no hay correo o el correo está apagado). Tras `crear_entitat()`
  llama a `donarAcces()` y abre la ficha; **un fallo del acceso no deshace el alta**: se dice en un aviso
  (`acc.e_alta_feta` + el motivo) y el acceso se da después desde la ficha.
- `src/lib/acces.ts`: `donarAcces(orgId, email)` → `{ok, codi, compteNou}`, nunca lanza.
- **Retirado**: «Nova organització amb compte» del listado `Entitats` y de `Aprovacions`,
  `DialegAltaAssistida`, el modo `assistit` de `FormulariAlta` (contraseña inicial, `es_test`,
  «envia-li l'accés ara») y sus claves `alta.*` y `cdecl.toast_alta/toast_accio`.
- E2E `tests/e2e/acces.e2e.ts` (clon, `E2E_ESCRIU`, móvil y escritorio, 10 pruebas): 401/403 de la API,
  correo apagado (409 y sin cuenta creada), modo test con ficha no `es_test` (403), y el camino entero:
  «Nova entitat» con la casilla → «Accés enviat» → correo en el Mailpit del clon → `/restablir` →
  contraseña → «La meva organització» → «Accés actiu» → desactivar (`/sense-acces`) → reactivar sin
  crear otra cuenta.

### «Nova entitat» en dos pasos (plan 1, rebanada 1B, 02-11-2026)

D6 del plan 1, P2 (ampliada) y la migración `20270501300000` (§4bis). `routes/equip/NovaEntitat.tsx`
en `/equip/entitats/nova[?rol=ofertant|receptor]` (`/equip/productors/nou` redirige aquí); la lógica
pura en `lib/novaEntitat.ts` (`tests/novaEntitat.test.ts`).

- **Paso 1, «Qui és?».** Un campo «NIF o nom» (`#ne-cerca`, combobox ARIA hecho a mano: lista
  `role=listbox` bajo el campo, flechas y Enter; **sin `cmdk`**, ninguna dependencia nueva) que llama a
  `cerca_entitats` a partir de 3 caracteres con 250 ms de espera (`potCercar` colapsa espacios como la
  RPC). Cada resultado: nombre, «Mateix NIF» si coincide exacto, chips de papel (tachado el inactivo),
  Activa/Inactiva, y razón social · NIF · población. Al elegir uno (`accionsResultat`):
  - con algún papel **inactivo** → «Activa-la»: diálogo que pide NIF y razón social **solo si faltan**
    (vacío → «Cal el NIF per activar-la», validado en pantalla y otra vez por el trigger), los escribe
    en las fichas de la organización (las dos si tiene doble rol: comparten NIF) y llama a
    `activar_fitxa` por cada papel elegido; abre la ficha;
  - **activa** → «Aquesta entitat ja és activa» y «Obre la fitxa»;
  - sin el otro papel → «Afegeix el paper d'ofertant/de receptor» (`afegir_paper_org_equip`, con
    confirmación) y abre la ficha.
  Activar y añadir son de `pot_aprovar()`: al técnico le salen grises con el motivo (`BotoAmbMotiu`).
  Debajo, siempre, **«És nova: dona-la d'alta»**, que lleva al paso 2 el NIF limpio si lo tecleado
  tiene forma de NIF/NIE/CIF (`semblaNif`) o, si no, el nombre (`prellenaAlta`).
- **Paso 2, «Dades de l'entitat».** Papeles como dos conmutadores con `aria-pressed` (uno o los dos;
  `?rol=` preselecciona) y los bloques de la ficha pintados con el mismo `BlocCamps`, filtrados a
  `CLAUS_ALTA` (`campsAlta()`): Identitat (nom comercial, raó social, NIF, forma jurídica, activitat),
  Contacte (persona, correu, telèfon: D3, el único contacto), Adreça (sin los derivados) y, si es
  receptor, `tipo_receptor`. Casilla «Entitat de proves» (`es_test`). Obligatorios (`errorsAlta`): nom
  comercial, raó social, NIF válido y, si es receptor, su tipo; el teléfono se guarda en E.164. Los
  errores del servidor van al campo (`campDelError`: `nif_en_us`, `falta_nif`…). Al crear, abre la
  ficha de la organización. **La casilla «Dona-li accés a la plataforma ara» no se enseña hasta 1D.**
- `EntitatDetall` ya no tiene modo alta. Claves `ne.*` (ca/es); se retiraron `ef.sub_nova` y `ef.paper`.
- E2E `tests/e2e/entitats.e2e.ts` (clon, móvil y escritorio; crea y borra sus organizaciones): los
  cuatro casos del paso 1 —inactiva sin NIF / con NIF (y aparece en «Nova oferta assistida»), activa
  por NIF, añadir papel, nueva con NIF llevado al alta— más el alta con doble rol y el NIF repetido.

### La ficha única «Entitat» y el listado «Entitats» (plan 1, rebanada 1C, 02-11-2026)

Decisiones D1 y D8 del plan 1 (`3. Claude Code/2026-11-02-plan-1-crm-entitats.md`), y las
propuestas por defecto P5 y P10. Migración `20270501200000` (§4, §4bis).

- **`src/lib/campsFitxa.ts`, la única definición de campos.** Por campo: `clau`, `columnes` (en
  `productores` y/o `entidades`: con las dos es un campo COMÚN), `bloc`, `tipus`, `labelKey`, `veu`
  (`tots`·`equip`), `edita` (`tots`·`equip`·`ningu`), `obligatori`. Bloques: `identitat` · `rols` ·
  `contacte` · `adreca` · `ofertant` · `receptor` · `diagnostic` · `documentacio` · `intern`.
  `GESTIONATS_PER_COMPONENT` (`activo`, `perfil_receptor`) y `NO_ES_MOSTRA` (`id`, `organizacion_id`,
  `created_at`, `temporada`). `tests/campsFitxa.test.ts`: cada columna real de las dos tablas (lista
  a mano en el test) clasificada una sola vez; `edita: tots` por tabla = lista blanca de la RPC del
  actor, leída del SQL de la última migración; etiquetas en ca y es. **Es lo que cierra 1.6 por
  construcción.** Internos (solo equipo): `codigo`, `data_alta`, `es_test`, `opt_in`, `conveni` (papel),
  `visitado`, `familia`, `prioritat`, `estat` (papel), `gestio`, `modalitat` (papel), `comentari`;
  `tipo_receptor` y `productos_habituales` los ve el actor y los edita el equipo; `poblacion` y
  `area_geografica` son derivados (nadie). `contacto2` se rotula «Contacte secundari (sense accés)»
  (D3: un dato, no una persona con cuenta).
- **`components/fitxa/BlocCamps`**: los campos de un bloque, con los controles de siempre
  (`SelectorMunicipi`, `TIPUS_EMPRESA`, `XipsTria` para actividad y modalidades, `boolnull`…); ids
  `<prefijo>-<clau>` (`ed-nif` en el equipo, `po-entidad-nif` en el actor). Con doble rol, un campo
  común enseña el valor de la ficha de productor y, si la de entidad dice otra cosa, lo pone junto al
  campo (`valorComu()`, `data-testid="ed-<clau>-altra"`); solo se iguala si se cambia.
  `tipus_activitat` es común: se enseña la unión y cada ficha guarda las de su papel
  (`activitatsPerPaper`).
- **`routes/equip/EntitatDetall.tsx`** (`/equip/entitats/:orgId`; un id de ficha redirige): carga
  `v_organizaciones` + las fichas; cabecera con chips de papel (gris si inactivo), prueba, y
  Missatge/Correu; bloques en este orden: Dades de l'organització · Rol a REDESTINA (`BlocRols`:
  «Activa-la»/«Desactiva-la» por papel, «Afegeix el paper de…», «Desactiva l'entitat», por las RPC de
  1A y solo `pot_aprovar()`) · Contacte i accés (estado de la cuenta `compte_estat`, `CanalPreferit`)
  · Adreça · Com a ofertant (+ `LlocsRecollida`) · Com a receptor (+ `CampsPerfilReceptor`) ·
  Diagnòstic operatiu (`TargetaDiagnostic` equipo) · Documentació (por papel: `BadgeConveni`,
  `CertificatsFitxa`; y `DocumentacioOrganitzacio` debajo) · Gestió interna (bloque «Altres dades internes
  (de l'antic Excel)» desde el 09-11-2026, con campos internos, `Consentiments` RGPD de las cuentas de la organización —solo lectura; cierra la parte
  «pantalla» de la deuda 142—, `EnllacOrganitzacio`, «Esborra l'entitat» con `useEsborrarFitxa`).
  **Guarda solo lo que cambia** y solo lo valida (un NIF heredado inválido ya no bloquea guardar otro
  campo); un campo común cambiado se escribe en las dos fichas; `productores.name` vacío no se
  escribe. **`activo` no es campo**: el alta no lo manda y la columna toma su `default true`
  (deuda 147 cerrada). El alta de un papel que vivía aquí (`esNova`) la sustituyó 1B: ver abajo.
- **Pestañas (03-11-2026, Taula mestra 1.3, 1.5, 2.9, 7.1 y 7.2).** Carles esperaba la ficha en
  apartados, como pedía su Excel, y era una sola tarjeta larga y estrecha; además había dos bloques
  de documentos que confundían, y «Documentació de l'organització» salía vacía (solo lista
  `documentos_externos`, que sube el equipo). Ahora la ruta es `ample`, la cabecera (nombre, chips,
  prueba, razón social · NIF, Missatge · Correu · **un solo Desa**) queda fuera y debajo van seis
  pestañas de `ui/tabs` (`variant="line"`, barra que se desliza en móvil como Configuració):
  - **Dades de l'entitat**: Identitat · Rol a REDESTINA · Adreça.
  - **Contacte i accés**: campos de contacto · `AccesEntitat` · `CanalPreferit`.
  - **Operativa**: Com a ofertant (+ `LlocsRecollida`) · Com a receptor.
  - **Diagnòstic i perfil**: `TargetaDiagnostic` (ofertante) · **Perfil de recepció**
    (`CampsPerfilReceptor`, que antes iba dentro de «Com a receptor»; el tipo se elige en Operativa).
  - **Documentació**: Convenis (`BadgeConveni` por papel) · **Albarans** (nuevo en la ficha:
    `components/fitxa/AlbaransFitxa.tsx` lee `v_albaranes_bandeja` **filtrado por la ficha** —el
    equipo lo ve todo por RLS—: REC del ofertante, ENT/OPE del receptor; reutiliza `TaulaAlbarans` y
    `useDescarregaDocument`) · Certificats (`CertificatsFitxa`) y, debajo, las tarjetas de
    `DocumentacioOrganitzacio`, rebautizadas **«Arxiu extern»** (con doble rol, «· com a ofertant/
    receptor») y con el subtítulo que dice que lo que emite Redestina está arriba.
  - **Gestió interna**: `NotesInternes` arriba · campos internos · `Consentiments` ·
    `EnllacOrganitzacio` · «Esborra l'entitat» al final.
    *(04-11-2026: «Estat i papers» —`BlocRols`— pasó aquí desde Dades, arriba del todo; ver abajo.)*
  Con un solo papel, lo del otro no sale. Todas las pestañas van **montadas** (`forceMount` +
  `data-[state=inactive]:hidden`): lo escrito sigue al cambiar de pestaña y «Desa» guarda lo de todas.
  `PESTANYA_DE_BLOC` dice dónde cae cada bloque de `campsFitxa`; con él, un **punto** (`bg-aviso`,
  `data-testid="pendent-<pestanya>"`) marca la pestaña con cambios sin guardar y, si la validación
  falla, la ficha **salta a la pestaña del primer error** y le lleva el foco cuando deja de estar
  oculto. La activa va en `?pestanya=` (sin parámetro = Dades; un id de ficha que redirige la
  conserva) y la barra la trae a la vista en móvil. Contadores: Documentació = albaranes + archivo
  externo; Gestió interna = notas (los bloques los dan por `onCompte`). `BlocCamps` acepta
  `tresColumnes` (`lg:grid-cols-3`) y aquí lo usa siempre.
  - De paso: `Seccio` vivía **dentro** del componente, así que cada render era un tipo nuevo y React
    desmontaba todo lo de dentro a cada tecla; ahora es de módulo.
  - E2E: `pestanya(page, nom)` en `tests/e2e/ajuda.ts`, o `?pestanya=` en el `goto`
    (`fitxa-unica`, `crm`, `acces`, `gestio-autonoma`, que además acota «Dona'l per vigent» a
    `doc-entidad`: con doble rol, el primero era el del ofertante).
  - Fuera: la ficha del actor (`PerfilOrganitzacio`) no cambia; los campos de CRM que el Excel pide y
    no hay (responsable, propera acció, seguiments) y la biblioteca de convenios (7.6) siguen fuera.
  «Nova organització amb compte» (`DialegAltaAssistida`) siguió en el listado hasta 1D, que la retiró.
- **`routes/PerfilOrganitzacio.tsx`** (actor): los mismos bloques con `veu: tots` para la tabla de la
  pestaña (`campsDeTaula`), por `actualitzar_fitxa_*`; `modalitats_interes` y `perfil_receptor` siguen
  en «El meu perfil de recepció» (puntero). `RolRedestina`, `LlocsRecollida` y `CanalPreferit` como
  antes. Sigue una pestaña por papel (`LaMevaOrganitzacio`).
- **`routes/equip/Entitats.tsx`** sobre `v_entitats_llistat`: Nom (+ persona de contacte), Papers
  (chips, tachado el inactivo), NIF, Població/comarca, Compte, Conveni («Sí» / «Només ofertant» /
  «Sense conveni»), Darrera activitat, acciones; badges prueba, inactiva, alta rebutjada, sense
  contestar. Filtros `BarraFiltres`: Paper (aparte de `filtraLlistat`: una organización cuenta en los
  dos), Estat (**por defecto `activa`**, `useFiltresLlistat(clau, perDefecte)`; «Mostrant N de M»),
  Zona, Tipus d'entitat, Compte. Menú: una entrada «Entitats» (`nav.entitats`), sin badge.
- Retirados: `FitxaRegistre`, `RecordDetail`, `lib/crudCampos`, `ProducersList`, `EntitiesList`, y
  39 claves i18n (`prod.*`/`ent.*` de listado, `rec.new*`, `nav.producers/entities`…).
- E2E `tests/e2e/fitxa-unica.e2e.ts` (5 pruebas, clon y escritorio): el listado abre con las
  activas y una desactivada deja de salir; las rutas viejas redirigen; doble rol en una ficha y un
  campo común escrito en las dos; **1.6**: el actor ve lo que cambió el equipo, no ve «Gestió
  interna», y el equipo ve lo que cambió el actor. Deja la ficha de productor de Carles con NIF
  válido y razón social (antes no se podía reactivar).

### Estado CRM por papel en «Estat i papers» y en «Entitats» (Plan 2, B1, 10-11-2026)

- **`fitxa/BlocRols.tsx`** («Gestió interna › Estat i papers»): por papel, badge del estado y un `Desplegable` con
  los cuatro (`fixar_estat_crm`); dejar `actiu` pide confirmación. Los botones globales «Activa/Desactiva l'entitat»
  (`activar_/desactivar_organitzacio`) se conservan. El badge de la organización es su estado CRM (el más avanzado)
  salvo doble rol con uno activo y otro no («Activa en part»). Sin `pot_aprovar()`, todo gris.
- **Cabecera de `EntitatDetall`**: un badge por papel «Ofertant · potencial» (`capcalera-estat-<paper>`).
- **`lib/estatCrm.ts`** (puro, `tests/estatCrm.test.ts`): `ESTATS_CRM`, `classeEstatCrm` (actiu éxito, en
  desenvolupament aviso, potencial secundario, inactiu atenuado), `estatOrganitzacio`, `estatPerFiltre`.
- **`Entitats.tsx`**: la dimensión «Estat» son los cuatro estados; con el papel fijado (`?rol=` o el filtro «Rol»)
  manda el estado de ese papel. `PER_DEFECTE = { estat: 'actiu' }`; la clave de filtros recordados pasa a
  `equip-entitats-crm` (lo recordado como `activa` ya no casaría). Badge por fila si no es `actiu`.
- **«Nova entitat»**: el estado inicial se enseña, no se elige (`ne.estat_inicial`: nace Actiu).
- **Aprovacions**: tras aprobar un registro, si la ficha no quedó `actiu` (falta NIF o razón social), aviso
  `appr.reg_no_actiu` (P1).
- i18n: `ef.estat_<estat>` y `fl.v_<estat>` declaradas como compuestas en `tests/i18n.test.ts`; se borraron
  `ef.fi_estat`, `ef.hi_estat`, `ef.btn_desactiva` y `ef.confirm_desactiva_d` (sin uso).
- E2E `entitats-estat.e2e.ts` (+3): En desenvolupament saca del Mercat y del interés y Actiu lo devuelve;
  Actiu sin NIF → `falta_nif`, el camino legado deja `inactiu`, el técnico no puede; doble rol con dos estados
  independientes y el listado que abre con `actiu`.

### Estado de las fichas en los paneles (plan 1, rebanada 1A, 02-11-2026)

- **Mercat**: si la entidad está inactiva, aviso `mk.entitat_inactiva` (`data-testid="mercat-inactiva"`)
  en lugar del «no hay ofertas». Las ofertas nuevas desaparecen por RLS
  (`modalitats_compatibles_meves()` filtra `e.activo`); las que ya tienen relación con ella siguen
  (deuda 148).
- **Selectores del equipo**: `FormulariInteresAssistit`, `fases/Distribucio` y `Espigolades` piden
  solo `entidades.activo`. `priorizar-entidades` también (redesplegada el 02-11-2026).
- **Errores**: `entitat_inactiva`, `falta_nif`, `falta_rao_social` (y los ya existentes `nif_invalid`,
  `ja_te_paper`) tienen clave en `textError.ts`; `clauErrorInteres()` reconoce `entitat_inactiva`.
- E2E: `tests/e2e/entitats-estat.e2e.ts` (7 pruebas, clon y escritorio; deja las fichas como estaban).

### Gestió interna completa y «La meva organització» por pestañas (04-11-2026)

Lo que pidió Carles al ver las pestañas del 03-11:

- **Sin contador en Documentació** («no hace falta que esté»): se quitaron los `onCompte` de
  `AlbaransFitxa` y `DocumentacioOrganitzacio`. El de notas en Gestió interna se queda.
- **Estado global de la entidad, en Gestió interna** (`components/fitxa/BlocRols.tsx`, sección
  «Estat i papers», `data-testid="bloc-rols"`): arriba «Estat de l'entitat» (Activa · Activa en part ·
  Inactiva; `estat-entitat-badge`) con **«Activa l'entitat»** (`activar_organitzacio`, sin confirmación:
  no quita nada) si algún papel está inactivo y **«Desactiva l'entitat»** (`desactivar_organitzacio`,
  con confirmación) si alguno está activo —también con un solo papel—; debajo, «Per paper», las filas de
  siempre (`rols-productor`/`rols-entidad`). `PESTANYA_DE_BLOC.rols = 'intern'`.
- **CRM completo (Taula mestra 1.5)** en `NotesInternes`: resumen arriba (`crm-resum`: «Darrera
  interacció» y «Seguiments pendents (n)», ordenados por fecha, con la fecha en color —vençut
  `error`, avui `aviso`— y **«Fet»** → `tancar_seguiment`); formulario en rejilla (tipo, canal, fecha,
  responsable —las cuentas con fila en `usuario_roles`, por defecto quien escribe—, nota en `Textarea`,
  próxima acción y «Per a quan»; las dos o ninguna, `seguimentPerEnviar()`); hilo con chip de tipo,
  «Responsable: …» si no es el autor y la próxima acción con su estado. El autor sin nombre sale con su
  correo. `lib/notesInternes.ts` suma `TIPUS_NOTA`, `MAX_ACCIO`, `estatSeguiment()` y
  `seguimentPerEnviar()` (con paridad con el SQL en `tests/notesInternes.test.ts`).
- **Listado «Entitats»**: chip «Seguiment vençut» junto al nombre, «Propera acció: dd/mm/aaaa (+n)» bajo
  el último contacto y filtro «Seguiment» (vençut · per avui · pendent · sense), `seguimentDe()`.
- **«La meva organització» (`PerfilOrganitzacio`) en tres pestañas**, con el mismo patrón (montadas,
  `?pestanya=`, salto al primer error): **Dades de l'entitat** (Identitat · Adreça · Rol a REDESTINA) ·
  **Contacte** (contacto · canal preferido) · **Operativa** (Com a ofertant + llocs de recollida, o Com a
  receptor + el enlace a «El meu perfil de recepció»). La tarjeta de diagnóstico sigue encima, fuera.
- E2E: `crm.e2e.ts` +2 (seguimientos y estado global); `fitxa-unica`, `entitats` abren Gestió interna
  antes de mirar los papeles; el helper `pestanya()` acepta «Contacte» a secas.

### Població, àrea i ubicació editables (04-11-2026, `20270505100000`)

- En el bloque Adreça (las dos fichas, `campsFitxa.ts`): **Població** es el `SelectorMunicipi`
  (`municipio_ine`, ayuda «Tria-la de la llista de municipis»); **Àrea geogràfica** es un desplegable
  de comarcas (tipo `comarca` en `BlocCamps`, lista de `carregaMunicipis()`, conserva un valor antiguo
  como opción propia, como `tipus_empresa`) que se rellena solo al elegir la población y se puede
  cambiar; **Ubicació** es texto libre (`maxim: 120`, también en el alta de «Nova entitat»).
  `poblacion` pasa a `NO_ES_MOSTRA` y ya no queda ningún campo `edita: 'ningu'`. Se quitó la ayuda
  «Abans hi havia escrit…» (`org.h_poblacio_antiga`) y la clave `org.f_municipi`.
- En «La meva organització», la población deducida del código postal también pone su comarca.
- E2E: `organitzacio.e2e.ts` +1 (el CP elige Barcelona, se cambia a Badalona, el área a Maresme, la
  ubicación «Mercabarna»; una comarca inventada da `comarca_desconeguda`).

### Convenio y consentimiento sin que la entidad entre (04-11-2026, `20270506100000`)

- **Documentació › Convenis** (`components/fitxa/ConveniFitxa`, una por papel, `data-testid`
  `conveni-productor`/`conveni-entidad`): el estado (`BadgeConveni`) y, mientras no esté vigente ni
  firmado, tres salidas: **«Envia’l per correu per signar»** (`enviarConveniPerCorreu` de
  `lib/convenis.ts`: prepara si no lo hay, `enviar_convenio` al correo de la ficha y el correo con
  la plantilla; la persona firma en `/signar/:token` sin cuenta y el equipo contrafirma), **«Registra
  un conveni signat en paper»** y **«Dona’l per vigent»** (super_admin; los diálogos de siempre, que
  antes estaban en el archivo de documentación y se movieron aquí). La campaña de convenios usa el
  mismo `enviarConveniPerCorreu`.
- **Gestió interna › Consentiments RGPD** (`components/fitxa/Consentiments`): el equipo ya no marca
  nada; **«Demana el consentiment per correu»** (`demanarConsentiment`) manda el enlace al correo de la
  ficha, y debajo se ve el estado de la última petición (enviada, oberta, resposta, caducada). Gris
  con el motivo si no hay correo.
- **Con el correo apagado** (§8: en producción lo está desde noviembre de 2026), los dos botones de
  correo pasan a **«Copia l’enllaç del consentiment»** y **«Copia l’enllaç de signatura»** (y su
  «… nou» si ya hay uno pendiente). Acuñan el mismo enlace sin mandar nada
  (`crearEnllacConsentiment` de `lib/consentiments.ts`, `crearEnllacConveni` de `lib/convenis.ts`,
  que también usan los envíos por correo) y enseñan `EnllacPerCopiar`: el cuerpo del correo, el
  enlace y la nota de caducidad (`textCopiaConsentiment` / `textCopiaConveni`), con «Copia». Se
  intenta copiar solo al crearlo, pero el texto se queda a la vista porque Safari niega el
  portapapeles después de un `await`. E2E: `tests/e2e/consentiment.e2e.ts`, cuarto test (apaga
  `email_activo` en el clon y lo restaura; comprueba que el hash del token copiado es el del enlace
  activo y que la página pública lo abre).
- **`/consentiment/:token`** (`routes/public/Consentiment.tsx`): la persona lee los textos que manda
  el servidor y marca; privacidad obligatoria, comunicaciones desmarcadas.
- **«Entitats › Correus amb consentiment»**: descarga el CSV de quien aceptó alguna comunicación.
- El «Opt-in (consentiment)» de Gestió interna es **otra cosa**: el permiso de WhatsApp para enviar
  plantillas (`entidades.opt_in`), no el RGPD.

### Envío manual con las notificaciones apagadas (04-11-2026, `20270507100000`)

El concepto y la lista cerrada están en §8 («Automático y manual»). En los paneles:
- **Ficha de la entidad**: «Demana el consentiment per correu» y «Envia’l per correu per signar»
  vuelven a funcionar con el correo apagado (confirmación con el aviso, `acceptaEnviament`) y
  «Copia l’enllaç» queda al lado como alternativa. «Dona-li accés» igual; en «Nova entitat», la
  casilla sigue activa y avisa de que el correo saldrá igualmente.
- **Detalle del convenio** (enviar el enlace por correo) y **Documents** («Reenvia», en las dos
  pestañas): ya no se ponen grises por el interruptor.
- **Detalle del albarán**: botón nuevo **«Envia per correu»** en Accions (con el albarán emitido y su
  PDF vigente). `enviar-albara` manda el PDF adjunto a cada parte con correo (receptora en ENT/OPE,
  ofertante en REC/OPE) y, si el albarán está `entregado` y la parte no ha confirmado, un enlace
  nuevo para confirmar (el anterior de correo de esa parte se revoca). Un aviso por destinatario
  (`alb.env_r_*`). Freno de doble clic de 2 minutos. «Marcar entregat» sigue sin mandar nada con el
  correo apagado: su correo es una consecuencia, no el botón, y el aviso remite a «Envia per correu».


### Certificat de donació según el modelo de Tabaquet (05-11-2026)

- **Un solo diálogo**, `components/equip/DialegCertificatDonacio.tsx` (sustituye a `DialegCertificatPeriode`;
  el CR pasa a `DialegCertificatRecepcio`). Lo abre solo el super_admin (botón oculto al resto; la guarda
  real está en las RPC): desde `CertificatsFitxa` (ficha › Documentació) y desde `CertificatOferta`
  (ficha de la oferta del equipo, solo con modalidad `donacio`, con ámbito «Oferta» y la oferta elegidos).
- **Ámbitos**: Oferta (ofertas del donante con alguna canalización `conciliada`; «producte · data · E-…»),
  Interval (desde/hasta ≤ hoy) y Exercici (el CD anual de `cierres_donante`: emitir/enviar si el cierre es
  `tancat`; si no, aviso y enlace a `/equip/tancament/:id`). Orden y defecto en `ABASTS_DIALEG`/
  `ABAST_PER_DEFECTE` (`lib/certificatsDonacio.ts`): es lo único que cambia cuando el cliente decida (deuda 156).
- **Calcular** (oferta/intervalo) escribe el borrador y trae a la vez `cierre_exclosos_periodo()`: «Excloses
  del certificat» lista cada canalización fuera con su motivo (`motiuExclusio`: venda, maquila, entitat no
  social: <tipus>, sense entitat, sense modalitat, conciliació retroactiva; uno nuevo → «Un altre motiu»).
- **Fecha de expedición**: defecto hoy (oferta/intervalo) o 31-12 (anual; hoy en un ensayo del año en curso);
  rango `[fin del periodo, hoy]` replicado de la base (`rangDataExpedicio`); fuera de rango el botón se
  apaga con motivo y la base responde `data_expedicio_fora_rang` (traducido en `textError`).
- **Emitir no cierra el diálogo**: pasa a «Emès» con `AccionsCertificat` (Veure/Descarrega por
  `descargar-documento`; «Envia per correu» = patrón «Reenvia»: `acceptaEnviament` + `{manual:true}`, gris
  hasta que el PDF existe, polling `esperarGeneracio`). Sale aunque las notificaciones estén apagadas (§8,
  lista cerrada de lo manual). El destinatario es el `email` de la ficha del donante (`periodo_destinatario`
  / `cierre_destinatario`), con las barreras del modo test.
- **`TancamentDetall`**: sin CT (tarjeta, tanda, rectificar). «Emet tots els certificats» y el certificado de
  una fila piden fecha y anexo en `DialegExpedicio`.
- **Panel del ofertante**: «El teu any» (acumulado, resumen y revisión, solo donación) y «Els meus
  certificats» = `LlistaDocuments` de todos los `CD` (anual, intervalo, oferta) y los `CT` antiguos (solo
  descarga), con ámbito y periodo (`textPeriodeUi`/`textExercici`, las mismas palabras que el PDF) y el
  producto de la oferta, nunca el `E-…`. `/productor/ofertes/:id` monta `CertificatOfertaPropi` si hay CD vigente.
- ⚠️ La política `documentos: intern o meus` oculta a los externos todo documento `modo='prueba'`: en el
  clon el ofertante lee su `cierres_periodo` (abast, excedente_id) pero no el PDF de prueba. Con certificados
  reales la misma lectura funciona. E2E: `tests/e2e/certificats.e2e.ts` (5 pruebas).
- **El PDF** (`_shared/pdf/render/cd.ts`, anual/periodo/oferta): papel con membrete de la Fundació (logo de
  Espigoladors arriba a la derecha, `generar-documento/activos/logo-espigoladors-pdf.png`, incrustado por
  `scripts/incrustar-activos.ts`; los demás PDF siguen con el de Redestina), título, la prosa de la plantilla
  congelada con los marcadores de `_shared/certificatDonacio.ts`, nombre y cargo de la apoderada, firma y
  sello PNG, pie con número y código de verificación; anexo por producto en la 2.ª página solo si `annex`.
  **Sin plantilla, error** (se retiró el `CUERPO_PROVISIONAL`, la caja del importe, «qui certifica», la línea de
  revisión y el 182). El correo (`correu-document.ts`) dice el ámbito y las fechas. Prueba:
  `tests/pdf/cd_test.ts` (extractor `tests/pdf/textPdf.ts`).

### Circuito de firma unificado (05-11-2026)

Carles pidió que todo documento que deba firmarse tenga **doble vía** desde el panel del usuario —firmar
con el dedo o el ratón, o descargar, firmar fuera y volver a subir— y que el super_admin pueda enviarlo
por correo y subir la versión firmada que le devuelven para cerrarlo. El modelo de datos está en
`context/04` («Circuito de firma unificado»); la seguridad, en `context/09`.

- **Piezas** (`src/components/`): `BlocSignant` (nombre · cargo · DNI, extraído de `FirmaConveni`, que
  ahora lo usa; mínimos en `lib/signatures.ts`), `PdfIncrustat` (extraído de `VisorPdf`),
  `FormulariSignaDocument` (documento → quién firma → conformidad `FilaCasella` con el `text_acta` del
  servidor → `SignaturePad` → botón; en escritorio el PDF incrustado al lado, en móvil tarjeta «Obre el
  PDF»/«Descarrega» y la URL de 60 s se renueva si pasan 50 s), **`DialegSignaDocument`** (80vw×88dvh;
  `mode='titular'` con pestañas «Signa aquí» / «Puja'l signat»; `mode='equip'` solo «Puja el signat» con
  confirmación «passarà a ser la definitiva… quedarà tancat»; el enlace del panel se acuña una sola vez
  por apertura al entrar en «Signa aquí»), `BadgeSignatura` (perspectiva usuario/equipo: ámbar «te
  toca», verde `tancat`), **`AccionsSignatura`** (badge + botones o iconos), `DialegEnviament` (casilla
  «Inclou l'enllaç per signar en línia», marcada por defecto si está `pendent` y admite canvas),
  `equip/CuaSignatures`. Hook `useEstatsSignatura` (lee `v_signatura_document`, falla en blando).
- **`lib/signatures.ts`**: `accionsSignatura({estat, rol, tipo, admetCanvas, ambPdf})` es **el único
  sitio que decide qué botón sale**: titular + `pendent` + canvas → Signa y Puja'l signat; super_admin +
  `pendent` → Puja el signat; super_admin + `signat` → Veure el fitxer, Tanca (nota opcional), Rebutja
  (motivo obligatorio); operador, resto del equipo y `tancat` → nada; un CONV `pendent` (`admet_canvas`
  false) no se pinta como pendiente para la organización (`mostraEstatSignatura`).
- **Usuario**: «Pendent de tu» lista cada documento a firmar (`proposito='firma_document'` de
  `pendents_meus`): la titular ve «Signa» y «Puja'l signat»; el operador, «només la persona titular» y el
  motivo si hubo rechazo. Las tablas de albaranes y de documentos y la tarjeta de la oferta llevan el
  estado y las acciones en icono. El convenio firmado (versión `signat`) se pinta como «signat».
- **Equipo**: Aprovacions › quinta cola **«Signatures per tancar»** (`v_signatures_bandeja where
  estat='signat'`: organización, tipo, número, vía, fecha; Veure el fitxer por `descargar-documento
  {firma_document_id}`, Obre la fitxa/albarán, Tanca, Rebutja; solo super_admin actúa, el resto gris con
  motivo; ancla `#signatures`; tablero `pe.signatures_per_tancar`), Documents › pestaña **«Signatures»**
  (sustituye a «Enllaços», vacía desde la fase 1; filtro pendents/rebudes/tancats), ficha del albarán
  (estado y «Puja el signat»), ficha de la entidad › Convenis («Puja el conveni signat»), certificados
  (`AccionsCertificat` + `AccionsSignatura`).
- **Ruta pública `/signar-document/:token`** (`routes/public/SignarDocument.tsx`, `LayoutAcces`, sin
  sesión): el enlace del correo (30 días) y el del panel (1 h) abren el mismo formulario y hacen el mismo
  POST (`enlace-publico` `firmar_document`). «Envia per correu» con la casilla marcada llama a
  `reenviar-documento {documento_id, manual, amb_enllac_signatura}`; para un albarán se usa el REC/ENT
  vigente (`enviar-albara` no lleva el enlace, deuda 160); con el albarán `entregado` la casilla no
  aparece porque ese correo lleva el enlace de confirmar los kilos.
- Sin Realtime: se recarga al cerrar el diálogo y se refrescan avisos y contadores. E2E:
  `tests/e2e/signatures.e2e.ts` (5 pruebas, solo clon y escritorio; restaura documentos, firmas y
  avisos; deja enlaces usados, evidencias y ficheros, deuda 157 bis → ver §12).


### «Importa des d'Excel» (06-11-2026, `20270511100000`)

Ruta `/equip/entitats/importa` (`routes/equip/ImportaEntitats.tsx`), solo super_admin (el resto del equipo ve
un aviso y nada más; el botón «Importa des d'Excel» de `Entitats.tsx` solo lo ve el super_admin). Tres pasos
—Fitxer, Revisió, Resultat— sobre `previsualitzar_importacio_entitats` e `importar_entitats`; reglas de mapeo,
plantilla y cifras en `context/06-importacion-datos-maestros.md` §6.2. Textos con prefijo **`ie.*`** (no
`imp.*`, que es «El meu impacte»); los códigos de la base se traducen como `ie.c_<codi>` con el detalle tras
`:` interpolado (familias declaradas en `tests/i18n.test.ts`). En la interfaz la nota se llama «comentari»
para no confundirla con las notas internas del CRM. E2E `tests/e2e/importa-entitats.e2e.ts` (Excel sintético
con las cabeceras de Airtable: 4 creadas + 1 sin cambios; reimportar = todo sin cambios; plantilla
descargada y subida = 25 columnas reconocidas; 0 desbordes a 360 px en los tres pasos; limpia las `TEST-IMP`).

**B4 (10-11-2026, `20270519100000`): la importación actualiza.** En la Revisió cada fila enseña **«Canviarà»**
(`camp: «abans» → «després»`; hueco `— → valor`; la nota que se añade), agrupado para que una organización de doble
rol no repita el cambio; contador «Actualitzarà N fitxes»; `identificada_per = 'id'` → «per ID Redestina»; la
confirmación dice que lo que trae valor sobrescribe y que una celda vacía no toca nada. Resultat y CSV con los
cambios. En la ficha, Gestió interna enseña «Data d'alta a l'organització» (editable) y «Alta a la plataforma»
(`created_at`, solo lectura). Reglas en `context/06` §6.4.

### «Exporta a Excel» en Entitats (Plan 2, B3, 10-11-2026, `20270518110000`)

Botón «Exporta a Excel» (`data-testid="el-exporta"`, icono `FileDown`) en la cabecera de `Entitats.tsx`, junto a
«Correus amb consentiment». Lo ve **todo el equipo** (D10: `tecnic` incluido; «Importa des d'Excel» sigue siendo
del super_admin). Exporta **las filas visibles** —filtros, `?rol=` y búsqueda aplicados, en el orden de la
pantalla (primero las de prueba)—; si se ven todas, pide `null` (todas). Carga en paralelo
`carregaExportacio()` (`lib/importacions.ts`, en páginas de 1.000 por el `max_rows` de PostgREST),
`carregaTipusActivitat()` y `carregaMunicipis()`; compone el fichero con `blobExportacio()` y lo baja como
`entitats-AAAA-MM-DD.xlsx` (`descarregarBlob`, nuevo en `lib/tancament.ts`, que ahora usa también el
importador). Toasts: vacío, error, «Exportades N entitats» y, si pasan de 1.000, que el importador las acepta de
1.000 en 1.000 (deuda 173). `llistesTerritori()` (en `lib/municipis.ts`) da comarcas y municipios para «Llistes»
a la plantilla y a la exportación (antes, el cálculo vivía dentro de `ImportaEntitats`). Textos `el.export_excel*`
y, para la hoja «Instruccions», `ex.*`. Formato del fichero y decisiones: `context/06` §6.3. E2E en
`importa-entitats.e2e.ts` (exporta el `tecnic`, reimporta el super_admin).

### Revisión de la Taula mestra por la Fundació (09-11-2026, columna de Sebas)

- **1.1 «Cada vez que pongo letra en sección me saca de sección»**: en «Nova entitat», `Seccio` estaba
  definida DENTRO de `NovaEntitat()`; cada render creaba un tipo de componente nuevo, React desmontaba la
  sección y el campo perdía el foco tras la primera letra (reproducido en el clon: el nombre se quedaba en
  «E»). Sacada fuera del componente; lo vigilan `tests/componentsNiats.test.ts` (ningún `.tsx` define un
  componente dentro de otro) y `entitats.e2e.ts`, que ahora teclea el nombre con `pressSequentially` y
  comprueba valor y foco (con `fill()` el fallo no se veía).
- **1.3 Forma jurídica**: `TIPUS_EMPRESA` suma `sat` («SAT (Societat agrària de transformació)») y `sc`
  («Societat civil (SC/SCP)»); la base, en `tipus_empresa_valid()` (`20270512100000`); el importador
  los reconoce (§6.2). El resto de la frase de esa celda llegó cortada («…y»): pendiente de confirmar.
- **1.5 «Una sección de gestión interna que no entiendo… codi, conveni, visitat»**: el bloque de campos
  de la pestaña Gestió interna, debajo del CRM, se llamaba igual que la pestaña («Gestió interna
  REDESTINA»). Ahora es «Altres dades internes (de l'antic Excel)» y cada campo dice de dónde viene y si
  cuenta para algo (`ef.fi_*` etiquetas, `ef.hi_*` ayudas en `campsFitxa`): «Estat» y «Prioritat» siguen
  ordenando `priorizar-entidades` (y un `estat` vacío excluía: deuda 168); el resto solo informa.
- **Deuda 168 cerrada (mismo día)**: el ranking de `priorizar-entidades` ya no mira `estat` para decidir
  activa o pendiente, sino el convenio que pide la modalidad (`entidadesSinConvenio()`, el de
  `sense_conveni`); `estat` solo excluye con «No procedeix», y queda fuera la entidad cuyo registro
  self-service no está aprobado (membresías sin ninguna `aprovada`). Detalle en §12.168.
- **1.3 «Eliminar Cooperativa agraria. Mantener el resto de actividades»**: ⚠️ se leyó primero sin la palabra
  «Eliminar» y `20270512100100` la amplió a los dos papeles; **corregido el mismo día** (`20270517100000`): fuera del
  catálogo y de las fichas. El resto del catálogo, igual.
- **Segunda pasada (mismo día, `20270517100000`)**: el resto de la fila 1.3 y la 1.5.
  - **CB**: `TIPUS_EMPRESA` suma `cb` («Comunitat de béns (CB)»); el importador reconoce «CB», «C.B.», «Comunitat de
    béns» y «Comunidad de bienes».
  - **Bloque nuevo «Dades fiscals i facturació»** (`bloc: 'fiscal'` en `campsFitxa.ts`, después de «Adreça», pestaña
    «Dades de l'entitat»; también en «La meva organització» del actor): règim d'IVA (lista cerrada, `org.iva_*`), domicili
    fiscal con CP y població («Només si és diferent de l'adreça…»), contacte administratiu y correu de facturació. Los
    ve y edita el equipo y el titular; validación de CP y correo como los demás (`errorCp`, `errorCorreu`). Detalle de
    la regla del domicilio en §4.
  - **1.5 «Data d'alta automàtica»**: la pone la base al crear la ficha (trigger, §4); en la pestaña Gestió interna sigue
    siendo editable para los históricos.
  - Fuera de este cambio: el importador no lee los campos fiscales (deuda 171).
  - Pruebas: `tests/e2e/taula-mestra-fiscal.e2e.ts` (bloque visible, CP mal escrito no se guarda, se guardan los seis
    campos y el convenio toma el domicilio fiscal) y `entitats.e2e.ts` (CB en la lista y fecha de alta al crear).

### Configuració › Equip: cuentas del equipo y su rol (09-11-2026, `20270513100000`)

Pedido por Carles al ver que Sebastián (`admin`) no veía un botón del `super_admin` (el importador): las dos
cuentas no tenían el mismo rol y **no había ninguna pantalla para verlo ni cambiarlo** (era SQL con la service
key, o sea una sesión con token). Ahora hay una pestaña **«Equip»** en Configuració, **solo para el
super_admin** (`?tab=equip` de un admin cae en «General»; las dos RPC también lo exigen):

- `SeccioEquip` (`components/configuracio/`): lo que puede cada rol (resumen), el recuento, una fila por cuenta
  del equipo —nombre/correo, rol, último acceso, desde cuándo y quién le dio el rol— con un desplegable
  (Super admin · Admin · Tècnic · «Treu de l'equip»), y debajo los últimos 15 cambios (`equip_rols_hist`).
  Las cuentas de las organizaciones (ofertantes y receptores) no salen: solo las que tienen fila en `usuario_roles`.
- Cada cambio pide confirmación (`useConfirma`): **roja** al bajar o sacar a alguien, normal al subir, con la
  advertencia de acceso total al subir a super_admin. Tras la llamada se recarga **también en error**.
- A uno mismo no se le ofrece nada («No et pots canviar el rol a tu mateix») y tampoco al único super_admin
  activo; lo anticipa `accionsMembre()` (`lib/equip.ts`, puro, `tests/equip.test.ts`) y lo impone la base.
- **Lo que NO hace**: dar de alta cuentas del equipo (hoy `scripts/crear-usuario.ts`; **deuda 169**), cambiar el correo (es el de
  acceso: Admin API) ni convertir una cuenta externa en equipo. Es deliberado: ese paso da acceso a todos los datos.
- **Gestión de cada cuenta** (pedida el mismo día, `20270514100000`): tres iconos por fila (`BotoIcona`): **editar** (nombre y
  teléfono, `DialegEditaMembre`), **activar/desactivar** y **borrar** (`DialegTraspasMembre`). Desactivar y borrar preguntan antes qué
  se hace con lo que esa cuenta ha hecho: cuentan sus acciones por grupo («Convenis: 12 · Documents: 41…», `agrupaAccions()`) y dejan
  pasarlas a otra cuenta ACTIVA del equipo, a elegir (por defecto, quien pulsa). En **borrar**, si hay acciones el traspaso es
  obligatorio (casilla marcada y bloqueada: la base exige destino) y hay que escribir «esborrar»/«borrar». A uno mismo y al único
  super_admin activo se les desactivan los botones con el motivo. Cada paso queda en el historial («X ha desactivado a Y. 12
  acciones pasan a Z.»). Textos `eq.*`; en móvil el diálogo lleva `grid-cols-[minmax(0,1fr)]` (un correo largo lo ensanchaba).
- **Auditoría del equipo** (09-11-2026, `AuditoriaEquip`, sustituye a «Últims canvis»): todo lo hecho con las cuentas del equipo
  con fecha y hora (`dataHora`), quién lo hizo y a quién, con nombre y correo, incluidas las borradas (chip «compte esborrat»), y
  cada traspaso («X ha passat N accions de Y a Z (en esborrar-lo)»); filtro por persona (`personesAuditoria()`), borradas incluidas.
- **Regenerar los documentos ya emitidos** (09-11-2026, `RegeneraDocuments`, debajo de Configuració › Fundació, solo super_admin):
  recuento por tipo de lo que tiene datos antiguos de la Fundació, aviso «només en mode test», diálogo «Accepto i regenero»; con el
  modo test apagado solo explica que en producción no se puede. Los documentos nuevos ya salen con lo guardado arriba.
- **Pestañas «Actius · n» / «Desactivats · n»** (09-11-2026, pedido por Carles): por defecto, las activas (`filtraEquip()`); las
  desactivadas aparte, con «Es poden tornar a activar o esborrar». El resumen por rol cuenta solo las activas; las reglas de cada
  fila (último super_admin, destinos del traspaso) miran a todo el equipo. El destino que propone el diálogo es **alguien del mismo
  rol** (`destiPerDefecte()`), y la nota del diálogo dice ahora que **no tiene efectos fiscales** (los documentos salen a nombre de
  la Fundació o de la contraparte) y que queda apuntado, fila a fila, quién lo hizo (`20270515100000`).
- **El rol se ve en todas partes** (pedido el mismo día: el rótulo junto al logo decía «Admin» tanto al
  super_admin como al admin): `AppSidebar` pinta un **chip** con el rol real (`ctx.rol`; coral de marca para
  «Super admin», neutro para «Admin» y «Tècnic»; `data-testid="rol-equip"`, `data-rol`), el grupo del panel del
  equipo con doble rol lleva el mismo nombre, y el menú de usuario añade «Rol: …». `rolEquipDe()` (`lib/equip.ts`)
  descarta cualquier valor que no sea de los tres. Con doble rol (equipo + organización) no hay rótulo junto al
  logo, como antes. No hizo falta tocar la base: `get_my_session_context()` ya devolvía `rol`.
- Un cambio hecho por SQL (sesión con token, sin usuario) queda en el historial sin `per_email`: la pantalla lo
  dice «Fora de l'aplicació (SQL)». El correo de quien cambia se copia en la fila, así que borrar su cuenta no lo borra.
- Publicado el 09-11-2026 (`d90ed94`). La prueba que se deshace sola confirmó en producción que `esborrar_membre_equip` puede borrar de `auth.users`
  (la cuenta de prueba no tenía acciones, así que el traspaso con documentos inmutables solo está probado en el clon).
- Pruebas: `tests/e2e/equip.e2e.ts` (clon; la cuenta de prueba `comunicacio@esimperfect.com` baja y sube, con
  confirmación, y el clon queda como estaba) y el arnés (denegada a todo el que no sea super_admin).
- En producción, **Sebastián (`sebastian@espigoladors.com`) pasó de `admin` a `super_admin` el 09-11-2026**, por SQL
  desde la sesión con token justo al publicar (`publicar-equip.sh`); quedó en el historial como «Fora de l'aplicació».
  Los super_admin activos son ahora tres: `hola@`, `hola+superadmin@` (cuenta de prueba) y él.

### Configuració a todo el ancho y en dos columnas (10-11-2026)

La ruta `/equip/configuracio` pasó a `ample: true` y `Settings` dejó de limitarse a `max-w-3xl`: antes
usaba 768 px en el centro de la pantalla y el resto quedaba vacío. **Por debajo de `xl` (1280 px de
ventana) todo sigue en una columna**; desde `xl`, cada pestaña reparte sus tarjetas en dos para reducir el
scroll: **General** (validación + idioma | pantalla de protección), **Notificacions** (general, correo,
WhatsApp y «Com es decideix» | modo test y listas de prueba, que son lo más largo), **Fundació** (datos y
guardar | firma y sello, provisionales y regeneración), **Impacte** (una tarjeta por factor, en rejilla),
**Diagnòstic** (cuestionario JSON | medidas y reglas; el editor JSON topa en `70vh` y scrollea por dentro)
y **Equip** (cuentas | auditoría). Todas las rejillas llevan `grid-cols-1` explícito: sin él la columna
única es `auto` y un hijo ancho (el JSON, una tabla) desbordaba la página a 390 px. Auditado
`scrollWidth > clientWidth` a 390, 1024, 1280 y 1600 px en las seis pestañas: sin desbordes.
