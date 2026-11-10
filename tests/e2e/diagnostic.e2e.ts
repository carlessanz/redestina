// El diagnóstico operativo del productor, tres secciones (A1 `20270520100000`, A4
// `20270521100000`, A3 `20270522100000`): la Operativa de la ficha, los EXCEDENTES por producto
// principal × causa del catálogo `causas` (el de las ofertas, D7) con una acción por destino, y
// las ACCIONES con su estado. Lo conduce el EQUIPO (D5) y el productor lo LEE. Guardar no genera
// ningún plan (el historial se retiró con la deuda 174).
//
// Solo contra el CLON LOCAL y solo en escritorio (escribe el diagnóstico de la cuenta de prueba).
// Al terminar deja el fixture del arnés como estaba (`fixtureDiagnostic.ts`).

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql, tria } from './ajuda'
import { fotoOperativa, restauraFixtureDiagnostic } from './fixtureDiagnostic'

test.describe.configure({ mode: 'serial' })
const RECEPTOR = 'receptor-carles'

/** La foto de la Operativa y las notas de antes, para restaurarlas (null = no se ha tocado nada). */
let foto: string | null = null
/** El producto y la causa de una oferta real del productor (el cruce con las ofertas). */
let oferta: { producte: string; causa: string; nomCausa: string } | null = null
let segon = ''

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('superadmin', 'productor', RECEPTOR, 'receptor-social')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Escriu el diagnòstic de la fitxa de prova: només a escriptori')
})

test.afterAll(() => {
  if (foto === null) return
  restauraFixtureDiagnostic(productorDe('productor'), foto)
  foto = null
})

