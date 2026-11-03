// Plan 1, rebanada 1F (02-11-2026): el CRM mínimo, notas internas (D4).
// Solo contra el CLON LOCAL. Crea su propia entidad de prueba y la borra al acabar con
// `borrar_ficha_completa()` (las notas se van con la organización: `on delete cascade`).
//
// Lo que se afirma, en orden (modo serie):
//   1. El técnico añade dos notas desde «Gestió interna» —una de hace tres días por WhatsApp y
//      otra de hoy por teléfono— y el hilo las pinta con lo más reciente arriba, con su nombre.
//      No ve el botón de borrar (es del super_admin).
//   2. El listado «Entitats» enseña el «Darrer contacte» de la nota más reciente.
//   3. La cuenta de una entidad NO ve las notas: ni el bloque en «La meva organització», ni por
//      API (`select` vacío, sin error), ni el último contacto en `v_entitats_llistat`.
//   4. El super_admin borra una nota y el hilo se queda con la otra.

import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { compte, entidadDe, entra, motiuSaltClon, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:55321'
const LLETRES = 'TRWAGMYFPDXBNJZSQVHLCKE'
const dni = (n: number) => { const s = String(Math.floor(n) % 1e8).padStart(8, '0'); return s + LLETRES[Number(s) % 23] }
const RE_CAP_HOLA = /^(avui|hoy) · (Telèfon|Teléfono) · /
const RE_CAP_WA = /^(fa 3 dies|hace 3 días) · WhatsApp · /

let marca = ''
let nom = ''
let org = ''
let entitat = ''
let orgReceptor = ''

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

/** `AAAA-MM-DD` de hace `n` días, en la hora local (la del navegador de la prueba). */
function faDies(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin', 'equip', 'receptor')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin', 'equip', 'receptor') !== null) return
  const ara = Date.now()
  marca = `${info.project.name}-${ara}`
  nom = `E2E 1F ${marca}`
  const fila = sql(`insert into entidades (nombre, razon_social, nif, tipo_receptor, es_test)
    values ('${nom}', '${nom} SL', '${dni(ara / 13)}', 'social', true)
    returning id || '|' || organizacion_id`).split('\n')[0]
  ;[entitat, org] = fila.split('|')
  // Una nota en la organización de una cuenta receptora: lo que esa cuenta NO debe ver.
  orgReceptor = sql(`select organizacion_id from entidades where id = '${entidadDe('receptor')}'`)
  sqlCom('equip', `select afegir_nota_interna('${orgReceptor}', 'visita', 'E2E 1F ${marca} privada')`)
})

test.afterAll(() => {
  if (!marca) return
  if (entitat) sqlCom('super_admin', `select borrar_ficha_completa('entidad', '${entitat}', true)`)
  sql(`delete from notes_internes where text like 'E2E 1F ${marca}%'`)
})

test('el tècnic afegeix dues notes i el fil les ordena', async ({ page }) => {
  await entra(page, 'equip')
  await page.goto(`/equip/entitats/${org}?pestanya=intern`)
  const bloc = page.getByTestId('notes-internes')
  await expect(bloc).toBeVisible({ timeout: 20_000 })
  await expect(bloc).toContainText(/Encara no hi ha cap nota|Todavía no hay ninguna nota/)

  // 1) Hace tres días, por WhatsApp.
  await bloc.locator('#nota-canal').click()
  await page.getByRole('option', { name: 'WhatsApp' }).click()
  await bloc.locator('#nota-data').fill(faDies(3))
  await bloc.locator('#nota-text').fill(`E2E 1F ${marca} primera`)
  await bloc.getByRole('button', { name: /Afegeix la nota|Añade la nota/ }).click()
  await expect(bloc.getByTestId('nota')).toHaveCount(1)

  // 2) Hoy, por teléfono (canal por defecto; la fecha vuelve a hoy tras guardar).
  await bloc.locator('#nota-canal').click()
  await page.getByRole('option', { name: /^Telèfon$|^Teléfono$/ }).click()
  await expect(bloc.locator('#nota-data')).toHaveValue(faDies(0))
  await bloc.locator('#nota-text').fill(`E2E 1F ${marca} segona`)
  await bloc.getByRole('button', { name: /Afegeix la nota|Añade la nota/ }).click()

  const notes = bloc.getByTestId('nota')
  await expect(notes).toHaveCount(2)
  await expect(notes.nth(0)).toContainText('segona')
  await expect(notes.nth(0).getByTestId('nota-cap')).toHaveText(new RegExp(RE_CAP_HOLA.source + 'Tècnic Redestina$'))
  await expect(notes.nth(1)).toContainText('primera')
  await expect(notes.nth(1).getByTestId('nota-cap')).toHaveText(RE_CAP_WA)
  // Sin edición, y borrar es del super_admin.
  await expect(bloc.getByRole('button', { name: /Esborra la nota|Borra la nota/ })).toHaveCount(0)
  expect(sql(`select count(*) from notes_internes where organizacion_id = '${org}' and autor is not null`)).toBe('2')
})

test('el llistat «Entitats» ensenya el darrer contacte', async ({ page }) => {
  await entra(page, 'equip')
  await page.goto('/equip/entitats')
  await page.getByRole('searchbox').fill(nom)
  const fila = page.getByTestId('entitat-fila').filter({ hasText: nom })
  await expect(fila).toHaveCount(1, { timeout: 20_000 })
  await expect(fila.getByTestId('darrer-contacte')).toHaveText(/^(avui|hoy) · (Telèfon|Teléfono)$/)
})

test('la compte de l’entitat no veu les notes ni per pantalla ni per API', async ({ page }) => {
  // API: 0 filas, sin error; y el último contacto de su organización, null.
  const token = await jwt('receptor')
  const h = { apikey: publishable(), Authorization: `Bearer ${token}` }
  const r = await fetch(`${API}/rest/v1/notes_internes?select=id,text`, { headers: h })
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual([])
  const v = await fetch(`${API}/rest/v1/v_entitats_llistat?select=id,darrer_contacte_at,darrer_contacte_canal&id=eq.${orgReceptor}`, { headers: h })
  expect(v.status).toBe(200)
  const files = (await v.json()) as { darrer_contacte_at: string | null; darrer_contacte_canal: string | null }[]
  for (const f of files) expect([f.darrer_contacte_at, f.darrer_contacte_canal]).toEqual([null, null])
  // Y no puede escribir ni por la RPC.
  const w = await fetch(`${API}/rest/v1/rpc/afegir_nota_interna`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_org: orgReceptor, p_canal: 'telefon', p_text: 'intrus' }),
  })
  expect(w.status).toBe(403)

  // Pantalla: «La meva organització» no tiene el bloque.
  await entra(page, 'receptor')
  await page.goto('/organitzacio')
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('notes-internes')).toHaveCount(0)
  await expect(page.getByText(/Notes internes|Notas internas|privada/)).toHaveCount(0)
})

test('el super_admin esborra una nota', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=intern`)
  const bloc = page.getByTestId('notes-internes')
  await expect(bloc.getByTestId('nota')).toHaveCount(2, { timeout: 20_000 })
  await bloc.getByTestId('nota').nth(0).getByRole('button', { name: /Esborra la nota|Borra la nota/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Esborra la nota|Borra la nota/ }).click()
  await expect(bloc.getByTestId('nota')).toHaveCount(1)
  await expect(bloc.getByTestId('nota').first()).toContainText('primera')
})
