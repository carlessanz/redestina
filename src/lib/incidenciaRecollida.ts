// PURO: la incidencia de recogida que declara el receptor al registrar los kilos reales
// (`registrar_recollida()`, 20270426100000).
//
// Vive en DOS sitios con dos formas: `canalizaciones.incidencia_recollida` es un objeto
// (con `registrada_at`/`registrada_per`), y `albaranes.incidencias` —que pasa por
// `registrar_confirmacion()`— es una LISTA de objetos, aunque los albaranes antiguos pueden
// llevar un objeto suelto. Aquí se leen las dos sin que la pantalla tenga que saberlo, y
// solo cuenta como incidencia de recogida la que dice `tipus: 'diferencia_kg'`: una
// observación sin diferencia no bloquea nada.

export interface IncidenciaDiferencia {
  resultat: 'menys' | 'mes'
  kg_assignats: number | null
  kg_reals: number | null
  /** El motivo que escribió la entidad. */
  descripcion: string | null
  registrada_at: string | null
  registrada_per: string | null
}

function numero(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** Una incidencia de diferencia de kilos, o null si el objeto no lo es. */
export function llegeixIncidencia(v: unknown): IncidenciaDiferencia | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.tipus !== 'diferencia_kg') return null
  return {
    resultat: o.resultat === 'mes' ? 'mes' : 'menys',
    kg_assignats: numero(o.kg_assignats),
    kg_reals: numero(o.kg_reals),
    descripcion: text(o.descripcion),
    registrada_at: text(o.registrada_at),
    registrada_per: text(o.registrada_per),
  }
}

/** Las incidencias de diferencia de un `albaranes.incidencias` (lista u objeto suelto). */
export function incidenciesDiferencia(v: unknown): IncidenciaDiferencia[] {
  const llista = Array.isArray(v) ? v : v ? [v] : []
  return llista.map(llegeixIncidencia).filter((x): x is IncidenciaDiferencia => x !== null)
}

/** Reales menos asignados, con signo; null si falta alguno de los dos. */
export function diferenciaKg(i: Pick<IncidenciaDiferencia, 'kg_assignats' | 'kg_reals'>): number | null {
  if (i.kg_assignats == null || i.kg_reals == null) return null
  return Math.round((i.kg_reals - i.kg_assignats) * 100) / 100
}
