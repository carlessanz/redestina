// Configuració › Equip (09-11-2026, `20270513100000`): ver las cuentas del equipo y cambiar su
// rol. Solo contra el CLON (cambia `usuario_roles` y lo deja como estaba).
//
// Lo que se afirma:
//   1. El super_admin ve la pestaña «Equip» con las cuentas del equipo; a sí mismo no se le
//      ofrece cambiar nada.
//   2. Subir a un Dinamitzador (`admin`) a Superadmin pide confirmación, cambia el rol y queda en
//      el historial; bajarlo otra vez pide confirmación roja, igual. (Hasta el 25-11-2026 se bajaba
//      a `tecnic`, que ya no existe: proceso 0.1.)
//   3. Quien no es super_admin no ve la pestaña, y con `?tab=equip` cae en «General».
//   4. El menú lateral dice el rol de verdad (Superadmin / Dinamitzador): antes ponía «Admin» a todos.

import { expect, test, type Page } from '@playwright/test'
import { compte, entra, motiuSaltClon, sql, tria } from './ajuda'

test.describe.configure({ mode: 'serial' })

// Una cuenta de equipo del clon que nadie usa para entrar: no interfiere con otros E2E.
const OBJECTIU = 'comunicacio@esimperfect.com'
const URL_EQUIP = '/equip/configuracio?tab=equip'

let inici = ''
let creatAbans = ''

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin', 'equip')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(() => {
  if (motiuSaltClon('super_admin', 'equip') !== null) return
  inici = sql(`select now()::text`)
  creatAbans = sql(`select r.created_at::text from usuario_roles r join auth.users u on u.id = r.user_id where u.email = '${OBJECTIU}' and r.rol = 'admin'`)
})

test.afterAll(() => {
  if (motiuSaltClon('super_admin', 'equip') !== null || !creatAbans) return
  // El clon, como estaba: el rol de antes, sin los apuntes del historial de esta prueba.
  sql(`delete from usuario_roles where user_id = (select id from auth.users where email = '${OBJECTIU}')`)
  sql(`insert into usuario_roles (user_id, rol, created_at) select id, 'admin', '${creatAbans}' from auth.users where email = '${OBJECTIU}'`)
  sql(`delete from equip_rols_hist where email = '${OBJECTIU}' and at >= '${inici}'`)
})

test('el super_admin ve el equipo y a sí mismo no se le deja cambiar', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/configuracio')
  await page.getByTestId('tab-equip').click()
  await expect(page.getByTestId('seccio-equip')).toBeVisible()
  await expect(page.getByTestId('eq-llista')).toBeVisible()

  const jo = page.locator(`[data-testid="eq-fila"][data-email="${compte('super_admin')!.email}"]`)
  await expect(jo).toBeVisible()
  await expect(jo.getByTestId('eq-rol')).toHaveText(/^Superadmin$/)
  await expect(jo).toContainText(/Tu|Tú/)
  await expect(jo.getByTestId('eq-rol-tria')).toHaveCount(0)

  // Los externos no salen: solo cuentas con fila en `usuario_roles`.
  const filas = await page.getByTestId('eq-fila').count()
  expect(String(filas)).toBe(sql(`select count(distinct user_id) from usuario_roles`))
})

test('sube a un Dinamitzador a Superadmin y lo baja otra vez, con confirmación y con historial', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  const fila = page.locator(`[data-testid="eq-fila"][data-email="${OBJECTIU}"]`)
  await expect(fila).toHaveAttribute('data-rol', 'admin')
  await expect(fila.getByTestId('eq-rol')).toHaveText(/^(Dinamitzador|Dinamizador)$/)

  // El desplegable solo ofrece los dos roles y «treure de l’equip»: el `tecnic` ya no existe.
  await expect(fila.getByTestId('eq-rol-tria')).not.toContainText(/Tècnic|Técnico/)

  // Subir.
  await tria(fila.getByTestId('eq-rol-tria'), 'super_admin')
  const dialeg = page.getByRole('dialog')
  await expect(dialeg).toContainText(/Pujar|Subir/)
  await dialeg.getByRole('button', { name: /^Canvia el rol$|^Cambiar el rol$/ }).click()
  await expect(fila).toHaveAttribute('data-rol', 'super_admin')
  expect(sql(`select string_agg(rol, ',') from usuario_roles where user_id = (select id from auth.users where email = '${OBJECTIU}')`)).toBe('super_admin')

  // Bajar.
  await tria(fila.getByTestId('eq-rol-tria'), 'admin')
  await expect(page.getByRole('dialog')).toContainText(/Baixar|Bajar/)
  await page.getByRole('dialog').getByRole('button', { name: /^Canvia el rol$|^Cambiar el rol$/ }).click()
  await expect(fila).toHaveAttribute('data-rol', 'admin')
  expect(sql(`select string_agg(rol, ',') from usuario_roles where user_id = (select id from auth.users where email = '${OBJECTIU}')`)).toBe('admin')

  // El historial: los dos cambios, con quién los hizo.
  await expect(page.getByTestId('eq-hist')).toContainText(OBJECTIU)
  expect(sql(`select count(*) from equip_rols_hist where email = '${OBJECTIU}' and at >= '${inici}'`)).toBe('2')
  expect(sql(`select per_email from equip_rols_hist where email = '${OBJECTIU}' and at >= '${inici}' limit 1`))
    .toBe(compte('super_admin')!.email)
})

test('cancelar la confirmación no cambia nada', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  const fila = page.locator(`[data-testid="eq-fila"][data-email="${OBJECTIU}"]`)
  await tria(fila.getByTestId('eq-rol-tria'), 'super_admin')
  await page.getByRole('dialog').getByRole('button', { name: /^Cancel·lar$|^Cancelar$/ }).click()
  await expect(fila).toHaveAttribute('data-rol', 'admin')
  expect(sql(`select count(*) from equip_rols_hist where email = '${OBJECTIU}' and at >= '${inici}'`)).toBe('2')
})

test('quien no es super_admin no ve «Equip» y ?tab=equip cae en «General»', async ({ page }) => {
  await entra(page, 'equip')
  await page.goto(URL_EQUIP)
  await expect(page.getByTestId('tab-equip')).toHaveCount(0)
  await expect(page.getByTestId('seccio-equip')).toHaveCount(0)
})

async function obreMenu(page: Page, projecte: string) {
  // En móvil el menú es un panel que se abre con el botón; el rótulo existe igual.
  if (projecte === 'mobil') await page.getByRole('button', { name: /sidebar|menú|menu/i }).first().click()
}

test('el menú lateral dice «Superadmin» al super_admin', async ({ page }, info) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/tauler')
  await obreMenu(page, info.project.name)
  const rotul = page.getByTestId('rol-equip')
  await expect(rotul).toHaveAttribute('data-rol', 'super_admin')
  await expect(rotul).toHaveText(/^Superadmin$/)
})

test('el menú lateral dice el rol real de la cuenta del equipo, no un «Admin» para todos', async ({ page }, info) => {
  const rol = sql(`select r.rol from usuario_roles r join auth.users u on u.id = r.user_id where u.email = '${compte('equip')!.email}' order by r.rol limit 1`)
  await entra(page, 'equip')
  await page.goto('/equip/tauler')
  await obreMenu(page, info.project.name)
  await expect(page.getByTestId('rol-equip')).toHaveAttribute('data-rol', rol)
  // La cuenta `equip` del arnés es un Dinamitzador desde el 25-11-2026 (proceso 0.1).
  expect(rol).toBe('admin')
  await expect(page.getByTestId('rol-equip')).toHaveText(/^(Dinamitzador|Dinamizador)$/)
})
