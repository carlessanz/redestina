// Ofertas MULTIPRODUCTO (plan DIC 26, fase 6a, proceso 3.3), contra el CLON. Lo que se afirma, en
// orden (modo serie):
//
//   1. Alta ASISTIDA con tres productos («Afegir un altre producte» dos veces): nacen TRES ofertas
//      con el mismo `disponibilitat_id`, cada una con su `E-…`; el detalle de la primera enseña el
//      bloque «Disponibilitat multiproducte» con las hermanas (enlaces) y el mensaje único con el
//      enlace `/receptor/mercat?disponibilitat=<id>`, y el envío a entidades por el grupo.
//   2. El listado del equipo: el distintivo «Multiproducte · 3» en cada una de las tres filas.
//   3. Un ESBORRANY de dos productos (productor): se guarda con `productes[]`, se lista con su
//      distintivo y, al reabrirlo, el segundo producto vuelve a su fila.
//   4. Un solo producto sigue igual: sin `disponibilitat_id` y sin bloque de grupo.
//   5. El alta con tres productos a 360 px: sin desbordamiento horizontal (captura).
//
// Limpia lo que crea: las ofertas publicadas, canceladas; el esborrany, borrado.
//
//   E2E_CLON=1 E2E_ESCRIU=1 npx playwright test tests/e2e/multiproducte-alta.e2e.ts --project escriptori
//   (con E2E_CAPTURES=<carpeta>, una captura por paso)

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { join } from 'node:path'
import { asseguraConveniVigent, entra, motiuSaltClon, productorDe, sql, triaCercador } from './ajuda'

test.describe.configure({ mode: 'serial' })

const OFERTANT = 'productor'
const marca = Date.now()
const OBS_GRUP = `[E2E] multiproducte ${marca}`
const OBS_UN = `[E2E] un producte ${marca}`
const OBS_ESB = `[E2E] esborrany multiproducte ${marca}`
const inici = new Date().toISOString()

let disponibilitat = ''
const creades: string[] = []
let esborrany = ''

async function captura(page: Page, nom: string) {
  const dir = process.env.E2E_CAPTURES
  if (dir) await page.screenshot({ path: join(dir, `multiproducte-${nom}.png`), fullPage: true })
}

/** El alta a medias en el navegador (lo que el propio formulario guarda al escribir). */
async function preparaAlta(page: Page, prod: string, obs: string, extra: Record<string, unknown> = {}) {
  const lloc = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  expect(lloc, 'la ofertante necesita un lugar principal').toMatch(/^[0-9a-f-]{36}$/)
  await page.evaluate(([k, l, o, e]) => {
    localStorage.setItem(k as string, JSON.stringify({
      datos: {
        familia: 'Horta Fruit', producte: 'Carbassa', producte_al_camp: 'no', kg: 120, format_entrega: 'caixes',
        retorn: 'No', ubicacio: l, horari: { inici: '08:00', fi: '13:00' }, disponible_fins: '31/12/2027',
        modalitat: ['donacio'], causa: 'C4.2', observacions: o, ...(e as Record<string, unknown>),
      },
      pas: 0, pasMaxim: 99, costTocat: true, proposats: [], canviaLloc: false, desat: Date.now(),
    }))
  }, [`redestina-oferta-esborrany:${prod}`, lloc, obs, extra] as const)
}

/** Añade una fila de producto y la rellena. */
async function afegeix(form: Locator, i: number, producte: string, kg: string) {
  await form.getByTestId('afegeix-producte').click()
  await triaCercador(form.locator(`#of-mp-${i}-producte`), producte, producte)
  await form.locator(`#of-mp-${i}-kg`).fill(kg)
}

