// El expediente de prevención (fase 11): la comparativa anual y el avance de las acciones,
// en sus DOS copias (la del PDF y la de la pantalla), que tienen que dar lo mismo.

import { describe, expect, it } from 'vitest'
import * as pantalla from '../src/lib/expedient'
import * as pdf from '../supabase/functions/_shared/expedient.ts'

const FILES = [
  { mes: '2025-08-01', kg: 900, categoria: 'perdua' },
  { mes: '2025-09-01', kg: '100', categoria: 'residu' },
  { mes: '2026-08-01', kg: 700, categoria: 'perdua' },
  { mes: '2026-09-01', kg: 300, categoria: 'excedent' },
  { mes: 'malament', kg: 50, categoria: 'perdua' },
]

describe('la comparativa anual del expediente', () => {
  it('totales por año y categoría, con la variación', () => {
    const c = pantalla.comparativaAnual(FILES)
    expect(c).toEqual([
      { any: 2025, perdua: 900, excedent: 0, residu: 100, total: 1000, variacio: null },
      { any: 2026, perdua: 700, excedent: 300, residu: 0, total: 1000, variacio: 0 },
    ])
  })

  it('una bajada sale en negativo, redondeada a una décima', () => {
    const c = pantalla.comparativaAnual([
      { mes: '2025-01-01', kg: 900, categoria: 'perdua' },
      { mes: '2026-01-01', kg: 700, categoria: 'perdua' },
    ])
    expect(c[1].variacio).toBe(-22.2)
  })

  it('el avance de las acciones no cuenta las descartadas', () => {
    expect(pantalla.avancAccions([{ estat: 'feta' }, { estat: 'pendent' }, { estat: 'descartada' }]))
      .toEqual({ fetes: 1, total: 2, pct: 50 })
    expect(pantalla.avancAccions([])).toEqual({ fetes: 0, total: 0, pct: 0 })
  })

  it('las dos copias (pantalla y PDF) dan exactamente lo mismo', () => {
    expect(pdf.comparativaAnual(FILES)).toEqual(pantalla.comparativaAnual(FILES))
    const acc = [{ estat: 'feta' }, { estat: 'en_curs' }]
    expect(pdf.avancAccions(acc)).toEqual(pantalla.avancAccions(acc))
  })
})
