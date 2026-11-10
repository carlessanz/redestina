// El importador de entidades desde Excel (super_admin, 06-11-2026), de punta a punta contra el
// CLON LOCAL: un `.xlsx` sintético con las cabeceras exactas de la exportación de Airtable →
// columnas reconocidas → revisión (nova, existent por NIF, dubtosa por correo, sin papel) →
// importar → resultado; el mismo fichero otra vez → todo «sense canvis»; y la plantilla
// descargada, subida tal cual, se reconoce entera. A 360 px, ningún paso desborda.
//
// Solo en el clon y con `E2E_ESCRIU=1` (crea fichas); solo en el proyecto de escritorio (el
// móvil se mide poniendo el viewport a 360 px dentro de la prueba). Las fichas creadas se
// llaman `TEST-IMP …` y se borran antes y después con `borrar_ficha_completa()`. La ficha
// existente es la de `TEST-ENT-SOCIAL` (NIF 65000772N) y la fila no le cambia nada; la dudosa
// comparte el correo de `TEST-ENT-OBRADOR` y se resuelve «crea'n una de nova», así que
// tampoco se toca.
//
// Plan 2 B3 (10-11-2026): la cuenta `equip` (un `tecnic`) exporta a Excel las fichas `TEST-IMP`
// de esta pasada desde Entitats (formato de la plantilla, desplegables, «ID Redestina»); el
// super_admin vuelve a subir ese fichero tal cual y todo sale «sense canvis».
//
// Plan 2 B4 (10-11-2026): la importación ACTUALIZA (D11). Sobre ese fichero exportado se cambian dos
// celdas (la persona de contacto de la fila con NIF y la dirección de la fila sin NIF, que se identifica
// por «ID Redestina») y se vacía el correo de la primera: la Revisió enseña exactamente esos dos
// cambios, la base los aplica, la celda vacía no borra nada y subirlo otra vez = todo «sense canvis».
// Y una fila con un NIF que ya existe y otro nombre actualiza esa ficha: nunca crea otra.
//
// Capturas: con `E2E_CAPTURES=<carpeta>`, de los tres pasos a 360 px y en escritorio.

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate' // la usa write-excel-file por dentro
import readXlsxFile from 'read-excel-file/node'
import writeXlsxFile from 'write-excel-file/node'
import { entra, motiuSaltClon, sql, sqlCom, tria } from './ajuda'

test.describe.configure({ mode: 'serial' })

const AIRTABLE = [
  'Nombre comercial', 'Persona de contacto', 'Entidad', 'Cargo (contacto)', 'Correo (contacto)', 'Número fijo', 'Cargo',
  'Email general', 'Tipo de entidad', 'Actividad', 'Contactos', 'Dirección fiscal', 'Municipio', 'Provincia', 'Área (intern)',
  'Registro excedente', 'Provincia (from Municipio)', 'Código postal', 'Nombre fiscal', 'Forma jurídica', 'NIF', 'Web',
  'Número de trabajadores',
]
const SUELTES = ['Observaciones', 'Contacto principal', 'Responsable interno', 'Rol']

const marca = Date.now().toString(36).slice(-5)
let dir = ''
let fitxer = ''
let nifNou = ''
let telNou = ''
let fixNou = ''
let exportat = ''
let modificat = ''

const LLETRES = 'TRWAGMYFPDXBNJZSQVHLCKE'
const enUs = (col: string, v: string) => sql(`select count(*) from (
    select ${col === 'nif' ? 'nif' : 'phone'} as v from productores
    union all select ${col === 'nif' ? 'nif' : 'telefono'} from entidades) x where v = '${v}'`) !== '0'

