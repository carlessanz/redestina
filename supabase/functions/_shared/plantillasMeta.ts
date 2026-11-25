// Las plantillas de WhatsApp (Meta) de la OFERTA, definidas UNA sola vez (25-11-2026).
//
// Módulo HOJA (sin red ni Deno, `tests/puresa.test.ts`): lo leen
//   · el panel (`src/lib/ofertaTemplate.ts`), que compone los `components` del envío;
//   · `_shared/whatsapp.ts`, que deja en la consola el texto legible de lo enviado;
//   · `scripts/plantillas-meta.ts`, que imprime (y, solo con `--enviar`, manda) la definición
//     a `POST /{WABA}/message_templates`;
//   · los tests, que comprueban que el texto cumple las reglas de Meta.
// Así el texto que se presenta a Meta y el que se rellena al enviar no pueden divergir. La
// explicación de cada plantilla, en `plantillas-meta.md` (§1 y §1bis).
//
// 🔴 Hoy NO se envían: las dos están tras un flag a `false` (`src/lib/plantillas.ts`) hasta que
//    haya número de producción y Meta las apruebe (checkpoint 2, AGENTS.md §12).
//
// Reglas de Meta que este módulo respeta (y vigila `problemesDefinicio()`):
//   · cuerpo ≤ 1024 caracteres, variables `{{1}}…{{n}}` seguidas, ni al principio ni al final;
//   · cabecera de texto ≤ 60 caracteres, sin variables, sin emojis ni saltos de línea;
//   · pie ≤ 60 caracteres; texto de botón ≤ 25; URL dinámica solo con `{{1}}` al final;
//   · al ENVIAR, ningún parámetro vacío, con saltos de línea, tabuladores ni más de 4 espacios
//     seguidos (error 132018): `netejaParametre()`.

/** El dominio de producción: va FIJO en la URL del botón (cambiarlo obliga a recrear la plantilla). */
export const DOMINI_PLANTILLES = "https://redestina.carlessanz.com";

export type CategoriaMeta = "UTILITY" | "MARKETING";

/** Respuesta rápida: el `payload` NO va en la definición; se pone al enviar (componente `button`). */
export interface BotoRespostaRapida {
  type: "QUICK_REPLY";
  text: string;
  /** Lo que devuelve el webhook al pulsarlo (`button.payload`); el contrato de `_shared/respuestas.ts`. */
  payload: string;
}

/** Botón de URL dinámica: la URL fija acaba en `{{1}}` y el sufijo se pone al enviar. */
export interface BotoUrl {
  type: "URL";
  text: string;
  url: string;
  /** El valor de ejemplo del sufijo (Meta pide la URL completa de ejemplo). */
  exempleSufix: string;
}

export type BotoPlantilla = BotoRespostaRapida | BotoUrl;

export interface DefinicioPlantilla {
  name: string;
  language: "ca";
  category: CategoriaMeta;
  /** Cabecera de texto FIJA (sin variables). */
  capcalera: string;
  /** Cuerpo con `{{1}}…{{n}}`. */
  cos: string;
  /** Pie fijo. */
  peu: string;
  /** Qué es cada variable, en orden (solo documentación; su número = el de `{{n}}`). */
  variables: readonly string[];
  /** Tope de caracteres de cada variable al enviar: garantiza el cuerpo ≤ 1024. */
  maxims: readonly number[];
  /** Valores de ejemplo que pide Meta al dar de alta la plantilla. */
  exemples: readonly string[];
  botons: readonly BotoPlantilla[];
}

/** El pie común: la salida (BAIXA) a la vista, que la reconoce el webhook. */
const PEU = "Per deixar de rebre missatges, respon BAIXA.";

/**
 * §1 · La oferta de UNA oferta a una entidad, fuera de la ventana de 24 h.
 *
 * Revisada el 25-11-2026 (huecos del 28-09): con modalidad y precio mínimo, con los botones
 * «M'interessa» / «Ara no» (los mismos ids que el mensaje con botones de dentro de la ventana,
 * así el diálogo sí → kg → precio funciona igual) y SIN el nombre del productor (D3: en donación
 * se dice el municipio y la comarca, no quién dona). Sin «Responsable» (fila 3.7.5 del Excel).
 */
