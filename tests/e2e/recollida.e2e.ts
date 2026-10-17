// Fase 3 de la revisión del cliente del 08-10-2026: confirmar la recogida y el albarán de
// una página.
//
// Solo contra el CLON LOCAL: emitir un albarán consume numeración LEGAL (`REC`/`ENT`) y no
// hay serie de prueba para ellos. Tras la tanda, `scripts/local/cargar-local.sh` devuelve el
// clon a la copia de producción.
//
// Desde el 17-10-2026 (20270426100000) los albaranes NO se emiten a la hora de recogida: se
// generan cuando alguien registra los kilos reales. Recorridos:
//   1. El job de la hora de recogida ya no emite: deja los albaranes en borrador y avisa a
//      la receptora (`recollida_per_registrar`, una sola vez).
//   2. El equipo «Confirma la recollida» con 5 kg menos: emite los dos albaranes y concilia
//      (la vía asistida, para una entidad sin panel). El PDF nuevo sale en UNA página (si las
//      funciones locales están sirviendo).
//   3. La receptora registra la recogida desde la ficha de la operación con «Coincideixen»:
//      se generan REC y ENT por los mismos kilos y se cierran solos, sin que la productora
//      confirme nada; la productora ve «Producte recollit».
//   4. La receptora registra «N'he recollit menys» con motivo: los albaranes salen por los
//      kilos reales pero la operación queda en revisión del equipo (no se concilia sola).

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
const marca = Date.now()
let oferta1 = ''
let oferta2 = ''
let oferta3 = ''

