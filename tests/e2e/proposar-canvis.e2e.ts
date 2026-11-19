// Proponer cambios a un interés (fase 5 de los puntos 4-6, Excel 5.2 nivel 2; 20270610100000) y
// los contadores en vivo (20270610100200):
//
//   (a) El super_admin propone otros kilos desde Aprovacions → la entidad entra por el enlace
//       directo `/receptor/interessos?resposta=<id>` y la acepta → canalización confirmada.
//   (b) Propone → la entidad la rechaza con motivo → el interés vuelve a la cola de Aprovacions
//       con el motivo a la vista.
//   (c) El técnico ve la cola pero no «Proposa canvis».
//   (d) El badge de Aprovacions sube sin navegar cuando entra un interés nuevo (Realtime).
//   (e) A 360 px: el diálogo de la propuesta, la ficha de la oferta y la tarjeta y el diálogo de
//       la entidad no desbordan.
//
// Solo contra el CLON LOCAL y en escritorio (escribe). Lo que crea se anula o se cancela.

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
const marca = Date.now()
const ofertes: string[] = []
const estat: { a?: { oferta: string; ref: string; resposta: string }; b?: { oferta: string; ref: string; resposta: string } } = {}

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'productor', 'equip', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'escriu al clon: una sola passada')
})

test.afterAll(() => {
  if (motiuSaltClon('super_admin', 'productor', RECEPTOR) !== null) return
  for (const o of ofertes) {
    // Lo asignado se anula (como en la aplicación) y la oferta se cancela.
    for (const c of sql(`select id from canalizaciones where excedente_id = '${o}' and estado <> 'anulada'`).split('\n').filter(Boolean)) {
      try { sqlCom('superadmin', `select id from anular_assignacio('${c}', 'Prova E2E: neteja')`) } catch { /* ya no se puede: se queda */ }
    }
    sql(`update oferta_respuestas set aprovacio = 'rebutjada', motiu_aprovacio = 'Prova E2E'
          where excedente_id = '${o}' and aprovacio in ('pendent', 'proposada')`)
    sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${o}'`)
  }
})

