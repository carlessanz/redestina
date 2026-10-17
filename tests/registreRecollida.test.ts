// «Registra la recollida» del receptor (17-10-2026): la misma regla que la base
// (`registrar_recollida()`, 20270426100000), comprobada antes de pulsar.

import { describe, expect, it } from 'vitest'
import {
  clauErrorBase, clauErrorValidacio, diferenciaKg, ERRORS_BASE, ERRORS_VALIDACIO, estatValidacio,
  kgDelRegistre, llegeixKg, validacioCalMotiu, validaRegistre,
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

// 17-10-2026 (regla de Carles): el equipo valida el registro antes de generar los albaranes.
describe('estatValidacio: el registro frente a la validación del equipo', () => {
  const t0 = '2026-10-17T08:00:00Z'
  const t1 = '2026-10-17T09:00:00Z'
  it('sin registro, sin nada', () => {
    expect(estatValidacio({})).toBe('sense_registre')
  })
  it('registrada y sin validar: pendiente', () => {
    expect(estatValidacio({ recollida_registrada_at: t0 })).toBe('pendent_validacio')
  })
  it('validada manda sobre todo', () => {
    expect(estatValidacio({ recollida_registrada_at: t0, recollida_validada_at: t1 })).toBe('validada')
  })
  it('retornada, borre o no la base la fecha del registro', () => {
    expect(estatValidacio({ recollida_retornada_at: t1 })).toBe('retornada')
    expect(estatValidacio({ recollida_registrada_at: t0, recollida_retornada_at: t1 })).toBe('retornada')
  })
  it('un registro posterior a la devolución vuelve a estar pendiente', () => {
    expect(estatValidacio({ recollida_registrada_at: t1, recollida_retornada_at: t0 })).toBe('pendent_validacio')
  })
})

describe('validacioCalMotiu: cuándo exige motivo la validación', () => {
  it('lo declarado y coincide con lo asignado: no', () => {
    expect(validacioCalMotiu({ kg: 100, kgAssignats: 100, kgDeclarats: 100 })).toBe(false)
  })
  it('con diferencia frente a lo asignado: sí', () => {
    expect(validacioCalMotiu({ kg: 95, kgAssignats: 100, kgDeclarats: 95 })).toBe(true)
  })
  it('si el admin corrige lo declarado: sí', () => {
    expect(validacioCalMotiu({ kg: 100, kgAssignats: 100, kgDeclarats: 95 })).toBe(true)
  })
  it('sin kilos válidos no decide (el error es de los kilos)', () => {
    expect(validacioCalMotiu({ kg: null, kgAssignats: 100, kgDeclarats: 95 })).toBe(false)
  })
})

describe('clauErrorValidacio: los rechazos de validar y retornar', () => {
  it('por su código, y cal_motiu_validacio antes que cal_motiu', () => {
    expect(clauErrorValidacio('cal_motiu_validacio: …', '22023')).toBe('vrec.err_cal_motiu')
    expect(clauErrorValidacio('cal_motiu', '22023')).toBe('vrec.err_cal_motiu_retorn')
    expect(clauErrorValidacio('ja_validada', '22023')).toBe('vrec.err_ja_validada')
    expect(clauErrorValidacio('no_registrada', '22023')).toBe('vrec.err_no_registrada')
    expect(clauErrorValidacio('lo que sea', '42501')).toBe('vrec.err_permis')
    expect(clauErrorValidacio('otro', null)).toBeNull()
  })
  it('cada clave existe en los dos idiomas', () => {
    for (const [, clau] of ERRORS_VALIDACIO) {
      expect((DICTS.ca as Record<string, string>)[clau], clau).toBeTruthy()
      expect((DICTS.es as Record<string, string>)[clau], clau).toBeTruthy()
    }
  })
})
