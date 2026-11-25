# Plantillas de WhatsApp (Meta) — contenido listo para dar de alta

> **Estado:** preparadas, **no aprobadas**. La creación y aprobación se hace en el
> **WhatsApp Manager** de Meta (business.facebook.com → WhatsApp Manager → Plantillas de
> mensajes) o por la Cloud API `POST /{WABA_ID}/message_templates`, y la revisa **Meta**
> (minutos–24 h). En el **número de test** solo `hello_world` es usable; para estas plantillas
> hace falta un **número/WABA de producción** (verificación de empresa). Mientras tanto, las
> ofertas a entidades salen por **texto en la ventana de 24 h** (ver `whatsapp-send` + AGENTS.md).

El envío por plantilla ya está soportado en `whatsapp-send` (`type: "template"`, con `template`,
`language` y `components`). Las dos de oferta (§1 y §1bis) están **listas en el código y
apagadas por flag** (`src/lib/plantillas.ts`); su texto vive en `_shared/plantillasMeta.ts` y
`scripts/plantillas-meta.ts` lo imprime (`crear`, dry-run) o lo consulta en Meta (`listar`).

---

## 0. Plantillas de primer contacto (salutació) — piden responder «ALTA»

Sirven para el **primer contacto** (fuera de la ventana de 24 h): abren la conversación pidiendo
que respondan «ALTA».
⚠️ **ALTA y no «OK»** (28-09-2026): ALTA es la palabra que da el consentimiento (`opt_in`) y el
webhook la confirma; un «OK» solo abría 24 h de ventana y, si la entidad tenía una oferta
pendiente, **la aceptaba** sin querer. La app las elige por rol desde `src/lib/plantillas.ts`
(`plantillaPrimerContacte`); hoy con el flag `PLANTILLES_CA_APROVADES = false` → mientras se está
en test se envía `hello_world`, y al aprobarlas en Meta y poner el flag a `true` se envían estas.

### 0a. `salutacio_productor` — primer contacto con un productor

- **Nombre:** `salutacio_productor`
- **Categoría:** `UTILITY`
- **Idioma:** `ca`
- **Body** (sin variables):

```
Hola! Som l'equip de Redestina, d'Espigoladors 🌱. T'ajudem a donar sortida als teus excedents agrícoles. Si vols que et puguem escriure per WhatsApp, respon ALTA. Gràcies!
```

### 0b. `salutacio_entitat` — primer contacto con una entidad receptora

- **Nombre:** `salutacio_entitat`
- **Categoría:** `UTILITY`
- **Idioma:** `ca`
- **Body** (sin variables):

```
Hola! Som l'equip de Redestina, d'Espigoladors 🌱. Col·laborem amb entitats socials per aprofitar excedents agrícoles. Si vols rebre les nostres ofertes per WhatsApp, respon ALTA. Gràcies!
```

Sin variables → aprobación más fácil. Si Meta las reclasifica a `MARKETING`, requerirán opt-in de
marketing; en ese caso valorar añadir un botón de respuesta rápida «ALTA» en lugar de pedirlo en el texto.

---

## 1. `oferta_excedent` — aviso de UNA oferta a una entidad (revisada el 25-11-2026)

> **Fuente única del texto:** `_shared/plantillasMeta.ts` (`OFERTA_EXCEDENT`). Este apartado lo
> explica; si discrepan, manda el `.ts` (lo vigila `tests/plantillasMeta.test.ts`, que exige que el
> cuerpo de aquí sea idéntico). Para presentarla: `deno run -A scripts/plantillas-meta.ts crear
> oferta_excedent` (dry-run; imprime el JSON) y, con la WABA de producción, `… --enviar`.

