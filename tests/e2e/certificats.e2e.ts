// Fase 4 de la revisión del cliente del 08-10-2026: el certificado se revisa antes de firmarse.
//
// Solo contra el CLON LOCAL. Los cierres que hay en el clon traen bloqueos de otras pruebas
// (canalizaciones sin conciliar), así que la prueba los vacía por SQL para simular un cálculo
// limpio: lo que se comprueba es el circuito de revisión, no el cálculo, que ya tiene sus
// pruebas. Todo en MODO PRUEBA (`P-CD`/`P-CDP`): en prueba la revisión no condiciona la
// emisión, pero el circuito y las pantallas son los mismos que en real.

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

let periode = ''
let tancament = ''
let donant = ''

// Toca el cierre de prueba compartido del clon: con los dos proyectos a la vez (móvil y
// escritorio) se pisarían. Corre solo en escritorio.
test.beforeAll(({}, info) => {
  if (motiuSaltClon('productor', 'super_admin') || info.project.name !== 'escriptori') return
  const prod = productorDe('productor')
  // 1. Un certificado a demanda de hoy, «limpio».
  periode = sqlCom('super_admin', `select (calcular_certificado_periodo('${prod}', current_date, current_date, 'prueba')).id`)
  // Si una pasada anterior ya dejó esta ventana calculada, se devuelve al punto de partida.
  sql(`delete from avisos where objecte_id = '${periode}'`)
  sql(`update cierres_periodo set revisio_estat = null, revisio_at = null, revisio_per = null, bloqueos = '[{"codigo":"e2e","bloqueja":true}]' where id = '${periode}'`)
  sql(`update cierres_periodo set bloqueos = '[]' where id = '${periode}'`)
  // 2. El cierre de prueba del clon, con un donante sin bloqueos, cerrado.
  // El cierre de prueba, recalculado: tras un `reiniciar_cierre_prueba()` no tiene donantes.
  for (const c of sql(`select id from cierres_ejercicio where modo = 'prueba' and estado = 'obert' order by created_at`).split('\n').filter(Boolean)) {
    sqlCom('super_admin', `select calcular_cierre('${c}')`)
  }
  const fila = sql(`select cd.cierre_id || '|' || cd.id from cierres_donante cd
                     join cierres_ejercicio ce on ce.id = cd.cierre_id and ce.modo = 'prueba'
                    where cd.tipo = 'donacio' and cd.certificado_numero is null and cd.kg_total > 0
                    order by ce.created_at desc, cd.kg_total desc limit 1`)
  ;[tancament, donant] = fila.split('|')
  sql(`update cierres_donante set bloqueos = '[]', valor_total = greatest(valor_total, 1), revisio_estat = null where id = '${donant}'`)
  sql(`update cierres_ejercicio set estado = 'tancat' where id = '${tancament}'`)
})

// Deja el clon como estaba: el cierre de prueba sin certificados y abierto, y la ventana
// de hoy sin certificado a demanda (los dos reinicios solo tocan lo de prueba).
test.afterAll(() => {
  if (!tancament) return
  sqlCom('super_admin', `select reiniciar_cierre_prueba('${tancament}')`)
  sqlCom('super_admin', `select reiniciar_periodes_prova(extract(year from current_date)::int)`)
  sql(`update cierres_ejercicio set estado = 'obert' where id = '${tancament}'`)
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', 'super_admin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Toca el tancament de prova compartit: només a escriptori')
  test.skip(!donant, 'El clon no té cap tancament de prova amb donants')
})

test('el certificado calculado queda «per revisar» y avisa al donante', () => {
  expect(sql(`select revisio_estat from cierres_periodo where id = '${periode}'`)).toBe('pendent_revisio')
  expect(sql(`select count(*) from avisos where tipus = 'certificat_per_revisar' and objecte_id = '${periode}'`)).toBe('1')
})

test('el donante revisa y aprueba su certificado desde «Els meus certificats»', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto('/productor/documents')
  const bloc = page.getByTestId('revisio-pendent').first()
  await expect(bloc).toBeVisible()
  await bloc.getByRole('button', { name: /Aprova el certificat|Aprobar el certificado/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Aprova el certificat|Aprobar el certificado/ }).click()
  await expect(page.getByText(/Certificat aprovat|Certificado aprobado/).first()).toBeVisible()
  // Los dos que estaban pendientes (el anual y el a demanda) pueden salir; basta con uno.
  expect(sql(`select count(*) from (select revisio_estat from cierres_periodo where id = '${periode}'
               union all select revisio_estat from cierres_donante where id = '${donant}') x
               where revisio_estat = 'aprovat_ofertant'`)).not.toBe('0')
})

test('el equipo aprueba en nombre del donante con una nota, y después emite', async ({ page }) => {
  // Si el donante ya aprobó el anual en la prueba anterior, se devuelve a «per revisar».
  sql(`update cierres_donante set revisio_estat = 'pendent_revisio', revisio_at = null, revisio_per = null where id = '${donant}'`)
  await entra(page, 'super_admin')
  await page.goto(`/equip/tancament/${tancament}`)
  await page.getByRole('button', { name: /Aprova en nom del donant|Aprobar en nombre del donante/ }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('textbox').fill('Confirmat per telèfon amb la gerent (prova E2E)')
  await dlg.getByRole('button', { name: /Aprova en nom del donant|Aprobar en nombre del donante/ }).click()
  await expect(page.getByText(/Aprovat per l’equip|Aprobado por el equipo/).first()).toBeVisible()
  expect(sql(`select revisio_estat || '|' || (revisio_nota is not null) from cierres_donante where id = '${donant}'`))
    .toBe('aprovat_equip|true')

  // La emisión (en prueba) lleva la revisión en el snapshot del certificado.
  const r = sqlCom('super_admin', `select (emitir_certificado('${donant}', null))->>'numero'`)
  expect(r).toMatch(/^P-CD-/)
  expect(sql(`select datos->'revisio'->>'estat' from documentos where objeto_id = '${donant}' and tipo = 'CD' and vigente`))
    .toBe('aprovat_equip')
})
