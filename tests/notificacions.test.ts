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
import { crearCliente } from './soporte/clienteFalso'
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

// El doble de cliente de siempre (`soporte/clienteFalso`): `app_settings` y las fichas, con
// `test_mode` apagado salvo donde se prueba el modo test.
function clientFals(settings: { key: string; value: string }[], extra: Record<string, Record<string, unknown>[]> = {}) {
  const { cliente, escrituras } = crearCliente({
    app_settings: settings.some((f) => f.key === 'test_mode') ? settings : [{ key: 'test_mode', value: 'false' }, ...settings],
    ...extra,
  })
  const inserts = new Proxy([] as Record<string, unknown>[], {
    get: (_t, k) => (escrituras.filter((e) => e.tabla === 'documento_envios').map((e) => e.valores) as Record<string, unknown>[])[k as never],
  })
  return { client: cliente, inserts }
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

  it('con el modo test activo, un correo que NO es de prueba no sale (no_test_user)', async () => {
    const { client, inserts } = clientFals([{ key: 'test_mode', value: 'true' }],
      { productores: [{ id: 'p', email: 'a@b.cat', es_test: false }] })
    const r = await sendEmail(payload, { supabase: client, proposito: 'oferta' })
    expect(r.ok).toBe(false)
    expect((r.data as { code: string }).code).toBe('no_test_user')
    expect(inserts[0]?.estado).toBe('desactivat')
  })

  it('con el modo test activo, a una ficha de prueba sí sale', async () => {
    const { client } = clientFals([{ key: 'test_mode', value: 'true' }],
      { entidades: [{ id: 'e', email: 'A@b.cat', es_test: true }] })
    expect((await sendEmail(payload, { supabase: client, proposito: 'oferta' })).ok).toBe(true)
  })

  it('con el modo test activo, al buzón del equipo sí sale', async () => {
    const { client } = clientFals([{ key: 'test_mode', value: 'true' }],
      { parametros_documentales: [{ id: 1, email_equipo: 'a@b.cat' }] })
    expect((await sendEmail(payload, { supabase: client, proposito: 'recordatori_equip' })).ok).toBe(true)
  })

  it('un _ en el correo no hace pasar por prueba a otro correo (comodín escapado)', async () => {
    const { client } = clientFals([{ key: 'test_mode', value: 'true' }],
      { productores: [{ id: 'p', email: 'joan.puig@b.cat', es_test: true }] })
    const r = await sendEmail({ ...payload, to: 'joan_puig@b.cat' }, { supabase: client, proposito: 'oferta' })
    expect(r.ok).toBe(false)
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
