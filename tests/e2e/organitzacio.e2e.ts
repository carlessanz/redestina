// Fase 7 de la revisión del cliente del 08-10-2026: la ficha de la organización.
// Solo contra el CLON LOCAL y solo en escritorio (edita la ficha de las cuentas de prueba).

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })
const RECEPTOR = 'receptor-carles'

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Edita les fitxes de prova compartides: només a escriptori')
})

test('el productor marca dos actividades, añade un contacto de recogidas y guarda', async ({ page }) => {
  const prod = productorDe('productor')
  const org = sql(`select organizacion_id from productores where id = '${prod}'`)
  sql(`update productores set tipus_activitat = '{}', razon_social = coalesce(razon_social, 'Mas de Prova SCP') where id = '${prod}'`)
  sql(`delete from organizacion_contactos where organizacion_id = '${org}' and nom = 'Persona Recollides E2E'`)
  await entra(page, 'productor')
  await page.goto('/organitzacio')
  await page.getByRole('button', { name: 'Productor agrícola' }).click()
  await page.getByRole('button', { name: 'Majorista' }).click()
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Desat|Guardado|desat/i).first()).toBeVisible()
  expect(sql(`select array_length(tipus_activitat, 1) from productores where id = '${prod}'`)).toBe('2')

  const ct = page.getByTestId('contactes-org')
  await ct.getByRole('button', { name: /Afegeix una persona|Añadir una persona/ }).click()
  await ct.getByLabel(/Nom i cognoms|Nombre y apellidos/).fill('Persona Recollides E2E')
  await ct.getByLabel(/Tipus de contacte|Tipo de contacto/).selectOption('recollides')
  await ct.getByLabel(/^Telèfon$|^Teléfono$/).fill('600 111 222')
  await ct.getByRole('button', { name: /^Desar$|^Guardar$/ }).click()
  await expect(ct.getByText('Persona Recollides E2E')).toBeVisible()
  expect(sql(`select tipus || '|' || telefon from organizacion_contactos where organizacion_id = '${org}' and nom = 'Persona Recollides E2E'`))
    .toBe('recollides|34600111222')
})

test('un NIF mal escrito y una raó social vacía salen en rojo y no se guardan', async ({ page }) => {
  const prod = productorDe('productor')
  const abans = sql(`select nif from productores where id = '${prod}'`)
  await entra(page, 'productor')
  await page.goto('/organitzacio')
  await page.locator('#po-productor-nif').fill('12345678A')
  await page.locator('#po-productor-razon_social').fill('')
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/dígit de control no quadra|dígito de control no cuadra/)).toBeVisible()
  await expect(page.getByText(/raó social és obligatòria|razón social es obligatoria/)).toBeVisible()
  expect(sql(`select nif from productores where id = '${prod}'`)).toBe(abans)
})

test('la receptora dice qué modalidades le interesan y cómo puede recibir', async ({ page }) => {
  const ent = entidadDe(RECEPTOR)
  // Con un NIF inválido de los datos de prueba, la ficha no deja guardar nada más hasta
  // corregirlo (es lo que se pide): se parte de uno válido.
  sql(`update entidades set modalitats_interes = '{}', razon_social = coalesce(razon_social, nombre),
         nif = case when nif_valid(nif) then nif else '22222222J' end where id = '${ent}'`)
  await entra(page, RECEPTOR)
  await page.goto('/organitzacio')
  const pref = page.getByTestId('preferencies-recepcio')
  await expect(pref.getByText(/Com podem oferir-te excedents|Cómo podemos ofrecerte excedentes/)).toBeVisible()
  await pref.getByRole('button', { name: /^Compra$/ }).click()
  await pref.getByRole('button', { name: /^Donació$|^Donación$/ }).click()
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Desat|Guardado|desat/i).first()).toBeVisible()
  expect(sql(`select array_to_string(modalitats_interes, ',') from entidades where id = '${ent}'`)).toMatch(/venda/)
  await expect(page.getByTestId('rol-redestina')).toBeVisible()
})
