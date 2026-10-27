// La gestión autónoma del equipo, desde las PANTALLAS (27-10-2026, fases 1 y 2 del plan):
// el super_admin da por vigente un convenio desde la ficha y registra, aprueba y marca como
// enviada a mano una oferta desde su detalle. `paritat-assistida.e2e.ts` comprueba lo mismo a
// nivel de datos; aquí se prueba que la pantalla llega a esas RPC.
//
// Solo contra el CLON LOCAL y en escritorio: consume numeración legal (CONV). Tras la tanda,
// `scripts/local/cargar-local.sh` devuelve el clon a la copia de producción.

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
const marca = Date.now()

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'productor', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'escriu al clon: una sola passada')
})

test('el super_admin dona per vigent el conveni d’una receptora des de la seva fitxa', async ({ page }) => {
  const ent = sql(`select id from entidades where nombre = 'Obrador de Prova' limit 1`)
  test.skip(!ent, 'el clon no té l’Obrador de Prova')
  test.skip(sql(`select count(*) from convenios where entidad_id = '${ent}' and tipo = 'col_receptor' and estado = 'vigent'`) !== '0',
    'ja té el conveni de col·laboració vigent (recarrega el clon)')

  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${ent}`)
  await page.getByRole('button', { name: /Dona’l per vigent|Dalo por vigente/ }).first().click()
  const dialeg = page.getByRole('dialog')
  await expect(dialeg).toBeVisible()
  await dialeg.locator('#cdecl-signant').fill('Persona E2E')
  await dialeg.locator('#cdecl-carrec').fill('Presidenta')
  await dialeg.getByRole('button', { name: /Dona’l per vigent|Dalo por vigente/ }).click()
  await expect(page.getByText(/Conveni vigent: CONV-COL-REC-|Convenio vigente: CONV-COL-REC-/)).toBeVisible()

  expect(sql(`select origen || ':' || estado from convenios
    where entidad_id = '${ent}' and tipo = 'col_receptor' and estado = 'vigent'`)).toBe('declarat:vigent')
  await expect(page.getByText(/declarat \(sense signatura\)|declarado \(sin firma\)/).first()).toBeVisible()
})

test('des del detall de l’oferta: copia i marca enviada, registra l’interès i l’aprova', async ({ page, context }) => {
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

  // «Copia i marca com a enviada»: no sale nada; queda la fila con canal manual.
  const copia = page.getByRole('button', { name: /Copia i marca com a enviada|Copia y marca como enviada/ }).first()
  await expect(copia).toBeVisible({ timeout: 30_000 })
  await copia.click()
  await expect.poll(() => sql(`select count(*) from oferta_respuestas where excedente_id = '${oferta}' and canal = 'manual' and estado = 'pendent'`))
    .toBe('1')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('[E2E] Avellana')

  // «Registra l'interès»: el mismo formulario y las mismas guardas que el Mercat.
  const form = page.locator('#od-interes')
  await form.locator('#od-interes-entitat').selectOption(ent)
  await form.locator('#od-interes-kg').fill('50')
  await form.getByRole('button', { name: /Registra l’interès|Registra el interés/ }).click()
  await expect(page.getByText(/Interès registrat|Interés registrado/)).toBeVisible()
  await expect.poll(() => sql(`select canal || ':' || estado || ':' || aprovacio || ':' || (kg_solicitados = 50)
    from oferta_respuestas where excedente_id = '${oferta}' and entidad_id = '${ent}'`)).toBe('asistido:acceptada:pendent:true')

  // Y se aprueba con el formulario compartido: nace la canalización con lo aprobado.
  await page.getByRole('button', { name: /Aprovar i canalitzar|Aprobar y canalizar/ }).click()
  await expect(page.getByText(/Oferta aprovada i convertida en canalització|aprobada y convertida/)).toBeVisible()
  await expect.poll(() => sql(`select (kg_confirmados = 50) || ':' || valorizacion from canalizaciones where excedente_id = '${oferta}'`))
    .toBe('true:donacio')

  sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${oferta}'`)
})
