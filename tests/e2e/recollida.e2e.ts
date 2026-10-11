// Fase 3 de la revisión del cliente del 08-10-2026: confirmar la recogida y el albarán de
// una página.
//
// Solo contra el CLON LOCAL: emitir un albarán consume numeración LEGAL (`REC`/`ENT`) y no
// hay serie de prueba para ellos. Tras la tanda, `scripts/local/cargar-local.sh` devuelve el
// clon a la copia de producción.
//
// Dos recorridos:
//   1. El equipo «Confirma la recollida» con 5 kg menos de los asignados: el albarán de
//      salida y el de recepción quedan confirmados y conciliados (está dentro de la
//      tolerancia porque el REC se confirma con la suma de lo real), el productor ve
//      «Producte recollit» y la receptora la entrega en su Històric. Y el PDF nuevo sale en
//      UNA página (si las funciones locales están sirviendo).
//   2. La productora confirma su entrega desde «Pendent de tu»: el formulario dice
//      «entrega», no «recepció», y el acta dice «he lliurat».

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
const marca = Date.now()
let oferta1 = ''
let oferta2 = ''

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
})

test.beforeEach(() => {
  const m = motiuSaltClon('productor', RECEPTOR, 'super_admin')
  test.skip(m !== null, m ?? '')
})

test('el equipo confirma la recogida con 5 kg menos y queda conciliada', async ({ page }) => {
  const ent = sql(`select id from albaranes where tipo = 'ENT' and excedente_id = '${oferta1}' and estado = 'entregado'`)
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
  await expect(page.getByText('Carbassa').first()).toBeVisible()
  await expect(page.getByText(/95 kg/).first()).toBeVisible()
})

test('la productora confirma su entrega desde «Pendent de tu»: el formulario habla de entrega', async ({ page }) => {
  const rec = sql(`select numero_completo from albaranes where tipo = 'REC' and excedente_id = '${oferta2}' and estado = 'entregado'`)
  expect(rec).toMatch(/^REC-/)
  await entra(page, 'productor')
  await page.goto('/productor/documents')
  const fila = page.locator('div').filter({ hasText: rec }).filter({ has: page.getByRole('button', { name: /Confirma l’entrega|Confirma la entrega/ }) }).last()
  await fila.getByRole('button', { name: /Confirma l’entrega|Confirma la entrega/ }).click()
  await expect(page.getByText(/he lliurat el producte|he entregado el producto/)).toBeVisible()
  await expect(page.getByText(/Quilos lliurats|Kilos entregados/)).toBeVisible()
  await page.getByLabel(/Qui confirma|Quién confirma/).fill('Productora E2E')
  await page.getByRole('button', { name: /Confirma l’entrega|Confirmar la entrega/ }).last().click()
  await expect(page.getByText(/Entrega confirmada/).first()).toBeVisible()
  expect(sql(`select estado from albaranes where tipo = 'REC' and excedente_id = '${oferta2}'`)).toBe('confirmado')
})
