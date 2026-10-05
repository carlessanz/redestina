// Editar una oferta (05-10-2026, rebanada 2): qué cambios acepta el servidor y cómo queda el
// texto. La regla de negocio (D4, kg ≥ canalizado) vive en SQL; esto es la normalización.

import { describe, expect, it } from 'vitest'
import { canvisOferta, componerTextoOferta } from '../supabase/functions/_shared/oferta.ts'

describe('canvisOferta', () => {
  it('normaliza números con coma y descarta lo que no reconoce', () => {
    expect(canvisOferta({ kg_total: '1.200', preu_minim: '0,45', producto: 'Pera' }))
      .toEqual({ kg_total: 1.2, preu_minim: 0.45 })
  })
  it('las modalidades, en orden canónico', () => {
    expect(canvisOferta({ modalitats: ['venda', 'donacio'] })).toEqual({ modalitats: ['donacio', 'venda'] })
  })
  it('la franja se guarda en sus columnas y en texto', () => {
    expect(canvisOferta({ franja: { inici: '9:00', fi: '12:30' } })).toEqual({
      hora_recollida_inici: '09:00', hora_recollida_fi: '12:30', horari_recollida: 'de 9:00 a 12:30',
    })
  })
  it('una franja vacía la borra', () => {
    expect(canvisOferta({ franja: null })).toEqual({
      hora_recollida_inici: null, hora_recollida_fi: null, horari_recollida: null,
    })
  })
  it('una fecha mal formada queda a null; vacíos a null', () => {
    expect(canvisOferta({ disponible_hasta: '23/10', preu_minim: '' })).toEqual({ disponible_hasta: null, preu_minim: null })
  })
  it('texto libre recortado a 400', () => {
    expect((canvisOferta({ observacions: 'x'.repeat(500) }).observacions as string).length).toBe(400)
  })
})

describe('el texto de una oferta con varias modalidades', () => {
  it('dice «Donació o venda»', () => {
    const t = componerTextoOferta({
      producte: 'Carbassó', productor: 'Mas', municipi: 'Vic', quantitat: '100 kg', disponible: '10/10/2026',
      modalitat: 'Donació o venda', preu: '0,45 €/kg', causa: 'Calibre', responsable: '', observacions: '',
    })
    expect(t).toContain('MODALITAT: Donació o venda')
    expect(t).toContain('PREU MÍNIM: 0,45 €/kg')
  })
})
