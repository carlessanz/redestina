// «Registra la recollida» del receptor (17-10-2026): la misma regla que la base
// (`registrar_recollida()`, 20270426100000), comprobada antes de pulsar.

import { describe, expect, it } from 'vitest'
import {
  clauErrorBase, diferenciaKg, ERRORS_BASE, kgDelRegistre, llegeixKg, validaRegistre,
} from '../src/lib/registreRecollida'
import { DICTS } from '../src/lib/i18n'

const ara = new Date('2026-10-17T10:00:00Z')
const base = { kg: '', kgAssignats: 100, observacions: '', data: null, ara }

describe('llegeixKg', () => {
  it('admite coma decimal y espacios', () => {
    expect(llegeixKg('42,5')).toBe(42.5)
    expect(llegeixKg(' 1 000 ')).toBe(1000)
    expect(llegeixKg('7')).toBe(7)
  })
  it('rechaza lo que no es un número', () => {
    expect(llegeixKg('')).toBeNull()
    expect(llegeixKg('-3')).toBeNull()
    expect(llegeixKg('diez')).toBeNull()
    expect(llegeixKg('1e3')).toBeNull()
  })
  it('redondea a dos decimales, como la base', () => {
    expect(llegeixKg('10,456')).toBe(10.46)
  })
})

describe('validaRegistre', () => {
  it('«coincideix» no pide nada más', () => {
    expect(validaRegistre({ ...base, resultat: 'coincideix' })).toBeNull()
    expect(kgDelRegistre({ ...base, resultat: 'coincideix', kg: '3' })).toBe(100)
  })
  it('«menys» exige menos de lo asignado, más de cero y un motivo', () => {
    expect(validaRegistre({ ...base, resultat: 'menys', kg: '' })).toBe('rrec.err_kg')
    expect(validaRegistre({ ...base, resultat: 'menys', kg: '0' })).toBe('rrec.err_kg_zero')
    expect(validaRegistre({ ...base, resultat: 'menys', kg: '100' })).toBe('rrec.err_no_menys')
    expect(validaRegistre({ ...base, resultat: 'menys', kg: '80' })).toBe('rrec.err_motiu')
    expect(validaRegistre({ ...base, resultat: 'menys', kg: '80', observacions: '  ' })).toBe('rrec.err_motiu')
    expect(validaRegistre({ ...base, resultat: 'menys', kg: '80', observacions: 'Caixes malmeses' })).toBeNull()
  })
  it('«més» exige más de lo asignado', () => {
    expect(validaRegistre({ ...base, resultat: 'mes', kg: '90', observacions: 'x' })).toBe('rrec.err_no_mes')
    expect(validaRegistre({ ...base, resultat: 'mes', kg: '110', observacions: 'x' })).toBeNull()
  })
  it('el motivo tiene tope', () => {
    expect(validaRegistre({ ...base, resultat: 'menys', kg: '80', observacions: 'a'.repeat(1001) })).toBe('rrec.err_motiu_llarg')
  })
  it('la fecha no puede ser futura (con 5 minutos de margen)', () => {
    expect(validaRegistre({ ...base, resultat: 'coincideix', data: '2026-10-17T10:04:00Z' })).toBeNull()
    expect(validaRegistre({ ...base, resultat: 'coincideix', data: '2026-10-17T11:00:00Z' })).toBe('rrec.err_data_futura')
  })
  it('la diferencia se calcula frente a lo asignado', () => {
    expect(diferenciaKg({ resultat: 'menys', kg: '95,5', kgAssignats: 100 })).toBe(-4.5)
    expect(diferenciaKg({ resultat: 'coincideix', kg: '', kgAssignats: 100 })).toBe(0)
  })
})

describe('los rechazos de la base', () => {
  it('se traducen por su código', () => {
    expect(clauErrorBase('ja_registrada', '22023')).toBe('rrec.err_ja_registrada')
    expect(clauErrorBase('falta_motiu_diferencia', '22023')).toBe('rrec.err_motiu')
    expect(clauErrorBase('Nomes l\'entitat receptora pot registrar aquesta recollida', '42501')).toBe('rrec.err_permis')
    expect(clauErrorBase('una altra cosa', null)).toBeNull()
  })
  it('cada texto existe en los dos idiomas', () => {
    const claus = new Set([...Object.values(ERRORS_BASE), 'rrec.err_permis'])
    for (const k of claus) {
      expect((DICTS.ca as Record<string, string>)[k], `${k} ca`).toBeTruthy()
      expect((DICTS.es as Record<string, string>)[k], `${k} es`).toBeTruthy()
    }
  })
})
