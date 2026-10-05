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
export function filtraRanking(
  ranking: readonly EntidadPuntuada[], tipus: string, nomesProducte = false,
): EntidadPuntuada[] {
  return ranking.filter((e) =>
    (!tipus || (e.tipo_receptor ?? null) === tipus)
    && (!nomesProducte || e.interessa_producte === true))
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
