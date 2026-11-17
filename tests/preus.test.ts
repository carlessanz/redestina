// Las piezas puras de la pantalla de precios de referencia (punto 3, fase D1): el mes en
// hora de Madrid, la variación entre meses y el aviso de salto, qué precio enseña una fila,
// cuándo la fuente ha cambiado desde la validación y el resumen de la cabecera.
//
// Lo que DECIDE la propuesta (precedencia Gencat del mes o su último publicado → Mercabarna,
// último valor del mes cerrado → manual, `preu_manual`, el mes futuro, el motivo obligatorio) vive en la base y lo prueba `scripts/sql/prova-preus-referencia.sql`.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({ supabase: {}, supabaseUrl: '' }))

import {
  esDunAltreMes, esMesFutur, esSaltGran, exercicisDisponibles, fontHaCanviat, mesActual, mesAnterior, mesDeData,
  mesFontDeFila, preuDeFila,
  resumMes, textVariacio, valorDeFont, variacio, type PropostaPreu,
} from '../src/lib/preus'

const fila = (p: Partial<PropostaPreu>): PropostaPreu => ({
  producto: 'Poma', familia: 'Fruita', preu_manual: false, equivalencies: 1,
  gencat_eur_kg: null, gencat_nom: null, gencat_carrega: null,
  mercabarna_eur_kg: null, mercabarna_nom: null, mercabarna_dies: null, manual_eur_kg: null,
  proposta_font: null, proposta_eur_kg: null,
  validat_eur_kg: null, validat_font: null, validat_nom: null, validat_dies: null, validat_motiu: null,
  validat_at: null, validat_proposta: null,
  anterior_eur_kg: null, anterior_exercici: null, anterior_mes: null,
  gencat_mes: null, proposta_mes_font: null, validat_font_mes: null,
  ...p,
})

describe('el mes', () => {
  it('se calcula en hora de Madrid (el 31-12 a las 23:30 UTC ya es enero)', () => {
    expect(mesActual(new Date('2026-12-31T23:30:00Z'))).toEqual({ exercici: 2027, mes: 1 })
    expect(mesActual(new Date('2026-11-17T10:00:00Z'))).toEqual({ exercici: 2026, mes: 11 })
  })
  it('el anterior a enero es diciembre del año antes', () => {
    expect(mesAnterior(2026, 1)).toEqual({ exercici: 2025, mes: 12 })
    expect(mesAnterior(2026, 9)).toEqual({ exercici: 2026, mes: 8 })
  })
  it('futuro = posterior al mes actual (el actual no es futuro)', () => {
    const ara = new Date('2026-11-17T10:00:00Z')
    expect(esMesFutur(2026, 11, ara)).toBe(false)
    expect(esMesFutur(2026, 12, ara)).toBe(true)
    expect(esMesFutur(2027, 1, ara)).toBe(true)
    expect(esMesFutur(2025, 12, ara)).toBe(false)
  })
  it('los ejercicios van del actual a 2020', () => {
    const e = exercicisDisponibles(new Date('2026-11-17T10:00:00Z'))
    expect(e[0]).toBe(2026)
    expect(e.at(-1)).toBe(2020)
    expect(e).toHaveLength(7)
  })
  it('mesDeData lee «AAAA-MM»', () => {
    expect(mesDeData('2026-09-01')).toEqual({ exercici: 2026, mes: 9 })
    expect(mesDeData(null)).toBeNull()
    expect(mesDeData('basura')).toBeNull()
  })
})

describe('la variación y el salto', () => {
  it('relativa al anterior; null sin uno de los dos o con el anterior a 0', () => {
    expect(variacio(1.3, 1)).toBeCloseTo(0.3)
    expect(variacio(null, 1)).toBeNull()
    expect(variacio(1, null)).toBeNull()
    expect(variacio(1, 0)).toBeNull()
  })
  it('salto grande desde el 30 % en los dos sentidos', () => {
    expect(esSaltGran(0.3)).toBe(true)
    expect(esSaltGran(-0.35)).toBe(true)
    expect(esSaltGran(0.29)).toBe(false)
    expect(esSaltGran(null)).toBe(false)
  })
  it('texto con signo menos tipográfico', () => {
    expect(textVariacio(0.123)).toBe('+12 %')
    expect(textVariacio(-0.08)).toBe('−8 %')
    expect(textVariacio(0.001)).toBe('0 %')
    expect(textVariacio(null)).toBe('—')
  })
})

