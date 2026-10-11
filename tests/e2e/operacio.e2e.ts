// Fase 2 de la revisión del cliente del 08-10-2026: la ficha de la operación y los avisos.
//
// Solo contra el CLON LOCAL (`E2E_CLON=1`). Prepara por SQL una oferta de la productora de
// prueba con un interés de la receptora de Carles (que tiene convenio vigente) y lo aprueba
// COMO el super_admin; después comprueba lo que ve cada parte, cambia la hora y mira que el
// aviso llegue a las dos, y recorre «Ofertes per a tu».

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
let ofertaId = ''
let canalId = ''
let proposadaId = ''

test.beforeAll(() => {
  if (motiuSaltClon('productor', RECEPTOR, 'super_admin')) return
  const prod = productorDe('productor')
  const ent = entidadDe(RECEPTOR)
  const marca = Date.now()
  // Un lugar de recogida con la ficha completa: lo que el receptor tiene que ver.
  const lloc = sql(`insert into productor_ubicaciones (productor_id, alias, municipio, direccion, contacto_nombre, contacto_telefono, horario, observaciones)
    values ('${prod}', 'Magatzem E2E ${marca}', 'Vic', 'Carrer de la Prova, 12', 'Jordi E2E', '34600111222', 'De 8 a 14 h', 'Moll de càrrega al darrere')
    returning id`).split('\n')[0]
  ofertaId = sql(`insert into excedentes (id_excedente, productor_id, ubicacion_id, producto, kg_total, estado, origen, modalitat, modalitats, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-OP-${marca}', '${prod}', '${lloc}', 'Pera', 200, 'publicada', 'asistido', 'donacio', '{donacio}', current_date + 5, '[E2E] operació', '[E2E]')
    returning id`).split('\n')[0]
  const resp = sql(`insert into oferta_respuestas (excedente_id, entidad_id, telefono, canal, estado, aprovacio, kg_solicitados, enviado_at, respondido_at)
    values ('${ofertaId}', '${ent}', '34600000000', 'panel', 'acceptada', 'pendent', 100, now(), now()) returning id`).split('\n')[0]
  canalId = sqlCom('super_admin', `select (aprovar_resposta('${resp}', 80, null, null, null,
      ((current_date + 2) + time '10:00') at time zone 'Europe/Madrid')).id`)
})

test.afterAll(() => {
  if (!ofertaId) return
  sql(`delete from avisos where (params->>'excedente_id') in ('${ofertaId}') or objecte_id in ('${ofertaId}', '${proposadaId || ofertaId}')`)
})

test.beforeEach(() => {
  const m = motiuSaltClon('productor', RECEPTOR, 'super_admin')
  test.skip(m !== null, m ?? '')
})

test('el receptor ve la cantidad asignada destacada y la ficha completa de la recogida', async ({ page }) => {
  expect(canalId).toMatch(/^[0-9a-f-]{36}$/)
  await entra(page, RECEPTOR)
  await page.goto('/receptor/interessos')
  const fila = page.getByRole('button').filter({ hasText: 'Pera' }).filter({ hasText: /Quantitat assignada: 80 kg|Cantidad asignada: 80 kg/ }).first()
  await expect(fila).toBeVisible()
  await expect(fila.getByText(/Sol·licitats: 100 kg|Solicitados: 100 kg/)).toBeVisible()
  await fila.click()
  const fitxa = page.getByTestId('fitxa-operacio')
  await expect(fitxa.getByText('Carrer de la Prova, 12', { exact: false })).toBeVisible()
  await expect(fitxa.getByText('Jordi E2E')).toBeVisible()
  await expect(fitxa.getByText('+34600111222').first()).toBeVisible()
  await expect(fitxa.getByText('Moll de càrrega al darrere')).toBeVisible()
  await expect(fitxa.getByText(/Recollida pendent|Recogida pendiente/)).toBeVisible()
})

test('el productor ve a quién va, cuánto y cuándo, sin entrar a la oferta', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto('/productor/ofertes')
  await expect(page.getByTestId('linies-sortida').filter({ hasText: 'Organització Carles Sanz' })
    .filter({ hasText: /80 kg/ }).filter({ hasText: /10:00/ }).first()).toBeVisible()
})

test('si cambia la hora de recogida, avisa a las dos partes', async ({ page }) => {
  sql(`update canalizaciones set data_hora_recollida = data_hora_recollida + interval '1 day' where id = '${canalId}'`)
  expect(sql(`select string_agg(destinatari_tipo, ',' order by destinatari_tipo) from avisos
               where tipus = 'recollida_canviada' and (params->>'excedente_id') = '${ofertaId}'`)).toBe('entidad,productor')
  await entra(page, RECEPTOR)
  await page.goto('/receptor/interessos')
  await page.getByRole('button', { name: /Avisos/ }).click()
  await expect(page.getByText(/La recollida de Pera ha canviat|La recogida de Pera ha cambiado/).first()).toBeVisible()
})

test('«Ofertes per a tu»: una oferta propuesta por el panel y «No m’interessa»', async ({ page }) => {
  const prod = productorDe('productor')
  const ent = entidadDe(RECEPTOR)
  const exc = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-PT-${Date.now()}', '${prod}', 'Codony', 90, 'publicada', 'asistido', 'donacio', '{donacio}', current_date + 5, '[E2E] per a tu', '[E2E]')
    returning id`).split('\n')[0]
  proposadaId = sql(`insert into oferta_respuestas (excedente_id, entidad_id, telefono, canal, estado, enviado_at)
    values ('${exc}', '${ent}', '34600000000', 'panel', 'pendent', now()) returning id`).split('\n')[0]
  expect(sql(`select tipus from avisos where objecte_id = '${proposadaId}'`)).toBe('oferta_enviada')

  await entra(page, RECEPTOR)
  await page.goto('/receptor/interessos')
  await page.getByRole('tab', { name: /Ofertes per a tu|Ofertas para ti/ }).click()
  await page.getByRole('button').filter({ hasText: 'Codony' }).first().click()
  await page.getByRole('button', { name: /No m’interessa|No me interesa/ }).click()
  await expect(page.getByText(/no t’hi tornarem a comptar|no te volveremos a contar/)).toBeVisible()
  expect(sql(`select estado from oferta_respuestas where id = '${proposadaId}'`)).toBe('rebutjada')
  sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${exc}'`)
})
