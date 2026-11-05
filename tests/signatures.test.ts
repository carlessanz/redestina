// El circuito de firma (05-11-2026): la parte pura de `src/lib/signatures.ts`.
//
// Lo importante es la MATRIZ de `accionsSignatura()`: es el único sitio que decide qué botón
// sale a quién, y un error aquí es un «Signa» ofrecido a quien la base rechaza (el operador,
// el CONV) o un «Tanca» a un técnico. Se recorre entera: estados × roles × tipos.

import { describe, expect, it } from 'vitest'
import { DICTS } from '../src/lib/i18n'
import {
  MAX_BYTES_SIGNAT, MIN_DNI, MIN_NOM, TIPUS_CANVAS, TIPUS_PUJABLES,
  accionsSignatura, clauEstatSignatura, clauQuiSigna, clauVia, esPujable, esSignableCanvas,
  estilEstatSignatura, megues, mostraEstatSignatura, panellQueSigna, rolSignatura,
  signantValid, validaFitxerSignat,
  type AccioSignatura, type RolSignatura,
} from '../src/lib/signatures'
import type { EstatSignatura } from '../src/types'

const ESTATS: EstatSignatura[] = ['pendent', 'signat', 'tancat']
const ROLS: RolSignatura[] = ['titular', 'operador', 'super_admin', 'equip']

describe('tipos firmables', () => {
  it('canvas: CD, CR, REC, ENT; el CONV solo se sube', () => {
    expect([...TIPUS_CANVAS]).toEqual(['CD', 'CR', 'REC', 'ENT'])
    expect([...TIPUS_PUJABLES]).toEqual(['CD', 'CR', 'REC', 'ENT', 'CONV'])
    expect(esSignableCanvas('CONV')).toBe(false)
    expect(esPujable('CONV')).toBe(true)
    for (const no of ['OPE', 'CT', 'RES', 'PLA', '', null, undefined]) {
      expect(esSignableCanvas(no)).toBe(false)
      expect(esPujable(no)).toBe(false)
    }
  })
  it('los mínimos son los del servidor', () => {
    expect(MIN_NOM).toBe(2)
    expect(MIN_DNI).toBe(5)
  })
  it('cada papel firma en su panel', () => {
    expect(panellQueSigna('productor')).toBe('/productor/documents')
    expect(panellQueSigna('entidad')).toBe('/receptor/documents')
  })
})

describe('rolSignatura', () => {
  it('super_admin > equipo > titular > operador', () => {
    expect(rolSignatura({ esIntern: true, esSuperAdmin: true, titular: false })).toBe('super_admin')
    expect(rolSignatura({ esIntern: true, esSuperAdmin: false, titular: true })).toBe('equip')
    expect(rolSignatura({ esIntern: false, esSuperAdmin: false, titular: true })).toBe('titular')
    expect(rolSignatura({ esIntern: false, esSuperAdmin: false, titular: false })).toBe('operador')
  })
})

describe('accionsSignatura · la matriz completa', () => {
  const crida = (estat: EstatSignatura, rol: RolSignatura, tipo: string, ambPdf = false) =>
    accionsSignatura({ estat, rol, tipo, admetCanvas: tipo !== 'CONV', ambPdf })

  it('titular + pendent + canvas → firmar o subir', () => {
    for (const tipo of TIPUS_CANVAS) expect(crida('pendent', 'titular', tipo)).toEqual(['signa', 'puja'])
  })
  it('titular + CONV → nada (va por su circuito)', () => {
    for (const e of ESTATS) expect(crida(e, 'titular', 'CONV')).toEqual([])
  })
  it('titular con la firma ya enviada o cerrada → nada', () => {
    for (const tipo of TIPUS_CANVAS) {
      expect(crida('signat', 'titular', tipo, true)).toEqual([])
      expect(crida('tancat', 'titular', tipo)).toEqual([])
    }
  })
  it('el operador nunca firma', () => {
    for (const e of ESTATS) for (const tipo of TIPUS_PUJABLES) expect(crida(e, 'operador', tipo, true)).toEqual([])
  })
  it('super_admin + pendent → subir el firmado (también el CONV)', () => {
    for (const tipo of TIPUS_PUJABLES) expect(crida('pendent', 'super_admin', tipo)).toEqual(['puja_equip'])
  })
  it('super_admin + signat → revisar el fichero, cerrar o rechazar', () => {
    for (const tipo of TIPUS_PUJABLES) {
      expect(crida('signat', 'super_admin', tipo, true)).toEqual(['veure_fitxer', 'tanca', 'rebutja'])
      expect(crida('signat', 'super_admin', tipo, false)).toEqual(['tanca', 'rebutja'])
    }
  })
  it('el resto del equipo no actúa', () => {
    for (const e of ESTATS) for (const tipo of TIPUS_PUJABLES) expect(crida(e, 'equip', tipo, true)).toEqual([])
  })
  it('tancat → nada para nadie', () => {
    for (const rol of ROLS) for (const tipo of TIPUS_PUJABLES) expect(crida('tancat', rol, tipo, true)).toEqual([])
  })
  it('un tipo que no se firma → nada para nadie', () => {
    for (const rol of ROLS) for (const e of ESTATS) expect(crida(e, rol, 'OPE', true)).toEqual([])
  })
  it('un CONV con admetCanvas=true por error sigue sin «Signa» al titular', () => {
    expect(accionsSignatura({ estat: 'pendent', rol: 'titular', tipo: 'CONV', admetCanvas: true, ambPdf: false })).toEqual([])
  })
})

