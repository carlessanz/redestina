// El catálogo de CAUSAS y SUBCAUSAS (fase B del punto 3, fila 3.6 del Excel de la Fundació,
// 17-11-2026; migración `20270529100000`): el mismo para la oferta y para el Diagnòstic operatiu.
//
// MÓDULO HOJA (§7, `tests/puresa.test.ts`): sin red, sin `Deno.` y sin imports. Lo usan:
//   · `crear-oferta` (el catálogo que sirve el descriptor, la validación de la subcausa);
//   · el intake de WhatsApp (`intake.ts`: solo pregunta la CATEGORÍA, en una lista de 7 filas);
//   · el panel (`src/lib/causes.ts` lo reexporta: el selector agrupado de la oferta, el de
//     edición y el del diagnóstico).
//
// La base es la fuente: `causas` (C1…C7 activas, en `orden`; las 8 de antes, inactivas) y
// `subcausas` (`C<n>.<m>`). Aquí solo viven las formas, las funciones que las agrupan y lo que
// la base no puede saber: el título CORTO de cada categoría para una fila de lista de WhatsApp
// (≤ 24 caracteres el título, ≤ 72 la descripción; `tests/causes.test.ts`).

/** Una subcausa del catálogo. */
export interface SubcausaCataleg {
  codigo: string;
  nombre: string;
  nombre_es: string | null;
  /** false = ya no se ofrece para elegir (solo con `nomesActives = false`). */
  activa?: boolean;
}

/** Una causa (categoría) con sus subcausas, en orden. */
export interface CausaAmbSubcauses {
  codigo: string;
  nombre: string;
  nombre_es: string | null;
  /** false = una de las causas de antes (CE, EX…): se lee, no se elige. */
  activa?: boolean;
  subcausas: SubcausaCataleg[];
}

/** Una fila de `causas` tal como la lee quien agrupa. */
export interface FilaCausa {
  codigo: string;
  nombre: string | null;
  nombre_es?: string | null;
  activa?: boolean | null;
  orden?: number | null;
}

/** Una fila de `subcausas` tal como la lee quien agrupa. */
export interface FilaSubcausa {
  codigo: string;
  causa_codigo: string;
  nombre: string;
  nombre_es?: string | null;
  orden?: number | null;
  activa?: boolean | null;
}

/** Lo que admite una fila de lista de WhatsApp (los mismos topes que `camposOferta.ts`). */
export const MAX_TITOL_FILA = 24;
export const MAX_DESC_FILA = 72;

/**
 * Las categorías en WhatsApp: título corto (el nombre completo no cabe en 24 caracteres en tres
 * de las siete) y una descripción que dice qué entra en ella. El bot habla en catalán.
 */
export const CAUSES_WHATSAPP: Record<string, { titulo: string; descripcion: string }> = {
  C1: { titulo: "Oferta i planificació", descripcion: "Excés de producció, previsió errònia o desajust amb les vendes" },
  C2: { titulo: "Demanda/comercialització", descripcion: "Sense compradors, comandes cancel·lades o sense canals alternatius" },
  C3: { titulo: "Preu i rendibilitat", descripcion: "Preu insuficient o costos superiors al valor recuperable" },
  C4: { titulo: "Qualitat i requisits", descripcion: "Qualitat i requisits comercials: estètica, calibre, producte malmès" },
  C5: { titulo: "Capacitat operativa", descripcion: "Manca de personal, de capacitat o d'equipament" },
  C6: { titulo: "Logística i conservació", descripcion: "Transport, emmagatzematge o conservació" },
  C7: { titulo: "Factors externs", descripcion: "Factors externs i sanitaris: clima, plagues, salubritat" },
};

const ordre = (o: number | null | undefined) => (typeof o === "number" ? o : Number.MAX_SAFE_INTEGER);

