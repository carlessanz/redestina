// La recogida en un acto (puntos 4-6, fase 3; 20270608100000-20270608100400), desde la ficha de
// la oferta del equipo:
//
//   a. El super_admin asigna una DONACIÓN en un acto y, desde «Canalitzacions assignades»,
//      «Registrar la recollida»: salen el ENT y el REC PROPIO de esa recogida, emitidos y
//      conciliados en el mismo acto, y la oferta queda cerrada.
//   b. Dos recogidas de la misma oferta: dos REC, uno por canalización.
//   c. Una VENTA con el precio aceptado: registrar la deja conciliada SIN albarán y cierra la oferta.
//
// Solo contra el CLON LOCAL y en escritorio: emitir un albarán consume numeración legal
// (`ENT`/`REC`), que no se puede devolver. Lo que no tiene número (la venta) se borra al acabar;
// las donaciones quedan cerradas y marcadas «[E2E]», como en `recollida.e2e.ts`
// (`scripts/local/cargar-local.sh` devuelve el clon a la copia de producción).

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom, triaCercador } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
const marca = Date.now()
const BOTO_ASSIGNAR = /Registrar i confirmar recollida|Registrar y confirmar recogida/
const BOTO_REGISTRAR = /^Registrar la recollida$|^Registrar la recogida$/
// La venta: productor y compradora de prueba del clon con los convenios vigentes.
const PRODUCTOR_VENDA = '1c3f4274-cae5-47f3-b1a3-503045e5d7be' // Laura Masdeu
const COMPRADORA = '11cdfdbb-37c4-4a70-bcb1-6d0c9c251b58' // Comercial de Prova SL
/** La oferta del caso a, para mirarla a 360 px al final. */
let ofertaA = ''

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'productor', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'escriu al clon: una sola passada')
})

/** Una oferta publicada de prueba. */
function novaOferta(sufix: string, productor: string, modalitat: 'donacio' | 'venda', kg: number, preuMinim: number | null): string {
  return sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, preu_minim, coste_kg, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-RA-${sufix}-${marca}', '${productor}', 'Carbassa', ${kg}, 'publicada', 'asistido', '${modalitat}', '{${modalitat}}', ${preuMinim ?? 'null'}, 0.5, current_date + 5, '[E2E] recollida en un acte', '[E2E] Carbassa')
    returning id`).split('\n')[0]
}

/** Los enlaces de albaranes viejos sin usar bloquean a la receptora (G1): no es lo que se prueba. */
function desbloqueja(ent: string) {
  sql(`update enlaces_token t set estado = 'revocado'
         from albaranes a join canalizaciones c on c.id = a.canalizacion_id
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id and t.estado = 'activo'
          and t.usado_at is null and c.entidad_id = '${ent}'`)
}

/**
 * «Registrar la recollida» desde la fila de la canalización: el diálogo asistido, con los kilos
 * asignados y «Coincideixen» ya marcados, y «Registra i valida».
 */
async function registraDesDeLaFila(page: Page, fila: ReturnType<Page['getByTestId']>) {
  await fila.getByRole('button', { name: BOTO_REGISTRAR }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg).toBeVisible()
  const form = dlg.getByTestId('registra-recollida')
  await expect(form).toBeVisible({ timeout: 30_000 })
  await form.getByRole('button', { name: /^Registra i valida$|^Registra y valida$/ }).click()
  await expect(dlg.getByTestId('recollida-validada')).toBeVisible({ timeout: 30_000 })
  return dlg
}

/** Los elementos que se salen por la derecha de la ventana (el patrón de `signatures.e2e.ts`). */
async function desbordaments(el: Locator): Promise<string[]> {
  return el.evaluate((root) => [root, ...root.querySelectorAll('*')]
    .filter((n) => {
      const r = n.getBoundingClientRect()
      return r.width > 0 && r.right > window.innerWidth + 1
    })
    .map((n) => `${n.tagName}.${(n as HTMLElement).className}`.slice(0, 120)))
}

/** Cierra el diálogo (no se cierra al pinchar fuera: con Escape). */
async function tanca(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('a. donació: assignar en un acte i registrar la recollida → ENT i REC propis, conciliats; oferta tancada', async ({ page }) => {
  const ent = entidadDe(RECEPTOR)
  desbloqueja(ent)
  const oferta = novaOferta('A', productorDe('productor'), 'donacio', 80, null)
  ofertaA = oferta
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${oferta}`)

  // Asignar los 80 kg en un acto.
  const form = page.locator('#od-interes')
  await expect(form.getByRole('button', { name: BOTO_ASSIGNAR })).toBeVisible({ timeout: 30_000 })
  await triaCercador(form.locator('#od-interes-entitat'), sql(`select nombre from entidades where id = '${ent}'`), ent)
  await form.locator('#od-interes-kg').fill('80')
  await form.getByRole('button', { name: BOTO_ASSIGNAR }).click()
  await expect(page.getByText(/Assignació registrada i confirmada|Asignación registrada y confirmada/)).toBeVisible()
  const canal = sql(`select id from canalizaciones where excedente_id = '${oferta}' and estado <> 'anulada'`)
  expect(canal).toMatch(/^[0-9a-f-]{36}$/)
  // Al asignar nacen el ENT y SU REC, en borrador y colgando de la canalización.
  await expect.poll(() => sql(`select string_agg(tipo || ':' || estado || ':' || (canalizacion_id = '${canal}'), ',' order by tipo)
    from albaranes where excedente_id = '${oferta}' and estado <> 'anulado'`)).toBe('ENT:borrador:true,REC:borrador:true')

  // «Registrar la recollida» desde «Canalitzacions assignades».
  const fila = page.getByTestId('od-canalitzacio').first()
  const dlg = await registraDesDeLaFila(page, fila)
  // Los dos albaranes de la recogida, en el diálogo, con su PDF a mano.
  await expect(dlg.getByTestId('albara-recollida')).toHaveCount(2, { timeout: 30_000 })

  // En la base: emitidos, entregados, confirmados y conciliados en el mismo acto.
  expect(sql(`select string_agg(tipo || ':' || estado || ':' || (numero_completo is not null), ',' order by tipo)
    from albaranes where excedente_id = '${oferta}' and estado <> 'anulado'`)).toBe('ENT:conciliado:true,REC:conciliado:true')
  expect(sql(`select estado || ':' || (kg_conciliados = 80) from canalizaciones where id = '${canal}'`)).toBe('conciliada:true')
  await expect.poll(() => sql(`select estado from excedentes where id = '${oferta}'`)).toBe('cerrada')

  // La ficha enseña la salida y el REC de esa recogida, con su número.
  await tanca(page)
  await expect(fila.getByTestId('od-albara-sortida')).toHaveText(/ENT/)
  await expect(fila.getByTestId('od-albara-rec')).toHaveText(/REC/)
})

