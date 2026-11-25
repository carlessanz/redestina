// Dos perfiles internos (proceso 0.1, 25-11-2026): `super_admin` («Superadmin») y `admin`
// («Dinamitzador»/«Dinamizador»); el `tecnic` se retiró. La cuenta `equip` del arnés es ahora una
// Dinamitzadora. Solo contra el CLON (escribe una firma propia y un convenio de prueba, y lo deja
// todo como estaba).
//
// Lo que se afirma:
//   1. El chip del menú lateral y el menú de la cuenta dicen «Dinamitzador».
//   2. En un convenio firmado que espera la contrafirma, la Dinamitzadora NO ve el botón de
//      contrafirmar (la firma institucional es del Superadmin) y SÍ el aviso «Pendent de la
//      signatura institucional (Superadmin)», en el detalle y en Aprovacions.
//   3. En Configuració no le salen las listas de prueba ni la pestaña «Equip».
//   4. «La meva signatura»: la abre desde el menú de la cuenta, la dibuja, la desa, y al volver a
//      abrir el diálogo la firma guardada está; al final la borra (si no tenía ninguna antes).

import { expect, test, type Page } from '@playwright/test'
import { compte, entidadDe, entra, motiuSaltClon, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor'
const REPLICA = (consulta: string) => `begin; set local session_replication_role = replica; ${consulta}; commit;`

let conveni = ''
let firmaAbans = ''

function uidEquip(): string {
  return sql(`select id from auth.users where email = '${compte('equip')!.email.replace(/'/g, "''")}'`)
}

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('equip', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Escriu la signatura de la compte de prova compartida: només a escriptori')
})

test.beforeAll(() => {
  if (motiuSaltClon('equip', RECEPTOR) !== null) return
  // Un convenio FIRMADO por la entidad y pendiente de contrafirma, sin pasar por el circuito (no
  // gasta numeración ni genera PDF): sin triggers, solo en el clon, y se borra al acabar.
  const ent = entidadDe(RECEPTOR)
  const org = sql(`select organizacion_id from entidades where id = '${ent}'`)
  const marca = Date.now()
  conveni = sql(REPLICA(`insert into convenios (tipo, tipo_org, entidad_id, organizacion_id, estado, origen, numero_completo,
      serie, ejercicio, firmado_at, firmante, idioma)
    values ('col_receptor', 'entidad', '${ent}', '${org}', 'firmat', 'plataforma', 'E2E-ROLS-${marca}',
      'CONV-COL-REC', extract(year from now())::int, now(), '{"nombre":"Persona E2E","cargo":"Presidenta"}', 'ca')
    returning id`)).split('\n').find((l) => /^[0-9a-f-]{36}$/.test(l)) ?? ''
  firmaAbans = sql(`select coalesce(firma_ruta, '') from perfiles where id = '${uidEquip()}'`)
})

test.afterAll(() => {
  if (motiuSaltClon('equip', RECEPTOR) !== null) return
  if (conveni) sql(REPLICA(`delete from convenios where id = '${conveni}'`))
  // La firma propia, como estaba (si tenía una, se le devuelve; si no, la prueba la ha borrado).
  if (firmaAbans) {
    sql(`update perfiles set firma_ruta = '${firmaAbans.replace(/'/g, "''")}' where id = '${uidEquip()}'`)
  }
})

async function obreMenuCompte(page: Page) {
  await page.getByRole('button', { name: /^El meu compte$|^Mi cuenta$/ }).click()
}

test('el chip i el menú del compte diuen «Dinamitzador»', async ({ page }) => {
  expect(sql(`select string_agg(rol, ',') from usuario_roles where user_id = '${uidEquip()}'`)).toBe('admin')
  await entra(page, 'equip')
  await page.goto('/equip/tauler')
  const chip = page.getByTestId('rol-equip')
  await expect(chip).toHaveAttribute('data-rol', 'admin')
  await expect(chip).toHaveText(/^(Dinamitzador|Dinamizador)$/)
  await obreMenuCompte(page)
  await expect(page.getByTestId('menu-rol-equip')).toHaveText(/Rol: (Dinamitzador|Dinamizador)/)
  await expect(page.getByTestId('menu-meva-signatura')).toBeVisible()
})

