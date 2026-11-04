// Notificaciones apagadas = solo lo automático (04-11-2026, §8). Solo contra el CLON: apaga
// `email_activo` y lo deja como estaba al acabar.
//
// Lo que se afirma, en orden (modo serie):
//   1. `enviar-email`: con `manual` sale el convenio a firmar (lista cerrada); la oferta, no
//      (503 `email_desactivat` aunque el cliente diga `manual`).
//   2. `reenviar-documento`: sin `manual`, 409 `desactivat`; con él, sale y la traza dice
//      `reenviar-documento:manual`.
//   3. «Envia per correu» de un albarán conciliado: el diálogo avisa de que las notificaciones
//      están apagadas; al aceptar sale el PDF, sin enlace.
//   4. El mismo botón con el albarán entregado: además acuña un enlace de confirmación nuevo.

import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { compte, entra, motiuSaltClon, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:55321'
let abans = ''

function publishable(): string {
  const env = readFileSync('.env.supabase-local.local', 'utf8')
  return /VITE_SUPABASE_PUBLISHABLE_KEY=(\S+)/.exec(env)?.[1] ?? ''
}

async function jwt(rol: string): Promise<string> {
  const c = compte(rol)!
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishable(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.password }),
  })
  return ((await r.json()) as { access_token: string }).access_token
}

async function crida(funcio: string, cos: unknown): Promise<{ status: number; code?: string; resultat?: string }> {
  const r = await fetch(`${API}/functions/v1/${funcio}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await jwt('super_admin')}` },
    body: JSON.stringify(cos),
  })
  const d = (await r.json().catch(() => ({}))) as { code?: string; resultat?: string }
  return { status: r.status, code: d.code, resultat: d.resultat }
}

/** Un correo de prueba que pasa el modo test y la lista blanca del clon. */
function correuProva(): string {
  return sql(`select e.email from entidades e join email_test_recipients w on lower(w.email) = lower(e.email)
    where e.es_test order by e.email limit 1`)
}

/** Un ENT con el PDF generado y el receptor de prueba y en la lista blanca. */
function albara(estat: string): string {
  return sql(`select a.id from albaranes a
      join canalizaciones c on c.id = a.canalizacion_id
      join entidades e on e.id = c.entidad_id and e.es_test
      join email_test_recipients w on lower(w.email) = lower(e.email)
      join documentos d on d.objeto_tipo = 'albaran' and d.objeto_id = a.id and d.vigente and d.fichero_at is not null
     where a.tipo = 'ENT' and a.estado = '${estat}' order by a.created_at limit 1`)
}

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(() => {
  if (motiuSaltClon('super_admin') !== null) return
  abans = sql(`select coalesce((select value from app_settings where key = 'email_activo'), '')`)
  sql(`insert into app_settings (key, value) values ('email_activo', 'false')
       on conflict (key) do update set value = 'false'`)
  // El freno de doble clic es de 2 minutos: las dos pasadas (móvil y escritorio) lo pisarían.
  sql(`delete from documento_envios where funcion like '%:manual' and created_at > now() - interval '10 minutes'`)
})

test.afterAll(() => {
  if (motiuSaltClon('super_admin') !== null) return
  if (abans) sql(`update app_settings set value = '${abans}' where key = 'email_activo'`)
  else sql(`delete from app_settings where key = 'email_activo'`)
})

test('enviar-email: el conveni surt a mà; l’oferta, no', async () => {
  const to = correuProva()
  const base = { to, subject: 'E2E manual', text: 'E2E', manual: true }
  expect(await crida('enviar-email', { ...base, proposito: 'oferta' })).toMatchObject({ status: 503, code: 'email_desactivat' })
  expect((await crida('enviar-email', { ...base, proposito: 'firma_conveni' })).status).toBe(200)
  expect(sql(`select count(*) from documento_envios where proposito = 'firma_conveni' and destinatario = '${to}'
    and funcion = 'enviar-email:manual' and created_at > now() - interval '1 minute'`)).not.toBe('0')
})

