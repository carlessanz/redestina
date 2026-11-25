// La regla ÚNICA de modalidades y «Espigolada» del alta y la edición (proceso 3.4; fase 3 del
// plan de noviembre de 2026). Es la misma que imponen `dadesAmbEspigolada()` (alta) y
// `editar_oferta()` (20270617100300): si diverge, la pantalla promete lo que la base rechaza.

import { describe, expect, it } from 'vitest'
import {
  ambReglaEspigolada, esOfertaEspigolada, espigoladaMarcada, ofereixEspigolada, producteAlCamp,
  triaEspigolada, triaModalitat,
} from '../src/lib/modalitatsOferta'
import { dadesAmbEspigolada } from '../supabase/functions/_shared/oferta.ts'

const OPCIONS = ['donacio', 'venda', 'maquila']

describe('cuándo aparece «Espigolada»', () => {
  it('solo con el producto en el campo (formulario `si` o fila `true`)', () => {
    expect(producteAlCamp('si')).toBe(true)
    expect(producteAlCamp(true)).toBe(true)
    expect(producteAlCamp('no')).toBe(false)
    expect(producteAlCamp(undefined)).toBe(false)
    expect(ofereixEspigolada({ producte_al_camp: 'si' })).toBe(true)
    expect(ofereixEspigolada({ producte_al_camp: 'no' })).toBe(false)
    expect(ofereixEspigolada({})).toBe(false)
  })

  it('marcada sin producto en el campo no cuenta', () => {
    expect(espigoladaMarcada({ producte_al_camp: 'si', espigolada: true })).toBe(true)
    expect(espigoladaMarcada({ producte_al_camp: 'no', espigolada: true })).toBe(false)
  })
})

describe('las casillas', () => {
  it('marcar «Espigolada» deja solo donación y el producto en el campo', () => {
    expect(triaEspigolada(true)).toEqual({ espigolada: true, modalitat: ['donacio'], producte_al_camp: 'si' })
    expect(triaEspigolada(false)).toEqual({ espigolada: false, modalitat: [] })
  })

  it('marcar una modalidad desmarca la espigolada y empieza de cero', () => {
    const d = { producte_al_camp: 'si', espigolada: true, modalitat: ['donacio'] }
    expect(triaModalitat(d, OPCIONS, 'venda', true)).toEqual({ modalitat: ['venda'], espigolada: false })
  })

  it('sin espigolada, las modalidades se suman y se quitan en el orden de las opciones', () => {
    const d = { producte_al_camp: 'no', modalitat: ['venda'] }
    expect(triaModalitat(d, OPCIONS, 'donacio', true)).toEqual({ modalitat: ['donacio', 'venda'] })
    expect(triaModalitat(d, OPCIONS, 'venda', false)).toEqual({ modalitat: [] })
  })
})

describe('el producto deja de estar en el campo', () => {
  it('la espigolada se desmarca y las modalidades se quedan', () => {
    expect(ambReglaEspigolada({ producte_al_camp: 'no', espigolada: true, modalitat: ['donacio'] }))
      .toEqual({ producte_al_camp: 'no', espigolada: false, modalitat: ['donacio'] })
  })
  it('sin nada que corregir devuelve el mismo objeto', () => {
    const d = { producte_al_camp: 'si', espigolada: true }
    expect(ambReglaEspigolada(d)).toBe(d)
  })
})

describe('paridad con el servidor (alta)', () => {
  it('lo que deja la casilla es lo que guarda `dadesAmbEspigolada`', () => {
    const r = triaEspigolada(true)
    const servidor = dadesAmbEspigolada({ espigolada: true, producte_al_camp: 'no', modalitat: ['venda'] })
    expect(servidor).toMatchObject({ espigolada: true, producte_al_camp: r.producte_al_camp, modalitat: r.modalitat })
  })
})

describe('esOfertaEspigolada', () => {
  it('manda `tipus_operacio`; sin ella, se deduce como la columna generada', () => {
    expect(esOfertaEspigolada({ tipus_operacio: 'espigolada' })).toBe(true)
    expect(esOfertaEspigolada({ tipus_operacio: 'excedent', espigolada_demanada: true })).toBe(false)
    expect(esOfertaEspigolada({ espigolada_demanada: true })).toBe(true)
    expect(esOfertaEspigolada({ espigolada_id: 'j-1' })).toBe(true)
    expect(esOfertaEspigolada({})).toBe(false)
  })
})
