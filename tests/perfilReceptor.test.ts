// La ficha de la organización: validaciones y campos por tipo de receptor.
//
// Dos cosas que no se ven en pantalla hasta que fallan: que el dígito de control del NIF se
// calcule bien (un NIF bueno rechazado deja a una organización sin poder guardar su ficha) y
// que las claves COMPUESTAS de `perfilReceptor.ts` existan en los dos idiomas.

import { describe, it, expect } from 'vitest'
import { errorCorreu, errorCp, errorNif, errorTelefon, normalitzaTelefon, varietatSemblaQuantitat } from '../src/lib/validacio'
import { CLAUS_SOCIALS, PERFIL_NATURALESA, PERFIL_RECEPTOR, TIPUS_EMPRESA, campsPerfil, clausPerfil } from '../src/lib/perfilReceptor'
import { DICTS } from '../src/lib/i18n'

describe('NIF, NIE y CIF, con su control', () => {
  it('acepta los buenos, con o sin separadores', () => {
    expect(errorNif('12345678Z')).toBeNull()
    expect(errorNif('12.345.678-z')).toBeNull()
    expect(errorNif('X1234567L')).toBeNull()
    // El CIF de la Fundació Espigoladors, que sale en su albarán.
    expect(errorNif('G66264953')).toBeNull()
    expect(errorNif('B12345674')).toBeNull()
  })

  it('rechaza el control equivocado, y lo dice distinto de un formato raro', () => {
    expect(errorNif('12345678A')).toBe('val.nif_control')
    expect(errorNif('G66264954')).toBe('val.nif_control')
    expect(errorNif('hola')).toBe('val.nif_format')
  })

  it('vacío no es un error: el campo es opcional', () => {
    expect(errorNif('')).toBeNull()
  })
})

describe('teléfono, correo y CP', () => {
  it('un móvil español de 9 cifras recibe el 34', () => {
    expect(normalitzaTelefon('612 345 678')).toBe('34612345678')
    expect(normalitzaTelefon('+34 612345678')).toBe('34612345678')
    expect(errorTelefon('612 345 678')).toBeNull()
    expect(errorTelefon('1234')).toBe('val.phone')
  })

  it('correo y CP', () => {
    expect(errorCorreu('hola@example.com')).toBeNull()
    expect(errorCorreu('hola@')).toBe('val.email')
    expect(errorCp('08850')).toBeNull()
    expect(errorCp('8850')).toBe('val.cp')
  })
})

describe('los campos por tipo de receptor', () => {
  it('cubren los cuatro tipos de la base (tipo_receptor)', () => {
    expect(Object.keys(PERFIL_RECEPTOR).sort()).toEqual(['animal', 'comercial', 'social', 'transformador'])
  })

  it('toda clave compuesta existe en ca y en es', () => {
    for (const clau of clausPerfil()) {
      expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
      expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
    }
  })

  it('los tipos de empresa son los del check de la RPC', () => {
    expect([...TIPUS_EMPRESA]).toEqual(['cooperativa', 'sat', 'sc', 'cb', 'sl', 'sa', 'autonom', 'fundacio', 'associacio', 'altres'])
  })

  it('las listas cerradas llevan opciones, las abiertas no', () => {
    for (const camps of Object.values(PERFIL_RECEPTOR)) {
      for (const c of camps) {
        if (c.tipus === 'select' || c.tipus === 'multi') expect(c.opcions?.length, c.clau).toBeGreaterThan(0)
        else expect(c.opcions, c.clau).toBeUndefined()
      }
    }
  })
})

describe('el perfil por naturalesa (A5, 2.8)', () => {
  const claus = (n: string | null, t: string | null) => campsPerfil(n, t).map((c) => c.clau)

  it('sin naturalesa, los campos del tipo de receptor, como antes', () => {
    for (const t of Object.keys(PERFIL_RECEPTOR)) expect(claus(null, t)).toEqual(PERFIL_RECEPTOR[t].map((c) => c.clau))
    expect(claus(null, null)).toEqual([])
  })

  it('a una empresa nunca se le pregunta nada social, sea cual sea el tipo', () => {
    for (const t of [...Object.keys(PERFIL_RECEPTOR), null]) {
      for (const c of claus('empresa', t)) expect(CLAUS_SOCIALS.has(c), `${t}: ${c}`).toBe(false)
    }
  })

  it('empresa: productos, cantidades, calidad, formato, precio y logística', () => {
    expect(claus('empresa', 'comercial')).toEqual(
      ['activitat', 'quantitat_comanda', 'requisits_qualitat', 'format', 'rang_preu', 'logistica'])
  })

  it('entidad social: personas y familias atendidas y tipo de atención', () => {
    expect(claus('entitat_social', 'social')).toEqual(['persones_ateses', 'families_ateses', 'tipus_atencio'])
  })

  it('transformador y animal suman su bloque propio, sin repetir', () => {
    const c = claus('empresa', 'transformador')
    expect(c.slice(0, PERFIL_NATURALESA.empresa.length)).toEqual(PERFIL_NATURALESA.empresa.map((x) => x.clau))
    expect(new Set(c).size).toBe(c.length)
    expect(c.length).toBeGreaterThan(PERFIL_NATURALESA.empresa.length)
  })
})

describe('varietatSemblaQuantitat', () => {
  it('avisa cuando la variedad es solo un número o un peso', () => {
    for (const v of ['200', ' 1.500 ', '200 kg', '12,5kg', '300 quilos']) expect(varietatSemblaQuantitat(v)).toBe(true)
  })
  it('no avisa con una variedad de verdad ni con vacío', () => {
    for (const v of ['Golden', 'Raf', 'Conference 2', '', null, undefined]) expect(varietatSemblaQuantitat(v)).toBe(false)
  })
})