- **Nombre:** `oferta_excedent` · **Idioma:** `ca` · **Categoría propuesta:** `UTILITY`
  (aviso operativo ligado a una gestión en curso: la entidad está dada de alta como receptora).
  ⚠️ **Meta puede reclasificarla a `MARKETING`** (lo hace sola si ve tono promocional); entonces
  exige opt-in de marketing y cuesta el doble. Coste orientativo (`docs/Costes de WhatsApp —
  Redestina.md`, España): **≈ 0,03 € por entidad** en Utility, **≈ 0,06 €** en Marketing; **0 €**
  si la ventana de 24 h está abierta (pero entonces la app manda el texto con botones, no esto).
- **Header** (texto fijo, sin emoji —Meta no los admite en la cabecera—): `Nova oferta d'excedent`
- **Body** (7 variables):

```
Hola! Hi ha un excedent disponible que et pot interessar.

🌿 Producte: {{1}}
📍 Municipi: {{2}}
📦 Quantitat: {{3}}
📅 Disponible fins: {{4}}
⏰ Horari de recollida: {{5}}
💰 Modalitat: {{6}}
💶 Preu mínim: {{7}}

Si la vols, prem «M'interessa» i et preguntarem quants kg vols recollir. Si no, prem «Ara no».
```

- **Footer:** `Per deixar de rebre missatges, respon BAIXA.`
- **Botones** (respuesta rápida): `M'interessa` (payload `accept:si`) · `Ara no` (payload `accept:no`).
  El payload se pone **al enviar**; el webhook recibe la pulsación como `type: "button"` con
  `button.payload` y `leerRespuesta()` (`_shared/intake.ts`) la convierte en el mismo `id` que los
  botones del mensaje de dentro de la ventana, así que el diálogo sí → kg → precio
  (`_shared/respuestas.ts`) no cambia. Si el payload llegara vacío, se reconoce por el texto
  del botón (`idDeBotoPlantilla()`).
- **Mapeo** (`construirComponentsOferta`, `src/lib/ofertaTemplate.ts`; tope de caracteres entre
  paréntesis y valor de reserva, porque Meta rechaza un parámetro vacío):
  1. producto (variedad) (100; `—`)
  2. municipio del lugar o de la ficha + `(comarca)` (100; `—`) — **sin el nombre del productor**:
     D3 pide municipio y comarca en donación, y la plantilla es la misma para todas las modalidades
  3. kg + cajas o palets, p. ej. `120 kg · 8 caixes` (60; `a convenir`)
  4. `disponible_hasta` como `dd/mm/aaaa` (30; `consultar`)
  5. días y franja, p. ej. `dl, dc, dv · de 8:00 a 12:00` (100; `a convenir`)
  6. modalidades, p. ej. `Donació o venda` (80; `a convenir`)
  7. precio mínimo si incluye venta, `0,80 €/kg`; con venta sin precio, `a convenir`; sin venta,
     `no s'aplica` (40)
- Lo que **se quitó** respecto a la versión del 28-09: el productor (D3), el responsable (fila 3.7.5
  del Excel de la Fundació) y el emoji de la cabecera. Lo que **se añadió**: modalidad, precio
  mínimo, días de recogida, comarca, pie con BAIXA y los dos botones.
- **Ejemplo de `components` para `whatsapp-send`:**

```jsonc
{
  "to": "34…", "type": "template", "template": "oferta_excedent", "language": "ca",
  "components": [
    { "type": "body", "parameters": [
      { "type": "text", "text": "Tomàquet (Cor de bou)" },
      { "type": "text", "text": "El Prat de Llobregat (Baix Llobregat)" },
      { "type": "text", "text": "120 kg · 8 caixes" },
      { "type": "text", "text": "30/07/2026" },
      { "type": "text", "text": "dl, dc, dv · de 8:00 a 12:00" },
      { "type": "text", "text": "Donació o venda" },
      { "type": "text", "text": "0,80 €/kg" }
    ]},
    { "type": "button", "sub_type": "quick_reply", "index": "0",
      "parameters": [{ "type": "payload", "payload": "accept:si" }] },
    { "type": "button", "sub_type": "quick_reply", "index": "1",
      "parameters": [{ "type": "payload", "payload": "accept:no" }] }
  ]
}
```

