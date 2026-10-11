// «El meu impacte» (fase 10 de la revisión del 08-10-2026): lo que devuelven las RPC
// `impacte_receptor` / `impacte_productor` / `impacte_global` y lo poco que hay que calcular
// en la pantalla. Puro y sin red, con prueba.
//
// ⚠️ Las cifras las calcula la BASE (kilos conciliados × factores de `factors_impacte`). Aquí
//    solo se rellenan los meses sin entregas para el gráfico y se decide qué se enseña.

export type AmbitImpacte = 'receptor' | 'productor' | 'global'

export interface Impacte {
  ambit: AmbitImpacte
  desde: string
  hasta: string
  kg_total: number
  kg_donacio: number
  kg_venda: number
  kg_maquila: number
  entregues: number
  n_productors: number
  n_entitats: number
  /** null para el receptor: no ve la valoración del donante */
  valor_eur: number | null
  co2e_kg: number
  aigua_l: number
  racions: number
  factors_provisionals: boolean
  per_mes: { mes: string; kg: number }[]
}

/** Las cifras llegan de `numeric`, que PostgREST puede servir como cadena. */
export function normalitzaImpacte(brut: Record<string, unknown>): Impacte {
  const n = (k: string) => Number(brut[k] ?? 0) || 0
  const perMes = Array.isArray(brut.per_mes) ? brut.per_mes as { mes: string; kg: unknown }[] : []
  return {
    ambit: brut.ambit as AmbitImpacte,
    desde: String(brut.desde ?? ''),
    hasta: String(brut.hasta ?? ''),
    kg_total: n('kg_total'),
    kg_donacio: n('kg_donacio'),
    kg_venda: n('kg_venda'),
    kg_maquila: n('kg_maquila'),
    entregues: n('entregues'),
    n_productors: n('n_productors'),
    n_entitats: n('n_entitats'),
    valor_eur: brut.valor_eur === null || brut.valor_eur === undefined ? null : n('valor_eur'),
    co2e_kg: n('co2e_kg'),
    aigua_l: n('aigua_l'),
    racions: n('racions'),
    factors_provisionals: brut.factors_provisionals !== false,
    per_mes: perMes.map((m) => ({ mes: String(m.mes), kg: Number(m.kg) || 0 })),
  }
}

/** Los meses del periodo (`aaaa-mm`), del primero al último, como mucho 36. */
export function mesosDelPeriode(desde: string, hasta: string): string[] {
  const [a0, m0] = desde.slice(0, 7).split('-').map(Number)
  const [a1, m1] = hasta.slice(0, 7).split('-').map(Number)
  if (!a0 || !m0 || !a1 || !m1) return []
  const fora: string[] = []
  let a = a0
  let m = m0
  while ((a < a1 || (a === a1 && m <= m1)) && fora.length < 36) {
    fora.push(`${a}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; a += 1 }
  }
  return fora
}

/** La serie del gráfico: un valor por mes del periodo, con los meses sin entregas a 0. */
export function serieMensual(impacte: Pick<Impacte, 'desde' | 'hasta' | 'per_mes'>): { mes: string; kg: number }[] {
  const mapa = new Map(impacte.per_mes.map((m) => [m.mes, m.kg]))
  return mesosDelPeriode(impacte.desde, impacte.hasta).map((mes) => ({ mes, kg: mapa.get(mes) ?? 0 }))
}

/** El reparto por modalidad, solo las que tienen kilos, de mayor a menor. */
export function repartimentModalitats(i: Pick<Impacte, 'kg_donacio' | 'kg_venda' | 'kg_maquila'>):
  { modalitat: 'donacio' | 'venda' | 'maquila'; kg: number }[] {
  return ([
    { modalitat: 'donacio' as const, kg: i.kg_donacio },
    { modalitat: 'venda' as const, kg: i.kg_venda },
    { modalitat: 'maquila' as const, kg: i.kg_maquila },
  ]).filter((x) => x.kg > 0).sort((a, b) => b.kg - a.kg)
}