/** Un DNI válido que nadie tiene en el clon. */
function dniLliure(): string {
  for (;;) {
    const n = 90_000_000 + Math.floor(Math.random() * 9_999_999)
    const nif = `${n}${LLETRES[n % 23]}`
    if (!enUs('nif', nif)) return nif
  }
}
/** Un teléfono que no tiene nadie (`productores.phone` es único): `6…` móvil, `93…` fijo. */
function telefonLliure(prefix: string): string {
  for (;;) {
    const t = `${prefix}${String(Math.floor(Math.random() * 10 ** (9 - prefix.length))).padStart(9 - prefix.length, '0')}`
    if (!enUs('tel', `34${t}`)) return t
  }
}

/** Borra todas las fichas `TEST-IMP …` (de esta pasada o de una que se quedó a medias). */
function neteja() {
  const orgs = sql(`select distinct organizacion_id from (
      select organizacion_id from productores where empresa like 'TEST-IMP %'
      union all select organizacion_id from entidades where nombre like 'TEST-IMP %') x where organizacion_id is not null`)
  for (const org of orgs.split('\n').filter(Boolean)) {
    const p = sql(`select coalesce((select id::text from productores where organizacion_id = '${org}'), '')`)
    const e = sql(`select coalesce((select id::text from entidades where organizacion_id = '${org}'), '')`)
    if (p) sqlCom('superadmin', `select borrar_ficha_completa('productor', '${p}', true)`)
    else if (e) sqlCom('superadmin', `select borrar_ficha_completa('entidad', '${e}', true)`)
  }
}

test.beforeAll(async ({}, info) => {
  if (motiuSaltClon('superadmin') || info.project.name !== 'escriptori' || process.env.E2E_ESCRIU !== '1') return
  neteja()
  nifNou = dniLliure()
  telNou = telefonLliure('6')
  fixNou = telefonLliure('93')
  dir = mkdtempSync(join(tmpdir(), 'importa-entitats-'))
  fitxer = join(dir, `airtable-${marca}.xlsx`)
  const fila = (v: Record<string, string | number>) => AIRTABLE.map((h) => v[h] ?? null)
  const data = [
    AIRTABLE,
    // 2 · nova amb NIF: ofertant («Productor individual»), CP numérico, dos teléfonos en una
    //     celda, el correo dentro de un texto y «No disponible».
    fila({
      'Nombre comercial': `TEST-IMP Hort ${marca}`, 'Persona de contacto': 'Anna Prova', 'Cargo (contacto)': 'Gerent',
      'Número fijo': `${fixNou} / ${telNou}`, 'Email general': `contacto: hort-${marca}@exemple.invalid`,
      'Tipo de entidad': 'Productor individual', Actividad: 'Productor agrícola', Contactos: 'recAAA, recBBB',
      'Dirección fiscal': 'Carrer Major, 1', Municipio: 'Malgrat de Mar', Provincia: 'Barcelona', 'Área (intern)': 'Maresme',
      'Código postal': 8380, 'Forma jurídica': 'Autónomo', NIF: nifNou, Web: 'No disponible',
    }),
    // 3 · nova sense NIF: receptora social.
    fila({ 'Nombre comercial': `TEST-IMP Menjador ${marca}`, 'Tipo de entidad': 'Entidad social', Municipio: 'Mataró', 'Forma jurídica': 'Asociación' }),
    // 4 · existent per NIF (la de TEST-ENT-SOCIAL), sin nada que rellenar.
    fila({ 'Nombre comercial': 'Menjador Social de Prova', 'Tipo de entidad': 'Entidad social', NIF: '65000772N' }),
    // 5 · dubtosa: sin NIF y con el correo de TEST-ENT-OBRADOR.
    fila({ 'Nombre comercial': `TEST-IMP Dubtosa ${marca}`, 'Tipo de entidad': 'Entidad social', 'Correo (contacto)': 'hola+recowner-obrador@carlessanz.com' }),
    // 6 · sin papel deducible («Empresa»): la revisión obliga a elegirlo.
    fila({ 'Nombre comercial': `TEST-IMP Empresa ${marca}`, 'Tipo de entidad': 'Empresa', 'Registro excedente': '' }),
    [],
    // 8 · las cabeceras sueltas sin datos del Excel real (columnas Y:AB, sin cabecera arriba).
    [...AIRTABLE.map(() => null), null, ...SUELTES],
  ]
  await writeXlsxFile([{ sheet: 'Hoja1', data }]).toFile(fitxer)
})

