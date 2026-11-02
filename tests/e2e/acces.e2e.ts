// Plan 1, rebanada 1D (02-11-2026): «Dona-li accés».
// Solo contra el CLON LOCAL, con el buzón de pruebas: el correo de `donar-acces` se simula y
// se copia al Mailpit del stack (`_shared/bustiaLocal.ts`, `MAILPIT_URL` solo en el clon), de
// donde esta prueba saca el enlace. Crea sus propias organizaciones de prueba y las borra al
// acabar con `borrar_ficha_completa()`, y la cuenta creada con ella.
//
// Lo que se afirma, en orden (modo serie):
//   1. La función rechaza sin sesión (401), a un externo y al técnico (403).
//   2. Con el correo apagado (§8) responde 409 `correu_desactivat` y NO crea la cuenta.
//   3. Con el modo test, una entidad que no es de prueba → 403 `no_test_user`, sin cuenta.
//   4. Camino feliz: «Nova entitat» con «Dona-li accés» → «Accés enviat» en la ficha → el
//      correo en Mailpit → `/restablir` → la persona pone su contraseña y ve «La meva
//      organització» con los bloques de su papel.
//   5. El equipo ve «Accés actiu», lo desactiva y la persona se queda sin panel; «Dona-li
//      accés» se lo devuelve con la misma cuenta.

import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { compte, entra, motiuSaltClon, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const API = 'http://127.0.0.1:55321'
const MAILPIT = 'http://127.0.0.1:55324'
const LLETRES = 'TRWAGMYFPDXBNJZSQVHLCKE'
const dni = (n: number) => { const s = String(Math.floor(n) % 1e8).padStart(8, '0'); return s + LLETRES[Number(s) % 23] }

let marca = ''
let nom = ''
let nif = ''
let email = ''
let orgFelic = ''
let orgReal = ''
let emailReal = ''
const CONTRASENYA = `E2e-1d-${Math.random().toString(36).slice(2, 10)}`

/** La clave publicable del clon, del entorno del frontend local. */
function publishable(): string {
  const env = readFileSync('.env.supabase-local.local', 'utf8')
  return /VITE_SUPABASE_PUBLISHABLE_KEY=(\S+)/.exec(env)?.[1] ?? ''
}

/** Un JWT de la cuenta, por la API de GoTrue del clon. */
async function jwt(rol: string): Promise<string> {
  const c = compte(rol)!
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishable(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.password }),
  })
  return ((await r.json()) as { access_token: string }).access_token
}