describe('estados, vías y colores', () => {
  it('la clave depende de la perspectiva salvo en tancat', () => {
    expect(clauEstatSignatura('pendent', 'usuari')).toBe('sgn.st_pendent_usuari')
    expect(clauEstatSignatura('pendent', 'equip')).toBe('sgn.st_pendent_equip')
    expect(clauEstatSignatura('signat', 'equip')).toBe('sgn.st_signat_equip')
    expect(clauEstatSignatura('tancat', 'usuari')).toBe('sgn.st_tancat')
  })
  it('ámbar lo que toca a quien mira, verde lo resuelto, nunca rojo', () => {
    expect(estilEstatSignatura('pendent', 'usuari')).toContain('aviso')
    expect(estilEstatSignatura('pendent', 'equip')).toContain('secondary')
    expect(estilEstatSignatura('signat', 'equip')).toContain('aviso')
    expect(estilEstatSignatura('signat', 'usuari')).toContain('secondary')
    for (const e of ESTATS) for (const p of ['usuari', 'equip'] as const) {
      expect(estilEstatSignatura(e, p)).not.toMatch(/error|destructive|coral/)
    }
    expect(estilEstatSignatura('tancat', 'equip')).toContain('exito')
  })
  it('un CONV pendiente no se pinta', () => {
    expect(mostraEstatSignatura('pendent', false)).toBe(false)
    expect(mostraEstatSignatura('tancat', false)).toBe(true)
    expect(mostraEstatSignatura('pendent', true)).toBe(true)
    expect(mostraEstatSignatura(null, true)).toBe(false)
  })
  it('vía y parte', () => {
    expect(clauVia('canvas')).toBe('sgn.via_canvas')
    expect(clauQuiSigna('donant')).toBe('sgn.qui_donant')
  })
})

describe('fichero y firmante', () => {
  it('valida tipo y tamaño del fichero firmado', () => {
    expect(validaFitxerSignat(null)).toBe('sgn.err_falta_fitxer')
    expect(validaFitxerSignat({ type: 'application/pdf', size: 0 })).toBe('sgn.err_fitxer_buit')
    expect(validaFitxerSignat({ type: 'image/gif', size: 10 })).toBe('sgn.err_mime')
    expect(validaFitxerSignat({ type: 'image/png', size: MAX_BYTES_SIGNAT + 1 })).toBe('sgn.err_massa_gran')
    for (const type of ['application/pdf', 'image/jpeg', 'image/png']) {
      expect(validaFitxerSignat({ type, size: 1024 })).toBeNull()
    }
  })
  it('megues', () => {
    expect(megues(10 * 1024 * 1024)).toBe('10 MB')
    expect(megues(1.5 * 1024 * 1024)).toBe('1,5 MB')
    // Por debajo del mega, en KB (nunca «0 MB»), y al menos 1.
    expect(megues(340 * 1024)).toBe('340 KB')
    expect(megues(128)).toBe('1 KB')
  })
  it('signantValid: mínimos campo a campo, y sin DNI al subir', () => {
    expect(signantValid({ nom: 'A', carrec: 'Presidenta', dni: '12345678Z' })).toMatchObject({ nomCurt: true, valid: false })
    expect(signantValid({ nom: 'Anna', carrec: 'P', dni: '12345678Z' })).toMatchObject({ carrecCurt: true, valid: false })
    expect(signantValid({ nom: 'Anna', carrec: 'Presidenta', dni: '1234' })).toMatchObject({ dniCurt: true, valid: false })
    expect(signantValid({ nom: 'Anna', carrec: 'Presidenta', dni: '12345' }).valid).toBe(true)
    expect(signantValid({ nom: 'Anna', carrec: 'Presidenta', ambDni: false }).valid).toBe(true)
  })
})

describe('las claves existen en los dos idiomas', () => {
  const ACCIONS: AccioSignatura[] = ['signa', 'puja', 'puja_equip', 'veure_fitxer', 'tanca', 'rebutja']
  const claus = [
    ...ESTATS.flatMap((e) => [clauEstatSignatura(e, 'usuari'), clauEstatSignatura(e, 'equip')]),
    ...(['canvas', 'pujat', 'correu'] as const).map(clauVia),
    ...(['donant', 'receptor', 'organitzacio'] as const).map(clauQuiSigna),
    ...ACCIONS.map((a) => `sgn.a_${a}`),
    'sgn.err_falta_fitxer', 'sgn.err_fitxer_buit', 'sgn.err_mime', 'sgn.err_massa_gran',
    'sgn.err_versio_substituida', 'sgn.err_ja_signat', 'sgn.err_no_signable', 'sgn.err_usa_firma_conveni',
    'sgn.err_cal_motiu', 'sgn.err_sense_correu', 'pend.only_titular', 'avis.t_document_signat',
    'doc.sub_signat', 'conv.sub_signat', 'doc.tab_signatures',
    'pe.signatures_per_tancar', 'pe.signatures_per_tancar_cta', 'pe.signatures_per_tancar_sub',
  ]
  for (const idioma of ['ca', 'es'] as const) {
    it(idioma, () => {
      const dict = DICTS[idioma] as Record<string, string>
      for (const k of claus) expect(dict[k], `${k} (${idioma})`).toBeTruthy()
    })
  }
  it('retiradas: la pestaña vacía «Enllaços»', () => {
    expect((DICTS.ca as Record<string, string>)['doc.tab_links']).toBeUndefined()
    expect((DICTS.ca as Record<string, string>)['doc.empty_links']).toBeUndefined()
  })
})
