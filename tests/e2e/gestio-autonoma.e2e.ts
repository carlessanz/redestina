// La gestión autónoma del equipo, desde las PANTALLAS (27-10-2026, fases 1 y 2 del plan):
// el super_admin da por vigente un convenio desde la ficha y registra, aprueba y marca como
// enviada a mano una oferta desde su detalle. `paritat-assistida.e2e.ts` comprueba lo mismo a
// nivel de datos; aquí se prueba que la pantalla llega a esas RPC.
//
// Solo contra el CLON LOCAL y en escritorio: consume numeración legal (CONV). Tras la tanda,
// `scripts/local/cargar-local.sh` devuelve el clon a la copia de producción.

import { expect, test } from '@playwright/test'
import { asseguraConveniVigent, entidadDe, entra, motiuSaltClon, productorDe, resolConveniVigent, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
const marca = Date.now()

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'equip', 'productor', RECEPTOR, 'receptor-comercial')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'escriu al clon: una sola passada')
})

test('el super_admin dona per vigent el conveni d’una receptora des de la seva fitxa', async ({ page }) => {
  // Una receptora de prueba que se pueda declarar: sin el convenio ya vigente, ni firmado por
  // ella a falta de contrafirma, ni devuelto (`declarar_conveni` niega esos tres), y con NIF y
  // domicilio. Desde la siembra de la fase 6 de los puntos 4-6 todas nacen con el suyo DECLARAT
  // vigente: se usa la comercial de prueba y se le resuelve antes (la propia prueba le declara
  // otro, así que queda como estaba; si se corta a medias, el `finally` se lo repone).
  const ent = entidadDe('receptor-comercial')
  expect(ent).toMatch(/^[0-9a-f-]{36}$/)
  expect(sql(`select count(*) from convenios where entidad_id = '${ent}' and tipo = 'col_receptor' and estado in ('firmat', 'retornat')`)).toBe('0')
  resolConveniVigent('entidad', ent)
  try {
    await declaraDesDeLaFitxa(page, ent)
  } finally {
    asseguraConveniVigent('entidad', ent)
  }
})

async function declaraDesDeLaFitxa(page: import('@playwright/test').Page, ent: string) {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${ent}?pestanya=documentacio`)
  // En el convenio de su papel de receptora (Documentació › Convenis): con doble rol hay dos.
  await page.getByTestId('conveni-entidad').getByRole('button', { name: /Dona’l per vigent|Dalo por vigente/ }).click()
  const dialeg = page.getByRole('dialog')
  await expect(dialeg).toBeVisible()
  await dialeg.locator('#cdecl-signant').fill('Persona E2E')
  await dialeg.locator('#cdecl-carrec').fill('Presidenta')
  await dialeg.getByRole('button', { name: /Dona’l per vigent|Dalo por vigente/ }).click()
  await expect(page.getByText(/Conveni vigent: CONV-COL-REC-|Convenio vigente: CONV-COL-REC-/)).toBeVisible()

  expect(sql(`select origen || ':' || estado from convenios
    where entidad_id = '${ent}' and tipo = 'col_receptor' and estado = 'vigent'`)).toBe('declarat:vigent')
  await expect(page.getByText(/declarat \(sense signatura\)|declarado \(sin firma\)/).first()).toBeVisible()
}

test('des del detall de l’oferta: copia i marca enviada, registra l’interès i l’aprova', async ({ page, context, browser }) => {
  const prod = productorDe('productor')
  const ent = entidadDe(RECEPTOR)
  // Albaranes viejos de esta receptora con el enlace sin usar la bloquean (G1): no es lo que se prueba.
  sql(`update enlaces_token t set estado = 'revocado'
         from albaranes a join canalizaciones c on c.id = a.canalizacion_id
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id and t.estado = 'activo'
          and t.usado_at is null and c.entidad_id = '${ent}'`)
  const oferta = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, coste_kg, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-GA-${marca}', '${prod}', 'Avellana', 150, 'publicada', 'asistido', 'donacio', '{donacio}', 0.5, current_date + 5, '[E2E] gestió autònoma', '[E2E] Avellana')
    returning id`).split('\n')[0]

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${oferta}`)

  // Las entidades priorizadas van plegadas (puntos 4-6, fase 2): se abren para copiar.
  await page.getByTestId('od-ranking').locator('summary').click()
  // «Copia i marca com a enviada»: no sale nada; queda la fila con canal manual.
  const copia = page.getByRole('button', { name: /Copia i marca com a enviada|Copia y marca como enviada/ }).first()
  await expect(copia).toBeVisible({ timeout: 30_000 })
  await copia.click()
  await expect.poll(() => sql(`select count(*) from oferta_respuestas where excedente_id = '${oferta}' and canal = 'manual' and estado = 'pendent'`))
    .toBe('1')
  // El cierre del bot se cambia por uno que se puede cumplir a mano: con el enlace al Mercat si la
  // entidad tiene cuenta; si no, que responda (fase 4 de los puntos 4-6).
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^\[E2E\] Avellana\n\n✅ Si t'interessa, (obre l'enllaç|respon aquest missatge)/)

  // «Registra l'interès» (nivel 2). Hasta el 25-11-2026 lo hacía el TÉCNICO en su sesión; el rol
  // se retiró (proceso 0.1) y todo el equipo puede aprobar, así que en la pantalla ya solo sale
  // «Assigna» en un acto (`assignacio-directa.e2e.ts`). La Dinamitzadora (`equip`) lo ve así:
  const ctxTec = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const tec = await ctxTec.newPage()
  await entra(tec, 'equip')
  await tec.goto(`/equip/ofertes/${oferta}`)
  await expect(tec.locator('#od-interes').getByRole('button', { name: /Registra l’interès|Registra el interés/ })).toHaveCount(0)
  await ctxTec.close()
  // El nivel 2 sigue existiendo en la base (la misma RPC y guardas que el Mercat): se registra por ella.
  sqlCom('equip', `select manifestar_interes_assistit('${oferta}', '${ent}', 50)`)
  await expect.poll(() => sql(`select canal || ':' || estado || ':' || aprovacio || ':' || (kg_solicitados = 50)
    from oferta_respuestas where excedente_id = '${oferta}' and entidad_id = '${ent}'`)).toBe('asistido:acceptada:pendent:true')

  // Y el super_admin lo aprueba con el formulario compartido: nace la canalización con lo aprobado.
  await page.reload()
  await page.getByRole('button', { name: /Aprovar i canalitzar|Aprobar y canalizar/ }).click()
  await expect(page.getByText(/Oferta aprovada i convertida en canalització|aprobada y convertida/)).toBeVisible()
  await expect.poll(() => sql(`select (kg_confirmados = 50) || ':' || valorizacion from canalizaciones where excedente_id = '${oferta}'`))
    .toBe('true:donacio')

  sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${oferta}'`)
})
