// Fase 3 de la revisión del cliente del 08-10-2026: confirmar la recogida y el albarán de
// una página.
//
// Solo contra el CLON LOCAL: emitir un albarán consume numeración LEGAL (`REC`/`ENT`) y no
// hay serie de prueba para ellos. Tras la tanda, `scripts/local/cargar-local.sh` devuelve el
// clon a la copia de producción.
//
// Desde el 17-10-2026 los albaranes NO se emiten a la hora de recogida, ni tampoco al
// registrar los kilos: los genera un ADMIN al validar lo que registró el receptor (regla de
// Carles). Recorridos:
//   1. El job de la hora de recogida ya no emite: deja los albaranes en borrador y avisa a
//      la receptora (`recollida_per_registrar`, una sola vez). «Emet» está gris en el albarán.
//   2. El equipo (admin), desde el ciclo guiado, «Registra la recollida (en nom de X)» con 5 kg
//      menos: el mismo formulario que la receptora, que registra y valida en una llamada
//      (`registrar_recollida_assistida`, 27-10-2026); emite los dos albaranes y concilia. El PDF
//      nuevo sale en UNA página (si las funciones locales están sirviendo).
//   3. La receptora registra «Coincideixen»: NO sale ningún número; queda pendiente de
//      validación. El admin la valida desde Aprovacions y entonces salen REC y ENT, conciliados.
//   4. La receptora registra «N'he recollit menys» con motivo: sin números. Validar sin motivo
//      se rechaza (`cal_motiu_validacio`); el admin la retorna con motivo, la receptora la
//      vuelve a registrar y el admin la valida con motivo: albaranes por lo real, conciliados.

