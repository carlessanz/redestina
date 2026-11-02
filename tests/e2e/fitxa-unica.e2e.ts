// Plan 1, rebanada 1C (02-11-2026): la ficha única «Entitat» y el listado «Entitats».
// Solo contra el CLON LOCAL y solo en escritorio (edita las fichas de prueba compartidas).
//
// Lo que se afirma, en orden (modo serie):
//   1. El listado abre con solo las activas (P10) y lo dice; una desactivada deja de salir.
//   2. Las rutas de antes de 1C redirigen: `/equip/productors` al listado filtrado, y un id de
//      ficha (de productor o de entidad) a la organización.
//   3. La ficha única enseña los dos papeles de la organización de doble rol, y un campo común
//      que el equipo cambia se escribe en las DOS fichas.
//   4. **El bug 1.6**: lo que cambia el equipo lo ve el actor, y lo que cambia el actor lo ve el
//      equipo; el actor no ve «Gestió interna».

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })
const RECEPTOR = 'receptor-carles'
const TEL = '34611222333'

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Edita les fitxes de prova compartides: només a escriptori')
})

/** La organización de doble rol de las pruebas (Carles): su id y el de cada ficha. */
function orgCarles() {
  const ent = entidadDe(RECEPTOR)
  const org = sql(`select organizacion_id from entidades where id = '${ent}'`)
  const prod = sql(`select id from productores where organizacion_id = '${org}'`)
  return { org, ent, prod }
}

test('el listado abre con solo las activas, lo dice, y una desactivada deja de salir', async ({ page }) => {
  const { ent, prod } = orgCarles()
  // Volver a activarlas exige NIF válido y razón social (trigger de 1A): los datos de prueba
  // de la ficha de productor no los tenían, y se dejan puestos (las dos fichas comparten NIF).
  sql(`update productores set razon_social = coalesce(razon_social, 'Organització Carles Sanz'),
         nif = case when nif_valid(nif) then nif else '22222222J' end where id = '${prod}'`)
  sql(`update entidades set razon_social = coalesce(razon_social, nombre),
         nif = case when nif_valid(nif) then nif else '22222222J' end where id = '${ent}'`)
  const total = sql(`select count(*) from v_entitats_llistat`)
  const actives = sql(`select count(*) from v_entitats_llistat where activa`)
  await entra(page, 'super_admin')
  await page.goto('/equip/entitats')
  await expect(page.getByText(new RegExp(`Mostrant ${actives} de ${total}|Mostrando ${actives} de ${total}`))).toBeVisible()
  await expect(page.getByTestId('entitat-fila')).toHaveCount(Number(actives))

  // Desactivar el papel de receptor de Carles no la quita (sigue activa como ofertante, D7);
  // desactivar la organización entera, sí.
  sqlCom('super_admin', `select desactivar_fitxa('entidad', '${ent}')`)
  await page.reload()
  await expect(page.getByTestId('entitat-fila')).toHaveCount(Number(actives))
  const orgId = sql(`select organizacion_id from entidades where id = '${ent}'`)
  sqlCom('super_admin', `select desactivar_organitzacio('${orgId}')`)
  await page.reload()
  await expect(page.getByTestId('entitat-fila')).toHaveCount(Number(actives) - 1)
  // Se deja como estaba (el trigger exige NIF válido y razón social: los datos de prueba los tienen).
  sqlCom('super_admin', `select activar_fitxa('entidad', '${ent}')`)
  sqlCom('super_admin', `select activar_fitxa('productor', '${prod}')`)
  expect(sql(`select activa from v_entitats_llistat where id = '${orgId}'`)).toBe('t')
})

test('las rutas de antes de 1C redirigen al listado y a la organización', async ({ page }) => {
  const { org, ent, prod } = orgCarles()
  await entra(page, 'super_admin')
  await page.goto('/equip/productors')
  await page.waitForURL((u) => u.pathname === '/equip/entitats' && u.searchParams.get('rol') === 'ofertant')
  await page.goto(`/equip/productors/${prod}`)
  await page.waitForURL((u) => u.pathname === `/equip/entitats/${org}`)
  await page.goto(`/equip/entitats/${ent}`)
  await page.waitForURL((u) => u.pathname === `/equip/entitats/${org}`)
  await expect(page.getByTestId('bloc-rols')).toBeVisible()
})

test('la ficha única enseña los dos papeles y un campo común se escribe en las dos fichas', async ({ page }) => {
  const { org, ent, prod } = orgCarles()
  sql(`update productores set telefono_alt = null where id = '${prod}'`)
  sql(`update entidades set telefono2 = null where id = '${ent}'`)
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}`)
  await expect(page.getByTestId('rols-productor')).toBeVisible()
  await expect(page.getByTestId('rols-entidad')).toBeVisible()
  await expect(page.getByTestId('bloc-ofertant')).toBeVisible()
  await expect(page.getByTestId('bloc-receptor')).toBeVisible()
  await expect(page.getByTestId('bloc-intern')).toBeVisible()
  await page.locator('#ed-telefon2').fill(TEL)
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Canvis desats|Cambios guardados/).first()).toBeVisible()
  expect(sql(`select telefono_alt from productores where id = '${prod}'`)).toBe(TEL)
  expect(sql(`select telefono2 from entidades where id = '${ent}'`)).toBe(TEL)
})

test('1.6: el actor ve lo que cambió el equipo, no ve la gestión interna, y lo que cambia lo ve el equipo', async ({ page }) => {
  const { ent } = orgCarles()
  // Para poder guardar: raó social y NIF válido (los exige la ficha del actor).
  sql(`update entidades set razon_social = coalesce(razon_social, nombre),
         nif = case when nif_valid(nif) then nif else '22222222J' end, direccion = null where id = '${ent}'`)
  await entra(page, RECEPTOR)
  await page.goto('/organitzacio')
  await expect(page.locator('#po-entidad-telefon2')).toHaveValue(TEL)
  await expect(page.getByTestId('bloc-intern')).toHaveCount(0)
  await expect(page.getByTestId('po-entidad-receptor')).toBeVisible()
  await page.locator('#po-entidad-direccion').fill('Carrer de la Prova, 16')
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Canvis desats|Cambios guardados/).first()).toBeVisible()
  expect(sql(`select direccion from entidades where id = '${ent}'`)).toBe('Carrer de la Prova, 16')
})

test('…y el equipo ve la dirección que puso el actor', async ({ page }) => {
  const { org, ent, prod } = orgCarles()
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}`)
  // La dirección es un campo común: la de productor manda si la tiene; se vació para que
  // la ficha enseñe la de la entidad (`valorComu`).
  sql(`update productores set direccion = null where id = '${prod}'`)
  await page.reload()
  await expect(page.locator('#ed-direccion')).toHaveValue('Carrer de la Prova, 16')
  // Se deja como estaba.
  sql(`update productores set telefono_alt = null where id = '${prod}'`)
  sql(`update entidades set telefono2 = null, direccion = null where id = '${ent}'`)
})