/** ¿Algún elemento de la página es más ancho que su caja? (las siete reglas de móvil, §2). */
async function desbordaments(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const doc = document.documentElement
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`DOC ${doc.scrollWidth}>${doc.clientWidth}`)
    const form = document.querySelector('[data-testid="formulari-oferta"]')
    for (const el of Array.from(form?.querySelectorAll('*') ?? [])) {
      const h = el as HTMLElement
      const r = h.getBoundingClientRect()
      if (r.width > 0 && r.right > doc.clientWidth + 1) {
        out.push(`${h.tagName.toLowerCase()}${h.id ? `#${h.id}` : ''}.${String(h.className).slice(0, 40)} right=${Math.round(r.right)}`)
      }
    }
    return out.slice(0, 10)
  })
}

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin', OFERTANT) || info.project.name !== 'escriptori') return
  if (process.env.E2E_ESCRIU !== '1') return
  asseguraConveniVigent('productor', productorDe(OFERTANT))
})

test.afterAll(() => {
  if (motiuSaltClon('super_admin', OFERTANT) || process.env.E2E_ESCRIU !== '1') return
  // Lo publicado, cancelado (no se borra: la numeración `E-…` es de la fila); el esborrany, fuera.
  const ids = [...creades]
  if (ids.length) sql(`update excedentes set estado = 'cancelada' where id in (${ids.map((i) => `'${i}'`).join(',')}) and estado <> 'cancelada'`)
  if (esborrany) sql(`delete from excedentes where id = '${esborrany}' and estado = 'esborrany'`)
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', OFERTANT)
  test.skip(m !== null, m ?? '')
  test.skip(process.env.E2E_ESCRIU !== '1', 'Escriu al clon: només amb E2E_ESCRIU=1')
  test.skip(info.project.name !== 'escriptori', 'Escriu ofertes de prova: només a escriptori')
})

test('1. alta assistida amb tres productes: tres ofertes, un grup, el bloc i el missatge únic', async ({ page }) => {
  const prod = productorDe(OFERTANT)
  await entra(page, 'super_admin')
  await preparaAlta(page, prod, OBS_GRUP)
  await page.goto('/equip/ofertes')
  await page.getByRole('button', { name: /^Nova oferta assistida$|^Nueva oferta asistida$/ }).first().click()
  const dlg = page.getByRole('dialog')
  await triaCercador(dlg.locator('#dnoa-productor'), sql(`select coalesce(empresa, name) from productores where id = '${prod}'`), prod)
  const form = dlg.getByTestId('formulari-oferta')
  await expect(form).toBeVisible({ timeout: 30_000 })
  await expect(form.locator('#of-kg')).toHaveValue('120')

  await afegeix(form, 0, 'Pebrot', '80')
  await afegeix(form, 1, 'Albergínia', '45')
  await expect(form.getByTestId('fila-producte')).toHaveCount(2)
  // Repetir el primero no se puede: se marca la fila y no se publica.
  await triaCercador(form.locator('#of-mp-1-producte'), 'Carbassa', 'Carbassa')
  await dlg.getByRole('button', { name: /^Publicar oferta$/ }).click()
  await expect(form.getByTestId('error-fila-producte')).toBeVisible()
  await captura(page, '1-repetit')
  await triaCercador(form.locator('#of-mp-1-producte'), 'Albergínia', 'Albergínia')
  await captura(page, '1-alta')
  await dlg.getByRole('button', { name: /^Publicar oferta$/ }).click()

  const meves = `from excedentes where productor_id = '${prod}' and observacions = '${OBS_GRUP}' and created_at >= '${inici}'`
  await expect.poll(() => sql(`select count(*) ${meves}`), { timeout: 20_000 }).toBe('3')
  creades.push(...sql(`select id ${meves}`).split('\n'))
  // Un grupo: el mismo `disponibilitat_id`, cada una su `E-…` y su producto; publicadas (asistida).
  expect(sql(`select count(distinct disponibilitat_id) || '|' || count(disponibilitat_id) ${meves}`)).toBe('1|3')
  disponibilitat = sql(`select distinct disponibilitat_id ${meves}`)
  expect(sql(`select string_agg(producto || ':' || kg_total::int || ':' || estado || ':' || (id_excedente like 'E-%'), ',' order by producto) ${meves}`))
    .toBe('Albergínia:45:publicada:true,Carbassa:120:publicada:true,Pebrot:80:publicada:true')
  expect(sql(`select codi from disponibilitats where id = '${disponibilitat}'`)).toMatch(/^D-\d{6}-[A-Z]{3}-\d+$/)

  // Va al detalle de la primera: el bloque con las tres y el mensaje único con un solo enlace.
  await expect(page).toHaveURL(/\/equip\/ofertes\/[0-9a-f-]{36}/, { timeout: 30_000 })
  const bloc = page.getByTestId('bloc-disponibilitat')
  await expect(bloc).toBeVisible({ timeout: 30_000 })
  await expect(bloc.getByTestId('germana')).toHaveCount(3)
  await expect(bloc.getByTestId('enllac-germana')).toHaveCount(2)
  await expect(bloc.getByTestId('codi-disponibilitat')).toHaveText(/^D-/)
  const text = bloc.getByTestId('text-disponibilitat')
  await expect(text).toContainText('OFERTA DISPONIBLE · 3 PRODUCTES')
  await expect(text).toContainText(`/receptor/mercat?disponibilitat=${disponibilitat}`)
  await expect(text).not.toContainText('E-')
  // La ficha ofrece compartir el grupo; el envío por grupo, con el ranking unido.
  await expect(page.getByTestId('comparteix-grup')).toBeVisible()
  await bloc.getByTestId('enviament-disponibilitat').locator('summary').click()
  await expect(bloc.getByTestId('enviament-disponibilitat').getByText(/Calculant|Calculando/)).toHaveCount(0, { timeout: 30_000 })
  await captura(page, '1-detall')

  // Una hermana lleva a su propio detalle, con el mismo bloque.
  await bloc.getByTestId('enllac-germana').first().click()
  await expect(page.getByTestId('bloc-disponibilitat').getByTestId('germana')).toHaveCount(3, { timeout: 30_000 })
})

