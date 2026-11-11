# AGENTS.md §6bis — 6bis. El intake conversacional

> Detalle de la sección 6bis de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §6bis» del código apuntan aquí.

## 6bis. El intake conversacional

Diecisiete pasos, siete de ellos condicionales (`PASOS`/`CAMPOS` en `_shared/camposOferta.ts`,
desde el 27-09-2026): `familia` → `producte` → `varietat` → **`producte_al_camp`** → `kg` →
**`format_entrega`** → `caixes` → `retorn` → **`transport`** → `ubicacio` → `disponible_fins` →
`horari` → `modalitat` → **`preu_minim`** → **`cost_kg`** → `causa` → `observacions`.

**`cost_kg` (solo donació, opcional)**: el coste por kilo lo decide el productor. El panel lo
prellena con la **referencia** del producto (`crear-oferta` la sirve pegada a cada producto del
catálogo, `cost_referencia`, leyendo con `service_role`: `costes_producto` sigue siendo del equipo)
y, si el productor lo toca, ya no lo pisa; un enlace «Fes servir la referència» la recupera. El bot
envía «El valor de referència de X és 0,60 €/kg» con dos botones, **«Mantenir 0,60 €/kg»**
(`cost_kg:ref`) y **«Un altre valor»** (`cost_kg:altre`, que pide el número sin contar intento);
sin referencia, pide el número o «-». Se guarda en `excedentes.coste_kg`; en venda y maquila no se
pregunta (tienen `preu_minim` y el CT no lleva importes). No sale en el texto de la oferta: es para
el certificado del donante, no para la entidad.

**Qué se salta y cuándo** (revisión funcional del 23-09-2026: «Com es farà l'entrega?» en vez de
«Quin tipus de caixa?», y «no asumir que siempre interviene una entidad»):

