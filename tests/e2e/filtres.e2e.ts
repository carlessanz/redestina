// Fase 6 de la revisión del cliente del 08-10-2026: filtros y orden comunes en los listados.
// Solo lectura: corre contra el clon o contra producción.

import { expect, test } from '@playwright/test'
import { entra, motiuSalt } from './ajuda'

test.beforeEach(() => {
  const m = motiuSalt('productor')
  test.skip(m !== null, m ?? '')
})

test('«Les meves ofertes»: dos filtros combinados reducen la lista y «Neteja» la devuelve', async ({ page }, info) => {
  await entra(page, 'productor')
  await page.goto('/productor/ofertes')
  const files = page.locator('a[href^="/productor/ofertes/"]:not([href$="/nova"])')
  await expect(files.first()).toBeVisible()
  const total = await files.count()
  // En móvil la barra va plegada detrás de «Filtres».
  if (info.project.name === 'mobil') await page.getByRole('button', { name: /^Filtres|^Filtros/ }).click()
  const mod = page.locator('#po-modalitat')
  test.skip(await mod.count() === 0, 'Totes les ofertes tenen la mateixa modalitat: no hi ha res a filtrar')
  const opcions = await mod.locator('option').allTextContents()
  await mod.selectOption({ index: 1 })
  const ambUn = await files.count()
  expect(ambUn).toBeLessThanOrEqual(total)
  await expect(page.getByText(/Mostrant \d+ de \d+|Mostrando \d+ de \d+/)).toBeVisible()
  const estat = page.locator('#po-estat')
  if (await estat.count()) {
    await estat.selectOption({ index: 1 })
    expect(await files.count()).toBeLessThanOrEqual(ambUn)
  }
  await page.getByRole('button', { name: /Neteja els filtres|Quitar los filtros/ }).click()
  await expect(files).toHaveCount(total)
  expect(opcions.length).toBeGreaterThan(1)
})

test('las ofertas en marcha salen por disponibilidad: la que se acaba antes, arriba', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto('/productor/ofertes')
  const files = page.locator('a[href^="/productor/ofertes/"]:not([href$="/nova"])')
  await expect(files.first()).toBeVisible()
  // Las primeras filas con fecha de disponibilidad, en el orden en que salen.
  const textos = await files.allTextContents()
  const dates: string[] = []
  for (const tx of textos) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(tx)
    if (!m) break
    dates.push(`${m[3]}-${m[2]}-${m[1]}`)
  }
  test.skip(dates.length < 2, 'Menys de dues ofertes amb data: res a comparar')
  // Dentro del bloque «en marcha» el orden es ascendente; al pasar a las cerradas puede
  // volver a empezar, así que se mira solo el primer tramo ascendente no vacío.
  let i = 1
  while (i < dates.length && dates[i] >= dates[i - 1]) i++
  expect(i).toBeGreaterThanOrEqual(2)
})
