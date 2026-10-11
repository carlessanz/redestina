// El listado de entidades priorizadas del detalle de una oferta: filtro y «veure'n més».
//
// POR QUÉ (reunión del 05-10-2026). El ranking se cortaba a las 15 primeras sin forma de
// ver el resto, y Sebastián necesitaba acotar por tipo de entidad («empreses», «entitats
// socials»). Puro y fuera de `OfferDetail.tsx` a propósito: esa pantalla ya es la más
// pesada del panel (§12, deuda 19) y esto se puede probar aislado.
//
// ⚠️ EL FILTRO NO REORDENA. El orden lo decide el servidor (puntuación) y la pantalla
//    (primero las contactables); filtrar solo quita filas, así que la posición relativa de
//    las que quedan es la misma que sin filtro.

import type { EntidadPuntuada } from './redestina'

/** Cuántas se enseñan de entrada y cuántas más en cada «veure'n més». */
export const PAS_RANKING = 15

/** Los cuatro valores de `entidades.tipo_receptor`, en el orden en que se ofrecen. */
export const TIPUS_RECEPTOR = ['social', 'comercial', 'transformador', 'animal'] as const

/**
 * `''` = todas. Una entidad sin tipo solo sale sin filtro: no se le puede atribuir ninguno.
 * `nomesProducte` (C3 v1): solo las que han dicho en su perfil que les interesa esta
 * categoría; las que no han declarado nada quedan FUERA (no se sabe), y por eso es un
 * filtro opcional y no el orden.
 */
/** Las tres franjas del filtro «última recepció» (fase 6 de la revisión del 08-10-2026). */
export const FRANGES_RECEPCIO = ['3m', '12m', 'mai'] as const
export type FranjaRecepcio = '' | typeof FRANGES_RECEPCIO[number]

/** ¿La última recepción cae en la franja? `mai` = nunca ha recibido nada conciliado. */
export function dinsFranja(ultima: string | null | undefined, franja: FranjaRecepcio, ara = new Date()): boolean {
  if (!franja) return true
  if (franja === 'mai') return !ultima
  if (!ultima) return false
  const mesos = franja === '3m' ? 3 : 12
  const limit = new Date(ara)
  limit.setMonth(limit.getMonth() - mesos)
  return new Date(ultima) >= limit
}

export interface FiltresRanking {
  tipus?: string
  nomesProducte?: boolean
  /** `''` = todas. */
  comarca?: string
  recepcio?: FranjaRecepcio
  /** Fase 7: un tipo de actividad (`tipus_activitat`). */
  activitat?: string
  /** Fase 7: solo las que dicen poder recibir al menos estos kilos de una vez. */
  capacitatMinima?: number
}

export function filtraRanking(
  ranking: readonly EntidadPuntuada[], tipus: string | FiltresRanking, nomesProducte = false,
): EntidadPuntuada[] {
  // La firma anterior (`tipus`, `nomesProducte`) se conserva: la usan las pruebas.
  const f: FiltresRanking = typeof tipus === 'string' ? { tipus, nomesProducte } : tipus
  return ranking.filter((e) =>
    (!f.tipus || (e.tipo_receptor ?? null) === f.tipus)
    && (!f.nomesProducte || e.interessa_producte === true)
    && (!f.comarca || (e.comarca ?? null) === f.comarca)
    && dinsFranja(e.ultima_recepcio, f.recepcio ?? '')
    && (!f.activitat || (e.tipus_activitat ?? []).includes(f.activitat))
    && (!f.capacitatMinima || (e.capacitat_maxima != null && e.capacitat_maxima >= f.capacitatMinima)))
}

/** Las comarcas que aparecen en el ranking, para no ofrecer una que da cero. */
export function comarquesPresents(ranking: readonly EntidadPuntuada[]): string[] {
  return [...new Set(ranking.map((e) => e.comarca).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'ca'))
}

/** ¿Hay alguna entidad que haya declarado interés por el producto? Si no, el filtro no se ofrece. */
export function hiHaInteresProducte(ranking: readonly EntidadPuntuada[]): boolean {
  return ranking.some((e) => e.interessa_producte === true)
}

/** Qué tipos aparecen de verdad en este ranking, para no ofrecer un filtro que da cero. */
export function tipusPresents(ranking: readonly EntidadPuntuada[]): string[] {
  const hi = new Set(ranking.map((e) => e.tipo_receptor).filter((x): x is string => !!x))
  return TIPUS_RECEPTOR.filter((t) => hi.has(t))
}

/** Los tipos de actividad que aparecen en el ranking (fase 7). */
export function activitatsPresents(ranking: readonly EntidadPuntuada[]): string[] {
  return [...new Set(ranking.flatMap((e) => e.tipus_activitat ?? []))].sort()
}

/** ¿Alguna ha declarado su capacidad? Si no, el filtro no se ofrece. */
export function hiHaCapacitat(ranking: readonly EntidadPuntuada[]): boolean {
  return ranking.some((e) => e.capacitat_maxima != null)
}