test.afterAll(() => {
  if (!dir) return
  neteja()
  // Y el registro de los lotes de esta pasada (las fichas ya no están: sus filas quedaron sin ficha).
  sql(`delete from importacions_entitats where fitxer_nom in ('airtable-${marca}.xlsx', 'exportacio-${marca}.xlsx',
      'modificat-${marca}.xlsx', 'nif-existent-${marca}.xlsx')`)
  rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('superadmin')
  test.skip(m !== null, m ?? '')
  test.skip(process.env.E2E_ESCRIU !== '1', 'Crea fitxes: cal E2E_ESCRIU=1')
  test.skip(info.project.name !== 'escriptori', 'Crea fitxes al clon: només a escriptori')
})

/** Lo que sale por la derecha a este ancho: el documento, `main` y, por geometría, sus hijos. */
async function desbordaments(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const de = document.documentElement
    if (de.scrollWidth > de.clientWidth) out.push(`document ${de.scrollWidth}>${de.clientWidth}`)
    const main = document.querySelector('main')
    if (main && main.scrollWidth > main.clientWidth) out.push(`main ${main.scrollWidth}>${main.clientWidth}`)
    for (const n of [...(main?.querySelectorAll('*') ?? [])]) {
      const r = n.getBoundingClientRect()
      if (r.width > 0 && r.right > window.innerWidth + 1) out.push(`${n.tagName}.${(n as HTMLElement).className}`.slice(0, 120))
    }
    return out.slice(0, 10)
  })
}

/** A 360 px no desborda (y, con `E2E_CAPTURES`, las dos capturas del paso). */
async function mesura(page: Page, nom: string) {
  await page.setViewportSize({ width: 360, height: 780 })
  await expect.poll(() => desbordaments(page), { message: `${nom} a 360 px` }).toEqual([])
  const capt = process.env.E2E_CAPTURES
  if (capt) await page.screenshot({ path: join(capt, `importa-${nom}-360.png`), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 800 })
  if (capt) {
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(capt, `importa-${nom}-escriptori.png`), fullPage: true })
  }
}

const fila = (page: Page, n: number) => page.locator(`[data-testid="ie-fila"][data-fila="${n}"]`)

async function puja(page: Page, cami: string) {
  await expect(page.getByTestId('ie-pas1')).toBeVisible()
  await page.getByTestId('ie-input').setInputFiles(cami)
  await expect(page.getByTestId('ie-mapa')).toBeVisible()
}

async function revisa(page: Page) {
  await page.getByTestId('ie-continua').click()
  await expect(page.getByTestId('ie-pas2')).toBeVisible()
  await expect(page.getByTestId('ie-fila')).toHaveCount(5, { timeout: 20_000 })
}

/** La fila 6 no tiene papel: se marca «Receptor» (en escritorio, la casilla de su columna). */
async function donaPaper(page: Page) {
  await expect(page.getByTestId('ie-importa')).toBeDisabled()
  await expect(page.getByTestId('ie-sense-paper')).toBeVisible()
  await fila(page, 6).locator('td').nth(1).getByText(/^Receptor$/).click()
  await expect(page.getByTestId('ie-sense-paper')).toHaveCount(0)
  await expect(page.getByTestId('ie-importa')).toBeEnabled({ timeout: 20_000 })
}

async function importa(page: Page) {
  await page.getByTestId('ie-importa').click()
  await page.getByRole('dialog').getByRole('button', { name: /^Importa$|^Importar$/ }).click()
  await expect(page.getByTestId('ie-pas3')).toBeVisible({ timeout: 30_000 })
}

