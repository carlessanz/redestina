// Editar una oferta (05-10-2026, rebanada 2): qué cambios acepta el servidor y cómo queda el
// texto. La regla de negocio (D4, kg ≥ canalizado) vive en SQL; esto es la normalización.

import { describe, expect, it } from 'vitest'
import { canvisOferta, componerTextoOferta, textoOfertaDeDades } from '../supabase/functions/_shared/oferta.ts'
import { canvisDeDatos, datosDeFila, type FilaEditable } from '../src/lib/edicioOferta'

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
      modalitat: 'Donació o venda', preu: '0,45 €/kg', causa: 'Calibre', observacions: '',
    })
    expect(t).toContain('MODALITAT: Donació o venda')
    expect(t).toContain('PREU MÍNIM: 0,45 €/kg')
  })
})

// ---------------------------------------------------------------------------
// Fase C del punto 3 (17-11-2026, filas 3.7.3 y 3.7.4): se edita TODO menos producto y entidad
// ---------------------------------------------------------------------------
describe('canvisOferta · las claves nuevas', () => {
  it('lugar, enlace propio, formato, retorno y su detalle, al camp, días y fotos', () => {
    expect(canvisOferta({
      ubicacion_id: ' u-1 ', gmaps_url: ' https://maps.app.goo.gl/x ', format_entrega: 'palet',
      retorn_envasos: 'Sí', retorn_envasos_detall: '  palots  ', retorn_envasos_quantitat: '4',
      producte_al_camp: 'si', dies_recollida: [5, 1, 1, 9], fotos: ['a/b.jpg', 3], foto_producte: false,
    })).toEqual({
      ubicacion_id: 'u-1', gmaps_url: 'https://maps.app.goo.gl/x', format_entrega: 'palet',
      retorn_envasos: 'Sí', retorn_envasos_detall: 'palots', retorn_envasos_quantitat: 4,
      producte_al_camp: true, dies_recollida: [1, 5], fotos: ['a/b.jpg'], foto_producte: false,
    })
  })
  it('vaciar es null (sin enlace, sin formato, sin retorno); un enlace mal formado viaja y lo rechaza la RPC', () => {
    expect(canvisOferta({ gmaps_url: '', format_entrega: '', retorn_envasos: '', retorn_envasos_detall: ' ' }))
      .toEqual({ gmaps_url: null, format_entrega: null, retorn_envasos: null, retorn_envasos_detall: null })
    expect(canvisOferta({ gmaps_url: 'no és un enllaç' })).toEqual({ gmaps_url: 'no és un enllaç' })
  })
  it('el producto y la entidad NO son claves de edición', () => {
    expect(canvisOferta({ producto: 'Pera', productor_id: 'x', familia: 'Fruita' })).toEqual({})
  })
})

describe('el texto sale de la fila (una sola fuente de verdad)', () => {
  const ctx = { productor: 'Can Prova', municipi: 'Gavà', mapsLloc: 'https://maps.app.goo.gl/lloc' }
  const fila = {
    producto: 'Tomàquet', variedad: 'Raf', kg_total: 300, modalitats: ['donacio', 'venda'], preu_minim: 0.45,
    disponible_hasta: '2026-11-20', dies_recollida: [1, 3], horari_recollida: 'de 8:00 a 12:00',
    format_entrega: 'caixes', num_caixes: 20, retorn_envasos: 'Sí', retorn_envasos_detall: 'caixes verdes',
    retorn_envasos_quantitat: 20, causa: 'Preu i rendibilitat', observacions: null, gmaps_url: null,
  }
  it('compone todas las líneas de la fila 3.7.6, sin vacías', () => {
    const t = textoOfertaDeDades(fila, { ...ctx, causa: 'Preu i rendibilitat', subcausa: 'Preu de venda insuficient' })
    expect(t).toContain('🌿 PRODUCTE: Tomàquet (Raf)')
    expect(t).toContain('🗺️ PUNT DE RECOLLIDA:\nhttps://maps.app.goo.gl/lloc')
    expect(t).toContain('📦 QUANTITAT: 300 kg aprox')
    expect(t).toContain('📅 DISPONIBLE FINS: 20/11/2026')
    expect(t).toContain('⏰ HORARI DE RECOLLIDA: dl, dc · de 8:00 a 12:00')
    expect(t).toContain('💰 MODALITAT: Donació o venda')
    expect(t).toContain('💶 PREU MÍNIM: 0,45 €/kg')
    expect(t).toContain('🔴 CAUSA: Preu i rendibilitat — Preu de venda insuficient')
    expect(t).toContain('♻️ ENVASOS: 20 caixes · cal retornar-los (20 · caixes verdes)')
    expect(t).not.toContain('OBSERVACIONS')
    expect(t).not.toContain('RESPONSABLE')
  })
  it('el precio mínimo solo con venta, aunque la fila lo conserve', () => {
    expect(textoOfertaDeDades({ ...fila, modalitats: ['donacio'] }, ctx)).not.toContain('PREU MÍNIM')
  })
  it('el enlace propio de la oferta manda sobre el del lugar', () => {
    expect(textoOfertaDeDades({ ...fila, gmaps_url: 'https://maps.app.goo.gl/propi' }, ctx))
      .toContain('https://maps.app.goo.gl/propi')
  })
  it('editar una columna cambia el texto (kg, lugar, subcausa)', () => {
    const abans = textoOfertaDeDades(fila, ctx)
    const despres = textoOfertaDeDades({ ...fila, kg_total: 250 }, { ...ctx, mapsLloc: 'https://maps.app.goo.gl/nou', subcausa: 'Calibre petit', causa: 'Qualitat' })
    expect(abans).not.toBe(despres)
    expect(despres).toContain('250 kg aprox')
    expect(despres).toContain('https://maps.app.goo.gl/nou')
    expect(despres).toContain('🔴 CAUSA: Qualitat — Calibre petit')
  })
  it('sin fecha legible, el texto tal como se escribió (WhatsApp)', () => {
    expect(textoOfertaDeDades({ ...fila, disponible_hasta: null }, { ...ctx, disponibleText: 'finals de mes' }))
      .toContain('📅 DISPONIBLE FINS: finals de mes')
  })
})

