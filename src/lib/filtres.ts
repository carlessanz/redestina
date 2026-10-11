// Filtros y orden comunes a los listados (fase 6 de la revisión del 08-10-2026: «filtres i
// ordenació en tots els llistats, amb la mateixa lògica»). PURO, con prueba.
//
// Un listado declara sus DIMENSIONES (zona, producto, modalidad, estado…) como funciones que
// sacan el valor de cada fila, y opcionalmente un RANGO de fechas. El filtro solo acota en
// cliente lo que ya ha llegado (la RLS decide qué llega), y solo se ofrecen valores que dan
// resultado —con los demás filtros puestos—: no se ofrece una comarca sin ofertas.

export interface Dimensio<T> {
  clau: string
  /** Clave i18n de la etiqueta del desplegable. */
  etiquetaKey: string
  /** El valor de la fila para esta dimensión; null = no se puede filtrar por ella. */
  valor: (fila: T) => string | null | undefined
}

/** `''` en una dimensión = todas. */
export type ValorsFiltre = Record<string, string>

export interface RangData<T> {
  data: (fila: T) => string | null | undefined
  /** `aaaa-mm-dd`, inclusivo. `''` = sin límite. */
  desDe: string
  finsA: string
}

function dinsRang<T>(fila: T, r: RangData<T> | undefined): boolean {
  if (!r || (!r.desDe && !r.finsA)) return true
  const d = (r.data(fila) ?? '').slice(0, 10)
  if (!d) return false
  if (r.desDe && d < r.desDe) return false
  if (r.finsA && d > r.finsA) return false
  return true
}

function passa<T>(fila: T, dims: readonly Dimensio<T>[], valors: ValorsFiltre, excepte?: string): boolean {
  return dims.every((d) => d.clau === excepte || !valors[d.clau] || (d.valor(fila) ?? '') === valors[d.clau])
}

export function filtraLlistat<T>(
  files: readonly T[], dims: readonly Dimensio<T>[], valors: ValorsFiltre, rang?: RangData<T>,
): T[] {
  return files.filter((f) => passa(f, dims, valors) && dinsRang(f, rang))
}

/**
 * Las opciones de una dimensión que dan resultado con el resto de filtros puestos. El valor
 * elegido ahora se conserva aunque ya no dé resultado: si desapareciera del desplegable, no
 * habría forma de quitarlo.
 */
export function opcionsDisponibles<T>(
  files: readonly T[], dims: readonly Dimensio<T>[], clau: string, valors: ValorsFiltre, rang?: RangData<T>,
): string[] {
  const dim = dims.find((d) => d.clau === clau)
  if (!dim) return []
  const vals = new Set<string>()
  for (const f of files) {
    if (!passa(f, dims, valors, clau) || !dinsRang(f, rang)) continue
    const v = dim.valor(f)
    if (v) vals.add(v)
  }
  if (valors[clau]) vals.add(valors[clau])
  return [...vals].sort((a, b) => a.localeCompare(b, 'ca'))
}

/** Cuántos filtros hay puestos (para el botón plegado de móvil). */
export function filtresActius(valors: ValorsFiltre, rang?: { desDe: string; finsA: string }): number {
  return Object.values(valors).filter(Boolean).length + (rang?.desDe ? 1 : 0) + (rang?.finsA ? 1 : 0)
}

// ------------------------------------------------------------------------ el orden

interface Ordenable {
  disponible_hasta?: string | null
  tancada_at?: string | null
  created_at?: string | null
}

/**
 * El orden de las ofertas que pide la Fundació: primero las que siguen en marcha, por
 * disponibilidad —la que se acaba antes, arriba; las que no tienen fecha, al final de ese
 * grupo—; después las cerradas, la más reciente arriba (por cierre, o por alta).
 */
export function ordenaPerDisponibilitat<T extends Ordenable>(files: readonly T[], enCurs: (f: T) => boolean): T[] {
  const actives = files.filter(enCurs)
  const tancades = files.filter((f) => !enCurs(f))
  actives.sort((a, b) => {
    const da = a.disponible_hasta ?? ''
    const db = b.disponible_hasta ?? ''
    if (da && db) return da.localeCompare(db) || (b.created_at ?? '').localeCompare(a.created_at ?? '')
    if (da) return -1
    if (db) return 1
    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })
  tancades.sort((a, b) => (b.tancada_at ?? b.created_at ?? '').localeCompare(a.tancada_at ?? a.created_at ?? ''))
  return [...actives, ...tancades]
}

// ------------------------------------------------------- recordarlos por pantalla

/** Comodidad, no estado: si `localStorage` falla o guarda algo raro, sin filtros. */
export function llegeixFiltresDesats(clau: string | null): { valors: ValorsFiltre; desDe: string; finsA: string } {
  const buit = { valors: {}, desDe: '', finsA: '' }
  if (!clau) return buit
  try {
    const o = JSON.parse(localStorage.getItem('redestina-filtres:' + clau) ?? 'null') as
      { valors?: unknown; desDe?: unknown; finsA?: unknown } | null
    if (!o || typeof o !== 'object') return buit
    const valors: ValorsFiltre = {}
    if (o.valors && typeof o.valors === 'object') {
      for (const [k, v] of Object.entries(o.valors as Record<string, unknown>)) if (typeof v === 'string') valors[k] = v
    }
    const data = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')
    return { valors, desDe: data(o.desDe), finsA: data(o.finsA) }
  } catch {
    return buit
  }
}

export function desaFiltresLlistat(clau: string | null, f: { valors: ValorsFiltre; desDe: string; finsA: string }): void {
  if (!clau) return
  try {
    if (filtresActius(f.valors, f) === 0) localStorage.removeItem('redestina-filtres:' + clau)
    else localStorage.setItem('redestina-filtres:' + clau, JSON.stringify(f))
  } catch { /* sin memoria del filtro; la pantalla funciona igual */ }
}
