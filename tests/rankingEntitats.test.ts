import { describe, expect, it } from 'vitest'
import { comarquesPresents, dinsFranja, dinsFranjaKg, filtraRanking, hiHaInteresProducte, hiHaQuantitatHabitual, modalitatsPresents, tipusPresents } from '../src/lib/rankingEntitats'
import type { EntidadPuntuada } from '../src/lib/redestina'

function ent(id: string, tipo_receptor: string | null, puntuacion = 1): EntidadPuntuada {
  return {
    id, nombre: id, poblacion: null, telefono: null, opt_in: false, puntuacion, motivos: [],
    pendiente: false, email: null, es_test: false, tipo_receptor, canal: 'email',
    motiu_canal: 'sense_telefon', whatsapp_possible: false, email_possible: true,
    canal_preferit: null, preferencia_respectada: null, sense_conveni: false,
  } as EntidadPuntuada
}

describe('filtraRanking', () => {
  const r = [ent('a', 'social', 5), ent('b', 'comercial', 4), ent('c', null, 3), ent('d', 'social', 2)]

  it('sin filtro devuelve todas, en el mismo orden', () => {
    expect(filtraRanking(r, '').map((e) => e.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('con filtro solo quita filas: no reordena', () => {
    expect(filtraRanking(r, 'social').map((e) => e.id)).toEqual(['a', 'd'])
  })

  it('una entidad sin tipo no sale con ningún filtro', () => {
    expect(filtraRanking(r, 'comercial').map((e) => e.id)).toEqual(['b'])
  })
})

describe('tipusPresents', () => {
  it('ofrece solo los tipos que hay, en el orden fijo', () => {
    expect(tipusPresents([ent('a', 'animal'), ent('b', 'social'), ent('c', null)])).toEqual(['social', 'animal'])
  })
})

describe('filtro por interés en el producto (C3 v1)', () => {
  it('deja solo las que lo declaran; las que no dicen nada quedan fuera', () => {
    const r = [
      { id: 'a', interessa_producte: true },
      { id: 'b', interessa_producte: false },
      { id: 'c', interessa_producte: null },
    ] as unknown as Parameters<typeof filtraRanking>[0]
    expect(filtraRanking(r, '', true).map((e) => e.id)).toEqual(['a'])
    expect(filtraRanking(r, '', false).map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(hiHaInteresProducte(r)).toBe(true)
    expect(hiHaInteresProducte(r.slice(1))).toBe(false)
  })
})

describe('zona y última recepción (fase 6)', () => {
  const ara = new Date('2026-10-11T12:00:00Z')
  it('la franja de la última recepción', () => {
    expect(dinsFranja('2026-09-01T00:00:00Z', '3m', ara)).toBe(true)
    expect(dinsFranja('2026-01-01T00:00:00Z', '3m', ara)).toBe(false)
    expect(dinsFranja('2026-01-01T00:00:00Z', '12m', ara)).toBe(true)
    expect(dinsFranja(null, 'mai', ara)).toBe(true)
    expect(dinsFranja('2026-09-01T00:00:00Z', 'mai', ara)).toBe(false)
    expect(dinsFranja(null, '', ara)).toBe(true)
  })
  it('filtra por comarca y ofrece solo las presentes', () => {
    const r = [
      { id: 'a', comarca: 'Osona' }, { id: 'b', comarca: 'Maresme' }, { id: 'c', comarca: null },
    ] as unknown as Parameters<typeof filtraRanking>[0]
    expect(filtraRanking(r, { comarca: 'Osona' }).map((e) => e.id)).toEqual(['a'])
    expect(comarquesPresents(r)).toEqual(['Maresme', 'Osona'])
  })
})

// Fase 1 de filtros (16-11-2026): modalidad y kilos habituales.
describe('filtro por modalidad', () => {
  const e = (id: string, possibles: string[] | undefined, interes: string[] = []) =>
    ({ ...ent(id, 'social'), modalitats_possibles: possibles, modalitats_interes: interes }) as EntidadPuntuada
  const r = [
    e('pot-i-vol', ['donacio', 'venda'], ['donacio']),
    e('pot-sense-dir', ['donacio']),
    e('no-pot', ['venda']),
    e('pot-no-vol', ['donacio', 'venda'], ['venda']),
    e('servidor-vell', undefined),
  ]
  it('deja las que pueden y no han dicho que no les interesa; un servidor anterior no filtra', () => {
    expect(filtraRanking(r, { modalitat: 'donacio' }).map((x) => x.id)).toEqual(['pot-i-vol', 'pot-sense-dir', 'servidor-vell'])
  })
  it('ofrece las modalidades presentes en el orden de siempre', () => {
    expect(modalitatsPresents(r)).toEqual(['donacio', 'venda'])
    expect(modalitatsPresents([ent('x', null)])).toEqual([])
  })
})

describe('filtro por kilos habituales', () => {
  it('franjas cerradas por abajo y abiertas por arriba; sin dato, fuera', () => {
    expect(dinsFranjaKg(99, 'fins_100')).toBe(true)
    expect(dinsFranjaKg(100, 'fins_100')).toBe(false)
    expect(dinsFranjaKg(100, '100_500')).toBe(true)
    expect(dinsFranjaKg(999, '500_1000')).toBe(true)
    expect(dinsFranjaKg(1000, 'mes_1000')).toBe(true)
    expect(dinsFranjaKg(null, 'mes_1000')).toBe(false)
    expect(dinsFranjaKg(null, '')).toBe(true)
  })
  it('filtra el ranking y solo se ofrece si alguna lo ha declarado', () => {
    const r = [{ ...ent('a', null), quantitat_habitual: 50 }, { ...ent('b', null), quantitat_habitual: 700 }, ent('c', null)] as EntidadPuntuada[]
    expect(filtraRanking(r, { kgHabituals: '500_1000' }).map((x) => x.id)).toEqual(['b'])
    expect(hiHaQuantitatHabitual(r)).toBe(true)
    expect(hiHaQuantitatHabitual([ent('c', null)])).toBe(false)
  })
})
