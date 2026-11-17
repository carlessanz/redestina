// Las fuentes de los precios de referencia (punto 3, fase D1, 17-11-2026).
//
// Dos fuentes públicas, cada una con su formato:
//
//   · GENCAT, «Preus percebuts pel pagès»: un XLS antiguo (BIFF) en una dirección fija que se
//     sustituye en el sitio. 15 hojas; en cada una la fila con «Codi» es la cabecera
//     (Codi, Producte, Any, Gen.…Des., Anual) y cada producto es un bloque: la primera fila
//     lleva código, nombre y el primer año; la segunda, en la columna «Producte», la UNIDAD
//     (`€/100 kg` casi siempre); luego una fila por año. Un mes sin mercado es «-», y los meses
//     que aún no se han publicado vienen vacíos (el fichero va con retraso).
//   · MERCABARNA, «Estadístiques diàries»: una página HTML que solo enseña el día anterior,
//     con el precio dominante, máximo y mínimo de cada producto (en € por kg, salvo los
//     calçots, que van por unidad). 🔴 La exportación CSV de esa página está rota —devuelve
//     siempre el 07-03-2024—, así que se lee la TABLA HTML, cada día, y la media mensual se
//     calcula en la base con los días guardados.
//
// MÓDULO HOJA (§7, `tests/puresa.test.ts`): sin `Deno`, sin red y sin el lector de XLS. La Edge
// Function `preus-fonts` convierte el libro en filas con SheetJS y se las pasa a
// `llegeixGencat()`; el panel importa de aquí `normalitzaNom()` y `coincidencies()` para
// proponer equivalencias al dar de alta un producto.

export type FontPreus = "gencat" | "mercabarna";

/** Una observación tal como la guarda `registrar_carrega_preus()`. */
export interface Observat {
  codi_font: string | null;
  nom_font: string;
  exercici: number;
  mes: number;
  dia: number | null;
  valor_original: number;
  unitat: string;
  /** null = la unidad no es de peso: no se guarda (ver `llegeixGencat`) o no se usa. */
  eur_kg: number | null;
  valor_max?: number | null;
  valor_min?: number | null;
}

