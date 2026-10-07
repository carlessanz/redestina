// Las dos comprobaciones de `crear-oferta` que deciden qué se le acepta y qué se le sirve
// a una sesión, aunque la función corra con `service_role` (§4bis).

import { describe, it, expect } from 'vitest'
import { fotosValides, veuCostReferencia } from '../supabase/functions/crear-oferta/validacio.ts'

const P = '11111111-2222-3333-4444-555555555555'
const ALTRE = '99999999-8888-7777-6666-555555555555'
const U = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

describe('fotosValides', () => {
  it('acepta la forma exacta que sube el panel', () => {
    expect(fotosValides([`${P}/${U}.jpg`], P)).toBe(true)
    expect(fotosValides([`${P}/${U}.webp`, `${P}/${U}.PNG`, `${P}/${U}.jpeg`], P)).toBe(true)
  })

  it('sin fotos (ausente o null) es válido', () => {
    expect(fotosValides(undefined, P)).toBe(true)
    expect(fotosValides(null, P)).toBe(true)
    expect(fotosValides([], P)).toBe(true)
  })

  it('rechaza más de 3', () => {
    expect(fotosValides([1, 2, 3, 4].map(() => `${P}/${U}.jpg`), P)).toBe(false)
  })

  it('rechaza la carpeta de otro productor', () => {
    expect(fotosValides([`${ALTRE}/${U}.jpg`], P)).toBe(false)
  })

  it('rechaza segmentos .. que salen de la carpeta', () => {
    expect(fotosValides([`${P}/../${ALTRE}/${U}.jpg`], P)).toBe(false)
    expect(fotosValides([`${P}/..`], P)).toBe(false)
  })

  it('rechaza barras dobles y subcarpetas', () => {
    expect(fotosValides([`${P}//${U}.jpg`], P)).toBe(false)
    expect(fotosValides([`${P}/sub/${U}.jpg`], P)).toBe(false)
  })

  it('rechaza nombres que no son <uuid>.<ext> o extensiones fuera del bucket', () => {
    expect(fotosValides([`${P}/foto.jpg`], P)).toBe(false)
    expect(fotosValides([`${P}/${U}.svg`], P)).toBe(false)
    expect(fotosValides([`${P}/${U}.jpg.exe`], P)).toBe(false)
    expect(fotosValides([`${P}/${U}`], P)).toBe(false)
  })

  it('rechaza lo que no es una cadena o un productor que no es uuid', () => {
    expect(fotosValides([42], P)).toBe(false)
    expect(fotosValides('x', P)).toBe(false)
    expect(fotosValides([`../${U}.jpg`], '..')).toBe(false)
  })
})

describe('veuCostReferencia', () => {
  it('el equipo lo ve (alta asistida)', () => {
    expect(veuCostReferencia({ esIntern: true, productores: [] })).toBe(true)
  })
  it('quien tiene ficha de productor lo ve (su panel)', () => {
    expect(veuCostReferencia({ esIntern: false, productores: ['p1'] })).toBe(true)
  })
  it('una receptora o una cuenta pendiente, no', () => {
    expect(veuCostReferencia({ esIntern: false, productores: [] })).toBe(false)
  })
})
