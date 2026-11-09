// Configució › Fundació › «Regenerar els documents ja emesos» (09-11-2026, 20270516100100).
// Solo contra el CLON, y SIN regenerar de verdad: una regeneración emite versiones nuevas de
// documentos inmutables, que ya no se pueden borrar, así que aquí se prueba lo que se ve y lo que
// se pide antes (el recuento, el aviso, el diálogo de aceptación y que con el modo test apagado
// no se ofrece). La regeneración real se probó a mano en el clon (ver context/04).

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

const URL = '/equip/configuracio?tab=fundacio'
let raoAbans = ''
let testModeAbans = ''

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(() => {
  if (motiuSaltClon('super_admin') !== null) return
  raoAbans = sql(`select razon_social from parametros_documentales where id = 1`)
  testModeAbans = sql(`select value from app_settings where key = 'test_mode'`)
})

test.afterAll(() => {
  if (motiuSaltClon('super_admin') !== null) return
  sql(`update parametros_documentales set razon_social = '${raoAbans.replace(/'/g, "''")}' where id = 1`)
  sql(`update app_settings set value = '${testModeAbans}' where key = 'test_mode'`)
})

test('en modo test: cuenta lo que cambiaría y pide aceptar con el aviso; cancelar no toca nada', async ({ page }) => {
  // Unos datos de la Fundació distintos de los que llevan los documentos.
  sql(`update parametros_documentales set razon_social = 'Fundació E2E de prova' where id = 1`)
  const versionsAbans = sql(`select count(*) from documentos`)

  await entra(page, 'super_admin')
  await page.goto(URL)
  const bloc = page.getByTestId('regen-docs')
  await expect(bloc).toBeVisible()
  await expect(bloc).toContainText(/mode test|modo test/)
  await expect(bloc.getByTestId('regen-resum')).toContainText(/\d+ documents? (tenen|té|tienen|tiene)/)
  await expect(bloc.getByTestId('regen-go')).toBeEnabled()

  await bloc.getByTestId('regen-go').click()
  const d = page.getByRole('dialog')
  await expect(d).toContainText(/producció|producción/)
  await d.getByRole('button', { name: /Cancel·la|Cancela/ }).click()
  await expect(d).toHaveCount(0)
  expect(sql(`select count(*) from documentos`)).toBe(versionsAbans)
})

test('con el modo test apagado no se ofrece y la base lo rechaza', async ({ page }) => {
  sql(`update app_settings set value = 'false' where key = 'test_mode'`)
  await entra(page, 'super_admin')
  await page.goto(URL)
  const bloc = page.getByTestId('regen-docs')
  await expect(bloc.getByTestId('regen-prod')).toBeVisible()
  await expect(bloc.getByTestId('regen-go')).toHaveCount(0)
  // La base, por su cuenta (sin sesión = service_role, que pasa la guarda de rol pero no la del modo test).
  expect(() => sql(`select public.regenerar_documents_fundacio(true)`)).toThrow(/nomes_en_mode_test/)
})