| Paso | Se pregunta si… | Obligatorio |
| --- | --- | --- |
| `format_entrega` (caixes · palet · envasos_propis · altres) | el producto **ya está cosechado** | sí |
| `caixes` («quantes caixes o palets») | formato caixes o palet | no |
| `retorn` (Sí/No) | formato caixes, palet o altres — no si el receptor trae sus envases | sí |
| `transport` («Podeu oferir el transport?») | ya cosechado — lo que está en el campo se va a buscar | sí |
| `ubicacio` («On s'ha de recollir?») | **sin transporte propio, O producto en el campo** (condición compuesta) | sí |
| `preu_minim` | venda o maquila | sí |

⚠️ **Una condición puede ser una LISTA, y es un «o»** (`condicion: CondicionCampo[]`): la
ubicación hace falta si nadie la trae o si hay que ir a cosechar. El bot las evalúa con el
mismo `aplica()` del descriptor dentro de `siguientePaso()`, así que **los dos canales se
saltan exactamente lo mismo**. ⚠️ **Salvo el preu mínim**, que conserva su regla propia a
propósito: solo se salta con una donación EXPLÍCITA; con la modalidad ausente o desconocida se
pregunta (lo fija un test: publicar una venta sin precio es peor que pedirle un precio a quien dona).
⚠️ **`crear-oferta` sirve las listas en `condicions`** y deja en `condicion` solo la primera: el
panel anterior hacía `condicion.en.includes(…)` y con una lista reventaba, y las funciones se
publican antes que el frontend (§11). El panel nuevo lee `condicions ?? condicion`.
⚠️ **`tipus_caixa` ya no es un paso**; la columna `tipo_caixa` se queda para las ofertas
anteriores. Las nuevas guardan `format_entrega` y `transport_propi` (§4), y el texto de la
oferta imprime «ENVASOS: Palet · no cal retornar-los» y, solo si es cierto, «TRANSPORT: el porta
la productora» (misma asimetría que el producte al camp).

**Y en castellano** (28-09-2026): cada campo, opción y sección de `camposOferta.ts` lleva su
`*_es` al lado del catalán (`etiqueta_es`, `ayuda_es`, `titulo_es`, `descripcion_es`,
`titol_es`, `descripcio_es`), `crear-oferta` los sirve con el resto y el panel elige con
`localitzaDescriptor()` (`src/lib/ofertes.ts`). Viven ahí y no en `i18n.tsx` para que cambiar
una pregunta no obligue a acordarse de otro fichero; `tests/camposOferta.test.ts` falla si a
una le falta el castellano. Las **familias** y las **causas** vienen de la base en catalán y se
enseñan traducidas (`FAMILIES_ES`, `CAUSES_ES`) sin cambiar el valor que se guarda. Los
**nombres de producto no se traducen**: son el nombre del catálogo, el mismo del Mercat, los
albaranes y los certificados. El bot de WhatsApp sigue en catalán.

**El panel lo presenta POR PASOS** (`FormulariNovaOferta`), una sección cada vez: «Pas 2 de 5»,
«Continuar» valida lo obligatorio de esa sección y los títulos de arriba dejan volver a una ya
vista. En la recogida se puede **crear un lugar nuevo sin salir** (`creaUbicacio()`, directo a
`productor_ubicaciones`, que el productor ya podía escribir por RLS), con el municipio de la lista
oficial (`SelectorMunicipi`), y así la comarca de la oferta sale exacta. `crear-oferta` comprueba
ahora que la ubicación es **de ese productor** (`400 ubicacio_aliena`): corre con `service_role`
y la RLS no lo hacía por ella.
🔴 **Tres arreglos del paso 1→2 en el móvil (29-09-2026)**, porque en un iPhone a veces «Continuar»
no dejaba pasar y parecía un bucle: (1) el **error de campos que faltan va DENTRO del pie fijo**,
junto al botón —debajo de la tarjeta lo tapaba ese mismo pie, y solo se veía un salto de scroll—;
(2) el alta guarda un **borrador en `sessionStorage`** (por productor, 24 h, se borra al publicar o
cancelar): Safari puede recargar la pestaña al volver de la cámara o la galería y el formulario
volvía vacío al paso 1; ahora recupera lo escrito y el paso, con el aviso «Hem recuperat l’oferta
que tenies a mig fer»; (3) cambiar de **familia ya no borra el producto si es de la nueva** —antes
cualquier cambio lo borraba en silencio, también la rueda del desplegable del iPhone—.

⚠️ **`producte_al_camp` va como LISTA, no como botones**, aunque sean dos opciones, por lo mismo que
`modalitat` (§12.105): un botón solo tiene título de 20 caracteres y una fila de lista tiene
`description` de 72, y aquí la diferencia entre «encara s'ha de collir» y «pendent de recollida» es
justo lo que hay que explicar. Textos: «El producte encara és al camp?» con *Sí, és a la planta* /
*No, ja està collit*.
⚠️ **El valor que viaja es `si`/`no`, NO el título**, al revés que `TIPOS_CAIXA` y `OPCIONES_RETORN`:
lo que se persiste es un boolean, así que tiene que sobrevivir a que alguien reescriba el título.
Lo decide `esProducteAlCamp()` (`_shared/oferta.ts`) en un solo sitio, con **fail-safe a `false`** —
un `Boolean(d.producte_al_camp)` habría dicho que `"no"` es cierto, y eso marcaría «hay que ir a
cosechar» sobre producto ya envasado. Las opciones salen **siempre de las tablas** (`productos`, `causas`), nunca
escritas a mano. El `preu_minim` (€/kg) queda en `excedentes` y aparece en la oferta (§5/§6ter).

**`disponible_fins` → `disponible_hasta` (parseo).** La respuesta libre al paso `disponible_fins`
(«Fins quin dia està disponible? p. ex. 23/07») se intenta convertir a fecha real con
`parseDisponibleFins()` (`_shared/oferta.ts`): reconoce `dd/mm[/aaaa]` con separadores `/ - .`,
infiere el año (el actual, o el siguiente si ya pasó) y rellena `disponible_hasta` al crear el
excedente. Si no reconoce una fecha, queda `null` (como antes) y el panel la normaliza a mano; el
texto de la oferta conserva siempre el original. Esto reduce la deuda §12.4.

**Arranca preguntando, no con el cuestionario.** Ante un mensaje que no sea ALTA/BAJA de un
productor sin sesión abierta, Redestina responde con una **guía corta** (qué es, qué preguntará, y
que puede escribir `Stop` cuando quiera) y los botones *Sí / Ara no*. Es una desviación
deliberada del Redestina §8, que hacía que *cualquier* mensaje lanzara el formulario: con 271
productores escribiendo por cualquier motivo, eso secuestra conversaciones normales.

**La paginación es el caso normal.** Las listas de WhatsApp admiten 10 filas: se muestran 9
opciones y la décima es "Més…". Hace falta porque hay **12 familias** y cuatro superan los
10 productos (Horta Tub/Bul/Arr 16, Fruita Dolça 14, Horta Fruit 14, Horta Fulla 12).

**Y la lista se usa también donde bastarían tres botones**, desde el 15-09-2026: el paso
`modalitat` era `sendBotones` y pasó a `sendLista` (§12.105). El motivo no es el número de
opciones sino que **un botón solo tiene título (20 caracteres) y una fila de lista tiene
`description` (72)**, así que por WhatsApp se elegía a ciegas entre donació, venda y maquila —y
elegir mal no se nota hasta el cierre: decide qué entidades pueden recibir la oferta y qué
documento se emite—. Las filas se derivan de `MODALITATS` en `camposOferta.ts`, el mismo sitio del
que el panel saca su texto: **una sola fuente, que es lo que impide que los dos canales expliquen
cosas distintas**.

🔴 **Pasarse de 72 caracteres NO da error: `sendLista` recorta con `slice(0, 72)`** y el mensaje
llega partido a media palabra. La descripción de `donacio` medía 97 y habría llegado como «…Genera
un certificat », perdiendo justo lo que justifica el campo. Por eso el tope lo vigila
`tests/camposOferta.test.ts` —para **toda** opción con descripción, no solo esta— y las constantes
`MAX_DESC_FILA_LISTA` / `MAX_TITULO_FILA_LISTA` viven en `camposOferta.ts`, con el texto: quien se
pasa es quien **escribe**, y el `slice` de `whatsapp.ts` es la última red, no la primera.

**Casos que el motor ya contempla:**

- Respuesta que no encaja: se repite la pregunta hasta 2 veces; a partir del 3.er fallo el motor
  responde «No acabo d'entendre la resposta… escriu *Stop*» **y repite la pregunta** (desde el
  28-09-2026; antes solo el aviso, en bucle, y la persona dejaba de ver qué se le preguntaba).
