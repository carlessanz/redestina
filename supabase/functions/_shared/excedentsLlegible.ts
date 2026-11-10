// Los EXCEDENTES del diagnóstico en LECTURA (Plan 2, A3 `20270522100000`): de la clave
// `excedents` de `diagnostic_datos()` (y de `expedient_datos().diagnostic.excedents`, misma
// forma) a textos y filas legibles.
//
// MÓDULO HOJA (§7, `tests/puresa.test.ts`): sin red, sin `Deno.` y sin imports. Lo usan los
// sitios que tienen que contar exactamente lo mismo:
//   · el resumen del diagnóstico en pantalla (`ResumDiagnostic`, vía `src/lib/excedentsLlegible.ts`,
//     con la `t()` de `src/lib/i18n.tsx`);
//   · el PDF del diagnóstico bajo demanda (`_shared/pdf/render/diagnostic.ts`, función
//     `diagnostic-pdf`) y la sección «Diagnòstic operatiu» del expediente
//     (`_shared/pdf/render/expedient.ts`, función `generar-documento`), con
//     `traduccioExcedents(lang)` como `t()`.
// Pruebas en `tests/excedentsLlegible.test.ts` (paridad de `ETIQUETES_EXCEDENTS` con el
// diccionario de la pantalla, listas cerradas = los CHECK de la migración).
//
// Las listas cerradas, en el MISMO orden que los CHECK de `diagnostic_excedents` y
// `diagnostic_accions`; el destino de interés y el de una acción son las modalidades de las
// ofertas (`od.mod_*`), y la causa es el código del catálogo `causas` (el de las ofertas, D7).

export const FREQUENCIES = ["puntual", "estacional", "mensual", "setmanal", "varies_setmana"] as const;
export const GESTIONS = [
  "venda_alternativa",
  "donacio",
  "transformacio",
  "altres_aprofitaments",
  "residu",
  "altres",
] as const;
export const DESTINS = ["donacio", "venda", "maquila"] as const;
export const ESTATS_ACCIO = ["pendent", "en_curs", "feta", "descartada"] as const;

export type Frequencia = (typeof FREQUENCIES)[number];
export type GestioActual = (typeof GESTIONS)[number];
export type DestiExcedent = (typeof DESTINS)[number];
export type EstatAccio = (typeof ESTATS_ACCIO)[number];

export type LlenguaExcedents = "ca" | "es";
export type TraduccioExcedents = (clau: string, vars?: Record<string, string | number>) => string;

/** Una acción (una por destino, decisión b). */
export interface AccioExcedentLlegible {
  id: string;
  desti: string;
  descripcio: string;
  estat: string;
  /** Nota de seguimiento (visible para la organización). */
  notes: string | null;
  feta_at: string | null;
  actualitzat_at: string | null;
}

/** Un excedente: producto × causa del catálogo `causas`. */
export interface CausaExcedentLlegible {
  id: string;
  /** Código del catálogo `causas` (CE, CL, EX…). */
  causa: string;
  causa_nom: { ca: string; es: string } | null;
  frequencia: string | null;
  /** Kilos aproximados cada vez (P7). */
  volum_kg: number | null;
  gestio_actual: string[];
  destins: string[];
  detall: string | null;
  accions: AccioExcedentLlegible[];
}

/** Un bloque por producto (principal hoy, o conservado si ya no lo es: decisión a). */
export interface BlocExcedentsLlegible {
  producte: string;
  principal: boolean;
  /** Posición (desde 1) en `productes_principals`; null si ya no es principal. */
  ordre: number | null;
  sense_excedent: boolean;
  observacions: string | null;
  causes: CausaExcedentLlegible[];
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const textONull = (v: unknown): string | null => text(v) || null;
const llista = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter((x) => x !== "") : []);
const objecte = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
function nombreONull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lo que llega del JSON, normalizado y sin lanzar: lo que no es un bloque (o no tiene
 * producto) se descarta; listas ausentes = `[]`; kilos como número. El orden se respeta
 * (ya viene ordenado de `diagnostic_excedents_json()`).
 */
