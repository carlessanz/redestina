// La ESPIGOLADA es una oferta de donación más (fase 3 del plan de noviembre de 2026, procesos 3.6,
// 3.5 C y 3.4). Ya no crea jornada ni lotes: se asigna, se registra la recogida y se validan su ENT
// y su REC como cualquier donación. Lo que se afirma, en orden (modo serie):
//
//   1. Alta ASISTIDA desde Ofertes: «Espigolada» solo aparece al decir que el producto sigue en el
//      campo; marcada, la oferta nace publicada, de donación, con `tipus_operacio = 'espigolada'`
//      y SIN jornada (`espigolada_id` vacío, ninguna fila nueva en `espigoladas`). La ficha
//      enseña el badge «Espigolada».
//   2. Asignación directa a una entidad SOCIAL y «Registrar la recollida» desde la fila: salen el
//      ENT y el REC de esa recogida, emitidos y conciliados; la oferta queda cerrada.
//   3. Edición de otra oferta «ja collit» → «al camp» → «Espigolada» (proceso 3.4): viaja
//      `canvis.espigolada` y la oferta pasa a donación con el producto en el campo.
//   4. `/equip/espigolades` (enlaces viejos) lleva a Ofertes.
//
// Solo contra el CLON LOCAL y en escritorio: emite numeración legal (ENT/REC). La oferta del paso
// 1 queda cerrada (como en `recollida-un-acte.e2e.ts`); la del paso 3, cancelada al acabar.
//
//   E2E_CLON=1 E2E_ESCRIU=1 npx playwright test tests/e2e/espigolada-oferta.e2e.ts --project escriptori
//   (con E2E_CAPTURES=<carpeta>, una captura por paso)

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join } from 'node:path'
import {
  asseguraConveniVigent, entidadDe, entra, motiuSaltClon, productorDe, sql, triaCercador,
} from './ajuda'

test.describe.configure({ mode: 'serial' })

const OFERTANT = 'productor'
const SOCIAL = 'receptor-social'
const BOTO_ASSIGNAR = /Registrar i confirmar recollida|Registrar y confirmar recogida/
const BOTO_REGISTRAR = /^Registrar la recollida$|^Registrar la recogida$/
const marca = Date.now()
const OBSERVACIONS = `[E2E] espigolada ${marca}`
const inici = new Date().toISOString()

let oferta = ''
let editada = ''

/** Una captura del paso si se ha pedido (`E2E_CAPTURES`); si no, nada. */
async function captura(page: Page, nom: string) {
  const dir = process.env.E2E_CAPTURES
  if (dir) await page.screenshot({ path: join(dir, `espigolada-${nom}.png`), fullPage: true })
}

/** Los enlaces de albaranes viejos sin usar bloquean a la receptora (G1): no es lo que se prueba. */
function desbloqueja(ent: string) {
  sql(`update enlaces_token t set estado = 'revocado'
         from albaranes a join canalizaciones c on c.id = a.canalizacion_id
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id and t.estado = 'activo'
          and t.usado_at is null and c.entidad_id = '${ent}'`)
}

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin', OFERTANT, SOCIAL) || info.project.name !== 'escriptori') return
  if (process.env.E2E_ESCRIU !== '1') return
  asseguraConveniVigent('productor', productorDe(OFERTANT))
  asseguraConveniVigent('entidad', entidadDe(SOCIAL))
  desbloqueja(entidadDe(SOCIAL))
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', OFERTANT, SOCIAL)
  test.skip(m !== null, m ?? '')
  test.skip(process.env.E2E_ESCRIU !== '1', 'Escriu al clon: només amb E2E_ESCRIU=1')
  test.skip(info.project.name !== 'escriptori', 'Emet numeració: una sola passada, a escriptori')
})

