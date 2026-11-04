// Borrar una entidad desde su ficha (04-11-2026, decisión de Carles, `20270508100000`).
// Solo contra el CLON LOCAL. Crea dos organizaciones de prueba (`es_test`, con la hora en el
// nombre): una ofertante con una oferta (cancelada: también cuenta) y una receptora sin nada.
//
// Lo que se afirma, en orden (modo serie):
//   1. La RPC se niega a borrar una ficha con ofertas: `bloqueig_esborrat: ofertes`.
//   2. En la ficha, «Esborra l’entitat» no ofrece borrar: dice por qué («té ofertes») y propone
//      «Desactiva l’entitat»; al pulsarlo la entidad queda inactiva y la ficha sigue ahí. Una
//      segunda vez ya no hay nada que desactivar: «Ja està inactiva».
//   3. Una entidad sin nada: el diálogo explica qué se pierde y el botón de borrar solo se
//      enciende al escribir la palabra («esborrar» / «borrar»); entonces borra la ficha y
//      retira la organización.

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const LLETRES = 'TRWAGMYFPDXBNJZSQVHLCKE'
const dni = (n: number) => { const s = String(Math.floor(n) % 1e8).padStart(8, '0'); return s + LLETRES[Number(s) % 23] }

let marca = ''
let orgOfertes = ''
let prodOfertes = ''
let orgNeta = ''
let entNeta = ''

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'de datos: una sola pasada')
})

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin') !== null || info.project.name !== 'escriptori') return
  const ara = Date.now()
  marca = String(ara)
  const nomOfertes = `E2E esborrar ofertes ${marca}`
  const nomNeta = `E2E esborrar neta ${marca}`
  ;[prodOfertes, orgOfertes] = sql(`insert into productores (name, empresa, nif, razon_social, es_test)
    values ('Persona E2E', '${nomOfertes}', '${dni(ara / 11)}', '${nomOfertes} SL', true)
    returning id || '|' || organizacion_id`).split('\n')[0].split('|')
  sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-ESB-${marca}', '${prodOfertes}', 'Tomàquet', 10, 'cancelada', 'asistido', 'donacio', '{donacio}', current_date + 5, '[E2E] esborrar', '[E2E]')`)
  ;[entNeta, orgNeta] = sql(`insert into entidades (nombre, razon_social, nif, tipo_receptor, es_test)
    values ('${nomNeta}', '${nomNeta} SL', '${dni(ara / 11 + 1)}', 'social', true)
    returning id || '|' || organizacion_id`).split('\n')[0].split('|')
})

test.afterAll(() => {
  if (!marca) return
  // La oferta bloquea el borrado (es lo que se prueba): se quita a mano para poder limpiar.
  if (prodOfertes) {
    sql(`delete from excedentes where productor_id = '${prodOfertes}'`)
    sql(`select borrar_ficha_completa('productor', '${prodOfertes}', true)`)
  }
  if (entNeta && sql(`select count(*) from entidades where id = '${entNeta}'`) !== '0') {
    sql(`select borrar_ficha_completa('entidad', '${entNeta}', true)`)
  }
})

test('la RPC no esborra una fitxa amb ofertes', () => {
  expect(() => sqlCom('super_admin', `select borrar_ficha_completa('productor', '${prodOfertes}', true)`))
    .toThrow(/bloqueig_esborrat: ofertes/)
  expect(sql(`select count(*) from productores where id = '${prodOfertes}'`)).toBe('1')
})

test('amb ofertes: diu per què i proposa desactivar-la', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${orgOfertes}?pestanya=intern`)
  await page.getByRole('button', { name: /^Esborra l’entitat$|^Borra la entidad$/ }).click()

  const dialeg = page.getByTestId('dialeg-esborrar')
  await expect(dialeg).toContainText(/No es pot esborrar|No se puede borrar/)
  await expect(dialeg.getByTestId('esborrar-motius')).toContainText(/té ofertes|tiene ofertas/)
  // No hay camino de borrado: ni campo para la palabra ni botón de borrar.
  await expect(dialeg.locator('#esborrar-paraula')).toHaveCount(0)
  await expect(dialeg.getByRole('button', { name: /Esborra definitivament|Borrar definitivamente/ })).toHaveCount(0)

  await dialeg.getByRole('button', { name: /^Desactiva l’entitat$|^Desactiva la entidad$/ }).click()
  await expect(dialeg).toBeHidden()
  await expect(page.getByTestId('estat-entitat-badge')).toHaveText(/^Inactiva$/)
  expect(sql(`select activo from productores where id = '${prodOfertes}'`)).toBe('f')

  // Ya inactiva: lo dice y no ofrece nada más.
  await page.getByRole('button', { name: /^Esborra l’entitat$|^Borra la entidad$/ }).click()
  await expect(dialeg).toContainText(/Ja està inactiva|Ya está inactiva/)
  await expect(dialeg.getByRole('button', { name: /Desactiva/ })).toHaveCount(0)
})

test('sense res: explica què es perd i demana escriure la paraula', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${orgNeta}?pestanya=intern`)
  await page.getByRole('button', { name: /^Esborra l’entitat$|^Borra la entidad$/ }).click()

  const dialeg = page.getByTestId('dialeg-esborrar')
  const consequencies = dialeg.getByTestId('esborrar-consequencies')
  await expect(consequencies).toContainText(/S’esborra la fitxa receptora|Se borra la ficha receptora/)
  await expect(consequencies).toContainText(/es retira si es queda sense cap paper|se retira si se queda sin ningún papel/)
  await expect(consequencies).toContainText(/No es pot desfer|No se puede deshacer/)
  await expect(dialeg).toContainText(/El recomanable és desactivar-la|Lo recomendable es desactivarla/)
  await expect(dialeg.getByRole('button', { name: /^Desactiva l’entitat$|^Desactiva la entidad$/ })).toBeVisible()

  const esborra = dialeg.getByRole('button', { name: /Esborra definitivament|Borrar definitivamente/ })
  await expect(esborra).toBeDisabled()
  // La palabra sale en la etiqueta, en el idioma de la cuenta.
  const etiqueta = await dialeg.locator('label[for="esborrar-paraula"]').innerText()
  const paraula = /«(.+)»/.exec(etiqueta)?.[1] ?? ''
  expect(['esborrar', 'borrar']).toContain(paraula)
  await dialeg.locator('#esborrar-paraula').fill(paraula.slice(0, -1))
  await expect(esborra).toBeDisabled()
  await dialeg.locator('#esborrar-paraula').fill(` ${paraula.toUpperCase()} `)
  await expect(esborra).toBeEnabled()

  await esborra.click()
  await page.waitForURL(/\/equip\/entitats$/)
  expect(sql(`select count(*) from entidades where id = '${entNeta}'`)).toBe('0')
  expect(sql(`select count(*) from organizaciones where id = '${orgNeta}'`)).toBe('0')
})
