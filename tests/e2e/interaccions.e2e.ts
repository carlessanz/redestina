// «Interaccions i seguiment» (proceso 1.2 del cliente, 25-11-2026): la sección del equipo
// `/equip/interaccions`, sobre las MISMAS filas de `notes_internes` que el hilo de la ficha.
// Solo contra el CLON LOCAL y en escritorio (la barra de filtros de móvil va plegada). Crea su
// propia entidad productora con un lugar de recogida y la borra al acabar con
// `borrar_ficha_completa()` (las interacciones se van con la organización: `on delete cascade`).
//
// Lo que se afirma, en orden (modo serie):
//   1. La Dinamitzadora (cuenta `equip`) añade desde la sección, en el diálogo «Afegir
//      interacció», una interacción de Prospecció con próximo paso y previsión de producto (en uno
//      de los lugares de la ficha). Sale en Pendents y en Previsions; en la base, todo en su sitio.
//   2. Los filtros por tipo y por producto: la otra interacción (sin previsión) no pasa el de
//      producto, y un tipo que no tiene deja la tabla vacía.
//   3. «Fet» con resultado: la fila sale de Pendents y en el Historial lleva su resultado y el
//      estado «Fet»; la ficha de la entidad (Gestió interna) enseña lo mismo.

import { expect, test, type Page } from '@playwright/test'
import { entra, motiuSaltClon, sql, sqlCom, tria, triaCercador } from './ajuda'

test.describe.configure({ mode: 'serial' })

const LLETRES = 'TRWAGMYFPDXBNJZSQVHLCKE'
const dni = (n: number) => { const s = String(Math.floor(n) % 1e8).padStart(8, '0'); return s + LLETRES[Number(s) % 23] }

let marca = ''
let nom = ''
let prod = ''
let org = ''
let lloc = ''

/** `AAAA-MM-DD` de dentro de `n` días (negativo = pasado), en la hora local del navegador. */
function dinsDe(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** «dd/mm/aaaa» de un `AAAA-MM-DD`. */
const dmy = (s: string) => s.split('-').reverse().join('/')

/** La sección en una vista, con el buscador acotado a lo de esta prueba. */
async function obre(page: Page, vista: 'pendents' | 'historial' | 'previsions') {
  await page.goto(vista === 'pendents' ? '/equip/interaccions' : `/equip/interaccions?vista=${vista}`)
  await expect(page.getByTestId('int-cerca')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('int-cerca').fill(marca)
}

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'equip')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'la barra de filtros de móvil va plegada: se prueba en escritorio')
})

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin', 'equip') !== null || info.project.name !== 'escriptori') return
  const ara = Date.now()
  marca = `ixs${ara}`
  nom = `E2E Interaccions ${marca}`
  ;[prod, org] = sql(`insert into productores (name, empresa, nif, razon_social, es_test)
    values ('Persona E2E', '${nom}', '${dni(ara / 17)}', '${nom} SL', true)
    returning id || '|' || organizacion_id`).split('\n')[0].split('|')
  lloc = sql(`insert into productor_ubicaciones (productor_id, alias, municipio)
    values ('${prod}', 'Finca E2E ${marca}', 'Vic') returning id`).split('\n')[0]
  // Otra interacción de la misma entidad, sin próximo paso ni previsión (la que el filtro de
  // producto tiene que dejar fuera).
  sqlCom('equip', `select afegir_nota_interna('${org}', 'visita', 'E2E ${marca} visita sense previsio', now() - interval '2 days', 'operativa')`)
})

test.afterAll(() => {
  if (!marca) return
  if (prod) sql(`select borrar_ficha_completa('productor', '${prod}', true)`)
  sql(`delete from notes_internes where text like 'E2E ${marca}%'`)
})