test('1. alta assistida amb «Espigolada»: donació, sense jornada, amb el badge', async ({ page }) => {
  const prod = productorDe(OFERTANT)
  const lloc = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  expect(lloc, 'la ofertante necesita un lugar principal').toMatch(/^[0-9a-f-]{36}$/)
  const familia = sql(`select familia from productos where nombre = 'Carbassa'`)
  const jornades = sql(`select count(*) from espigoladas`)
  await entra(page, 'super_admin')
  // El alta a medias en este navegador (lo que hace el propio formulario al escribir), con el
  // producto YA COLLIT: así se ve que «Espigolada» no se ofrece hasta decir que sigue en el campo.
  await page.evaluate(([k, l, f, obs]) => {
    localStorage.setItem(k, JSON.stringify({
      datos: {
        familia: f, producte: 'Carbassa', producte_al_camp: 'no', kg: 120, format_entrega: 'caixes', retorn: 'No',
        ubicacio: l, horari: { inici: '08:00', fi: '13:00' }, disponible_fins: '31/12/2027', causa: 'C4.2',
        observacions: obs,
      },
      pas: 0, pasMaxim: 99, costTocat: true, proposats: [], canviaLloc: false, desat: Date.now(),
    }))
  }, [`redestina-oferta-esborrany:${prod}`, lloc, familia, OBSERVACIONS])

  await page.goto('/equip/ofertes')
  await page.getByRole('button', { name: /^Nova oferta assistida$|^Nueva oferta asistida$/ }).first().click()
  const dlg = page.getByRole('dialog')
  await triaCercador(dlg.locator('#dnoa-productor'), sql(`select coalesce(empresa, name) from productores where id = '${prod}'`), prod)
  await expect(dlg.getByTestId('formulari-oferta')).toBeVisible({ timeout: 30_000 })

  // Ja collit: no hay «Espigolada».
  await expect(dlg.getByTestId('of-espigolada')).toHaveCount(0)
  // Al camp: aparece.
  await dlg.locator('#of-producte_al_camp [data-valor="si"]').click()
  await expect(dlg.getByTestId('of-espigolada')).toBeVisible()
  await dlg.getByTestId('of-espigolada').getByRole('checkbox').click()
  await expect(dlg.getByTestId('of-espigolada').getByRole('checkbox')).toBeChecked()
  await captura(page, '1-alta')
  await dlg.getByRole('button', { name: /^Publicar oferta$/ }).click()

  const meva = `from excedentes where productor_id = '${prod}' and observacions = '${OBSERVACIONS}' and created_at >= '${inici}'`
  await expect.poll(() => sql(`select count(*) ${meva}`), { timeout: 20_000 }).toBe('1')
  oferta = sql(`select id ${meva}`)
  expect(sql(`select estado || '|' || tipus_operacio || '|' || espigolada_demanada || '|' || producte_al_camp || '|'
                || array_to_string(modalitats, ',') || '|' || coalesce(espigolada_id::text, '-') from excedentes where id = '${oferta}'`))
    .toBe('publicada|espigolada|true|true|donacio|-')
  // Ninguna jornada nueva: `crear_espigolada` ya no se llama.
  expect(sql(`select count(*) from espigoladas`)).toBe(jornades)
  // El texto que circula lo dice.
  expect(sql(`select texto_oferta from excedentes where id = '${oferta}'`)).toContain('🌱 ESPIGOLADA')

  // La ficha del equipo: el badge y la asignación, como cualquier donación.
  await expect(page).toHaveURL(new RegExp(`/equip/ofertes/${oferta}`), { timeout: 30_000 })
  await expect(page.getByTestId('badge-espigolada')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('#od-interes').getByRole('button', { name: BOTO_ASSIGNAR })).toBeVisible()
  await captura(page, '1-fitxa')
})

