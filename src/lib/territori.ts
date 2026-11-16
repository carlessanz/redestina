// Provincia y municipio para los filtros de los listados (fase 1 de la revisión del feedback
// del 08-10-2026, informe del 16-11-2026: «Provincia · Municipi» en la barra de filtros).
// PURO, con prueba: el catálogo `municipios` lo carga `lib/municipis.ts` y llega aquí ya leído.
//
// DOS FUENTES, según quién mira:
// - Quien puede ver el municipio de la oferta (el equipo, la propia productora) saca la
//   provincia de los dos primeros dígitos del código INE: exacta.
// - El RECEPTOR no ve el municipio antes de la asignación (D3: un municipio con una sola
//   productora la identifica), solo la COMARCA. Cuatro comarcas cruzan provincias (Selva,
//   Cerdanya, Berguedà, Osona), así que de la comarca salen TODAS sus provincias: la oferta
//   pasa el filtro de cualquiera de ellas. Mejor que sobre una a que falte.

import type { Municipi } from './municipis'

/** Prefijo INE → provincia. Las cuatro de Catalunya, las únicas del nomenclátor (§4). */
const PROVINCIA_PER_PREFIX: Readonly<Record<string, string>> = {
  '08': 'Barcelona', '17': 'Girona', '25': 'Lleida', '43': 'Tarragona',
}

/** La provincia de un municipio por su código INE de 5 dígitos, o null. */
export function provinciaDeIne(ine: string | null | undefined): string | null {
  if (!ine || !/^\d{5}$/.test(ine)) return null
  return PROVINCIA_PER_PREFIX[ine.slice(0, 2)] ?? null
}

/** Comarca → sus provincias (ordenadas), del catálogo. */
export function provinciesPerComarca(municipis: readonly Pick<Municipi, 'comarca' | 'provincia'>[]): Map<string, string[]> {
  const m = new Map<string, Set<string>>()
  for (const x of municipis) {
    if (!x.comarca || !x.provincia) continue
    if (!m.has(x.comarca)) m.set(x.comarca, new Set())
    m.get(x.comarca)!.add(x.provincia)
  }
  return new Map([...m].map(([c, ps]) => [c, [...ps].sort((a, b) => a.localeCompare(b, 'ca'))]))
}

/**
 * Las provincias de una fila: la del municipio si se conoce; si no, las de su comarca. Lista
 * vacía si no se sabe nada (la fila solo sale sin filtro de provincia).
 */
export function provinciesDe(
  ine: string | null | undefined,
  comarca: string | null | undefined,
  perComarca: ReadonlyMap<string, readonly string[]>,
): string[] {
  const p = provinciaDeIne(ine)
  if (p) return [p]
  return comarca ? [...(perComarca.get(comarca) ?? [])] : []
}
