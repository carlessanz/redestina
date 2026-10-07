// Lo que llega a los logs de las Edge Functions: el dominio del correo y las últimas 4
// cifras del teléfono, nunca el dato entero.

import { describe, it, expect } from 'vitest'
import { enmascararEmail, enmascararTelefono } from '../supabase/functions/_shared/enmascarar.ts'

describe('enmascararEmail', () => {
  it('conserva solo el dominio', () => {
    expect(enmascararEmail('Persona.Real@Espigoladors.com')).toBe('···@espigoladors.com')
  })
  it('sin @ no deja nada', () => {
    expect(enmascararEmail('nomail')).toBe('···')
  })
  it('vacío', () => {
    expect(enmascararEmail(null)).toBe('—')
    expect(enmascararEmail('')).toBe('—')
  })
  it('no contiene la parte local', () => {
    expect(enmascararEmail('hola@carlessanz.com')).not.toContain('hola')
  })
})

describe('enmascararTelefono', () => {
  it('conserva las 4 últimas cifras', () => {
    expect(enmascararTelefono('34676452492')).toBe('···2492')
    expect(enmascararTelefono('+34 676 45 24 92')).toBe('···2492')
  })
  it('con menos de 4 cifras no deja nada', () => {
    expect(enmascararTelefono('12')).toBe('···')
  })
  it('vacío', () => {
    expect(enmascararTelefono(undefined)).toBe('—')
  })
})
