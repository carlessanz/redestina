// Fase 10 de la revisión del cliente del 08-10-2026: «El meu impacte».
// Lectura contra el CLON LOCAL: la cifra de la pantalla es la que da la base para esa cuenta.

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sqlCom } from './ajuda'

const RECEPTOR = 'receptor-carles'
const any = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(new Date())
const kgText = (n: number) => `${new Intl.NumberFormat('ca-ES', { maximumFractionDigits: 0 }).format(n)} kg`

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', RECEPTOR, 'equip')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Lectura de xifres: només a escriptori')
})

test('el receptor ve sus kilos, el CO₂e y el aviso de factores provisionales', async ({ page }) => {
  const kg = Number(sqlCom(RECEPTOR, `select (impacte_receptor('${any}-01-01', '${any}-12-31') ->> 'kg_total')`))
  await entra(page, RECEPTOR)
  await page.goto('/receptor/impacte')
  const bloc = page.getByTestId('impacte-receptor')
  await expect(bloc.getByText(kgText(kg), { exact: true }).first()).toBeVisible()
  await expect(bloc.getByText(/CO₂ equivalent evitat|CO₂ equivalente evitado/)).toBeVisible()
  await expect(bloc.getByText(/factors d’impacte .* són provisionals|factores de impacto .* son provisionales/)).toBeVisible()
  // Al receptor nunca se le enseña el valor en € (es la valoración del donante).
  await expect(bloc.getByText(/Valor del producte donat|Valor del producto donado/)).toHaveCount(0)
})

test('el productor lo ve en su inicio', async ({ page }) => {
  const kg = Number(sqlCom('productor', `select (impacte_productor('${any}-01-01', '${any}-12-31') ->> 'kg_total')`))
  await entra(page, 'productor')
  await page.goto('/productor/inici')
  await expect(page.getByTestId('impacte-productor').getByText(kgText(kg), { exact: true }).first()).toBeVisible()
})

test('el equipo ve el de toda la plataforma en el tablero', async ({ page }) => {
  const kgGlobal = Number(sqlCom('equip', `select (impacte_global('${any}-01-01', '${any}-12-31') ->> 'kg_total')`))
  await entra(page, 'equip')
  await page.goto('/equip/tauler')
  await expect(page.getByTestId('impacte-global').getByText(kgText(kgGlobal), { exact: true }).first()).toBeVisible()
})
