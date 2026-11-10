// Plan 2 A5 (20270523100000): la NATURALESA de la organización y el perfil de recepción por
// tipología. Lo que se comprueba, por este orden:
//   1. sugerida («empresa» por el NIF) no cambia nada: la entidad social sigue viendo la donación;
//   2. el titular la CONFIRMA en «La meva organització» y ya no puede cambiarla;
//   3. confirmada «empresa»: el Mercat deja de enseñarle la donación (sí la venta), no puede
//      mostrar interés en ella (`comprova_interes()`), y su perfil de recepción pide lo comercial
//      y nada social;
//   4. el equipo sí puede cambiarla.
// Las RPC se llaman COMO cada cuenta (`sqlCom`), igual que desde su sesión.
//
// Solo contra el CLON LOCAL y en escritorio: toca la ficha de una receptora de prueba compartida
// y la deja como estaba al acabar.

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom, tria } from './ajuda'

test.describe.configure({ mode: 'serial' })

const SOCIAL = 'receptor-social'
const marca = Date.now()

let social = ''
let org = ''
let abans = { naturalesa: '', origen: '' }
let donacio = ''
let venda = ''

const n = (s: string) => (s === '' ? 'null' : `'${s}'`)

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', SOCIAL, 'super_admin', 'equip')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Toca la fitxa d’una receptora de prova compartida: només a escriptori')
})

test.beforeAll(() => {
  if (motiuSaltClon('productor', SOCIAL, 'super_admin', 'equip') !== null) return
  social = entidadDe(SOCIAL)
  org = sql(`select organizacion_id from entidades where id = '${social}'`)
  const [nat, origen] = sql(`select coalesce(naturalesa, '') || '|' || coalesce(naturalesa_origen, '') from organizaciones where id = '${org}'`).split('|')
  abans = { naturalesa: nat, origen }
  // El punto de partida: sugerida «empresa» (lo que da el NIF de prueba) y la ficha social, sin
  // filtros de modalidad que escondan nada.
  sql(`update organizaciones set naturalesa = 'empresa', naturalesa_origen = 'suggerida' where id = '${org}'`)
  sql(`update entidades set modalitats_interes = '{}' where id = '${social}'`)
  const prod = productorDe('productor')
  const oferta = (sufix: string, mod: string, preu: string) => sql(`insert into excedentes (id_excedente, productor_id, producto,
      kg_total, estado, origen, modalitat, modalitats, preu_minim, coste_kg, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-NAT-${sufix}-${marca}', '${prod}', 'Carbassa', 100, 'publicada', 'asistido', '${mod}', '{${mod}}', ${preu}, 0.5,
      current_date + 5, '[E2E] naturalesa', '[E2E]') returning id`).split('\n')[0]
  donacio = oferta('D', 'donacio', 'null')
  venda = oferta('V', 'venda', '0.3')
})

test.afterAll(() => {
  if (!org) return
  sql(`update organizaciones set naturalesa = ${n(abans.naturalesa)}, naturalesa_origen = ${n(abans.origen)} where id = '${org}'`)
  for (const id of [donacio, venda].filter(Boolean)) {
    try { sql(`delete from excedentes where id = '${id}'`) } catch { sql(`update excedentes set estado = 'cancelada' where id = '${id}'`) }
  }
})

const veu = (id: string) => sqlCom(SOCIAL, `select count(*) from excedentes where id = '${id}'`)

test('sugerida no cambia nada: la entidad social sigue viendo la donación y su perfil social', async ({ page }) => {
  expect(veu(donacio)).toBe('1')
  expect(veu(venda)).toBe('1')
  await entra(page, SOCIAL)
  await page.goto('/organitzacio/perfil-recepcio')
  await expect(page.getByTestId('naturalesa-perfil')).toContainText(/Empresa \(suggerida\)|Empresa \(sugerida\)/)
  // Los chips y el bloque, como antes de A5 (por el tipo «social»).
  const pref = page.getByTestId('preferencies-recepcio')
  await expect(pref.getByRole('button', { name: /^Donació$|^Donación$/ })).toBeVisible()
  await expect(page.getByText(/^Persones ateses|^Personas atendidas/).first()).toBeVisible()
})

test('el titular la confirma en «La meva organització» y ya no la puede cambiar', async ({ page }) => {
  await entra(page, SOCIAL)
  await page.goto('/organitzacio')
  const bloc = page.getByTestId('naturalesa')
  await expect(bloc.getByTestId('naturalesa-origen')).toHaveText(/Suggerida|Sugerida/)
  await bloc.getByTestId('naturalesa-confirma').click()
  await expect(bloc.getByTestId('naturalesa-origen')).toHaveText(/Confirmada/)
  expect(sql(`select naturalesa || '|' || naturalesa_origen from organizaciones where id = '${org}'`)).toBe('empresa|confirmada')
  // Confirmada, el titular la ve en solo lectura y la base tampoco le deja.
  await expect(page.locator('#po-entidad-naturalesa')).toBeDisabled()
  await expect(bloc.getByText(/parla amb l’equip|habla con el equipo/)).toBeVisible()
  expect(() => sqlCom(SOCIAL, `select fixar_naturalesa('${org}', 'entitat_social')`)).toThrow(/naturalesa_confirmada/)
})

test('confirmada «empresa»: sin donación en el Mercat ni en el interés, y perfil comercial', async ({ page }) => {
  expect(veu(donacio)).toBe('0')
  expect(veu(venda)).toBe('1')
  expect(() => sqlCom(SOCIAL, `select manifestar_interes('${donacio}', '${social}', 10)`)).toThrow(/no encaixa amb el tipus de receptor/)

  await entra(page, SOCIAL)
  await page.goto('/receptor/mercat')
  await expect(page.getByText(`E-E2E-NAT-D-${marca}`)).toHaveCount(0)

  await page.goto('/organitzacio/perfil-recepcio')
  await expect(page.getByTestId('naturalesa-perfil')).toContainText(/Empresa \(confirmada\)/)
  const pref = page.getByTestId('preferencies-recepcio')
  await expect(pref.getByRole('button', { name: /^Compra$/ })).toBeVisible()
  await expect(pref.getByRole('button', { name: /^Maquila/ })).toBeVisible()
  await expect(pref.getByRole('button', { name: /^Donació$|^Donación$/ })).toHaveCount(0)
  await expect(page.getByText(/^Quantitat per comanda|^Cantidad por pedido/).first()).toBeVisible()
  await expect(page.getByText(/^Persones ateses|^Personas atendidas/)).toHaveCount(0)
  await expect(page.getByText(/^Famílies ateses|^Familias atendidas/)).toHaveCount(0)
})

test('el equipo sí la cambia desde la ficha, y la entidad vuelve a ver la donación', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}`)
  const sel = page.locator('#ed-naturalesa')
  await expect(sel).toBeEnabled()
  await tria(sel, 'entitat_social')
  await expect.poll(() => sql(`select naturalesa || '|' || naturalesa_origen from organizaciones where id = '${org}'`))
    .toBe('entitat_social|confirmada')
  expect(veu(donacio)).toBe('1')
  // El técnico también (es_intern), y un valor inventado es 22023.
  sqlCom('equip', `select fixar_naturalesa('${org}', 'empresa')`)
  expect(sql(`select naturalesa from organizaciones where id = '${org}'`)).toBe('empresa')
  expect(() => sqlCom('equip', `select fixar_naturalesa('${org}', 'cooperativa')`)).toThrow(/naturalesa_desconeguda/)
})
