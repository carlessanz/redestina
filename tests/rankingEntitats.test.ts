import { describe, expect, it } from 'vitest'
import { filtraRanking, hiHaInteresProducte, tipusPresents } from '../src/lib/rankingEntitats'
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
