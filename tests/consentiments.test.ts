// La base de correos con consentimiento (04-11-2026): `llista_consentiments()` da una fila por
// persona y tipo; la exportación las pliega en una por persona y se queda solo con quien ha
// dicho que sí a alguna comunicación.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({ supabase: {}, supabaseUrl: '' }))

import { ambComunicacions, csvConsentiments, filesExport, type FilaConsentiment } from '../src/lib/consentiments'

const base = {
  organizacion_id: 'o1', entitat: 'Cooperativa', es_generadora: true, es_receptora: false,
  email: 'Hola@Coop.cat', origen: 'enllac', versio_text: '1-provisional',
}
function fila(tipus: FilaConsentiment['tipus'], valor: boolean, extra: Partial<FilaConsentiment> = {}): FilaConsentiment {
  return { ...base, tipus, valor, created_at: '2026-11-04T10:00:00Z', ...extra }
}

describe('filesExport', () => {
  it('pliega los tres tipos de una persona en una fila, con el correo en minúsculas', () => {
    const r = filesExport([
      fila('privacitat', true), fila('comunicacions_plataforma', true), fila('comunicacions_espigoladors', false),
    ])
    expect(r).toEqual([{
      entitat: 'Cooperativa', papers: ['ofertant'], email: 'hola@coop.cat',
      privacitat: true, comunicacions_plataforma: true, comunicacions_espigoladors: false,
      origen: 'enllac', data: '2026-11-04T10:00:00Z',
    }])
  })

  it('separa personas por organización y correo, y descarta las filas sin correo', () => {
    const r = filesExport([
      fila('privacitat', true),
      fila('privacitat', true, { email: 'altra@coop.cat' }),
      fila('privacitat', true, { organizacion_id: 'o2', entitat: 'Banc' }),
      fila('privacitat', true, { email: null }),
    ])
    expect(r.map((f) => `${f.entitat}|${f.email}`)).toEqual([
      'Banc|hola@coop.cat', 'Cooperativa|altra@coop.cat', 'Cooperativa|hola@coop.cat',
    ])
  })

  it('el origen y la fecha son los de la respuesta más reciente', () => {
    const r = filesExport([
      fila('privacitat', true, { origen: 'registre', created_at: '2026-01-01T00:00:00Z' }),
      fila('comunicacions_plataforma', true, { origen: 'enllac', created_at: '2026-11-01T00:00:00Z' }),
    ])
    expect(r[0].origen).toBe('enllac')
    expect(r[0].data).toBe('2026-11-01T00:00:00Z')
  })
})

describe('ambComunicacions', () => {
  it('solo quien ha aceptado alguna comunicación entra en la base de envíos', () => {
    const r = ambComunicacions(filesExport([
      fila('privacitat', true), fila('comunicacions_plataforma', false), fila('comunicacions_espigoladors', false),
      fila('privacitat', true, { email: 'si@coop.cat' }), fila('comunicacions_espigoladors', true, { email: 'si@coop.cat' }),
    ]))
    expect(r.map((f) => f.email)).toEqual(['si@coop.cat'])
  })
})

describe('csvConsentiments', () => {
  it('separa con punto y coma, entrecomilla lo que lo necesita y empieza con BOM', () => {
    const csv = csvConsentiments(
      filesExport([fila('privacitat', true, { entitat: 'Coop; "La Bona"' })]),
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      (v) => (v === null ? '' : v ? 'Sí' : 'No'),
    )
    expect(csv.startsWith('﻿a;b;c;d;e;f;g;h\n')).toBe(true)
    expect(csv).toContain('"Coop; ""La Bona""";ofertant;hola@coop.cat;Sí;;;enllac;2026-11-04')
  })
})