describe('la fila', () => {
  it('enseña el validado si lo hay; si no, la propuesta', () => {
    expect(preuDeFila(fila({ proposta_eur_kg: 0.5, proposta_font: 'gencat' })))
      .toEqual({ eur_kg: 0.5, font: 'gencat', validat: false })
    expect(preuDeFila(fila({ proposta_eur_kg: 0.5, proposta_font: 'gencat', validat_eur_kg: 0.6, validat_font: 'manual' })))
      .toEqual({ eur_kg: 0.6, font: 'manual', validat: true })
    expect(preuDeFila(fila({}))).toEqual({ eur_kg: null, font: null, validat: false })
  })
  it('la fuente ha cambiado si su valor de hoy no es el que se validó', () => {
    const base = { validat_eur_kg: 0.6858, validat_font: 'gencat' as const, validat_proposta: 0.6858 }
    expect(fontHaCanviat(fila({ ...base, gencat_eur_kg: 0.6858 }))).toBe(false)
    expect(fontHaCanviat(fila({ ...base, gencat_eur_kg: 0.71 }))).toBe(true)
    // Un manual no tiene fuente que cambie; sin valor hoy, tampoco se avisa.
    expect(fontHaCanviat(fila({ ...base, validat_font: 'manual', gencat_eur_kg: 0.71 }))).toBe(false)
    expect(fontHaCanviat(fila({ ...base, gencat_eur_kg: null }))).toBe(false)
  })
  it('validado con el último Gencat de otro mes: cuando Gencat publica este, no avisa (se queda así)', () => {
    const base = { validat_eur_kg: 0.6, validat_font: 'gencat' as const, validat_proposta: 0.6, validat_font_mes: '2026-09-01' }
    expect(fontHaCanviat(fila({ ...base, gencat_eur_kg: 0.9, gencat_mes: '2026-10-01' }))).toBe(false)
    // Gencat revisa el MISMO mes del que salía: sí avisa.
    expect(fontHaCanviat(fila({ ...base, gencat_eur_kg: 0.9, gencat_mes: '2026-09-01' }))).toBe(true)
  })
  it('de qué mes sale el precio de la fila y si es de otro mes', () => {
    expect(mesFontDeFila(fila({ proposta_mes_font: '2026-09-01' }))).toBe('2026-09-01')
    expect(mesFontDeFila(fila({ proposta_mes_font: '2026-10-01', validat_eur_kg: 1, validat_font_mes: '2026-09-01' }))).toBe('2026-09-01')
    expect(esDunAltreMes('2026-09-01', 2026, 10)).toBe(true)
    expect(esDunAltreMes('2026-10-01', 2026, 10)).toBe(false)
    expect(esDunAltreMes(null, 2026, 10)).toBe(false)
  })
  it('valorDeFont da el de cada fuente', () => {
    const f = fila({ gencat_eur_kg: 0.5, mercabarna_eur_kg: 0.8, manual_eur_kg: 1 })
    expect(valorDeFont(f, 'gencat')).toBe(0.5)
    expect(valorDeFont(f, 'mercabarna')).toBe(0.8)
    expect(valorDeFont(f, 'manual')).toBe(1)
  })
})

describe('el resumen del mes', () => {
  it('cuenta validados, por validar, sin precio y saltos', () => {
    const r = resumMes([
      fila({ validat_eur_kg: 1, validat_font: 'gencat', anterior_eur_kg: 1 }),
      fila({ proposta_eur_kg: 2, proposta_font: 'mercabarna', anterior_eur_kg: 1 }),
      fila({}),
    ])
    expect(r).toEqual({ total: 3, validats: 1, perValidar: 1, sensePreu: 1, salts: 1 })
  })
})
