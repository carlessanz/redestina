// Fase 8 de la revisión del cliente del 08-10-2026: el tablero del equipo.
// Lectura, contra el clon (compara con la base) y solo en escritorio.

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sql } from './ajuda'

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'El tauler de l’equip és d’escriptori')
})

test('los indicadores cambian con el periodo y cuadran con la base', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/tauler')
  const bloc = page.getByTestId('indicadors-periode')
  await expect(bloc).toBeVisible()
  const any = new Date().getFullYear()
  const canalsAny = JSON.parse(sql(`select kpis_equip('${any}-01-01', '${any}-12-31')`)).canalitzacions
  await expect(bloc.getByText(/Canalitzacions|Canalizaciones/).locator('..')).toContainText(String(canalsAny))
  await bloc.locator('#kp-periode').selectOption('mes')
  const avui = sql(`select to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM')`)
  const fi = sql(`select to_char((date_trunc('month', now() at time zone 'Europe/Madrid') + interval '1 month - 1 day')::date, 'YYYY-MM-DD')`)
  const canalsMes = JSON.parse(sql(`select kpis_equip('${avui}-01', '${fi}')`)).canalitzacions
  await expect(bloc.getByText(/Canalitzacions|Canalizaciones/).locator('..')).toContainText(String(canalsMes))
})

test('el badge de Ofertes suma las que esperan validación, cambios o envío', async ({ page }) => {
  const files = JSON.parse(sql(`select json_agg(json_build_object('cua', cua, 'n', n)) from pendents_equip()`)) as { cua: string; n: number }[]
  const n = (c: string) => files.find((f) => f.cua === c)?.n ?? 0
  const esperat = n('ofertes_per_validar') + n('ofertes_modificades') + n('ofertes_sense_enviar')
  await entra(page, 'super_admin')
  await page.goto('/equip/tauler')
  // El badge vive en el `li` del menú lateral, al lado del enlace.
  const item = page.locator('[data-sidebar="menu-item"]', { has: page.locator('a[href="/equip/ofertes"]') }).first()
  if (esperat > 0) await expect(item).toContainText(String(esperat))
})

test('la canalización guiada dice la acción pendiente de cada lote', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/canalitzacio')
  await page.waitForLoadState('networkidle')
  test.skip(await page.getByRole('table').count() === 0, 'Cap lot en curs al clon')
  await expect(page.getByRole('row').first()).toContainText(/Acció pendent|Acción pendiente/)
  // Y cada lote dice qué toca (o «Res pendent»).
  await expect(page.getByRole('row').nth(1).getByRole('cell').nth(3)).not.toBeEmpty()
})
