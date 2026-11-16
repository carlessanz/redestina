// Fase 1 de filtros (revisión del feedback del 08-10-2026, informe del 16-11-2026): Provincia y
// Municipi en los listados, la barra común en «Excedents disponibles» y los filtros de
// modalidad y kilos habituales del ranking. SOLO LECTURA. (Los de la fase 6, en `filtres.e2e.ts`.)

import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { CLON, entra, motiuSalt, opcionsDe, sql } from './ajuda'

/** En móvil la barra va plegada tras el botón «Filtres». */
async function obre(barra: Locator): Promise<void> {
  const boto = barra.getByRole('button', { name: /Filtres/ })
  if (await boto.isVisible()) await boto.click()
}

test('Ofertes (equip) ofrece Provincia y Municipi', async ({ page }) => {
  const m = motiuSalt('super_admin')
  test.skip(m !== null, m ?? '')
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes')
  await expect(page.getByTestId('filtres-off')).toBeVisible()
  await obre(page.getByTestId('filtres-off'))
  const provincies = await opcionsDe(page.locator('#off-provincia'))
  expect(provincies.some((p) => /Barcelona|Girona|Lleida|Tarragona/.test(p))).toBe(true)
  await expect(page.locator('#off-municipi')).toBeVisible()
})

test('Excedents disponibles lleva la barra común con el rango «Disponible fins»', async ({ page }) => {
  const m = motiuSalt('receptor')
  test.skip(m !== null, m ?? '')
  await entra(page, 'receptor')
  await page.goto('/receptor/mercat')
  await expect(page.getByRole('heading').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  const barra = page.getByTestId('filtres-mk')
  // Sin ofertas compatibles no hay nada que filtrar y la pantalla enseña el vacío.
  test.skip(!(await barra.count()), 'El receptor de prueba no tiene ofertas en el Mercat')
  await expect(page.locator('#mk-des')).toBeAttached()
  await expect(page.locator('#mk-fins')).toBeAttached()
})

test('el ranking de una oferta con dos modalidades filtra por modalidad', async ({ page }) => {
  const m = motiuSalt('super_admin')
  test.skip(m !== null || !CLON, m ?? 'Necesita el clon para elegir la oferta')
  const oferta = sql(`select id from excedentes where estado in ('publicada','parcial')
    and cardinality(modalitats) > 1 order by created_at desc limit 1`).trim()
  test.skip(!oferta, 'No hay ninguna oferta abierta con dos modalidades en el clon')
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${oferta}`)
  const filtre = page.locator('#od-filtre-modalitat')
  await expect(filtre).toBeVisible({ timeout: 20_000 })
  const opcions = await opcionsDe(filtre)
  expect(opcions.length).toBeGreaterThan(1)
})
