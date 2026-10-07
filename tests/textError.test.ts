// `textError()`: el texto de un error para un aviso. Pura (solo lee el diccionario).
//
// POR QUÉ IMPORTA: los envoltorios de `src/lib` devuelven el error de tres formas —el texto
// que levanta la RPC a propósito, una clave i18n de respaldo o el mensaje crudo de Postgres
// en inglés— y las pantallas lo pintaban a pelo. El orden de las reglas es el contrato:
// código conocido → clave → crudo a respaldo → texto de la RPC tal cual.

import { describe, it, expect } from 'vitest'
import { esClau, textError } from '../src/lib/textError'

/** Un traductor que deja ver qué clave se pidió. */
const t = (clau: string) => `T(${clau})`

describe('textError', () => {
  it('un código conocido gana a todo, venga en `codi` o dentro del mensaje', () => {
    expect(textError(t, { missatge: 'lo que sea', codi: 'sense_conveni' })).toBe('T(od.conv_blocked)')
    expect(textError(t, { missatge: '42501: sense_conveni per a donacio' })).toBe('T(od.conv_blocked)')
    expect(textError(t, 'ERROR sense_conveni')).toBe('T(od.conv_blocked)')
  })

  it('sin mensaje, el respaldo (por defecto `c.error`)', () => {
    expect(textError(t, null)).toBe('T(c.error)')
    expect(textError(t, undefined)).toBe('T(c.error)')
    expect(textError(t, { missatge: null })).toBe('T(c.error)')
    expect(textError(t, '', 'c.load_error')).toBe('T(c.load_error)')
  })

  it('los códigos que algunas funciones devuelven COMO mensaje', () => {
    expect(textError(t, 'unauthorized')).toBe('T(msg.w_unauth)')
    expect(textError(t, 'forbidden')).toBe('T(msg.w_unauth)')
    expect(textError(t, 'error')).toBe('T(c.error)')
  })

  it('un mensaje que ES una clave del diccionario se traduce', () => {
    expect(textError(t, { missatge: 'c.load_error' })).toBe('T(c.load_error)')
  })

  it('un mensaje crudo de Postgres, Auth o la red cae al respaldo', () => {
    for (const crud of [
      'permission denied for table documentos',
      'new row violates row-level security policy for table "x"',
      'duplicate key value violates unique constraint',
      'JWT expired',
      'TypeError: Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'no_autoritzat',
    ]) {
      expect(textError(t, crud, 'c.load_error'), crud).toBe('T(c.load_error)')
    }
  })

  it('el texto que la RPC levanta a propósito se enseña tal cual', () => {
    const rpc = 'Aquest donant està bloquejat: 3 canalitzacions sense conciliar (412.0 kg)'
    expect(textError(t, { missatge: rpc })).toBe(rpc)
  })

  it('`esClau` solo reconoce claves que existen', () => {
    expect(esClau('c.error')).toBe(true)
    expect(esClau('c.no_existeix_mai')).toBe(false)
    expect(esClau('Hi ha hagut un error')).toBe(false)
  })
})
