// Los mensajes del ciclo para avisar a mano (27-10-2026, plan de gestión autónoma).
// Solo contra el clon y en escritorio: se lee el portapapeles, que exige permisos del contexto.

import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { CLON, entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'el portapapeles es de escritorio')
})

test('el texto de la oferta se copia entero, con sus saltos de línea', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const id = sql(`select id from excedentes where texto_oferta is not null
    and estado in ('publicada','parcial','bloqueada') order by created_at desc limit 1`)
  test.skip(!id, 'el clon no tiene ninguna oferta viva con texto')
  const text = sql(`select texto_oferta from excedentes where id = '${id}'`)
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${id}`)
  await page.getByRole('button', { name: /Copiar per al grup|Copiar para el grupo/ }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text)
})

// ── Con las notificaciones apagadas (fase 4 del plan) ────────────────────────────────────
// Aprobar un interés crea dos avisos que no salen (`canal_enviat = 'cap'`): el equipo los ve
// con «No s'ha enviat» y los copia; la productora y la receptora leen el texto íntegro en su
// panel, y la campana los marca. Escribe en el clon: oferta, interés, canalización y avisos,
// y apaga los interruptores mientras dura (los deja encendidos al acabar).

/** Cierra la sesión del contexto: la de Supabase vive en `localStorage`, no en una cookie. */
async function surt(page: Page, context: BrowserContext): Promise<void> {
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await context.clearCookies()
}

test.describe('amb les notificacions apagades', () => {
  test.describe.configure({ mode: 'serial' })
  const RECEPTOR = 'receptor-carles'
  const marca = Date.now()
  let ofertaId = ''

  test.beforeEach(() => {
    const m = motiuSaltClon('super_admin', 'productor', RECEPTOR)
    test.skip(m !== null, m ?? '')
  })

  test.afterAll(() => {
    if (!CLON) return
    sql(`update app_settings set value = 'true' where key in ('notificacions_actives','email_activo','whatsapp_activo')`)
    if (ofertaId) sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${ofertaId}'`)
  })

  test('aprovar un interès deixa dos avisos sense enviar, i cadascú els veu', async ({ page, context }) => {
    sql(`update app_settings set value = 'false' where key in ('notificacions_actives','email_activo','whatsapp_activo')`)
    const prod = productorDe('productor')
    const ent = entidadDe(RECEPTOR)
    ofertaId = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, disponible_hasta, observacions, texto_oferta)
      values ('E-E2E-MSG-${marca}', '${prod}', 'Alvocat', 120, 'publicada', 'asistido', 'donacio', '{donacio}', current_date + 5, '[E2E] missatges', '[E2E] Alvocat')
      returning id`).split('\n')[0]
    const resp = sql(`insert into oferta_respuestas (excedente_id, entidad_id, telefono, canal, estado, aprovacio, kg_solicitados, enviado_at, respondido_at)
      values ('${ofertaId}', '${ent}', '34600000000', 'panel', 'acceptada', 'pendent', 60, now(), now()) returning id`).split('\n')[0]
    sqlCom('super_admin', `select (aprovar_resposta('${resp}', 60, null, null, null, null)).id`)

    // `enviar-avis` (servida en local) los marca sin enviar: los interruptores están apagados.
    const tipus = () => sql(`select coalesce(string_agg(tipus || ':' || coalesce(canal_enviat, '-'), ',' order by tipus), '')
      from avisos where objecte_id = '${resp}' or objecte_id = '${ofertaId}'
         or objecte_id in (select id from canalizaciones where excedente_id = '${ofertaId}')`)
    await expect.poll(tipus, { timeout: 60_000 }).toBe('interes_aprovat:cap,sortida_trobada:cap')

    // El equipo: el bloque abierto, con el aviso de que no ha salido y su botón de copiar.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await entra(page, 'super_admin')
    await page.goto(`/equip/ofertes/${ofertaId}`)
    await expect(page.getByText(/Missatges de l’oferta|Mensajes de la oferta/)).toBeVisible()
    await expect(page.getByText(/2 sense enviar|2 sin enviar/)).toBeVisible()
    await expect(page.getByText(/No s’ha enviat: cal avisar a mà|No se ha enviado: hay que avisar a mano/).first()).toBeVisible()
    await page.locator('[data-testid="missatge"][data-clau="interes_aprovat"]')
      .getByRole('button', { name: /Copia el WhatsApp|Copiar el WhatsApp/ }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\*/)

    // La productora: el texto íntegro de su aviso, sin el código de la oferta.
    await surt(page, context)
    await entra(page, 'productor')
    await page.goto(`/productor/ofertes/${ofertaId}`)
    const seva = page.getByRole('region', { name: /El que t’hem dit|Lo que te hemos dicho/ })
    await expect(seva).toBeVisible()
    await expect(seva.getByText(/No t’ha arribat per WhatsApp ni per correu|No te ha llegado por WhatsApp ni por correo/)).toBeVisible()
    await expect(seva).not.toContainText('E-E2E-MSG')

    // La receptora: en la ficha de la operación, y la campana lo marca.
    await surt(page, context)
    await entra(page, RECEPTOR)
    await page.goto('/receptor/interessos')
    await page.getByRole('button').filter({ hasText: 'Alvocat' }).first().click()
    await expect(page.getByTestId('fitxa-operacio').getByRole('region', { name: /El que t’hem dit|Lo que te hemos dicho/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Avisos/ }).click()
    await expect(page.getByText(/No t’ha arribat per correu ni per WhatsApp|No te ha llegado por correo ni por WhatsApp/).first()).toBeVisible()
  })
})
