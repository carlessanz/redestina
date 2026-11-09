// Configuració › Equip: editar, activar, desactivar y borrar cuentas del equipo, con traspaso de lo
// que han hecho (09-11-2026, `20270514100000`). Solo contra el CLON: crea UNA cuenta desechable del
// equipo y lo deja todo como estaba.
//
// Lo que se afirma, en orden (modo serie):
//   1. A uno mismo no se le ofrece desactivar ni borrar.
//   2. Editar: el nombre y el teléfono se guardan; un teléfono inválido no deja guardar.
//   3. Desactivar CON traspaso: la cuenta queda inactiva y un documento emitido (inmutable) pasa a
//      la cuenta de destino. Antes de esta migración, mover o borrar eso era imposible.
//   4. Activar.
//   5. Borrar a quien ha hecho algo EXIGE destino y escribir la palabra; al confirmar, la cuenta
//      desaparece y lo suyo pasa al destino.
//   6. Una cuenta del equipo no puede tener organizaciones (la base lo rechaza).

import { expect, test } from '@playwright/test'
import { compte, entra, motiuSaltClon, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

const EMAIL = 'prova-equip@e2e.test'
const URL_EQUIP = '/equip/configuracio?tab=equip'
const REPLICA = (consulta: string) => `begin; set local session_replication_role = replica; ${consulta}; commit;`

let doc = ''
let docOrigen = ''
let tokenId = ''
let tokenOrigen = ''

const userId = () => sql(`select id from auth.users where email = '${EMAIL}'`)
const fila = (page: import('@playwright/test').Page) => page.locator(`[data-testid="eq-fila"][data-email="${EMAIL}"]`)

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(() => {
  if (motiuSaltClon('super_admin') !== null) return
  // Limpieza por si una pasada anterior se quedó a medias.
  neteja()
  sql(`insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${EMAIL}', '{}', '{}', now(), now())`)
  sql(`insert into usuario_roles (user_id, rol) values ('${userId()}', 'tecnic')`)
  // Algo que ha «hecho» la cuenta: un documento emitido (INMUTABLE) y un enlace.
  doc = sql(`select id from documentos where emitido_por is not null order by id limit 1`)
  docOrigen = sql(`select emitido_por from documentos where id = '${doc}'`)
  tokenId = sql(`select id from enlaces_token where creado_por is not null order by id limit 1`)
  tokenOrigen = sql(`select creado_por from enlaces_token where id = '${tokenId}'`)
  dona()
})

test.afterAll(() => {
  if (motiuSaltClon('super_admin') !== null) return
  neteja()
})

/** Le da a la cuenta desechable la autoría del documento y del enlace. */
function dona() {
  sql(REPLICA(`update documentos set emitido_por = '${userId()}' where id = '${doc}'`))
  sql(`update enlaces_token set creado_por = '${userId()}' where id = '${tokenId}'`)
}

/** El clon, como estaba: la autoría de antes, sin la cuenta ni sus apuntes. */
function neteja() {
  if (doc && docOrigen) sql(REPLICA(`update documentos set emitido_por = '${docOrigen}' where id = '${doc}'`))
  if (tokenId && tokenOrigen) sql(`update enlaces_token set creado_por = '${tokenOrigen}' where id = '${tokenId}'`)
  // Sin `replica`: así el borrado arrastra el perfil y el rol, como en la aplicación.
  sql(`delete from auth.users where email = '${EMAIL}'`)
  sql(`delete from equip_rols_hist where email = '${EMAIL}'`)
  sql(`delete from equip_traspassos where origen_email = '${EMAIL}'`)
}

test('a uno mismo no se le ofrece desactivar ni borrar', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  const jo = page.locator(`[data-testid="eq-fila"][data-email="${compte('super_admin')!.email}"]`)
  await expect(jo).toBeVisible()
  await expect(jo.getByTestId('eq-edita')).toBeEnabled()
  await expect(jo.getByTestId('eq-desactiva')).toBeDisabled()
  await expect(jo.getByTestId('eq-esborra')).toBeDisabled()
})

