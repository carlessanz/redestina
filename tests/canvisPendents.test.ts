// Cambios sin guardar de la ficha (Taula mestra 1.1, 25-11-2026): una recarga que pide un
// bloque que guarda al momento no puede pisar lo escrito y aún no guardado.

import { describe, expect, it } from 'vitest'
import { clausCanviades, fusionaRecarrega, mateixJson } from '../src/lib/canvisPendents'

describe('fusionaRecarrega', () => {
  it('conserva lo tocado y refresca lo no tocado', () => {
    const vell = { nom: 'Mas A', telefon: '600000000', notes: null }
    const nou = { nom: 'Mas A', telefon: '611111111', notes: 'de la base' }
    const valors = { nom: 'Mas B', telefon: '600000000', notes: null }
    expect(fusionaRecarrega(vell, nou, valors)).toEqual({ nom: 'Mas B', telefon: '611111111', notes: 'de la base' })
  })

  it('compara arrays y objetos por su contenido', () => {
    const vell = { prods: ['Poma'], perfil: { a: 1 } }
    const nou = { prods: ['Poma', 'Pera'], perfil: { a: 2 } }
    // Mismo contenido, otro objeto: no está tocado.
    expect(fusionaRecarrega(vell, nou, { prods: ['Poma'], perfil: { a: 1 } })).toEqual(nou)
    // Tocado: se queda lo de la pantalla.
    expect(fusionaRecarrega(vell, nou, { prods: ['Poma', 'Kiwi'], perfil: { a: 1 } }))
      .toEqual({ prods: ['Poma', 'Kiwi'], perfil: { a: 2 } })
  })

  it('un campo que aparece en la base y no estaba en pantalla se toma de la base', () => {
    expect(fusionaRecarrega({}, { nou: 'x' }, {})).toEqual({ nou: 'x' })
  })

  it('null y undefined cuentan igual', () => {
    expect(fusionaRecarrega({ a: undefined }, { a: 'base' }, { a: null })).toEqual({ a: 'base' })
  })

  it('usa la comparación que se le da (p. ej. la normalización de la ficha)', () => {
    const igual = (_k: string, a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim()
    // «  Mas  » frente a «Mas»: para la ficha no es un cambio, así que toma la base.
    expect(fusionaRecarrega({ nom: 'Mas' }, { nom: 'Mas nou' }, { nom: ' Mas ' }, igual)).toEqual({ nom: 'Mas nou' })
  })
})

describe('clausCanviades', () => {
  it('dice qué claves difieren', () => {
    expect(clausCanviades({ a: 1, b: [1], c: null }, { a: 1, b: [2], d: undefined })).toEqual(['b'])
  })
  it('sin cambios, vacío', () => {
    expect(clausCanviades({ a: { x: 1 } }, { a: { x: 1 } })).toEqual([])
  })
  it('mateixJson: null y undefined iguales', () => {
    expect(mateixJson('k', null, undefined)).toBe(true)
    expect(mateixJson('k', '', null)).toBe(false)
  })
})
