// Plan 1 CRM y registro de entidades, rebanada 1A (20270501100000): el estado de las fichas.
// Una entidad INACTIVA no ve el Mercat ni puede mostrar interés (tampoco asistido), el equipo
// no la encuentra en su selector, y activar exige NIF válido y razón social. Las RPC se llaman
// COMO cada cuenta (`sqlCom`), igual que desde su sesión.
//
// Solo contra el CLON LOCAL y en escritorio: desactiva fichas de prueba compartidas y las
// deja como estaban al acabar.

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const SOCIAL = 'receptor-social'
const COMERCIAL = 'receptor-comercial'
const marca = Date.now()

let social = ''
let nomSocial = ''
let comercial = ''
let nifComercial = ''
let ofertaId = ''

/** Vuelve una entidad a `activo = true` sin pasar por el trigger (su NIF de prueba no es válido). */
function reactivaSenseTrigger(id: string, nif: string) {
  sql(`begin; set local session_replication_role = replica;
       update entidades set activo = true, nif = '${nif}' where id = '${id}'; commit;`)
}

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', SOCIAL, COMERCIAL, 'super_admin', 'equip')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Desactiva fitxes de prova compartides: només a escriptori')
})

test.beforeAll(() => {
  if (motiuSaltClon('productor', SOCIAL, COMERCIAL, 'super_admin', 'equip') !== null) return
  social = entidadDe(SOCIAL)
  comercial = entidadDe(COMERCIAL)
  nomSocial = sql(`select nombre from entidades where id = '${social}'`)
  nifComercial = sql(`select coalesce(nif, '') from entidades where id = '${comercial}'`)
  // Activar exige razón social (P9): la ficha social de prueba no la tiene.
  sql(`update entidades set razon_social = coalesce(razon_social, nombre) where id = '${social}'`)
  const prod = productorDe('productor')
  ofertaId = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, coste_kg, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-EST-${marca}', '${prod}', 'Carbassa', 100, 'publicada', 'asistido', 'donacio', '{donacio}', 0.5, current_date + 5, '[E2E] estat', '[E2E]')
    returning id`).split('\n')[0]
})

test.afterAll(() => {
  if (!social) return
  // Lo que se tocó vuelve a estar activo, pase lo que pase en las pruebas.
  if (sql(`select activo from entidades where id = '${social}'`) === 'f') {
    sqlCom('super_admin', `select activar_fitxa('entidad', '${social}')`)
  }
  if (sql(`select activo from entidades where id = '${comercial}'`) === 'f') reactivaSenseTrigger(comercial, nifComercial)
  if (ofertaId) {
    try { sql(`delete from excedentes where id = '${ofertaId}'`) } catch { sql(`update excedentes set estado = 'cancelada' where id = '${ofertaId}'`) }
  }
})

test('el super_admin desactiva una entidad: queda en el historial con su autor', () => {
  // `sqlCom` descarta las líneas que empiezan por «{»: se piden los campos, no el jsonb.
  const r = sqlCom('super_admin', `select r->>'tipus' || '|' || (r->>'activo') || '|' || (r->>'canviat') from desactivar_fitxa('entidad', '${social}') r`)
  expect(r).toBe('entidad|false|true')
  expect(sql(`select activo from entidades where id = '${social}'`)).toBe('f')
  expect(sql(`select h.activo || '|' || u.email from fitxa_estat_hist h join auth.users u on u.id = h.per
               where h.entidad_id = '${social}' order by h.at desc limit 1`)).toMatch(/^false\|/)
  // Idempotente: repetir no escribe otra fila.
  const n = sql(`select count(*) from fitxa_estat_hist where entidad_id = '${social}'`)
  expect(sqlCom('super_admin', `select desactivar_fitxa('entidad', '${social}')->>'canviat'`)).toBe('false')
  expect(sql(`select count(*) from fitxa_estat_hist where entidad_id = '${social}'`)).toBe(n)
  // Un técnico no puede activarla.
  expect(() => sqlCom('equip', `select activar_fitxa('entidad', '${social}')`)).toThrow(/Nomes l'equip pot activar/)
})

// Lo que deja de ver es la rama del Mercat (`modalitats_compatibles_meves()` vacía): las
// ofertas con las que YA tiene relación (interés, canalización, un envío pendiente) siguen
// en su lista por la rama de historial, y ahí el interés lo corta `comprova_interes()`.
test('una entidad inactiva ve el aviso en el Mercat y no ve las ofertas nuevas', async ({ page }) => {
  expect(sqlCom(SOCIAL, `select count(*) from excedentes where id = '${ofertaId}'`)).toBe('0')
  await entra(page, SOCIAL)
  await page.goto('/receptor/mercat')
  await expect(page.getByTestId('mercat-inactiva')).toBeVisible()
})

test('ni el interés propio ni el asistido entran para una entidad inactiva', () => {
  expect(() => sqlCom(SOCIAL, `select manifestar_interes('${ofertaId}', '${social}', 10)`)).toThrow(/entitat_inactiva/)
  expect(() => sqlCom('super_admin', `select manifestar_interes_assistit('${ofertaId}', '${social}', 10)`)).toThrow(/entitat_inactiva/)
})

test('el selector del interés asistido del equipo no ofrece la entidad inactiva', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${ofertaId}`)
  const sel = page.locator('#od-interes-entitat')
  await expect(sel).toBeVisible()
  // Cargadas las opciones (hay otras entidades activas), la inactiva no está.
  await expect.poll(async () => (await sel.locator('option').count())).toBeGreaterThan(1)
  await expect(sel.locator('option', { hasText: nomSocial })).toHaveCount(0)
})