async function donarAcces(token: string | null, org: string): Promise<{ status: number; code?: string }> {
  const r = await fetch(`${API}/functions/v1/donar-acces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ organizacion_id: org }),
  })
  const d = (await r.json().catch(() => ({}))) as { code?: string }
  return { status: r.status, code: d.code }
}

const comptes = (correu: string) => sql(`select count(*) from auth.users where email = '${correu}'`)

/** El último enlace que ha llegado a `correu` en el Mailpit del clon. */
async function enllacDeMailpit(correu: string): Promise<string> {
  let id = ''
  await expect.poll(async () => {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correu}"`)}`)
    const d = (await r.json()) as { messages?: { ID: string }[] }
    id = d.messages?.[0]?.ID ?? ''
    return id
  }, { timeout: 15_000 }).not.toBe('')
  const m = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Subject: string; Text: string }
  expect(m.Subject).toMatch(/Benvingut\/da a REDESTINA|Bienvenido\/a a REDESTINA/)
  const enllac = /https?:\/\/\S+/.exec(m.Text)?.[0]
  expect(enllac, 'el correu porta l’enllaç').toBeTruthy()
  return enllac as string
}

/**
 * Sigue el enlace de recuperación hasta el frontend del clon. GoTrue redirige a `site_url`
 * (`localhost:5173`); los E2E del clon corren en otro puerto, así que se toma el fragmento con
 * los tokens de la redirección y se abre en la URL base de la prueba.
 */
async function obreEnllac(page: Page, enllac: string) {
  const r = await fetch(enllac, { redirect: 'manual' })
  const desti = r.headers.get('location') ?? ''
  const hash = desti.slice(desti.indexOf('#'))
  expect(hash).toContain('type=recovery')
  await page.goto(`/${hash}`)
}

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin', 'equip', 'productor')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin', 'equip', 'productor') !== null) return
  const ara = Date.now()
  marca = `${info.project.name}-${ara}`
  nom = `E2E 1D ${marca}`
  nif = dni(ara / 11)
  email = `e2e-1d-${marca}@example.com`.toLowerCase()
  emailReal = `e2e-1d-real-${marca}@example.com`.toLowerCase()
  // Una entidad ACTIVA que NO es de prueba, con correo: con el modo test no recibe acceso.
  orgReal = sql(`insert into entidades (nombre, razon_social, nif, tipo_receptor, email, es_test)
    values ('${nom} real', '${nom} real SL', '${dni(ara / 11 + 1)}', 'social', '${emailReal}', false)
    returning organizacion_id`).split('\n')[0]
})

test.afterAll(async () => {
  if (!marca) return
  for (const org of [orgFelic, orgReal]) {
    if (!org) continue
    const p = sql(`select coalesce((select id::text from productores where organizacion_id = '${org}'), '')`)
    const e = sql(`select coalesce((select id::text from entidades where organizacion_id = '${org}'), '')`)
    if (p) sqlCom('super_admin', `select borrar_ficha_completa('productor', '${p}', true)`)
    else if (e) sqlCom('super_admin', `select borrar_ficha_completa('entidad', '${e}', true)`)
    sql(`delete from documento_envios where objeto_tipo = 'organizacion' and objeto_id = '${org}'`)
  }
  sql(`delete from auth.users where email in ('${email}', '${emailReal}')`)
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`, { method: 'DELETE' }).catch(() => null)
})

test('la función rechaza sin sesión, a un externo y al técnico', async () => {
  expect((await donarAcces(null, orgReal)).status).toBe(401)
  expect(await donarAcces(await jwt('productor'), orgReal)).toEqual({ status: 403, code: 'forbidden' })
  expect(await donarAcces(await jwt('equip'), orgReal)).toEqual({ status: 403, code: 'forbidden' })
  expect(comptes(emailReal)).toBe('0')
})

test('con el correo apagado: 409 correu_desactivat y no se crea nada', async () => {
  const abans = sql(`select coalesce((select value from app_settings where key = 'email_activo'), '')`)
  sql(`insert into app_settings (key, value) values ('email_activo', 'false')
       on conflict (key) do update set value = 'false'`)
  try {
    sql(`update entidades set es_test = true where organizacion_id = '${orgReal}'`)
    expect(await donarAcces(await jwt('super_admin'), orgReal)).toEqual({ status: 409, code: 'correu_desactivat' })
    expect(comptes(emailReal)).toBe('0')
  } finally {
    sql(`update entidades set es_test = false where organizacion_id = '${orgReal}'`)
    if (abans) sql(`update app_settings set value = '${abans}' where key = 'email_activo'`)
    else sql(`delete from app_settings where key = 'email_activo'`)
  }
})

test('con el modo test, una entidad que no es de prueba no recibe acceso', async () => {
  expect(sql(`select value from app_settings where key = 'test_mode'`)).not.toBe('false')
  expect(await donarAcces(await jwt('super_admin'), orgReal)).toEqual({ status: 403, code: 'no_test_user' })
  expect(comptes(emailReal)).toBe('0')
  expect(sql(`select count(*) from membresias m join entidades e on e.id = m.entidad_id
               where e.organizacion_id = '${orgReal}'`)).toBe('0')
})

