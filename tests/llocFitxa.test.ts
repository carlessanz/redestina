import { describe, expect, it } from 'vitest'
import { llocDeLaFitxa } from '../src/lib/llocFitxa'

describe('llocDeLaFitxa: el lugar que se propone desde la dirección de la ficha', () => {
  it('con dirección y municipio, propone los dos', () => {
    expect(llocDeLaFitxa({ direccion: ' Carrer Major, 3 ', codigo_postal: '08850', poblacion: 'Gavà', municipio_ine: '080898' }))
      .toEqual({ direccion: 'Carrer Major, 3', municipio_ine: '080898', text: 'Carrer Major, 3 · 08850 Gavà' })
  })
  it('solo con el municipio también propone (la dirección se escribe después)', () => {
    expect(llocDeLaFitxa({ direccion: null, codigo_postal: null, poblacion: 'Gavà', municipio_ine: '080898' }))
      .toEqual({ direccion: '', municipio_ine: '080898', text: 'Gavà' })
  })
  it('sin dirección ni municipio, nada', () => {
    expect(llocDeLaFitxa({ direccion: ' ', codigo_postal: '08850', poblacion: null, municipio_ine: null })).toBeNull()
    expect(llocDeLaFitxa(null)).toBeNull()
  })
})
