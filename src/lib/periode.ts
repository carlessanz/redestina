// El periodo de los indicadores del tablero (fase 8). Puro, con prueba.

export type Periode = 'any' | 'mes' | 'rang'

/** Las fechas del periodo, `aaaa-mm-dd`. Puro, para poder razonarlo. */
export function datesPeriode(p: Periode, avui: string, rang: { desDe: string; finsA: string }): { desde: string; hasta: string } {
  if (p === 'any') return { desde: `${avui.slice(0, 4)}-01-01`, hasta: `${avui.slice(0, 4)}-12-31` }
  if (p === 'mes') {
    const [a, m] = avui.split('-').map(Number)
    const fi = new Date(Date.UTC(a, m, 0)).getUTCDate()
    return { desde: `${avui.slice(0, 7)}-01`, hasta: `${avui.slice(0, 7)}-${String(fi).padStart(2, '0')}` }
  }
  return { desde: rang.desDe || `${avui.slice(0, 4)}-01-01`, hasta: rang.finsA || avui }
}
