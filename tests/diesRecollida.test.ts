// Los días de recogida de una oferta frente al día que se elige (fase 4, 25-11-2026):
// `src/lib/diesRecollida.ts`. La base dice lo mismo (`comprova_hora_recollida`, `dia_fora_dies`).

import { describe, expect, it } from 'vitest'
import { DICTS } from '../src/lib/i18n'
import {
  MAX_DIES_SELECTOR, diaPermes, diaSetmanaIso, franjaDinsDelLloc, frangesDelLloc, normalitzaDies, opcionsDies,
} from '../src/lib/diesRecollida'

describe('el día ISO de la semana', () => {
  it('lunes = 1 … domingo = 7, sobre la fecha y sin la hora local', () => {
    expect(diaSetmanaIso('2026-11-30')).toBe(1) // dilluns
    expect(diaSetmanaIso('2026-11-25')).toBe(3) // dimecres
    expect(diaSetmanaIso('2026-11-29')).toBe(7) // diumenge
    expect(diaSetmanaIso('2026-11-29T23:30:00Z')).toBe(7)
    expect(diaSetmanaIso('2026-02-30')).toBeNull()
    expect(diaSetmanaIso('')).toBeNull()
  })
})

describe('la lista de días', () => {
  it('limpia, sin repetidos y en orden; lo que no es un día, fuera', () => {
    expect(normalitzaDies([5, '1', 1, 9, 0, null, 3.5])).toEqual([1, 5])
    expect(normalitzaDies(null)).toEqual([])
  })
  it('sin lista, cualquier día válido; con lista, solo esos', () => {
    expect(diaPermes('2026-11-29', null)).toBe(true)
    expect(diaPermes('2026-11-29', [])).toBe(true)
    expect(diaPermes('no', [])).toBe(false)
    expect(diaPermes('2026-11-30', [1, 3])).toBe(true)
    expect(diaPermes('2026-11-29', [1, 3])).toBe(false)
  })
})

describe('las opciones del selector', () => {
  it('de hoy a la disponibilidad, con los días fuera deshabilitados', () => {
    const o = opcionsDies('2026-11-27', '2026-12-02', [1, 3])
    expect(o.map((x) => x.dia)).toEqual(['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
    expect(o.filter((x) => x.permes).map((x) => x.dia)).toEqual(['2026-11-30', '2026-12-02'])
    expect(o[0].diaSetmana).toBe(5)
  })
  it('sin fecha de fin, como mucho el máximo; con el fin antes del inicio, ninguno', () => {
    expect(opcionsDies('2026-11-27', null, [1])).toHaveLength(MAX_DIES_SELECTOR)
    expect(opcionsDies('2026-11-27', '2026-11-20', [1])).toEqual([])
    expect(opcionsDies('roto', null, [1])).toEqual([])
  })
  it('cruza el cambio de mes y de año', () => {
    expect(opcionsDies('2026-12-30', '2027-01-02', null).map((x) => x.dia))
      .toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })
})

describe('lo que el lugar permite a la oferta', () => {
  it('las franjas del lugar: solo las válidas, con la hora corta', () => {
    expect(frangesDelLloc([{ inici: '08:00:00', fi: '12:00' }, { inici: '15:00', fi: '14:00' }, null, 'x'])).toEqual([{ inici: '08:00', fi: '12:00' }])
    expect(frangesDelLloc(null)).toEqual([])
  })
  it('la franja de la oferta, dentro de alguna del lugar', () => {
    const fr = [{ inici: '08:00', fi: '12:00' }, { inici: '15:00', fi: '18:00' }]
    expect(franjaDinsDelLloc({ inici: '09:00', fi: '11:30' }, fr)).toBe(true)
    expect(franjaDinsDelLloc({ inici: '15:00', fi: '18:00' }, fr)).toBe(true)
    expect(franjaDinsDelLloc({ inici: '11:00', fi: '16:00' }, fr)).toBe(false)
    expect(franjaDinsDelLloc({ inici: '07:00', fi: '09:00' }, fr)).toBe(false)
    // A medias o sin franjas en el lugar: nada que decir.
    expect(franjaDinsDelLloc({ inici: '07:00' }, fr)).toBe(true)
    expect(franjaDinsDelLloc({ inici: '07:00', fi: '09:00' }, [])).toBe(true)
  })
})

describe('claves', () => {
  it.each(['po.dies_del_lloc', 'po.franges_del_lloc', 'po.franja_fora_lloc'])('%s en ca y es', (c) => {
    expect(DICTS.ca[c]).toBeTruthy()
    expect(DICTS.es[c]).toBeTruthy()
  })
  it.each(['mk.dies_nomes', 'mk.dies_cap', 'mk.dia_fora_avis', 'rrec.err_dia_fora_dies'])('%s en ca y es, con {dies} donde toca', (c) => {
    expect(DICTS.ca[c]).toBeTruthy()
    expect(DICTS.es[c]).toBeTruthy()
    if (c.startsWith('mk.')) {
      expect(DICTS.ca[c]).toContain('{dies}')
      expect(DICTS.es[c]).toContain('{dies}')
    }
  })
})
