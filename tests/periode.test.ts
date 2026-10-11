import { describe, expect, it } from 'vitest'
import { datesPeriode } from '../src/lib/periode'

describe('el periodo de los indicadores', () => {
  it('año, mes (con su último día) y rango', () => {
    expect(datesPeriode('any', '2026-10-11', { desDe: '', finsA: '' })).toEqual({ desde: '2026-01-01', hasta: '2026-12-31' })
    expect(datesPeriode('mes', '2026-02-11', { desDe: '', finsA: '' })).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
    expect(datesPeriode('mes', '2028-02-11', { desDe: '', finsA: '' })).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
    expect(datesPeriode('rang', '2026-10-11', { desDe: '2026-03-01', finsA: '' })).toEqual({ desde: '2026-03-01', hasta: '2026-10-11' })
  })
})
