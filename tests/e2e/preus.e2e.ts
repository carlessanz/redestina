// Precios de referencia por mes (punto 3, fase D1, 17-11-2026), de punta a punta contra el
// CLON LOCAL con el super_admin:
//
//   1. «Productes › Preus de referència» enseña los precios de un mes ya validado (septiembre
//      de 2026, cargado de Gencat): la fila de Poma, validada y con su fuente.
//   2. Valida un mes entero desde la pantalla (diciembre de 2025: se borran antes sus precios
//      validados, así la prueba se puede repetir) y la base lo guarda con quién lo validó.
//   3. «Nou producte» con nombre en castellano «Alcachofa»: la coincidencia ALCACHOFA de
//      Mercabarna viene marcada; al acabar, la ficha del producto la enseña como equivalencia.
//   4. «Càrregues»: el fichero original de una carga se descarga (URL firmada de `preus-fonts`)
//      y pesa lo que dice la base.
//   5. A 375 px, las tres pantallas sin scroll horizontal.
//
// Solo en el clon, con `E2E_ESCRIU=1` (valida precios y crea un producto) y en el proyecto de
// escritorio. Los productos de prueba se llaman `TEST-PREU …` y se borran antes y después.

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { entra, motiuSaltClon, sql, tria } from './ajuda'

test.describe.configure({ mode: 'serial' })

const marca = Date.now().toString(36).slice(-5)
const NOU = `TEST-PREU ${marca}`

function neteja() {
  sql(`delete from productos where nombre like 'TEST-PREU %'`)
}

async function senseScrollHoritzontal(page: Page): Promise<{ doc: boolean; out: string[] }> {
  return page.evaluate(() => {
    const out: string[] = []
    const main = document.querySelector('main')
    if (main && main.scrollWidth > main.clientWidth + 1) out.push(`MAIN ${main.scrollWidth}>${main.clientWidth}`)
    for (const el of document.querySelectorAll('main *')) {
      const h = el as HTMLElement
      if (h.clientWidth > 0 && h.scrollWidth > h.clientWidth + 1 && getComputedStyle(h).overflowX === 'visible') {
        out.push(`${h.tagName} ${h.scrollWidth}>${h.clientWidth} «${(h.textContent ?? '').slice(0, 40)}»`.slice(0, 160))
      }
    }
    return { doc: document.documentElement.scrollWidth > document.documentElement.clientWidth, out }
  })
}

test.beforeEach(({}, info) => {
  const motiu = motiuSaltClon('super_admin')
  test.skip(motiu !== null, motiu ?? '')
  test.skip(process.env.E2E_ESCRIU !== '1', 'Escriu al clon: cal E2E_ESCRIU=1')
  test.skip(info.project.name !== 'escriptori', 'Només a escriptori (el mòbil es mesura a 375 px dins la prova)')
})

test.beforeAll(() => { if (process.env.E2E_CLON === '1' && process.env.E2E_ESCRIU === '1') neteja() })
test.afterAll(() => { if (process.env.E2E_CLON === '1' && process.env.E2E_ESCRIU === '1') neteja() })

test('1 · enseña los precios validados de un mes', async ({ page }) => {
  const poma = sql(`select eur_kg from preus_referencia where producto = 'Poma' and exercici = 2026 and mes = 9`)
  expect(poma, 'cal el setembre de 2026 validat al clon (validar_preus_periode)').not.toBe('')
  await entra(page, 'super_admin')
  await page.goto('/equip/productes?pestanya=preus')
  await tria(page.getByTestId('preu-any'), '2026')
  await tria(page.getByTestId('preu-mes'), '9')
  const fila = page.locator('[data-producte="Poma"]')
  await expect(fila).toBeVisible()
  await expect(fila).toContainText(/Validat|Validado/)
  await expect(fila).toContainText('Gencat')
  // El mismo número que la base (formato es-ES, hasta 4 decimales).
  const text = Number(poma).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  await expect(fila).toContainText(text)
  await expect(page.getByTestId('preu-resum')).toContainText(/0 per validar|0 por validar/)
})