test('el equipo registra excedentes por producto y causa, con una acción por destino', async ({ page }) => {
  const prod = productorDe('productor')
  foto = fotoOperativa(prod)
  // Una oferta del productor con causa: su producto será el primer principal (el cruce, D7).
  let fila = sql(`select e.producto || '|' || e.causa_codigo from excedentes e
                   join productos p on p.nombre = e.producto
                  where e.productor_id = '${prod}' and e.causa_codigo is not null
                  order by (e.producto = 'Tomàquet') desc, e.producto, e.causa_codigo limit 1`)
  if (!fila) {
    // Sin ninguna, se le pone causa a la primera oferta suya de un producto del catálogo.
    sql(`update excedentes set causa_codigo = 'EX' where id = (
           select e.id from excedentes e join productos p on p.nombre = e.producto
            where e.productor_id = '${prod}' order by e.created_at limit 1)`)
    fila = sql(`select e.producto || '|' || e.causa_codigo from excedentes e
                 where e.productor_id = '${prod}' and e.causa_codigo is not null limit 1`)
  }
  const [producte, causa] = fila.split('|')
  oferta = { producte, causa, nomCausa: sql(`select nombre from causas where codigo = '${causa}'`) }
  segon = producte === 'Carbassó' ? 'Tomàquet' : 'Carbassó'
  // La otra causa: la primera del catálogo que no sea la de la oferta.
  const altra = sql(`select codigo || '|' || nombre from causas where codigo <> '${causa}' order by codigo limit 1`).split('|')

  // Dos habituales y dos principales; sin bloques de excedentes.
  sql(`update productores set productos_habituales = array['${producte}', '${segon}'],
         productes_principals = array['${producte}', '${segon}'] where id = '${prod}'`)
  sql(`delete from diagnostic_productes where productor_id = '${prod}'`)
  const plans0 = sql(`select count(*) from planes_prevencion where productor_id = '${prod}'`)

  await entra(page, 'superadmin')
  await page.goto(`/equip/diagnostics/productor/${prod}`)
  await expect(page.getByTestId('formulari-diagnostic')).toBeVisible()
  // Hay cabecera guardada y faltan los excedentes de los dos principales: «A mitges».
  await expect(page.getByTestId('estat-diagnostic')).toHaveText(/A mitges|A medias/)
  // Ni rastro del motor genérico ni del plan básico.
  await expect(page.getByText(/Emet el pla|Prepara el pla|Qüestionari provisional|Proposat des de la fitxa/)).toHaveCount(0)

  // Tres chips, y cada uno lleva a su sección y le pasa el foco.
  for (const s of ['operativa', 'excedents', 'accions']) {
    await page.getByTestId(`xip-seccio-${s}`).click()
    await expect(page.locator(`#diag-sec-${s}`)).toBeFocused()
  }
  await expect(page.getByTestId('xip-seccio-excedents')).not.toContainText(/completa/)

  // Primer principal: la causa de la oferta y otra, con todos sus datos y una acción por destino.
  const b1 = page.getByTestId(`bloc-exc-${producte}`)
  await expect(b1).toBeVisible()
  await b1.locator('[aria-labelledby="diag-exc-0-causes-l"]').getByRole('button', { name: oferta.nomCausa, exact: true }).click()
  await b1.locator('[aria-labelledby="diag-exc-0-causes-l"]').getByRole('button', { name: altra[1], exact: true }).click()
  const omple = async (codi: string, freq: string, kg: string, gestio: RegExp[], destins: RegExp[], accions: Record<string, string>) => {
    await tria(page.locator(`#diag-exc-0-${codi}-freq`), freq)
    await page.locator(`#diag-exc-0-${codi}-volum`).fill(kg)
    for (const g of gestio) await page.locator(`[aria-labelledby="diag-exc-0-${codi}-gestio-l"]`).getByRole('button', { name: g }).click()
    for (const d of destins) await page.locator(`[aria-labelledby="diag-exc-0-${codi}-destins-l"]`).getByRole('button', { name: d }).click()
    for (const [desti, text] of Object.entries(accions)) await page.locator(`#diag-exc-0-${codi}-accio-${desti}`).fill(text)
  }
  await omple(causa, 'estacional', '300', [/^Donació$/, /^Residu$/], [/^Donació$/, /^Venda$/],
    { donacio: 'E2E: conveni amb un banc d’aliments', venda: 'E2E: venda de segona al mercat' })
  await omple(altra[0], 'puntual', '120', [/^Venda alternativa$/], [/^Maquila$/], { maquila: 'E2E: maquila de conserves' })
  // Segundo principal: «Sense excedent».
  await page.getByTestId(`bloc-exc-${segon}`).getByRole('checkbox', { name: /Sense excedent|Sin excedente/ }).check()
  await expect(page.getByTestId('diag-falten')).toHaveCount(0)

  const desa = page.getByRole('button', { name: /^Desa el diagnòstic$|^Guarda el diagnóstico$/ })
  await expect(desa).toHaveCount(1)
  await desa.click()
  await expect(page.getByText(/Diagnòstic desat i complet|Diagnóstico guardado y completo/).first()).toBeVisible()
  await expect(page.getByTestId('estat-diagnostic')).toHaveText(/Contestat|Contestado/)

  // En la base: dos bloques, dos causas, tres acciones pendientes; complet.
  expect(sql(`select count(*) from diagnostic_productes where productor_id = '${prod}'`)).toBe('2')
  expect(sql(`select string_agg(causa_codi || ':' || frequencia || ':' || volum_kg, ',' order by causa_codi)
                from diagnostic_excedents where productor_id = '${prod}'`))
    .toBe([`${causa}:estacional:300`, `${altra[0]}:puntual:120`].sort().join(','))
  expect(sql(`select count(*) || ':' || bool_and(a.estat = 'pendent') from diagnostic_accions a
                join diagnostic_excedents e on e.id = a.excedent_id where e.productor_id = '${prod}'`)).toBe('3:true')
  expect(sql(`select complet from diagnostics where productor_id = '${prod}'`)).toBe('t')
  // 🔴 El criterio de aceptación de A3: el diagnóstico CRUZA con las ofertas por producto y causa.
  expect(Number(sql(`select count(*) from excedentes e join diagnostic_excedents d
                        on d.productor_id = e.productor_id and d.producte = e.producto and d.causa_codi = e.causa_codigo
                     where e.productor_id = '${prod}'`))).toBeGreaterThanOrEqual(1)
  // Ningún plan nuevo (D4). El historial ya no existe (deuda 174).
  expect(sql(`select count(*) from planes_prevencion where productor_id = '${prod}'`)).toBe(plans0)

  // La sección 3 enseña las tres acciones guardadas.
  await expect(page.getByTestId('diag-accions').locator('li[data-testid^="accio-"]')).toHaveCount(3)

  // Desmarcar el primer principal en la Operativa: su bloque pasa a «Ja no és principal» y se conserva.
  await page.locator('[aria-labelledby="diag-op-productes_principals-l"]').getByRole('button', { name: producte, exact: true }).click()
  const conservats = page.getByTestId('exc-conservats')
  await expect(conservats.getByTestId(`bloc-exc-${producte}`)).toBeVisible()
  await expect(conservats.getByTestId('exc-ja-no-principal')).toBeVisible()
  await desa.click()
  // Sin confirmación (no se pierde nada) y sigue completo: el único principal es «sense excedent».
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('estat-diagnostic')).toHaveText(/Contestat|Contestado/)
  expect(sql(`select array_to_string(productes_principals, ',') from productores where id = '${prod}'`)).toBe(segon)
  expect(sql(`select count(*) from diagnostic_accions a join diagnostic_excedents e on e.id = a.excedent_id
               where e.productor_id = '${prod}' and e.producte = '${producte}'`)).toBe('3')
  await expect(page.getByTestId('exc-conservats').getByTestId(`bloc-exc-${producte}`)).toBeVisible()

  // Quitar un destino con acción guardada pide confirmación; cancelar no borra nada.
  await page.getByTestId('exc-conservats').locator(`[aria-labelledby$="-${altra[0]}-destins-l"]`).getByRole('button', { name: /^Maquila$/ }).click()
  await desa.click()
  const dialeg = page.getByRole('dialog')
  await expect(dialeg).toContainText(/Es perdrà 1 acció|Se perderá 1 acción/)
  await dialeg.getByRole('button', { name: /^Cancel·lar$|^Cancelar$/ }).click()
  expect(sql(`select count(*) from diagnostic_accions a join diagnostic_excedents e on e.id = a.excedent_id
               where e.productor_id = '${prod}'`)).toBe('3')
  await page.reload()
  await expect(page.getByTestId('exc-conservats').getByTestId(`bloc-exc-${producte}`)).toBeVisible()
})

