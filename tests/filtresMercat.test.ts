import { describe, expect, it } from 'vitest'
import { categoriaDeFamilia, filtraMercat, opcionsMercat } from '../src/lib/filtresMercat'

describe('categoriaDeFamilia', () => {
  it('agrupa las familias del catálogo en las categorías de la ficha del receptor', () => {
    expect(categoriaDeFamilia('Fruita Dolça')).toBe('fruita')
    expect(categoriaDeFamilia('Fruita Cítrics')).toBe('fruita')
    expect(categoriaDeFamilia('Fruita Seca')).toBe('fruita_seca')
    expect(categoriaDeFamilia('Horta Fruit')).toBe('verdura')
    expect(categoriaDeFamilia('Horta Fulla')).toBe('verdura')
    expect(categoriaDeFamilia('Horta Tub/Bul/Arr')).toBe('tuberculs')
    expect(categoriaDeFamilia('Bolets')).toBe('altres')
    expect(categoriaDeFamilia(null)).toBe('altres')
  })
})

const ofertes = [
  { id: 1, comarca: 'Maresme', familia: 'Horta Fruit' },
  { id: 2, comarca: 'Maresme', familia: 'Fruita Dolça' },
  { id: 3, comarca: 'Segrià', familia: 'Fruita Dolça' },
  { id: 4, comarca: null, familia: 'Horta Fulla' },
]

describe('filtraMercat', () => {
  it('sin filtros devuelve todo', () => {
    expect(filtraMercat(ofertes, { comarca: '', categoria: '' })).toHaveLength(4)
  })
  it('combina zona y tipo', () => {
    expect(filtraMercat(ofertes, { comarca: 'Maresme', categoria: 'verdura' }).map((o) => o.id)).toEqual([1])
  })
  it('una oferta sin comarca solo sale sin filtro de zona', () => {
    expect(filtraMercat(ofertes, { comarca: 'Maresme', categoria: '' }).map((o) => o.id)).toEqual([1, 2])
    expect(filtraMercat(ofertes, { comarca: '', categoria: 'verdura' }).map((o) => o.id)).toEqual([1, 4])
  })
})

describe('opcionsMercat', () => {
  it('ofrece solo comarcas y categorías con ofertas', () => {
    expect(opcionsMercat(ofertes)).toEqual({ comarques: ['Maresme', 'Segrià'], categories: ['fruita', 'verdura'] })
  })
})
