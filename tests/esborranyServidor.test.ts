// El ESBORRANY de una oferta en el servidor (fase C del punto 3, 17-11-2026, fila 3.1.2): la
// parte pura de `crear-oferta/esborrany` y `crear-oferta/publicar`, y la decisión de
// «Comparteix». La red (Storage, RLS, la RPC de borrar) la prueban el arnés y los E2E.

import { describe, expect, it } from 'vitest'
import { filaDeDades } from '../supabase/functions/_shared/oferta.ts'
import { errorFormatOferta } from '../supabase/functions/crear-oferta/validacio.ts'
import { comCompartir, esCompartible, nomFitxerFoto } from '../src/lib/compartirOferta'

const PROD = '0b9c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3'
const SENSE_CAUSA = { causaCodigo: null, subcausaCodigo: null, causa: null, subcausa: null }

describe('errorFormatOferta: un esborrany admite datos a medias, no mal formados', () => {
  it('vacío no es un error (eso lo decide `faltantes()` al publicar)', () => {
    expect(errorFormatOferta({ producte: 'Pera' }, PROD)).toBeNull()
    expect(errorFormatOferta({ producte: 'Pera', kg: '', cost_kg: null, gmaps_url: '' }, PROD)).toBeNull()
  })
  it('lo escrito tiene que valer', () => {
    expect(errorFormatOferta({ kg: 0 }, PROD)).toBe('kg_invalid')
    expect(errorFormatOferta({ kg: '-3' }, PROD)).toBe('kg_invalid')
    expect(errorFormatOferta({ retorn: 'Sí', retorn_quantitat: 2.5 }, PROD)).toBe('retorn_quantitat_invalid')
    expect(errorFormatOferta({ gmaps_url: 'maps.app.goo.gl/x' }, PROD)).toBe('maps_invalid')
    expect(errorFormatOferta({ fotos: ['altre/x.jpg'] }, PROD)).toBe('fotos_invalides')
    expect(errorFormatOferta({ cost_kg: '0' }, PROD)).toBe('cost_invalid')
    expect(errorFormatOferta({ foto_producte: 'sí' }, PROD)).toBe('foto_producte_invalid')
    expect(errorFormatOferta({ kg: '12,5', retorn: 'Sí', retorn_quantitat: 3 }, PROD)).toBeNull()
  })
})

describe('filaDeDades: las columnas de un esborrany (o de un alta)', () => {
  it('con solo el producto, todo lo demás nulo o por defecto', () => {
    const f = filaDeDades({ producte: 'Pera' }, 'Fruita', SENSE_CAUSA)
    expect(f).toMatchObject({
      producto: 'Pera', familia: 'Fruita', kg_total: null, modalitats: null, modalitat: null,
      preu_minim: null, disponible_hasta: null, hora_recollida_inici: null, fotos: [], foto_producte: true,
      producte_al_camp: false, observacions: null, ubicacion_id: null,
    })
  })
  it('lo contestado, en sus columnas (kg con coma, franja, días, retorno con detalle)', () => {
    const f = filaDeDades({
      producte: 'Pera', kg: '12,5', modalitat: ['venda'], preu_minim: '0,8', horari: { inici: '08:00', fi: '12:00' },
      dies_recollida: [3, 1], retorn: 'Sí', retorn_envasos: 'palots', retorn_quantitat: 4, format_entrega: 'caixes',
      caixes: '6', disponible_fins: '30/11/2026', observacions: '  ',
    }, null, { causaCodigo: 'C4', subcausaCodigo: 'C4.2', causa: 'Preu', subcausa: 'Baix' })
    expect(f).toMatchObject({
      kg_total: 12.5, modalitats: ['venda'], modalitat: 'venda', preu_minim: 0.8,
      hora_recollida_inici: '08:00', hora_recollida_fi: '12:00', dies_recollida: [1, 3],
      retorn_envasos: 'Sí', retorn_envasos_detall: 'palots', retorn_envasos_quantitat: 4, num_caixes: 6,
      disponible_hasta: '2026-11-30', observacions: null, causa_codigo: 'C4', subcausa_codigo: 'C4.2',
    })
  })
  it('el precio sin venta y el coste sin donación no se guardan', () => {
    const f = filaDeDades({ producte: 'Pera', modalitat: ['maquila'], preu_minim: 1, cost_kg: 0.3 }, null, SENSE_CAUSA)
    expect(f.preu_minim).toBeNull()
    expect(f.coste_kg).toBeNull()
  })
})

describe('Comparteix', () => {
  it('solo lo que circula: ni esborrany, ni pendiente de validar, ni cerrada', () => {
    expect(esCompartible('publicada')).toBe(true)
    expect(esCompartible('parcial')).toBe(true)
    for (const e of ['esborrany', 'pendent_validacio', 'borrador', 'bloqueada', 'cerrada', 'cancelada', null]) {
      expect(esCompartible(e), String(e)).toBe(false)
    }
  })
  it('foto como fichero si el navegador sabe; si no, copiar y descargar', () => {
    expect(comCompartir({ teFitxer: true, potFitxers: true, potText: true })).toBe('fitxer')
    expect(comCompartir({ teFitxer: true, potFitxers: false, potText: true })).toBe('copia')
    expect(comCompartir({ teFitxer: false, potFitxers: false, potText: true })).toBe('text')
    expect(comCompartir({ teFitxer: false, potFitxers: false, potText: false })).toBe('copia')
  })
  it('el nombre del fichero: el producto, sin acentos, con la extensión de la ruta', () => {
    expect(nomFitxerFoto('Tomàquet de penjar', 'p/u.PNG')).toBe('tomaquet-de-penjar.png')
    expect(nomFitxerFoto(null, 'p/u')).toBe('oferta.jpg')
  })
})