test('reactivarla le devuelve las ofertas nuevas del Mercat', async ({ page }) => {
  expect(sqlCom('super_admin', `select (r->>'activo') || '|' || (r->>'canviat') from activar_fitxa('entidad', '${social}') r`)).toBe('true|true')
  await entra(page, SOCIAL)
  await page.goto('/receptor/mercat')
  expect(sqlCom(SOCIAL, `select count(*) from excedentes where id = '${ofertaId}'`)).toBe('1')
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('mercat-inactiva')).toHaveCount(0)
})

test('activar exige un NIF válido y, si no hay, el NIF', () => {
  sqlCom('super_admin', `select desactivar_fitxa('entidad', '${comercial}')`)
  // El NIF de prueba de la comercial no pasa el dígito de control.
  expect(() => sqlCom('super_admin', `select activar_fitxa('entidad', '${comercial}')`)).toThrow(/nif_invalid/)
  sql(`update entidades set nif = null where id = '${comercial}'`)
  expect(() => sqlCom('super_admin', `select activar_fitxa('entidad', '${comercial}')`)).toThrow(/falta_nif/)
  expect(sql(`select activo from entidades where id = '${comercial}'`)).toBe('f')
  reactivaSenseTrigger(comercial, nifComercial)
  expect(sql(`select activo from entidades where id = '${comercial}'`)).toBe('t')
})

test('la búsqueda del equipo encuentra por NIF y por nombre; un externo no busca', () => {
  const porNif = sqlCom('equip', `select count(*) from cerca_entitats('B0000')`)
  expect(Number(porNif)).toBeGreaterThan(0)
  const porNom = sqlCom('equip', `select string_agg(nom_comercial, ',') from cerca_entitats('${nomSocial.slice(0, 8).replace(/'/g, "''")}')`)
  expect(porNom).toContain(nomSocial)
  expect(sqlCom('equip', `select count(*) from cerca_entitats('ab')`)).toBe('0')
  expect(() => sqlCom(SOCIAL, `select * from cerca_entitats('B0000')`)).toThrow(/Nomes l'equip pot cercar/)
})
