// Fase 9 de la revisión del cliente del 08-10-2026: el «Diagnòstic operatiu» del productor
// es una ficha viva (guardar no genera ningún plan) y el receptor ya no tiene diagnóstico:
// tiene «El meu perfil de recepció».
// Solo contra el CLON LOCAL y solo en escritorio (escribe el diagnóstico de la cuenta de prueba).

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, productorDe, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })
const RECEPTOR = 'receptor-carles'

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Escriu el diagnòstic de la fitxa de prova: només a escriptori')
})

test('el productor contesta por familias, productos y meses, y no se genera ningún plan', async ({ page }) => {
  const prod = productorDe('productor')
  // Se parte de un diagnóstico vacío: sin borrador y sin historial.
  sql(`delete from planes_prevencion where productor_id = '${prod}' and estado = 'esborrany'`)
  sql(`delete from diagnostics_historial where productor_id = '${prod}'`)
  sql(`update productores set productos_habituales = '{}', temporada = null where id = '${prod}'`)

  await entra(page, 'productor')
  await page.goto('/organitzacio/diagnostic')
  await expect(page.getByText(/Diagnòstic operatiu|Diagnóstico operativo/).first()).toBeVisible()
  // Ni rastro del plan en la pantalla de la organización.
  await expect(page.getByText(/Emet el pla|Emite el plan|Pla proposat|Plan propuesto/)).toHaveCount(0)

  // Sin familias no hay productos que elegir.
  await expect(page.getByText(/Marca primer les famílies|Marca primero las familias/).first()).toBeVisible()
  await page.getByRole('checkbox', { name: /^Hortalissa de fruit$|^Hortaliza de fruto$/ }).click()
  await page.getByRole('button', { name: 'Tomàquet', exact: true }).first().click()
  await page.getByRole('button', { name: 'Carbassó', exact: true }).first().click()

  // Los principales salen de lo marcado arriba.
  const principals = page.locator('[aria-labelledby="diag-productes_principals-etiqueta"]')
  await principals.getByRole('button', { name: 'Tomàquet', exact: true }).click()
  await page.locator('#diag-volum_producte-0').fill('12000')
  const temporada = page.locator('[aria-labelledby="diag-temporada-0-l"]')
  for (const m of [/^jun$/, /^jul$/, /^ago$/]) await temporada.getByRole('button', { name: m }).click()

  // Guardar a medias: faltan obligatorias.
  await page.getByRole('button', { name: /Desa i continua més tard|Guarda y sigue más tarde/ }).click()
  await expect(page.getByText(/Preguntes obligatòries pendents|Preguntas obligatorias pendientes/).first()).toBeVisible()
  expect(sql(`select count(*) from diagnostics_historial where productor_id = '${prod}' and not complet`)).toBe('1')

  // Completar las obligatorias que quedan.
  await page.locator('[aria-labelledby="diag-situacions_excedent-etiqueta"]')
    .getByRole('checkbox', { name: /^Criteris de qualitat o estètica$|^Criterios de calidad o estética$/ }).click()
  await page.locator('#diag-frequencia_excedent').click()
  await page.getByRole('option', { name: /^Estacionalment$|^Estacionalmente$/ }).click()
  await page.locator('#diag-volum_excedent').click()
  await page.getByRole('option', { name: /250–500 kg/ }).click()
  await page.locator('[aria-labelledby="diag-canals_actuals-etiqueta"]').getByRole('checkbox', { name: /^Donació$|^Donación$/ }).click()
  await page.locator('[aria-labelledby="diag-sortides_interes-etiqueta"]').getByRole('checkbox', { name: /^Donació$|^Donación$/ }).click()
  await page.getByRole('button', { name: /^Desa el diagnòstic$|^Guarda el diagnóstico$/ }).click()
  await expect(page.getByText(/Diagnòstic desat i complet|Diagnóstico guardado y completo/).first()).toBeVisible()

  // La ficha viva: historial, productos y temporada derivados; y NINGÚN plan generado.
  expect(sql(`select count(*) from diagnostics_historial where productor_id = '${prod}' and complet`)).toBe('1')
  expect(sql(`select array_to_string(productos_habituales, ',') from productores where id = '${prod}'`)).toMatch(/Tomàquet/)
  expect(sql(`select temporada -> 'Tomàquet' from productores where id = '${prod}'`)).toBe('[6, 7, 8]')
  expect(sql(`select jsonb_array_length(coalesce(mesures -> 'llista', '[]'::jsonb)) from planes_prevencion
              where productor_id = '${prod}' and estado = 'esborrany'`)).toBe('0')

  // Al volver a entrar se abre con lo guardado.
  await page.reload()
  await expect(page.locator('#diag-volum_producte-0')).toHaveValue('12000')
})

test('la receptora ve «El meu perfil de recepció» y no «El meu diagnòstic»', async ({ page }) => {
  await entra(page, RECEPTOR)
  await page.goto('/organitzacio')
  const menu = page.locator('[data-sidebar="menu-item"]')
  await expect(menu.filter({ hasText: /El meu perfil de recepció|Mi perfil de recepción/ })).toHaveCount(1)
  await expect(menu.filter({ hasText: /El meu diagnòstic|Mi diagnóstico/ })).toHaveCount(0)
  await page.goto('/organitzacio/diagnostic')
  await expect(page).toHaveURL(/\/organitzacio\/perfil-recepcio$/)
  await expect(page.getByTestId('preferencies-recepcio')).toBeVisible()
})