/**
 * Las causas con sus subcausas, en el orden del catálogo. Con `nomesActives` (lo que se ofrece
 * para ELEGIR), solo las activas y, dentro, solo las subcausas activas; una causa activa sin
 * ninguna subcausa activa también sale (WhatsApp elige la categoría). Lo que no tiene nombre no
 * se descarta: sale con el código.
 */
export function agrupaCauses(
  causas: readonly FilaCausa[],
  subcausas: readonly FilaSubcausa[],
  nomesActives = true,
): CausaAmbSubcauses[] {
  const actiu = (v: boolean | null | undefined) => !nomesActives || v !== false;
  return [...causas]
    .filter((c) => actiu(c.activa))
    .sort((a, b) => ordre(a.orden) - ordre(b.orden) || a.codigo.localeCompare(b.codigo))
    .map((c) => ({
      codigo: c.codigo,
      nombre: c.nombre || c.codigo,
      nombre_es: c.nombre_es ?? null,
      activa: c.activa !== false,
      subcausas: subcausas
        .filter((s) => s.causa_codigo === c.codigo && actiu(s.activa))
        .sort((a, b) => ordre(a.orden) - ordre(b.orden) || a.codigo.localeCompare(b.codigo))
        .map((s) => ({
          codigo: s.codigo, nombre: s.nombre || s.codigo, nombre_es: s.nombre_es ?? null, activa: s.activa !== false,
        })),
    }));
}

/** La subcausa de un código y su causa, si está en el catálogo dado. */
export function trobaSubcausa(
  cataleg: readonly CausaAmbSubcauses[],
  codi: string | null | undefined,
): { causa: CausaAmbSubcauses; subcausa: SubcausaCataleg } | null {
  if (!codi) return null;
  for (const causa of cataleg) {
    const subcausa = causa.subcausas.find((s) => s.codigo === codi);
    if (subcausa) return { causa, subcausa };
  }
  return null;
}

/**
 * Por qué no vale la subcausa de una oferta del panel, o null si vale. `subcausa` es lo que dice
 * la base del código recibido (null si no existe); `esCausa`, si el código es el de una causa
 * (una categoría a secas o una causa vieja: falta elegir la subcausa).
 */
export function motiuSubcausa(
  valor: unknown,
  subcausa: { activa: boolean | null } | null,
  esCausa: boolean,
): "subcausa_obligatoria" | "subcausa_invalida" | null {
  const v = typeof valor === "string" ? valor.trim() : "";
  if (!v || esCausa) return "subcausa_obligatoria";
  if (!subcausa || subcausa.activa === false) return "subcausa_invalida";
  return null;
}

/** El nombre en el idioma (catalán por defecto; el otro si falta). */
export function nomEnLlengua(x: { nombre: string; nombre_es?: string | null }, lang: string): string {
  return lang === "es" ? x.nombre_es || x.nombre : x.nombre;
}

/**
 * Las filas de la lista de WhatsApp: una por categoría ACTIVA, con su título corto y su
 * descripción (si una categoría nueva no tiene entrada en `CAUSES_WHATSAPP`, sale su nombre
 * recortado). El `id` es `causa:<codigo>`: lo que el intake guarda es el código de la categoría.
 */
export function filesCausaWhatsApp(
  cataleg: readonly CausaAmbSubcauses[],
): { id: string; titulo: string; descripcion: string }[] {
  return cataleg.map((c) => {
    const w = CAUSES_WHATSAPP[c.codigo];
    return {
      id: `causa:${c.codigo}`,
      titulo: (w?.titulo ?? c.nombre).slice(0, MAX_TITOL_FILA),
      descripcion: (w?.descripcion ?? (c.nombre.length > MAX_TITOL_FILA ? c.nombre : "")).slice(0, MAX_DESC_FILA),
    };
  });
}

/** «Categoria — Subcausa» (la línea CAUSA de la oferta), o solo la categoría. */
export function textCausa(causa: string | null | undefined, subcausa?: string | null): string {
  const c = (causa ?? "").trim();
  const s = (subcausa ?? "").trim();
  return c && s ? `${c} — ${s}` : c || s;
}
