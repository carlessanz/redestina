// El alta multiproducto en el formulario (plan DIC 26, fase 6a): filas ↔ `productes[]`, la
// validación local, los duplicados y el camino de un solo producto intacto.

import { describe, expect, it } from 'vitest'
import {
  caben, clauErrorProductes, cosAmbProductes, desDeCos, errorsFiles, filaBuida, filaDelIndex, filaEnBlanc, filesUtils,
  MAX_PRODUCTES, type FilaProducte,
} from '../src/lib/altaMultiproducte'
import { agrupaProductes } from '../supabase/functions/_shared/disponibilitat'
import { DICTS } from '../src/lib/i18n'

const familia = (p: string) => ({ Tomàquet: 'Hortalissa', Pebrot: 'Hortalissa', Poma: 'Fruita Dolça' } as Record<string, string>)[p] ?? null

function fila(p: Partial<FilaProducte>): FilaProducte {
  return { ...filaBuida(), ...p }
}

const COMU = {
  familia: 'Hortalissa', producte: 'Tomàquet', varietat: 'Cor de bou', kg: 300, caixes: 12, cost_kg: 0.5,
  producte_al_camp: 'no', format_entrega: 'caixes', retorn: 'No', ubicacio: 'u1', disponible_fins: '31/12/2027',
  dies_recollida: [1, 3], horari: { inici: '08:00', fi: '12:00' }, modalitat: ['donacio', 'venda'], preu_minim: 0.8,
  causa: 'C4.2', observacions: 'obs', fotos: ['p/a.jpg'],
}

describe('cosAmbProductes: lo que se manda', () => {
  it('sin filas (o solo en blanco) devuelve el MISMO objeto: el alta de un producto no cambia', () => {
    expect(cosAmbProductes(COMU, [], familia)).toBe(COMU)
    expect(cosAmbProductes(COMU, [filaBuida(), filaBuida()], familia)).toBe(COMU)
    expect('productes' in cosAmbProductes(COMU, [filaBuida()], familia)).toBe(false)
  })

  it('con filas: lo común una vez y el primero sacado de los campos de siempre', () => {
    const cos = cosAmbProductes(COMU, [
      fila({ producte: 'Pebrot', kg: '120', varietat: ' Italià ' }),
      fila({ producte: 'Poma', kg: '80,5', caixes: '4', preu_minim: '1.2' }),
    ], familia)
    const { productes, ...comuns } = cos
    expect(productes).toEqual([
      { familia: 'Hortalissa', producte: 'Tomàquet', varietat: 'Cor de bou', kg: 300, caixes: 12, cost_kg: 0.5 },
      { producte: 'Pebrot', varietat: 'Italià', kg: 120, familia: 'Hortalissa' },
      { producte: 'Poma', kg: 80.5, caixes: 4, preu_minim: 1.2, familia: 'Fruita Dolça' },
    ])
    // Lo que no es de cada producto queda común; el precio mínimo también (se hereda).
    expect(comuns).toMatchObject({ ubicacio: 'u1', modalitat: ['donacio', 'venda'], preu_minim: 0.8, causa: 'C4.2', fotos: ['p/a.jpg'] })
    for (const k of ['producte', 'varietat', 'kg', 'familia', 'caixes', 'cost_kg']) expect(comuns).not.toHaveProperty(k)
  })

  it('el servidor lo parte en un grupo: la variedad, las cajas y el coste del primero no se heredan', () => {
    const cos = cosAmbProductes(COMU, [fila({ producte: 'Pebrot', kg: '120' })], familia)
    const g = agrupaProductes(cos)
    expect(g.tipus).toBe('grup')
    if (g.tipus !== 'grup') return
    expect(g.dades).toHaveLength(2)
    expect(g.dades[1]).toMatchObject({ producte: 'Pebrot', kg: 120, preu_minim: 0.8, ubicacio: 'u1' })
    expect(g.dades[1]).not.toHaveProperty('varietat')
    expect(g.dades[1]).not.toHaveProperty('caixes')
    expect(g.dades[1]).not.toHaveProperty('cost_kg')
    expect(g.dades[0]).toMatchObject({ producte: 'Tomàquet', varietat: 'Cor de bou', caixes: 12, cost_kg: 0.5 })
  })
})

