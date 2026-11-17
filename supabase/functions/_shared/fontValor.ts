// De dónde sale el valor por kilo de una canalización (punto 3, fase D2, 17-11-2026).
//
// Módulo HOJA (§7, `tests/puresa.test.ts`): no importa nada y no usa `Deno.`. Lo usan a la vez
// el albarán de recepción (`pdf/render/albara1p.ts`), el certificado de donación
// (`pdf/render/cd.ts`) y el panel del equipo (`src/components/ValorCanalitzacio.tsx`), para que
// el papel y la pantalla digan exactamente lo mismo.
//
// 🔴 La regla (opción A del cliente, «el certificat agafa els preus del mes en què es van generar
//    els albarans»): cada canalización guarda su valor, su FUENTE, el MES DEL ALBARÁN (el del REC
//    de su oferta) y el MES DEL QUE SALE el precio (`mes_font`: el del albarán o, si Gencat aún
//    no lo había publicado, su último mes publicado; 20270602100000). Si el mes del albarán aún no estaba validado
//    (Gencat publica con dos meses de retraso), el valor es el último validado y queda
//    PROVISIONAL hasta que el equipo valide ese mes; entonces se ajusta solo. Aquí solo se decide
//    cómo se ESCRIBE eso; qué valor es lo decide la base (`valoracio_canalitzacio`).

export type IdiomaFont = "ca" | "es";

/**
 * `declarat`: lo escribió el productor en la oferta (definitivo, nunca se ajusta).
 * `gencat` · `mercabarna` · `manual`: el precio de referencia validado de un mes.
 * `fixat`: el equipo lo fijó para esta canalización (p. ej. una conciliación retroactiva).
 * `historic`: valorada antes de la D2 (`costes_producto` de entonces); no se toca.
 */
export type FontValor = "declarat" | "gencat" | "mercabarna" | "manual" | "fixat" | "historic";

/** Lo que guarda una canalización (y lo que viaja en el snapshot de un documento). */
export interface ValorFont {
  font?: string | null;
  /** El mes del que sale el precio: `aaaa-mm-dd` (día 1) o `aaaa-mm`. Null en declarat/fixat. */
  mes_font?: string | null;
  /** El mes del albarán: el que el certificado aplicará. */
  mes_albara?: string | null;
  /** Días de Mercabarna capturados en el mes (informativo: el valor es el ÚLTIMO del mes). */
  dies?: number | null;
  provisional?: boolean | null;
}