/** Una oferta de donación publicada, con franja, y el interés de la receptora por 80 kg. */
function ofertaAmbInteres(sufix: string): { oferta: string; ref: string; resposta: string } {
  const prod = productorDe('productor')
  const ent = entidadDe(RECEPTOR)
  // Albaranes viejos de esta receptora con el enlace sin usar la bloquean (G1): no es lo que se prueba.
  sql(`update enlaces_token t set estado = 'revocado'
         from albaranes a join canalizaciones c on c.id = a.canalizacion_id
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id and t.estado = 'activo'
          and t.usado_at is null and c.entidad_id = '${ent}'`)
  const ref = `E-E2E-PC-${sufix}-${marca}`
  const oferta = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, coste_kg, disponible_hasta, hora_recollida_inici, hora_recollida_fi, observacions, texto_oferta)
    values ('${ref}', '${prod}', 'Avellana', 150, 'publicada', 'asistido', 'donacio', '{donacio}', 0.5, current_date + 5, '09:00', '13:00', '[E2E] proposar canvis', '[E2E] Avellana')
    returning id`).split('\n')[0]
  ofertes.push(oferta)
  const resposta = sql(`insert into oferta_respuestas (excedente_id, entidad_id, canal, estado, kg_solicitados, modalitat, respondido_at)
    values ('${oferta}', '${ent}', 'panel', 'acceptada', 80, 'donacio', now())
    returning id`).split('\n')[0]
  return { oferta, ref, resposta }
}

/** Aprovacions con el buscador puesto en la referencia de la oferta: solo queda su fila. */
async function filaAprovacio(page: Page, ref: string, resposta: string) {
  await page.goto('/equip/aprovacions')
  await page.locator('#appr-cerca').fill(ref)
  const fila = page.locator(`[data-testid="appr-resposta"][data-resposta="${resposta}"]`)
  await expect(fila).toBeVisible({ timeout: 30_000 })
  return fila
}

/** Los elementos que salen por la derecha de la ventana (0 = nada desborda). */
async function desbordaments(el: Locator): Promise<string[]> {
  return el.evaluate((root) => [root, ...root.querySelectorAll('*')]
    .filter((n) => {
      const r = n.getBoundingClientRect()
      return r.width > 0 && r.right > window.innerWidth + 1
    })
    .map((n) => `${n.tagName}.${(n as HTMLElement).className}`.slice(0, 120)))
}

/** El super_admin propone 60 kg (en vez de 80) con un motivo. */
async function proposa(page: Page, ref: string, resposta: string) {
  await entra(page, 'super_admin')
  const fila = await filaAprovacio(page, ref, resposta)
  await fila.getByRole('button', { name: /^Proposa canvis$|^Propón cambios$/ }).click()
  const dlg = page.getByTestId('dialeg-proposar-canvis')
  await expect(dlg).toBeVisible()
  // Precargado con lo que pidió la entidad.
  await expect(dlg.locator(`[id="appr-${resposta}-prop-kg"]`)).toHaveValue('80')
  // Sin cambiar nada ni motivo, no llama a la base.
  await dlg.getByRole('button', { name: /Envia la proposta|Envía la propuesta/ }).click()
  await expect(dlg.getByRole('alert')).toBeVisible()
  await dlg.locator(`[id="appr-${resposta}-prop-kg"]`).fill('60')
  await dlg.locator(`[id="appr-${resposta}-prop-motiu"]`).fill('Prova E2E: només en queden 60 kg de bons')
  await dlg.getByRole('button', { name: /Envia la proposta|Envía la propuesta/ }).click()
  await expect(page.getByText(/Proposta enviada a l’entitat|Propuesta enviada a la entidad/)).toBeVisible()
  await expect.poll(() => sql(`select aprovacio || ':' || proposta_kg::int || ':' || (proposta_original->>'kg_solicitados')
    from oferta_respuestas where id = '${resposta}'`)).toBe('proposada:60:80')
  // Sale de la cola: espera a la entidad.
  await expect(fila).toHaveCount(0)
  // Y la entidad tiene su aviso.
  expect(sql(`select count(*) from avisos where tipus = 'canvis_proposats' and objecte_id = '${resposta}'`)).toBe('1')
}

test('(a) el super_admin proposa canvis des d’Aprovacions', async ({ page }) => {
  estat.a = ofertaAmbInteres('A')
  await proposa(page, estat.a.ref, estat.a.resposta)
})

test('(a) l’entitat obre l’enllaç directe i l’accepta: canalització confirmada', async ({ page }) => {
  test.skip(!estat.a, 'depèn de la prova anterior')
  const { oferta, resposta } = estat.a!
  await entra(page, RECEPTOR)
  await page.goto(`/receptor/interessos?resposta=${resposta}`)
  const dlg = page.getByRole('dialog').filter({ has: page.getByTestId('proposta-entitat') })
  await expect(dlg).toBeVisible({ timeout: 30_000 })
  // Lo que pidió → lo propuesto, y el motivo.
  await expect(dlg.getByTestId('canvis-proposta')).toContainText('60')
  await expect(dlg.getByTestId('canvis-proposta')).toContainText('només en queden 60 kg')
  await dlg.getByTestId('proposta-entitat').getByRole('button', { name: /^Accepta$|^Acepta$/ }).click()
  const conf = page.getByRole('dialog').filter({ hasText: /Acceptar la proposta\?|¿Aceptar la propuesta\?/ })
  await conf.getByRole('button', { name: /^Accepta$|^Acepta$/ }).click()
  await expect(page.getByText(/Proposta acceptada: ja tens l’oferta assignada|Propuesta aceptada: ya tienes la oferta asignada/)).toBeVisible()
  await expect.poll(() => sql(`select aprovacio || ':' || proposta_resposta || ':' || kg_solicitados::int
    from oferta_respuestas where id = '${resposta}'`)).toBe('aprovada:acceptada:60')
  expect(sql(`select estado || ':' || kg_confirmados::int from canalizaciones where excedente_id = '${oferta}'`)).toBe('confirmada:60')
  // El enlace ya no lleva a nada: la propuesta está respondida.
  await page.goto(`/receptor/interessos?resposta=${resposta}`)
  await expect(page.getByTestId('proposta-no-disponible')).toBeVisible({ timeout: 30_000 })
})

test('(b) el super_admin proposa canvis a un altre interès', async ({ page }) => {
  estat.b = ofertaAmbInteres('B')
  await proposa(page, estat.b.ref, estat.b.resposta)
})

test('(b) l’entitat la rebutja amb motiu', async ({ page }) => {
  test.skip(!estat.b, 'depèn de la prova anterior')
  const { resposta } = estat.b!
  await entra(page, RECEPTOR)
  await page.goto(`/receptor/interessos?resposta=${resposta}`)
  const dlg = page.getByRole('dialog').filter({ has: page.getByTestId('proposta-entitat') })
  await expect(dlg).toBeVisible({ timeout: 30_000 })
  await dlg.getByTestId('proposta-entitat').getByRole('button', { name: /^Rebutja$|^Rechaza$/ }).click()
  const motiu = page.getByRole('dialog').filter({ has: page.locator('#dialeg-motiu') })
  await motiu.locator('#dialeg-motiu').fill('Prova E2E: necessitem els 80 kg')
  await motiu.getByRole('button', { name: /^Rebutja$|^Rechaza$/ }).click()
  await expect(page.getByText(/Proposta rebutjada|Propuesta rechazada/)).toBeVisible()
  await expect.poll(() => sql(`select aprovacio || ':' || proposta_resposta || ':' || kg_solicitados::int
    from oferta_respuestas where id = '${resposta}'`)).toBe('pendent:rebutjada:80')
})

test('(b) torna a la cua d’Aprovacions amb el motiu a la vista', async ({ page }) => {
  test.skip(!estat.b, 'depèn de la prova anterior')
  const { ref, resposta } = estat.b!
  await entra(page, 'super_admin')
  const fila = await filaAprovacio(page, ref, resposta)
  await expect(fila.getByTestId('proposta-rebutjada')).toContainText('necessitem els 80 kg')
  // Con lo que pidió, otra vez.
  await expect(fila.locator(`[id="appr-${resposta}-kg"]`)).toHaveValue('80')
})

test('(c) el tècnic no veu «Proposa canvis»', async ({ page }) => {
  test.skip(!estat.b, 'depèn de la prova (b): l’interès torna a ser a la cua')
  const { ref, resposta } = estat.b!
  await entra(page, 'equip')
  const fila = await filaAprovacio(page, ref, resposta)
  await expect(fila.getByRole('button', { name: /^Proposa canvis$|^Propón cambios$/ })).toHaveCount(0)
  // Y en la ficha de la oferta, tampoco.
  await page.goto(`/equip/ofertes/${estat.b!.oferta}`)
  await expect(page.getByText(/Avellana/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /^Proposa canvis$|^Propón cambios$/ })).toHaveCount(0)
})

test('(d) el badge d’Aprovacions puja sense navegar (Realtime)', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/tauler')
  const badge = page.locator('li', { has: page.locator('a[href="/equip/aprovacions"]') })
    .locator('[data-sidebar="menu-badge"]')
  const llegeix = async () => ((await badge.count()) > 0 ? Number(await badge.first().textContent()) : 0)
  // Espera a que los contadores hayan llegado (al entrar se piden una vez).
  await page.waitForLoadState('networkidle')
  const abans = await llegeix()
  // Otra «sesión»: un interés nuevo, escrito directamente en la base. La pantalla no se toca.
  ofertaAmbInteres('D')
  await expect.poll(llegeix, { timeout: 15_000 }).toBe(abans + 1)
})

test('(e) a 360 px: proposta, fitxa de l’oferta i targeta de l’entitat no desborden', async ({ page, browser }) => {
  const { oferta, ref, resposta } = ofertaAmbInteres('E')
  await entra(page, 'super_admin')
  await page.setViewportSize({ width: 360, height: 780 })
  const fila = await filaAprovacio(page, ref, resposta)
  await expect.poll(() => desbordaments(page.locator('body')), { message: 'Aprovacions' }).toEqual([])
  await fila.getByRole('button', { name: /^Proposa canvis$|^Propón cambios$/ }).click()
  const dlg = page.getByTestId('dialeg-proposar-canvis')
  await expect(dlg).toBeVisible()
  await expect.poll(() => desbordaments(dlg), { message: 'diàleg de la proposta' }).toEqual([])
  await dlg.locator(`[id="appr-${resposta}-prop-kg"]`).fill('70')
  await dlg.locator(`[id="appr-${resposta}-prop-motiu"]`).fill('Prova E2E: 360 px')
  await dlg.getByRole('button', { name: /Envia la proposta|Envía la propuesta/ }).click()
  await expect.poll(() => sql(`select aprovacio from oferta_respuestas where id = '${resposta}'`)).toBe('proposada')

  // La ficha de la oferta: «esperant l'entitat», con aceptar en su nombre y retirar.
  await page.goto(`/equip/ofertes/${oferta}`)
  await expect(page.getByTestId('proposta-esperant')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => desbordaments(page.locator('body')), { message: 'fitxa de l’oferta' }).toEqual([])

  // La entidad (otra sesión): la tarjeta en la lista y el diálogo del enlace directo.
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } })
  const ent = await ctx.newPage()
  try {
    await entra(ent, RECEPTOR)
    await ent.goto('/receptor/interessos')
    await expect(ent.getByTestId('proposta-entitat').first()).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => desbordaments(ent.locator('body')), { message: 'Els meus interessos' }).toEqual([])
    await ent.goto(`/receptor/interessos?resposta=${resposta}`)
    const dlgEnt = ent.getByRole('dialog').filter({ has: ent.getByTestId('proposta-entitat') })
    await expect(dlgEnt).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => desbordaments(dlgEnt), { message: 'diàleg de l’entitat' }).toEqual([])
  } finally {
    await ctx.close()
  }
})
