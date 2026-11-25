// «Registrar operació realitzada» (proceso 3.7, fase 5 del plan de noviembre de 2026).
//
//   1. El super_admin abre el diálogo desde Ofertes, rellena una DONACIÓN de hace diez días a dos
//      entidades sociales y deja kilos sin asignar: la interfaz lo dice y no registra nada.
//   2. Añade el sobrante a un destino final y registra: toast con el `E-…`, la oferta queda
//      `cerrada` con «Registrada a posteriori», cada entidad con su ENT y su REC de esa fecha, las
//      dos salidas en Entrades i sortides con esa fecha y el distintivo, y NINGÚN aviso nuevo.
//   3. Quien no es del equipo no ve el botón; el Dinamitzador, sí.
//   4. A 360 px el diálogo no desborda.
//
// Solo contra el CLON LOCAL y en escritorio: emite numeración legal de albaranes (ENT/REC). Todas
// las fichas son `es_test` y el modo test está encendido.
//
//   E2E_CLON=1 E2E_ESCRIU=1 npx playwright test tests/e2e/operacio-realitzada.e2e.ts --project escriptori
//   (con E2E_CAPTURES=<carpeta>, una captura por paso)

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join } from 'node:path'
import {
  asseguraConveniVigent, entidadDe, entra, motiuSaltClon, productorDe, sql, tria, triaCercador,
} from './ajuda'

test.describe.configure({ mode: 'serial' })

const OFERTANT = 'productor'
const SOCIAL = 'receptor-social'
/** La segunda entidad social de prueba (la del doble rol): el clon solo tiene esas dos activas. */
const DOBLE_ROL = 'Doble rol de prova'
const BOTO = /^Registrar operació realitzada$|^Registrar operación realizada$/
const inici = new Date().toISOString()

/** Hace diez días, en Madrid (`AAAA-MM-DD`). */
const DATA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' })
  .format(new Date(Date.now() - 10 * 86_400_000))
const AVUI = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const DATA_ES = DATA.split('-').reverse().join('/')

let prod = ''
let social = ''
let dobleRol = ''
let oferta = ''
let codi = ''

async function captura(page: Page, nom: string) {
  const dir = process.env.E2E_CAPTURES
  if (dir) await page.screenshot({ path: join(dir, `operacio-${nom}.png`), fullPage: true })
}

/** Abre el diálogo desde Ofertes. */
async function obreDialeg(page: Page) {
  await page.goto('/equip/ofertes')
  await page.getByRole('button', { name: BOTO }).click()
  const dlg = page.getByTestId('dialeg-operacio-realitzada')
  await expect(dlg).toBeVisible()
  return dlg
}

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin', OFERTANT, SOCIAL) || info.project.name !== 'escriptori') return
  if (process.env.E2E_ESCRIU !== '1') return
  prod = productorDe(OFERTANT)
  social = entidadDe(SOCIAL)
  dobleRol = sql(`select id from entidades where nombre = '${DOBLE_ROL}' and activo limit 1`)
  // Las tres partes, con su Conveni de col·laboració vigente (sin él, `sense_conveni`).
  asseguraConveniVigent('productor', prod)
  asseguraConveniVigent('entidad', social)
  if (dobleRol) asseguraConveniVigent('entidad', dobleRol)
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', OFERTANT, SOCIAL, 'equip')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Emet numeració: una sola passada, a escriptori')
})

