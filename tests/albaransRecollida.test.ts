// Los albaranes de una recogida (fase 3 de los puntos 4-6, 20270608100100).
//
// Lo que se protege: desde esta fase una canalización de donación tiene DOS albaranes con su
// `canalizacion_id` (su ENT y su REC propio), así que el `find` por canalización de antes podía
// devolver el REC donde se esperaba la salida. Y la oferta va al ritmo de la recogida más
// atrasada: con una sin conciliar no puede decir «tancada» aunque los REC visibles lo estén.

import { describe, it, expect } from 'vitest'
import {
  albaransDeLaRecollida, avancAlbara, esRecollidaDelEquip, esVendaOMaquila, recDe, recDeLOferta,
  recHeretat, sortidaDe, teRecPerRecollida,
} from '../src/lib/albaransRecollida'
import type { AlbaraMinim, CanalPerRegistrar } from '../src/lib/albaransRecollida'

const a = (id: string, tipo: string, estado: string, canalizacion_id: string | null): AlbaraMinim =>
  ({ id, tipo, estado, canalizacion_id })

describe('sortidaDe: la salida por tipo, nunca el REC', () => {
  it('con ENT y REC propios en la misma canalización devuelve el ENT', () => {
    const llista = [a('r1', 'REC', 'borrador', 'c1'), a('e1', 'ENT', 'borrador', 'c1')]
    expect(sortidaDe(llista, 'c1')?.id).toBe('e1')
  })
  it('prefiere la viva a la anulada, y sin viva devuelve la que haya', () => {
    expect(sortidaDe([a('e0', 'ENT', 'anulado', 'c1'), a('e1', 'ENT', 'emitido', 'c1')], 'c1')?.id).toBe('e1')
    expect(sortidaDe([a('e0', 'ENT', 'anulado', 'c1')], 'c1')?.id).toBe('e0')
  })
  it('una venta sin albarán no tiene salida', () => {
    expect(sortidaDe([], 'c1')).toBeNull()
  })
})

describe('recDe: el REC propio o el heredado', () => {
  it('el propio gana al heredado', () => {
    const llista = [a('h', 'REC', 'emitido', null), a('p', 'REC', 'borrador', 'c1')]
    expect(recDe(llista, 'c1')?.id).toBe('p')
  })
  it('sin propio, el heredado de la oferta', () => {
    const llista = [a('h', 'REC', 'emitido', null), a('e1', 'ENT', 'emitido', 'c1')]
    expect(recDe(llista, 'c1')?.id).toBe('h')
    expect(recHeretat(llista)?.id).toBe('h')
    expect(teRecPerRecollida(llista)).toBe(false)
  })
  it('un REC heredado anulado no cuenta', () => {
    expect(recHeretat([a('h', 'REC', 'anulado', null)])).toBeNull()
  })
})

describe('recDeLOferta: al ritmo de la recogida más atrasada', () => {
  it('con varios REC, el menos avanzado', () => {
    const llista = [a('r1', 'REC', 'conciliado', 'c1'), a('r2', 'REC', 'borrador', 'c2')]
    expect(recDeLOferta(llista)?.id).toBe('r2')
  })
  it('con una recogida viva sin conciliar, nunca uno conciliado (el productor no ve borradores)', () => {
    const visibles = [a('r1', 'REC', 'conciliado', 'c1')]
    const canals = [{ id: 'c1', estado: 'conciliada' }, { id: 'c2', estado: 'pendiente' }]
    expect(recDeLOferta(visibles, canals)).toBeNull()
  })
  it('con todas conciliadas (o anuladas), el conciliado', () => {
    const visibles = [a('r1', 'REC', 'conciliado', 'c1')]
    const canals = [{ id: 'c1', estado: 'conciliada' }, { id: 'c2', estado: 'anulada' }]
    expect(recDeLOferta(visibles, canals)?.id).toBe('r1')
  })
  it('el modelo heredado (un REC por oferta) no cambia', () => {
    const visibles = [a('h', 'REC', 'emitido', null)]
    expect(recDeLOferta(visibles, [{ id: 'c1', estado: 'pendiente' }])?.id).toBe('h')
  })
  it('sin REC vivo, null', () => {
    expect(recDeLOferta([a('h', 'REC', 'anulado', null)])).toBeNull()
  })
})

