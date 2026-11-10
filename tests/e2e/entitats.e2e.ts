// Plan 1, rebanada 1B (02-11-2026): «Nova entitat» en dos pasos.
// Solo contra el CLON LOCAL. Crea sus propias organizaciones de prueba (`es_test`, con la
// marca del proyecto y la hora en el nombre) y las borra al acabar por la única puerta,
// `borrar_ficha_completa()`, así que corre igual en móvil y en escritorio.
//
// Lo que se afirma, en orden (modo serie):
//   1. Paso 1, una INACTIVA: sin NIF no se activa («Cal el NIF per activar-la»); con NIF y
//      razón social se activa, se abre su ficha y aparece en «Nova oferta assistida».
//   2. Paso 1, una ACTIVA (buscada por su NIF): «ja és activa» y «Obre la fitxa».
//   3. Paso 1, la que no tiene el otro papel: «Afegeix el paper d'ofertant».
//   4. Paso 1 → 2, una NUEVA: «És nova» lleva el NIF tecleado al alta, y el alta con los dos
//      papeles crea UNA organización con las dos fichas, activas y con el mismo NIF.
//   5. Un NIF que ya tiene otra organización no se da de alta dos veces: el error sale en el campo.

import { expect, test, type Page } from '@playwright/test'
import { entra, motiuSaltClon, pestanya, sql, sqlCom, opcionsDe } from './ajuda'

test.describe.configure({ mode: 'serial' })

const LLETRES = 'TRWAGMYFPDXBNJZSQVHLCKE'
/** Un DNI válido a partir de un número (8 cifras + letra de control). */
function dni(n: number): string {
  const s = String(Math.floor(n) % 1e8).padStart(8, '0')
  return s + LLETRES[Number(s) % 23]
}

let marca = ''
let nomInactiva = ''
let nomActiva = ''
let nomNova = ''
let nifInactiva = ''
let nifActiva = ''
let nifNova = ''
let orgInactiva = ''
let orgActiva = ''
let orgNova = ''

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin') !== null) return
  const ara = Date.now()
  marca = `${info.project.name} ${ara}`
  nomInactiva = `E2E 1B inactiva ${marca}`
  nomActiva = `E2E 1B activa ${marca}`
  nomNova = `E2E 1B nova ${marca}`
  // Tres NIF distintos y válidos; la hora los hace únicos entre ejecuciones y proyectos.
  nifInactiva = dni(ara / 7)
  nifActiva = dni(ara / 7 + 1)
  nifNova = dni(ara / 7 + 2)
  // Una ofertante INACTIVA y sin NIF (como entrarán las importadas de 1E) y una receptora
  // activa sin papel de ofertante. Las dos de prueba.
  orgInactiva = sql(`insert into productores (name, empresa, es_test, activo)
    values ('Persona E2E', '${nomInactiva}', true, false) returning organizacion_id`).split('\n')[0]
  orgActiva = sql(`insert into entidades (nombre, razon_social, nif, tipo_receptor, es_test)
    values ('${nomActiva}', '${nomActiva} SL', '${nifActiva}', 'social', true) returning organizacion_id`).split('\n')[0]
})

test.afterAll(() => {
  if (!marca) return
  for (const org of [orgInactiva, orgActiva, orgNova]) {
    if (!org) continue
    const p = sql(`select coalesce((select id::text from productores where organizacion_id = '${org}'), '')`)
    const e = sql(`select coalesce((select id::text from entidades where organizacion_id = '${org}'), '')`)
    if (p) sqlCom('super_admin', `select borrar_ficha_completa('productor', '${p}', true)`)
    else if (e) sqlCom('super_admin', `select borrar_ficha_completa('entidad', '${e}', true)`)
  }
})

async function cerca(page: Page, text: string) {
  await page.goto('/equip/entitats/nova')
  await expect(page.getByTestId('ne-pas1')).toBeVisible()
  await page.locator('#ne-cerca').fill(text)
}

async function productorsOfertaAssistida(page: Page, nom: string): Promise<number> {
  await page.goto('/equip/canalitzacio')
  await page.getByRole('button', { name: /^Nova oferta assistida$|^Nueva oferta asistida$/ }).first().click()
  const sel = page.locator('#dnoa-productor')
  await expect(sel).toBeVisible()
  await expect.poll(async () => (await opcionsDe(sel)).length).toBeGreaterThan(1)
  return (await opcionsDe(sel)).filter((o) => o.includes(nom)).length
}