test('Airtable → revisió → importa: 4 creades inactives, la existent sense canvis, i a 360 px no desborda', async ({ page }) => {
  await entra(page, 'superadmin')
  await page.goto('/equip/entitats')
  await page.getByTestId('el-importa').click()
  await expect(page).toHaveURL(/\/equip\/entitats\/importa$/)

  // Paso 1: columnas reconocidas e ignoradas; ninguna obligatoria falta.
  await puja(page, fitxer)
  await expect(page.getByTestId('ie-falten')).toHaveCount(0)
  await expect(page.getByTestId('ie-nfiles')).toHaveText(/5/)
  await expect(page.getByTestId('ie-reconegudes').locator('li')).toHaveCount(20)
  await expect(page.getByTestId('ie-ignorades')).toContainText('Contactos')
  await mesura(page, 'pas1')

  // Paso 2: lo que dice la base de cada fila.
  await revisa(page)
  await expect(fila(page, 2)).toHaveAttribute('data-estat', 'nova')
  await expect(fila(page, 3)).toHaveAttribute('data-estat', 'nova')
  await expect(fila(page, 4)).toHaveAttribute('data-estat', 'existent')
  await expect(fila(page, 5)).toHaveAttribute('data-estat', 'dubtosa')
  await expect(fila(page, 6)).toHaveAttribute('data-estat', 'error')
  await donaPaper(page)
  await expect(fila(page, 6)).toHaveAttribute('data-estat', 'nova', { timeout: 20_000 })
  // La dudosa, abierta de entrada: «crea'n una de nova».
  await tria(page.getByTestId('ie-decisio'), 'crear')
  await expect(page.getByTestId('ie-importa')).toBeEnabled({ timeout: 20_000 })
  await mesura(page, 'pas2')

  // Paso 3.
  await importa(page)
  await expect(page.getByTestId('ie-xifra-creades')).toContainText('4')
  await expect(page.getByTestId('ie-xifra-sense_canvis')).toContainText('1')
  await expect(page.getByTestId('ie-xifra-errors')).toContainText('0')
  await expect(page.locator('[data-testid="ie-res-fila"][data-fila="4"]')).toHaveAttribute('data-accio', 'sense_canvis')
  await mesura(page, 'pas3')

  // En la base: inactivas, con su papel, el CP con su cero, los teléfonos en E.164 y la nota.
  const prod = sql(`select activo || '|' || coalesce(nif,'') || '|' || codigo_postal || '|' || phone || '|' || coalesce(telefono_alt,'')
      || '|' || coalesce(email,'') || '|' || tipo_empresa || '|' || coalesce(municipio_ine,'') || '|' || (position('Càrrec: Gerent' in comentario) > 0)
    from productores where empresa = 'TEST-IMP Hort ${marca}'`)
  // El móvil delante (es el de WhatsApp) aunque en la celda venga detrás del fijo.
  expect(prod).toBe(`false|${nifNou}|08380|34${telNou}|34${fixNou}|hort-${marca}@exemple.invalid|autonom|08110|true`)
  expect(sql(`select activo || '|' || tipo_receptor || '|' || tipo_entidad from entidades where nombre = 'TEST-IMP Menjador ${marca}'`)).toBe('false|social|associacio')
  expect(sql(`select count(*) from entidades where nombre in ('TEST-IMP Dubtosa ${marca}', 'TEST-IMP Empresa ${marca}') and not activo`)).toBe('2')
  // La existente no se ha tocado.
  expect(sql(`select coalesce(comentarios, '<null>') from entidades where nif = '65000772N'`)).toBe('<null>')
})

