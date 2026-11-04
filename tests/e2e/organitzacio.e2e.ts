// Fase 7 de la revisión del cliente del 08-10-2026: la ficha de la organización.
// Solo contra el CLON LOCAL y solo en escritorio (edita la ficha de las cuentas de prueba).

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom, tria } from './ajuda'

test.describe.configure({ mode: 'serial' })
const RECEPTOR = 'receptor-carles'

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Edita les fitxes de prova compartides: només a escriptori')
})

// D3 (plan 1, 1A): ya no hay «Persones de contacte»; el contacto es el de la ficha.
test('el productor marca dos actividades y guarda; la ficha ya no ofrece persones de contacte', async ({ page }) => {
  const prod = productorDe('productor')
  sql(`update productores set tipus_activitat = '{}', razon_social = coalesce(razon_social, 'Mas de Prova SCP') where id = '${prod}'`)
  await entra(page, 'productor')
  await page.goto('/organitzacio')
  await page.getByRole('button', { name: 'Productor agrícola' }).click()
  await page.getByRole('button', { name: 'Majorista' }).click()
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Desat|Guardado|desat/i).first()).toBeVisible()
  expect(sql(`select array_length(tipus_activitat, 1) from productores where id = '${prod}'`)).toBe('2')

  await expect(page.getByTestId('contactes-org')).toHaveCount(0)
  // 1C (D8): la ficha del actor sale de `campsFitxa`; el bloque interno es solo del equipo.
  await expect(page.getByTestId('po-productor-identitat')).toBeVisible()
  await expect(page.getByTestId('bloc-intern')).toHaveCount(0)
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
  // Desde la fase 9 las preferencias viven en «El meu perfil de recepció».
  await page.goto('/organitzacio/perfil-recepcio')
  const pref = page.getByTestId('preferencies-recepcio')
  await expect(pref.getByText(/Com podem oferir-te excedents|Cómo podemos ofrecerte excedentes/)).toBeVisible()
  await pref.getByRole('button', { name: /^Compra$/ }).click()
  await pref.getByRole('button', { name: /^Donació$|^Donación$/ }).click()
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Desat|Guardado|desat/i).first()).toBeVisible()
  expect(sql(`select array_to_string(modalitats_interes, ',') from entidades where id = '${ent}'`)).toMatch(/venda/)
  await page.goto('/organitzacio')
  await expect(page.getByTestId('rol-redestina')).toBeVisible()
})

// 20270505100000: la población es siempre un municipio, el área (la comarca) se puede cambiar
// y lo que no es un municipio —Mercabarna— va a «Ubicació».
test('la receptora tria la població, canvia l’àrea i escriu la ubicació', async ({ page }) => {
  const ent = entidadDe(RECEPTOR)
  sql(`update entidades set municipio_ine = null, ubicacio = null, codigo_postal = '08001', razon_social = coalesce(razon_social, nombre),
         nif = case when nif_valid(nif) then nif else '22222222J' end where id = '${ent}'`)
  await entra(page, RECEPTOR)
  await page.goto('/organitzacio')

  // Sin población, la del código postal (08001) se elige sola, con su comarca.
  const poblacio = page.locator('#po-entidad-municipio_ine')
  await expect(poblacio).toHaveValue('Barcelona')
  await expect(page.locator('#po-entidad-area_geografica')).toHaveText('Barcelonès')
  // Elegir otra población pone su comarca; luego se puede cambiar.
  await poblacio.fill('Badalona')
  await page.getByRole('option', { name: /^Badalona/ }).click()
  await expect(page.locator('#po-entidad-area_geografica')).toHaveText('Barcelonès')
  await tria(page.locator('#po-entidad-area_geografica'), { text: 'Maresme' })
  await page.locator('#po-entidad-ubicacio').fill('Mercabarna')
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Desat|Guardado|desat/i).first()).toBeVisible()
  expect(sql(`select poblacion || '|' || area_geografica || '|' || ubicacio from entidades where id = '${ent}'`))
    .toBe('Badalona|Maresme|Mercabarna')

  // Una comarca inventada no pasa por la RPC (la pantalla solo ofrece la lista).
  expect(() => sqlCom(RECEPTOR, `select actualitzar_fitxa_entitat('${ent}', '{"area_geografica":"Comarca Inventada"}'::jsonb)`))
    .toThrow(/comarca_desconeguda/)
  // Y un texto que no es un municipio, escrito como población, acaba en la ubicación.
  sql(`update entidades set municipio_ine = null, ubicacio = null, poblacion = 'Polígon de Prova' where id = '${ent}'`)
  expect(sql(`select coalesce(poblacion, '∅') || '|' || ubicacio from entidades where id = '${ent}'`)).toBe('∅|Polígon de Prova')
  sql(`update entidades set ubicacio = null, municipio_ine = (select codi_ine from municipios where nom = 'Barcelona') where id = '${ent}'`)
})
