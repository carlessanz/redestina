// Retoques de la revisión en producción (12-10-2026). Solo lectura: vale contra el clon
// (`E2E_CLON=1`) y contra producción (con `E2E_CORTINA`).

import { expect, test } from '@playwright/test'
import { entra, motiuSalt } from './ajuda'

test('la receptora ya no tiene el enlace «Obre el diagnòstic» en sus documentos', async ({ page }) => {
  const m = motiuSalt('receptor')
  test.skip(m !== null, m ?? '')
  await entra(page, 'receptor')
  await page.goto('/receptor/documents')
  await expect(page.getByText(/Els meus certificats|Mis certificados/).first()).toBeVisible()
  // El bloque del plan sigue (la receptora puede tener un PDF antiguo), pero sin el enlace.
  await expect(page.locator('a[href="/organitzacio/diagnostic"]')).toHaveCount(0)
})

test('la productora sí tiene el enlace al diagnóstico y ningún texto con el nombre antiguo del CT', async ({ page }) => {
  const m = motiuSalt('productor')
  test.skip(m !== null, m ?? '')
  await entra(page, 'productor')
  await page.goto('/productor/documents')
  await expect(page.locator('a[href="/organitzacio/diagnostic"]').first()).toBeVisible()
  const text = await page.locator('main').last().innerText()
  expect(text).not.toMatch(/certificat de transacci|certificado de transacci/i)
})

test('el diagnóstico de la productora no dice «contestat» sin respuestas', async ({ page }) => {
  const m = motiuSalt('productor')
  test.skip(m !== null, m ?? '')
  await entra(page, 'productor')
  await page.goto('/organitzacio/diagnostic')
  // Desde A1 la productora LEE un resumen: o hay respuestas, o el estado vacío.
  const ple = page.getByTestId('resum-diagnostic')
  const buit = page.getByTestId('resum-diagnostic-buit')
  await expect(ple.or(buit).first()).toBeVisible()
  if (await buit.count() > 0) {
    const text = await page.locator('main').last().innerText()
    expect(text).not.toMatch(/Diagnòstic contestat|Diagnóstico contestado|\bContestat\b|\bContestado\b/)
  }
})
