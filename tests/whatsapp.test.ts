// El corte del interruptor global en la única puerta de salida hacia Meta.
//
// POR QUÉ ESTAS PRUEBAS EXISTEN. `whatsapp.ts` no tenía ninguna: `enviar()` es privada y
// contacta con la Graph API, así que parecía interior. Pero el interruptor (§8) se aplica
// ANTES de esa llamada, así que esa parte sí se puede ejercitar sin red — y es la que
// tiene que ser exacta, porque un error aquí no da error: el mensaje simplemente no sale,
// o peor, se da por enviado.
//
// LAS DOS COSAS QUE SE COMPRUEBAN, y las dos son la diferencia con el modo simulado:
//   1. Devuelve `ok:false`. Con `ok:true` el intake avanzaría de paso sin haber
//      preguntado nada (deuda 3), `enviar-acceso` no caería a correo y el panel daría por
//      enviada una oferta que nadie ha recibido.
//   2. No escribe NADA en `wa_messages`. Un corte nuestro no es un rechazo de Meta: una
//      fila `status='error'` pintada en rojo en la consola mandaría al equipo a
//      diagnosticar un token que está perfectamente (§8ter).

import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import {
  sendBotones, sendLista, sendTemplate, sendText,
} from '../supabase/functions/_shared/whatsapp.ts'
import { crearCliente } from './soporte/clienteFalso.ts'

const APAGADO = { app_settings: [{ key: 'whatsapp_activo', value: 'false' }] }

/** Los cuatro envíos, cada uno con sus argumentos, para recorrerlos de una vez. */
// deno-lint-ignore no-explicit-any
const ENVIOS: { nombre: string; enviar: (c: any) => Promise<unknown> }[] = [
  { nombre: 'sendText', enviar: (c) => sendText(c, '34612345678', 'hola') },
  { nombre: 'sendTemplate', enviar: (c) => sendTemplate(c, '34612345678', 'hello_world', 'en') },
  {
    nombre: 'sendBotones',
    enviar: (c) => sendBotones(c, '34612345678', 'Continuar?', [{ id: 'si', titulo: 'Sí' }]),
  },
  {
    nombre: 'sendLista',
    enviar: (c) => sendLista(c, '34612345678', 'Tria', 'Obre', [{ id: 'a', titulo: 'A' }]),
  },
]

describe('whatsapp · interruptor global apagado', () => {
  for (const { nombre, enviar } of ENVIOS) {
    it(`${nombre} devuelve 503 y NO da el envío por bueno`, async () => {
      const { cliente } = crearCliente(APAGADO)
      const r = await enviar(cliente) as {
        ok: boolean; status: number; desactivado?: boolean; simulado?: boolean
        waMessageId: string | null; data: { code?: string }
      }
      expect(r.ok).toBe(false)
      expect(r.status).toBe(503)
      expect(r.data?.code).toBe('whatsapp_desactivat')
      expect(r.desactivado).toBe(true)
      // Lo que lo distingue del modo simulado, que sí devuelve `ok:true` y un id.
      expect(r.simulado).toBeUndefined()
      expect(r.waMessageId).toBeNull()
    })

    it(`${nombre} no escribe nada en wa_messages`, async () => {
      const { cliente, escrituras } = crearCliente(APAGADO)
      await enviar(cliente)
      expect(escrituras).toEqual([])
    })
  }

  it('lee el interruptor una vez por envío, y de app_settings', async () => {
    const { cliente, consultadas } = crearCliente(APAGADO)
    await sendText(cliente, '34612345678', 'hola')
    expect(consultadas).toEqual(['app_settings'])
  })

})

// ---------------------------------------------------------------------------
// El fail-safe, visto desde el otro lado
// ---------------------------------------------------------------------------
// Sin la fila del interruptor el canal sigue disponible, así que el envío PASA del corte.
// Comprobarlo obliga a entrar en `envioReal()`, que lee `Deno.env` — un global que en Node
// no existe a propósito (`tests/deno.d.ts`: los módulos que lo usan no se llaman desde las
// pruebas). Aquí se pone el mínimo imprescindible y se retira después: devuelve `undefined`
// para todo, así que `WHATSAPP_ENVIO_REAL` no vale "true", el módulo entra en modo simulado
// y NO hay ninguna llamada de red. Es el único sitio del arnés donde hace falta, y es la
// forma de cubrir el caso que de verdad importa: que apagar el interruptor sea lo único que
// apaga WhatsApp.
describe('whatsapp · sin la fila del interruptor', () => {
  const original = (globalThis as Record<string, unknown>).Deno
  beforeAll(() => {
    ;(globalThis as Record<string, unknown>).Deno = { env: { get: () => undefined } }
  })
  afterAll(() => {
    if (original === undefined) delete (globalThis as Record<string, unknown>).Deno
    else (globalThis as Record<string, unknown>).Deno = original
  })

  it('el envío NO se corta y cae en el modo simulado de siempre', async () => {
    const { cliente } = crearCliente({ app_settings: [] })
    const r = await sendText(cliente, '34612345678', 'hola') as {
      ok: boolean; desactivado?: boolean; simulado?: boolean; waMessageId: string | null
    }
    expect(r.desactivado).toBeUndefined()
    expect(r.ok).toBe(true)
    expect(r.simulado).toBe(true)
    expect(r.waMessageId?.startsWith('sim-')).toBe(true)
  })

  it('y entonces sí registra el saliente en wa_messages', async () => {
    const { cliente, escrituras } = crearCliente({ app_settings: [] })
    await sendText(cliente, '34612345678', 'hola')
    expect(escrituras.map((e) => e.tabla)).toEqual(['wa_messages'])
  })
})
