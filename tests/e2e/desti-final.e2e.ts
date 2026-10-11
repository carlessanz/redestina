// Fase 1 de la revisión del cliente del 08-10-2026: el destino final de los kilos.
//
// Solo contra el CLON LOCAL (`E2E_CLON=1`): crea una oferta de prueba por SQL, la deja
// vencida, dispara el job y comprueba que el productor tiene que decir qué pasó con el
// producto —y que al decirlo la oferta se cierra—. Contra producción se salta.
//
//   E2E_CLON=1 npx playwright test tests/e2e/desti-final.e2e.ts

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, productorDe, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

let ofertaId = ''

test.beforeAll(() => {
  if (motiuSaltClon('productor', 'super_admin')) return
  const productor = productorDe('productor')
  // Origen `asistido`: así no pasa por validación (la oferta ya está «publicada»). Vencida
  // hace tres días: el job corta en `current_date - 1`, o sea anteayer.
  ofertaId = sql(`insert into excedentes
      (id_excedente, productor_id, producto, variedad, kg_total, estado, origen, modalitat,
       modalitats, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-DESTI-' || floor(extract(epoch from now()))::text, '${productor}', 'Lima',
            null, 150, 'publicada', 'asistido', 'donacio', '{donacio}', current_date - 3,
            '[E2E] destí final', '[E2E]')
    returning id`).split('\n')[0]
})

test.afterAll(() => {
  if (!ofertaId) return
  // Se deja cerrada: es historia de una prueba, no hace falta borrarla (y `limpiar-e2e.ts`
  // solo cancela las abiertas). Lo que sí se retira es su aviso, para no ensuciar la campana.
  sql(`delete from avisos where objecte_id = '${ofertaId}'`)
})

test.beforeEach(() => {
  const m = motiuSaltClon('productor', 'super_admin')
  test.skip(m !== null, m ?? '')
})

test('el job la deja «sense sortida» y avisa una sola vez', () => {
  sql('select marcar_excedentes_vencidos()')
  sql('select marcar_excedentes_vencidos()')
  expect(sql(`select estado from excedentes where id = '${ofertaId}'`)).toBe('no_colocada')
  expect(sql(`select count(*) from avisos where objecte_id = '${ofertaId}' and tipus = 'oferta_sense_desti'`)).toBe('1')
})

test('el productor ve la banda y registra 100 kg de venda + 50 de donació', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto(`/productor/ofertes/${ofertaId}`)
  await expect(page.getByText(/encara no té un destí registrat|todavía no tiene un destino registrado/)).toBeVisible()

  const files = page.locator('#desti')
  // Primera fila: venda externa, 100 kg, a una empresa.
  await files.locator('select').first().selectOption('venda')
  await files.getByLabel(/^Kg$/).first().fill('100')
  await files.getByLabel(/A qui|A quién/).first().fill('Empresa E2E')
  // Segunda fila: donació externa, 50 kg.
  await files.getByRole('button', { name: /Afegeix un altre destí|Añade otro destino/ }).click()
  await files.locator('select').nth(1).selectOption('donacio')
  await files.getByLabel(/^Kg$/).nth(1).fill('50')
  await expect(files.getByText(/falten 0 kg|faltan 0 kg/)).toBeVisible()
  // Captura para revisar a ojo (va a `test-results/`, fuera de git).
  await files.screenshot({ path: `test-results/desti-final-${test.info().project.name}.png` })

  await files.getByRole('button', { name: /Desa el destí|Guarda el destino/ }).click()
  await expect(page.getByText(/l’oferta queda tancada|la oferta queda cerrada/)).toBeVisible()

  expect(sql(`select estado from excedentes where id = '${ofertaId}'`)).toBe('cerrada')
  expect(sql(`select string_agg(desti_codi || ':' || kg, ',' order by desti_codi) from excedente_destins where excedente_id = '${ofertaId}'`))
    .toBe('donacio:50,venda:100')
})

test('ya cerrada, la oferta sale como «Tancada amb destí» y sin el código E-…', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto(`/productor/ofertes/${ofertaId}`)
  await expect(page.getByText(/Tancada amb destí|Cerrada con destino/).first()).toBeVisible()
  await expect(page.getByText(/E-E2E-DESTI/)).toHaveCount(0)
})

test('el equipo ve los destinos registrados en el detalle de la oferta', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${ofertaId}`)
  await expect(page.locator('#desti').getByText(/Empresa E2E/)).toBeVisible()
})
