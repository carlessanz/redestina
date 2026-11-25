// Ofertas MULTIPRODUCTO (proceso 3.3, fase 6a, 25-11-2026): la parte pura del alta con varios
// productos. Módulo «hoja» (§7): sin red ni Deno, lo prueba `tests/disponibilitat.test.ts` y el
// panel lo puede importar para decir lo mismo que el servidor.
//
// 🔴 Principio: cada producto sigue siendo UNA oferta (`excedentes`) con su `E-…`; la
//    disponibilidad (`disponibilitats`, código `D-…`) solo los agrupa. Por eso el alta de un grupo
//    no inventa nada: parte el cuerpo en N juegos de datos con la MISMA forma que el alta de un
//    solo producto, y cada uno pasa por `filaDeDades()` y `textoOfertaDeDades()` como siempre.
//
// Forma del cuerpo (`crear-oferta`, alta y esborrany): `datos` lleva lo COMÚN una vez (lugar,
// fechas, días y franja, modalidades, causa/subcausa, fotos, espigolada, envases, observaciones…)
// y `datos.productes` la lista de productos:
//
//   productes: [{ producte, kg, varietat?, familia?, caixes?, preu_minim?, cost_kg? }, …]
//
// Por producto van SOLO las claves de `CLAUS_PER_PRODUCTE`: `producte` y `kg` (obligatorios al
// publicar), y como ajuste opcional la variedad, la familia, el número de cajas o palets, el precio
// mínimo (con venta) y el coste declarado (con donación). Una clave de producto ausente (o `null`,
// o vacía) toma el valor común de `datos`; cualquier otra clave de la línea se descarta.
//
//   · Sin `productes`, o con `[]`: el cuerpo de siempre, intacto (un solo producto).
//   · Con UN elemento: se funde con lo común y es exactamente un alta de un producto.
//   · Con DOS o más (hasta `MAX_PRODUCTES`): una disponibilidad.

/** Las claves que puede llevar cada producto de una disponibilidad. El resto es común. */
export const CLAUS_PER_PRODUCTE = [
  "producte", "varietat", "kg", "familia", "caixes", "preu_minim", "cost_kg",
] as const;

/**
 * Cuántos productos como mucho en una disponibilidad: cada uno es un `E-…`, un texto y una fila,
 * y la petición tiene 2 s de CPU. Diez es más que cualquier caso real (el formulario añade de uno
 * en uno).
 */
export const MAX_PRODUCTES = 10;

export type CodiErrorProductes =
  | "productes_invalid"
  | "massa_productes"
  | "falta_producte"
  | "producte_repetit";

export type Agrupacio =
  /** Un solo producto: `dades` es lo que se publica (el mismo objeto si no había `productes`). */
  | { tipus: "un"; dades: Record<string, unknown> }
  /**
   * Una disponibilidad: `comuns` sin `productes`, `linies` cada producto normalizado (solo sus
   * claves) y `dades` lo común fundido con cada producto, en el orden en que llegaron.
   */
  | {
    tipus: "grup";
    comuns: Record<string, unknown>;
    linies: Record<string, unknown>[];
    dades: Record<string, unknown>[];
  }
  /** `index` = el producto que falla (desde 0), si es uno concreto. */
  | { tipus: "error"; code: CodiErrorProductes; index?: number };

function buit(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/** Una línea de producto con solo sus claves y sin vacíos. Null si no es un objeto. */
export function liniaProducte(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const fora: Record<string, unknown> = {};
  for (const k of CLAUS_PER_PRODUCTE) {
    if (!buit(o[k])) fora[k] = typeof o[k] === "string" ? (o[k] as string).trim() : o[k];
  }
  return fora;
}

/** Lo común con un producto encima: lo que el producto dice manda; lo que calla, lo común. */
export function fonLinia(
  comuns: Record<string, unknown>,
  linia: Record<string, unknown>,
): Record<string, unknown> {
  return { ...comuns, ...linia };
}

/** Producto + variedad normalizados, para no publicar dos veces lo mismo en un grupo. */
function clau(l: Record<string, unknown>): string {
  const n = (v: unknown) => String(v ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  return `${n(l.producte)}|${n(l.varietat)}`;
}

/**
 * Parte el cuerpo del alta (`datos`) en lo que se publica: un producto o una disponibilidad. Pura.
 *
 * ⚠️ Sin `productes` devuelve el MISMO objeto, sin copiarlo: el camino de un solo producto no
 *    puede notar que este módulo existe.
 */
export function agrupaProductes(d: Record<string, unknown>): Agrupacio {
  if (!("productes" in d) || d.productes === undefined || d.productes === null) {
    return { tipus: "un", dades: d };
  }
  if (!Array.isArray(d.productes)) return { tipus: "error", code: "productes_invalid" };
  const { productes, ...comuns } = d;
  const crus = productes as unknown[];
  if (crus.length === 0) return { tipus: "un", dades: comuns };
  if (crus.length > MAX_PRODUCTES) return { tipus: "error", code: "massa_productes" };

  const linies: Record<string, unknown>[] = [];
  const vistes = new Set<string>();
  for (let i = 0; i < crus.length; i++) {
    const l = liniaProducte(crus[i]);
    if (!l) return { tipus: "error", code: "productes_invalid", index: i };
    if (buit(l.producte)) return { tipus: "error", code: "falta_producte", index: i };
    const k = clau(l);
    if (vistes.has(k)) return { tipus: "error", code: "producte_repetit", index: i };
    vistes.add(k);
    linies.push(l);
  }

  if (linies.length === 1) return { tipus: "un", dades: fonLinia(comuns, linies[0]) };
  return { tipus: "grup", comuns, linies, dades: linies.map((l) => fonLinia(comuns, l)) };
}

// El texto y el enlace viven en `textOferta.ts` (la hoja de los textos de oferta); se reexportan
// para quien parta de aquí.
export { enllacDisponibilitat, llistaProductes } from "./textOferta.ts";
