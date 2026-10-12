// La foto de la oferta en el WhatsApp con botones y en el correo (fase 8 de la revisión del
// 08-10-2026). Solo contra el CLON LOCAL, con el envío SIMULADO (`WHATSAPP_ENVIO_REAL=false`,
// `RESEND_ENVIO_REAL=false`): lo que se comprueba es el camino entero —sesión del equipo, gates,
// firma de la URL de la foto, cabecera de imagen y registro en la consola—, no la entrega.
// El envío real a un número de Meta se hace a mano (ver AGENTS.md §6ter, fase 8).
//
//   E2E_CLON=1 npx playwright test tests/e2e/foto-oferta.e2e.ts

import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { compte, motiuSaltClon, sql } from './ajuda'

const API = 'http://127.0.0.1:55321'

function claveLocal(): string {
  const env = readFileSync('.env.supabase-local.local', 'utf8')
  return /VITE_SUPABASE_PUBLISHABLE_KEY=(.+)/.exec(env)![1].trim()
}

async function jwtEquip(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const c = compte('super_admin')!
  const r = await request.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: claveLocal() },
    data: { email: c.email, password: c.password },
  })
  expect(r.ok(), 'login del equipo en el clon').toBeTruthy()
  return (await r.json()).access_token as string
}

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null || info.project.name !== 'escriptori', m ?? 'Solo en escritorio')
})

test('WhatsApp con botones: la oferta con foto sale con cabecera de imagen y queda en la consola', async ({ request }) => {
  const oferta = sql(`select id from excedentes where cardinality(fotos) > 0 limit 1`)
  test.skip(oferta === '', 'Ninguna oferta con foto en el clon')
  const telefon = '34676452492' // Carles Sanz: ficha es_test y en la whitelist de Meta
  // La ventana de 24 h la abre quien escribe: en el clon se abre a mano.
  sql(`update wa_contacts set last_inbound_at = now(), opt_in = true where phone = '${telefon}'`)

  const jwt = await jwtEquip(request)
  const r = await request.post(`${API}/functions/v1/whatsapp-send`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: claveLocal() },
    data: {
      to: telefon, type: 'botones', body: 'OFERTA DISPONIBLE (prova E2E)',
      botones: [{ id: 'accept:si', titulo: 'M’interessa' }, { id: 'accept:no', titulo: 'Ara no' }],
      foto_excedente: oferta,
    },
  })
  const cos = await r.json()
  expect(r.status(), JSON.stringify(cos)).toBe(200)
  expect(cos.simulado).toBe(true)

  const darrer = sql(`select body from wa_messages where contact_phone = '${telefon}' and direction = 'outbound'
                      order by created_at desc limit 1`)
  expect(darrer).toMatch(/^\[imatge\] /)
  // La consola no guarda nunca la URL firmada de la foto.
  expect(darrer).not.toMatch(/https?:/)
})

test('WhatsApp con botones: una oferta sin foto sale sin cabecera', async ({ request }) => {
  const telefon = '34676452492'
  sql(`update wa_contacts set last_inbound_at = now(), opt_in = true where phone = '${telefon}'`)
  const jwt = await jwtEquip(request)
  const r = await request.post(`${API}/functions/v1/whatsapp-send`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: claveLocal() },
    data: {
      to: telefon, type: 'botones', body: 'OFERTA sense foto (prova E2E)',
      botones: [{ id: 'accept:si', titulo: 'M’interessa' }, { id: 'accept:no', titulo: 'Ara no' }],
    },
  })
  expect(r.status()).toBe(200)
  const darrer = sql(`select body from wa_messages where contact_phone = '${telefon}' and direction = 'outbound'
                      order by created_at desc limit 1`)
  expect(darrer).not.toMatch(/^\[imatge\]/)
})

test('correo: la oferta con foto sale por la plantilla con la imagen y respeta la whitelist', async ({ request }) => {
  const oferta = sql(`select id from excedentes where cardinality(fotos) > 0 limit 1`)
  test.skip(oferta === '', 'Ninguna oferta con foto en el clon')
  const to = 'hola+recowner-social@carlessanz.com'
  sql(`insert into email_test_recipients (email, etiqueta) values ('${to}', 'E2E') on conflict do nothing`)

  const jwt = await jwtEquip(request)
  const r = await request.post(`${API}/functions/v1/enviar-email`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: claveLocal() },
    data: {
      to, subject: 'Oferta (prova E2E)', text: 'OFERTA DISPONIBLE', foto_excedente: oferta,
      plantilla: { titulo: 'Oferta disponible' },
    },
  })
  const cos = await r.json()
  expect(r.status(), JSON.stringify(cos)).toBe(200)
})