- `Stop` sin sesión abierta contesta «No tens cap oferta a mig fer», y «Continuar» sobre una
  sesión caducada lo dice y ofrece empezar otra.
- Texto libre (varietat, horari, observacions) de más de **400** caracteres: se pide más corto.
  Sin tope, el `texto_oferta` podía pasar de los 1024 que admite un interactivo y la entidad no
  recibía la oferta.
- **Cancelar en cualquier momento**: la palabra **`Stop`** (alias ocultos `CANCELAR`/`CANCEL·LAR`) **o** el botón
  `intake:cancelar` (del recordatorio) borran la sesión de `intake_sessions`.
- **Recordatorio a los 10 min** de inactividad: aviso «Continuar / Cancel·lar» (§5). *Continuar*
  (`intake:continuar`) reanuda el paso donde se dejó; se manda una sola vez por periodo inactivo.
- Sesión inactiva más de 12 h: se descarta y se empieza de cero (el recordatorio actúa antes).
- Productor **sin ubicaciones** (329 de 341): no se puede enviar una lista vacía, así que se
  pide el enlace de Google Maps por texto. El enlace crea una `productor_ubicaciones` que
  hereda el municipio de la ficha, con alias `Compartida el dd/mm`. Desde el 28-09-2026 vale
  también **la ubicación de WhatsApp** (📎 → Ubicació, mensaje `location`), que se convierte
  en enlace de Maps. Con 10 ubicaciones o más se enseñan 9 y «Un altre lloc» siempre.
- Cantidad en unidades o manats: se convierte con `factores_conversion` si hay factor; **si no
  lo hay, se pide el número en kg** (antes «20 manats» se guardaba como 20 kg).
- ✅ **Ya no hay divergencia de obligatoriedad** entre canales (27-09-2026): `retorn` es
  obligatorio en los dos cuando aplica, y `tipus_caixa` ya no se pregunta.
- ✅ **El callejón de `ubicacio` está resuelto** (27-09-2026): la fila «Un altre lloc»
  (`ubicacio:nova`) ya no cuenta como respuesta inválida —antes re-mostraba la misma lista—; el
  bot contesta pidiendo el enlace de Google Maps y no suma intento.

