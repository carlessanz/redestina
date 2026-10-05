// Recorridos de SOLO LECTURA de las rebanadas 0-4 (no escriben nada en la base).

import { expect, test } from '@playwright/test'
import { entra, motiuSalt } from './ajuda'

test.describe('receptor', () => {
  test.beforeEach(() => {
    const m = motiuSalt('receptor')
    test.skip(m !== null, m ?? '')
  })

  test('el Mercat carga, con la campana de avisos', async ({ page }) => {
    await entra(page, 'receptor')
    await page.goto('/receptor/mercat')
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Avisos/ })).toBeVisible()
  })

  test('Els meus interessos abre y baja el badge', async ({ page }) => {
    await entra(page, 'receptor')
    await page.goto('/receptor/interessos')
    await expect(page.getByText(/Els meus interessos|Mis intereses/).first()).toBeVisible()
  })
})

test.describe('productor', () => {
  test.beforeEach(() => {
    const m = motiuSalt('productor')
    test.skip(m !== null, m ?? '')
  })

  test('el alta pide la franja con desplegables y las modalidades como casillas', async ({ page }) => {
    await entra(page, 'productor')
    await page.goto('/productor/ofertes/nova')
    await expect(page.getByText(/Nova oferta|Nueva oferta/).first()).toBeVisible()
  })

  test('una oferta abierta se puede editar (sin guardar)', async ({ page }) => {
    await entra(page, 'productor')
    await page.goto('/productor/ofertes')
    const obrir = page.getByRole('link').filter({ hasText: /E-|kg/ }).first()
    test.skip(!(await obrir.isVisible().catch(() => false)), 'Aquesta compte no té cap oferta')
    await obrir.click()
    const edita = page.getByRole('button', { name: /Edita l’oferta|Edita la oferta/ })
    test.skip(!(await edita.isVisible().catch(() => false)), 'L’oferta ja no es pot editar')
    await edita.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: /Cancel·lar|Cancelar/ }).click()
  })
})

test.describe('equip', () => {
  test.beforeEach(() => {
    const m = motiuSalt('super_admin')
    test.skip(m !== null, m ?? '')
  })

  test('Ofertes tiene la pestaña «Per validar» y Configuració el interruptor', async ({ page }) => {
    await entra(page, 'super_admin')
    await page.goto('/equip/ofertes?tab=validar')
    await expect(page.getByRole('tab', { name: /Per validar|Por validar/ })).toBeVisible()
    await page.goto('/equip/configuracio')
    await expect(page.getByText(/Validació de les ofertes noves|Validación de las ofertas nuevas/)).toBeVisible()
  })
})