test('2. el llistat: cada oferta a la seva fila, amb «Multiproducte · 3»', async ({ page }) => {
  test.skip(creades.length !== 3, 'depèn del pas 1')
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes')
  // Las tres, buscadas por su `E-…` (el buscador lo encuentra aunque ya no haya columna).
  for (const id of creades) {
    const ref = sql(`select id_excedente from excedentes where id = '${id}'`)
    await page.getByRole('searchbox').fill(ref)
    const fila = page.locator('tbody tr')
    await expect(fila).toHaveCount(1, { timeout: 30_000 })
    await expect(fila.getByTestId('badge-multiproducte')).toHaveText(/Multiproducte · 3|Multiproducto · 3/)
  }
  await captura(page, '2-llistat')
})

test('3. esborrany de dos productes: es desa amb productes[] i es recupera', async ({ page }) => {
  const prod = productorDe(OFERTANT)
  await entra(page, OFERTANT)
  // La red local ya guarda la forma del cuerpo (`productes[]`): al abrir, el segundo va a su fila.
  await preparaAlta(page, prod, OBS_ESB, {
    familia: undefined, producte: undefined, kg: undefined,
    productes: [{ producte: 'Poma', kg: 60, familia: 'Fruita Dolça' }, { producte: 'Pera', kg: 40, varietat: 'Conference' }],
  })
  await page.goto('/productor/ofertes/nova')
  const form = page.getByTestId('formulari-oferta')
  await expect(form.getByTestId('fila-producte')).toHaveCount(1, { timeout: 30_000 })
  await expect(form.locator('#of-kg')).toHaveValue('60')
  await expect(form.locator('#of-mp-0-varietat')).toHaveValue('Conference')
  await page.getByTestId('desa-esborrany').click()
  await page.waitForURL(/\/productor\/ofertes\?tab=esborranys/)

  const meu = `from excedentes where productor_id = '${prod}' and estado = 'esborrany' and dades_esborrany->>'observacions' = '${OBS_ESB}'`
  await expect.poll(() => sql(`select count(*) ${meu}`), { timeout: 15_000 }).toBe('1')
  esborrany = sql(`select id ${meu}`)
  expect(sql(`select producto || '|' || jsonb_array_length(dades_esborrany->'productes') || '|'
      || (dades_esborrany->'productes'->1->>'producte') || '|' || coalesce(disponibilitat_id::text, '-') from excedentes where id = '${esborrany}'`))
    .toBe('Poma|2|Pera|-')
  // En la lista, una fila con su distintivo.
  await expect(page.getByTestId('fila-esborrany').filter({ has: page.getByTestId('badge-multiproducte') }).first())
    .toBeVisible()

  // Reabierto: el primero en los campos de siempre y el segundo en su fila.
  await page.evaluate((k) => localStorage.removeItem(k), `redestina-oferta-esborrany:${prod}`)
  await page.goto(`/productor/ofertes/${esborrany}`)
  await expect(page.locator('#of-kg')).toHaveValue('60', { timeout: 30_000 })
  await expect(page.getByTestId('fila-producte')).toHaveCount(1)
  await expect(page.locator('#of-mp-0-kg')).toHaveValue('40')
  await expect(page.locator('#of-mp-0-varietat')).toHaveValue('Conference')
  await captura(page, '3-esborrany')
})