describe('albaransDeLaRecollida y utilidades', () => {
  it('primero la salida y después el REC; lo que no existe no sale', () => {
    const llista = [a('r1', 'REC', 'conciliado', 'c1'), a('e1', 'ENT', 'conciliado', 'c1'), a('e2', 'ENT', 'borrador', 'c2')]
    expect(albaransDeLaRecollida(llista, 'c1').map((x) => x.id)).toEqual(['e1', 'r1'])
    expect(albaransDeLaRecollida([], 'c1')).toEqual([])
  })
  it('avancAlbara ordena y un muerto vale -1', () => {
    expect(avancAlbara({ estado: 'borrador' })).toBe(0)
    expect(avancAlbara({ estado: 'conciliado' })).toBe(4)
    expect(avancAlbara({ estado: 'rectificado' })).toBe(-1)
    expect(avancAlbara(null)).toBe(-1)
  })
  it('esVendaOMaquila', () => {
    expect(esVendaOMaquila('venda')).toBe(true)
    expect(esVendaOMaquila('maquila')).toBe(true)
    expect(esVendaOMaquila('donacio')).toBe(false)
    expect(esVendaOMaquila(null)).toBe(false)
  })
})

describe('esRecollidaDelEquip: el mismo criterio que la cola `recollides_equip`', () => {
  const ARA = Date.parse('2026-11-19T12:00:00Z')
  const canal = (p: Partial<CanalPerRegistrar> = {}): CanalPerRegistrar => ({
    id: 'c1', estado: 'pendiente', valorizacion: 'venda',
    data_hora_recollida: '2026-11-18T10:00:00Z', created_at: '2026-11-10T10:00:00Z',
    recollida_registrada_at: null, recollida_validada_at: null, recollida_retornada_at: null, ...p,
  })
  it('una venta con la hora pasada y sin registrar, sí', () => {
    expect(esRecollidaDelEquip(canal(), [], ARA)).toBe(true)
    expect(esRecollidaDelEquip(canal({ valorizacion: 'maquila' }), [], ARA)).toBe(true)
  })
  it('una donación, no (va por sus albaranes)', () => {
    expect(esRecollidaDelEquip(canal({ valorizacion: 'donacio' }), [], ARA)).toBe(false)
  })
  it('con la hora por llegar, no; sin hora, a los dos días de asignarla', () => {
    expect(esRecollidaDelEquip(canal({ data_hora_recollida: '2026-11-20T10:00:00Z' }), [], ARA)).toBe(false)
    expect(esRecollidaDelEquip(canal({ data_hora_recollida: null }), [], ARA)).toBe(true)
    expect(esRecollidaDelEquip(canal({ data_hora_recollida: null, created_at: '2026-11-18T12:00:00Z' }), [], ARA)).toBe(false)
  })
  it('registrada, validada, anulada o conciliada, no', () => {
    expect(esRecollidaDelEquip(canal({ recollida_registrada_at: '2026-11-18T12:00:00Z' }), [], ARA)).toBe(false)
    expect(esRecollidaDelEquip(canal({ recollida_validada_at: '2026-11-18T12:00:00Z' }), [], ARA)).toBe(false)
    expect(esRecollidaDelEquip(canal({ estado: 'anulada' }), [], ARA)).toBe(false)
    expect(esRecollidaDelEquip(canal({ estado: 'conciliada' }), [], ARA)).toBe(false)
  })
  it('devuelta hace poco espera al receptor; hace más de dos días, vuelve al equipo', () => {
    expect(esRecollidaDelEquip(canal({ recollida_retornada_at: '2026-11-18T12:00:00Z' }), [], ARA)).toBe(false)
    expect(esRecollidaDelEquip(canal({ recollida_retornada_at: '2026-11-15T12:00:00Z' }), [], ARA)).toBe(true)
  })
  it('con un OPE vivo (heredado) no: va por su albarán; anulado, sí', () => {
    expect(esRecollidaDelEquip(canal(), [a('o1', 'OPE', 'emitido', 'c1')], ARA)).toBe(false)
    expect(esRecollidaDelEquip(canal(), [a('o1', 'OPE', 'anulado', 'c1')], ARA)).toBe(true)
  })
})