test('el mateix fitxer una altra vegada: avisa que ja es va importar i tot surt «sense canvis»', async ({ page }) => {
  await entra(page, 'superadmin')
  await page.goto('/equip/entitats/importa')
  await puja(page, fitxer)
  await expect(page.getByTestId('ie-ja-importat')).toBeVisible()
  await revisa(page)
  for (const n of [2, 3, 4, 5]) await expect(fila(page, n)).toHaveAttribute('data-estat', 'existent')
  await donaPaper(page)
  await expect(fila(page, 6)).toHaveAttribute('data-estat', 'existent', { timeout: 20_000 })
  await importa(page)
  await expect(page.getByTestId('ie-xifra-sense_canvis')).toContainText('5')
  await expect(page.getByTestId('ie-xifra-creades')).toContainText('0')
  expect(sql(`select count(*) from entidades where nombre like 'TEST-IMP % ${marca}'`)).toBe('3')
})

test('la plantilla descarregada, pujada tal qual, es reconeix sencera', async ({ page }) => {
  await entra(page, 'superadmin')
  await page.goto('/equip/entitats/importa')
  await expect(page.getByTestId('ie-pas1')).toBeVisible()
  const [baixada] = await Promise.all([page.waitForEvent('download'), page.getByTestId('ie-plantilla').click()])
  const cami = join(dir, 'plantilla.xlsx')
  await baixada.saveAs(cami)
  // Plan 2 B2: desplegables en «Entitats» (seis listas, sin Comarca; siete con «Naturalesa», A5),
  // y el de Municipi con todos los municipios del catálogo del clon.
  const fulla1 = strFromU8(unzipSync(new Uint8Array(readFileSync(cami)))['xl/worksheets/sheet1.xml'])
  expect(fulla1).toContain('<dataValidations count="7">')
  expect(fulla1.indexOf('<dataValidations')).toBeGreaterThan(fulla1.indexOf('</sheetData>'))
  const nMunis = Number(sql('select count(*) from municipios'))
  expect(fulla1).toContain(`<formula1>Llistes!$G$2:$G$${1 + nMunis}</formula1>`)
  await puja(page, cami)
  await expect(page.getByTestId('ie-falten')).toHaveCount(0)
  await expect(page.getByTestId('ie-ignorades').locator('li')).toHaveCount(0)
  // B4: + «ID Redestina» y «Data d'alta a l'organització» (Z y AA); A5: + «Naturalesa» (AB).
  await expect(page.getByTestId('ie-reconegudes').locator('li')).toHaveCount(28)
  // Solo trae la fila de ejemplo, que se salta.
  await expect(page.getByTestId('ie-nfiles')).toHaveText(/^0 /)
})