export function blocsExcedents(v: unknown): BlocExcedentsLlegible[] {
  if (!Array.isArray(v)) return [];
  const out: BlocExcedentsLlegible[] = [];
  for (const b of v) {
    const o = objecte(b);
    const producte = text(o?.producte);
    if (!o || !producte) continue;
    const causes: CausaExcedentLlegible[] = [];
    for (const c of Array.isArray(o.causes) ? o.causes : []) {
      const oc = objecte(c);
      const causa = text(oc?.causa);
      if (!oc || !causa) continue;
      const nom = objecte(oc.causa_nom);
      const accions: AccioExcedentLlegible[] = [];
      for (const a of Array.isArray(oc.accions) ? oc.accions : []) {
        const oa = objecte(a);
        const descripcio = text(oa?.descripcio);
        if (!oa || !descripcio) continue;
        accions.push({
          id: text(oa.id),
          desti: text(oa.desti),
          descripcio,
          estat: text(oa.estat) || "pendent",
          notes: textONull(oa.notes),
          feta_at: textONull(oa.feta_at),
          actualitzat_at: textONull(oa.actualitzat_at),
        });
      }
      causes.push({
        id: text(oc.id),
        causa,
        causa_nom: nom ? { ca: text(nom.ca), es: text(nom.es) } : null,
        frequencia: textONull(oc.frequencia),
        volum_kg: nombreONull(oc.volum_kg),
        gestio_actual: llista(oc.gestio_actual),
        destins: llista(oc.destins),
        detall: textONull(oc.detall),
        accions,
      });
    }
    out.push({
      producte,
      principal: o.principal === true,
      ordre: nombreONull(o.ordre),
      sense_excedent: o.sense_excedent === true,
      observacions: textONull(o.observacions),
      causes,
    });
  }
  return out;
}

/** ¿Hay algún bloque de excedentes? Si no, el PDF cae a las respuestas del cuestionario v3. */
export function teBlocs(excedents: unknown): boolean {
  return blocsExcedents(excedents).length > 0;
}

/** Una clave que no está en el diccionario devuelve el CÓDIGO, nunca «dexc.…» crudo. */
function opcio(t: TraduccioExcedents, clau: string, codi: string): string {
  const s = t(clau);
  return s === clau ? codi : s;
}

/** El nombre de la causa en el idioma (el del catálogo; si falta, el otro; si no, el código). */
export function nomCausa(
  c: Pick<CausaExcedentLlegible, "causa" | "causa_nom">,
  lang: LlenguaExcedents,
): string {
  const n = c.causa_nom;
  return (lang === "es" ? n?.es || n?.ca : n?.ca || n?.es) || c.causa;
}

export function textFrequencia(f: string | null | undefined, t: TraduccioExcedents): string {
  const codi = text(f);
  return codi ? opcio(t, `dexc.freq_${codi}`, codi) : "";
}

export function textGestio(gestio: readonly string[] | null | undefined, t: TraduccioExcedents): string {
  return llista(gestio).map((g) => opcio(t, `dexc.gestio_${g}`, g)).join(", ");
}

/** Un destino (= modalidad de las ofertas), con la etiqueta de las ofertas. */
export function textDesti(d: string | null | undefined, t: TraduccioExcedents): string {
  const codi = text(d);
  return codi ? opcio(t, `od.mod_${codi}`, codi) : "";
}

export function textDestins(destins: readonly string[] | null | undefined, t: TraduccioExcedents): string {
  return llista(destins).map((d) => textDesti(d, t)).join(", ");
}

export function textEstatAccio(estat: string | null | undefined, t: TraduccioExcedents): string {
  const codi = text(estat);
  return codi ? opcio(t, `dexc.estat_${codi}`, codi) : "";
}

/** «500» / «1.250,5» (punto de miles); vacío si no hay kilos. Sin unidad: la pone quien pinta. */
export function textVolum(kg: number | null | undefined, lang: LlenguaExcedents): string {
  if (typeof kg !== "number" || !Number.isFinite(kg)) return "";
  return new Intl.NumberFormat(lang === "es" ? "es-ES" : "ca-ES", { maximumFractionDigits: 2 }).format(kg);
}