test('«Nova entitat» con «Dona-li accés»: el correo llega, la persona pone su contraseña y entra', async ({ page, browser }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/entitats/nova')
  await page.locator('#ne-cerca').fill('zzz e2e 1d sense resultats')
  await page.getByTestId('ne-es-nova').click()
  await page.getByTestId('ne-rol-productor').click()
  await page.locator('#ne-nom_comercial').fill(nom)
  await page.locator('#ne-razon_social').fill(`${nom} SL`)
  await page.locator('#ne-nif').fill(nif)
  await page.locator('#ne-persona_contacte').fill('Persona E2E 1D')
  // Sin correo, la casilla está gris con el motivo.
  await expect(page.getByTestId('ne-acces')).toContainText(/Cal un correu de contacte|Hace falta un correo de contacto/)
  await page.locator('#ne-email').fill(email)
  await page.getByText(/^Entitat de proves$|^Entidad de pruebas$/).click()
  await page.getByTestId('ne-acces').getByText(/Dona-li accés a la plataforma ara|Darle acceso a la plataforma ahora/).click()
  await page.getByTestId('ne-crea').click()

  await page.waitForURL((u) => /^\/equip\/entitats\/[0-9a-f-]{36}$/.test(u.pathname))
  orgFelic = new URL(page.url()).pathname.split('/').pop() as string
  await expect(page.getByTestId('compte-estat')).toHaveAttribute('data-estat', 'enviat')
  await expect(page.getByTestId('acces-entitat')).toContainText(/···@example\.com/)
  expect(sql(`select count(*) || '|' || bool_and(m.activo and m.aprovacio = 'aprovada' and m.rol_org = 'titular')
                from membresias m join productores p on p.id = m.productor_id
               where p.organizacion_id = '${orgFelic}'`)).toBe('1|true')
  // Ningún consentimiento en nombre de nadie (P3).
  expect(sql(`select count(*) from consentiments c join auth.users u on u.id = c.user_id where u.email = '${email}'`)).toBe('0')

  // La persona, en un navegador limpio.
  const enllac = await enllacDeMailpit(email)
  const ctx = await browser.newContext()
  const persona = await ctx.newPage()
  await obreEnllac(persona, enllac)
  await persona.waitForURL((u) => u.pathname === '/restablir', { timeout: 30_000 })
  await persona.locator('input[type="password"]').first().fill(CONTRASENYA)
  await persona.locator('button[type="submit"]').first().click()
  await persona.waitForURL((u) => !/\/(restablir|login)$/.test(u.pathname), { timeout: 30_000 })
  await persona.goto('/organitzacio')
  await expect(persona.getByTestId('po-productor-identitat')).toBeVisible()
  await expect(persona.getByText(nom).first()).toBeVisible()
  await ctx.close()
})

test('el equipo ve «Accés actiu», lo desactiva y lo devuelve', async ({ page, browser }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${orgFelic}`)
  await expect(page.getByTestId('compte-estat')).toHaveAttribute('data-estat', 'actiu')

  await page.getByTestId('acces-entitat').getByRole('button', { name: /^Desactiva l’accés$|^Desactivar el acceso$/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Desactiva l’accés$|^Desactivar el acceso$/ }).click()
  await expect(page.getByTestId('compte-estat')).toHaveAttribute('data-estat', 'desactivat')
  expect(sql(`select activo from perfiles p join auth.users u on u.id = p.id where u.email = '${email}'`)).toBe('f')

  // La persona ya no tiene panel.
  const ctx = await browser.newContext()
  const persona = await ctx.newPage()
  await persona.goto('/login')
  await persona.locator('input[type="email"]').first().fill(email)
  await persona.locator('input[type="password"]').first().fill(CONTRASENYA)
  await persona.locator('button[type="submit"]').first().click()
  // La contraseña sigue valiendo, pero sin membresía activa ni perfil activo no hay panel.
  await persona.waitForURL((u) => u.pathname === '/sense-acces', { timeout: 30_000 })
  // Y por la URL directa, la ficha no se pinta (ya ha cargado: `networkidle`).
  await persona.goto('/organitzacio')
  await persona.waitForLoadState('networkidle')
  await expect(persona.getByTestId('po-productor-identitat')).toHaveCount(0)
  await ctx.close()

  // «Dona-li accés» la reactiva: misma cuenta, ningún usuario nuevo.
  await page.getByTestId('acces-entitat').getByRole('button', { name: /^Dona-li accés$|^Dar acceso$/ }).click()
  await expect(page.getByTestId('compte-estat')).toHaveAttribute('data-estat', 'actiu')
  expect(comptes(email)).toBe('1')
  expect(sql(`select activo from perfiles p join auth.users u on u.id = p.id where u.email = '${email}'`)).toBe('t')
})