test('1-2. el super_admin registra una donació de fa deu dies a dues entitats, amb sobrant a un destí', async ({ page }) => {
  test.skip(process.env.E2E_ESCRIU !== '1', 'Escriu al clon: només amb E2E_ESCRIU=1')
  test.skip(DATA.slice(0, 4) !== AVUI.slice(0, 4), 'Fa deu dies era un altre exercici')
  expect(dobleRol, 'cal la segona entitat social de prova').toMatch(/^[0-9a-f-]{36}$/)
  const avisosAbans = sql(`select count(*) from avisos where created_at >= '${inici}'`)

  await entra(page, 'super_admin')
  const dlg = await obreDialeg(page)
  await triaCercador(dlg.locator('#opr-productor'), 'Ofertant de prova', prod)
  await expect(dlg.locator('#opr-producte')).toBeEnabled({ timeout: 30_000 })
  await triaCercador(dlg.locator('#opr-producte'), 'Tomàquet', 'Tomàquet')
  await dlg.locator('#opr-kg').fill('100')
  await dlg.locator('#opr-data').fill(DATA)
  // Donació és la modalitat per defecte. Dues entitats: 60 + 30.
  await triaCercador(dlg.locator('#opr-ent-0'), 'Entitat social receptora', social)
  await dlg.locator('#opr-ent-kg-0').fill('60')
  await dlg.getByRole('button', { name: /^Afegeix una entitat$|^Añadir una entidad$/ }).click()
  await triaCercador(dlg.locator('#opr-ent-1'), 'Doble rol', dobleRol)
  await dlg.locator('#opr-ent-kg-1').fill('30')

  // Queden 10 kg: la interfície ho diu i no registra res.
  await expect(dlg.getByTestId('opr-queden')).toContainText(/10 kg/)
  await dlg.getByTestId('opr-registra').click()
  await expect(dlg.getByTestId('opr-error')).toContainText(/queden kg per assignar|quedan kg por asignar/)
  expect(sql(`select count(*) from excedentes where productor_id = '${prod}' and origen = 'registre' and created_at >= '${inici}'`)).toBe('0')
  await captura(page, '1-no-quadra')

  // El sobrant, a compostatge (el botó proposa els 10 kg que queden).
  await dlg.getByRole('button', { name: /^Afegeix un destí final$|^Añadir un destino final$/ }).click()
  await expect(dlg.locator('#opr-desti-kg-0')).toHaveValue('10')
  await tria(dlg.locator('#opr-desti-0'), 'compostatge')
  await expect(dlg.getByTestId('opr-queden')).toContainText(/Tots els kg|Todos los kg/)
  await captura(page, '2-quadra')
  await dlg.getByTestId('opr-registra').click()

  const meva = `from excedentes where productor_id = '${prod}' and origen = 'registre' and created_at >= '${inici}'`
  await expect.poll(() => sql(`select count(*) ${meva}`), { timeout: 20_000 }).toBe('1')
  oferta = sql(`select id ${meva}`)
  codi = sql(`select id_excedente from excedentes where id = '${oferta}'`)
  // El `E-…` porta la data de l'operació.
  expect(codi).toMatch(new RegExp(`^E-${DATA.slice(2).replaceAll('-', '')}-`))
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: codi })
  await expect(toast).toBeVisible()
  await captura(page, '3-toast')

  // La base: tancada, dues canalitzacions amb la data real, ENT i REC per a cadascuna, el destí i
  // el text per compartir. Cap avís nou.
  expect(sql(`select estado || '|' || kg_total::numeric(12,2) || '|' || disponible_hasta from excedentes where id = '${oferta}'`))
    .toBe(`cerrada|100.00|${DATA}`)
  expect(sql(`select count(*) from excedentes where id = '${oferta}' and texto_oferta like '%PRODUCTE: Tomàquet%'`)).toBe('1')
  expect(sql(`select string_agg(distinct (data_hora_recollida at time zone 'Europe/Madrid')::date::text, ',')
                from canalizaciones where excedente_id = '${oferta}'`)).toBe(DATA)
  expect(sql(`select count(*) from canalizaciones where excedente_id = '${oferta}' and kg_conciliados is not null`)).toBe('2')
  expect(sql(`select string_agg(a.tipo || ':' || a.estado, ',' order by a.tipo, a.estado)
                from albaranes a join canalizaciones c on c.id = a.canalizacion_id
               where c.excedente_id = '${oferta}'`)).toBe('ENT:conciliado,ENT:conciliado,REC:conciliado,REC:conciliado')
  // La fecha de la recogida del albarán es la de la operación (`emitido_at` es el sello de cuándo
  // se emitió, hoy) y el ejercicio, el suyo.
  expect(sql(`select string_agg(distinct ((a.recogida->>'fecha_hora')::timestamptz at time zone 'Europe/Madrid')::date::text || '|' || a.ejercicio, ',')
                from albaranes a join canalizaciones c on c.id = a.canalizacion_id
               where c.excedente_id = '${oferta}'`)).toBe(`${DATA}|${DATA.slice(0, 4)}`)
  expect(sql(`select count(*) from excedente_destins where excedente_id = '${oferta}' and kg = 10`)).toBe('1')
  expect(sql(`select count(*) from avisos where created_at >= '${inici}'`)).toBe(avisosAbans)

  // El toast porta a la fitxa: tancada i amb el distintiu.
  await toast.getByRole('button', { name: /^Obre l’oferta$|^Abrir la oferta$/ }).click()
  await expect(page).toHaveURL(new RegExp(`/equip/ofertes/${oferta}`))
  await expect(page.getByTestId('badge-registre-posteriori')).toBeVisible({ timeout: 30_000 })
  await captura(page, '4-fitxa')

  // Entrades i sortides: les dues sortides, amb la data i el distintiu.
  await page.goto('/equip/entrades-sortides')
  await page.getByTestId('es-cerca').fill(codi)
  const files = page.getByTestId('es-fila')
  await expect(files).toHaveCount(2, { timeout: 30_000 })
  for (const f of await files.all()) {
    await expect(f).toContainText(DATA_ES)
    await expect(f.getByTestId('es-registre-posteriori')).toBeVisible()
  }
  await captura(page, '5-entrades-sortides')

  // I a Ofertes › Històric, amb el distintiu a la fila.
  await page.goto('/equip/ofertes?tab=historic')
  await page.getByRole('searchbox').first().fill('Tomàquet')
  await expect(page.getByTestId('oferta-registre-posteriori').first()).toBeVisible({ timeout: 30_000 })
})

