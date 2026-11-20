// «Entrades i sortides» (punto 6.7): la tabla de salidas, un filtro, la ficha por URL, el Resum
// y la exportación a Excel. Solo lectura, pero cuenta con las salidas del clon (22 vivas de
// donación, venta y espigolada en la referencia del 20-11-2026), así que corre contra el clon.

import { expect, test, type Page } from '@playwright/test'
import { entra, motiuSaltClon, tria } from './ajuda'

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
})

/** La cifra de una casilla de la franja (`es-xifra-<clau>`), como número. */
async function xifra(page: Page, clau: string): Promise<number> {
  const text = (await page.getByTestId(`es-xifra-${clau}`).locator('dd').textContent()) ?? ''
  return Number(text.replace(/[^\d,]/g, '').replace(',', '.'))
}

async function obreFiltres(page: Page, mobil: boolean): Promise<void> {
  // En móvil la barra va plegada detrás de «Filtres».
  if (mobil) await page.getByRole('button', { name: /^Filtres|^Filtros/ }).click()
}

test('la tabla carga y un filtro de modalidad reduce las filas y la cifra', async ({ page }, info) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/entrades-sortides')
  const files = page.getByTestId('es-fila')
  await expect(files.first()).toBeVisible()
  const total = await xifra(page, 'sortides')
  expect(total).toBeGreaterThan(0)
  const filesAbans = await files.count()
  expect(filesAbans).toBe(Math.min(25, total))

  await obreFiltres(page, info.project.name === 'mobil')
  await tria(page.locator('#es-modalitat'), 'venda')
  await expect.poll(() => xifra(page, 'sortides')).toBeLessThan(total)
  const ambFiltre = await xifra(page, 'sortides')
  await expect(files).toHaveCount(Math.min(25, ambFiltre))
  // Todas las filas que quedan son ventas (la columna de modalidad, desde `md`).
  if (info.project.name !== 'mobil' && ambFiltre > 0) {
    await expect(files.first()).toContainText(/Venda|Venta/)
  }
})

test('clicar una fila abre la ficha de la operación y la URL lo lleva', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/entrades-sortides')
  const fila = page.getByTestId('es-fila').first()
  await expect(fila).toBeVisible()
  // El clic en la fila (no en el título): la fila entera abre el detalle.
  await fila.locator('td:visible').first().click()
  await expect(page.getByTestId('es-dialeg')).toBeVisible()
  await expect(page.getByTestId('fitxa-operacio')).toBeVisible()
  await expect(page).toHaveURL(/canalitzacio=[0-9a-f-]{36}/)
  // Con la URL, el diálogo se abre solo (enlace compartido) y lleva a la oferta.
  const url = page.url()
  await page.goto(url)
  await expect(page.getByTestId('fitxa-operacio')).toBeVisible()
  await expect(page.getByTestId('es-enllacos').getByRole('link', { name: /Obre l’oferta|Abre la oferta/ })).toBeVisible()
})

test('la pestaña Resum agrupa por entidad productora', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/entrades-sortides')
  await page.getByTestId('es-tab-resum').click()
  await expect(page).toHaveURL(/pestanya=resum/)
  await tria(page.locator('#es-per'), 'ofertant')
  await expect(page).toHaveURL(/per=ofertant/)
  const taula = page.getByTestId('es-resum')
  await expect(taula.locator('thead')).toContainText(/Entitat productora|Entidad productora/)
  await expect(page.getByTestId('es-grup').first()).toBeVisible()
  // Tantos grupos como entidades productoras dice la franja.
  const ofertants = await xifra(page, 'ofertants')
  await expect(page.getByTestId('es-grup')).toHaveCount(ofertants)
})

test('«Exporta a Excel» descarga un .xlsx', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/entrades-sortides')
  await expect(page.getByTestId('es-fila').first()).toBeVisible()
  const [descarrega] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('es-exporta').click(),
  ])
  expect(descarrega.suggestedFilename()).toMatch(/^entrades-sortides-\d{4}-\d{2}-\d{2}\.xlsx$/)
})
