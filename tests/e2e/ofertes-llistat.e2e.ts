// El listado de ofertas del equipo (`/equip/ofertes`), 20-11-2026: fecha y ofertante como
// columnas, producto con los kilos ofrecidos, barra con los kilos con salida y los pendientes,
// orden por fecha y SIN receptores en el listado (van en el detalle). Solo lectura: corre contra
// el clon o contra producción.
//
//   E2E_CLON=1 npx playwright test tests/e2e/ofertes-llistat.e2e.ts

import { expect, test } from '@playwright/test'
import { entra, motiuSalt } from './ajuda'

test.beforeEach(() => {
  const m = motiuSalt('super_admin')
  test.skip(m !== null, m ?? '')
})

test('cada fila dice qué es, quién la hizo, cuánto había y cuánto se ha colocado', async ({ page }, info) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes')
  const files = page.locator('tbody tr')
  await expect(files.first()).toBeVisible()
  const primera = files.first()

  // La cantidad inicial y el ofertante se ven siempre (en móvil, bajo el producto).
  await expect(primera.getByTestId('oferta-kg-oferts')).toContainText(/kg (oferts|ofrecidos)/)
  await expect(primera).toContainText(/\d{2}\/\d{2}\/\d{4}/)

  if (info.project.name === 'escriptori') {
    // Fecha, producto, progreso y estado como columnas; los receptores, no.
    const caps = await page.locator('thead th:visible').allInnerTexts()
    expect(caps.some((c) => /^(Data|Fecha)/.test(c.trim()))).toBe(true)
    expect(caps.join('|')).not.toMatch(/Receptor|Entitat receptora|Entidad receptora/i)
    await expect(primera.getByTestId('oferta-data')).toBeVisible()
    await expect(primera.getByTestId('oferta-kg-sortida')).toContainText(/\d.* de .*\d.* kg (amb sortida|con salida)/)
    await expect(primera.getByTestId('oferta-kg-falten')).toContainText(/falten|faltan|complet/)
    await expect(primera.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^\d+$/)
  }

  // Sin scroll horizontal, en cualquier ancho.
  const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(desborda).toBe(false)
})

test('la columna «Data» ordena y la pestaña se mantiene en la URL', async ({ page }, info) => {
  test.skip(info.project.name !== 'escriptori', 'La cabecera ordenable solo está desde `md`')
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes?tab=esborranys')
  await expect(page).toHaveURL(/tab=esborranys/)
  await page.goto('/equip/ofertes')
  await expect(page.locator('tbody tr').first()).toBeVisible()

  const dates = async () => (await page.getByTestId('oferta-data').allInnerTexts())
    .map((d) => d.trim().split('/').reverse().join('-'))
  const boto = page.getByTestId('ordre-data')
  const cap = boto.locator('xpath=ancestor::th')

  // Por defecto, lo más reciente arriba; un clic invierte; otro vuelve.
  await expect(cap).toHaveAttribute('aria-sort', 'descending')
  const recents = await dates()
  expect(recents).toEqual([...recents].sort().reverse())
  await boto.click()
  await expect(cap).toHaveAttribute('aria-sort', 'ascending')
  const antigues = await dates()
  expect(antigues).toEqual([...antigues].sort())
  await boto.click()
  await expect(cap).toHaveAttribute('aria-sort', 'descending')

  // El Històric conserva las dos mismas columnas y su pestaña vive en la URL.
  await page.getByRole('tab', { name: /Històric|Histórico/ }).click()
  await expect(page).toHaveURL(/tab=historic/)
  await expect(page.getByTestId('ordre-data')).toBeVisible()
})

test('clicar el título abre el detalle de la oferta, donde van los receptores', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes')
  const primera = page.locator('tbody tr').first()
  await expect(primera).toBeVisible()
  await primera.locator('button, a').filter({ hasText: /\S/ }).first().click()
  await expect(page).toHaveURL(/\/equip\/ofertes\/[0-9a-f-]{36}/)
})
