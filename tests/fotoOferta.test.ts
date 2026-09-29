// Qué foto enseña una oferta (27-09-2026) y el coste que declara el productor.
//
// La regla de la foto la comparten el Mercat, Interessos, Històric y los listados del
// productor, y equivocarse no da ningún error: una oferta sin foto enseñaría la de otro
// producto, o una desactivada seguiría enseñando la del catálogo.

import { describe, it, expect } from 'vitest'
import { classeIcona, fotoPrincipal } from '../src/lib/fotoOferta'
import type { ProducteFoto } from '../src/lib/fotoOferta'
import { slugProducte } from '../src/lib/iconaProducte'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { costDeclarat } from '../supabase/functions/_shared/oferta.ts'
import { eurKg } from '../supabase/functions/_shared/intake.ts'

// Los 90 productos del catálogo el 29-09-2026 (`select nombre from productos`). Uno nuevo en
// la base sin su dibujo en `scripts/icones-productes.ts` saldría con el icono de su familia.
const CATALEG = [
  'Albercoc', 'Albergínia', 'Alfabrega', 'All', 'Alvocat', 'Ametlla', 'Api', 'Arròs', 'Avellana',
  'Blat de moro', 'Bleda', 'Bolet', 'Brócoli', 'Bròquil', 'Calçot', 'Carbassa', 'Carbassó', 'Card',
  'Carxofa', 'Ceba', 'Cigrons', 'Cirera', 'Coco', 'Codony', 'Cogombre', 'Col', 'Col de Brussel·les',
  'Coliflor', 'Colrave', 'Enciam', 'Escarola', 'Espàrrec', 'Espinac', 'Fava', 'Fesol', 'Figa',
  'Fonoll', 'Garrofa', 'Gerd', 'Julivert', 'Kaki', 'Kiwi', 'Lactic', 'Llima', 'Llimona', 'Maduixa',
  'Magrana', 'Mandarina', 'Mango', 'Meló', 'Menta', 'Mongeta', 'Moniato', 'Mores', 'Nabiu', 'Nap',
  'Nectarina', 'Nespre', 'Nous', 'Nyora', 'Olives', 'Ou', 'Paraguaià', 'Pastanaga', 'Patata',
  'Pebrot', 'Pera', 'Pèsol', 'Pinya', 'Plàtan', 'Poma', 'Porro', 'Préssec', 'Pruna', 'Raim', 'Rave',
  'Remolatxa', 'RETORN', 'Rucula', 'Sindria', 'Soja', 'Suc', 'Taronja', 'Tomàquet', 'Varis',
  'Xampinyó', 'Xicòria', 'Xirimoia', 'Xirivia', 'Yuca',
]

const cataleg = new Map<string, ProducteFoto>([
  ['Tomàquet', { familia: 'Horta Fruit' }],
  ['Taronja', { familia: 'Fruita Cítrics' }],
])

describe('fotoPrincipal', () => {
  it('con fotos propias, la primera de la oferta', () => {
    expect(fotoPrincipal({ producto: 'Tomàquet', fotos: ['p/a.jpg', 'p/b.jpg'] }, cataleg))
      .toEqual({ tipus: 'oferta', ruta: 'p/a.jpg' })
  })

  it('sin fotos, el icono del producto con su familia de respaldo', () => {
    expect(fotoPrincipal({ producto: 'Tomàquet', fotos: [] }, cataleg))
      .toEqual({ tipus: 'icona', producto: 'Tomàquet', familia: 'Horta Fruit' })
  })

  it('`foto_producte` ya no cambia nada: sin fotos, siempre el icono', () => {
    expect(fotoPrincipal({ producto: 'Taronja', fotos: [], foto_producte: false }, cataleg))
      .toEqual({ tipus: 'icona', producto: 'Taronja', familia: 'Fruita Cítrics' })
  })

  it('producto fuera del catálogo: icono sin familia', () => {
    expect(fotoPrincipal({ producto: 'Inventat', fotos: null }, cataleg))
      .toEqual({ tipus: 'icona', producto: 'Inventat', familia: null })
  })
})

describe('slugProducte', () => {
  it('quita acentos y signos: es el nombre del fichero del icono', () => {
    expect(slugProducte('Col de Brussel·les')).toBe('col-de-brussel-les')
    expect(slugProducte('Brócoli')).toBe('brocoli')
    expect(slugProducte('Bròquil')).toBe('broquil')
    expect(slugProducte('Blat de moro')).toBe('blat-de-moro')
    expect(slugProducte('RETORN')).toBe('retorn')
  })

  it('cada producto del catálogo tiene su icono en public/', () => {
    const dir = fileURLToPath(new URL('../public/icones-productes/', import.meta.url))
    const fitxers = new Set(readdirSync(dir))
    for (const nom of CATALEG) expect(fitxers.has(`${slugProducte(nom)}.svg`), nom).toBe(true)
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