test('4. un sol producte: com sempre, sense grup', async ({ page }) => {
  const prod = productorDe(OFERTANT)
  await entra(page, 'super_admin')
  await preparaAlta(page, prod, OBS_UN)
  await page.goto('/equip/ofertes')
  await page.getByRole('button', { name: /^Nova oferta assistida$|^Nueva oferta asistida$/ }).first().click()
  const dlg = page.getByRole('dialog')
  await triaCercador(dlg.locator('#dnoa-productor'), sql(`select coalesce(empresa, name) from productores where id = '${prod}'`), prod)
  const form = dlg.getByTestId('formulari-oferta')
  await expect(form).toBeVisible({ timeout: 30_000 })
  // Una fila añadida y dejada en blanco no cuenta.
  await form.getByTestId('afegeix-producte').click()
  await dlg.getByRole('button', { name: /^Publicar oferta$/ }).click()
  const meva = `from excedentes where productor_id = '${prod}' and observacions = '${OBS_UN}' and created_at >= '${inici}'`
  await expect.poll(() => sql(`select count(*) ${meva}`), { timeout: 20_000 }).toBe('1')
  const id = sql(`select id ${meva}`)
  creades.push(id)
  expect(sql(`select coalesce(disponibilitat_id::text, '-') ${meva}`)).toBe('-')
  await expect(page).toHaveURL(new RegExp(`/equip/ofertes/${id}`), { timeout: 30_000 })
  await expect(page.getByTestId('fitxa-oferta')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('bloc-disponibilitat')).toHaveCount(0)
  await expect(page.getByTestId('fitxa-grup')).toHaveCount(0)
})

test('5. l’alta amb tres productes a 360 px: sense desbordament', async ({ page }) => {
  const prod = productorDe(OFERTANT)
  await page.setViewportSize({ width: 360, height: 780 })
  await entra(page, OFERTANT)
  await preparaAlta(page, prod, `[E2E] 360 ${marca}`, {
    producte: undefined, kg: undefined, familia: undefined, modalitat: ['donacio', 'venda'], preu_minim: 0.5,
    productes: [
      { producte: 'Carbassa', kg: 120, familia: 'Horta Fruit' },
      { producte: 'Pebrot', kg: 80, caixes: 4, preu_minim: 0.9 },
      { producte: 'Albergínia', kg: 45, varietat: 'Llistada de Gandia' },
    ],
  })
  await page.goto('/productor/ofertes/nova')
  const form = page.getByTestId('formulari-oferta')
  await expect(form.getByTestId('fila-producte')).toHaveCount(2, { timeout: 30_000 })
  await form.getByTestId('fila-producte').first().scrollIntoViewIfNeeded()
  expect(await desbordaments(page)).toEqual([])
  await captura(page, '5-360')
  // No se guarda nada: se limpia la red local.
  await page.evaluate((k) => localStorage.removeItem(k), `redestina-oferta-esborrany:${prod}`)
})
