import { describe, expect, it } from 'vitest'
import { categoriaDeFamilia } from '../src/lib/filtresMercat'

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