test('B3: el tècnic exporta les files visibles amb el format de la plantilla (desplegables i «ID Redestina»)', async ({ page }) => {
  await entra(page, 'equip') // `tecnic` al clon: exporta (D10) però no importa
  await page.goto('/equip/entitats')
  await expect(page.getByTestId('el-exporta')).toBeVisible()
  await expect(page.getByTestId('el-importa')).toHaveCount(0)
  // Las cuatro de esta pasada (las importadas nacen «Potencial»).
  await page.getByRole('searchbox').fill('TEST-IMP')
  await tria(page.locator('#ent-estat'), 'potencial')
  await expect(page.getByTestId('entitat-fila')).toHaveCount(4)
  const [baixada] = await Promise.all([page.waitForEvent('download'), page.getByTestId('el-exporta').click()])
  expect(baixada.suggestedFilename()).toMatch(/^entitats-\d{4}-\d{2}-\d{2}\.xlsx$/)
  exportat = join(dir, `exportacio-${marca}.xlsx`)
  await baixada.saveAs(exportat)

  // El fichero: las columnas de la plantilla y las cuatro informativas detrás; una fila por
  // organización visible, con su id; las notas vacías; los seis desplegables de B2.
  const [entitats, instruccions, llistes] = await readXlsxFile(exportat)
  expect([entitats.sheet, instruccions.sheet, llistes.sheet]).toEqual(['Entitats', 'Instruccions', 'Llistes'])
  const cap = entitats.data[0].map(String)
  expect(cap.slice(0, 3)).toEqual(['Rol', 'Nom comercial', 'Raó social'])
  expect(cap.slice(-5)).toEqual(['ID Redestina', "Data d'alta a l'organització", 'Naturalesa', 'Estat CRM (ofertant)', 'Estat CRM (receptor)'])
  const files = entitats.data.slice(1).filter((r) => r.some((c) => c !== null))
  expect(files).toHaveLength(4)
  const iId = cap.indexOf('ID Redestina')
  const ids = sql(`select string_agg(organizacion_id::text, ',' order by organizacion_id) from (
      select organizacion_id from productores where empresa like 'TEST-IMP % ${marca}'
      union select organizacion_id from entidades where nombre like 'TEST-IMP % ${marca}') x`)
  expect(files.map((r) => String(r[iId])).sort().join(',')).toBe(ids)
  const iObs = cap.indexOf('Observacions')
  expect(files.every((r) => r[iObs] === null)).toBe(true)
  const iEstat = cap.indexOf('Estat CRM (receptor)')
  expect(files.filter((r) => r[iEstat] === 'Potencial')).toHaveLength(3)
  const fulla1 = strFromU8(unzipSync(new Uint8Array(readFileSync(exportat)))['xl/worksheets/sheet1.xml'])
  expect(fulla1).toContain('<dataValidations count="7">')
  expect(fulla1.indexOf('<dataValidations')).toBeGreaterThan(fulla1.indexOf('</sheetData>'))
})

test('B3: el fitxer exportat, pujat tal qual pel super_admin, surt tot «sense canvis»', async ({ page }) => {
  test.skip(!exportat, 'Cal la prova anterior (exportació)')
  const abans = sql(`select md5(string_agg(t, '|' order by t)) from (
      select row_to_json(p)::text as t from productores p where empresa like 'TEST-IMP % ${marca}'
      union all select row_to_json(e)::text from entidades e where nombre like 'TEST-IMP % ${marca}') x`)
  await entra(page, 'superadmin')
  await page.goto('/equip/entitats/importa')
  await puja(page, exportat)
  await expect(page.getByTestId('ie-falten')).toHaveCount(0)
  await expect(page.getByTestId('ie-nfiles')).toHaveText(/^4 /)
  // Desde B4, «ID Redestina» y la fecha de alta se importan, y desde A5 la naturalesa (28
  // reconocidas); solo las dos de «Estat CRM» se ignoran a propósito (P9).
  await expect(page.getByTestId('ie-reconegudes').locator('li')).toHaveCount(28)
  await expect(page.getByTestId('ie-ignorades').locator('li')).toHaveCount(2)
  await expect(page.getByTestId('ie-ignorades')).toContainText('Estat CRM')
  await page.getByTestId('ie-continua').click()
  await expect(page.getByTestId('ie-pas2')).toBeVisible()
  await expect(page.getByTestId('ie-fila')).toHaveCount(4, { timeout: 20_000 })
  for (const f of await page.getByTestId('ie-fila').all()) await expect(f).toHaveAttribute('data-estat', 'existent')
  await expect(page.getByTestId('ie-importa')).toBeEnabled({ timeout: 20_000 })
  await importa(page)
  await expect(page.getByTestId('ie-xifra-sense_canvis')).toContainText('4')
  await expect(page.getByTestId('ie-xifra-creades')).toContainText('0')
  await expect(page.getByTestId('ie-xifra-actualitzades')).toContainText('0')
  await expect(page.getByTestId('ie-xifra-errors')).toContainText('0')
  // Y en la base, ni un byte distinto en las fichas.
  expect(sql(`select md5(string_agg(t, '|' order by t)) from (
      select row_to_json(p)::text as t from productores p where empresa like 'TEST-IMP % ${marca}'
      union all select row_to_json(e)::text from entidades e where nombre like 'TEST-IMP % ${marca}') x`)).toBe(abans)
})