test('editar guarda nombre y teléfono; un teléfono inválido no deja guardar', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  await fila(page).getByTestId('eq-edita').click()
  const d = page.getByTestId('eq-ed-dialeg')
  await d.getByLabel(/^Nom$|^Nombre$/).fill('Prova E2E')
  await d.getByLabel(/Telèfon|Teléfono/).fill('123')
  await expect(d.getByTestId('eq-ed-desa')).toBeDisabled()
  await d.getByLabel(/Telèfon|Teléfono/).fill('+34 611 22 33 44')
  await d.getByTestId('eq-ed-desa').click()
  await expect(fila(page)).toContainText('Prova E2E')
  expect(sql(`select nombre || '|' || telefono from perfiles where id = '${userId()}'`)).toBe('Prova E2E|34611223344')
})

test('desactivar con traspaso: la cuenta queda inactiva y lo emitido pasa al destino', async ({ page }) => {
  const dest = sql(`select id from auth.users where email = '${compte('super_admin')!.email}'`)
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  await fila(page).getByTestId('eq-desactiva').click()
  const d = page.getByTestId('eq-t-dialeg')
  await expect(d.getByTestId('eq-t-accions')).toBeVisible()
  // El destino propuesto es quien pulsa («Tu»).
  await expect(d.getByTestId('eq-t-desti')).toContainText(/Tu|Tú/)
  await d.getByTestId('eq-t-confirma').click()
  await expect(fila(page)).toHaveAttribute('data-actiu', 'no')
  await expect(fila(page).getByTestId('eq-inactiu')).toBeVisible()

  expect(sql(`select activo from perfiles where id = '${userId()}'`)).toBe('f')
  expect(sql(`select emitido_por from documentos where id = '${doc}'`)).toBe(dest)
  expect(sql(`select creado_por from enlaces_token where id = '${tokenId}'`)).toBe(dest)
  expect(sql(`select count(*) from equip_traspassos where origen_email = '${EMAIL}' and motiu = 'desactiva' and total >= 2`)).toBe('1')
  await expect(page.getByTestId('eq-hist')).toContainText(EMAIL)
})

test('activar la vuelve a dejar activa', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  await fila(page).getByTestId('eq-activa').click()
  await expect(fila(page)).toHaveAttribute('data-actiu', 'si')
  expect(sql(`select activo from perfiles where id = '${userId()}'`)).toBe('t')
})

test('borrar a quien ha hecho algo exige destino y la palabra, y traspasa', async ({ page }) => {
  const dest = sql(`select id from auth.users where email = '${compte('super_admin')!.email}'`)
  dona()  // vuelve a tener autoría (el traspaso anterior se la quitó)
  await entra(page, 'super_admin')
  await page.goto(URL_EQUIP)
  await fila(page).getByTestId('eq-esborra').click()
  const d = page.getByTestId('eq-t-dialeg')
  await expect(d.getByTestId('eq-t-accions')).toBeVisible()
  // Obligatorio: la casilla de traspasar está marcada y bloqueada, y el botón espera la palabra.
  await expect(d.getByRole('checkbox')).toBeChecked()
  await expect(d.getByRole('checkbox')).toBeDisabled()
  await expect(d.getByTestId('eq-t-confirma')).toBeDisabled()
  await d.getByTestId('eq-t-paraula').fill('esborrar')
  await expect(d.getByTestId('eq-t-confirma')).toBeEnabled()
  await d.getByTestId('eq-t-confirma').click()
  await expect(fila(page)).toHaveCount(0)

  expect(sql(`select count(*) from auth.users where email = '${EMAIL}'`)).toBe('0')
  expect(sql(`select emitido_por from documentos where id = '${doc}'`)).toBe(dest)
  expect(sql(`select creado_por from enlaces_token where id = '${tokenId}'`)).toBe(dest)
  expect(sql(`select count(*) from equip_rols_hist where email = '${EMAIL}' and accio = 'esborra'`)).toBe('1')
})

test('una cuenta del equipo no puede tener organizaciones', async () => {
  // Una cuenta del equipo que existe en el clon.
  const equip = sql(`select user_id from usuario_roles limit 1`)
  const prod = sql(`select id from productores limit 1`)
  expect(() => sql(`insert into membresias (user_id, tipo, productor_id) values ('${equip}', 'productor', '${prod}')`))
    .toThrow(/compte_equip/)
})