/** Redondeo a 4 decimales: lo que guarda `preus_referencia.eur_kg`. */
export function arrodoneix(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * El factor para pasar una unidad de la fuente a €/kg, o null si no es de peso.
 * `€/100 kg` → 0,01; `€/kg` → 1. Todo lo demás (€/100 litres, €/unitat, €/100 dotzenes, y
 * también `€/100kg viu` del ganado, que es peso vivo y no producto) → null.
 */
export function factorEurKg(unitat: string | null | undefined): number | null {
  if (!unitat) return null;
  const u = String(unitat).normalize("NFC").toLowerCase().replace(/\s+/g, "");
  if (u === "€/100kg") return 0.01;
  if (u === "€/kg") return 1;
  return null;
}

/** Un número de celda: número de verdad, o texto «12,5» / «1.234,50». «-» o vacío → null. */
export function numeroCella(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "" || s === "-") return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Gencat
// ---------------------------------------------------------------------------

const MESOS_GENCAT = ["gen", "feb", "mar", "abr", "mai", "jun", "jul", "ago", "set", "oct", "nov", "des"];

export interface FullGencat {
  nom: string;
  files: unknown[][];
}

export interface ResultatGencat {
  observats: Observat[];
  /** Productos (bloques) con unidad de peso. */
  productes: number;
  /** Bloques que no son de peso, para el registro: no se guardan. */
  ignorats: { codi: string; nom: string; unitat: string }[];
  /** El último mes con algún valor (el fichero va con retraso), o null. */
  fins: { exercici: number; mes: number } | null;
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/**
 * Lee el libro de Gencat ya convertido en filas (una matriz por hoja). Las hojas sin la fila
 * «Codi» (la nota metodológica) se saltan. Si una cabecera no tiene los doce meses en su
 * sitio, lanza `format_desconegut`: es mejor no cargar nada que cargar precios desplazados.
 */
export function llegeixGencat(fulls: readonly FullGencat[]): ResultatGencat {
  const observats: Observat[] = [];
  const ignorats: ResultatGencat["ignorats"] = [];
  let productes = 0;
  let fins: ResultatGencat["fins"] = null;

  for (const full of fulls) {
    const files = full.files ?? [];
    const hi = files.findIndex((f) => Array.isArray(f) && f.some((c) => text(c) === "Codi"));
    if (hi < 0) continue;
    const cap = files[hi].map(text);
    const cCodi = cap.indexOf("Codi");
    const cProd = cap.indexOf("Producte");
    const cAny = cap.indexOf("Any");
    if (cProd < 0 || cAny < 0) throw new Error("format_desconegut");
    for (let m = 0; m < 12; m++) {
      const etiqueta = cap[cAny + 1 + m]?.toLowerCase().replace(/\.$/, "") ?? "";
      if (!etiqueta.startsWith(MESOS_GENCAT[m])) throw new Error("format_desconegut");
    }

    let i = hi + 1;
    while (i < files.length) {
      const fila = files[i] ?? [];
      const codi = text(fila[cCodi]);
      const nom = text(fila[cProd]);
      if (!codi || !nom) { i++; continue; }
      // La unidad, en la columna «Producte» de la fila siguiente.
      const unitat = text(files[i + 1]?.[cProd]);
      const factor = factorEurKg(unitat);
      // Las filas del bloque: la primera y las siguientes sin código y con año.
      const bloc: unknown[][] = [fila];
      let j = i + 1;
      while (j < files.length) {
        const f = files[j] ?? [];
        if (text(f[cCodi])) break;
        if (numeroCella(f[cAny]) === null) break;
        bloc.push(f);
        j++;
      }
      i = j;
      if (factor === null) {
        ignorats.push({ codi, nom, unitat });
        continue;
      }
      productes++;
      for (const f of bloc) {
        const exercici = numeroCella(f[cAny]);
        if (exercici === null || exercici < 2000 || exercici > 2100) continue;
        for (let m = 0; m < 12; m++) {
          const v = numeroCella(f[cAny + 1 + m]);
          if (v === null || v <= 0) continue;
          observats.push({
            codi_font: codi, nom_font: nom, exercici, mes: m + 1, dia: null,
            valor_original: v, unitat, eur_kg: arrodoneix(v * factor),
          });
          if (!fins || exercici > fins.exercici || (exercici === fins.exercici && m + 1 > fins.mes)) {
            fins = { exercici, mes: m + 1 };
          }
        }
      }
    }
  }
  return { observats, productes, ignorats, fins };
}

/**
 * Las direcciones que se prueban si la de Gencat da 404: el nombre lleva el rango de años
 * (`…percebuts2020_2026_20.xls`) y en 2027 cambiará. Se cambia solo el año final por el
 * actual y el siguiente; si ninguna existe, el job avisa y el super_admin pone la nueva.
 */
export function candidatsUrlGencat(url: string, anyActual: number): string[] {
  const m = url.match(/^(.*?)(\d{4})_(\d{4})(_\d+)?(\.xlsx?)$/i);
  if (!m) return [];
  const [, pre, des, fins, sufix = "", ext] = m;
  const out: string[] = [];
  for (const a of [anyActual, anyActual + 1]) {
    if (String(a) === fins) continue;
    out.push(`${pre}${des}_${a}${sufix}${ext}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mercabarna
// ---------------------------------------------------------------------------

export interface FilaMercabarna {
  nom: string;
  dominant: number | null;
  maxim: number | null;
  minim: number | null;
}

export interface ResultatMercabarna {
  /** AAAA-MM-DD: el día que dice la página (normalmente, el anterior a la descarga). */
  data: string;
  files: FilaMercabarna[];
}

/** Los productos que Mercabarna no da por kilo. Lo demás se toma como €/kg. */
export const UNITATS_MERCABARNA: Readonly<Record<string, string>> = {
  "CALÇOTS": "€/unitat",
};

function decodificaEntitats(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

const netejaCella = (s: string): string =>
  decodificaEntitats(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

/**
 * Lee la tabla de la página de resultados. Lanza `sense_data` si la página no dice de qué día
 * son los precios y `sense_taula` si no trae la tabla o la tabla no tiene filas: con
 * cualquiera de las dos, no se guarda nada.
 */
export function llegeixMercabarna(html: string): ResultatMercabarna {
  const d = html.match(/(?:Estad[ií]stiques de preus del dia|Estad[ií]sticas de precios del d[ií]a)\s*(\d{1,2})-(\d{1,2})-(\d{4})/i);
  if (!d) throw new Error("sense_data");
  const data = `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
  const t = html.match(/<table[^>]*class="[^"]*estadistiques[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (!t) throw new Error("sense_taula");
  const cos = t[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? t[1];
  const files: FilaMercabarna[] = [];
  for (const tr of cos.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const th = tr[1].match(/<th[^>]*>([\s\S]*?)<\/th>/i);
    if (!th) continue;
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => netejaCella(x[1]));
    if (tds.length < 3) continue;
    const nom = netejaCella(th[1]);
    if (!nom) continue;
    files.push({ nom, dominant: numeroCella(tds[0]), maxim: numeroCella(tds[1]), minim: numeroCella(tds[2]) });
  }
  if (files.length === 0) throw new Error("sense_taula");
  return { data, files };
}

/** Las observaciones de un día de Mercabarna: el precio dominante (o la media de máx. y mín.). */
export function observatsMercabarna(r: ResultatMercabarna): Observat[] {
  const [any, mes, dia] = r.data.split("-").map(Number);
  const out: Observat[] = [];
  for (const f of r.files) {
    const valor = f.dominant ?? (f.maxim !== null && f.minim !== null ? (f.maxim + f.minim) / 2 : null);
    if (valor === null || valor <= 0) continue;
    const unitat = UNITATS_MERCABARNA[f.nom.toUpperCase()] ?? "€/kg";
    const factor = factorEurKg(unitat);
    out.push({
      codi_font: null, nom_font: f.nom, exercici: any, mes, dia,
      valor_original: valor, unitat, eur_kg: factor === null ? null : arrodoneix(valor * factor),
      valor_max: f.maxim, valor_min: f.minim,
    });
  }
  return out;
}

/** La fecha que dice la exportación CSV de Mercabarna («"Fecha: 07-03-2024"»), en AAAA-MM-DD. */
export function dataExportMercabarna(csv: string): string | null {
  const m = csv.match(/Fecha:\s*(\d{1,2})-(\d{1,2})-(\d{4})/i);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/**
 * ¿La exportación CSV está caducada? Es la trampa conocida (17-11-2026): el CSV devuelve
 * siempre el 07-03-2024. Sin fecha, o con más de `maxDies` días respecto a `avui`, sí.
 */
export function exportMercabarnaCaducat(csv: string, avui: string, maxDies = 7): boolean {
  const d = dataExportMercabarna(csv);
  if (!d) return true;
  const dies = (Date.parse(`${avui}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000;
  return !(dies >= 0 && dies <= maxDies);
}

// ---------------------------------------------------------------------------
// Nombres: proponer equivalencias (ca/es, sin acentos ni mayúsculas)
// ---------------------------------------------------------------------------

/** «Col de Brussel·les» → «col de brusselles»; «MANZANA ROJA » → «manzana roja». */
export function normalitzaNom(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[·.]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñç]+/g, " ")
    .replace(/ñ/g, "n")
    .replace(/ç/g, "c")
    .trim();
}

/** Singular aproximado: «manzanas» → «manzana», «melocotones» → «melocoton», «espinacs» → «espinac». */
function arrel(w: string): string {
  if (w.length > 5 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

const PARAULES_BUIDES = new Set(["de", "del", "la", "el", "per", "a", "en", "i", "y", "con", "sin", "tipus", "consum", "fresc"]);

function paraules(s: string): string[] {
  return normalitzaNom(s).split(" ").filter((w) => w && !PARAULES_BUIDES.has(w)).map(arrel);
}

export interface NomFont {
  font: FontPreus;
  codi_font: string | null;
  nom_font: string;
}

/**
 * Puntúa los nombres de las fuentes contra los nombres del producto (catalán y castellano):
 * 3 = el mismo nombre; 2 = la primera palabra coincide (o una empieza por la otra, con 4
 * letras o más); 1 = comparten alguna palabra. Devuelve solo los que puntúan, de más a menos.
 */
export function coincidencies<T extends NomFont>(nomsProducte: readonly string[], candidats: readonly T[]): (T & { punts: number })[] {
  const objectius = nomsProducte.map((n) => n?.trim()).filter(Boolean) as string[];
  const out: (T & { punts: number })[] = [];
  for (const c of candidats) {
    const nc = normalitzaNom(c.nom_font);
    const pc = paraules(c.nom_font);
    let punts = 0;
    for (const o of objectius) {
      const no = normalitzaNom(o);
      const po = paraules(o);
      if (!no || pc.length === 0 || po.length === 0) continue;
      if (no === nc) { punts = Math.max(punts, 3); continue; }
      const [a, b] = [po[0], pc[0]];
      const prefix = Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a));
      if (a === b || prefix) { punts = Math.max(punts, 2); continue; }
      if (po.some((w) => w.length >= 4 && pc.includes(w))) punts = Math.max(punts, 1);
    }
    if (punts > 0) out.push({ ...c, punts });
  }
  return out.sort((x, y) => y.punts - x.punts || x.nom_font.localeCompare(y.nom_font));
}
