// El destino tras entrar (fase 4 de los puntos 4-6): solo rutas internas, una sola vez y con
// caducidad. Lo que se guarda acaba en un `navigate()`, así que una URL externa que pasara
// sería una redirección abierta justo después del login.

import { describe, expect, it } from 'vitest'
import {
  CADUCITAT_DESTI_MS, CLAU_DESTI, consumeixDesti, destiValid, esborraDesti, guardaDesti, llegeixDesti,
  type Magatzem,
} from '../src/lib/destiLogin'

function magatzem(): Magatzem & { dades: Map<string, string> } {
  const dades = new Map<string, string>()
  return {
    dades,
    getItem: (k) => dades.get(k) ?? null,
    setItem: (k, v) => { dades.set(k, v) },
    removeItem: (k) => { dades.delete(k) },
  }
}

describe('destiValid', () => {
  it('acepta rutas internas con su query', () => {
    expect(destiValid('/receptor/mercat?oferta=abc&accio=interes')).toBe('/receptor/mercat?oferta=abc&accio=interes')
    expect(destiValid('/equip/ofertes/1?accio=recollida&canalitzacio=2')).toBe('/equip/ofertes/1?accio=recollida&canalitzacio=2')
    expect(destiValid('  /receptor/interessos  ')).toBe('/receptor/interessos')
  })

  it('descarta todo lo que pueda salir del origen', () => {
    for (const r of [
      '//evil.test', '//evil.test/receptor', 'https://evil.test', 'http://evil.test/x',
      'javascript:alert(1)', '/\\evil.test', '\\\\evil.test', '/\t/evil.test', '/\n/evil.test',
      'evil.test', 'receptor/mercat', '', ' ', '///evil.test',
    ]) {
      expect(destiValid(r), r).toBeNull()
    }
  })

  it('descarta lo que no es texto y lo desmesurado', () => {
    expect(destiValid(null)).toBeNull()
    expect(destiValid(undefined)).toBeNull()
    expect(destiValid(42)).toBeNull()
    expect(destiValid(`/x?${'a'.repeat(2100)}`)).toBeNull()
  })

  it('las puertas de entrada y la raíz por rol no son un destino', () => {
    for (const r of ['/', '/login', '/admin', '/restablir', '/panell', '/panell/', '/sense-acces', '/registre', '/login?x=1']) {
      expect(destiValid(r), r).toBeNull()
    }
  })
})

describe('guardar y consumir el destino', () => {
  it('se guarda, se lee y se consume una sola vez', () => {
    const m = magatzem()
    guardaDesti('/receptor/mercat?oferta=1&accio=interes', m, 1_000)
    expect(llegeixDesti(m, 2_000)).toBe('/receptor/mercat?oferta=1&accio=interes')
    expect(consumeixDesti(m, 2_000)).toBe('/receptor/mercat?oferta=1&accio=interes')
    expect(consumeixDesti(m, 2_000)).toBeNull()
  })

  it('un destino externo no se guarda ni pisa el que había', () => {
    const m = magatzem()
    guardaDesti('/receptor/interessos', m, 1_000)
    guardaDesti('https://evil.test', m, 1_000)
    guardaDesti('//evil.test', m, 1_000)
    expect(llegeixDesti(m, 1_000)).toBe('/receptor/interessos')
  })

  it('lo escrito a mano en el almacenamiento se vuelve a validar al leer', () => {
    const m = magatzem()
    m.setItem(CLAU_DESTI, JSON.stringify({ ruta: '//evil.test', at: 1_000 }))
    expect(llegeixDesti(m, 1_000)).toBeNull()
    m.setItem(CLAU_DESTI, JSON.stringify({ ruta: 'https://evil.test', at: 1_000 }))
    expect(consumeixDesti(m, 1_000)).toBeNull()
    m.setItem(CLAU_DESTI, 'no és json')
    expect(llegeixDesti(m, 1_000)).toBeNull()
    m.setItem(CLAU_DESTI, JSON.stringify({ ruta: '/receptor/mercat' }))
    expect(llegeixDesti(m, 1_000)).toBeNull()
  })

  it('caduca', () => {
    const m = magatzem()
    guardaDesti('/receptor/mercat', m, 0)
    expect(llegeixDesti(m, CADUCITAT_DESTI_MS)).toBe('/receptor/mercat')
    expect(llegeixDesti(m, CADUCITAT_DESTI_MS + 1)).toBeNull()
  })

  it('sin almacenamiento (o si lanza) no pasa nada', () => {
    expect(() => guardaDesti('/receptor/mercat', null)).not.toThrow()
    expect(llegeixDesti(null)).toBeNull()
    const roto: Magatzem = {
      getItem: () => { throw new Error('x') },
      setItem: () => { throw new Error('x') },
      removeItem: () => { throw new Error('x') },
    }
    expect(() => guardaDesti('/receptor/mercat', roto)).not.toThrow()
    expect(llegeixDesti(roto)).toBeNull()
    expect(() => esborraDesti(roto)).not.toThrow()
  })
})