/** «Tomàquet» o, si ya no es principal, «Tomàquet · ja no és principal». */
export function titolBloc(b: Pick<BlocExcedentsLlegible, "producte" | "principal">, t: TraduccioExcedents): string {
  if (b.principal) return b.producte;
  const marca = t("dexc.ja_no_principal");
  return `${b.producte} · ${marca.charAt(0).toLocaleLowerCase()}${marca.slice(1)}`;
}

/** Una causa lista para una fila: cada celda ya en texto (vacía si no hay dato). */
export interface FilaCausaExcedent {
  /** Código del catálogo. */
  codi: string;
  causa: string;
  detall: string;
  frequencia: string;
  volum: string;
  gestio: string;
  destins: string;
}

export function filaCausa(
  c: CausaExcedentLlegible,
  t: TraduccioExcedents,
  lang: LlenguaExcedents,
): FilaCausaExcedent {
  return {
    codi: c.causa,
    causa: nomCausa(c, lang),
    detall: text(c.detall),
    frequencia: textFrequencia(c.frequencia, t),
    volum: textVolum(c.volum_kg, lang),
    gestio: textGestio(c.gestio_actual, t),
    destins: textDestins(c.destins, t),
  };
}

/** Las causas de un bloque, en filas. */
export function filesCausa(
  b: BlocExcedentsLlegible,
  t: TraduccioExcedents,
  lang: LlenguaExcedents,
): FilaCausaExcedent[] {
  return b.causes.map((c) => filaCausa(c, t, lang));
}

/** «Excedent» o, con detalle, «Excedent\nDetall: …» (una celda de tabla en el PDF). */
export function celaCausa(f: Pick<FilaCausaExcedent, "causa" | "detall">, t: TraduccioExcedents): string {
  return f.detall ? `${f.causa}\n${t("dexc.detall")}: ${f.detall}` : f.causa;
}

/** Una acción lista para una fila. */
export interface FilaAccioExcedent {
  id: string;
  producte: string;
  causa: string;
  /** Código del destino (donacio · venda · maquila). */
  destiCodi: string;
  desti: string;
  descripcio: string;
  /** Nota de seguimiento, tal cual (vacía si no hay). */
  notes: string;
  /** Código del estado (pendent · en_curs · feta · descartada). */
  estatCodi: string;
  estat: string;
}

/** Las acciones de un bloque, por causa (código) y destino (donacio · venda · maquila). */
export function filesAccions(
  b: BlocExcedentsLlegible,
  t: TraduccioExcedents,
  lang: LlenguaExcedents,
): FilaAccioExcedent[] {
  const out: FilaAccioExcedent[] = [];
  for (const c of b.causes) {
    for (const a of c.accions) {
      out.push({
        id: a.id,
        producte: b.producte,
        causa: nomCausa(c, lang),
        destiCodi: a.desti,
        desti: textDesti(a.desti, t),
        descripcio: a.descripcio,
        notes: text(a.notes),
        estatCodi: a.estat,
        estat: textEstatAccio(a.estat, t),
      });
    }
  }
  return out;
}

/** «Acció» o, con nota de seguimiento, «Acció — Seguiment: …» (una celda de tabla en el PDF). */
export function celaAccio(f: Pick<FilaAccioExcedent, "descripcio" | "notes">, t: TraduccioExcedents): string {
  return f.notes ? `${f.descripcio} — ${t("dexc.seguiment")}: ${f.notes}` : f.descripcio;
}

/**
 * Las etiquetas que piden las funciones de arriba y los PDF, para quien no tiene el
 * diccionario de la pantalla (Deno). 🔴 **Copia exacta de `src/lib/i18n.tsx`**:
 * `tests/excedentsLlegible.test.ts` falla si un texto difiere o si la pantalla gana una opción
 * (`dexc.freq_*`, `dexc.gestio_*`, `dexc.estat_*`) que aquí no está. Se cambian los dos a la vez.
 */
