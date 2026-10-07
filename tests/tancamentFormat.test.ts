// La parte pura del cliente del cierre (`tancamentFormat.ts`): importes, el número de
// ejercicio, los bloqueos y el CSV del 182 que se lleva una gestoría.

import { describe, it, expect } from 'vitest'
import {
  bloqueja, csv182, euros, eurKg, exerciciDeNumero, type Fila182,
} from '../src/lib/tancamentFormat'

const BOM = '﻿'

function fila(parcial: Partial<Fila182> = {}): Fila182 {
  return {
    nif: 'B12345678', razon_social: 'Mas de Prova SCP', codigo_postal: '08001',
    provincia: 'Barcelona', importe: 1234.5, kg: 980, en_especie: true,
    certificado_numero: 'CD-2026-0001', fecha: '2026-12-31', modo: 'real',
    ...parcial,
  }
}

describe('euros y eurKg', () => {
  it('sin valor, una raya; nunca «NaN €»', () => {
    for (const v of [null, undefined, '', 'abc']) {
      expect(euros(v)).toBe('—')
      expect(eurKg(v)).toBe('—')
    }
  })

  it('euros: siempre dos decimales, coma decimal', () => {
    expect(euros(12.3)).toMatch(/^12,30\s€$/)
    expect(euros('7')).toMatch(/^7,00\s€$/)
  })

  it('eurKg: hasta cuatro decimales, porque 0,32 y 0,3175 no son lo mismo', () => {
    expect(eurKg(0.3175)).toBe('0,3175 €/kg')
    expect(eurKg(0.3)).toBe('0,30 €/kg')
  })
})

describe('exerciciDeNumero', () => {
  it('lee el año de un número de serie, con o sin prefijo de prueba', () => {
    expect(exerciciDeNumero('RES-2026-0001')).toBe(2026)
    expect(exerciciDeNumero('P-RES-2026-0001')).toBe(2026)
    expect(exerciciDeNumero('P-CD-2027-0042')).toBe(2027)
  })

  it('sin número o sin año, null — no un año inventado', () => {
    expect(exerciciDeNumero(null)).toBeNull()
    expect(exerciciDeNumero(undefined)).toBeNull()
    expect(exerciciDeNumero('')).toBeNull()
    expect(exerciciDeNumero('CD-0001')).toBeNull()
    expect(exerciciDeNumero('CD-1850-0001')).toBeNull()
  })
})

describe('bloqueja', () => {
  it('solo los bloqueos marcados `bloqueja` impiden el certificado', () => {
    expect(bloqueja(null)).toBe(false)
    expect(bloqueja([])).toBe(false)
    expect(bloqueja([{ codigo: 'sense_rec', detall: '', bloqueja: false }])).toBe(false)
    expect(bloqueja([
      { codigo: 'sense_rec', detall: '', bloqueja: false },
      { codigo: 'sense_cost', detall: '', bloqueja: true },
    ])).toBe(true)
  })
})

describe('csv182', () => {
  const CAPS = { nif: 'NIF', razon_social: 'Raó social' }

  it('empieza con BOM, separa con `;` y cierra cada línea con \\r\\n', () => {
    const csv = csv182([fila()], CAPS)
    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    const linies = csv.slice(1).split('\r\n')
    expect(linies).toHaveLength(3) // cabecera, fila y el vacío tras el último \r\n
    expect(linies[0].split(';')).toHaveLength(10)
    expect(linies[0].startsWith('NIF;Raó social;codigo_postal;')).toBe(true)
  })

  it('números con coma decimal y sin separador de miles', () => {
    const [, l] = csv182([fila({ importe: 12345.6, kg: 980 })], CAPS).slice(1).split('\r\n')
    const c = l.split(';')
    expect(c[4]).toBe('12345,60')
    expect(c[5]).toBe('980,00')
  })

  it('celdas vacías para los null', () => {
    const [, l] = csv182([fila({ nif: null, provincia: null })], CAPS).slice(1).split('\r\n')
    const c = l.split(';')
    expect(c[0]).toBe('')
    expect(c[3]).toBe('')
  })

  it('entrecomilla y dobla comillas si el texto lleva `;`, comillas o saltos', () => {
    const [, l] = csv182([fila({ razon_social: 'Can "Pere"; SL' })], CAPS).slice(1).split('\r\n')
    expect(l).toContain('"Can ""Pere""; SL"')
  })

  it('neutraliza las fórmulas: un texto que empieza por = + - @ lleva apóstrofo', () => {
    for (const [entrada, sortida] of [
      ['=HYPERLINK("http://x")', '"\'=HYPERLINK(""http://x"")"'],
      ['+34 600', "'+34 600"],
      ['-1', "'-1"],
      ['@SUM(A1)', "'@SUM(A1)"],
    ]) {
      const [, l] = csv182([fila({ razon_social: entrada })], CAPS).slice(1).split('\r\n')
      expect(l.split(';')[1], entrada).toBe(sortida)
    }
  })

  it('un número negativo NO es una fórmula y no se toca', () => {
    const [, l] = csv182([fila({ importe: -5 })], CAPS).slice(1).split('\r\n')
    expect(l.split(';')[4]).toBe('-5,00')
  })

  it('sin filas, solo la cabecera', () => {
    expect(csv182([], CAPS).slice(1).split('\r\n')).toHaveLength(2)
  })
})