test('b. dues recollides de la mateixa oferta → dos REC, un per canalització', async ({ page }) => {
  const ent1 = entidadDe(RECEPTOR)
  // Otra receptora social de prueba con el convenio vigente.
  const ent2 = sql(`select e.id from entidades e
    where e.es_test and e.activo and e.tipo_receptor = 'social' and e.id <> '${ent1}'
      and exists (select 1 from convenios c where c.entidad_id = e.id and c.tipo = 'col_receptor' and c.estado = 'vigent')
    order by e.nombre limit 1`)
  test.skip(!ent2, 'cap segona receptora social de prova amb conveni vigent')
  desbloqueja(ent1)
  desbloqueja(ent2)
  const oferta = novaOferta('B', productorDe('productor'), 'donacio', 100, null)
  // Las dos asignaciones, como las deja el equipo (lo de la pantalla ya lo cubre el caso a).
  for (const ent of [ent1, ent2]) {
    const resp = sql(`insert into oferta_respuestas (excedente_id, entidad_id, telefono, canal, estado, aprovacio, kg_solicitados, enviado_at, respondido_at)
      values ('${oferta}', '${ent}', '34600000000', 'panel', 'acceptada', 'pendent', 50, now(), now()) returning id`).split('\n')[0]
    sqlCom('super_admin', `select (aprovar_resposta('${resp}', 50, null, null, null,
        ((current_date + 1) + time '10:00') at time zone 'Europe/Madrid')).id`)
  }
  sql(`update canalizaciones set data_hora_recollida = now() - interval '1 hour' where excedente_id = '${oferta}'`)
  expect(sql(`select count(*) from albaranes where excedente_id = '${oferta}' and tipo = 'REC' and canalizacion_id is not null`)).toBe('2')

  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${oferta}`)
  const files = page.getByTestId('od-canalitzacio')
  await expect(files).toHaveCount(2, { timeout: 30_000 })
  for (let i = 0; i < 2; i++) {
    // Siempre la primera que todavía tiene el botón: la otra ya está validada.
    const fila = files.filter({ has: page.getByRole('button', { name: BOTO_REGISTRAR }) }).first()
    await registraDesDeLaFila(page, fila)
    await tanca(page)
  }

  expect(sql(`select count(distinct canalizacion_id) || ':' || count(*) filter (where estado = 'conciliado' and numero_completo is not null)
    from albaranes where excedente_id = '${oferta}' and tipo = 'REC' and estado <> 'anulado'`)).toBe('2:2')
  expect(sql(`select count(*) from albaranes where excedente_id = '${oferta}' and tipo = 'REC' and canalizacion_id is null`)).toBe('0')
  await expect.poll(() => sql(`select estado from excedentes where id = '${oferta}'`)).toBe('cerrada')
})

test('c. venda amb el preu acceptat: registrar la deixa conciliada sense albarà i tanca l’oferta', async ({ page }) => {
  desbloqueja(COMPRADORA)
  const oferta = novaOferta('C', PRODUCTOR_VENDA, 'venda', 40, 0.5)
  try {
    await entra(page, 'super_admin')
    await page.goto(`/equip/ofertes/${oferta}`)
    const form = page.locator('#od-interes')
    const boto = form.getByRole('button', { name: BOTO_ASSIGNAR })
    await expect(boto).toBeVisible({ timeout: 30_000 })
    await triaCercador(form.locator('#od-interes-entitat'), sql(`select nombre from entidades where id = '${COMPRADORA}'`), COMPRADORA)
    await form.locator('#od-interes-kg').fill('40')
    await expect(form.locator('#od-interes-preu')).toBeVisible()
    await form.getByText(/L’ofertant ha acceptat el preu|El ofertante ha aceptado el precio/).click()
    await boto.click()
    await expect(page.getByText(/Assignació registrada i confirmada|Asignación registrada y confirmada/)).toBeVisible()
    const canal = sql(`select id from canalizaciones where excedente_id = '${oferta}' and estado <> 'anulada'`)
    expect(canal).toMatch(/^[0-9a-f-]{36}$/)
    // Sin albarán: ni OPE ni REC.
    expect(sql(`select count(*) from albaranes where excedente_id = '${oferta}' and estado <> 'anulado'`)).toBe('0')

    const fila = page.getByTestId('od-canalitzacio').first()
    await expect(fila.getByTestId('od-registre-venda')).toBeVisible()
    await registraDesDeLaFila(page, fila)
    expect(sql(`select estado || ':' || (kg_conciliados = 40) from canalizaciones where id = '${canal}'`)).toBe('conciliada:true')
    expect(sql(`select count(*) from albaranes where excedente_id = '${oferta}' and estado <> 'anulado'`)).toBe('0')
    await expect.poll(() => sql(`select estado from excedentes where id = '${oferta}'`)).toBe('cerrada')

    // La fila enseña el registro y deja colgar documentos propios de la recogida.
    await tanca(page)
    await expect(fila.getByTestId('od-registre-venda')).toHaveText(/40/)
    await expect(fila.getByRole('button', { name: /^Documents$|^Documentos$/ })).toBeVisible()
  } finally {
    // Sin número legal: se puede borrar entero. Si algo lo impide, se deja cancelada.
    try {
      sql(`delete from avisos where (params->>'excedente_id') = '${oferta}';
           delete from documentos_externos where objeto_tipo = 'canalizacion'
             and objeto_id in (select id from canalizaciones where excedente_id = '${oferta}');
           delete from albaranes where excedente_id = '${oferta}' and numero_completo is null;
           update oferta_respuestas set canalizacion_id = null where excedente_id = '${oferta}';
           delete from canalizaciones where excedente_id = '${oferta}';
           delete from oferta_respuestas where excedente_id = '${oferta}';
           delete from excedentes where id = '${oferta}';`)
    } catch {
      try {
        sql(`update excedentes set observacions = '[E2E] recollida en un acte (no esborrada)' where id = '${oferta}'`)
      } catch { /* ya no existe */ }
    }
  }
})

test('d. a 360 px: la fitxa, els albarans de la recollida, l’albarà i Aprovacions no desborden', async ({ page }) => {
  test.skip(!ofertaA, 'depèn del cas a')
  await entra(page, 'super_admin')
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto(`/equip/ofertes/${ofertaA}`)
  const fila = page.getByTestId('od-canalitzacio').first()
  await expect(fila).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => desbordaments(page.locator('body')), { message: 'fitxa de l’oferta' }).toEqual([])
  await fila.getByRole('button', { name: /^Albarans$|^Albaranes$/ }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByTestId('albara-recollida')).toHaveCount(2, { timeout: 30_000 })
  await expect.poll(() => desbordaments(dlg), { message: 'diàleg de la recollida' }).toEqual([])
  await tanca(page)

  const rec = sql(`select id from albaranes where excedente_id = '${ofertaA}' and tipo = 'REC' and estado <> 'anulado'`)
  await page.goto(`/equip/albarans/${rec}`)
  await expect(page.getByTestId('albara-oferta')).toBeVisible({ timeout: 30_000 })
  // Un REC propio: concilia solo y lista su ENT hermano.
  await expect(page.getByTestId('albara-germa')).toHaveCount(1)
  await expect.poll(() => desbordaments(page.locator('body')), { message: 'detall de l’albarà' }).toEqual([])

  await page.goto('/equip/aprovacions')
  await expect(page.locator('#recollides-equip')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => desbordaments(page.locator('body')), { message: 'Aprovacions' }).toEqual([])
})