test('una inactiva: sin NIF no se activa; con NIF se activa y aparece en «Nova oferta assistida»', async ({ page }) => {
  await entra(page, 'super_admin')
  expect(await productorsOfertaAssistida(page, nomInactiva)).toBe(0)

  await cerca(page, nomInactiva)
  const fila = page.getByTestId('ne-resultat').filter({ hasText: nomInactiva })
  await expect(fila).toHaveCount(1)
  await expect(fila).toContainText(/Inactiva/)
  await fila.click()
  await expect(page.getByTestId('ne-triada-estat')).toContainText(/és inactiva|está inactiva/)
  await page.getByTestId('ne-triada').getByRole('button', { name: /^Activa-la$|^Actívala$/ }).click()

  const dialeg = page.getByTestId('ne-activar')
  await expect(dialeg).toBeVisible()
  await dialeg.getByTestId('ne-activar-ok').click()
  await expect(dialeg.getByText(/Cal el NIF per activar-la|Hace falta el NIF para activarla/)).toBeVisible()
  expect(sql(`select activo from productores where organizacion_id = '${orgInactiva}'`)).toBe('f')

  await dialeg.locator('#ne-act-nif').fill(nifInactiva)
  await dialeg.locator('#ne-act-rao').fill(`${nomInactiva} SCP`)
  await dialeg.getByTestId('ne-activar-ok').click()
  await page.waitForURL((u) => u.pathname === `/equip/entitats/${orgInactiva}`)
  await pestanya(page, 'intern')
  await expect(page.getByTestId('bloc-rols')).toBeVisible()
  expect(sql(`select activo || '|' || nif from productores where organizacion_id = '${orgInactiva}'`)).toBe(`true|${nifInactiva}`)
  // Quién la activó queda en el historial (trigger de 1A).
  expect(Number(sql(`select count(*) from fitxa_estat_hist h join productores p on p.id = h.productor_id
                      where p.organizacion_id = '${orgInactiva}' and h.activo and h.per is not null`))).toBe(1)

  expect(await productorsOfertaAssistida(page, nomInactiva)).toBe(1)
})

test('una activa, buscada por su NIF: «ja és activa» y se abre su ficha', async ({ page }) => {
  await entra(page, 'super_admin')
  // Con separadores, como se teclea: la búsqueda los quita.
  await cerca(page, `${nifActiva.slice(0, 2)}.${nifActiva.slice(2, 5)}.${nifActiva.slice(5, 8)}-${nifActiva[8].toLowerCase()}`)
  const fila = page.getByTestId('ne-resultat').filter({ hasText: nomActiva })
  await expect(fila).toHaveCount(1)
  await expect(fila).toContainText(/Mateix NIF|Mismo NIF/)
  await fila.click()
  await expect(page.getByTestId('ne-triada-estat')).toContainText(/ja és activa|ya está activa/)
  await page.getByTestId('ne-triada').getByRole('button', { name: /^Obre la fitxa$|^Abre la ficha$/ }).click()
  await page.waitForURL((u) => u.pathname === `/equip/entitats/${orgActiva}`)
})

test('la que no tiene el otro papel: «Afegeix el paper d’ofertant» crea la ficha hermana', async ({ page }) => {
  await entra(page, 'super_admin')
  await cerca(page, nomActiva)
  await page.getByTestId('ne-resultat').filter({ hasText: nomActiva }).click()
  await page.getByTestId('ne-triada').getByRole('button', { name: /Afegeix el paper d.ofertant|Añade el papel de ofertante/ }).click()
  // La confirmación (mismo texto en el botón del diálogo).
  await page.getByRole('dialog').getByRole('button', { name: /Afegeix el paper d.ofertant|Añade el papel de ofertante/ }).click()
  await page.waitForURL((u) => u.pathname === `/equip/entitats/${orgActiva}`)
  await pestanya(page, 'intern')
  await expect(page.getByTestId('rols-productor-badge')).toHaveText(/^(Actiu|Activo)$/)
  expect(sql(`select count(*) || '|' || bool_and(activo) || '|' || max(nif) from productores where organizacion_id = '${orgActiva}'`))
    .toBe(`1|true|${nifActiva}`)
})