export const ETIQUETES_EXCEDENTS: Record<LlenguaExcedents, Record<string, string>> = {
  ca: {
    "dexc.titol": "Excedents",
    "dexc.sense_excedent": "Sense excedent",
    "dexc.ja_no_principal": "Ja no és principal",
    "dexc.causa": "Causa",
    "dexc.detall": "Detall",
    "dexc.frequencia": "Freqüència",
    "dexc.volum_kg": "Volum (kg)",
    "dexc.volum_nota": "Volum aproximat, cada vegada que es produeix l’excedent.",
    "dexc.gestio": "Gestió actual",
    "dexc.destins": "Destins d’interès",
    "dexc.observacions": "Observacions",
    "dexc.accions": "Accions",
    "dexc.accio": "Acció",
    "dexc.desti": "Destí",
    "dexc.estat": "Estat",
    "dexc.seguiment": "Seguiment",
    "dexc.respostes_anteriors": "Respostes del qüestionari anterior",
    "dexc.freq_puntual": "Puntual", "dexc.freq_estacional": "Estacional", "dexc.freq_mensual": "Mensual",
    "dexc.freq_setmanal": "Setmanal", "dexc.freq_varies_setmana": "Diverses vegades per setmana",
    "dexc.gestio_venda_alternativa": "Venda alternativa", "dexc.gestio_donacio": "Donació",
    "dexc.gestio_transformacio": "Transformació", "dexc.gestio_altres_aprofitaments": "Altres aprofitaments",
    "dexc.gestio_residu": "Residu", "dexc.gestio_altres": "Altres",
    "dexc.estat_pendent": "Pendent", "dexc.estat_en_curs": "En curs", "dexc.estat_feta": "Feta",
    "dexc.estat_descartada": "Descartada",
    "od.mod_donacio": "Donació", "od.mod_venda": "Venda", "od.mod_maquila": "Maquila",
  },
  es: {
    "dexc.titol": "Excedentes",
    "dexc.sense_excedent": "Sin excedente",
    "dexc.ja_no_principal": "Ya no es principal",
    "dexc.causa": "Causa",
    "dexc.detall": "Detalle",
    "dexc.frequencia": "Frecuencia",
    "dexc.volum_kg": "Volumen (kg)",
    "dexc.volum_nota": "Volumen aproximado, cada vez que se produce el excedente.",
    "dexc.gestio": "Gestión actual",
    "dexc.destins": "Destinos de interés",
    "dexc.observacions": "Observaciones",
    "dexc.accions": "Acciones",
    "dexc.accio": "Acción",
    "dexc.desti": "Destino",
    "dexc.estat": "Estado",
    "dexc.seguiment": "Seguimiento",
    "dexc.respostes_anteriors": "Respuestas del cuestionario anterior",
    "dexc.freq_puntual": "Puntual", "dexc.freq_estacional": "Estacional", "dexc.freq_mensual": "Mensual",
    "dexc.freq_setmanal": "Semanal", "dexc.freq_varies_setmana": "Varias veces por semana",
    "dexc.gestio_venda_alternativa": "Venta alternativa", "dexc.gestio_donacio": "Donación",
    "dexc.gestio_transformacio": "Transformación", "dexc.gestio_altres_aprofitaments": "Otros aprovechamientos",
    "dexc.gestio_residu": "Residuo", "dexc.gestio_altres": "Otros",
    "dexc.estat_pendent": "Pendiente", "dexc.estat_en_curs": "En curso", "dexc.estat_feta": "Hecha",
    "dexc.estat_descartada": "Descartada",
    "od.mod_donacio": "Donación", "od.mod_venda": "Venta", "od.mod_maquila": "Maquila",
  },
};

/** `t()` sobre `ETIQUETES_EXCEDENTS`: una clave que falte sale tal cual (y la prueba de paridad la caza). */
export function traduccioExcedents(lang: LlenguaExcedents): TraduccioExcedents {
  const dict = ETIQUETES_EXCEDENTS[lang];
  return (clau) => dict[clau] ?? clau;
}