- **En la app:** `OfferDetail` la ofrece (toast «Enviar com a plantilla») cuando `whatsapp-send`
  contesta `window_closed`, la entidad tiene opt-in y `PLANTILLA_OFERTA_APROVADA = true`
  (`src/lib/plantillas.ts`). Hoy el flag está a `false`: se avisa `od.tpl_not_approved` y se
  cae al correo.

## 1bis. `oferta_disponibilitat` — oferta MULTIPRODUCTO a una entidad (nueva, 25-11-2026)

> Fuente única: `_shared/plantillasMeta.ts` (`OFERTA_DISPONIBILITAT`); dry-run con
> `deno run -A scripts/plantillas-meta.ts crear oferta_disponibilitat`.

- **Nombre:** `oferta_disponibilitat` · **Idioma:** `ca` · **Categoría propuesta:** `UTILITY`
  (misma advertencia de reclasificación y mismo coste por entidad que §1: es un solo mensaje por
  entidad, lleve los productos que lleve).
- **Header:** `Nova oferta amb diversos productes`
- **Body** (5 variables):

```
Hola! Hi ha una oferta amb diversos productes que et pot interessar.

🌿 Productes: {{1}}
📍 Municipi: {{2}}
📅 Disponible fins: {{3}}
⏰ Horari de recollida: {{4}}
💰 Modalitat: {{5}}

Obre l'oferta amb el botó per triar els productes i indicar els kg, el dia i l'hora de recollida.
```

- **Footer:** `Per deixar de rebre missatges, respon BAIXA.`
- **Botón** (URL dinámica, sin respuestas rápidas: el diálogo del bot es de una sola oferta y el
  grupo se responde por el enlace): `Obre l'oferta` →
  `https://redestina.carlessanz.com/receptor/mercat?disponibilitat={{1}}`, con `{{1}}` =
  `disponibilitats.id` (uuid). El dominio va **fijo** en la plantilla: si cambia, hay que recrearla.
  Meta pide una URL de ejemplo completa al darla de alta (la pone el script).
- **Mapeo** (`construirComponentsDisponibilitat`, `src/lib/ofertaTemplate.ts`):
  1. los productos que encajan con la entidad en UNA línea, `Ceba 200 kg · Tomàquet 300 kg`; si
     pasa de 300 caracteres, los primeros que caben y `i N més` (`—` si no hay)
  2. municipio (+ comarca) (100; `—`)
  3. `disponible_hasta` de la primera oferta, `dd/mm/aaaa` (30; `consultar`)
  4. días y franja de la primera (100; `a convenir`)
  5. la unión de las modalidades del grupo, `Donació o venda` (80; `a convenir`)
- **Ejemplo de `components`:**

```jsonc
{
  "to": "34…", "type": "template", "template": "oferta_disponibilitat", "language": "ca",
  "components": [
    { "type": "body", "parameters": [
      { "type": "text", "text": "Ceba 200 kg · Tomàquet 300 kg · Pebrot 80 kg" },
      { "type": "text", "text": "Vilafranca del Penedès (Alt Penedès)" },
      { "type": "text", "text": "30/07/2026" },
      { "type": "text", "text": "dl, dc, dv · de 8:00 a 12:00" },
      { "type": "text", "text": "Donació" }
    ]},
    { "type": "button", "sub_type": "url", "index": "0",
      "parameters": [{ "type": "text", "text": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b" }] }
  ]
}
```

- **En la app:** `EnviamentDisponibilitat` (`src/components/equip/`). Con
  `PLANTILLA_DISPONIBILITAT_APROVADA = true`, si la entidad tiene opt-in y la ventana está cerrada
  (`motiu_canal = 'opt_in'` → directamente; o `whatsapp-send` contesta `window_closed`), manda la
  plantilla y registra igual que el texto (una fila `pendent` por oferta, `dialeg_pas = 'fet'`);
  si falla por ventana u opt-in, cae al correo. Con el flag a `false` (hoy), lo de siempre: texto
  y, con la ventana cerrada, correo.

