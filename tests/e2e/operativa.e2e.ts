// A4 (`20270521100000`): la Operativa del productor — lugares de recogida con días, franjas y
// UN principal; envases y comercialización en su ficha — y la oferta nueva que nace con lo que
// la ficha propone (lugar principal, su franja y el formato del envase habitual), marcado.
// Solo contra el CLON LOCAL y solo en escritorio (edita la ficha de la cuenta de prueba).

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, productorDe, sql, tria } from './ajuda'

test.describe.configure({ mode: 'serial' })

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Edita la fitxa de prova compartida: només a escriptori')
})

const ALIAS_A = 'E2E A4 Magatzem'
const ALIAS_B = 'E2E A4 Camp'

test('el productor añade dos lugares, con días y franja, y cambia el principal', async ({ page }) => {
  const prod = productorDe('productor')
  sql(`delete from productor_ubicaciones where productor_id = '${prod}' and alias like 'E2E A4 %'
         and not exists (select 1 from excedentes e where e.ubicacion_id = productor_ubicaciones.id)`)
  sql(`update productor_ubicaciones set alias = alias || ' (vell)' where productor_id = '${prod}' and alias like 'E2E A4 %'`)
  await entra(page, 'productor')
  await page.goto('/organitzacio?pestanya=operativa')

  for (const alias of [ALIAS_A, ALIAS_B]) {
    await page.getByRole('button', { name: /Afegir un lloc nou|Añadir un lugar nuevo/ }).first().click()
    await page.locator('#org-lloc-nom').fill(alias)
    if (alias === ALIAS_B) {
      // Días: lunes y miércoles; una franja de 08:00 a 12:00.
      await page.getByRole('button', { name: /^dl$|^lu$/ }).click()
      await page.getByRole('button', { name: /^dc$|^mi$/ }).click()
      await page.getByRole('button', { name: /Afegeix una franja|Añade una franja/ }).click()
      const franja = page.locator('#org-lloc-franja-0')
      await tria(franja.getByRole('combobox').nth(0), '08')
      await tria(franja.getByRole('combobox').nth(2), '12')
    }
    await page.getByRole('button', { name: /^Desar el lloc$|^Guardar el lugar$/ }).click()
    await expect(page.getByText(alias).first()).toBeVisible()
  }
  const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and alias = '${ALIAS_B}'`)
  expect(sql(`select array_to_string(dies_setmana, ',') || '|' || (franges -> 0 ->> 'inici') || '-' || (franges -> 0 ->> 'fi')
              from productor_ubicaciones where id = '${b}'`)).toBe('1,3|08:00-12:00')
  // Siempre UN principal por productor (índice único parcial).
  expect(sql(`select count(*) from productor_ubicaciones where productor_id = '${prod}' and es_principal`)).toBe('1')

  // «Fes-lo principal» sobre el segundo: pasa a ser el único principal.
  const filaB = page.locator('li, div').filter({ hasText: ALIAS_B }).filter({ has: page.getByRole('button', { name: /Fes-lo principal|Hazlo principal/ }) }).last()
  await filaB.getByRole('button', { name: /Fes-lo principal|Hazlo principal/ }).click()
  await expect(page.getByText(/és ara el lloc principal|es ahora el lugar principal/).first()).toBeVisible()
  expect(sql(`select es_principal from productor_ubicaciones where id = '${b}'`)).toBe('t')
  expect(sql(`select count(*) from productor_ubicaciones where productor_id = '${prod}' and es_principal`)).toBe('1')
})

test('el productor marca envases y canales en su Operativa y se guardan en la ficha', async ({ page }) => {
  const prod = productorDe('productor')
  sql(`update productores set envasos_habituals = null, canals_comercials = null where id = '${prod}'`)
  await entra(page, 'productor')
  await page.goto('/organitzacio?pestanya=operativa')
  await page.locator('[aria-labelledby$="-envasos_habituals-l"]').getByRole('button', { name: /^Caixes$|^Cajas$/ }).click()
  await page.locator('[aria-labelledby$="-canals_comercials-l"]').getByRole('button', { name: /^Venda directa$|^Venta directa$/ }).click()
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Desat|Guardado|desat/i).first()).toBeVisible()
  expect(sql(`select array_to_string(envasos_habituals, ',') || '|' || array_to_string(canals_comercials, ',')
              from productores where id = '${prod}'`)).toBe('caixes|venda_directa')
})

test('la oferta nueva nace con el lugar principal, su franja y el formato del envase', async ({ page }) => {
  const prod = productorDe('productor')
  const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  await entra(page, 'productor')
  // Sin borrador: la precarga solo se aplica a un formulario vacío.
  await page.evaluate((p) => { try { localStorage.removeItem(`redestina-oferta-esborrany:${p}`) } catch { /* */ } }, prod)
  const resposta = page.waitForResponse((r) => r.url().includes('/crear-oferta/campos') && r.request().method() === 'GET')
  await page.goto('/productor/ofertes/nova')
  const cos = await (await resposta).json() as { predeterminats?: { ubicacio: string | null; horari: unknown; format_entrega: string | null } }
  expect(cos.predeterminats).toEqual({ ubicacio: b, horari: { inici: '08:00', fi: '12:00' }, format_entrega: 'caixes' })

  // El borrador que guarda el formulario ya lleva lo propuesto.
  await expect.poll(async () => page.evaluate((p) => {
    try { return JSON.parse(localStorage.getItem(`redestina-oferta-esborrany:${p}`) ?? 'null')?.datos ?? null } catch { return null }
  }, prod)).toMatchObject({ ubicacio: b, horari: { inici: '08:00', fi: '12:00' }, format_entrega: 'caixes' })
  await page.evaluate((p) => { try { localStorage.removeItem(`redestina-oferta-esborrany:${p}`) } catch { /* */ } }, prod)
})