test('reenviar-documento: sense manual no surt; amb manual, sí', async () => {
  const doc = sql(`select d.id from documentos d
      join email_test_recipients w on lower(w.email) = lower(d.envio ->> 'destinatario')
     where d.tipo = 'CONV' and d.estado = 'emitido' and d.fichero_at is not null and d.modo = 'real'
       and exists (select 1 from entidades e where lower(e.email) = lower(d.envio ->> 'destinatario') and e.es_test)
     order by d.emitido_at desc limit 1`)
  test.skip(!doc, 'el clon no té cap conveni emès per a una fitxa de prova de la llista blanca')
  expect(await crida('reenviar-documento', { documento_id: doc })).toMatchObject({ status: 409, code: 'desactivat' })
  const r = await crida('reenviar-documento', { documento_id: doc, manual: true })
  expect(r.status).toBe(200)
  expect(sql(`select funcion from documento_envios where documento_id = '${doc}' order by created_at desc limit 1`))
    .toBe('reenviar-documento:manual')
})

test('«Envia per correu» d’un albarà conciliat: el PDF, sense enllaç', async ({ page }) => {
  const id = albara('conciliado')
  test.skip(!id, 'el clon no té cap ENT conciliat amb PDF per a una fitxa de prova')
  const enllacos = sql(`select count(*) from enlaces_token where objeto_id = '${id}'`)
  await entra(page, 'super_admin')
  await page.goto(`/equip/albarans/${id}`)
  await page.getByRole('button', { name: /^Envia per correu$|^Envía por correo$/ }).click()
  const dialeg = page.getByRole('dialog')
  await expect(dialeg).toContainText(/només aturen els enviaments automàtics|solo paran los envíos automáticos/)
  await dialeg.getByRole('button', { name: /^Envia per correu$|^Envía por correo$/ }).click()
  await expect(page.getByText(/Correu simulat: no ha sortit|Correo simulado: no ha salido|Albarà enviat a|Albarán enviado a/).first()).toBeVisible()

  expect(sql(`select estado || '|' || funcion from documento_envios where objeto_id = '${id}' and proposito = 'albara'
    order by created_at desc limit 1`)).toMatch(/^(simulat|enviat)\|enviar-albara:manual$/)
  expect(sql(`select count(*) from enlaces_token where objeto_id = '${id}'`)).toBe(enllacos)
})

test('amb l’albarà entregat, porta un enllaç nou per confirmar', async ({ page }) => {
  const id = albara('emitido')
  test.skip(!id, 'el clon no té cap ENT emès amb PDF per a una fitxa de prova')
  const actius = sql(`select coalesce(string_agg(id::text, ','), '') from enlaces_token
    where objeto_id = '${id}' and proposito = 'confirmacion_albaran' and estado = 'activo'`)
  const entregatAbans = sql(`select coalesce(entregado_at::text, '') from albaranes where id = '${id}'`)
  sql(`update albaranes set estado = 'entregado' where id = '${id}'`)
  try {
    await entra(page, 'super_admin')
    await page.goto(`/equip/albarans/${id}`)
    await page.getByRole('button', { name: /^Envia per correu$|^Envía por correo$/ }).click()
    const dialeg = page.getByRole('dialog')
    await expect(dialeg).toContainText(/un enllaç nou per confirmar|un enlace nuevo para confirmar/)
    await dialeg.getByRole('button', { name: /^Envia per correu$|^Envía por correo$/ }).click()
    await expect(page.getByText(/Correu simulat: no ha sortit|Correo simulado: no ha salido|Albarà enviat a|Albarán enviado a/).first()).toBeVisible()
    expect(sql(`select count(*) from enlaces_token where objeto_id = '${id}' and proposito = 'confirmacion_albaran'
      and estado = 'activo' and canal = 'email' and created_at > now() - interval '1 minute'`)).toBe('1')
  } finally {
    // El clon, como estaba: el albarán emitido y sus enlaces de antes.
    sql(`delete from enlaces_token where objeto_id = '${id}' and proposito = 'confirmacion_albaran'
      and created_at > now() - interval '10 minutes'`)
    if (actius) sql(`update enlaces_token set estado = 'activo' where id in (${actius.split(',').map((x) => `'${x}'`).join(',')})`)
    // El trigger no deja volver de «entregado» a «emitido»: solo en el clon, sin triggers.
    sql(`begin; set local session_replication_role = replica;
      update albaranes set estado = 'emitido', entregado_at = ${entregatAbans ? `'${entregatAbans}'` : 'null'} where id = '${id}';
      commit;`)
  }
})
