// El listado de ofertas del equipo (`/equip/ofertes`). Desde la fase 4 (25-11-2026): la
// DISPONIBILIDAD como columna y como orden por defecto (las vencidas sin resolver arriba, después
// la que se acaba antes y sin fecha al final), sin la referencia (`E-…`, que vive en el detalle y
// el buscador sigue encontrando), el ofertante con más presencia, los filtros de tipus d'operació
// y modalidad prevista, y el badge «Espigolada». SIN receptores en el listado (van en el detalle).
// Solo lectura: corre contra el clon o contra producción.
//
//   E2E_CLON=1 npx playwright test tests/e2e/ofertes-llistat.e2e.ts

import { expect, test, type Page } from '@playwright/test'
import { entra, motiuSalt, tria } from './ajuda'

test.beforeEach(() => {
  const m = motiuSalt('super_admin')
  test.skip(m !== null, m ?? '')
})

/** «dd/mm/aaaa» → «aaaa-mm-dd»; «—» (sin fecha) → ''. */
const iso = (d: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(d.trim()) ? d.trim().split('/').reverse().join('-') : '')

/** Las fechas de la columna «Disponibilitat», con la marca de vencida sin resolver. */
async function disponibilitats(page: Page): Promise<{ data: string; vencuda: boolean }[]> {
  const celles = page.getByTestId('oferta-disponibilitat')
  const n = await celles.count()
  const out: { data: string; vencuda: boolean }[] = []
  for (let i = 0; i < n; i++) {
    const c = celles.nth(i)
    out.push({ data: iso(await c.innerText()), vencuda: (await c.getAttribute('data-vencuda')) !== null })
  }
  return out
}

test('cada fila dice hasta cuándo, quién la hizo, cuánto había y cuánto se ha colocado', async ({ page }, info) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes')
  const files = page.locator('tbody tr')
  await expect(files.first()).toBeVisible()
  const primera = files.first()

  // La cantidad inicial siempre a la vista; la referencia ya no se pinta en ninguna fila.
  await expect(primera.getByTestId('oferta-kg-oferts')).toContainText(/kg (oferts|ofrecidos)/)
  await expect(page.locator('tbody')).not.toContainText(/\bE-(\d{6}|E2E)-/)

  if (info.project.name === 'escriptori') {
    const caps = await page.locator('thead th:visible').allInnerTexts()
    expect(caps.some((c) => /^(Disponibilitat|Disponibilidad)/.test(c.trim()))).toBe(true)
    expect(caps.join('|')).not.toMatch(/Referència|Referencia|Receptor|Entitat receptora|Entidad receptora/i)
    await expect(primera.getByTestId('oferta-disponibilitat')).toBeVisible()
    await expect(primera.getByTestId('oferta-kg-sortida')).toContainText(/\d.* de .*\d.* kg (amb sortida|con salida)/)
    await expect(primera.getByTestId('oferta-kg-falten')).toContainText(/falten|faltan|complet/)
    await expect(primera.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^\d+$/)
  } else {
    // En móvil la disponibilidad va bajo el producto.
    await expect(primera).toContainText(/Disponible (fins|hasta)|Sense data de disponibilitat|Sin fecha de disponibilidad/)
  }

  // Sin scroll horizontal, en cualquier ancho.
  const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(desborda).toBe(false)
})