test('2. assignació directa a una entitat social i recollida registrada i validada: ENT i REC', async ({ page }) => {
  test.skip(!oferta, 'depèn del pas 1')
  const ent = entidadDe(SOCIAL)
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${oferta}`)
  const form = page.locator('#od-interes')
  await expect(form.getByRole('button', { name: BOTO_ASSIGNAR })).toBeVisible({ timeout: 30_000 })
  await triaCercador(form.locator('#od-interes-entitat'), sql(`select nombre from entidades where id = '${ent}'`), ent)
  await form.locator('#od-interes-kg').fill('120')
  await form.getByRole('button', { name: BOTO_ASSIGNAR }).click()
  await expect(page.getByText(/Assignació registrada i confirmada|Asignación registrada y confirmada/)).toBeVisible()
  const canal = sql(`select id from canalizaciones where excedente_id = '${oferta}' and estado <> 'anulada'`)
  expect(canal).toMatch(/^[0-9a-f-]{36}$/)
  expect(sql(`select valorizacion from canalizaciones where id = '${canal}'`)).toBe('donacio')
  // Nacen el ENT y SU REC, en borrador, colgando de la canalización (no un REC de jornada).
  await expect.poll(() => sql(`select string_agg(tipo || ':' || estado || ':' || (canalizacion_id = '${canal}'), ',' order by tipo)
    from albaranes where excedente_id = '${oferta}' and estado <> 'anulado'`)).toBe('ENT:borrador:true,REC:borrador:true')

  // «Registrar la recollida» desde la fila, como cualquier donación.
  const fila = page.getByTestId('od-canalitzacio').first()
  await fila.getByRole('button', { name: BOTO_REGISTRAR }).click()
  const dlg = page.getByRole('dialog')
  const reg = dlg.getByTestId('registra-recollida')
  await expect(reg).toBeVisible({ timeout: 30_000 })
  await reg.getByRole('button', { name: /^Registra i valida$|^Registra y valida$/ }).click()
  await expect(dlg.getByTestId('recollida-validada')).toBeVisible({ timeout: 30_000 })
  await expect(dlg.getByTestId('albara-recollida')).toHaveCount(2, { timeout: 30_000 })
  await captura(page, '2-validada')

  expect(sql(`select string_agg(tipo || ':' || estado || ':' || (numero_completo is not null), ',' order by tipo)
    from albaranes where excedente_id = '${oferta}' and estado <> 'anulado'`)).toBe('ENT:conciliado:true,REC:conciliado:true')
  expect(sql(`select estado || ':' || (kg_conciliados = 120) from canalizaciones where id = '${canal}'`)).toBe('conciliada:true')
  await expect.poll(() => sql(`select estado from excedentes where id = '${oferta}'`)).toBe('cerrada')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(fila.getByTestId('od-albara-sortida')).toHaveText(/ENT/)
  await expect(fila.getByTestId('od-albara-rec')).toHaveText(/REC/)
})

test('3. edició: ja collit → al camp → «Espigolada»', async ({ page }) => {
  const prod = productorDe(OFERTANT)
  editada = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, preu_minim, coste_kg, disponible_hasta, producte_al_camp, observacions, texto_oferta)
    values ('E-E2E-ESP-${marca}', '${prod}', 'Avellana', 150, 'publicada', 'asistido', 'donacio', '{donacio,venda}', 0.3, 0.5, current_date + 5, false, '[E2E] edició espigolada', '[E2E] Avellana')
    returning id`).split('\n')[0]
  try {
    await entra(page, 'super_admin')
    await page.goto(`/equip/ofertes/${editada}`)
    await expect(page.getByTestId('badge-espigolada')).toHaveCount(0)
    await page.getByRole('button', { name: /^Edita l’oferta$|^Edita la oferta$/ }).click()
    const dlg = page.getByTestId('dialeg-edicio')
    await expect(dlg.getByTestId('producte-fix')).toContainText('Avellana', { timeout: 30_000 })
    // Ja collit: sin «Espigolada».
    await expect(dlg.getByTestId('of-espigolada')).toHaveCount(0)
    await dlg.locator('#of-producte_al_camp [data-valor="si"]').click()
    await expect(dlg.getByTestId('of-espigolada')).toBeVisible()
    await dlg.getByTestId('of-espigolada').getByRole('checkbox').click()
    await captura(page, '3-edicio')
    await dlg.getByRole('button', { name: /^Desa els canvis$|^Guardar los cambios$/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })

    await expect.poll(() => sql(`select tipus_operacio || '|' || espigolada_demanada || '|' || producte_al_camp || '|'
      || array_to_string(modalitats, ',') || '|' || modalitat from excedentes where id = '${editada}'`))
      .toBe('espigolada|true|true|donacio|donacio')
    expect(sql(`select texto_oferta from excedentes where id = '${editada}'`)).toContain('🌱 ESPIGOLADA')
    await expect(page.getByTestId('badge-espigolada')).toBeVisible({ timeout: 30_000 })
    await captura(page, '3-fitxa')
  } finally {
    sql(`update excedentes set estado = 'cancelada' where id = '${editada}'`)
  }
})

test('4. /equip/espigolades porta a Ofertes', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/espigolades')
  await expect(page).toHaveURL(/\/equip\/ofertes$/)
  await page.goto('/equip/espigolades/00000000-0000-0000-0000-000000000000')
  await expect(page).toHaveURL(/\/equip\/ofertes$/)
  // Y el menú ya no la ofrece.
  await expect(page.getByRole('link', { name: /^Espigolades$|^Espigueos$/ })).toHaveCount(0)
})

test('5. a 360 px: la fitxa amb el badge i el diàleg d’edició amb «Espigolada» no desborden', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  const prod = productorDe(OFERTANT)
  const id = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, coste_kg, disponible_hasta, producte_al_camp, espigolada_demanada, observacions, texto_oferta)
    values ('E-E2E-ESP360-${marca}', '${prod}', 'Avellana', 150, 'publicada', 'asistido', 'donacio', '{donacio}', 0.5, current_date + 5, true, true, '[E2E] espigolada 360', '[E2E] Avellana')
    returning id`).split('\n')[0]
  /** Los elementos de `main` que se salen por la derecha de la ventana. */
  const fora = () => page.evaluate(() => [...document.querySelectorAll('main *')]
    .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 })
    .map((n) => `${n.tagName}.${(n as HTMLElement).className}`.slice(0, 120)))
  try {
    await entra(page, 'super_admin')
    await page.goto(`/equip/ofertes/${id}`)
    await expect(page.getByTestId('badge-espigolada')).toBeVisible({ timeout: 30_000 })
    expect(await fora()).toEqual([])
    await captura(page, '5-fitxa-360')
    await page.getByRole('button', { name: /^Edita l’oferta$|^Edita la oferta$/ }).click()
    const dlg = page.getByTestId('dialeg-edicio')
    await expect(dlg.getByTestId('of-espigolada').getByRole('checkbox')).toBeChecked({ timeout: 30_000 })
    await dlg.getByTestId('of-espigolada').scrollIntoViewIfNeeded()
    const [sw, cw] = await dlg.evaluate((el) => [el.scrollWidth, el.clientWidth])
    expect(sw).toBeLessThanOrEqual(cw)
    await captura(page, '5-edicio-360')
  } finally {
    sql(`update excedentes set estado = 'cancelada' where id = '${id}'`)
  }
})
