// Qué foto enseña una oferta (27-09-2026) y el coste que declara el productor.
//
// La regla de la foto la comparten el Mercat, Interessos, Històric y los listados del
// productor, y equivocarse no da ningún error: una oferta sin foto enseñaría la de otro
// producto, o una desactivada seguiría enseñando la del catálogo.

import { describe, it, expect } from 'vitest'
import { classeIcona, fotoPrincipal } from '../src/lib/fotoOferta'
import type { ProducteFoto } from '../src/lib/fotoOferta'
import { costDeclarat } from '../supabase/functions/_shared/oferta.ts'
import { eurKg } from '../supabase/functions/_shared/intake.ts'

const cataleg = new Map<string, ProducteFoto>([
  ['Tomàquet', { familia: 'Horta Fruit', foto: 'tomaquet.webp', foto_mini: 'tomaquet-mini.webp' }],
  ['Taronja', { familia: 'Fruita Cítrics', foto: null, foto_mini: null }],
])

describe('fotoPrincipal', () => {
  it('con fotos propias, la primera de la oferta', () => {
    expect(fotoPrincipal({ producto: 'Tomàquet', fotos: ['p/a.jpg', 'p/b.jpg'] }, cataleg))
      .toEqual({ tipus: 'oferta', ruta: 'p/a.jpg' })
  })

  it('sin fotos, la del producto (grande y miniatura)', () => {
    expect(fotoPrincipal({ producto: 'Tomàquet', fotos: [] }, cataleg))
      .toEqual({ tipus: 'producte', ruta: 'tomaquet.webp', mini: 'tomaquet-mini.webp' })
  })

  it('`foto_producte` ausente vale sí (el defecto de la columna)', () => {
    expect(fotoPrincipal({ producto: 'Tomàquet' }, cataleg).tipus).toBe('producte')
  })

  it('desactivada, el icono de su familia aunque el producto tenga foto', () => {
    expect(fotoPrincipal({ producto: 'Tomàquet', fotos: [], foto_producte: false }, cataleg))
      .toEqual({ tipus: 'generica', familia: 'Horta Fruit' })
  })

  it('producto sin foto, o fuera del catálogo: el icono', () => {
    expect(fotoPrincipal({ producto: 'Taronja', fotos: [] }, cataleg))
      .toEqual({ tipus: 'generica', familia: 'Fruita Cítrics' })
    expect(fotoPrincipal({ producto: 'Inventat', fotos: null }, cataleg))
      .toEqual({ tipus: 'generica', familia: null })
  })

  it('las fotos propias mandan aunque esté desactivada la del producto', () => {
    expect(fotoPrincipal({ producto: 'Tomàquet', fotos: ['p/a.jpg'], foto_producte: false }, cataleg).tipus)
      .toBe('oferta')
  })
})

describe('classeIcona', () => {
  it('una clave por familia del catálogo', () => {
    expect(classeIcona('Fruita Cítrics')).toBe('citric')
    expect(classeIcona('Fruita Dolça')).toBe('fruita')
    expect(classeIcona('Fruita Vermella')).toBe('vermella')
    expect(classeIcona('Fruita Seca')).toBe('seca')
    expect(classeIcona('Fruita Exòtica')).toBe('exotica')
    expect(classeIcona('Horta Fulla')).toBe('fulla')
    expect(classeIcona('Horta Tub/Bul/Arr')).toBe('arrel')
    expect(classeIcona('Horta Fruit')).toBe('horta')
    expect(classeIcona('Horta Flor')).toBe('horta')
    expect(classeIcona('Varis')).toBe('gra')
    expect(classeIcona('Bolets')).toBe('generic')
    expect(classeIcona(null)).toBe('generic')
  })
})

describe('el coste que declara el productor', () => {
  it('acepta un número positivo, con coma o punto', () => {
    expect(costDeclarat(0.6)).toBe(0.6)
    expect(costDeclarat('0,85')).toBe(0.85)
  })

  it('vacío, cero, negativo o texto: no ha declarado nada', () => {
    for (const v of [undefined, null, '', 0, -1, 'no ho sé']) expect(costDeclarat(v)).toBeNull()
  })

  it('el botón del bot lo escribe como se lee en català, y cabe en 20 caracteres', () => {
    expect(eurKg(0.6)).toBe('0,60 €/kg')
    expect(`Mantenir ${eurKg(12.5)}`.length).toBeLessThanOrEqual(20)
  })
})
