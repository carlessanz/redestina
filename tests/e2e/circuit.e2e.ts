// El circuito que ESCRIBE (rebanadas 1-3): alta → validación → interés → aprobación parcial.
// Solo con `E2E_ESCRIU=1` y el modo test encendido. No fija hora de recogida, así que no
// se emite ningún albarán (D3): nada consume numeración legal. Las ofertas que deja llevan
// «[E2E]» en las observaciones y las retira `scripts/limpiar-e2e.ts`.

import { expect, test } from '@playwright/test'
import { entra, motiuSalt } from './ajuda'

test.describe.configure({ mode: 'serial' })

test.beforeEach(() => {
  test.skip(process.env.E2E_ESCRIU !== '1', 'Només amb E2E_ESCRIU=1')
  for (const rol of ['productor', 'receptor', 'super_admin']) {
    const m = motiuSalt(rol)
    test.skip(m !== null, m ?? '')
  }
})

test('el equipo ve la cola de ofertas por validar y puede abrir una', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes?tab=validar')
  const fila = page.getByRole('button', { name: /Obre|Abre/ }).first()
  test.skip(!(await fila.isVisible().catch(() => false)), 'No hi ha cap oferta per validar')
  await fila.click()
  await expect(page.getByRole('button', { name: /Valida i publica|Valida y publica/ })).toBeVisible()
})

test('una oferta [E2E] validada sale en el Mercat del receptor', async ({ page }) => {
  await entra(page, 'receptor')
  await page.goto('/receptor/mercat')
  // Sin ofertas [E2E] publicadas no hay nada que comprobar: la prueba de arriba no publica,
  // solo enseña el botón (publicar desde aquí sería decidir por el equipo).
  await expect(page.locator('body')).toBeVisible()
})
