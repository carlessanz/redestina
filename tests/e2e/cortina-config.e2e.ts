// Configuració › General › «Pantalla de protecció prèvia a la home» (09-11-2026, 20270517110000).
// Solo contra el CLON: escribe `cortina_config`, y lo deja como estaba. El efecto en la web (que
// la cortina salga o no) lo cubren las pruebas del middleware (`tests/cortina.test.ts`); aquí se
// prueba la pantalla: encender/apagar con su confirmación, ver y cambiar la contraseña, y que
// quien no es super_admin ni la ve.

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

let abans = ''

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(() => {
  if (motiuSaltClon('super_admin') !== null) return
  abans = sql(`select format('%L, %L, %L, %L, %L', activa, contrasenya, hash_token, updated_at, updated_by) from cortina_config where id = 1`)
  sql(`update cortina_config set activa = false, contrasenya = null, hash_token = null, updated_by = null where id = 1`)
})

test.afterAll(() => {
  if (motiuSaltClon('super_admin') !== null) return
  sql(`update cortina_config set (activa, contrasenya, hash_token, updated_at, updated_by) = (${abans}) where id = 1`)
})

const activa = () => sql(`select activa from cortina_config where id = 1`)

test('nace apagada: se enciende sin pedir confirmación y se apaga confirmando', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/configuracio')
  const bloc = page.getByTestId('cortina')
  await expect(bloc).toBeVisible()
  await expect(bloc).toContainText(/desactivada/)
  expect(activa()).toBe('f')

  await bloc.getByRole('button', { name: /^(Activat|Activado)$/ }).click()
  await expect(bloc).toContainText(/Pantalla activada/)
  expect(activa()).toBe('t')

  await bloc.getByRole('button', { name: /^(Desactivat|Desactivado)$/ }).click()
  const d = page.getByRole('dialog')
  await expect(d).toContainText(/oberta|abierta/)
  await d.getByRole('button', { name: /Cancel·la|Cancela/ }).click()
  expect(activa()).toBe('t')

  await bloc.getByRole('button', { name: /^(Desactivat|Desactivado)$/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Sí, desactiva-la|Sí, desactivarla/ }).click()
  await expect(bloc).toContainText(/Pantalla desactivada/)
  expect(activa()).toBe('f')
})

test('la contraseña vigente de antes no se puede mostrar; la nueva sí, con Mostra y validación', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/configuracio')
  const bloc = page.getByTestId('cortina')
  await expect(bloc.getByTestId('cortina-sense-propia')).toBeVisible()

  const camp = bloc.getByTestId('cortina-nova')
  const boto = bloc.getByTestId('cortina-canvia')
  await camp.fill('curta')
  await expect(boto).toBeDisabled()
  await expect(bloc).toContainText(/almenys 8|al menos 8/)

  const nova = 'prova-e2e-cortina-1'
  await camp.fill(nova)
  await expect(boto).toBeEnabled()
  await boto.click()
  await page.getByRole('dialog').getByRole('button', { name: /^(Canvia-la|Cambiarla)$/ }).click()
  await expect(bloc.getByTestId('cortina-pw')).toBeVisible()
  await expect(bloc.getByTestId('cortina-ultim')).toBeVisible()

  // En claro en la base, y la huella calculada por el servidor (no por el navegador).
  expect(sql(`select contrasenya from cortina_config where id = 1`)).toBe(nova)
  expect(sql(`select hash_token ~ '^[0-9a-f]{64}$' from cortina_config where id = 1`)).toBe('t')
  expect(sql(`select updated_by is not null from cortina_config where id = 1`)).toBe('t')

  // Tras guardarla se enseña; «Amaga» la oculta, «Mostra» la vuelve a enseñar.
  await expect(bloc.getByTestId('cortina-pw')).toHaveText(nova)
  await bloc.getByTestId('cortina-mostra').click()
  await expect(bloc.getByTestId('cortina-pw')).not.toHaveText(nova)
  await bloc.getByTestId('cortina-mostra').click()
  await expect(bloc.getByTestId('cortina-pw')).toHaveText(nova)
})

test('quien no es super_admin no ve la pantalla de protección', async ({ page }) => {
  const m = motiuSaltClon('equip')
  test.skip(m !== null, m ?? '')
  await entra(page, 'equip')
  await page.goto('/equip/configuracio')
  await expect(page.getByTestId('cortina')).toHaveCount(0)
  await expect(page.getByText(/Validació de les ofertes noves|Validación de las ofertas nuevas/)).toBeVisible()
})