const MESOS: Record<IdiomaFont, string[]> = {
  ca: ["gener", "febrer", "març", "abril", "maig", "juny", "juliol", "agost", "setembre", "octubre", "novembre", "desembre"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
};

const TXT = {
  ca: {
    gencat: "Gencat, preus percebuts pel pagès",
    mercabarna: "Mercabarna (darrer preu del mes)",
    referencia: "Valor de referència",
    manual: "Preu fixat per la Fundació",
    fixat: "Preu fixat per la Fundació",
    declarat: "Valor declarat pel donant",
    historic: "Valor de referència del producte",
    provisional: (darrer: string | null) =>
      `Valor de referència provisional${darrer ? ` (darrer publicat: ${darrer})` : ""}; el certificat aplicarà el del mes de l'albarà.`,
    sense: "Sense valor de referència encara; el certificat aplicarà el del mes de l'albarà.",
    fonts: "Fonts dels valors",
  },
  es: {
    gencat: "Gencat, precios percibidos por los agricultores",
    mercabarna: "Mercabarna (último precio del mes)",
    referencia: "Valor de referencia",
    manual: "Precio fijado por la Fundació",
    fixat: "Precio fijado por la Fundació",
    declarat: "Valor declarado por el donante",
    historic: "Valor de referencia del producto",
    provisional: (darrer: string | null) =>
      `Valor de referencia provisional${darrer ? ` (último publicado: ${darrer})` : ""}; el certificado aplicará el del mes del albarán.`,
    sense: "Todavía sin valor de referencia; el certificado aplicará el del mes del albarán.",
    fonts: "Fuentes de los valores",
  },
} as const;

/** «setembre 2026» de `2026-09-01` o `2026-09`. Null si no se puede leer. */
export function textMes(mes: string | null | undefined, idioma: IdiomaFont = "ca"): string | null {
  const m = typeof mes === "string" ? mes.match(/^(\d{4})-(\d{2})/) : null;
  if (!m) return null;
  const n = Number(m[2]);
  if (n < 1 || n > 12) return null;
  return `${MESOS[idioma][n - 1]} ${m[1]}`;
}

/** La fuente sin el mes: «Gencat, preus percebuts pel pagès», «Mercabarna (darrer preu del mes)»… */
export function nomFont(v: ValorFont, idioma: IdiomaFont = "ca"): string | null {
  const t = TXT[idioma];
  switch (v.font) {
    case "gencat": return t.gencat;
    case "mercabarna": return t.mercabarna;
    case "manual": return t.manual;
    case "fixat": return t.fixat;
    case "declarat": return t.declarat;
    case "historic": return t.historic;
    default: return null;
  }
}

/** La fuente con su mes, sin prefijo: «Gencat, preus percebuts pel pagès, setembre 2026». */
function fontAmbMes(v: ValorFont, idioma: IdiomaFont): string | null {
  const nom = nomFont(v, idioma);
  if (!nom) return null;
  const mes = v.font === "gencat" || v.font === "mercabarna" ? textMes(v.mes_font, idioma) : null;
  return mes ? `${nom}, ${mes}` : nom;
}

/**
 * La línea que se imprime junto al valor por kilo (REC de donación) y que enseña el panel:
 *   · «Valor de referència: Gencat, preus percebuts pel pagès, setembre 2026»
 *   · «Valor de referència: Mercabarna (darrer preu del mes), novembre 2026»
 *   · «Preu fixat per la Fundació» · «Valor declarat pel donant»
 *   · provisional: «Valor de referència provisional (darrer publicat: …); el certificat aplicarà
 *     el del mes de l'albarà.»
 * Null si no hay nada que decir (un snapshot de antes de la D2).
 */
export function textFontValor(v: ValorFont | null | undefined, idioma: IdiomaFont = "ca"): string | null {
  if (!v) return null;
  const t = TXT[idioma];
  if (v.provisional) {
    const darrer = fontAmbMes(v, idioma);
    return darrer || v.font ? t.provisional(darrer) : t.sense;
  }
  if (!v.font) return null;
  if (v.font === "gencat" || v.font === "mercabarna") return `${t.referencia}: ${fontAmbMes(v, idioma)}`;
  return fontAmbMes(v, idioma);
}

/**
 * La nota del certificado: las fuentes usadas, sin repetir, en una línea.
 * «Fonts dels valors: Gencat, preus percebuts pel pagès (setembre 2026, octubre 2026); Valor
 * declarat pel donant.» Null sin fuentes (un certificado de antes de la D2).
 */
export function notaFontsCertificat(fonts: ValorFont[] | null | undefined, idioma: IdiomaFont = "ca"): string | null {
  const llista = (Array.isArray(fonts) ? fonts : []).filter((f) => f && f.font);
  if (llista.length === 0) return null;
  const perNom = new Map<string, string[]>();
  for (const f of llista) {
    const nom = nomFont(f, idioma);
    if (!nom) continue;
    const mes = f.font === "gencat" || f.font === "mercabarna" ? textMes(f.mes_font, idioma) : null;
    const mesos = perNom.get(nom) ?? [];
    if (mes && !mesos.includes(mes)) mesos.push(mes);
    perNom.set(nom, mesos);
  }
  if (perNom.size === 0) return null;
  const parts = [...perNom.entries()].map(([nom, mesos]) => mesos.length ? `${nom} (${mesos.join(", ")})` : nom);
  return `${TXT[idioma].fonts}: ${parts.join("; ")}.`;
}