test('afegir des de la secció: surt a Pendents i a Previsions', async ({ page }) => {
  await entra(page, 'equip')
  await obre(page, 'pendents')
  await expect(page.getByTestId('int-buit')).toBeVisible({ timeout: 20_000 })

  await page.getByTestId('int-afegir').click()
  const dialeg = page.getByTestId('int-dialeg')
  await expect(dialeg).toBeVisible()
  await triaCercador(dialeg.locator('#int-nova-org'), nom, org)
  await tria(dialeg.locator('#int-nova-tipus'), 'prospeccio')
  await tria(dialeg.locator('#int-nova-canal'), 'whatsapp')
  await dialeg.locator('#int-nova-text').fill(`E2E ${marca} primera trucada`)
  await dialeg.locator('#int-nova-accio').fill(`Tornar a trucar ${marca}`)
  await dialeg.locator('#int-nova-accio-data').fill(dinsDe(3))
  // La previsión: plegada hasta que se abre.
  await expect(dialeg.locator('#int-nova-kg')).toHaveCount(0)
  await dialeg.getByRole('button', { name: /Previsió de producte|Previsión de producto/ }).click()
  await triaCercador(dialeg.locator('#int-nova-producte'), 'Tomàq', 'Tomàquet')
  await dialeg.locator('#int-nova-kg').fill('250,5')
  await dialeg.locator('#int-nova-previsio-data').fill(dinsDe(10))
  await tria(dialeg.locator('#int-nova-lloc'), lloc)
  await dialeg.getByTestId('nota-desa').click()
  await expect(dialeg).toBeHidden()

  // En la base: la misma fila que leería la ficha.
  expect(sql(`select tipus || '|' || canal || '|' || propera_data || '|' || previsio_producte || '|' || previsio_kg
                || '|' || previsio_data || '|' || previsio_ubicacio_id || '|' || (responsable = autor)
                from notes_internes where text = 'E2E ${marca} primera trucada'`))
    .toBe(`prospeccio|whatsapp|${dinsDe(3)}|Tomàquet|250.5|${dinsDe(10)}|${lloc}|true`)

  // Pendents: la fila, con su fecha de seguimiento y el próximo paso.
  const files = page.getByTestId('int-fila')
  await expect(files).toHaveCount(1, { timeout: 20_000 })
  await expect(files.first()).toContainText(nom)
  await expect(files.first().getByTestId('int-comentari')).toHaveText(`Tornar a trucar ${marca}`)
  await expect(files.first().getByTestId('int-estat')).toHaveAttribute('data-estat', 'pendent')
  await expect(files.first().getByTestId('int-estat')).toHaveText(dmy(dinsDe(3)))
  await expect(files.first()).toContainText(/Prospecció|Prospección/)

  // Previsions: producto, kg y el lugar de la ficha.
  await page.getByTestId('int-tab-previsions').click()
  await expect(page).toHaveURL(/vista=previsions/)
  await expect(files).toHaveCount(1, { timeout: 20_000 })
  await expect(files.first().getByTestId('int-producte')).toHaveText('Tomàquet')
  await expect(files.first()).toContainText(dmy(dinsDe(10)))
  await expect(files.first()).toContainText(/250,5|250\.5/)
  await expect(files.first()).toContainText(`Finca E2E ${marca}`)
})

test('filtres per tipus i per producte', async ({ page }) => {
  await entra(page, 'equip')
  await obre(page, 'historial')
  const files = page.getByTestId('int-fila')
  await expect(files).toHaveCount(2, { timeout: 20_000 })

  // Producto: solo la que lleva previsión.
  await tria(page.locator('#int-producte'), 'Tomàquet')
  await expect(files).toHaveCount(1)
  await expect(files.first()).toContainText('primera trucada')
  await tria(page.locator('#int-producte'), { index: 0 }) // «Tots»
  await expect(files).toHaveCount(2)

  // Tipo: Prospecció → una; Incidència → ninguna.
  await tria(page.locator('#int-tipus'), 'prospeccio')
  await expect(files).toHaveCount(1)
  await expect(files.first()).toContainText('primera trucada')
  await tria(page.locator('#int-tipus'), 'incidencia')
  await expect(page.getByTestId('int-buit')).toBeVisible()
  await expect(files).toHaveCount(0)
})

test('«Fet» amb resultat: passa a l’Historial i la fitxa ho ensenya igual', async ({ page }) => {
  await entra(page, 'equip')
  await obre(page, 'pendents')
  const files = page.getByTestId('int-fila')
  await expect(files).toHaveCount(1, { timeout: 20_000 })
  await files.first().getByTestId('int-fet').locator('input').click()
  const dialeg = page.getByRole('dialog')
  await expect(dialeg).toContainText(`Tornar a trucar ${marca}`)
  await dialeg.locator('#dialeg-motiu').fill(`Resultat ${marca}: vindran dilluns`)
  await dialeg.getByRole('button', { name: /Marca com a fet|Marcar como hecho/ }).click()
  await expect(page.getByTestId('int-buit')).toBeVisible({ timeout: 20_000 })
  expect(sql(`select (seguiment_fet_at is not null) || '|' || resultat from notes_internes
                where text = 'E2E ${marca} primera trucada'`)).toBe(`true|Resultat ${marca}: vindran dilluns`)

  // Historial: con su resultado y el estado «Fet».
  await page.getByTestId('int-tab-historial').click()
  const fila = files.filter({ hasText: 'primera trucada' })
  await expect(fila).toHaveCount(1, { timeout: 20_000 })
  await expect(fila.getByTestId('int-resultat')).toContainText(`Resultat ${marca}: vindran dilluns`)
  await expect(fila.getByTestId('int-estat')).toHaveAttribute('data-estat', 'fet')

  // La fila lleva a la ficha, en «Gestió interna»: el mismo resultado y la misma previsión.
  await fila.getByRole('link', { name: nom }).click()
  await expect(page).toHaveURL(new RegExp(`/equip/entitats/${org}\\?pestanya=intern`))
  const bloc = page.getByTestId('notes-internes')
  const nota = bloc.getByTestId('nota').filter({ hasText: 'primera trucada' })
  await expect(nota).toHaveCount(1, { timeout: 20_000 })
  await expect(nota.getByTestId('nota-resultat')).toContainText(`Resultat ${marca}: vindran dilluns`)
  await expect(nota.getByTestId('nota-previsio')).toContainText('Tomàquet')
  await expect(nota.getByTestId('nota-previsio')).toContainText(`Finca E2E ${marca}`)
  await expect(nota.getByTestId('nota-tipus')).toHaveText(/Prospecció|Prospección/)
  // Y ya no hay seguimientos pendientes en la ficha.
  await expect(bloc.getByTestId('seguiment')).toHaveCount(0)
})
