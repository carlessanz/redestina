// A2: el PDF del diagnóstico BAJO DEMANDA (`diagnostic-pdf`, D2). El productor y el equipo lo
// descargan desde el resumen; es un `application/pdf` de verdad, no deja fila en `documentos`
// ni fichero en el bucket, y un productor ajeno recibe 403.
// Solo contra el CLON LOCAL (necesita las Edge Functions del clon: scripts/local/funciones-local.sh).
// Solo LEE: corre también en móvil (salvo la prueba de los excedentes, que toca el fixture y va
// solo en escritorio).
//
// A3 (`20270522100000`): con excedentes por producto × causa, el PDF lleva la sección
// «Excedents». El texto va con la fuente incrustada (glifos, no letras), así que no se busca la
// causa en los bytes: se compara el tamaño con el mismo PDF sin ningún bloque.

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { compte, entra, motiuSaltClon, productorDe, sql } from './ajuda'
import { fotoOperativa, restauraFixtureDiagnostic } from './fixtureDiagnostic'

const API = 'http://127.0.0.1:55321'

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

async function pdf(token: string, org: string): Promise<Response> {
  return fetch(`${API}/functions/v1/diagnostic-pdf`, {
    method: 'POST',
    headers: { apikey: publishable(), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo_org: 'productor', org, idioma: 'ca' }),
  })
}

/** Pulsa «Descarrega el PDF» y devuelve la respuesta de la función y la descarga. */
async function descarrega(page: Page) {
  const boto = page.getByTestId('diagnostic-pdf')
  await expect(boto).toBeVisible()
  await expect(boto).toHaveText(/Descarrega el PDF|Descarga el PDF/)
  const [resposta, baixada] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/functions/v1/diagnostic-pdf') && r.request().method() === 'POST'),
    page.waitForEvent('download'),
    boto.click(),
  ])
  return { resposta, baixada }
}

test.beforeEach(() => {
  const m = motiuSaltClon('superadmin', 'productor-titular', 'productor-altre')
  test.skip(m !== null, m ?? '')
})

test('el productor descarga su diagnóstico en PDF, sin documento emitido', async ({ page }) => {
  const docs0 = sql('select count(*) from documentos')
  const fitxers0 = sql(`select count(*) from storage.objects where bucket_id = 'documentos'`)

  await entra(page, 'productor-titular')
  await page.goto('/organitzacio/diagnostic')
  await expect(page.getByTestId('resum-diagnostic').or(page.getByTestId('resum-diagnostic-buit'))).toBeVisible()
  const { resposta, baixada } = await descarrega(page)
  expect(resposta.status()).toBe(200)
  expect(resposta.headers()['content-type']).toBe('application/pdf')
  expect(baixada.suggestedFilename()).toMatch(/^diagnostic-[a-z0-9-]+\.pdf$/)
  const bytes = readFileSync((await baixada.path())!)
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(bytes.length).toBeGreaterThan(10_000)
  await expect(page.getByRole('alert')).toHaveCount(0)

  // D2: ni fila en `documentos` ni fichero en el bucket.
  expect(sql('select count(*) from documentos')).toBe(docs0)
  expect(sql(`select count(*) from storage.objects where bucket_id = 'documentos'`)).toBe(fitxers0)
})

test('el equipo lo descarga desde la ficha › Diagnòstic i perfil', async ({ page }) => {
  const prod = productorDe('productor-titular')
  const org = sql(`select organizacion_id from productores where id = '${prod}'`)
  await entra(page, 'superadmin')
  await page.goto(`/equip/entitats/${org}?pestanya=diagnostic`)
  const { resposta, baixada } = await descarrega(page)
  expect(resposta.status()).toBe(200)
  expect(resposta.headers()['content-type']).toBe('application/pdf')
  expect(baixada.suggestedFilename()).toMatch(/^diagnostic-[a-z0-9-]+\.pdf$/)
})

test('un productor ajeno recibe 403, y sin sesión 401', async () => {
  const altre = productorDe('productor-altre')
  expect(altre).not.toBe(productorDe('productor-titular'))
  const r = await pdf(await jwt('productor-titular'), altre)
  expect(r.status).toBe(403)
  expect(((await r.json()) as { code: string }).code).toBe('forbidden')
  // Un uuid inventado responde igual que lo ajeno: el permiso no filtra la existencia.
  const inventat = await pdf(await jwt('productor-titular'), '00000000-0000-0000-0000-000000000000')
  expect(inventat.status).toBe(403)
  const sense = await fetch(`${API}/functions/v1/diagnostic-pdf`, {
    method: 'POST',
    headers: { apikey: publishable(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo_org: 'productor', org: altre }),
  })
  expect(sense.status).toBe(401)
})

test('con excedentes, el PDF lleva la sección «Excedents» (pesa más que sin ningún bloque)', async ({}, info) => {
  test.skip(info.project.name !== 'escriptori', 'Toca el fixture del diagnòstic: només a escriptori')
  const prod = productorDe('productor-titular')
  const foto = fotoOperativa(prod)
  // Las respuestas del v3 (legado) se apartan un momento: sin bloques, el PDF caería a ellas.
  const sobre = sql(`select sobre::text from diagnostics where productor_id = '${prod}'`)
  try {
    // El fixture del arnés: Tomàquet × EX con su acción.
    restauraFixtureDiagnostic(prod, foto)
    sql(`update diagnostics set sobre = jsonb_set(sobre, '{respostes}', '[]'::jsonb) where productor_id = '${prod}'`)
    const token = await jwt('productor-titular')
    const amb = await pdf(token, prod)
    expect(amb.status).toBe(200)
    expect(amb.headers.get('content-type')).toBe('application/pdf')
    const bytesAmb = new Uint8Array(await amb.arrayBuffer())
    expect(Buffer.from(bytesAmb.subarray(0, 5)).toString('latin1')).toBe('%PDF-')

    sql(`delete from diagnostic_productes where productor_id = '${prod}'`)
    const sense = await pdf(token, prod)
    expect(sense.status).toBe(200)
    const bytesSense = new Uint8Array(await sense.arrayBuffer())
    // La sección «Excedents» (tabla de causas y de acciones) es lo único que cambia.
    expect(bytesAmb.length).toBeGreaterThan(bytesSense.length + 500)
  } finally {
    if (sobre) sql(`update diagnostics set sobre = '${sobre.replace(/'/g, "''")}'::jsonb where productor_id = '${prod}'`)
    restauraFixtureDiagnostic(prod, foto)
  }
})
