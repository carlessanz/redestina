import { describe, expect, it } from 'vitest'
import { filtraLlistat, filtresActius, opcionsDisponibles, ordenaPerDisponibilitat, type Dimensio } from '../src/lib/filtres'

interface F { id: string; comarca: string | null; modalitat: string; data: string; disponible_hasta?: string | null; tancada_at?: string | null; created_at?: string; actiu?: boolean }
const FILES: F[] = [
  { id: 'a', comarca: 'Osona', modalitat: 'donacio', data: '2026-10-01' },
  { id: 'b', comarca: 'Osona', modalitat: 'venda', data: '2026-10-05' },
  { id: 'c', comarca: 'Maresme', modalitat: 'donacio', data: '2026-09-20' },
  { id: 'd', comarca: null, modalitat: 'maquila', data: '2026-10-10' },
]
const DIMS: Dimensio<F>[] = [
  { clau: 'comarca', etiquetaKey: 'x', valor: (f) => f.comarca },
  { clau: 'modalitat', etiquetaKey: 'y', valor: (f) => f.modalitat },
]

describe('filtros comunes', () => {
  it('combina dimensiones y rango de fechas', () => {
    expect(filtraLlistat(FILES, DIMS, { comarca: 'Osona' }).map((f) => f.id)).toEqual(['a', 'b'])
    expect(filtraLlistat(FILES, DIMS, { comarca: 'Osona', modalitat: 'venda' }).map((f) => f.id)).toEqual(['b'])
    const rang = { data: (f: F) => f.data, desDe: '2026-10-01', finsA: '2026-10-05' }
    expect(filtraLlistat(FILES, DIMS, {}, rang).map((f) => f.id)).toEqual(['a', 'b'])
    expect(filtraLlistat(FILES, DIMS, {}).length).toBe(4)
  })
  it('solo ofrece opciones que dan resultado con los demás filtros, y conserva la elegida', () => {
    expect(opcionsDisponibles(FILES, DIMS, 'comarca', {})).toEqual(['Maresme', 'Osona'])
    expect(opcionsDisponibles(FILES, DIMS, 'comarca', { modalitat: 'venda' })).toEqual(['Osona'])
    expect(opcionsDisponibles(FILES, DIMS, 'comarca', { comarca: 'Garrotxa' })).toContain('Garrotxa')
  })
  it('cuenta los filtros activos', () => {
    expect(filtresActius({ a: 'x', b: '' }, { desDe: '2026-01-01', finsA: '' })).toBe(2)
  })
  it('ordena por disponibilidad las activas y por cierre las cerradas', () => {
    const o = ordenaPerDisponibilitat([
      { id: 'sense', disponible_hasta: null, created_at: '2026-10-09', actiu: true },
      { id: 'tard', disponible_hasta: '2026-10-30', created_at: '2026-10-01', actiu: true },
      { id: 'aviat', disponible_hasta: '2026-10-12', created_at: '2026-10-02', actiu: true },
      { id: 'tancada-vella', tancada_at: '2026-09-01', actiu: false },
      { id: 'tancada-nova', tancada_at: '2026-10-08', actiu: false },
    ], (f) => !!f.actiu)
    expect(o.map((f) => f.id)).toEqual(['aviat', 'tard', 'sense', 'tancada-nova', 'tancada-vella'])
  })
  it('fase 4: las vencidas sin resolver arriba; al revés, la más lejana arriba y sin fecha al final', () => {
    const files = [
      { id: 'sense', disponible_hasta: null, created_at: '2026-10-09' },
      { id: 'tard', disponible_hasta: '2026-11-30', created_at: '2026-10-01' },
      { id: 'aviat', disponible_hasta: '2026-11-26', created_at: '2026-10-02' },
      { id: 'vencuda-resolta', disponible_hasta: '2026-11-10', created_at: '2026-10-03' },
      { id: 'vencuda', disponible_hasta: '2026-11-20', created_at: '2026-10-04' },
      { id: 'vencuda-vella', disponible_hasta: '2026-11-01', created_at: '2026-10-05' },
    ]
    const vencuda = (f: { id: string }) => f.id === 'vencuda' || f.id === 'vencuda-vella'
    const asc = ordenaPerDisponibilitat(files, () => true, { vencuda })
    // Las vencidas sin resolver primero (entre ellas, la que venció antes); después, por fecha
    // (la vencida ya resuelta, por su fecha); las que no tienen, al final.
    expect(asc.map((f) => f.id)).toEqual(['vencuda-vella', 'vencuda', 'vencuda-resolta', 'aviat', 'tard', 'sense'])
    const desc = ordenaPerDisponibilitat(files, () => true, { vencuda, sentit: 'desc' })
    expect(desc.map((f) => f.id)).toEqual(['tard', 'aviat', 'vencuda', 'vencuda-resolta', 'vencuda-vella', 'sense'])
    // Sin opciones, el de siempre (el panel del productor).
    expect(ordenaPerDisponibilitat(files, () => true).map((f) => f.id))
      .toEqual(['vencuda-vella', 'vencuda-resolta', 'vencuda', 'aviat', 'tard', 'sense'])
  })
})

describe('dimensiones con varios valores (fase 1 del feedback del 08-10)', () => {
  interface M { id: string; modalitats: string[]; comarca: string | null }
  const OF: M[] = [
    { id: 'a', modalitats: ['donacio', 'venda'], comarca: 'Osona' },
    { id: 'b', modalitats: ['venda'], comarca: 'Maresme' },
    { id: 'c', modalitats: [], comarca: null },
  ]
  const D: Dimensio<M>[] = [
    { clau: 'modalitat', etiquetaKey: 'x', valor: (f) => f.modalitats },
    { clau: 'comarca', etiquetaKey: 'y', valor: (f) => f.comarca },
  ]
  it('pasa el filtro si alguno de sus valores coincide', () => {
    expect(filtraLlistat(OF, D, { modalitat: 'venda' }).map((f) => f.id)).toEqual(['a', 'b'])
    expect(filtraLlistat(OF, D, { modalitat: 'donacio' }).map((f) => f.id)).toEqual(['a'])
  })
  it('cada valor de la lista es una opción, y una lista vacía no aporta ninguna', () => {
    expect(opcionsDisponibles(OF, D, 'modalitat', {})).toEqual(['donacio', 'venda'])
    expect(opcionsDisponibles(OF, D, 'modalitat', { comarca: 'Maresme' })).toEqual(['venda'])
  })
})
