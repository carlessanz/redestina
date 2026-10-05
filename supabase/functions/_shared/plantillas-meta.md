# Plantillas de WhatsApp (Meta) — contenido listo para dar de alta

> **Estado:** preparadas, **no aprobadas**. La creación y aprobación se hace en el
> **WhatsApp Manager** de Meta (business.facebook.com → WhatsApp Manager → Plantillas de
> mensajes) o por la Cloud API `POST /{WABA_ID}/message_templates`, y la revisa **Meta**
> (minutos–24 h). En el **número de test** solo `hello_world` es usable; para estas plantillas
> hace falta un **número/WABA de producción** (verificación de empresa). Mientras tanto, las
> ofertas a entidades salen por **texto en la ventana de 24 h** (ver `whatsapp-send` + AGENTS.md).

El envío por plantilla ya está soportado en `whatsapp-send` (`type: "template"`, con `template`,
`language` y `components`). Solo falta, cuando estén aprobadas, pasar los `components` con los
parámetros. Abajo va el mapeo desde los campos del excedente (`componerTextoOferta`, `oferta.ts`).

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

## 1. `oferta_excedent` — aviso de oferta a una entidad

- **Nombre:** `oferta_excedent`
- **Categoría:** `UTILITY` (aviso operativo; si Meta la reclasifica a `MARKETING`, requiere opt-in de marketing)
- **Idioma:** `ca` (català)
- **Header:** Text — `📢 Nova oferta d'excedent disponible`
- **Body** (7 variables):

```
Hola! Hi ha un excedent disponible que et pot interessar:

🌿 Producte: {{1}}
👩‍🌾 Productor: {{2}}
📍 Municipi: {{3}}
📦 Quantitat: {{4}}
📅 Disponible: {{5}}
⏰ Horari recollida: {{6}}

Responsable: {{7}}. Respon a aquest missatge si la vols.
```

- **Mapeo de variables** (desde el excedente):
  1. `producto` (+ `variedad` si hay)
  2. nombre del productor
  3. `municipi` (de la ubicación / població del productor)
  4. `kg_total` kg (+ `num_caixes` caixes)
  5. `disponible_hasta`
  6. `horari_recollida`
  7. responsable (equipo Redestina)

- ⚠️ **Antes de darla de alta en Meta** (revisión del 28-09-2026): le falta una variable con la
  **modalidad y el preu mínim** —tal como está, una venta llegaría sin precio— y no lleva botones
  de respuesta rápida, así que la respuesta dependería de adivinar el sí/no del texto. Y la línea
  «Productor» nombra al donante: en donación, D3 pide municipio y comarca, no el nombre (§4).
  Añadir la variable y los botones [M'interessa] [Ara no] y decidir lo de D3 antes de enviarla a
  aprobar. La fecha (5) ya se manda como `dd/mm/aaaa` (`ofertaTemplate.ts`).

- **Ejemplo de `components` para `whatsapp-send`:**

```jsonc
{
  "to": "34…", "type": "template", "template": "oferta_excedent", "language": "ca",
  "components": [
    { "type": "header", "parameters": [] },
    { "type": "body", "parameters": [
      { "type": "text", "text": "Tomàquet" },
      { "type": "text", "text": "Cal Pere" },
      { "type": "text", "text": "El Prat" },
      { "type": "text", "text": "120 kg" },
      { "type": "text", "text": "fins 30/07" },
      { "type": "text", "text": "matins" },
      { "type": "text", "text": "Equip Redestina" }
    ]}
  ]
}
```

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