export const OFERTA_EXCEDENT: DefinicioPlantilla = {
  name: "oferta_excedent",
  language: "ca",
  category: "UTILITY",
  capcalera: "Nova oferta d'excedent",
  cos: [
    "Hola! Hi ha un excedent disponible que et pot interessar.",
    "",
    "🌿 Producte: {{1}}",
    "📍 Municipi: {{2}}",
    "📦 Quantitat: {{3}}",
    "📅 Disponible fins: {{4}}",
    "⏰ Horari de recollida: {{5}}",
    "💰 Modalitat: {{6}}",
    "💶 Preu mínim: {{7}}",
    "",
    "Si la vols, prem «M'interessa» i et preguntarem quants kg vols recollir. Si no, prem «Ara no».",
  ].join("\n"),
  peu: PEU,
  variables: ["producte", "municipi", "quantitat", "disponible fins", "horari", "modalitat", "preu mínim"],
  maxims: [100, 100, 60, 30, 100, 80, 40],
  exemples: [
    "Tomàquet (Cor de bou)",
    "El Prat de Llobregat (Baix Llobregat)",
    "120 kg · 8 caixes",
    "30/07/2026",
    "dl, dc, dv · de 8:00 a 12:00",
    "Donació o venda",
    "0,80 €/kg",
  ],
  botons: [
    { type: "QUICK_REPLY", text: "M'interessa", payload: "accept:si" },
    { type: "QUICK_REPLY", text: "Ara no", payload: "accept:no" },
  ],
};

/**
 * §1bis · Una DISPONIBILIDAD multiproducto (fase 6a): UN mensaje con la lista de productos y un
 * botón al Mercat con el diálogo de solicitud abierto. Sin respuestas rápidas: el diálogo del bot
 * es de una sola oferta, el grupo se responde por el enlace (como el texto de dentro de la ventana).
 */
export const OFERTA_DISPONIBILITAT: DefinicioPlantilla = {
  name: "oferta_disponibilitat",
  language: "ca",
  category: "UTILITY",
  capcalera: "Nova oferta amb diversos productes",
  cos: [
    "Hola! Hi ha una oferta amb diversos productes que et pot interessar.",
    "",
    "🌿 Productes: {{1}}",
    "📍 Municipi: {{2}}",
    "📅 Disponible fins: {{3}}",
    "⏰ Horari de recollida: {{4}}",
    "💰 Modalitat: {{5}}",
    "",
    "Obre l'oferta amb el botó per triar els productes i indicar els kg, el dia i l'hora de recollida.",
  ].join("\n"),
  peu: PEU,
  variables: ["productes", "municipi", "disponible fins", "horari", "modalitat"],
  maxims: [300, 100, 30, 100, 80],
  exemples: [
    "Ceba 200 kg · Tomàquet 300 kg · Pebrot 80 kg",
    "Vilafranca del Penedès (Alt Penedès)",
    "30/07/2026",
    "dl, dc, dv · de 8:00 a 12:00",
    "Donació",
  ],
  botons: [
    {
      type: "URL",
      text: "Obre l'oferta",
      url: `${DOMINI_PLANTILLES}/receptor/mercat?disponibilitat={{1}}`,
      exempleSufix: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    },
  ],
};

/** Las plantillas de oferta, por nombre (el del script `crear <nombre>`). */
export const PLANTILLES_META: Readonly<Record<string, DefinicioPlantilla>> = {
  [OFERTA_EXCEDENT.name]: OFERTA_EXCEDENT,
  [OFERTA_DISPONIBILITAT.name]: OFERTA_DISPONIBILITAT,
};

