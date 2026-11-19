// Los contadores en vivo (fase 5 de los puntos 4-6): qué tablas escucha cada panel y qué
// refresca cada una, y el badge de «Els meus interessos» con las propuestas por responder.

import { describe, expect, it } from 'vitest'
import { comptaInteressos, refrescosDe, TAULES_EQUIP, taulesASubscriure } from '../src/lib/comptadorsEnViu'

const equip = { intern: true, extern: false, receptor: false }
const receptor = { intern: false, extern: true, receptor: true }
const productor = { intern: false, extern: true, receptor: false }

describe('taulesASubscriure', () => {
  it('nadie, nada', () => {
    expect(taulesASubscriure({ intern: false, extern: false, receptor: false })).toEqual([])
  })

  it('el equipo escucha las tablas de las colas de `pendents_equip()`', () => {
    expect(taulesASubscriure(equip)).toEqual([...TAULES_EQUIP].sort())
  })

  it('el receptor: lo de `pendents_meus()`, los avisos y las ofertas del Mercat', () => {
    expect(taulesASubscriure(receptor)).toEqual(
      ['albaranes', 'avisos', 'convenios', 'documentos', 'excedentes', 'firmes_document', 'oferta_respuestas'])
    expect(taulesASubscriure(productor)).not.toContain('excedentes')
  })

  // Todas tienen que estar en la publicación de Realtime (20270610100000 + 20270610100200).
  it('ninguna fuera de la publicación', () => {
    const PUBLICADES = ['excedentes', 'canalizaciones', 'oferta_respuestas', 'membresias', 'wa_contacts', 'wa_messages',
      'avisos', 'convenios', 'albaranes', 'firmes_document', 'excedentes_canvis', 'documentos']
    const doble = taulesASubscriure({ intern: true, extern: true, receptor: true })
    expect(doble.filter((t) => !PUBLICADES.includes(t))).toEqual([])
  })
})

describe('refrescosDe', () => {
  it('cada panel refresca lo suyo y nada más', () => {
    expect(refrescosDe('oferta_respuestas', equip)).toEqual(['equip'])
    expect(refrescosDe('oferta_respuestas', receptor)).toEqual(['pendents'])
    expect(refrescosDe('avisos', receptor)).toEqual(['avisos'])
    expect(refrescosDe('avisos', equip)).toEqual([])
    expect(refrescosDe('excedentes', receptor)).toEqual(['mercat'])
    expect(refrescosDe('excedentes', productor)).toEqual([])
    expect(refrescosDe('membresias', receptor)).toEqual([])
    // Doble rol: los dos.
    expect(refrescosDe('convenios', { intern: true, extern: true, receptor: false })).toEqual(['equip', 'pendents'])
  })
})

describe('comptaInteressos', () => {
  it('suma las propuestas por responder a los avisos sin leer', () => {
    expect(comptaInteressos(0, [], ['r1', 'r2'])).toBe(2)
    expect(comptaInteressos(3, [], [])).toBe(3)
  })

  it('una propuesta con su aviso todavía sin leer no cuenta dos veces', () => {
    const avis = { tipus: 'canvis_proposats', objecte_id: 'r1', llegit_at: null }
    expect(comptaInteressos(1, [avis], ['r1'])).toBe(1)
    // Leído el aviso (al abrir la pantalla), la propuesta sigue contando hasta que se responda.
    expect(comptaInteressos(0, [{ ...avis, llegit_at: '2027-06-10T10:00:00Z' }], ['r1'])).toBe(1)
    // Otro aviso sin leer de la misma respuesta no la tapa.
    expect(comptaInteressos(1, [{ ...avis, tipus: 'interes_aprovat' }], ['r1'])).toBe(2)
  })
})
