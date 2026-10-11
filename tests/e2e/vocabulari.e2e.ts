// Fase 0 de la revisión del 08-10-2026: el vocabulario. Solo lectura: vale contra el clon
// (`E2E_CLON=1`) y contra producción (con `E2E_CORTINA`).

import { expect, test } from '@playwright/test'
import { entra, motiuSalt } from './ajuda'

test.use({ viewport: { width: 360, height: 780 } })

test('la barra inferior del receptor dice «Excedents» y no recorta ninguna etiqueta a 360 px', async ({ page }) => {
  const m = motiuSalt('receptor')
  test.skip(m !== null, m ?? '')
  await entra(page, 'receptor')
  await page.goto('/receptor/mercat')
  const barra = page.locator('nav').filter({ has: page.locator('ul li') }).last()
  await expect(barra.getByText(/^(Excedents|Excedentes)$/)).toBeVisible()
  // Ninguna etiqueta recortada: el texto cabe en su celda (§2, medir y no estimar).
  const recortadas = await barra.locator('li span.truncate').evaluateAll(
    (els) => els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent),
  )
  expect(recortadas).toEqual([])
  // El título de la pantalla conserva el nombre completo.
  await expect(page.getByText(/Excedents disponibles|Excedentes disponibles/).first()).toBeVisible()
})
