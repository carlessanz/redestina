// Cómo se escriben los números y las fechas (`src/lib/format.ts`). Lo que se fija es la
// salida EXACTA que daban las funciones que estas sustituyen —el `fmtKg` de dos listados,
// el `kgFmt` del receptor, la «data curta sense any» y los tres «hoy en Madrid»—, para que
// unificarlas no cambiara ni un carácter de lo que se ve.
//
// ⚠️ Las fechas sin zona (`dataCurta`, `dataHora`, `diaMesHora`) usan la hora local del
//    proceso, así que se prueban con instantes a mediodía UTC: caen el mismo día en
//    cualquier zona de Europa y de América.

import { describe, it, expect } from 'vitest'
import {
  avuiLocal, avuiMadrid, dataCurta, dataHora, diaMes, diaMesHora, kg, nombre, preu,
} from '../src/lib/format'

describe('nombre', () => {
  it('agrupa los miles desde cuatro cifras, como ca-ES', () => {
    expect(nombre(1000)).toBe('1.000')
    expect(nombre(1320)).toBe('1.320')
    expect(nombre(999)).toBe('999')
  })
  it('hasta dos decimales por defecto, sin ceros de relleno', () => {
    expect(nombre(12.5)).toBe('12,5')
    expect(nombre(0.755)).toBe('0,76')
    expect(nombre(3)).toBe('3')
  })
  it('respeta el máximo de decimales pedido', () => {
    expect(nombre(1320.6, 0)).toBe('1.321')
    expect(nombre(0.4, 0)).toBe('0')
  })
  it('acepta texto numérico, que es como llega un numeric de PostgREST', () => {
    expect(nombre('1250.5')).toBe('1.250,5')
  })
  it('sin valor o no numérico, «—»', () => {
    expect(nombre(null)).toBe('—')
    expect(nombre(undefined)).toBe('—')
    expect(nombre('')).toBe('—')
    expect(nombre('abc')).toBe('—')
  })
  it('es lo mismo que el toLocaleString que sustituye', () => {
    for (const n of [0, 1, 12.345, 1000, 25000.5, 1234567.891]) {
      expect(nombre(n)).toBe(n.toLocaleString('ca-ES', { maximumFractionDigits: 2 }))
      expect(nombre(n, 0)).toBe(new Intl.NumberFormat('ca-ES', { maximumFractionDigits: 0 }).format(n))
    }
  })
})

describe('kg', () => {
  it('es `nombre` con dos decimales', () => {
    expect(kg(1320.456)).toBe('1.320,46')
    expect(kg(null)).toBe('—')
  })
})

describe('preu', () => {
  it('siempre dos decimales, con coma', () => {
    expect(preu(0.45)).toBe('0,45')
    expect(preu(1)).toBe('1,00')
    expect(preu('1200')).toBe('1.200,00')
  })
})

describe('fechas', () => {
  const MIGDIA = '2026-09-21T12:00:00Z'
  it('dataCurta: dd/mm/aaaa, o «—» sin fecha', () => {
    expect(dataCurta(MIGDIA)).toBe('21/09/2026')
    expect(dataCurta(null)).toBe('—')
    expect(dataCurta(undefined)).toBe('—')
    expect(dataCurta('')).toBe('—')
  })
  it('dataHora: la fecha y la hora, como el toLocaleString de es-ES', () => {
    const d = new Date(MIGDIA)
    expect(dataHora(MIGDIA)).toBe(d.toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }))
    expect(dataHora(MIGDIA)).toMatch(/^21\/09\/2026/)
  })
  it('diaMesHora: día, mes y hora, igual que las tres copias que sustituye', () => {
    // ⚠️ Con este motor el mes sale SIN cero («21/9»): es el mismo fallo de `2-digit` que
    //    `diaMes` evita montándola a mano. Se conserva a propósito —es lo que ya se veía en
    //    Missatgeria, Aprovacions y el detalle de oferta— y corregirlo es un cambio aparte.
    const d = new Date(MIGDIA)
    expect(diaMesHora(MIGDIA)).toBe(
      `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} `
        + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))
    expect(diaMesHora(MIGDIA)).toMatch(/^21\/0?9 \d{2}:\d{2}$/)
  })
  it('diaMes: «dd/mm» en hora de Madrid, con los dos dígitos del mes', () => {
    expect(diaMes(MIGDIA)).toBe('21/09')
    // 23:30 UTC del 30/09 ya es 1 de octubre en Madrid (UTC+2 en verano).
    expect(diaMes('2026-09-30T23:30:00Z')).toBe('01/10')
    expect(diaMes(null)).toBeNull()
  })
  it('avuiMadrid: AAAA-MM-DD en hora de Madrid', () => {
    expect(avuiMadrid(new Date(MIGDIA))).toBe('2026-09-21')
    expect(avuiMadrid(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-01')
  })
  it('avuiMadrid da lo mismo que las dos formas que sustituye (en-CA y sv-SE)', () => {
    for (const iso of [MIGDIA, '2026-12-31T23:30:00Z', '2027-01-01T00:30:00Z']) {
      const d = new Date(iso)
      expect(avuiMadrid(d)).toBe(d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }))
    }
  })
  it('avuiLocal: AAAA-MM-DD en la hora local, con ceros', () => {
    expect(avuiLocal(new Date(2026, 0, 5, 10))).toBe('2026-01-05')
  })
})
