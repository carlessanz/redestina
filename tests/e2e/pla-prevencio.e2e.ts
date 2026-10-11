// Fase 11 de la revisión del cliente del 08-10-2026: el Pla de Prevenció como expediente.
// Solo contra el CLON LOCAL y en escritorio: crea un expediente y exporta su PDF (consume un
// número de la serie PLA del clon).

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, productorDe, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('superadmin', 'productor')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Crea un expedient al clon: només a escriptori')
})

test('el equipo abre el expediente, lo llena por pestañas y exporta el PDF', async ({ page }) => {
  const prod = productorDe('productor')
  // Uno abierto por organización: se cierran los de pasadas anteriores.
  sql(`update expedients_prevencion set estat = 'tancat' where productor_id = '${prod}' and estat <> 'tancat'`)
  const nom = sql(`select coalesce(empresa, name) from productores where id = '${prod}'`)

  await entra(page, 'superadmin')
  await page.goto('/equip/plans')
  await page.locator('#plans-org').selectOption({ label: nom })
  await page.getByRole('button', { name: /Obre l’expedient|Abre el expediente/ }).click()
  await expect(page).toHaveURL(/\/equip\/plans\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop()!

  // Visita de diagnosi.
  const visites = page.getByTestId('exp-visites')
  await visites.getByRole('button', { name: /Afegeix|Añade/ }).click()
  await page.locator('#pla_visites-data').fill('2026-10-01')
  await page.locator('#pla_visites-tipus').selectOption('diagnosi')
  await page.locator('#pla_visites-notes').fill('Visita inicial E2E')
  await visites.getByRole('button', { name: /^Desar$|^Guardar$/ }).click()
  await expect(visites.getByText('Visita inicial E2E')).toBeVisible()

  // Cuantificación manual de dos años y la comparativa.
  await page.getByRole('tab', { name: /Quantificació|Cuantificación/ }).click()
  const quant = page.getByTestId('exp-quantificacio')
  for (const [mes, kg] of [['2025-08', '900'], ['2026-08', '700']]) {
    await quant.getByRole('button', { name: /Afegeix|Añade/ }).click()
    await page.locator('#pla_quantificacio-mes').fill(mes)
    await page.locator('#pla_quantificacio-producte').fill('Tomàquet')
    await page.locator('#pla_quantificacio-categoria').selectOption('perdua')
    await page.locator('#pla_quantificacio-kg').fill(kg)
    await quant.getByRole('button', { name: /^Desar$|^Guardar$/ }).click()
    await expect(quant.getByText(mes)).toBeVisible()
  }
  await expect(page.getByTestId('exp-comparativa').getByText('-22,2 %')).toBeVisible()

  // Una acción.
  await page.getByRole('tab', { name: /Objectius i accions|Objetivos y acciones/ }).click()
  const accions = page.getByTestId('exp-accions')
  await accions.getByRole('button', { name: /Afegeix|Añade/ }).click()
  await page.locator('#pla_accions-mesura').fill('Venda de segona categoria')
  await page.locator('#pla_accions-estat').selectOption('en_curs')
  await accions.getByRole('button', { name: /^Desar$|^Guardar$/ }).click()
  await expect(accions.getByText('Venda de segona categoria')).toBeVisible()

  // Exportar: PDF tipo PLA sobre el expediente, numerado y generado.
  await page.getByRole('button', { name: /Exporta el PDF/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: /Exporta el PDF/ }).click()
  await expect.poll(() => sql(`select coalesce(max(paginas), 0) from documentos
                                where objeto_tipo = 'expedient' and objeto_id = '${id}' and estado = 'emitido'`),
    { timeout: 30_000 }).not.toBe('0')
  expect(sql(`select numero_completo from expedients_prevencion where id = '${id}'`)).toMatch(/^PLA-\d{4}-\d{4}$/)
})

test('la productora lo ve en solo lectura, separado de su diagnóstico', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto('/organitzacio/pla')
  const exp = page.getByTestId('expedient')
  await expect(exp.getByText('Visita inicial E2E')).toBeVisible()
  await expect(exp.getByRole('button', { name: /Afegeix|Añade/ })).toHaveCount(0)
  await expect(exp.getByRole('button', { name: /Exporta el PDF/ })).toHaveCount(0)
  await page.getByRole('tab', { name: /PDF exportats|PDF exportados/ }).click()
  await expect(page.getByTestId('exp-documents').getByText(/PLA-\d{4}-\d{4}/)).toBeVisible()
  // En el menú son dos entradas distintas.
  const menu = page.locator('[data-sidebar="menu-item"]')
  await expect(menu.filter({ hasText: /El meu pla de prevenció|Mi plan de prevención/ })).toHaveCount(1)
  await expect(menu.filter({ hasText: /El meu diagnòstic|Mi diagnóstico/ })).toHaveCount(1)
})
