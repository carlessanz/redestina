// La asignación en un acto (puntos 4-6, fase 2; 20270606100000, 20270606100100, 20270607100000),
// desde la ficha de la oferta del equipo:
//
//   1. El super_admin asigna una DONACIÓN en un acto («Registrar i confirmar recollida» →
//      `assignar_directe`): nace la canalización confirmada sin pasar por Aprovacions.
//   2. La modifica (kg) → `modificar_assignacio`.
//   3. La anula con motivo → `anular_assignacio`: la oferta vuelve a `publicada`.
//   4. En una VENTA, sin precio acordado o sin la aceptación del ofertante, el botón no deja enviar.
//
// Solo contra el CLON LOCAL y en escritorio (escribe). Lo que crea se deja cancelado o se borra.

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, triaCercador } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
const marca = Date.now()
const BOTO_ASSIGNAR = /Registrar i confirmar recollida|Registrar y confirmar recogida/

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'productor', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'escriu al clon: una sola passada')
})

/** Una oferta publicada de prueba, de este productor. */
function novaOferta(sufix: string, modalitat: 'donacio' | 'venda', preuMinim: number | null): string {
  const prod = productorDe('productor')
  return sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, preu_minim, coste_kg, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-AD-${sufix}-${marca}', '${prod}', 'Avellana', 150, 'publicada', 'asistido', '${modalitat}', '{${modalitat}}', ${preuMinim ?? 'null'}, 0.5, current_date + 5, '[E2E] assignació directa', '[E2E] Avellana')
    returning id`).split('\n')[0]
}

test('el super_admin assigna una donació en un acte, la modifica i l’anul·la', async ({ page }) => {
  const ent = entidadDe(RECEPTOR)
  // Albaranes viejos de esta receptora con el enlace sin usar la bloquean (G1): no es lo que se prueba.
  sql(`update enlaces_token t set estado = 'revocado'
         from albaranes a join canalizaciones c on c.id = a.canalizacion_id
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id and t.estado = 'activo'
          and t.usado_at is null and c.entidad_id = '${ent}'`)
  const oferta = novaOferta('DON', 'donacio', null)
  try {
    await entra(page, 'super_admin')
    await page.goto(`/equip/ofertes/${oferta}`)

    // 1. En un acto, desde la cabecera de la ficha.
    const form = page.locator('#od-interes')
    await expect(form.getByRole('button', { name: BOTO_ASSIGNAR })).toBeVisible({ timeout: 30_000 })
    // Quien puede aprobar (todo el equipo desde el 25-11-2026) asigna en un acto: «Registra l'interès» no está.
    await expect(form.getByRole('button', { name: /Registra l’interès|Registra el interés/ })).toHaveCount(0)
    await triaCercador(form.locator('#od-interes-entitat'), sql(`select nombre from entidades where id = '${ent}'`), ent)
    await form.locator('#od-interes-kg').fill('50')
    await form.getByRole('button', { name: BOTO_ASSIGNAR }).click()
    await expect(page.getByText(/Assignació registrada i confirmada|Asignación registrada y confirmada/)).toBeVisible()
    await expect.poll(() => sql(`select canal || ':' || aprovacio || ':' || assignacio_directa
      from oferta_respuestas where excedente_id = '${oferta}' and entidad_id = '${ent}'`)).toBe('asistido:aprovada:true')
    expect(sql(`select (kg_confirmados = 50) || ':' || estado || ':' || valorizacion
      from canalizaciones where excedente_id = '${oferta}'`)).toBe('true:confirmada:donacio')
    expect(sql(`select estado from excedentes where id = '${oferta}'`)).toBe('parcial')
    const canal = sql(`select id from canalizaciones where excedente_id = '${oferta}'`)

    // 2. «Modifica»: los kilos.
    const fila = page.getByTestId('od-canalitzacio').first()
    await expect(fila).toBeVisible()
    await fila.getByRole('button', { name: /^Modifica$/ }).click()
    const dMod = page.getByRole('dialog')
    await expect(dMod).toBeVisible()
    await dMod.locator(`[id="od-asg-${canal}-mod-kg"]`).fill('60')
    await dMod.getByRole('button', { name: /^Desar$|^Guardar$/ }).click()
    await expect(page.getByText(/Assignació modificada|Asignación modificada/)).toBeVisible()
    await expect.poll(() => sql(`select kg_confirmados = 60 from canalizaciones where id = '${canal}'`)).toBe('t')
    expect(sql(`select kg_aprovats = 60 from oferta_respuestas where canalizacion_id = '${canal}'`)).toBe('t')

    // 3. «Anul·la l'assignació»: con motivo; la oferta vuelve a estar publicada.
    await fila.getByRole('button', { name: /Anul·la l’assignació|Anula la asignación/ }).click()
    const dAnul = page.getByRole('dialog')
    await expect(dAnul).toBeVisible()
    // Sin motivo no se puede confirmar.
    await expect(dAnul.getByRole('button', { name: /Anul·la l’assignació|Anula la asignación/ })).toBeDisabled()
    await dAnul.locator('#dialeg-motiu').fill('Prova E2E: l’entitat no la pot recollir')
    await dAnul.getByRole('button', { name: /Anul·la l’assignació|Anula la asignación/ }).click()
    await expect(page.getByText(/^(Assignació anul·lada|Asignación anulada)\.$/)).toBeVisible()
    await expect.poll(() => sql(`select estado || ':' || (motiu_anulacio is not null) from canalizaciones where id = '${canal}'`))
      .toBe('anulada:true')
    await expect.poll(() => sql(`select estado from excedentes where id = '${oferta}'`)).toBe('publicada')
    // La anulada se queda a la vista, marcada, y ya no suma.
    await expect(page.getByTestId('od-canalitzacio').first().getByText(/^Anul·lada$|^Anulada$/)).toBeVisible()
    await expect(page.getByText(/0\/150 kg/)).toBeVisible()
  } finally {
    sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${oferta}'`)
  }
})

test('en una venda, sense preu acordat o sense acceptació no es pot assignar', async ({ page }) => {
  const ent = entidadDe(RECEPTOR)
  const oferta = novaOferta('VEN', 'venda', 0.5)
  try {
    await entra(page, 'super_admin')
    await page.goto(`/equip/ofertes/${oferta}`)
    const form = page.locator('#od-interes')
    const boto = form.getByRole('button', { name: BOTO_ASSIGNAR })
    await expect(boto).toBeVisible({ timeout: 30_000 })
    await triaCercador(form.locator('#od-interes-entitat'), sql(`select nombre from entidades where id = '${ent}'`), ent)
    await form.locator('#od-interes-kg').fill('20')

    // Precio precargado con el mínimo, pero sin la aceptación del ofertante: gris.
    await expect(form.locator('#od-interes-preu')).toBeVisible()
    await expect(boto).toBeDisabled()
    const casella = form.getByText(/L’ofertant ha acceptat el preu|El ofertante ha aceptado el precio/)
    await casella.click()
    await expect(boto).toBeEnabled()
    // Sin precio, gris aunque esté aceptado.
    await form.locator('#od-interes-preu').fill('')
    await expect(boto).toBeDisabled()
    // Y nada se ha escrito.
    expect(sql(`select count(*) from oferta_respuestas where excedente_id = '${oferta}'`)).toBe('0')
  } finally {
    // Sin respuestas ni canalizaciones: se puede borrar; si algo lo impide, se cancela.
    try {
      sql(`delete from excedentes where id = '${oferta}'`)
    } catch {
      sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${oferta}'`)
    }
  }
})