test('por defecto, por disponibilidad: las vencidas sin resolver arriba; la cabecera invierte', async ({ page }, info) => {
  test.skip(info.project.name !== 'escriptori', 'La cabecera ordenable solo está desde `md`')
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes?tab=esborranys')
  await expect(page).toHaveURL(/tab=esborranys/)
  await page.goto('/equip/ofertes')
  await expect(page.locator('tbody tr').first()).toBeVisible()

  const boto = page.getByTestId('ordre-disponibilitat')
  const cap = boto.locator('xpath=ancestor::th')
  await expect(cap).toHaveAttribute('aria-sort', 'ascending')

  const asc = await disponibilitats(page)
  // Las vencidas sin resolver forman el primer tramo; después, las fechas en orden ascendente y
  // las que no tienen fecha, al final.
  const primeraNoVencuda = asc.findIndex((x) => !x.vencuda)
  const tram = primeraNoVencuda === -1 ? [] : asc.slice(primeraNoVencuda)
  expect(tram.every((x) => !x.vencuda)).toBe(true)
  const ambData = tram.filter((x) => x.data).map((x) => x.data)
  expect(ambData).toEqual([...ambData].sort())
  const primeraSense = tram.findIndex((x) => !x.data)
  if (primeraSense !== -1) expect(tram.slice(primeraSense).every((x) => !x.data)).toBe(true)

  // Un clic: la más lejana arriba (sin fecha, siempre al final).
  await boto.click()
  await expect(cap).toHaveAttribute('aria-sort', 'descending')
  const desc = (await disponibilitats(page)).filter((x) => x.data).map((x) => x.data)
  expect(desc).toEqual([...desc].sort().reverse())
  await boto.click()
  await expect(cap).toHaveAttribute('aria-sort', 'ascending')

  // El Històric enseña la misma columna, pero su orden es el de cierre: la cabecera no ordena.
  await page.getByRole('tab', { name: /Històric|Histórico/ }).click()
  await expect(page).toHaveURL(/tab=historic/)
  await expect(page.locator('thead th:visible').filter({ hasText: /Disponibilitat|Disponibilidad/ }).first()).toBeVisible()
  await expect(page.getByTestId('ordre-disponibilitat')).toHaveCount(0)
})

test('el buscador sigue encontrando una oferta por su referencia', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes')
  const primera = page.locator('tbody tr').first()
  await expect(primera).toBeVisible()
  // La referencia de la primera fila, leída del detalle (el listado ya no la enseña).
  await primera.locator('button, a').filter({ hasText: /\S/ }).first().click()
  await expect(page).toHaveURL(/\/equip\/ofertes\/[0-9a-f-]{36}/)
  // El título del detalle es la referencia (`<h1><code>E-…</code></h1>`).
  const ref = (await page.locator('h1 code').first().textContent().catch(() => null))?.trim()
  test.skip(!ref, 'La primera oferta no té referència visible (esborrany)')
  await page.goBack()
  await page.getByRole('searchbox').fill(ref!)
  await expect(page.locator('tbody tr')).toHaveCount(1)
})

test('el filtro de tipus d\'operació deja solo las espigolades, con su badge', async ({ page }, info) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes')
  await expect(page.locator('tbody tr').first()).toBeVisible()
  if (info.project.name === 'mobil') await page.getByRole('button', { name: /^Filtres|^Filtros/ }).click()
  const control = page.locator('#off-tipus_operacio')
  await control.click()
  const hiHa = await page.getByRole('listbox').locator('[data-valor="espigolada"]').count()
  await page.keyboard.press('Escape')
  test.skip(hiHa === 0, 'Cap oferta activa d\'espigolada al clon')
  await tria(control, 'espigolada')
  const files = page.locator('tbody tr')
  await expect(files.first()).toBeVisible()
  const n = await files.count()
  await expect(page.getByTestId('oferta-espigolada')).toHaveCount(n)
  // Y la modalidad prevista es un desplegable con su nombre nuevo.
  await expect(page.locator('#off-modalitat')).toBeVisible()
  await page.getByRole('button', { name: /Neteja els filtres|Quitar los filtros/ }).click()
})

test('clicar el título abre el detalle de la oferta, donde van los receptores', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes')
  const primera = page.locator('tbody tr').first()
  await expect(primera).toBeVisible()
  await primera.locator('button, a').filter({ hasText: /\S/ }).first().click()
  await expect(page).toHaveURL(/\/equip\/ofertes\/[0-9a-f-]{36}/)
})
