// UNA sola regla para las modalidades de una oferta y la opción «Espigolada», la misma en el
// ALTA y en la EDICIÓN (proceso 3.4; fase 3 del plan de noviembre de 2026). Antes vivía dentro
// de `FormulariNovaOferta` y solo en el alta: al editar no había forma de pedir la espigolada.
//
// Qué dice la regla (la misma que impone el servidor: `dadesAmbEspigolada()` en el alta y
// `editar_oferta()`, 20270617100300, al editar):
//   · «Espigolada» SOLO aparece si el producto sigue en el campo (`producte_al_camp = 'si'`):
//     sin producto en el campo no hay nada que espigolar;
//   · NO es una modalidad más: es una DONACIÓN con el producto en el campo. Marcarla deja la
//     modalidad en `['donacio']` y desmarca las demás; marcar cualquier modalidad la desmarca;
//   · si el producto deja de estar en el campo, la espigolada se desmarca sola (lo mismo hace
//     la RPC con `producte_al_camp: false` y sin decir nada de la espigolada).
//
// Puro (sin React ni Supabase) para poder probarlo desde Vitest (`tests/modalitatsOferta.test.ts`).

import { modalitatsDe } from './modalitats'

type Datos = Record<string, unknown>

/** ¿El producto sigue en el campo? El formulario guarda `'si'`/`'no'`; la fila, un boolean. */
export function producteAlCamp(valor: unknown): boolean {
  return valor === true || valor === 'si'
}

/** ¿Se ofrece «Espigolada» con estas respuestas? Solo con el producto en el campo. */
export function ofereixEspigolada(d: Datos): boolean {
  return producteAlCamp(d.producte_al_camp)
}

/** ¿Está marcada la espigolada? Solo cuenta si además se ofrece (producto en el campo). */
export function espigoladaMarcada(d: Datos): boolean {
  return d.espigolada === true && ofereixEspigolada(d)
}

/** Lo que cambia al tocar una casilla de modalidad: `modalitat` y, si hacía falta, `espigolada`. */
export function triaModalitat(
  d: Datos,
  opcions: readonly string[],
  id: string,
  on: boolean,
): { modalitat: string[]; espigolada?: false } {
  const esp = espigoladaMarcada(d)
  const triades = modalitatsDe(d.modalitat) as string[]
  // Con la espigolada marcada, las casillas se ven vacías: tocar una empieza de cero.
  const modalitat = opcions.filter((x) => (x === id ? on : !esp && triades.includes(x)))
  return esp ? { modalitat, espigolada: false } : { modalitat }
}

/** Lo que cambia al marcar o desmarcar «Espigolada». Marcarla es donación y producto en el campo. */
export function triaEspigolada(on: boolean): { espigolada: boolean; modalitat: string[]; producte_al_camp?: 'si' } {
  return on
    ? { espigolada: true, modalitat: ['donacio'], producte_al_camp: 'si' }
    : { espigolada: false, modalitat: [] }
}

/**
 * Las respuestas con la regla aplicada tras cambiar `clau`: si el producto deja de estar en el
 * campo, la espigolada se desmarca (las modalidades se quedan como estaban: donación). Devuelve
 * el mismo objeto si no hay nada que corregir.
 */
export function ambReglaEspigolada(d: Datos): Datos {
  if (d.espigolada === true && !ofereixEspigolada(d)) return { ...d, espigolada: false }
  return d
}

/**
 * ¿Es una oferta de espigolada? La columna generada `tipus_operacio` manda (20270617100000);
 * si la consulta no la trae, se deduce igual que ella (pedida o de una jornada heredada).
 */
export function esOfertaEspigolada(o: {
  tipus_operacio?: string | null
  espigolada_demanada?: boolean | null
  espigolada_id?: string | null
}): boolean {
  if (o.tipus_operacio) return o.tipus_operacio === 'espigolada'
  return Boolean(o.espigolada_demanada) || Boolean(o.espigolada_id)
}