test('2 · valida un mes entero', async ({ page }) => {
  sql(`delete from preus_referencia where exercici = 2025 and mes = 12`)
  await entra(page, 'super_admin')
  await page.goto('/equip/productes?pestanya=preus')
  await tria(page.getByTestId('preu-any'), '2025')
  await tria(page.getByTestId('preu-mes'), '12')
  await expect(page.getByTestId('preu-taula')).toBeVisible()
  const boto = page.getByTestId('preu-valida-mes')
  await expect(boto).toBeEnabled()
  await boto.click()
  await page.getByRole('dialog').getByRole('button', { name: /^Valida el mes$|^Validar el mes$/ }).click()
  await expect(page.getByTestId('preu-resum')).toContainText(/0 per validar|0 por validar/)
  const n = Number(sql(`select count(*) from preus_referencia where exercici = 2025 and mes = 12 and validat_per is not null`))
  expect(n).toBeGreaterThan(0)
  await expect(page.getByTestId('preu-valida-mes')).toBeDisabled()
})

test('3 · nou producte amb la coincidència proposada', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/productes')
  await page.getByTestId('nou-producte').click()
  const dialeg = page.getByRole('dialog')
  await dialeg.locator('#nou-nom').fill(NOU)
  await dialeg.locator('#nou-nom-es').fill('Alcachofa')
  await tria(dialeg.locator('#nou-familia'), 'Horta Fulla')
  await page.getByTestId('nou-producte-crea').click()
  const llista = page.getByTestId('nou-producte-coincidencies')
  await expect(llista).toBeVisible()
  // La exacta (ALCACHOFA, Mercabarna) viene marcada.
  const casella = llista.locator('label').filter({ hasText: /^.*ALCACHOFA/ }).first().getByRole('checkbox')
  await expect(casella).toBeChecked()
  await page.getByTestId('nou-producte-acaba').click()
  await page.waitForURL(/\/equip\/productes\/TEST-PREU/)
  const preus = page.getByTestId('preus-producte')
  await expect(preus).toContainText('ALCACHOFA')
  expect(sql(`select count(*) from productes_fonts where producto = '${NOU}' and font = 'mercabarna' and upper(nom_font) = 'ALCACHOFA'`)).toBe('1')
  expect(sql(`select preu_manual from productos where nombre = '${NOU}'`)).toBe('f')
})

test('4 · baixa el fitxer original d’una càrrega', async ({ page, request }) => {
  const id = sql(`select id from preus_carregues where font = 'gencat' order by created_at desc limit 1`)
  const mida = Number(sql(`select mida_bytes from preus_carregues where id = '${id}'`))
  await entra(page, 'super_admin')
  await page.goto('/equip/productes?pestanya=carregues')
  await expect(page.getByTestId('carregues-taula')).toBeVisible()
  const resposta = page.waitForResponse((r) => r.url().includes('/functions/v1/preus-fonts')
    && (r.request().postData() ?? '').includes(id))
  const popup = page.waitForEvent('popup').catch(() => null)
  await page.locator(`[data-carrega="${id}"]`).getByTestId('carrega-descarrega').click()
  const r = await resposta
  expect(r.status()).toBe(200)
  const cos = await r.json() as { url: string; nom: string | null }
  expect(cos.url).toMatch(/^http:\/\/127\.0\.0\.1:55321\/storage\/v1\/object\/sign\/preus-fonts\//)
  const fitxer = await request.get(cos.url)
  expect(fitxer.status()).toBe(200)
  expect((await fitxer.body()).length).toBe(mida)
  await (await popup)?.close()
})

test('5 · a 375 px, sense scroll horitzontal', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await entra(page, 'super_admin')
  for (const ruta of ['/equip/productes?pestanya=preus', '/equip/productes?pestanya=carregues', '/equip/productes/Poma']) {
    await page.goto(ruta)
    if (ruta.endsWith('preus')) {
      await tria(page.getByTestId('preu-any'), '2026')
      await tria(page.getByTestId('preu-mes'), '9')
      await expect(page.getByTestId('preu-taula')).toBeVisible()
    } else if (ruta.endsWith('carregues')) {
      await expect(page.getByTestId('carregues-taula')).toBeVisible()
    } else {
      await expect(page.getByTestId('preus-any-2026')).toBeVisible()
    }
    const d = await senseScrollHoritzontal(page)
    expect(d.doc, `${ruta}: la pàgina desborda`).toBe(false)
    expect(d.out, ruta).toEqual([])
  }
})