test('un conveni signat: la Dinamitzadora no el contrasigna i veu que és la signatura institucional', async ({ page }) => {
  test.skip(!conveni, 'no s’ha pogut preparar el conveni de prova')
  await entra(page, 'equip')
  await page.goto(`/equip/convenis/${conveni}`)
  await expect(page.getByTestId('avis-signatura-institucional').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('avis-signatura-institucional').first())
    .toHaveText(/Pendent de la signatura institucional \(Superadmin\)|Pendiente de la firma institucional \(Superadmin\)/)
  await expect(page.getByTestId('conv-contrasigna')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Valida i contrasigna$|^Valida y contrafirma$/ })).toHaveCount(0)
  // Retornar sigue siendo cosa de todo el equipo.
  await expect(page.getByRole('button', { name: /^Retorna$|^Devolver$/ })).toBeEnabled()

  // En la cola de Aprovacions, lo mismo.
  await page.goto('/equip/aprovacions')
  const fila = page.locator('div.rounded-lg.border').filter({ hasText: `E2E-ROLS-` }).first()
  await expect(fila).toBeVisible({ timeout: 30_000 })
  await expect(fila.getByTestId('avis-signatura-institucional')).toBeVisible()
  await expect(fila.getByTestId('conv-contrasigna')).toHaveCount(0)
  expect(sql(`select estado from convenios where id = '${conveni}'`)).toBe('firmat')
})

test('a Configuració no surten les llistes de prova ni «Equip»', async ({ page }) => {
  await entra(page, 'equip')
  await page.goto('/equip/configuracio?tab=notificacions')
  await expect(page.getByRole('tab', { name: /^Notificacions$|^Notificaciones$/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('seccio-llistes-prova')).toHaveCount(0)
  await expect(page.getByTestId('tab-equip')).toHaveCount(0)
  await page.goto('/equip/configuracio?tab=equip')
  await expect(page.getByTestId('seccio-equip')).toHaveCount(0)
})

test('«La meva signatura»: la dibuixa, la desa i hi és en tornar a obrir el diàleg', async ({ page }) => {
  await entra(page, 'equip')
  await page.goto('/equip/tauler')
  await obreMenuCompte(page)
  await page.getByTestId('menu-meva-signatura').click()
  const dlg = page.getByTestId('dialeg-meva-signatura')
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText(/S’estamparà als albarans que validis o emetis|Se estampará en los albaranes que valides o emitas/)
  // Que haya cargado: o la firma de antes, o «Encara no has desat cap signatura».
  await expect(dlg.getByTestId('fe-actual').or(dlg.getByTestId('fe-cap'))).toBeVisible({ timeout: 30_000 })

  // Dibujar un trazo en el lienzo.
  const canvas = dlg.getByTestId('fe-dibuixa').locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 15, box.y + box.height / 2 + (i % 2 ? 12 : -12))
  await page.mouse.up()
  await expect(dlg.getByTestId('fe-desa')).toBeEnabled()
  await dlg.getByTestId('fe-desa').click()
  await expect(page.getByText(/^Signatura desada\.$|^Firma guardada\.$/)).toBeVisible({ timeout: 30_000 })
  await expect(dlg.getByTestId('fe-actual')).toBeVisible()
  await expect.poll(() => sql(`select coalesce(firma_ruta, '') from perfiles where id = '${uidEquip()}'`))
    .toMatch(/^equip\/[0-9a-f-]{36}\/firma-/)

  // Cerrar y volver a abrir: la firma guardada sigue ahí (la lee del servidor, no del estado).
  await dlg.getByRole('button', { name: /^Tanca$|^Cerrar$/ }).first().click()
  await expect(dlg).toHaveCount(0)
  await obreMenuCompte(page)
  await page.getByTestId('menu-meva-signatura').click()
  const dlg2 = page.getByTestId('dialeg-meva-signatura')
  await expect(dlg2.getByTestId('fe-actual')).toBeVisible({ timeout: 30_000 })
  // La imagen se ha cargado de verdad (una URL firmada que no responde dejaría el ancho a 0).
  await expect.poll(() => dlg2.getByTestId('fe-actual').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

  // Si antes no tenía firma, se borra por la pantalla y vuelve a «Encara no has desat cap signatura».
  if (!firmaAbans) {
    await dlg2.getByTestId('fe-esborra').click()
    await page.getByRole('dialog').filter({ hasText: /Esborrar la teva signatura\?|¿Borrar tu firma\?/ })
      .getByRole('button', { name: /^Esborra la signatura$|^Borrar la firma$/ }).click()
    await expect(dlg2.getByTestId('fe-cap')).toBeVisible({ timeout: 30_000 })
    expect(sql(`select coalesce(firma_ruta, '') from perfiles where id = '${uidEquip()}'`)).toBe('')
  }
})
