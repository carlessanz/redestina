// «El meu impacte» (fase 10): lo poco que se calcula en la pantalla.

import { describe, expect, it } from 'vitest'
import { mesosDelPeriode, normalitzaImpacte, repartimentModalitats, serieMensual } from '../src/lib/impacte'

describe('el impacto en la pantalla', () => {
  it('las cifras de numeric llegan como cadena y se convierten', () => {
    const i = normalitzaImpacte({ ambit: 'receptor', kg_total: '1755.00', valor_eur: null, factors_provisionals: true,
      per_mes: [{ mes: '2026-09', kg: '1185' }] })
    expect(i.kg_total).toBe(1755)
    expect(i.valor_eur).toBeNull()
    expect(i.per_mes[0].kg).toBe(1185)
    expect(i.entregues).toBe(0)
  })

  it('el valor en € solo llega cuando la base lo da (nunca al receptor)', () => {
    expect(normalitzaImpacte({ ambit: 'productor', valor_eur: '12.5' }).valor_eur).toBe(12.5)
  })

  it('ante la duda, los factores son provisionales', () => {
    expect(normalitzaImpacte({ ambit: 'global' }).factors_provisionals).toBe(true)
    expect(normalitzaImpacte({ ambit: 'global', factors_provisionals: false }).factors_provisionals).toBe(false)
  })

  it('los meses del periodo, cruzando de año', () => {
    expect(mesosDelPeriode('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(mesosDelPeriode('2026-01-01', '2026-12-31')).toHaveLength(12)
    expect(mesosDelPeriode('', '2026-01-01')).toEqual([])
  })

  it('la serie rellena con 0 los meses sin entregas', () => {
    expect(serieMensual({ desde: '2026-08-01', hasta: '2026-10-31', per_mes: [{ mes: '2026-09', kg: 40 }] }))
      .toEqual([{ mes: '2026-08', kg: 0 }, { mes: '2026-09', kg: 40 }, { mes: '2026-10', kg: 0 }])
  })

  it('el reparto por modalidad, sin las vacías y de mayor a menor', () => {
    expect(repartimentModalitats({ kg_donacio: 10, kg_venda: 30, kg_maquila: 0 }))
      .toEqual([{ modalitat: 'venda', kg: 30 }, { modalitat: 'donacio', kg: 10 }])
  })
})