### Límites de Meta que respetan las dos (los comprueba `problemesDefinicio()` y sus tests)

- Cuerpo ≤ 1024 caracteres **con todas las variables a su tope** (cada variable tiene el suyo).
- Variables `{{1}}…{{n}}` seguidas, ni al principio ni al final del cuerpo, nunca dos juntas.
- Cabecera de texto ≤ 60, sin variables ni emojis; pie ≤ 60; texto de botón ≤ 25; URL dinámica
  con `{{1}}` solo al final.
- Al enviar, ningún parámetro vacío, con saltos de línea, tabuladores ni más de 4 espacios
  seguidos (error `132018`): `netejaParametre()` los convierte en un espacio.
- Al darla de alta, valores de ejemplo para cada variable y para la URL (`definicioPerMeta()`).

## 2. `confirmacio_productor` — confirmación al productor tras crear la oferta

- **Nombre:** `confirmacio_productor`
- **Categoría:** `UTILITY`
- **Idioma:** `ca`
- **Body** (2 variables):

```
Gràcies! Hem registrat la teva oferta de {{1}} amb la referència {{2}}. L'equip de Redestina la farà arribar a les entitats que la puguin aprofitar. 🌱
```

- **Mapeo:** 1 = `producto`, 2 = `id_excedente`.
- Hoy este texto se manda como **texto** desde `crearExcedenteDesdeSesion` (dentro de la ventana,
  porque lo abre el productor); esta plantilla solo hace falta si algún día se envía fuera de ventana.

## 3. (opcional) `recollida_confirmada` — RECOLLIDA CONFIRMADA

Si se quisiera notificar fuera de ventana el cierre de una canalización, replicar el texto de
`src/lib/textos.ts` (`textoRecollidaConfirmada`) como plantilla con variables entitat / data /
kg recollits / kg falten. Hoy se **copia a mano** desde el panel, así que no es urgente.

## 4. `confirmacio_recollida_productor` / `confirmacio_recollida_receptor` (rebanada 3, 05-10-2026)

A la hora de recogida, `recollides-programades` emite el albarán y manda a cada parte el enlace
de confirmación. Hoy sale **por correo** (§8bis: el correo es el canal por defecto). Para
mandarlo también por WhatsApp fuera de la ventana de 24 h hacen falta estas dos plantillas
(`UTILITY`, `ca`). **Sin la URL en el cuerpo** (Meta la desaconseja en UTILITY): va en un botón
de URL dinámica con el token como sufijo (`https://redestina.carlessanz.com/confirmar/{{1}}`).

```
confirmacio_recollida_productor
La recollida de l'albarà {{1}} ja ha arribat a la seva hora. Confirma els quilos que has lliurat o fes constar qualsevol incidència. És un minut i no cal tenir compte.
[Botó: Confirma la recollida → /confirmar/{{1}}]
```

```
confirmacio_recollida_receptor
La recollida de l'albarà {{1}} ja ha arribat a la seva hora. Confirma els quilos que has rebut o fes constar qualsevol incidència. És un minut i no cal tenir compte.
[Botó: Confirma la recepció → /confirmar/{{1}}]
```

- **Mapeo:** cuerpo 1 = `albaranes.numero_completo`; botón 1 = el token en claro.
- No están dadas de alta. Cuando Meta las apruebe, `recollides-programades` puede probar WhatsApp
  antes que el correo (y añadirlas a `TEXTO_PLANTILLA`, §6ter).

---

### Notas de aprobación
- Menos variables = aprobación más fácil. Evitar URLs y contenido promocional en `UTILITY`.
- El `language` debe coincidir **exactamente** con el de la plantilla aprobada (`ca`).
- Si Meta devuelve `132001` (plantilla no existe) o `132000` (nº de parámetros), revisar nombre,
  idioma y que `components` tenga tantos `text` como variables.
