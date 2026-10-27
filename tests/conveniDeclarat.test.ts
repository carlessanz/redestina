// Los rechazos del convenio declarado (gestión autónoma, fase 1).
//
// Dos cosas: que el código se extraiga bien del mensaje de PostgREST (con y sin frase
// detrás, y sin confundir `tipus_desconegut` con `tipus_org_desconegut`), y que **todas las
// claves compuestas existan en ca y en es** — `cobertura.test.ts` solo ve literales.

import { describe, expect, it } from 'vitest'
import {
  CAMPS_FITXA_DECLARAT, clauCampFitxa, errorConveniDeclarat, MOTIUS_DECLARAT,
  textSignantValid, tipusConveniDeclarat,
} from '../src/lib/conveniDeclarat'
import { DICTS } from '../src/lib/i18n'

describe('errorConveniDeclarat: del error de la base a un motivo', () => {
  it('reconoce cada código, solo o con su frase', () => {
    for (const codi of MOTIUS_DECLARAT) {
      expect(errorConveniDeclarat({ missatge: codi }).codi, codi).toBe(codi)
      expect(errorConveniDeclarat({ missatge: `${codi}: una frase` }).clau, codi).toBe(`cdecl.err_${codi}`)
    }
  })

  it('no confunde un código con otro que lo contiene', () => {
    expect(errorConveniDeclarat({ missatge: 'tipus_org_desconegut' }).codi).toBe('tipus_org_desconegut')
    expect(errorConveniDeclarat({ missatge: "tipus_desconegut: el conveni d'aquest paper es col_receptor" }).codi)
      .toBe('tipus_desconegut')
  })

  it('un 42501 es falta de permiso, diga lo que diga', () => {
    const e = errorConveniDeclarat({ missatge: 'permission denied', codi: '42501' })
    expect(e.codi).toBe('no_autoritzat')
    expect(e.clau).toBe('cdecl.err_no_autoritzat')
  })

  it('falta_dades_fitxa trae los campos del detail', () => {
    const e = errorConveniDeclarat({ missatge: 'falta_dades_fitxa', detall: 'nif, domicili', codi: '22023' })
    expect(e.codi).toBe('falta_dades_fitxa')
    expect(e.camps).toEqual(['nif', 'domicili'])
    expect(errorConveniDeclarat({ missatge: 'falta_dades_fitxa', detall: null }).camps).toEqual([])
  })

  it('lo que no es suyo cae al error genérico, sin inventar un motivo', () => {
    expect(errorConveniDeclarat({ missatge: 'Failed to fetch' })).toEqual({ codi: null, clau: 'conv.err_generic', camps: [] })
    expect(errorConveniDeclarat({ missatge: 'parla de ja_vigent de passada' }).codi).toBeNull()
    expect(errorConveniDeclarat({}).codi).toBeNull()
  })
})

describe('campos, tipo y límites', () => {
  it('clauCampFitxa: los conocidos con su clave, el resto null', () => {
    expect(clauCampFitxa('nif')).toBe('cdecl.camp_nif')
    expect(clauCampFitxa('domicili')).toBe('cdecl.camp_domicili')
    expect(clauCampFitxa('altre')).toBeNull()
  })
  it('el tipo sale del papel', () => {
    expect(tipusConveniDeclarat('productor')).toBe('col_productor')
    expect(tipusConveniDeclarat('entidad')).toBe('col_receptor')
  })
  it('nombre y cargo de 2 a 120 caracteres, sin contar los espacios de los lados', () => {
    expect(textSignantValid(' a ')).toBe(false)
    expect(textSignantValid('Jo')).toBe(true)
    expect(textSignantValid('x'.repeat(120))).toBe(true)
    expect(textSignantValid('x'.repeat(121))).toBe(false)
  })
})

describe('las claves compuestas existen en ca y en es', () => {
  const claus = [
    ...MOTIUS_DECLARAT.map((c) => `cdecl.err_${c}`),
    ...CAMPS_FITXA_DECLARAT.map((c) => `cdecl.camp_${c}`),
  ]
  it.each(claus)('%s', (clau) => {
    expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
    expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
  })
})
