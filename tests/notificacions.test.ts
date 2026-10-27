// Los interruptores de notificaciones (27-10-2026, §8): el general y uno por canal.
//
// Lo que tiene que ser verdad, y por qué cuesta caro si no lo es:
//   · el general apagado apaga los dos canales aunque sus claves digan otra cosa;
//   · ante la duda (fila ausente, lectura fallida) todo encendido: la plataforma no se queda muda;
//   · un correo operativo cortado NO devuelve `ok:true` (avanzaría contadores, marcaría avisos);
//   · un correo TRANSACCIONAL (acceso, contraseña) no lo corta nada;
//   · y el texto RGPD que enseña el navegador es letra por letra el que el servidor hashea.

;(globalThis as Record<string, unknown>).Deno = { env: { get: () => undefined } }

import { describe, expect, it } from 'vitest'
import { resolCanals } from '../supabase/functions/_shared/gate'
import { decidirCanal } from '../supabase/functions/_shared/canal'
import { sendEmail } from '../supabase/functions/_shared/resend'
import * as srvRgpd from '../supabase/functions/_shared/textosRgpd'
import * as webRgpd from '../src/lib/textosRgpd'
import { algunCanal, filtraPerCanals, motiuCanal, motiuTallServidor } from '../src/lib/canals'

const fila = (key: string, value: string) => ({ key, value })

describe('resolCanals (servidor)', () => {
  it('sin filas, todo encendido (fail-safe)', () => {
    expect(resolCanals([])).toEqual({ notificacions: true, email: true, whatsapp: true })
  })
  it('el general apagado apaga los dos canales aunque sus claves digan true', () => {
    expect(resolCanals([fila('notificacions_actives', 'false'), fila('email_activo', 'true'), fila('whatsapp_activo', 'true')]))
      .toEqual({ notificacions: false, email: false, whatsapp: false })
  })
  it('cada canal se apaga solo con su clave', () => {
    expect(resolCanals([fila('email_activo', 'false')])).toEqual({ notificacions: true, email: false, whatsapp: true })
    expect(resolCanals([fila('whatsapp_activo', 'false')])).toEqual({ notificacions: true, email: true, whatsapp: false })
  })
  it('solo "false" exacto apaga', () => {
    expect(resolCanals([fila('email_activo', 'FALSE')]).email).toBe(true)
  })
})

describe('decidirCanal con los interruptores', () => {
  const base = { telefono: '34612345678', email: 'a@b.cat', opt_in: true }
  it('con el general apagado: cap canal, y el motivo es el interruptor', () => {
    const d = decidirCanal({ ...base, notificacions_actives: false })
    expect(d.canal).toBe('cap')
    expect(d.motivo).toBe('notificacions_desactivades')
  })
  it('con el correo apagado y WhatsApp viable, va por WhatsApp', () => {
    const d = decidirCanal({ ...base, email_activo: false })
    expect(d.canal).toBe('whatsapp')
    expect(d.emailPosible).toBe(false)
  })
  it('con el correo apagado y sin WhatsApp viable, cap con motivo email_desactivat', () => {
    const d = decidirCanal({ ...base, opt_in: false, email_activo: false })
    expect(d.canal).toBe('cap')
    expect(d.motivo).toBe('email_desactivat')
  })
  it('con los dos canales apagados, cap por el interruptor y no por la ficha', () => {
    const d = decidirCanal({ ...base, email_activo: false, whatsapp_activo: false })
    expect(d.motivo).toBe('notificacions_desactivades')
  })
  it('una preferencia de correo con el correo apagado cae a WhatsApp diciendo por qué', () => {
    const d = decidirCanal({ ...base, canal_preferido: 'email', email_activo: false })
    expect(d.canal).toBe('whatsapp')
    expect(d.motivo).toBe('email_desactivat')
    expect(d.preferenciaRespetada).toBe(false)
  })
  it('sin los parámetros nuevos, igual que antes', () => {
    expect(decidirCanal({ email: 'a@b.cat' }).canal).toBe('email')
  })
})

