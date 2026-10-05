// La franja de recogida (05-10-2026). El bot recibe texto libre y lo intenta leer; ante la
// duda, null — una franja inventada acabaría en un aviso a una hora que nadie dijo.

import { describe, expect, it } from 'vitest'
import { esFranjaValida, horaDe, llegeixHorari, parseFranja, textFranja } from '../supabase/functions/_shared/franja.ts'
import * as web from '../src/lib/franja'

describe('franja · servidor', () => {
  it('horaDe', () => {
    expect(horaDe('9')).toBe('09:00')
    expect(horaDe('9h')).toBe('09:00')
    expect(horaDe('9:30')).toBe('09:30')
    expect(horaDe('09.30')).toBe('09:30')
    expect(horaDe('25')).toBeNull()
    expect(horaDe('9:75')).toBeNull()
  })
  it.each([
    ['de 9 a 12', { inici: '09:00', fi: '12:00' }],
    ['9-12', { inici: '09:00', fi: '12:00' }],
    ['9h-12h', { inici: '09:00', fi: '12:00' }],
    ['9:30 a 13:15', { inici: '09:30', fi: '13:15' }],
    ['entre 8 i 10', { inici: '08:00', fi: '10:00' }],
    ['de 8 fins a les 11', { inici: '08:00', fi: '11:00' }],
    ['matí', { inici: '08:00', fi: '13:00' }],
    ['Por la tarde', { inici: '15:00', fi: '19:00' }],
    ['tot el dia', { inici: '08:00', fi: '19:00' }],
  ])('parseFranja(%s)', (txt, esperat) => {
    expect(parseFranja(txt)).toEqual(esperat)
  })
  it('lo que no entiende o es imposible, null', () => {
    expect(parseFranja('quan vulguis')).toBeNull()
    expect(parseFranja('de 12 a 9')).toBeNull()
    expect(parseFranja('')).toBeNull()
    expect(parseFranja(42)).toBeNull()
  })
  it('textFranja', () => {
    expect(textFranja({ inici: '09:00', fi: '12:30' })).toBe('de 9:00 a 12:30')
  })
  it('llegeixHorari: objeto del panel, texto del bot y basura', () => {
    expect(llegeixHorari({ inici: '9:00', fi: '12:00' })).toEqual({ franja: { inici: '09:00', fi: '12:00' }, text: 'de 9:00 a 12:00' })
    expect(llegeixHorari({ inici: '12:00', fi: '9:00' })).toEqual({ franja: null, text: null })
    expect(llegeixHorari('matins')).toEqual({ franja: { inici: '08:00', fi: '13:00' }, text: 'matins' })
    expect(llegeixHorari('quan vulguis')).toEqual({ franja: null, text: 'quan vulguis' })
    expect(llegeixHorari(null)).toEqual({ franja: null, text: null })
  })
  it('esFranjaValida', () => {
    expect(esFranjaValida({ inici: '09:00', fi: '09:00' })).toBe(false)
    expect(esFranjaValida({ inici: '09:00', fi: '09:15' })).toBe(true)
  })
})

describe('franja · navegador', () => {
  it('desplegables de 06 a 22 y por cuartos', () => {
    expect(web.HORES[0]).toBe('06')
    expect(web.HORES.at(-1)).toBe('22')
    expect(web.QUARTS).toEqual(['00', '15', '30', '45'])
  })
  it('hhmm y textFranja con lo que devuelve Postgres', () => {
    expect(web.hhmm('09:00:00')).toBe('09:00')
    expect(web.textFranja('09:00:00', '12:30:00')).toBe('9:00–12:30')
    expect(web.textFranja(null, '12:30')).toBe('')
  })
  it('la misma regla de validez que el servidor', () => {
    for (const f of [{ inici: '09:00', fi: '12:00' }, { inici: '12:00', fi: '09:00' }, { inici: '09:00', fi: '09:00' }]) {
      expect(web.esFranjaValida(f)).toBe(esFranjaValida(f))
    }
  })
})