/** Una oferta con un interés aprobado y la hora de recogida ya pasada, y el job ejecutado. */
function ofertaRecollida(producte: string, kg: number): string {
  const prod = productorDe('productor')
  const ent = entidadDe(RECEPTOR)
  const exc = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, coste_kg, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-RC-${producte.slice(0, 3)}-${marca}', '${prod}', '${producte}', ${kg}, 'publicada', 'asistido', 'donacio', '{donacio}', 0.5, current_date + 5, '[E2E] recollida', '[E2E]')
    returning id`).split('\n')[0]
  const resp = sql(`insert into oferta_respuestas (excedente_id, entidad_id, telefono, canal, estado, aprovacio, kg_solicitados, enviado_at, respondido_at)
    values ('${exc}', '${ent}', '34600000000', 'panel', 'acceptada', 'pendent', ${kg}, now(), now()) returning id`).split('\n')[0]
  const canal = sqlCom('super_admin', `select (aprovar_resposta('${resp}', ${kg}, null, null, null,
      ((current_date + 1) + time '10:00') at time zone 'Europe/Madrid')).id`)
  sql(`update canalizaciones set data_hora_recollida = now() - interval '1 hour' where id = '${canal}'`)
  sql(`select programar_albarans_recollida()`)
  return exc
}

test.beforeAll(() => {
  if (motiuSaltClon('productor', RECEPTOR, 'super_admin')) return
  oferta1 = ofertaRecollida('Carbassa', 100)
  oferta2 = ofertaRecollida('Bleda', 50)
  oferta3 = ofertaRecollida('Pastanaga', 40)
})

test.beforeEach(() => {
  const m = motiuSaltClon('productor', RECEPTOR, 'super_admin')
  test.skip(m !== null, m ?? '')
})

test('a la hora de recogida ya no se emite nada: se pide el registro a la receptora', () => {
  expect(sql(`select string_agg(tipo || ':' || estado, ',' order by tipo) from albaranes where excedente_id = '${oferta1}'`))
    .toBe('ENT:borrador,REC:borrador')
  expect(sql(`select count(*) from avisos where tipus = 'recollida_per_registrar' and (params->>'excedente_id') = '${oferta1}'`)).toBe('1')
  // Una sola vez: otra pasada del job no repite el aviso.
  sql(`select programar_albarans_recollida()`)
  expect(sql(`select count(*) from avisos where tipus = 'recollida_per_registrar' and (params->>'excedente_id') = '${oferta1}'`)).toBe('1')
})

test('el equipo confirma la recogida con 5 kg menos y queda conciliada', async ({ page }) => {
  const ent = sql(`select id from albaranes where tipo = 'ENT' and excedente_id = '${oferta1}' and estado = 'borrador'`)
  expect(ent).toMatch(/^[0-9a-f-]{36}$/)
  await entra(page, 'super_admin')
  await page.goto(`/equip/albarans/${ent}`)
  await page.getByRole('button', { name: /^Confirma la recollida$|^Confirma la recogida$/ }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel(/Quilos reals|Kilos reales/).fill('95')
  await expect(dlg.getByText(/diferència -5 kg|diferencia -5 kg/)).toBeVisible()
  await dlg.getByLabel(/Observacions|Observaciones/).fill('Una caixa en mal estat')
  await dlg.getByRole('button', { name: /^Confirma$/ }).click()
  await expect(page.getByText(/confirmada i conciliada|confirmada y conciliada/).first()).toBeVisible()

  expect(sql(`select string_agg(tipo || ':' || estado, ',' order by tipo) from albaranes where excedente_id = '${oferta1}' and estado <> 'anulado'`))
    .toBe('ENT:conciliado,REC:conciliado')
  expect(sql(`select sum(l.kg_validados) from albaran_lineas l join albaranes a on a.id = l.albaran_id where a.excedente_id = '${oferta1}' and a.tipo = 'REC'`))
    .toBe('95.00')
  // La evidencia la firma el equipo, como asistida.
  expect(sql(`select count(*) from evidencias e join enlaces_token t on t.id = e.enlace_id
               where t.objeto_id in (select id from albaranes where excedente_id = '${oferta1}')
                 and t.canal = 'asistido' and e.asistido_por is not null`)).toBe('2')
})

test('el PDF del albarán de recepción sale en una página', async () => {
  // Lo genera `generar-documento` por pg_net: hace falta `scripts/local/funciones-local.sh`.
  let pagines = ''
  for (let i = 0; i < 20 && !pagines; i++) {
    pagines = sql(`select coalesce(max(d.paginas)::text, '') from documentos d join albaranes a on a.id = d.objeto_id
                    where a.excedente_id = '${oferta1}' and a.tipo = 'REC' and d.estado = 'emitido' and d.vigente`)
    if (!pagines) await new Promise((r) => setTimeout(r, 2000))
  }
  test.skip(!pagines, 'generar-documento no respon: cal `bash scripts/local/funciones-local.sh`')
  expect(pagines).toBe('1')
  expect(sql(`select d.datos->>'format' from documentos d join albaranes a on a.id = d.objeto_id
               where a.excedente_id = '${oferta1}' and a.tipo = 'REC' and d.vigente`)).toBe('albara-1p')
})

test('el productor ve «Producte recollit»', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto('/productor/ofertes')
  await expect(page.getByRole('link').or(page.getByRole('button')).filter({ hasText: 'Carbassa' })
    .filter({ hasText: /Producte recollit|Producto recogido/ }).first()).toBeVisible()
})

test('la receptora ve la entrega en su Històric', async ({ page }) => {
  await entra(page, RECEPTOR)
  await page.goto('/receptor/historic')
  // La fila, no el texto suelto: desde la fase 6 el filtro «Producte» tiene un <option>
  // Carbassa</option> (oculto) que sería lo primero que encontraría `getByText`.
  await expect(page.getByRole('button').filter({ hasText: 'Carbassa' }).first()).toBeVisible()
  await expect(page.getByText(/95 kg/).first()).toBeVisible()
})

test('la receptora registra la recogida («coincideixen») y se generan los dos albaranes', async ({ page }) => {
  await entra(page, RECEPTOR)
  await page.goto('/receptor/interessos')
  await page.getByRole('button').filter({ hasText: 'Bleda' }).first().click()
  const fitxa = page.getByTestId('fitxa-operacio')
  await fitxa.getByRole('button', { name: /^Registra la recollida$|^Registra la recogida$/ }).click()
  await expect(fitxa.getByRole('radio', { name: /Coincideixen: 50 kg|Coinciden: 50 kg/ })).toHaveAttribute('aria-checked', 'true')
  await expect(fitxa.getByText(/entitat productora → Espigoladors|entidad productora → Espigoladors/)).toBeVisible()
  await fitxa.getByRole('button', { name: /Confirma i genera els albarans|Confirma y genera los albaranes/ }).click()
  await expect(page.getByText(/Recollida registrada|Recogida registrada/).first()).toBeVisible()
  await expect(fitxa.getByTestId('recollida-registrada')).toBeVisible()

  expect(sql(`select string_agg(tipo || ':' || estado, ',' order by tipo) from albaranes where excedente_id = '${oferta2}' and estado <> 'anulado'`))
    .toBe('ENT:conciliado,REC:conciliado')
  expect(sql(`select string_agg(tipo || '=' || l.kg_validados, ',' order by tipo) from albaran_lineas l join albaranes a on a.id = l.albaran_id where a.excedente_id = '${oferta2}'`))
    .toBe('ENT=50.00,REC=50.00')
  // Nadie le ha pedido nada a la productora: el REC lo confirma la declaración de la receptora.
  expect(sql(`select count(*) from evidencias e join enlaces_token t on t.id = e.enlace_id
               where t.objeto_id in (select id from albaranes where excedente_id = '${oferta2}')
                 and t.canal = 'panel' and e.asistido_por is null`)).toBe('2')
  expect(sql(`select count(*) from enlaces_token t join albaranes a on a.id = t.objeto_id
               where a.excedente_id = '${oferta2}' and t.estado = 'activo'`)).toBe('0')
})

test('la productora ve «Producte recollit» sin haber confirmado nada', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto('/productor/ofertes')
  await expect(page.getByRole('link').or(page.getByRole('button')).filter({ hasText: 'Bleda' })
    .filter({ hasText: /Producte recollit|Producto recogido/ }).first()).toBeVisible()
})

test('la receptora registra menos kilos: albaranes por lo real y la operación en revisión', async ({ page }) => {
  await entra(page, RECEPTOR)
  await page.goto('/receptor/interessos')
  await page.getByRole('button').filter({ hasText: 'Pastanaga' }).first().click()
  const fitxa = page.getByTestId('fitxa-operacio')
  await fitxa.getByRole('button', { name: /^Registra la recollida$|^Registra la recogida$/ }).click()
  await fitxa.getByRole('radio', { name: /N’he recollit menys|He recogido menos/ }).click()
  await fitxa.getByLabel(/Quilos recollits|Kilos recogidos/).fill('35')
  await expect(fitxa.getByText(/diferència -5 kg|diferencia -5 kg/)).toBeVisible()
  // Sin motivo no deja: es obligatorio cuando los kilos no coinciden.
  await fitxa.getByRole('button', { name: /Confirma i genera els albarans|Confirma y genera los albaranes/ }).click()
  await expect(fitxa.getByText(/és obligatori quan els quilos no coincideixen|es obligatorio cuando los kilos no coinciden/)).toBeVisible()
  await fitxa.getByLabel(/Què ha passat|Qué ha pasado/).fill('Una caixa en mal estat')
  await fitxa.getByRole('button', { name: /Confirma i genera els albarans|Confirma y genera los albaranes/ }).click()
  await expect(page.getByText(/l’equip la revisarà|el equipo la revisará/).first()).toBeVisible()
  await expect(fitxa.getByTestId('incidencia-recollida')).toBeVisible()

  expect(sql(`select string_agg(tipo || ':' || estado, ',' order by tipo) from albaranes where excedente_id = '${oferta3}' and estado <> 'anulado'`))
    .toBe('ENT:confirmado,REC:confirmado')
  // El job de conciliación no la cierra: la revisa el equipo.
  sql(`select conciliacions_automatiques()`)
  expect(sql(`select string_agg(tipo || ':' || estado, ',' order by tipo) from albaranes where excedente_id = '${oferta3}' and estado <> 'anulado'`))
    .toBe('ENT:confirmado,REC:confirmado')
  expect(sql(`select incidencia_recollida->>'resultat' from canalizaciones where excedente_id = '${oferta3}'`)).toBe('menys')
})

test('el equipo ve la incidencia en el albarán y no puede conciliarlo sin motivo', async ({ page }) => {
  const rec = sql(`select id from albaranes where tipo = 'REC' and excedente_id = '${oferta3}' and estado = 'confirmado'`)
  expect(rec).toMatch(/^[0-9a-f-]{36}$/)
  // La base lo rechaza sin motivo (`cal_motiu_incidencia`), aunque cuadre con la tolerancia.
  expect(() => sqlCom('super_admin', `select conciliar_albaran('${rec}', null, null, null)`))
    .toThrow(/cal_motiu_incidencia/)

  await entra(page, 'super_admin')
  await page.goto(`/equip/albarans/${rec}`)
  const banda = page.getByTestId('incidencia-albara')
  await expect(banda).toBeVisible()
  await expect(banda.getByText(/Incidència de recollida|Incidencia de recogida/)).toBeVisible()
  await expect(banda.getByText(/Assignats: 40 kg → reals: 35 kg|Asignados: 40 kg → reales: 35 kg/)).toBeVisible()
  await expect(banda.getByText(/Una caixa en mal estat/)).toBeVisible()

  await page.getByRole('button', { name: /^Concilia$|^Conciliar$/ }).first().click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByText(/ha declarat una diferència de quilos|ha declarado una diferencia de kilos/)).toBeVisible()
  const conciliar = dlg.getByRole('button', { name: /^Concilia$|^Conciliar$/ })
  await expect(conciliar).toBeDisabled()
  await dlg.getByLabel(/^Motiu$|^Motivo$/).fill('Revisat amb l’entitat: una caixa malmesa')
  await expect(conciliar).toBeEnabled()
})