describe('desDeCos: lo guardado vuelve al formulario', () => {
  it('sin productes, tal cual', () => {
    const r = desDeCos(COMU)
    expect(r.datos).toBe(COMU)
    expect(r.extres).toEqual([])
  })

  it('ida y vuelta: los campos del primero y las filas del resto', () => {
    const cos = cosAmbProductes(COMU, [fila({ producte: 'Pebrot', kg: '120', varietat: 'Italià', preu_minim: '0.9' })], familia)
    const r = desDeCos(cos)
    expect(r.datos).toMatchObject({ producte: 'Tomàquet', varietat: 'Cor de bou', kg: 300, caixes: 12, cost_kg: 0.5, preu_minim: 0.8 })
    expect(r.datos).not.toHaveProperty('productes')
    expect(r.extres).toHaveLength(1)
    expect(r.extres[0]).toMatchObject({ producte: 'Pebrot', varietat: 'Italià', kg: '120', caixes: '', preu_minim: '0.9' })
    // Y vuelve a dar el mismo cuerpo.
    expect(cosAmbProductes(r.datos, r.extres, familia)).toEqual(cos)
  })

  it('una lista vacía o con basura no inventa filas', () => {
    expect(desDeCos({ producte: 'Poma', productes: [] })).toEqual({ datos: { producte: 'Poma' }, extres: [] })
    expect(desDeCos({ producte: 'Poma', productes: 'x' })).toEqual({ datos: { producte: 'Poma' }, extres: [] })
  })
})

describe('errorsFiles: validación local', () => {
  const principal = { producte: 'Tomàquet', varietat: 'Cor de bou' }

  it('publicar exige producto y kilos; un esborrany, solo el producto', () => {
    const a = fila({ producte: 'Pebrot' })
    const b = fila({ kg: '10' })
    expect(errorsFiles(principal, [a, b], { publicar: true })).toEqual({ [a.clau]: 'mp.err_kg', [b.clau]: 'mp.err_falta_producte' })
    expect(errorsFiles(principal, [a, b], { publicar: false })).toEqual({ [b.clau]: 'mp.err_falta_producte' })
  })

  it('kilos, cajas y precio con mal formato', () => {
    const a = fila({ producte: 'Pebrot', kg: '0' })
    const b = fila({ producte: 'Poma', kg: '5', caixes: '2.5' })
    const c = fila({ producte: 'Ceba', kg: '5', preu_minim: '-1' })
    expect(errorsFiles(principal, [a, b, c], { publicar: false })).toEqual({
      [a.clau]: 'mp.err_kg', [b.clau]: 'mp.err_caixes', [c.clau]: 'mp.err_preu',
    })
  })

  it('repetidos: mismo producto y variedad (sin acentos ni mayúsculas) que el primero o que otra fila', () => {
    const a = fila({ producte: 'Tomàquet', varietat: 'cor de BOU', kg: '1' })
    const b = fila({ producte: 'Tomàquet', varietat: 'Pera', kg: '1' })
    const c = fila({ producte: 'Tomàquet', varietat: 'pera', kg: '1' })
    expect(errorsFiles(principal, [a, b, c], { publicar: true })).toEqual({ [a.clau]: 'mp.err_repetit', [c.clau]: 'mp.err_repetit' })
  })

  it('las filas en blanco no cuentan', () => {
    expect(errorsFiles(principal, [filaBuida()], { publicar: true })).toEqual({})
    expect(filaEnBlanc(filaBuida())).toBe(true)
    expect(filesUtils([filaBuida(), fila({ producte: 'Poma' })])).toHaveLength(1)
  })
})

describe('el resto', () => {
  it('caben: el primero cuenta, como mucho MAX_PRODUCTES', () => {
    expect(caben(Array.from({ length: MAX_PRODUCTES - 2 }, filaBuida))).toBe(true)
    expect(caben(Array.from({ length: MAX_PRODUCTES - 1 }, filaBuida))).toBe(false)
  })

  it('filaDelIndex: 0 es el primero (campos de siempre); ≥1, la fila enviada', () => {
    const a = fila({ producte: 'Pebrot' })
    const b = fila({ producte: 'Poma' })
    expect(filaDelIndex(0, [a, b])).toBeNull()
    expect(filaDelIndex(1, [a, b])).toBe(a)
    expect(filaDelIndex(2, [a, b])).toBe(b)
    expect(filaDelIndex(3, [a, b])).toBeNull()
    expect(filaDelIndex(undefined, [a, b])).toBeNull()
  })

  it('los códigos del servidor tienen texto en los dos idiomas', () => {
    for (const code of ['productes_invalid', 'massa_productes', 'falta_producte', 'producte_repetit', 'producte_invalid', 'kg_invalid']) {
      const clau = clauErrorProductes(code)
      expect(clau).not.toBeNull()
      expect(DICTS.ca[clau!]).toBeTruthy()
      expect(DICTS.es[clau!]).toBeTruthy()
    }
    expect(clauErrorProductes('campos_faltantes')).toBeNull()
    for (const k of ['mp.err_caixes', 'mp.err_preu', 'mp.err_fila_generic']) expect(DICTS.es[k]).toBeTruthy()
  })
})
