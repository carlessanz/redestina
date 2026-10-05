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

/** `''` = todas. Una entidad sin tipo solo sale sin filtro: no se le puede atribuir ninguno. */
export function filtraRanking(ranking: readonly EntidadPuntuada[], tipus: string): EntidadPuntuada[] {
  if (!tipus) return [...ranking]
  return ranking.filter((e) => (e.tipo_receptor ?? null) === tipus)
}

/** Qué tipos aparecen de verdad en este ranking, para no ofrecer un filtro que da cero. */
export function tipusPresents(ranking: readonly EntidadPuntuada[]): string[] {
  const hi = new Set(ranking.map((e) => e.tipo_receptor).filter((x): x is string => !!x))
  return TIPUS_RECEPTOR.filter((t) => hi.has(t))
}
