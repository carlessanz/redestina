// A2: el PDF del diagnóstico BAJO DEMANDA (`diagnostic-pdf`, D2). El productor y el equipo lo
// descargan desde el resumen; es un `application/pdf` de verdad, no deja fila en `documentos`
// ni fichero en el bucket, y un productor ajeno recibe 403.
// Solo contra el CLON LOCAL (necesita las Edge Functions del clon: scripts/local/funciones-local.sh).
// Solo LEE: corre también en móvil.

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { compte, entra, motiuSaltClon, productorDe, sql } from './ajuda'

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
