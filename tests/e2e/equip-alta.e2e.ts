// Configuració › Equip: «Afegeix una persona» (deuda 169). Solo contra el CLON: el correo de
// `alta-equip` se copia al Mailpit del stack (`MAILPIT_URL`, solo en el clon), de donde esta prueba
// saca el enlace. Crea UNA cuenta del equipo con un correo único y la borra al acabar.
//
// Lo que se afirma, en orden (modo serie):
//   1. El formulario no deja enviar con el nombre vacío o el correo mal escrito (validación local).
//   2. El super_admin da de alta a un Dinamitzador: sale en «Actius» con su rol y en la auditoría
//      con el apunte 'alta'; en la base, `usuario_roles` y `equip_rols_hist` lo dicen.
//   3. El correo llega a Mailpit, su enlace lleva a `/restablir`, la persona pone su contraseña y
//      entra en el panel del equipo.
//   4. Repetir el mismo correo → «ja és de l’equip» (`compte_equip`), bajo el campo del correo.
//   5. El correo de un productor de prueba → `compte_existent`, bajo el campo; no se crea nada.
//   6. La cuenta `equip` (Dinamitzador) no ve el botón (ni la sección).
//
//   E2E_CLON=1 E2E_ESCRIU=1 npx playwright test tests/e2e/equip-alta.e2e.ts --project escriptori

import { expect, test, type Page } from '@playwright/test'
import { compte, entra, motiuSaltClon, sql, tria } from './ajuda'

test.describe.configure({ mode: 'serial' })

const MAILPIT = 'http://127.0.0.1:55324'
const URL_EQUIP = '/equip/configuracio?tab=equip'
const NOM = 'Alta E2E'
const CONTRASENYA = `E2e-alta-${Math.random().toString(36).slice(2, 10)}`

let email = ''
let inici = ''

const fila = (page: Page) => page.locator(`[data-testid="eq-fila"][data-email="${email}"]`)

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin', 'equip', 'productor')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin', 'equip', 'productor') !== null) return
  email = `e2e-alta-${info.project.name}-${Date.now()}@example.com`.toLowerCase()
  inici = sql(`select now()::text`)
})

