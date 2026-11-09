// Dades fiscals i facturació (Taula mestra, revisión de la Fundació del 09-11-2026,
// `20270517100000`). Solo contra el CLON LOCAL. Crea una entidad de prueba (`es_test`, con la
// hora en el nombre) por SQL y la borra al acabar.
//
// Lo que se afirma, en orden (modo serie):
//   1. La ficha del equipo enseña el bloque «Dades fiscals i facturació» en «Dades de l'entitat»,
//      y en las actividades ya no está «Cooperativa agrària».
//   2. Un código postal fiscal mal escrito se dice en el campo y no se guarda.
//   3. Con todo bien, se guardan los seis campos y el convenio toma el domicilio fiscal.

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

const LLETRES = 'TRWAGMYFPDXBNJZSQVHLCKE'
const dni = (n: number) => { const s = String(Math.floor(n) % 1e8).padStart(8, '0'); return s + LLETRES[Number(s) % 23] }

let marca = ''
let org = ''
let ent = ''

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'de datos: una sola pasada')
})

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin') !== null || info.project.name !== 'escriptori') return
  const ara = Date.now()
  marca = String(ara)
  const nom = `E2E fiscal ${marca}`
  ;[ent, org] = sql(`insert into entidades (nombre, razon_social, nif, tipo_receptor, es_test, direccion, codigo_postal)
    values ('${nom}', '${nom} SL', '${dni(ara / 13)}', 'social', true, 'Carrer de la Fitxa, 1', '08003')
    returning id || '|' || organizacion_id`).split('\n')[0].split('|')
})

test.afterAll(() => {
  if (ent && sql(`select count(*) from entidades where id = '${ent}'`) !== '0') {
    sql(`select borrar_ficha_completa('entidad', '${ent}', true)`)
  }
})

test('la fitxa enseña el bloque fiscal y ya no ofrece «Cooperativa agrària»', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=dades`)
  const bloc = page.getByTestId('bloc-fiscal')
  await expect(bloc).toContainText(/Dades fiscals i facturació|Datos fiscales y facturación/)
  await expect(bloc.locator('#ed-regim_iva')).toBeVisible()
  await expect(bloc.locator('#ed-domicili_fiscal')).toBeVisible()
  await expect(bloc.locator('#ed-contacte_facturacio_email')).toBeVisible()
  // La fecha de alta la puso la base al crear la ficha por SQL.
  expect(sql(`select data_alta = to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD') from entidades where id = '${ent}'`)).toBe('t')
  await expect(page.getByTestId('bloc-identitat')).not.toContainText(/Cooperativa agr[àa]ria/)
})

test('un codi postal fiscal mal escrit es diu al camp i no es desa', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=dades`)
  await page.locator('#ed-codi_postal_fiscal').fill('123')
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByTestId('bloc-fiscal')).toContainText(/codi postal|código postal/i)
  expect(sql(`select coalesce(codi_postal_fiscal, '-') from entidades where id = '${ent}'`)).toBe('-')
})

test('es desen les dades fiscals i el conveni pren el domicili fiscal', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=dades`)
  const bloc = page.getByTestId('bloc-fiscal')
  await bloc.locator('#ed-regim_iva').click()
  await page.getByRole('option', { name: /^REAGP / }).click()
  await bloc.locator('#ed-domicili_fiscal').fill('Carrer Fiscal, 9')
  await bloc.locator('#ed-codi_postal_fiscal').fill('25001')
  await bloc.locator('#ed-poblacio_fiscal').fill('Lleida')
  await bloc.locator('#ed-contacte_facturacio_nom').fill('Persona Facturació')
  await bloc.locator('#ed-contacte_facturacio_email').fill('facturacio-e2e@example.com')
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Canvis desats|Cambios guardados/).first()).toBeVisible()

  expect(sql(`select regim_iva || '|' || domicili_fiscal || '|' || codi_postal_fiscal || '|' || poblacio_fiscal
                || '|' || contacte_facturacio_nom || '|' || contacte_facturacio_email from entidades where id = '${ent}'`))
    .toBe('reagp|Carrer Fiscal, 9|25001|Lleida|Persona Facturació|facturacio-e2e@example.com')

  // El convenio sale de `convenio_datos_org()`: con domicilio fiscal, los tres campos fiscales;
  // la dirección de la ficha se queda como estaba. Se prueba con un convenio en borrador que se
  // crea y se quita en la misma llamada.
  const dom = sql(`insert into convenios (tipo, tipo_org, entidad_id, organizacion_id, estado, origen)
      values ('col_receptor', 'entidad', '${ent}', '${org}', 'esborrany', 'plataforma');
    select d->>'domicili' || '|' || (d->>'codi_postal') || '|' || (d->>'poblacio')
      from (select public.convenio_datos_org(id) d from convenios where entidad_id = '${ent}') x;
    delete from convenios where entidad_id = '${ent}' and estado = 'esborrany';`)
  expect(dom.split('\n').find((l) => l.includes('|'))).toBe('Carrer Fiscal, 9|25001|Lleida')
  expect(sql(`select direccion from entidades where id = '${ent}'`)).toBe('Carrer de la Fitxa, 1')
})
