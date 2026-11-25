// Ficha de entidad del equipo: selector de productos y no perder lo escrito (Taula mestra 1.1,
// 25-11-2026). Solo contra el CLON LOCAL y solo en escritorio (edita una ficha de prueba).
//
// Lo que se afirma, en orden (modo serie):
//   a. En Operativa se añaden TRES productos habituales eligiéndolos de las sugerencias; el
//      segundo y el tercero, sin teclear (antes, tras elegir el primero, la lista no se reabría
//      con un clic y el catálogo salía cortado a 50).
//   b. Con un cambio sin guardar, salir con «Tornar» o con el menú abre «Tens canvis sense
//      desar»: «Continua editant» se queda con lo escrito; «Surt sense desar» sale sin guardar.
//   c. Lo escrito en una pestaña sigue ahí al ir a otra y volver.
// Todo lo que escribe se deja como estaba.

import { expect, test, type Page } from '@playwright/test'
import { entra, motiuSaltClon, pestanya, productorDe, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

let prod = ''
let org = ''
let original: { habituals: string; principals: string; tel2: string } | null = null

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'productor')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Edita una fitxa de prova compartida: només a escriptori')
  if (!prod) {
    prod = productorDe('productor')
    org = sql(`select organizacion_id from productores where id = '${prod}'`)
    original = {
      habituals: sql(`select coalesce(productos_habituales::text, 'null') from productores where id = '${prod}'`),
      principals: sql(`select coalesce(productes_principals::text, 'null') from productores where id = '${prod}'`),
      tel2: sql(`select coalesce(telefono_alt, '') from productores where id = '${prod}'`),
    }
  }
})

test.afterAll(() => {
  if (!original || !prod) return
  const arr = (v: string) => (v === 'null' ? 'null' : `'${v.replace(/'/g, "''")}'::text[]`)
  sql(`update productores set productos_habituales = ${arr(original.habituals)},
         productes_principals = ${arr(original.principals)},
         telefono_alt = ${original.tel2 ? `'${original.tel2}'` : 'null'} where id = '${prod}'`)
})

const desa = (page: Page) => page.getByTestId('desa-fitxa')

test('a · tres productos habituales elegidos de las sugerencias, el 2º y el 3º sin teclear', async ({ page }) => {
  sql(`update productores set productos_habituales = null, productes_principals = null where id = '${prod}'`)
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=operativa`)
  const camp = page.locator('#ed-productos_habituales')
  const llista = page.locator('[id="ed-productos_habituales-llista"]')
  await expect(camp).toBeVisible()
  await expect(desa(page)).toBeDisabled()

  const triats: string[] = []
  for (let i = 0; i < 3; i++) {
    // El primero, escribiendo un trozo; los otros dos, solo con un clic en el campo (que conserva
    // el foco tras elegir: es justo el caso que fallaba).
    await camp.click()
    if (i === 0) await camp.fill('to')
    await expect(llista).toBeVisible()
    if (i > 0) {
      // Sin teclear, el catálogo entero (más de los 50 de antes, menos lo ya elegido).
      const total = Number(sql(`select count(*) from productos`)) || 0
      if (total > 52) expect(await llista.getByRole('option').count()).toBeGreaterThan(50)
    }
    const op = llista.getByRole('option').first()
    const valor = await op.getAttribute('data-valor')
    expect(valor).toBeTruthy()
    await op.getByRole('button').click()
    await expect(llista).toBeHidden()
    triats.push(valor!)
    await expect(camp).toHaveValue('')
  }
  // Los tres, como chips (también salen en «Productes principals», de ahí el `first`), y un solo
  // cambio pendiente (es un campo).
  for (const p of triats) await expect(page.getByTestId('bloc-ofertant').getByRole('button', { name: p, exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('desa-fitxa-compte')).toHaveText('1')
  await expect(page.getByTestId('pendent-operativa')).toBeVisible()
  await desa(page).click()
  await expect(page.getByText(/Canvis desats|Cambios guardados/).first()).toBeVisible()
  await expect(desa(page)).toBeDisabled()
  const desat = sql(`select array_to_string(productos_habituales, '|') from productores where id = '${prod}'`).split('|')
  expect(desat.sort()).toEqual([...triats].sort())
})

test('b · salir con cambios sin guardar pregunta; «Continua editant» se queda y «Surt sense desar» no guarda', async ({ page }) => {
  sql(`update productores set telefono_alt = null where id = '${prod}'`)
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=contacte`)
  const tel = page.locator('#ed-telefon2')
  await tel.fill('34611000999')
  await expect(page.getByTestId('desa-fitxa-compte')).toHaveText('1')

  // «Tornar» (el botón de la cabecera) → diálogo → «Continua editant»: misma ficha, mismo valor.
  await page.getByRole('button', { name: /^Entitats$|^Entidades$/ }).click()
  const dialeg = page.getByTestId('dialeg-canvis-pendents')
  await expect(dialeg).toBeVisible()
  await expect(dialeg).toContainText(/Tens canvis sense desar|Tienes cambios sin guardar/)
  await dialeg.getByRole('button', { name: /^Continua editant$|^Sigue editando$/ }).click()
  await expect(dialeg).toBeHidden()
  expect(new URL(page.url()).pathname).toBe(`/equip/entitats/${org}`)
  await expect(tel).toHaveValue('34611000999')

  // El menú lateral → diálogo → «Surt sense desar»: sale y no se guarda nada.
  await page.locator('a[href="/equip/tauler"]').first().click()
  await expect(dialeg).toBeVisible()
  await dialeg.getByRole('button', { name: /^Surt sense desar$|^Sal sin guardar$/ }).click()
  await page.waitForURL((u) => u.pathname === '/equip/tauler')
  expect(sql(`select coalesce(telefono_alt, '-') from productores where id = '${prod}'`)).toBe('-')
})

test('c · lo escrito en una pestaña sigue ahí al cambiar de pestaña y volver', async ({ page }) => {
  sql(`update productores set telefono_alt = null where id = '${prod}'`)
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=contacte`)
  await page.locator('#ed-telefon2').fill('34611000888')
  await pestanya(page, 'operativa')
  await expect(page.getByTestId('bloc-ofertant')).toBeVisible()
  // Cambiar de pestaña no es salir: ningún diálogo.
  await expect(page.getByTestId('dialeg-canvis-pendents')).toHaveCount(0)
  await expect(page.getByTestId('pendent-contacte')).toBeVisible()
  await pestanya(page, 'contacte')
  await expect(page.locator('#ed-telefon2')).toHaveValue('34611000888')
  // Y se descarta saliendo sin guardar.
  await page.getByRole('button', { name: /^Entitats$|^Entidades$/ }).click()
  await page.getByTestId('dialeg-canvis-pendents').getByRole('button', { name: /^Surt sense desar$|^Sal sin guardar$/ }).click()
  await page.waitForURL((u) => u.pathname === '/equip/entitats')
  expect(sql(`select coalesce(telefono_alt, '-') from productores where id = '${prod}'`)).toBe('-')
})