test.afterAll(async () => {
  if (!email) return
  // Sin `replica`: el borrado arrastra el perfil y el rol, como en la aplicación.
  sql(`delete from auth.users where email = '${email}'`)
  sql(`delete from equip_rols_hist where email = '${email}'`)
  sql(`delete from equip_persones_arxiu where email = '${email}'`)
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`, { method: 'DELETE' }).catch(() => null)
})

/** El último enlace que ha llegado a `correu` en el Mailpit del clon. */
async function enllacDeMailpit(correu: string): Promise<string> {
  let id = ''
  await expect.poll(async () => {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correu}"`)}`)
    const d = (await r.json()) as { messages?: { ID: string }[] }
    id = d.messages?.[0]?.ID ?? ''
    return id
  }, { timeout: 15_000 }).not.toBe('')
  const m = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string }
  const enllac = /https?:\/\/\S+/.exec(m.Text)?.[0]
  expect(enllac, 'el correu porta l’enllaç').toBeTruthy()
  return enllac as string
}

/**
 * Sigue el enlace de recuperación hasta el frontend del clon (como `acces.e2e.ts`): GoTrue redirige
 * a `site_url`; se toma el fragmento con los tokens y se abre en la URL base de la prueba.
 */
async function obreEnllac(page: Page, enllac: string) {
  const r = await fetch(enllac, { redirect: 'manual' })
  const desti = r.headers.get('location') ?? ''
  const hash = desti.slice(desti.indexOf('#'))
  expect(hash).toContain('type=recovery')
  await page.goto(`/${hash}`)
}

/** Abre el diálogo de alta y rellena nombre y correo (el resto, por defecto). */
async function obreIOmple(page: Page, nom: string, correu: string) {
  await page.getByTestId('eq-alta').click()
  const d = page.getByTestId('eq-alta-dialeg')
  await expect(d).toBeVisible()
  await d.getByTestId('eq-alta-nom').fill(nom)
  await d.getByTestId('eq-alta-email').fill(correu)
  return d
}

test('el formulario no deja enviar sin nombre ni con un correo mal escrito', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  const d = await obreIOmple(page, '', 'no-es-un-correu')
  await d.getByTestId('eq-alta-envia').click()
  await expect(d.getByTestId('eq-alta-nom')).toHaveAttribute('aria-invalid', 'true')
  await expect(d.getByTestId('eq-alta-email')).toHaveAttribute('aria-invalid', 'true')
  await d.getByTestId('eq-alta-telefon').fill('123')
  await expect(d.getByTestId('eq-alta-telefon')).toHaveAttribute('aria-invalid', 'true')
  // Nada ha llegado al servidor.
  expect(sql(`select count(*) from auth.users where email = 'no-es-un-correu'`)).toBe('0')
  await d.getByRole('button', { name: /^Cancel·lar$|^Cancelar$/ }).click()
  await expect(d).toHaveCount(0)
})

test('el super_admin da de alta a un Dinamitzador: sale en Actius y en la auditoría', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  const d = await obreIOmple(page, NOM, email)
  await d.getByTestId('eq-alta-telefon').fill('+34 611 22 33 99')
  await tria(d.getByTestId('eq-alta-rol'), 'admin')
  await tria(d.getByTestId('eq-alta-idioma'), 'ca')
  await d.getByTestId('eq-alta-envia').click()
  await expect(d).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByText(/Li hem enviat un correu|Le hemos enviado un correo/).first()).toBeVisible()

  await expect(page.getByTestId('eq-tab-actius')).toHaveAttribute('data-state', 'active')
  await expect(fila(page)).toHaveAttribute('data-rol', 'admin')
  await expect(fila(page)).toHaveAttribute('data-actiu', 'si')
  await expect(fila(page)).toContainText(NOM)

  const hist = page.getByTestId('eq-hist')
  await expect(hist.locator('[data-accio="alta"]').filter({ hasText: email }).first()).toBeVisible()
  await expect(hist.locator('[data-accio="alta"]').filter({ hasText: email }).first()).toContainText(/Dinamitzador|Dinamizador/)

  // La base: el rol, quién lo dio, el apunte 'alta', y el perfil con nombre, teléfono e idioma.
  const uid = sql(`select id from auth.users where email = '${email}'`)
  expect(sql(`select string_agg(rol, ',') from usuario_roles where user_id = '${uid}'`)).toBe('admin')
  expect(sql(`select count(*) || '|' || max(per_email) from equip_rols_hist
               where email = '${email}' and accio = 'alta' and rol_despres = 'admin' and at >= '${inici}'`))
    .toBe(`1|${compte('super_admin')!.email}`)
  expect(sql(`select nombre || '|' || coalesce(telefono, '') || '|' || coalesce(idioma, '') from perfiles where id = '${uid}'`))
    .toBe(`${NOM}|34611223399|ca`)
  expect(sql(`select count(*) from membresias where user_id = '${uid}'`)).toBe('0')
})

test('el correo llega, su enlace lleva a crear la contraseña y la persona entra en el panel del equipo', async ({ browser }) => {
  const enllac = await enllacDeMailpit(email)
  const ctx = await browser.newContext()
  const persona = await ctx.newPage()
  await obreEnllac(persona, enllac)
  await persona.waitForURL((u) => u.pathname === '/restablir', { timeout: 30_000 })
  await persona.locator('input[type="password"]').first().fill(CONTRASENYA)
  await persona.locator('button[type="submit"]').first().click()
  await persona.waitForURL((u) => !/\/(restablir|login|admin)$/.test(u.pathname), { timeout: 30_000 })
  await persona.goto('/equip/tauler')
  await persona.waitForLoadState('networkidle')
  expect(new URL(persona.url()).pathname).toMatch(/^\/equip\//)
  await ctx.close()
})

test('el mismo correo otra vez: «ya es del equipo», bajo el correo', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  const d = await obreIOmple(page, NOM, email)
  await d.getByTestId('eq-alta-envia').click()
  await expect(d.getByTestId('eq-alta-email')).toHaveAttribute('aria-invalid', 'true')
  await expect(d.locator('#eq-alta-email-err')).toContainText(/ja és de l’equip|ya es del equipo/)
  expect(sql(`select count(*) from equip_rols_hist where email = '${email}' and accio = 'alta'`)).toBe('1')
})

test('el correo de un productor de prueba: compte_existent, y no se crea nada', async ({ page }) => {
  const prod = compte('productor')!.email.toLowerCase()
  const rolsAbans = sql(`select count(*) from usuario_roles r join auth.users u on u.id = r.user_id where u.email = '${prod}'`)
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  const d = await obreIOmple(page, 'Productor E2E', prod)
  await d.getByTestId('eq-alta-envia').click()
  await expect(d.getByTestId('eq-alta-email')).toHaveAttribute('aria-invalid', 'true')
  await expect(d.locator('#eq-alta-email-err')).toContainText(/organització|organización/)
  expect(sql(`select count(*) from usuario_roles r join auth.users u on u.id = r.user_id where u.email = '${prod}'`)).toBe(rolsAbans)
  expect(rolsAbans).toBe('0')
})

test('la cuenta Dinamitzador no ve el botón', async ({ page }) => {
  await entra(page, 'equip')
  await page.goto(URL_EQUIP)
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('eq-alta')).toHaveCount(0)
  await expect(page.getByTestId('seccio-equip')).toHaveCount(0)
})
