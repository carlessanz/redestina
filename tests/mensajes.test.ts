// «Sin contestar»: los mensajes entrantes posteriores al último saliente de ese teléfono.
//
// POR QUÉ IMPORTA: este contador es lo único que le dice al equipo que alguien está
// esperando respuesta. Lo usan el badge de `ProducersList`, el orden de `ContactList` (los
// pendientes arriba) y el contador del menú en `AppShell`. Si contara de menos, una
// conversación se quedaría sin responder sin que nadie lo viera — y el fallo sería
// silencioso, porque un cero es un resultado perfectamente normal.
//
// La función es pura y recibe TODAS las filas de todos los teléfonos mezcladas y sin ordenar
// (es lo que devuelve la consulta, deuda §12.5), así que los dos casos que hay que fijar son
// que no se contamine un teléfono con otro y que el orden de llegada de las filas no importe.

import { describe, it, expect } from 'vitest'
import { countUnanswered, type MessageRow } from '../src/lib/mensajes'

/** Fila mínima: teléfono, dirección y momento. */
function msg(phone: string, direction: 'inbound' | 'outbound', minuto: number): MessageRow {
  const mm = String(minuto).padStart(2, '0')
  return { contact_phone: phone, direction, created_at: `2026-09-11T10:${mm}:00.000Z` }
}

describe('countUnanswered · casos básicos', () => {
  it('sin mensajes no hay nada pendiente', () => {
    expect(countUnanswered([])).toEqual({})
  })

  it('solo entrantes: todos cuentan, porque nunca se ha contestado', () => {
    const filas = [msg('34600000001', 'inbound', 1), msg('34600000001', 'inbound', 2)]
    expect(countUnanswered(filas)).toEqual({ '34600000001': 2 })
  })

  it('solo salientes: no hay nada pendiente y el teléfono ni aparece', () => {
    // Aparecer con 0 y no aparecer no es lo mismo para quien pinta el badge.
    expect(countUnanswered([msg('34600000001', 'outbound', 5)])).toEqual({})
  })

  it('un entrante ANTERIOR al último saliente no cuenta: ya está contestado', () => {
    const filas = [msg('34600000001', 'inbound', 1), msg('34600000001', 'outbound', 2)]
    expect(countUnanswered(filas)).toEqual({})
  })

  it('cuenta solo los entrantes posteriores al último saliente', () => {
    const filas = [
      msg('34600000001', 'inbound', 1),   // contestado
      msg('34600000001', 'outbound', 2),  // ← la respuesta
      msg('34600000001', 'inbound', 3),   // pendiente
      msg('34600000001', 'inbound', 4),   // pendiente
    ]
    expect(countUnanswered(filas)).toEqual({ '34600000001': 2 })
  })

  it('manda el ÚLTIMO saliente, no el primero', () => {
    const filas = [
      msg('34600000001', 'outbound', 1),
      msg('34600000001', 'inbound', 2),
      msg('34600000001', 'outbound', 3),  // ← este es el que cuenta
      msg('34600000001', 'inbound', 4),
    ]
    expect(countUnanswered(filas)).toEqual({ '34600000001': 1 })
  })

  it('un entrante EXACTAMENTE a la hora del último saliente no cuenta', () => {
    // La comparación es estricta (`>`). Empate = contestado: es la lectura prudente, porque
    // el empate real lo produce una respuesta automática en el mismo segundo.
    const filas = [msg('34600000001', 'inbound', 7), msg('34600000001', 'outbound', 7)]
    expect(countUnanswered(filas)).toEqual({})
  })
})

describe('countUnanswered · varios teléfonos', () => {
  it('no contamina un teléfono con los mensajes de otro', () => {
    const filas = [
      msg('34600000001', 'inbound', 1),
      msg('34600000002', 'outbound', 2),   // el saliente del SEGUNDO no calla al primero
      msg('34600000002', 'inbound', 3),
      msg('34600000003', 'inbound', 4),
      msg('34600000003', 'outbound', 5),
    ]
    expect(countUnanswered(filas)).toEqual({ '34600000001': 1, '34600000002': 1 })
  })

  it('el orden de llegada de las filas no cambia el resultado', () => {
    // La consulta no garantiza orden, así que la función no puede depender de él.
    const enOrden = [
      msg('34600000001', 'inbound', 1),
      msg('34600000001', 'outbound', 2),
      msg('34600000001', 'inbound', 3),
      msg('34600000002', 'inbound', 4),
    ]
    const alReves = [...enOrden].reverse()
    const barajado = [enOrden[2], enOrden[0], enOrden[3], enOrden[1]]
    const esperado = { '34600000001': 1, '34600000002': 1 }
    expect(countUnanswered(enOrden)).toEqual(esperado)
    expect(countUnanswered(alReves)).toEqual(esperado)
    expect(countUnanswered(barajado)).toEqual(esperado)
  })
})

describe('countUnanswered · comparación de fechas', () => {
  it('compara ISO como texto, y eso funciona a través de días y meses', () => {
    // `created_at` se compara como cadena, no como fecha. Es correcto **solo** porque
    // PostgREST devuelve siempre ISO 8601 en UTC con el mismo ancho de campo: así el orden
    // lexicográfico y el cronológico coinciden. Si alguna vez llegara otro formato, esto
    // dejaría de valer en silencio; por eso el caso queda fijado.
    const filas: MessageRow[] = [
      { contact_phone: '34600000001', direction: 'outbound', created_at: '2026-09-30T23:59:00.000Z' },
      { contact_phone: '34600000001', direction: 'inbound', created_at: '2026-10-01T00:00:00.000Z' },
      { contact_phone: '34600000001', direction: 'inbound', created_at: '2025-12-31T00:00:00.000Z' },
    ]
    expect(countUnanswered(filas)).toEqual({ '34600000001': 1 })
  })
})