**Identificador**: `E-AAMMDD-XXX-YYY-N` (3 letras de la organización productora —`empresa`, y `name` si no hay; desde el 28-09-2026—, 3 del producto, N = orden
del día). Ejemplo real: `E-260721-CAR-TOM-1`.

**Textos que se publican** — reproducen los que el equipo escribe hoy a mano, emojis
incluidos. `componerTextoOferta()` en `_shared/oferta.ts` genera "OFERTA DISPONIBLE"
(PRODUCTE, PRODUCTOR, MUNICIPI, UBICACIÓ, QUANTITAT, DISPONIBLE, HORARI RECOLLIDA,
MODALITAT, CAUSA, ENVASOS, RESPONSABLE, OBSERVACIONS). Queda pendiente el de "RECOLLIDA
CONFIRMADA" (🚚 con SDA/ENTITAT, DATA i HORA, KG RECOLLITS, KG FALTEN RECOLLIR, Comentaris),
que corresponde al momento de cierre y todavía no está implementado.


### El lugar principal en el intake (Plan 2, A4, `20270521100000`, 10-11-2026)

En el paso `ubicacio` la lista de lugares sale con **el principal primero** y marcado «(habitual)»
(`principalPrimer()` y `titolLlocLista()` de `_shared/predeterminatsOferta.ts`; el título nunca pasa de los 24
caracteres de Meta: se recorta el nombre, no la marca). **P5 (decidido por Carles el 10-11-2026): «confirma la
ubicación o cámbiala; no la elimines».** Con un lugar **marcado** principal, la pregunta llega primero como dos botones
—«On s'ha de recollir? El lloc habitual és *X (municipi)*. El confirmes o el canvies?», «Sí, aquí» (`ubicacio:<id>`) y
«Canvia el lloc» (`ubicacio:canvia`)— (`llocHabitual()`, `preguntaLlocHabitual()`). «Canvia el lloc» no es una
respuesta: pone `_canvia_lloc` en la sesión y manda la lista de siempre (el principal primero, «Un altre lloc» al
final); con la marca puesta, un recordatorio o un reintento repiten la lista, no los botones. Un «sí» escrito
(`confirmaLlocHabitual()`: sí, ok, d'acord, aquí…) confirma el principal mientras se pregunta por él. Sin principal
marcado (aunque haya un solo lugar), la lista directa, como antes. **La pregunta nunca se salta.** Probado contra el
clon con WhatsApp simulado (botón, «Sí» escrito y «Canvia»), y deshecho.
**En el panel, lo mismo (11-11-2026)**, en `FormulariNovaOferta` —el formulario del productor y el de la oferta
asistida del equipo—: con lugar principal, el campo es una caja «Lloc habitual: *X · municipi*» con «Sí, aquí» y
«Canvia el lloc» (`estatLlocHabitual()` de `src/lib/predeterminatsOferta.ts`: `confirmar` · `confirmat` · `llista`).
**El lugar propuesto desde la ficha no cuenta como respuesta hasta que se confirma** (`ubicacioPerConfirmar()`:
falta como un campo vacío, «Continuar» no pasa); «Canvia el lloc» vacía el campo y enseña la lista y «Afegir un lloc
nou». Sin principal marcado, la lista de siempre. El borrador guarda también lo propuesto (`proposats`) y si se pulsó «Canvia el lloc»
(`canviaLloc`; `lib/esborranyOferta.ts`): al recuperarlo, un lugar sin confirmar se vuelve a pedir (11-11-2026). E2E en `operativa.e2e.ts`: el productor y, en «Nova oferta assistida» de Ofertes, el
super_admin y el técnico (6/6 en el clon). Las dos entradas del equipo (Ofertes y Canalització) abren
`DialegNovaOfertaAssistida`, que monta el mismo formulario; `crear-oferta/campos` da los lugares a toda cuenta interna. El panel, en cambio, sí **precarga** la oferta nueva desde la Operativa:
`GET crear-oferta/campos` devuelve `predeterminats` (`ubicacio` = el principal o el único, `horari` = su primera franja
válida, `format_entrega` = el primer envase habitual con equivalente —`caixes`→`caixes`, `palets`→`palet`; `granel`,
`sacs` y `altres` no se traducen—). Tocar `_shared/intake.ts` obliga a redesplegar `whatsapp-webhook` y
`recollides-programades` (importa `confirmacionsWhatsapp.ts`, que importa `intake.ts`).
