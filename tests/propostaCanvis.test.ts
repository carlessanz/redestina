// La propuesta de cambios del equipo a un interés (fase 5 de los puntos 4-6): qué cambia, en qué
// punto está y qué se manda a `proposar_canvis` (null = lo que pidió la entidad).

import { describe, expect, it } from 'vitest'
import { argsProposta, canvisProposta, estatProposta, formInicialProposta } from '../src/lib/propostaCanvis'
import type { RespostaAmbProposta } from '../src/lib/propostaCanvis'
import { localDateTime } from '../src/lib/franja'

const demanat: RespostaAmbProposta = {
  aprovacio: 'pendent', kg_solicitados: 100, modalitat: 'donacio', recollida_at: '2027-06-12T08:00:00+00:00',
}

describe('canvisProposta: solo lo que cambia, «abans → ara»', () => {
  it('sin propuesta, nada', () => {
    expect(canvisProposta(demanat)).toEqual([])
  })

  it('mientras está proposada, «abans» es la petición', () => {
    const r: RespostaAmbProposta = {
      ...demanat, aprovacio: 'proposada',
      proposta_kg: 60, proposta_modalitat: 'donacio', proposta_recollida_at: '2027-06-12T08:00:00Z',
      proposta_motiu: 'No en queden tants',
      proposta_original: { kg_solicitados: 100, modalitat: 'donacio', recollida_at: '2027-06-12T08:00:00+00:00' },
    }
    // La hora es la misma aunque llegue escrita de otra forma: no se lista.
    expect(canvisProposta(r)).toEqual([{ camp: 'kg', abans: 100, ara: 60 }])
  })

  it('aceptada, la petición ya es la propuesta y «abans» sale de `proposta_original`', () => {
    const r: RespostaAmbProposta = {
      aprovacio: 'pendent', kg_solicitados: 60, modalitat: 'venda', recollida_at: '2027-06-13T09:00:00Z',
      proposta_kg: 60, proposta_modalitat: 'venda', proposta_recollida_at: '2027-06-13T09:00:00Z',
      proposta_resposta: 'acceptada',
      proposta_original: { kg_solicitados: 100, modalitat: 'donacio', recollida_at: null },
    }
    expect(canvisProposta(r).map((c) => c.camp)).toEqual(['kg', 'modalitat', 'recollida'])
    expect(canvisProposta(r)[2]).toEqual({ camp: 'recollida', abans: null, ara: '2027-06-13T09:00:00Z' })
  })
})

describe('estatProposta', () => {
  it('los cuatro casos', () => {
    expect(estatProposta({ aprovacio: 'proposada', proposta_resposta: null })).toBe('esperant')
    expect(estatProposta({ aprovacio: 'pendent', proposta_resposta: 'rebutjada' })).toBe('rebutjada')
    expect(estatProposta({ aprovacio: 'pendent', proposta_resposta: 'acceptada' })).toBe('acceptada_preu')
    expect(estatProposta({ aprovacio: 'pendent', proposta_resposta: null })).toBeNull()
    // Ya resuelta por el equipo: la propuesta es historia.
    expect(estatProposta({ aprovacio: 'aprovada', proposta_resposta: 'acceptada' })).toBeNull()
    expect(estatProposta({ aprovacio: 'rebutjada', proposta_resposta: 'rebutjada' })).toBeNull()
  })
})

describe('argsProposta: lo que viaja a `proposar_canvis`', () => {
  const form = formInicialProposta(demanat, ['donacio', 'venda'])

  it('el formulario nace con lo que pidió la entidad', () => {
    expect(form).toEqual({ kg: '100', modalitat: 'donacio', recollida: localDateTime(demanat.recollida_at), motiu: '' })
    // Una modalidad que la oferta ya no tiene no se precarga; con una sola, esa.
    expect(formInicialProposta({ ...demanat, modalitat: 'maquila' }, ['donacio', 'venda']).modalitat).toBe('')
    expect(formInicialProposta({ ...demanat, modalitat: null }, ['venda']).modalitat).toBe('venda')
  })

  it('sin motivo, sin kilos o sin ningún cambio, no se llama', () => {
    expect(argsProposta({ ...form, kg: '60' }, demanat)).toEqual({ ok: false, error: 'cal_motiu' })
    expect(argsProposta({ ...form, kg: '0', motiu: 'x' }, demanat)).toEqual({ ok: false, error: 'cal_kg' })
    expect(argsProposta({ ...form, kg: 'abc', motiu: 'x' }, demanat)).toEqual({ ok: false, error: 'cal_kg' })
    expect(argsProposta({ ...form, motiu: 'x' }, demanat)).toEqual({ ok: false, error: 'cal_canvi' })
    expect(argsProposta({ ...form, kg: '60', motiu: 'x'.repeat(1001) }, demanat)).toEqual({ ok: false, error: 'motiu_llarg' })
  })

  it('solo viaja lo que cambia; lo demás, null (= lo pedido)', () => {
    expect(argsProposta({ ...form, kg: '60,5', motiu: '  Menys quilos  ' }, demanat))
      .toEqual({ ok: true, kg: 60.5, modalitat: null, recollidaAt: null, motiu: 'Menys quilos' })
    expect(argsProposta({ ...form, modalitat: 'venda', motiu: 'm' }, demanat))
      .toEqual({ ok: true, kg: null, modalitat: 'venda', recollidaAt: null, motiu: 'm' })
    const r = argsProposta({ ...form, recollida: '2027-06-14T10:30', motiu: 'm' }, demanat)
    expect(r.ok && r.kg === null && r.modalitat === null).toBe(true)
    expect(r.ok && r.recollidaAt).toBe(new Date('2027-06-14T10:30').toISOString())
  })

  it('vaciar la hora no la quita: null es «la que pidió»', () => {
    expect(argsProposta({ ...form, recollida: '', motiu: 'm' }, demanat)).toEqual({ ok: false, error: 'cal_canvi' })
  })
})