// Un cliente de Supabase mínimo: lee `app_settings` y captura lo que se inserta.
function clientFals(settings: { key: string; value: string }[]) {
  const inserts: Record<string, unknown>[] = []
  // `as never`: un doble mínimo, no un cliente entero (solo lo que `sendEmail` toca).
  const client = {
    from(taula: string) {
      return {
        select: () => ({ in: () => Promise.resolve({ data: taula === 'app_settings' ? settings : [] }) }),
        insert: (fila: Record<string, unknown>) => { inserts.push(fila); return Promise.resolve({ error: null }) },
      }
    },
  } as never
  return { client, inserts }
}

describe('sendEmail y los interruptores', () => {
  const payload = { to: 'a@b.cat', subject: 'x', text: 'x' }

  it('un correo operativo con el correo apagado no sale, es ok:false y queda trazado como desactivat', async () => {
    const { client, inserts } = clientFals([fila('email_activo', 'false')])
    const r = await sendEmail(payload, { supabase: client, proposito: 'oferta' })
    expect(r.ok).toBe(false)
    expect(r.desactivado).toBe(true)
    expect((r.data as { code: string }).code).toBe('email_desactivat')
    expect(inserts[0]?.estado).toBe('desactivat')
  })

  it('con el general apagado, el código es el del general', async () => {
    const { client } = clientFals([fila('notificacions_actives', 'false')])
    const r = await sendEmail(payload, { supabase: client, proposito: 'avis' })
    expect((r.data as { code: string }).code).toBe('notificacions_desactivades')
  })

  it('un correo TRANSACCIONAL sale aunque todo esté apagado (aquí, simulado)', async () => {
    const { client, inserts } = clientFals([fila('notificacions_actives', 'false')])
    const r = await sendEmail(payload, { supabase: client, proposito: 'acces' }, { transaccional: true })
    expect(r.ok).toBe(true)
    expect(r.desactivado).toBeUndefined()
    expect(inserts[0]?.estado).toBe('simulat')
  })

  it('un correo operativo sin traza falla cerrado', async () => {
    const r = await sendEmail(payload)
    expect(r.ok).toBe(false)
    expect(r.desactivado).toBe(true)
  })

  it('con todo encendido, sale (simulado)', async () => {
    const { client } = clientFals([])
    expect((await sendEmail(payload, { supabase: client, proposito: 'oferta' })).ok).toBe(true)
  })
})

describe('canals.ts (interfaz)', () => {
  const tot = { notificacions: true, email: true, whatsapp: true }
  it('el motivo del general va primero', () => {
    expect(motiuCanal({ notificacions: false, email: false, whatsapp: false }, 'email')).toBe('canal.motiu_notificacions')
    expect(motiuCanal({ ...tot, email: false }, 'email')).toBe('canal.motiu_email')
    expect(motiuCanal(tot, 'whatsapp')).toBeNull()
  })
  it('las entradas que exigen un canal apagado desaparecen', () => {
    const items = [{ to: 'a' }, { to: 'm', requereix: 'whatsapp' as const }]
    expect(filtraPerCanals(items, { ...tot, whatsapp: false }).map((i) => i.to)).toEqual(['a'])
    expect(filtraPerCanals(items, tot)).toHaveLength(2)
  })
  it('algunCanal y los códigos del servidor', () => {
    expect(algunCanal({ notificacions: true, email: false, whatsapp: false })).toBe(false)
    expect(motiuTallServidor('email_desactivat')).toBe('canal.motiu_email')
    expect(motiuTallServidor('no_test_user')).toBeNull()
  })
})

describe('textos RGPD: la copia del navegador es la del servidor', () => {
  it('misma versión y mismos tipos', () => {
    expect(webRgpd.VERSIO_RGPD).toBe(srvRgpd.VERSIO_RGPD)
    expect([...webRgpd.TIPUS_CONSENTIMENT]).toEqual([...srvRgpd.TIPUS_CONSENTIMENT])
  })
  it('mismo texto, letra por letra, en los dos idiomas y los dos modos', () => {
    for (const tipus of srvRgpd.TIPUS_CONSENTIMENT) {
      for (const idioma of ['ca', 'es'] as const) {
        for (const assistit of [false, true]) {
          expect(webRgpd.textConsentiment(tipus, idioma, assistit)).toBe(srvRgpd.textConsentiment(tipus, idioma, assistit))
        }
      }
    }
  })
  it('la huella es sha256 hex del texto', async () => {
    expect(await srvRgpd.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