/** Los cambios que la Revisió enseña de una fila: `camp` de cada uno. */
async function canvisDe(page: Page, n: number): Promise<string[]> {
  return page.locator(`[data-testid="ie-canvis"][data-fila="${n}"] [data-testid="ie-canvi"]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-camp') ?? ''))
}

test('B4: el fitxer exportat amb dues cel·les canviades → la Revisió n\'ensenya exactament dues, la base les aplica i una cel·la buida no esborra res', async ({ page }) => {
  test.skip(!exportat, 'Cal la prova d\'exportació (B3)')
  const [entitats] = await readXlsxFile(exportat)
  const cap = entitats.data[0].map(String)
  const col = (h: string) => { const i = cap.indexOf(h); expect(i, h).toBeGreaterThanOrEqual(0); return i }
  const iNom = col('Nom comercial'), iPers = col('Persona de contacte'), iAdr = col('Adreça'), iCorreu = col('Correu')
  col('ID Redestina')
  const rows = entitats.data.map((r) => [...r])
  const iHort = rows.findIndex((r) => r[iNom] === `TEST-IMP Hort ${marca}`)
  const iMenj = rows.findIndex((r) => r[iNom] === `TEST-IMP Menjador ${marca}`)
  expect(iHort).toBeGreaterThan(0)
  expect(iMenj).toBeGreaterThan(0)
  expect(rows[iHort][iCorreu]).toBe(`hort-${marca}@exemple.invalid`)
  rows[iHort][iPers] = 'Berta Canviada'          // canvi 1 (fila amb NIF)
  rows[iHort][iCorreu] = null                    // buida: no ha d'esborrar el correu
  rows[iMenj][iAdr] = 'Carrer Nou, 7'            // canvi 2 (fila sense NIF: per «ID Redestina»)
  modificat = join(dir, `modificat-${marca}.xlsx`)
  const cella = (v: unknown) => v instanceof Date ? { value: v, type: Date, format: 'dd/mm/yyyy' }
    : v === null || v === undefined ? null : { value: String(v), type: String }
  await writeXlsxFile([{ sheet: 'Entitats', data: rows.map((r) => r.map(cella)) }]).toFile(modificat)
  const filaHort = iHort + 1 // número de fila del Excel (cabecera = 1)
  const filaMenj = iMenj + 1

  await entra(page, 'superadmin')
  await page.goto('/equip/entitats/importa')
  await puja(page, modificat)
  await page.getByTestId('ie-continua').click()
  await expect(page.getByTestId('ie-pas2')).toBeVisible()
  await expect(page.getByTestId('ie-fila')).toHaveCount(4, { timeout: 20_000 })
  await expect(page.getByTestId('ie-importa')).toBeEnabled({ timeout: 20_000 })
  for (const f of await page.getByTestId('ie-fila').all()) await expect(f).toHaveAttribute('data-estat', 'existent')
  // Exactamente los dos cambios, cada uno en su fila; la celda vacía no aparece.
  await expect.poll(() => canvisDe(page, filaHort)).toEqual(['persona_contacte'])
  await expect.poll(() => canvisDe(page, filaMenj)).toEqual(['direccion'])
  await expect(page.locator('[data-testid="ie-canvi"]')).toHaveCount(2)
  await expect(fila(page, filaHort)).toHaveAttribute('data-accio', 'actualitzar')
  await expect(fila(page, filaMenj)).toHaveAttribute('data-accio', 'actualitzar')
  await mesura(page, 'pas2-canvis')

  await importa(page)
  await expect(page.getByTestId('ie-xifra-actualitzades')).toContainText('2')
  await expect(page.getByTestId('ie-xifra-sense_canvis')).toContainText('2')
  await expect(page.getByTestId('ie-xifra-creades')).toContainText('0')
  await expect(page.getByTestId('ie-xifra-errors')).toContainText('0')
  expect(sql(`select name || '|' || coalesce(email, '<null>') from productores where empresa = 'TEST-IMP Hort ${marca}'`))
    .toBe(`Berta Canviada|hort-${marca}@exemple.invalid`)
  expect(sql(`select direccion from entidades where nombre = 'TEST-IMP Menjador ${marca}'`)).toBe('Carrer Nou, 7')
  // El registro guarda el valor anterior.
  expect(sql(`select string_agg(c->>'camp' || ':' || coalesce(c->>'abans', '-'), ',' order by c->>'camp')
      from importacions_entitats i join importacions_entitats_files f on f.importacio_id = i.id, jsonb_array_elements(f.canvis) c
     where i.fitxer_nom = 'modificat-${marca}.xlsx'`)).toBe('direccion:-,persona_contacte:Anna Prova')
})

test('B4: el mateix fitxer modificat una altra vegada → tot «sense canvis», res es toca', async ({ page }) => {
  test.skip(!modificat, 'Cal la prova anterior')
  const abans = sql(`select md5(string_agg(t, '|' order by t)) from (
      select row_to_json(p)::text as t from productores p where empresa like 'TEST-IMP % ${marca}'
      union all select row_to_json(e)::text from entidades e where nombre like 'TEST-IMP % ${marca}') x`)
  await entra(page, 'superadmin')
  await page.goto('/equip/entitats/importa')
  await puja(page, modificat)
  await page.getByTestId('ie-continua').click()
  await expect(page.getByTestId('ie-fila')).toHaveCount(4, { timeout: 20_000 })
  await expect(page.getByTestId('ie-importa')).toBeEnabled({ timeout: 20_000 })
  await expect(page.locator('[data-testid="ie-canvi"]')).toHaveCount(0)
  await importa(page)
  await expect(page.getByTestId('ie-xifra-sense_canvis')).toContainText('4')
  await expect(page.getByTestId('ie-xifra-actualitzades')).toContainText('0')
  expect(sql(`select md5(string_agg(t, '|' order by t)) from (
      select row_to_json(p)::text as t from productores p where empresa like 'TEST-IMP % ${marca}'
      union all select row_to_json(e)::text from entidades e where nombre like 'TEST-IMP % ${marca}') x`)).toBe(abans)
})

test('B4: una fila amb un NIF que ja existeix i un altre nom actualitza aquella fitxa i no en crea cap', async ({ page }) => {
  test.skip(!nifNou, 'Cal la primera prova')
  const nOrgs = sql(`select count(*) from organizaciones`)
  const cami = join(dir, `nif-existent-${marca}.xlsx`)
  await writeXlsxFile([{ sheet: 'Entitats', data: [
    ['Rol', 'Nom comercial', 'NIF'],
    ['Ofertant', `TEST-IMP Hort ${marca} Nou`, nifNou],
  ] }]).toFile(cami)
  await entra(page, 'superadmin')
  await page.goto('/equip/entitats/importa')
  await puja(page, cami)
  await page.getByTestId('ie-continua').click()
  await expect(page.getByTestId('ie-fila')).toHaveCount(1, { timeout: 20_000 })
  await expect(fila(page, 2)).toHaveAttribute('data-estat', 'existent')
  await expect.poll(() => canvisDe(page, 2)).toEqual(['nom_comercial'])
  await expect(page.getByTestId('ie-importa')).toBeEnabled({ timeout: 20_000 })
  await importa(page)
  await expect(page.getByTestId('ie-xifra-actualitzades')).toContainText('1')
  await expect(page.getByTestId('ie-xifra-creades')).toContainText('0')
  expect(sql(`select count(*) from organizaciones`)).toBe(nOrgs)
  expect(sql(`select count(*) || '|' || max(empresa) from productores where nif = '${nifNou}'`)).toBe(`1|TEST-IMP Hort ${marca} Nou`)
})
