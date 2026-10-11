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
})