/** Los números de las variables `{{n}}` de un texto, en orden de aparición. */
export function variablesDe(text: string): number[] {
  return [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}

/** Cuántas variables tiene el cuerpo (las distintas). */
export function nombreVariables(def: DefinicioPlantilla): number {
  return new Set(variablesDe(def.cos)).size;
}

/**
 * Un parámetro tal como lo acepta Meta al ENVIAR: sin saltos de línea ni tabuladores ni espacios
 * repetidos (132018), recortado por los bordes y como mucho `max` caracteres (con «…»). Vacío si
 * no queda nada: quien llama pone su valor de reserva (Meta rechaza un parámetro vacío).
 */
export function netejaParametre(v: unknown, max = 200): string {
  const s = String(v ?? "").replace(/[\r\n\t\v\f]+/g, " ").replace(/ {2,}/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** El cuerpo con los valores puestos (para la consola y los tests). */
export function cosAmbValors(def: DefinicioPlantilla, valors: readonly string[]): string {
  return def.cos.replace(/\{\{(\d+)\}\}/g, (m, n) => valors[Number(n) - 1] ?? m);
}

/** La URL completa de un botón de URL dinámica con su sufijo. */
export function urlBoto(boto: BotoUrl, sufix: string): string {
  return boto.url.replace("{{1}}", sufix);
}

/** ¿Tiene emojis? (Meta no los admite en la cabecera.) */
function ambEmoji(s: string): boolean {
  return /\p{Extended_Pictographic}/u.test(s);
}

/**
 * Lo que Meta rechazaría de una definición, en palabras. Vacío = se puede presentar. Lo usan los
 * tests y el script antes de imprimir o enviar nada.
 */
export function problemesDefinicio(def: DefinicioPlantilla): string[] {
  const p: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(def.name)) p.push("nombre: solo minúsculas, cifras y _");
  if (def.capcalera.length > 60) p.push("cabecera: más de 60 caracteres");
  if (/\{\{|\n/.test(def.capcalera)) p.push("cabecera: sin variables ni saltos de línea");
  if (ambEmoji(def.capcalera)) p.push("cabecera: sin emojis");
  if (def.peu.length > 60) p.push("pie: más de 60 caracteres");
  if (/\{\{/.test(def.peu)) p.push("pie: sin variables");
  if (def.cos.length > 1024) p.push("cuerpo: más de 1024 caracteres");
  const vars = variablesDe(def.cos);
  const n = new Set(vars).size;
  if (vars.some((v, i) => v !== i + 1)) p.push("cuerpo: las variables deben ir seguidas desde {{1}}, sin repetir");
  if (/^\s*\{\{/.test(def.cos) || /\}\}\s*$/.test(def.cos)) p.push("cuerpo: no puede empezar ni acabar con una variable");
  if (/\}\}\s*\{\{/.test(def.cos)) p.push("cuerpo: dos variables juntas");
  if (def.variables.length !== n) p.push(`variables: hay ${def.variables.length} y el cuerpo tiene ${n}`);
  if (def.maxims.length !== n) p.push(`maxims: hay ${def.maxims.length} y el cuerpo tiene ${n}`);
  if (def.exemples.length !== n) p.push(`exemples: hay ${def.exemples.length} y el cuerpo tiene ${n}`);
  // El peor caso: todas las variables a su tope. Así ningún envío puede pasarse de 1024.
  const fix = def.cos.replace(/\{\{\d+\}\}/g, "").length;
  const pitjor = fix + def.maxims.reduce((a, b) => a + b, 0);
  if (pitjor > 1024) p.push(`cuerpo: con las variables al máximo tiene ${pitjor} caracteres (> 1024)`);
  for (const [i, e] of def.exemples.entries()) {
    if (netejaParametre(e, def.maxims[i] ?? 200) !== e) p.push(`ejemplo ${i + 1}: no es un parámetro válido`);
  }
  if (def.botons.length > 10) p.push("botones: más de 10");
  for (const b of def.botons) {
    if (b.text.length > 25) p.push(`botón «${b.text}»: más de 25 caracteres`);
    if (b.type === "URL") {
      const v = variablesDe(b.url);
      if (v.length > 1 || (v.length === 1 && (v[0] !== 1 || !b.url.endsWith("{{1}}")))) {
        p.push(`botón «${b.text}»: la URL solo admite {{1}} al final`);
      }
      if (!b.url.startsWith("https://")) p.push(`botón «${b.text}»: la URL debe ser https`);
    }
  }
  return p;
}

/**
 * El cuerpo de `POST /{WABA_ID}/message_templates` (Cloud API) para dar de alta la plantilla.
 * Lo imprime `scripts/plantillas-meta.ts crear <nombre>` (y solo lo manda con `--enviar`).
 */
export function definicioPerMeta(def: DefinicioPlantilla): Record<string, unknown> {
  const components: Record<string, unknown>[] = [
    { type: "HEADER", format: "TEXT", text: def.capcalera },
    { type: "BODY", text: def.cos, example: { body_text: [[...def.exemples]] } },
    { type: "FOOTER", text: def.peu },
  ];
  if (def.botons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: def.botons.map((b) =>
        b.type === "URL"
          ? { type: "URL", text: b.text, url: b.url, example: [urlBoto(b, b.exempleSufix)] }
          : { type: "QUICK_REPLY", text: b.text }
      ),
    });
  }
  return { name: def.name, language: def.language, category: def.category, components };
}

/**
 * El `id` de la pulsación de una respuesta rápida de PLANTILLA (mensaje entrante `type: "button"`,
 * con `button.payload` y `button.text`), para que el webhook la trate como un `button_reply`.
 *
 * El payload lo pone el envío (`accept:si`, `accept:no`): con forma de id (`prefijo:valor`) se
 * devuelve tal cual. Si Meta lo devuelve sin él —cuando el envío no lo fijó, el payload es el
 * texto del botón—, se busca el botón de nuestras plantillas con ese texto y se usa su payload.
 * null si no se reconoce: el texto pasa por la clasificación de siempre.
 */
export function idDeBotoPlantilla(payload: unknown, text: unknown): string | null {
  const p = typeof payload === "string" ? payload.trim() : "";
  if (/^[a-z_]+:\S+$/i.test(p)) return p;
  for (const candidat of [p, typeof text === "string" ? text.trim() : ""]) {
    if (!candidat) continue;
    for (const def of Object.values(PLANTILLES_META)) {
      const b = def.botons.find((x) => x.type === "QUICK_REPLY" && x.text === candidat);
      if (b && b.type === "QUICK_REPLY") return b.payload;
    }
  }
  return null;
}

/** Lo que el texto de la consola necesita de un `components` de envío. */
interface ComponentEnviament {
  type?: unknown;
  sub_type?: unknown;
  index?: unknown;
  parameters?: { type?: unknown; text?: unknown; payload?: unknown }[];
}

/**
 * El texto LEGIBLE de una plantilla de oferta enviada, para `wa_messages.body` (Mensajería): la
 * cabecera, el cuerpo con los valores y los botones. null si no es una de estas plantillas.
 */
export function textConsolaPlantilla(nom: string, components: readonly unknown[] = []): string | null {
  const def = PLANTILLES_META[nom];
  if (!def) return null;
  const cs = components.filter((c): c is ComponentEnviament => typeof c === "object" && c !== null);
  const cos = cs.find((c) => c.type === "body");
  const valors = (cos?.parameters ?? []).map((p) => String(p?.text ?? ""));
  const botons = def.botons.map((b, i) => {
    if (b.type !== "URL") return `[${b.text}]`;
    const c = cs.find((x) => x.type === "button" && x.sub_type === "url" && String(x.index) === String(i));
    const sufix = c?.parameters?.[0]?.text;
    return `[${b.text}: ${typeof sufix === "string" ? urlBoto(b, sufix) : b.url}]`;
  });
  return [`*${def.capcalera}*`, "", cosAmbValors(def, valors), "", `_${def.peu}_`, botons.join(" ")]
    .join("\n").trimEnd();
}