test('3. qui no és de l’equip no veu el botó; el Dinamitzador, sí', async ({ page }) => {
  for (const rol of [OFERTANT, SOCIAL]) {
    await page.context().clearCookies()
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await entra(page, rol)
    await page.goto('/equip/ofertes')
    // El `RoleGuard` el porta al seu panell: el botó no hi és enlloc.
    await expect(page).not.toHaveURL(/\/equip\/ofertes/, { timeout: 30_000 })
    await expect(page.getByRole('button', { name: BOTO })).toHaveCount(0)
  }
  await page.context().clearCookies()
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await entra(page, 'equip')
  await page.goto('/equip/ofertes')
  await expect(page.getByRole('button', { name: BOTO })).toBeVisible({ timeout: 30_000 })
  await page.goto('/equip/canalitzacio')
  await expect(page.getByRole('button', { name: BOTO })).toBeVisible({ timeout: 30_000 })
})

test('4. a 360 px el diàleg no desborda', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.setViewportSize({ width: 360, height: 780 })
  const dlg = await obreDialeg(page)
  await triaCercador(dlg.locator('#opr-productor'), 'Ofertant de prova', productorDe(OFERTANT))
  await expect(dlg.locator('#opr-producte')).toBeEnabled({ timeout: 30_000 })
  await dlg.getByRole('button', { name: /^Afegeix una entitat$|^Añadir una entidad$/ }).click()
  await dlg.getByRole('button', { name: /^Afegeix un destí final$|^Añadir un destino final$/ }).click()
  await tria(dlg.locator('#opr-modalitat'), 'venda')
  // Per geometria: el contingut del diàleg fa scroll i un fill que l'eixampla no desborda ell mateix.
  const desborda = await dlg.evaluate((el) => [el, ...el.querySelectorAll('*')]
    .filter((n) => {
      const r = n.getBoundingClientRect()
      return r.width > 0 && r.right > window.innerWidth + 1
    })
    .map((n) => `${n.tagName}.${(n as HTMLElement).className}`.slice(0, 120)))
  expect(desborda, `Desborden a 360 px:\n${desborda.join('\n')}`).toEqual([])
  const [sw, cw] = await dlg.evaluate((el) => [el.scrollWidth, el.clientWidth])
  expect(sw).toBeLessThanOrEqual(cw)
  await captura(page, '6-dialeg-360')
  await dlg.getByTestId('opr-registra').scrollIntoViewIfNeeded()
  await captura(page, '6-dialeg-360-peu')
})
