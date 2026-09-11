// El interruptor de envío real del correo (§12.59, §12.73).
//
// `sendEmail()` no se prueba entera aquí: llama a `Deno.env` y a `fetch`, y lo que
// importa de ella no es la llamada HTTP sino LA DECISIÓN de hacerla o no. Esa decisión
// está en `esEnvioReal()`, que es pura y no toca el runtime — igual que `tocaAviso()` en
// los recordatorios documentales, y por el mismo motivo.
//
// Lo que se comprueba es el fail-safe: **solo `"true"` exacto manda correo de verdad**.
// El gemelo de WhatsApp (`WHATSAPP_ENVIO_REAL`) lleva desde julio con esa regla y nunca
// ha tenido quien la vigile; esta sí.

import { describe, expect, it } from 'vitest'
import { esEnvioReal } from '../supabase/functions/_shared/resend'

describe('esEnvioReal', () => {
  it('solo el literal "true" enciende el envío', () => {
    expect(esEnvioReal('true')).toBe(true)
  })

  it('el secreto sin configurar NO envía (seguro por omisión)', () => {
    expect(esEnvioReal(undefined)).toBe(false)
    expect(esEnvioReal(null)).toBe(false)
    expect(esEnvioReal('')).toBe(false)
  })

  it('no se deja convencer por variantes', () => {
    // Un interruptor permisivo acaba encendido sin que nadie lo haya encendido: el día
    // que alguien escriba `RESEND_ENVIO_REAL=1` pensando que es lo mismo, tiene que
    // NO enviar, no enviar a 452 fichas reales.
    for (const valor of ['TRUE', 'True', '1', 'yes', 'sí', ' true', 'true ', 'false']) {
      expect(esEnvioReal(valor), valor).toBe(false)
    }
  })
})