describe('el formulario en modo editar: de la fila a las respuestas y vuelta', () => {
  const fila: FilaEditable = {
    producto: 'Pera', familia: 'Fruita', variedad: 'Conference', producte_al_camp: false, kg_total: 500,
    num_caixes: 20, format_entrega: 'caixes', retorn_envasos: 'Sí', retorn_envasos_detall: 'palots',
    retorn_envasos_quantitat: 10, ubicacion_id: 'u-1', gmaps_url: null, disponible_hasta: '2026-11-30',
    dies_recollida: [1, 3], hora_recollida_inici: '08:00:00', hora_recollida_fi: '12:00:00',
    modalitats: ['donacio'], preu_minim: null, coste_kg: 0.3, causa_codigo: 'C4', subcausa_codigo: 'C4.2',
    observacions: null, fotos: ['p/a.jpg'],
  }
  it('datosDeFila habla el idioma del cuestionario (ojo: retorn_envasos es el DETALLE)', () => {
    expect(datosDeFila(fila)).toEqual({
      producte: 'Pera', familia: 'Fruita', varietat: 'Conference', producte_al_camp: 'no', kg: 500,
      format_entrega: 'caixes', caixes: 20, retorn: 'Sí', retorn_envasos: 'palots', retorn_quantitat: 10,
      ubicacio: 'u-1', disponible_fins: '30/11/2026', dies_recollida: [1, 3], horari: { inici: '08:00', fi: '12:00' },
      modalitat: ['donacio'], cost_kg: 0.3, causa: 'C4.2', fotos: ['p/a.jpg'],
    })
  })
  it('sin tocar nada no hay cambios', () => {
    expect(canvisDeDatos(fila, datosDeFila(fila))).toEqual({})
  })
  it('solo viaja lo que cambia, con las claves de la RPC', () => {
    const d = {
      ...datosDeFila(fila), kg: 450, ubicacio: 'u-2', causa: 'C4.1', retorn: 'No',
      dies_recollida: [5], horari: { inici: '09:00', fi: '13:00' }, observacions: 'Truqueu abans',
    }
    expect(canvisDeDatos(fila, d)).toEqual({
      kg_total: 450, ubicacion_id: 'u-2', subcausa_codigo: 'C4.1', retorn_envasos: 'No',
      retorn_envasos_detall: null, retorn_envasos_quantitat: null, dies_recollida: [5],
      franja: { inici: '09:00', fi: '13:00' }, observacions: 'Truqueu abans',
    })
  })
  it('una pregunta que deja de aplicar viaja vacía (al camp: sin formato ni retorno)', () => {
    const d = { ...datosDeFila(fila), producte_al_camp: 'si' }
    const c = canvisDeDatos(fila, d, (k) => !['format_entrega', 'caixes', 'retorn', 'retorn_envasos', 'retorn_quantitat'].includes(k))
    expect(c).toMatchObject({
      producte_al_camp: true, format_entrega: null, num_caixes: null, retorn_envasos: null,
      retorn_envasos_detall: null, retorn_envasos_quantitat: null,
    })
  })
  it('una oferta de WhatsApp sin subcausa se edita sin elegirla', () => {
    const wa = { ...fila, subcausa_codigo: null, causa_codigo: 'C4' }
    expect(canvisDeDatos(wa, { ...datosDeFila(wa), causa: '' })).toEqual({})
  })
  it('quitar la venta quita el precio; quitar la donación, el coste', () => {
    const f2 = { ...fila, modalitats: ['donacio', 'venda'], preu_minim: 0.5 }
    expect(canvisDeDatos(f2, { ...datosDeFila(f2), modalitat: ['donacio'] }))
      .toEqual({ modalitats: ['donacio'], preu_minim: null })
    expect(canvisDeDatos(f2, { ...datosDeFila(f2), modalitat: ['venda'] }))
      .toEqual({ modalitats: ['venda'], coste_kg: null })
  })
})
