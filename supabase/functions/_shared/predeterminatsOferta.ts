// Lo que la ficha del productor PROPONE al abrir una oferta nueva (Plan 2, A4, 10-11-2026;
// Taula mestra 3.1/3.4, fila 2.5 «reutilitzar en crear ofertes»).
//
// Lo calcula el servidor (`GET /crear-oferta/campos`, clave `predeterminats`) desde la
// Operativa: el lugar de recogida PRINCIPAL, su primera franja horaria y el primer envase
// habitual que tiene equivalente en `FORMATS_ENTREGA`. El panel lo aplica solo a los huecos y
// lo marca «proposat des de la fitxa» (`src/lib/predeterminatsOferta.ts`).
//
// PURO y sin red, con pruebas en `tests/predeterminatsOferta.test.ts`.
//
// ⚠️ ENVASES → FORMATO: solo lo que significa lo mismo. `caixes` → `caixes`, `palets` →
//    `palet`. `granel`, `sacs` y `altres` no se traducen: proponer «Envasos de qui ho rep» o
//    «Altres» por un «a granel» sería inventar una respuesta que el productor no ha dado.

import type { Franja } from "./franja.ts";

export interface LlocPredeterminat {
  id: string;
  es_principal?: boolean | null;
  franges?: unknown;
}

export interface PredeterminatsOferta {
  /** `productor_ubicaciones.id` del lugar principal (o del único), o null. */
  ubicacio: string | null;
  /** La primera franja del lugar propuesto, o null. */
  horari: Franja | null;
  /** Un `FORMATS_ENTREGA[].id`, o null. */
  format_entrega: string | null;
}

/** Envase habitual (`productores.envasos_habituals`) → formato de entrega de la oferta. */
export const FORMAT_DE_ENVAS: Readonly<Record<string, string>> = {
  caixes: "caixes",
  palets: "palet",
};

const HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function primeraFranja(franges: unknown): Franja | null {
  if (!Array.isArray(franges)) return null;
  for (const f of franges) {
    if (!f || typeof f !== "object") continue;
    const { inici, fi } = f as Record<string, unknown>;
    if (typeof inici === "string" && typeof fi === "string" && HORA.test(inici) && HORA.test(fi) && inici < fi) {
      return { inici, fi };
    }
  }
  return null;
}

/**
 * Los valores propuestos. El lugar: el principal; si no hay ninguno marcado y solo hay uno,
 * ese (no hay duda de dónde se recoge). Con varios y ninguno principal, nada.
 */
export function predeterminatsDe(
  llocs: readonly LlocPredeterminat[],
  envasos: readonly string[] | null | undefined,
): PredeterminatsOferta {
  const lloc = llocs.find((l) => l.es_principal) ?? (llocs.length === 1 ? llocs[0] : null);
  const format = (envasos ?? []).map((e) => FORMAT_DE_ENVAS[e]).find(Boolean) ?? null;
  return {
    ubicacio: lloc?.id ?? null,
    horari: lloc ? primeraFranja(lloc.franges) : null,
    format_entrega: format,
  };
}

/** Los lugares con el principal primero (el resto, en el orden en que llegan). */
export function principalPrimer<T extends { es_principal?: boolean | null }>(llocs: readonly T[]): T[] {
  return [...llocs.filter((l) => l.es_principal), ...llocs.filter((l) => !l.es_principal)];
}

/** Máximo del título de una fila de lista de WhatsApp (= `MAX_TITULO_FILA_LISTA`). */
const MAX_TITOL_FILA = 24;
const HABITUAL = " (habitual)";

/**
 * El título de un lugar en la lista del intake (P5): el principal lleva «(habitual)» y, si no
 * cabe en los 24 caracteres de Meta, se recorta el nombre, nunca la marca.
 */
export function titolLlocLista(nom: string, principal: boolean): string {
  const net = nom.trim() || "Ubicació";
  if (!principal) return net.length > MAX_TITOL_FILA ? `${net.slice(0, MAX_TITOL_FILA - 1)}…` : net;
  const max = MAX_TITOL_FILA - HABITUAL.length;
  return `${net.length > max ? `${net.slice(0, max - 1)}…` : net}${HABITUAL}`;
}

// ---------------------------------------------------------------------------
// P5 (decidido por Carles el 10-11-2026): con un lugar principal, el intake de WhatsApp
// pregunta **«confirma el lugar o cámbialo»**. Nunca se salta la pregunta: el productor ve
// dónde se recogerá y lo confirma con un toque, o pide la lista completa.
// ---------------------------------------------------------------------------

/** Id del botón «Canvia el lloc»: no es una respuesta, es pedir la lista de lugares. */
export const ID_CANVIA_LLOC = "ubicacio:canvia";

/** El lugar principal, si lo hay (solo el marcado; con uno solo sin marcar, no se presupone). */
export function llocHabitual<T extends { es_principal?: boolean | null }>(llocs: readonly T[]): T | null {
  return llocs.find((l) => l.es_principal) ?? null;
}

/** El mensaje de botones que pide confirmar o cambiar el lugar habitual. */
export function preguntaLlocHabitual(
  lloc: { id: string; alias?: string | null; municipio?: string | null },
): { cos: string; botons: Array<{ id: string; titulo: string }> } {
  const nom = (lloc.alias ?? "").trim() || (lloc.municipio ?? "").trim() || "Ubicació";
  const mun = (lloc.municipio ?? "").trim();
  const on = mun && mun.toLowerCase() !== nom.toLowerCase() ? `${nom} (${mun})` : nom;
  return {
    cos: `On s'ha de recollir? El lloc habitual és *${on}*.\n\nEl confirmes o el canvies?`,
    // Meta limita el título de un botón a 20 caracteres.
    botons: [
      { id: `ubicacio:${lloc.id}`, titulo: "Sí, aquí" },
      { id: ID_CANVIA_LLOC, titulo: "Canvia el lloc" },
    ],
  };
}

/** Respuestas escritas que confirman el lugar habitual (quien escribe en vez de tocar el botón). */
const CONFIRMA_LLOC = new Set([
  "si", "si aqui", "aqui", "ok", "vale", "d acord", "dacord", "de acuerdo", "correcte", "correcto",
  "confirmo", "confirmat", "confirmado", "el mateix", "el mismo", "alli", "alla",
]);

/** ¿El texto confirma el lugar habitual? Sin acentos ni signos, en catalán o castellano. */
export function confirmaLlocHabitual(texto: string | null | undefined): boolean {
  const t = (texto ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[!¡.,;:·’'?¿]/g, " ").replace(/\s+/g, " ").trim();
  return CONFIRMA_LLOC.has(t);
}
