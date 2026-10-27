// La validación del alta (`registro/validacio.ts`), que comparten el registro público y el
// alta asistida. Lo que se añadió el 27-10-2026: el consentimiento RGPD.
//   · sin privacidad aceptada no hay alta, y solo `true` exacto vale como consentimiento;
//   · las dos comunicaciones son opcionales y, si no llegan, valen `false`;
//   · el idioma solo admite ca/es (el servidor recompone el texto en ese idioma).

import { describe, expect, it } from 'vitest'
import { validar } from '../supabase/functions/registro/validacio'

const cos = (extra: Record<string, unknown> = {}) => ({
  rols: ['productor'],
  nom_organitzacio: 'Horta de Prova',
  nom_persona: 'Anna Prova',
  email: 'anna@prova.cat',
  password: 'secret1',
  telefon: '34612345678',
  accepta_privacitat: true,
  ...extra,
})

describe('validar: RGPD', () => {
  it('sin privacidad aceptada, rechaza señalando el campo', () => {
    const v = validar(cos({ accepta_privacitat: false }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.camp).toBe('accepta_privacitat')
  })
  it('un "true" de texto no vale como consentimiento', () => {
    expect(validar(cos({ accepta_privacitat: 'true' })).ok).toBe(false)
  })
  it('las comunicaciones son opcionales y por defecto false', () => {
    const v = validar(cos())
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.dades.comunicacionsPlataforma).toBe(false)
      expect(v.dades.comunicacionsEspigoladors).toBe(false)
      expect(v.dades.idioma).toBe('ca')
    }
  })
  it('se guardan las que se marcan y el idioma es', () => {
    const v = validar(cos({ comunicacions_plataforma: true, comunicacions_espigoladors: true, idioma: 'es' }))
    expect(v.ok && v.dades.comunicacionsPlataforma && v.dades.comunicacionsEspigoladors && v.dades.idioma === 'es').toBe(true)
  })
  it('un idioma desconocido cae en catalán', () => {
    const v = validar(cos({ idioma: 'en' }))
    expect(v.ok && v.dades.idioma).toBe('ca')
  })
})
