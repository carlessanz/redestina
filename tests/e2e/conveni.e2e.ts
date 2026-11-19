// Fase 5 de la revisión del cliente del 08-10-2026: el «Conveni de col·laboració» único.
//
// Solo contra el CLON LOCAL y solo en escritorio (firma con la cuenta de productor de
// prueba, que es una: los dos proyectos a la vez firmarían dos veces). La productora de
// prueba tiene un convenio ANTERIOR de donación vigente: con él puede donar pero no vender.
// El equipo le prepara el de col·laboració, ella lo firma desde «Pendent de tu», el equipo lo
// contrafirma, y entonces ya puede vender; y no se le puede abrir otro encima.
//
// Desde el vaciado del clon (fase 6 de los puntos 4-6) la productora nace con el Conveni de
// col·laboració DECLARAT y sin ningún convenio anterior: la prueba se pone el de donación
// (`don_gen`, en papel) ella misma y, al acabar, deja SIEMPRE un col·laboració vigente —el que ha
// firmado o, si la prueba se ha quedado a medias, uno declarado—: las pruebas que vienen detrás
// asignan donaciones de esta productora y sin convenio fallarían todas con `sense_conveni`.

import { expect, test } from '@playwright/test'
import { asseguraConveniVigent, entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

let prod = ''
let conveni = ''
let anterior = ''

test.beforeAll(({}, info) => {
  if (motiuSaltClon('productor', 'super_admin') || info.project.name !== 'escriptori') return
  prod = productorDe('productor')
  // Punto de partida: sin ningún col_productor (ni a medias ni vigente) de pasadas anteriores, y
  // sin un `com` vigente (05-11-2026: el clon tenía uno del 11-10 y la primera prueba —«no puede
  // vender»— dejaba de ser cierta antes de abrir ninguna pantalla).
  sql(`update convenios set estado = 'resolt', motivo_resolucion = 'Prova E2E' where productor_id = '${prod}' and tipo in ('col_productor', 'com') and estado = 'vigent'`)
  sql(`delete from enlaces_token where objeto_tipo = 'convenio' and objeto_id in (select id from convenios where productor_id = '${prod}' and tipo = 'col_productor' and estado in ('esborrany', 'pendent_firma'))`)
  sql(`delete from convenios where productor_id = '${prod}' and tipo = 'col_productor' and estado in ('esborrany', 'pendent_firma')`)
  // El convenio ANTERIOR de donación: en papel (sin número), como los que se firmaron antes de la
  // plataforma. Ya no hay plantilla de `don_gen`, así que no se puede emitir por el camino normal.
  anterior = sql(`select id from convenios where productor_id = '${prod}' and tipo = 'don_gen' and estado = 'vigent'`)
  if (!anterior) {
    anterior = sql(`insert into convenios (tipo, tipo_org, productor_id, estado, origen, referencia_paper, firmado_at, idioma)
      values ('don_gen', 'productor', '${prod}', 'vigent', 'paper', 'TEST-E2E conveni anterior de donació', now(), 'ca')
      returning id`).split('\n')[0]
  }
  conveni = sqlCom('super_admin', `select (preparar_convenio('productor', '${prod}', 'col_productor')).id`)
  sqlCom('super_admin', `select enviar_convenio('${conveni}', null)`)
})

test.afterAll(() => {
  if (!prod) return
  // El anterior de donación, fuera (si la contrafirma no lo ha sustituido ya).
  if (anterior) sql(`update convenios set estado = 'resolt', motivo_resolucion = 'Prova E2E' where id = '${anterior}' and estado = 'vigent'`)
  // Y la productora se queda con su Conveni de col·laboració vigente: el firmado aquí (contrafirmado
  // si se quedó en `firmat`) o, si la prueba no llegó a firmarlo, uno declarado.
  asseguraConveniVigent('productor', prod)
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', 'super_admin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Signa amb la compte de prova compartida: només a escriptori')
})

test('con el convenio anterior de donación puede donar, pero no vender, y el panel se lo dice', async ({ page }) => {
  expect(sql(`select convenio_vigente('productor', '${prod}', 'donacio', 'entrega')`)).toBe('t')
  expect(sql(`select convenio_vigente('productor', '${prod}', 'venda', 'entrega')`)).toBe('f')
  await entra(page, 'productor')
  await page.goto('/productor/ofertes/nova')
  await expect(page.getByText(/només cobreix una part de les modalitats|solo cubre una parte de las modalidades/)).toBeVisible()
})

test('firma el Conveni de col·laboració desde «Pendent de tu»', async ({ page }) => {
  const abans = Number(sql(`select coalesce(max(ultimo), 0) from series_documentales where serie = 'CONV-COL-PROD'`))
  await entra(page, 'productor')
  await page.goto('/productor/documents')
  const fila = page.locator('div').filter({ hasText: /Conveni de col·laboració|Convenio de colaboración/ })
    .filter({ has: page.getByRole('button', { name: /Signa el conveni|Firma el convenio/ }) }).last()
  await fila.getByRole('button', { name: /Signa el conveni|Firma el convenio/ }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText(/Conveni de col·laboració|Convenio de colaboración/).first()).toBeVisible()
  // Los datos de la organización que falten (los obligatorios llevan asterisco).
  for (const [id, valor] of [['sig-nif', 'B00000000'], ['sig-domicili', 'Carrer de Prova, 1'], ['sig-codi_postal', '08850'], ['sig-poblacio', 'Sant Agustí de Lluçanès'], ['sig-raso_social', 'Mas de Prova SCP'], ['sig-representant', 'Persona de Prova'], ['sig-carrec', 'Gerent']] as const) {
    const camp = dlg.locator(`#${id}`)
    if (await camp.count() && (await camp.inputValue()) === '') await camp.fill(valor)
  }
  await dlg.locator('#sig-signant-nom').fill('Persona de Prova')
  await dlg.locator('#sig-signant-carrec').fill('Gerent')
  await dlg.locator('#sig-signant-dni').fill('12345678Z')
  await dlg.getByRole('checkbox').nth(0).check()
  await dlg.getByRole('checkbox').nth(1).check()
  const canvas = dlg.locator('canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 20 + i * 15, box.y + box.height / 2 + (i % 2 ? 10 : -10))
  await page.mouse.up()
  await dlg.getByRole('button', { name: /Signar el conveni|Firmar el convenio/ }).click()
  await expect(page.getByText(/Conveni signat|Convenio firmado/).first()).toBeVisible({ timeout: 20_000 })

  expect(sql(`select estado || '|' || (numero_completo like 'CONV-COL-PROD-%') from convenios where id = '${conveni}'`)).toBe('firmat|true')
  // UN número de la serie nueva, ni uno más (el bug del 08-10 quemaba don_gen de más).
  expect(Number(sql(`select max(ultimo) from series_documentales where serie = 'CONV-COL-PROD'`))).toBe(abans + 1)
})

test('contrafirmado, ya puede vender, y no se le abre otro encima', () => {
  sqlCom('super_admin', `select contrafirmar_convenio('${conveni}')`)
  expect(sql(`select estado from convenios where id = '${conveni}'`)).toBe('vigent')
  expect(sql(`select convenio_vigente('productor', '${prod}', 'venda', 'entrega')`)).toBe('t')
  expect(sql(`select convenio_vigente('productor', '${prod}', 'maquila', 'entrega')`)).toBe('t')
  expect(() => sqlCom('productor', `select signar_conveni_propi('productor', '${prod}')`)).toThrow(/Ja tens un conveni vigent/)
})