test('en la ficha › Gestió interna, el equipo marca una acción «Feta» y su nota', async ({ page }) => {
  test.skip(oferta === null, 'Depèn de la prova anterior')
  const prod = productorDe('productor')
  const org = sql(`select organizacion_id from productores where id = '${prod}'`)
  const accio = sql(`select a.id from diagnostic_accions a join diagnostic_excedents e on e.id = a.excedent_id
                      where e.productor_id = '${prod}' and e.producte = '${oferta!.producte}'
                        and e.causa_codi = '${oferta!.causa}' and a.desti = 'donacio'`)
  await entra(page, 'superadmin')
  await page.goto(`/equip/entitats/${org}?pestanya=intern`)
  const bloc = page.getByTestId('bloc-accions-diagnostic')
  await expect(bloc).toBeVisible()
  await expect(bloc.locator('li[data-testid^="accio-"]')).toHaveCount(3)
  await tria(page.locator(`#accio-estat-${accio}`), 'feta')
  await expect(page.getByText(/Estat de l’acció desat|Estado de la acción guardado/).first()).toBeVisible()
  expect(sql(`select estat || ':' || (feta_at is not null) from diagnostic_accions where id = '${accio}'`)).toBe('feta:true')
  await page.locator(`#accio-nota-${accio}`).fill('E2E: conveni signat amb el banc')
  await page.getByTestId(`accio-desa-nota-${accio}`).click()
  await expect(page.getByText(/Nota de seguiment desada|Nota de seguimiento guardada/).first()).toBeVisible()
  expect(sql(`select estat || ':' || notes from diagnostic_accions where id = '${accio}'`)).toBe('feta:E2E: conveni signat amb el banc')

  // El filtro por estado.
  await tria(page.locator(`#filtre-accions-${prod}`), 'feta')
  await expect(bloc.locator('li[data-testid^="accio-"]')).toHaveCount(1)

  // Y en «Diagnòstic i perfil», el resumen con el estado.
  await page.goto(`/equip/entitats/${org}?pestanya=diagnostic`)
  const resum = page.getByTestId('resum-diagnostic')
  await expect(resum).toBeVisible()
  await expect(resum.getByTestId('resum-excedents')).toContainText(oferta!.nomCausa)
  await expect(resum.locator('input, textarea, [role="checkbox"], [role="combobox"]')).toHaveCount(0)
  const boto = page.getByRole('link', { name: /Actualitza el diagnòstic|Actualiza el diagnóstico/ })
  await expect(boto).toHaveAttribute('href', `/equip/diagnostics/productor/${prod}`)
})

