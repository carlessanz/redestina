// Las modalidades de una oferta, ahora en PLURAL (reunión del 05-10-2026, D2).
//
// Hasta esa fecha una oferta tenía UNA modalidad (`excedentes.modalitat`). La Fundació pidió
// que el productor pueda marcar varias —donació, venda y/o maquila— porque «muchos no tienen
// claro cuál es la mejor salida y nos contactan precisamente porque no lo saben». La
// definitiva de CADA canalización la elige el receptor al mostrar interés y la confirma el
// equipo al aprobar; queda en `canalizaciones.valorizacion`, que ya existía.
//
// Este módulo es PURO y sin red, por dos motivos: lo usan el panel (`crear-oferta`), el bot
// (`intake.ts`), el texto de la oferta y el diálogo de respuesta de WhatsApp, y la respuesta
// llega con formas distintas según el canal —un string del bot de antes, un array del panel
// nuevo, `"totes"` de la cuarta fila de la lista de WhatsApp—. Normalizar en un solo sitio es
// lo que impide que cada consumidor entienda una cosa distinta.
//
// ⚠️ Hay una COPIA en `src/lib/modalitats.ts` (el navegador no importa Deno). Si cambia el
//    orden o el vocabulario, cambian las dos; lo vigila `tests/modalitats.test.ts`.

export const MODALITATS_IDS = ["donacio", "venda", "maquila"] as const;
export type Modalitat = typeof MODALITATS_IDS[number];

/** El id que significa «todas» en la lista de WhatsApp. No se guarda nunca tal cual. */
export const TOTES = "totes";

const ETIQUETA: Record<Modalitat, string> = {
  donacio: "Donació",
  venda: "Venda",
  maquila: "Maquila",
};

export function esModalitat(v: unknown): v is Modalitat {
  return typeof v === "string" && (MODALITATS_IDS as readonly string[]).includes(v);
}

/**
 * Lo que sea que llegue, como lista ordenada y sin repetidos de modalidades válidas.
 * El ORDEN es siempre el canónico (donació, venda, maquila), no el de llegada: así la
 * «principal» (`principal()`) es estable y dos ofertas con las mismas modalidades se ven igual.
 * Lo que no se reconoce se descarta en silencio: la validación de «al menos una» la hace quien
 * llama, con su propio mensaje.
 */
export function modalitatsDe(valor: unknown): Modalitat[] {
  if (valor === TOTES) return [...MODALITATS_IDS];
  const crus: unknown[] = Array.isArray(valor) ? valor : valor == null || valor === "" ? [] : [valor];
  const hi = new Set(crus.map((v) => String(v).trim().toLowerCase()));
  if (hi.has(TOTES)) return [...MODALITATS_IDS];
  return MODALITATS_IDS.filter((m) => hi.has(m));
}

/**
 * La modalidad «principal», la que se escribe en `excedentes.modalitat` para todo lo que todavía
 * lee una sola (el texto de un documento antiguo, `priorizar-entidades` de antes…). Es la PRIMERA
 * en orden canónico, así que con la donación marcada siempre es la donación — que es la línea
 * core del servicio (§1bis). null si no hay ninguna.
 */
export function principal(ms: readonly Modalitat[]): Modalitat | null {
  return MODALITATS_IDS.find((m) => ms.includes(m)) ?? null;
}

/** «Donació», «Donació o venda», «Donació, venda o maquila». Vacío si no hay ninguna. */
export function etiquetaModalitats(ms: readonly Modalitat[]): string {
  const ordenades = MODALITATS_IDS.filter((m) => ms.includes(m));
  const noms = ordenades.map((m, i) => (i === 0 ? ETIQUETA[m] : ETIQUETA[m].toLowerCase()));
  if (noms.length <= 1) return noms[0] ?? "";
  return `${noms.slice(0, -1).join(", ")} o ${noms[noms.length - 1]}`;
}

/** ¿Incluye alguna modalidad con precio (venda o maquila)? Es lo que decide pedir el preu mínim. */
export function ambPreu(ms: readonly Modalitat[]): boolean {
  return ms.includes("venda") || ms.includes("maquila");
}