import { expect, test } from '@playwright/test'
import { compte, entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

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

test('el equipo registra la recogida en nombre de la receptora con 5 kg menos y queda conciliada', async ({ page }) => {
  const ent = sql(`select id from albaranes where tipo = 'ENT' and excedente_id = '${oferta1}' and estado = 'borrador'`)
  expect(ent).toMatch(/^[0-9a-f-]{36}$/)
  await entra(page, 'super_admin')
  await page.goto(`/equip/albarans/${ent}`)
  // Un borrador de una recogida no se emite desde aquí: lo emite la validación del admin.
  await expect(page.getByRole('button', { name: /^Emet$|^Emitir$|^Emite$/ }).first()).toBeDisabled()
  await expect(page.getByTestId('emet-per-validacio')).toBeVisible()
  // El ciclo guiado: la fase de la recogida está abierta (le toca registrar).
  await page.goto(`/equip/canalitzacio/${oferta1}`)
  const entrega = page.getByTestId('entrega-canalitzacio').first()
  await entrega.getByRole('button', { name: /Registra la recollida \(en nom de|Registra la recogida \(en nombre de/ }).click()
  const dlg = page.getByRole('dialog')
  // Arriba, la ficha de la operación; debajo, el formulario de la receptora en modo asistido.
  await expect(dlg.getByTestId('fitxa-operacio')).toBeVisible()
  const form = dlg.getByTestId('registra-recollida')
  await form.getByRole('radio', { name: /N’he recollit menys|He recogido menos/ }).click()
  await form.getByLabel(/Quilos recollits|Kilos recogidos/).fill('95')
  await expect(form.getByText(/diferència -5 kg|diferencia -5 kg/)).toBeVisible()
  // Sin motivo no deja: con diferencia es obligatorio también para el equipo.
  await form.getByRole('button', { name: /^Registra i valida$|^Registra y valida$/ }).click()
  await expect(form.getByText(/és obligatori quan els quilos no coincideixen|es obligatorio cuando los kilos no coinciden/)).toBeVisible()
  await form.getByLabel(/Motiu de la diferència|Motivo de la diferencia/).fill('Una caixa en mal estat')
  await form.getByRole('button', { name: /^Registra i valida$|^Registra y valida$/ }).click()
  await expect(page.getByText(/registrada, validada i conciliada|registrada, validada y conciliada/).first()).toBeVisible()
  await expect(dlg.getByText(/ja està validada|ya está validada/)).toBeVisible()

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

test('la receptora registra «coincideixen»: no sale ningún número, queda pendiente de validar', async ({ page }) => {
  await entra(page, RECEPTOR)
  await page.goto('/receptor/interessos')
  await page.getByRole('button').filter({ hasText: 'Bleda' }).first().click()
  const fitxa = page.getByTestId('fitxa-operacio')
  await fitxa.getByRole('button', { name: /^Registra la recollida$|^Registra la recogida$/ }).click()
  await expect(fitxa.getByRole('radio', { name: /Coincideixen: 50 kg|Coinciden: 50 kg/ })).toHaveAttribute('aria-checked', 'true')
  // El texto ya no promete albaranes al pulsar: los genera la validación del equipo.
  await expect(fitxa.getByText(/Quan l’equip de Redestina ho validi|Cuando el equipo de Redestina lo valide/)).toBeVisible()
  await fitxa.getByRole('button', { name: /^Registra els quilos$|^Registra los kilos$/ }).click()
  await expect(page.getByText(/Recollida registrada|Recogida registrada/).first()).toBeVisible()
  await expect(fitxa.getByTestId('recollida-pendent-validacio')).toBeVisible()
  await expect(fitxa.getByTestId('recollida-pendent-validacio'))
    .toContainText(/Pendent de validació de l’equip|Pendiente de validación del equipo/)
  // Ya no ofrece el formulario.
  await expect(fitxa.getByRole('button', { name: /^Registra la recollida$|^Registra la recogida$/ })).toHaveCount(0)

  // Ningún número legal gastado.
  expect(sql(`select string_agg(tipo || ':' || estado || ':' || coalesce(numero_completo, '-'), ',' order by tipo) from albaranes where excedente_id = '${oferta2}' and estado <> 'anulado'`))
    .toBe('ENT:borrador:-,REC:borrador:-')
  expect(sql(`select (recollida_registrada_at is not null)::text || ',' || (recollida_validada_at is null)::text from canalizaciones where excedente_id = '${oferta2}'`))
    .toBe('true,true')
})

/**
 * El código de la oferta (`id_excedente`), que cada fila de la cola enseña. Se filtra por él y
 * no por el producto: en el clon quedan recogidas de pasadas anteriores con el mismo nombre.
 */
const codiOferta = (oferta: string) => sql(`select id_excedente from excedentes where id = '${oferta}'`)

test('el admin valida desde Aprovacions y entonces salen los dos albaranes, conciliados', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/aprovacions#recollides')
  const fila = page.getByTestId('recollida-per-validar').filter({ hasText: codiOferta(oferta2) })
  await expect(fila).toBeVisible()
  await expect(fila).toContainText(/Declarats: 50 kg|Declarados: 50 kg/)
  await fila.getByRole('button', { name: /Valida i genera els albarans|Valida y genera los albaranes/ }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByLabel(/Quilos que es validen|Kilos que se validan/)).toHaveValue('50')
  await expect(dlg.getByText(/número legal/)).toBeVisible()
  await dlg.getByRole('button', { name: /Valida i genera els albarans|Valida y genera los albaranes/ }).click()
  const fet = dlg.getByTestId('validacio-feta')
  await expect(fet).toBeVisible()
  await expect(fet).toContainText(/ENT-\d{4}-\d+/)
  await expect(fet).toContainText(/REC-\d{4}-\d+/)

  expect(sql(`select string_agg(tipo || ':' || estado, ',' order by tipo) from albaranes where excedente_id = '${oferta2}' and estado <> 'anulado'`))
    .toBe('ENT:conciliado,REC:conciliado')
  expect(sql(`select string_agg(tipo || '=' || l.kg_validados, ',' order by tipo) from albaran_lineas l join albaranes a on a.id = l.albaran_id where a.excedente_id = '${oferta2}'`))
    .toBe('ENT=50.00,REC=50.00')
  expect(sql(`select count(*) from enlaces_token t join albaranes a on a.id = t.objeto_id
               where a.excedente_id = '${oferta2}' and t.estado = 'activo'`)).toBe('0')
})

test('la productora ve «Producte recollit» sin haber confirmado nada', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto('/productor/ofertes')
  await expect(page.getByRole('link').or(page.getByRole('button')).filter({ hasText: 'Bleda' })
    .filter({ hasText: /Producte recollit|Producto recogido/ }).first()).toBeVisible()
})

test('la receptora registra menos kilos: sin números, pendiente de validar', async ({ page }) => {
  await entra(page, RECEPTOR)
  await page.goto('/receptor/interessos')
  await page.getByRole('button').filter({ hasText: 'Pastanaga' }).first().click()
  const fitxa = page.getByTestId('fitxa-operacio')
  await fitxa.getByRole('button', { name: /^Registra la recollida$|^Registra la recogida$/ }).click()
  await fitxa.getByRole('radio', { name: /N’he recollit menys|He recogido menos/ }).click()
  await fitxa.getByLabel(/Quilos recollits|Kilos recogidos/).fill('35')
  await expect(fitxa.getByText(/diferència -5 kg|diferencia -5 kg/)).toBeVisible()
  // Sin motivo no deja: es obligatorio cuando los kilos no coinciden.
  await fitxa.getByRole('button', { name: /^Registra els quilos$|^Registra los kilos$/ }).click()
  await expect(fitxa.getByText(/és obligatori quan els quilos no coincideixen|es obligatorio cuando los kilos no coinciden/)).toBeVisible()
  await fitxa.getByLabel(/Què ha passat|Qué ha pasado/).fill('Una caixa en mal estat')
  await fitxa.getByRole('button', { name: /^Registra els quilos$|^Registra los kilos$/ }).click()
  await expect(page.getByText(/abans de generar els albarans|antes de generar los albaranes/).first()).toBeVisible()
  const pendent = fitxa.getByTestId('recollida-pendent-validacio')
  await expect(pendent).toBeVisible()
  await expect(pendent).toContainText(/diferència -5 kg|diferencia -5 kg/)
  await expect(pendent).toContainText(/Una caixa en mal estat/)

  expect(sql(`select string_agg(tipo || ':' || estado || ':' || coalesce(numero_completo, '-'), ',' order by tipo) from albaranes where excedente_id = '${oferta3}' and estado <> 'anulado'`))
    .toBe('ENT:borrador:-,REC:borrador:-')
  expect(sql(`select coalesce(kg_declarats::text, '') from canalizaciones where excedente_id = '${oferta3}'`)).toBe('35.00')
})

test('validar con diferencia sin motivo se rechaza, y un técnico no puede validar', () => {
  const canal = sql(`select id from canalizaciones where excedente_id = '${oferta3}'`)
  expect(() => sqlCom('super_admin', `select validar_recollida('${canal}', null, null)`))
    .toThrow(/cal_motiu_validacio/)
  // Sigue sin albaranes: el rechazo no ha gastado ningún número.
  expect(sql(`select count(*) from albaranes where excedente_id = '${oferta3}' and numero_completo is not null`)).toBe('0')
  if (compte('equip')) {
    expect(() => sqlCom('equip', `select validar_recollida('${canal}', null, 'prova')`)).toThrow(/42501|no_autoritzat|permission|permís|admin/i)
  }
})

test('el admin la retorna con motivo y la receptora la vuelve a registrar', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/aprovacions#recollides')
  const fila = page.getByTestId('recollida-per-validar').filter({ hasText: codiOferta(oferta3) })
  await expect(fila).toBeVisible()
  await expect(fila).toContainText(/Una caixa en mal estat/)
  await fila.getByRole('button', { name: /^Retorna al receptor$|^Devuelve al receptor$/ }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel(/Motiu|Motivo/).fill('Falta la foto del pes')
  await dlg.getByRole('button', { name: /^Retorna al receptor$|^Devuelve al receptor$/ }).click()
  await expect(page.getByText(/Recollida retornada al receptor|Recogida devuelta al receptor/).first()).toBeVisible()
  await expect(fila).toHaveCount(0)
  expect(sql(`select count(*) from avisos where tipus = 'recollida_retornada' and (params->>'excedente_id') = '${oferta3}'`)).toBe('1')
})

// Prueba aparte y no un segundo `entra()`: con la sesión del admin puesta, /login redirige al
// panel y no hay formulario. Cada prueba estrena su navegador.
test('la receptora ve el motivo del retorno y la vuelve a registrar', async ({ page }) => {
  await entra(page, RECEPTOR)
  await page.goto('/receptor/interessos')
  await page.getByRole('button').filter({ hasText: 'Pastanaga' }).first().click()
  const fitxa = page.getByTestId('fitxa-operacio')
  await expect(fitxa.getByTestId('recollida-retornada')).toContainText(/Falta la foto del pes/)
  await fitxa.getByRole('button', { name: /^Registra la recollida$|^Registra la recogida$/ }).click()
  await fitxa.getByRole('radio', { name: /N’he recollit menys|He recogido menos/ }).click()
  await fitxa.getByLabel(/Quilos recollits|Kilos recogidos/).fill('38')
  await fitxa.getByLabel(/Què ha passat|Qué ha pasado/).fill('Pesat de nou: 38 kg')
  await fitxa.getByRole('button', { name: /^Registra els quilos$|^Registra los kilos$/ }).click()
  await expect(fitxa.getByTestId('recollida-pendent-validacio')).toBeVisible()
})

test('el admin la valida con motivo: albaranes por lo real y conciliados', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/aprovacions#recollides')
  const fila = page.getByTestId('recollida-per-validar').filter({ hasText: codiOferta(oferta3) })
  await expect(fila).toContainText(/Declarats: 38 kg|Declarados: 38 kg/)
  await fila.getByRole('button', { name: /Valida i genera els albarans|Valida y genera los albaranes/ }).click()
  const dlg = page.getByRole('dialog')
  // Con diferencia frente a lo asignado, el motivo es obligatorio también aquí.
  await dlg.getByRole('button', { name: /Valida i genera els albarans|Valida y genera los albaranes/ }).click()
  await expect(dlg.getByText(/és obligatori si els quilos no coincideixen|es obligatorio si los kilos no coinciden/)).toBeVisible()
  await dlg.getByLabel(/Motiu|Motivo/).fill('Revisat amb l’entitat per telèfon')
  await dlg.getByRole('button', { name: /Valida i genera els albarans|Valida y genera los albaranes/ }).click()
  await expect(dlg.getByTestId('validacio-feta')).toBeVisible()

  expect(sql(`select string_agg(tipo || ':' || estado, ',' order by tipo) from albaranes where excedente_id = '${oferta3}' and estado <> 'anulado'`))
    .toBe('ENT:conciliado,REC:conciliado')
  expect(sql(`select string_agg(tipo || '=' || l.kg_validados, ',' order by tipo) from albaran_lineas l join albaranes a on a.id = l.albaran_id where a.excedente_id = '${oferta3}'`))
    .toBe('ENT=38.00,REC=38.00')
})