test('una nueva: «És nova» lleva el NIF al alta, y el alta con doble rol crea una organización con dos fichas', async ({ page }) => {
  await entra(page, 'super_admin')
  await cerca(page, nifNova.toLowerCase())
  await expect(page.getByText(/Cap entitat coincideix|Ninguna entidad coincide/)).toBeVisible()
  await page.getByTestId('ne-es-nova').click()
  await expect(page.getByTestId('ne-pas2')).toBeVisible()
  await expect(page.locator('#ne-nif')).toHaveValue(nifNova)

  await page.getByTestId('ne-rol-productor').click()
  await page.getByTestId('ne-rol-entidad').click()
  await expect(page.getByTestId('ne-rol-productor')).toHaveAttribute('aria-pressed', 'true')
  // Tecla a tecla, no con `fill()`: con la sección definida dentro del componente, cada letra
  // desmontaba el campo y el foco se perdía tras la primera (Taula mestra 1.1, 09-11-2026).
  const nomCamp = page.locator('#ne-nom_comercial')
  await nomCamp.click()
  await nomCamp.pressSequentially(nomNova)
  await expect(nomCamp).toHaveValue(nomNova)
  await expect(nomCamp).toBeFocused()
  await page.locator('#ne-razon_social').fill(`${nomNova} SL`)
  // Forma jurídica: SAT y sociedad civil en la lista (Taula mestra 1.3, 09-11-2026).
  await page.locator('#ne-tipus_empresa').click()
  await expect(page.getByRole('option', { name: /^Societat civil \(SC\/SCP\)$|^Sociedad civil \(SC\/SCP\)$/ })).toBeVisible()
  // …y la comunitat de béns (revisión de la Fundació, 09-11-2026, 20270517100000).
  await expect(page.getByRole('option', { name: /^Comunitat de béns \(CB\)$|^Comunidad de bienes \(CB\)$/ })).toBeVisible()
  await page.getByRole('option', { name: /^SAT / }).click()
  await page.getByRole('button', { name: /^Productor agrícola$/ }).click()
  await page.locator('#ne-persona_contacte').fill('Persona Nova E2E')
  await page.locator('#ne-email').fill(`e2e-1b-${Date.now()}@example.com`)
  await page.locator('#ne-tipo_receptor').click()
  await page.getByRole('option', { name: /^Entitat social$|^Entidad social$/ }).click()
  await page.getByText(/^Entitat de proves$|^Entidad de pruebas$/).click()
  await page.getByTestId('ne-crea').click()

  await page.waitForURL((u) => /^\/equip\/entitats\/[0-9a-f-]{36}$/.test(u.pathname))
  orgNova = new URL(page.url()).pathname.split('/').pop() as string
  await pestanya(page, 'intern')
  await expect(page.getByTestId('rols-productor')).toBeVisible()
  await expect(page.getByTestId('rols-entidad')).toBeVisible()
  expect(sql(`select es_generadora || '|' || es_receptora || '|' || productor_activo || '|' || entidad_activo || '|' || nif
                from v_organizaciones where id = '${orgNova}'`)).toBe(`true|true|true|true|${nifNova}`)
  expect(sql(`select p.nif = e.nif and p.es_test and e.es_test and e.tipo_receptor = 'social'
                     and p.tipus_activitat = '{productor_agricola}' and e.tipus_activitat = '{productor_agricola}'
                     and p.tipo_empresa = 'sat' and e.tipo_entidad = 'sat'
                     -- La data d'alta la pone la base al crear (20270517100000).
                     and p.data_alta = (now() at time zone 'Europe/Madrid')::date
                     and e.data_alta = to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD')
                from productores p join entidades e on e.organizacion_id = p.organizacion_id
               where p.organizacion_id = '${orgNova}'`)).toBe('t')
})

test('un NIF que ya tiene otra organización no se da de alta dos veces', async ({ page }) => {
  await entra(page, 'super_admin')
  await cerca(page, 'zzz e2e sense resultats')
  await page.getByTestId('ne-es-nova').click()
  await page.getByTestId('ne-rol-productor').click()
  await page.locator('#ne-nom_comercial').fill(`${nomNova} (repetida)`)
  await page.locator('#ne-razon_social').fill(`${nomNova} repetida SL`)
  await page.locator('#ne-nif').fill(nifNova)
  await page.getByTestId('ne-crea').click()
  await expect(page.getByTestId('ne-pas2').getByText(/Aquest NIF ja consta en una altra organització|Este NIF ya consta en otra organización/))
    .toBeVisible()
  await expect(page).toHaveURL(/\/equip\/entitats\/nova/)
  expect(sql(`select count(distinct organizacion_id) from productores where nif = '${nifNova}'`)).toBe('1')
})