test('el productor lee su diagnóstico: causas, la acción «Feta» y ningún control', async ({ page }) => {
  test.skip(oferta === null, 'Depèn de la prova anterior')
  await entra(page, 'productor')
  await page.goto('/organitzacio/diagnostic')
  const resum = page.getByTestId('resum-diagnostic')
  await expect(resum).toBeVisible()
  const exc = resum.getByTestId('resum-excedents')
  await expect(exc).toContainText(oferta!.nomCausa)
  await expect(exc).toContainText(/ja no és principal/)
  await expect(exc).toContainText(segon)
  await expect(exc).toContainText(/Sense excedent/)
  await expect(exc.getByTestId('resum-accio').filter({ hasText: 'Feta' })).toHaveCount(1)
  await expect(exc).toContainText('E2E: conveni signat amb el banc')
  await expect(page.getByRole('button', { name: /Desa el diagnòstic|Guarda el diagnóstico|Desa la nota/ })).toHaveCount(0)
  const main = page.locator('main').last()
  await expect(main.locator('input, textarea, [role="checkbox"], [role="combobox"]')).toHaveCount(0)
  // Quién lo actualiza y dónde edita lo suyo.
  await expect(page.getByTestId('diagnostic-qui-actualitza')
    .getByRole('link', { name: /La meva organització|Mi organización/ })).toHaveAttribute('href', '/organitzacio?pestanya=operativa')
})

test('la receptora ve «El meu perfil de recepció» y no «El meu diagnòstic»', async ({ page }) => {
  await entra(page, RECEPTOR)
  await page.goto('/organitzacio')
  const menu = page.locator('[data-sidebar="menu-item"]')
  await expect(menu.filter({ hasText: /El meu perfil de recepció|Mi perfil de recepción/ })).toHaveCount(1)
  await expect(menu.filter({ hasText: /El meu diagnòstic|Mi diagnóstico/ })).toHaveCount(0)
  await page.goto('/organitzacio/diagnostic')
  await expect(page).toHaveURL(/\/organitzacio\/perfil-recepcio$/)
  await expect(page.getByTestId('preferencies-recepcio')).toBeVisible()
})

test('en la ficha de una receptora, «Diagnòstic i perfil» enseña modalidades y preferencias', async ({ page }) => {
  const ent = entidadDe(RECEPTOR)
  const org = sql(`select organizacion_id from entidades where id = '${ent}'`)
  await entra(page, 'superadmin')
  await page.goto(`/equip/entitats/${org}?pestanya=diagnostic`)
  const prefs = page.getByTestId('bloc-preferencies')
  await expect(prefs).toBeVisible()
  await expect(prefs).toContainText(/Modalitats que m’interessen|Modalidades que me interesan/)
  await expect(prefs).toContainText(/Productes que podeu rebre|Productos que podéis recibir/)
  // Y la modalidad ya no se repite en la pestaña Operativa.
  await page.goto(`/equip/entitats/${org}?pestanya=operativa`)
  await expect(page.getByTestId('bloc-receptor')).toBeVisible()
  await expect(page.getByTestId('bloc-receptor')).not.toContainText(/Modalitats que m’interessen|Modalidades que me interesan/)
  // Una receptora (sin papel productor) no tiene acciones del diagnóstico en «Gestió interna».
  // `receptor-carles` es doble rol: se mira una que solo es receptora.
  const social = sql(`select organizacion_id from entidades where id = '${entidadDe('receptor-social')}'`)
  expect(sql(`select productor_id is null from v_organizaciones where id = '${social}'`)).toBe('t')
  await page.goto(`/equip/entitats/${social}?pestanya=intern`)
  await expect(page.getByTestId('bloc-notes')).toBeVisible()
  await expect(page.getByTestId('bloc-accions-diagnostic')).toHaveCount(0)
})
