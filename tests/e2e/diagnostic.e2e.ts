// A1 (`20270520100000`): UN diagnóstico por productor (`diagnostics`, se sobrescribe), que
// conduce el EQUIPO (D5) y el productor LEE. Guardar no genera ningún plan ni escribe en
// `diagnostics_historial` (P10). En la ficha, la pestaña «Diagnòstic i perfil» enseña el
// resumen (productor) o el perfil de recepción entero (receptora).
// Solo contra el CLON LOCAL y solo en escritorio (escribe el diagnóstico de la cuenta de prueba).

import { expect, test } from '@playwright/test'
import { entidadDe, entra, motiuSaltClon, productorDe, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })
const RECEPTOR = 'receptor-carles'

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('superadmin', 'productor', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Escriu el diagnòstic de la fitxa de prova: només a escriptori')
})

test('el equipo contesta desde su pantalla, guarda a medias y completa; no se genera ningún plan', async ({ page }) => {
  const prod = productorDe('productor')
  // Se parte de un diagnóstico vacío y sin productos derivados.
  sql(`delete from diagnostics where productor_id = '${prod}'`)
  sql(`update productores set productos_habituales = '{}', temporada = null where id = '${prod}'`)
  const historial0 = sql(`select count(*) from diagnostics_historial where productor_id = '${prod}'`)
  const plans0 = sql(`select count(*) from planes_prevencion where productor_id = '${prod}'`)

  await entra(page, 'superadmin')
  await page.goto(`/equip/diagnostics/productor/${prod}`)
  const formulari = page.getByTestId('formulari-diagnostic')
  await expect(formulari).toBeVisible()
  await expect(page.getByTestId('estat-diagnostic')).toHaveText(/Sense començar|Sin empezar/)
  // Ni rastro del plan básico (D4).
  await expect(page.getByText(/Emet el pla|Emite el plan|Prepara el pla|Prepara el plan|Pla proposat|Plan propuesto/)).toHaveCount(0)

  // Un chip lleva a su sección y le pasa el foco (teclado y lector de pantalla).
  await page.getByTestId('xip-seccio-excedents').click()
  await expect(page.locator('#diag-sec-excedents')).toBeFocused()
  await expect(page.locator('#diag-sec-excedents')).toBeInViewport()

  // Sin familias no hay productos que elegir.
  await expect(page.getByText(/Marca primer les famílies|Marca primero las familias/).first()).toBeVisible()
  await page.getByRole('checkbox', { name: /^Hortalissa de fruit$|^Hortaliza de fruto$/ }).click()
  await page.getByRole('button', { name: 'Tomàquet', exact: true }).first().click()
  await page.getByRole('button', { name: 'Carbassó', exact: true }).first().click()

  // Los principales salen de lo marcado arriba.
  const principals = page.locator('[aria-labelledby="diag-productes_principals-etiqueta"]')
  await principals.getByRole('button', { name: 'Tomàquet', exact: true }).click()
  await page.locator('#diag-volum_producte-0').fill('12000')
  const temporada = page.locator('[aria-labelledby="diag-temporada-0-l"]')
  for (const m of [/^jun$/, /^jul$/, /^ago$/]) await temporada.getByRole('button', { name: m }).click()

  // La sección de productos ya está completa: su chip lo dice (también en texto).
  await expect(page.getByTestId('xip-seccio-productes')).toContainText(/completa/)

  // Guardar a medias: UN solo botón, que guarda aunque falten obligatorias.
  const desa = page.getByRole('button', { name: /^Desa el diagnòstic$|^Guarda el diagnóstico$/ })
  await expect(desa).toHaveCount(1)
  await desa.click()
  await expect(page.getByText(/Desat\. Preguntes obligatòries pendents|Guardado\. Preguntas obligatorias pendientes/).first()).toBeVisible()
  expect(sql(`select complet from diagnostics where productor_id = '${prod}'`)).toBe('f')
  await expect(page.getByTestId('estat-diagnostic')).toHaveText(/A mitges|A medias/)

  // Completar las obligatorias que quedan.
  await page.locator('[aria-labelledby="diag-situacions_excedent-etiqueta"]')
    .getByRole('checkbox', { name: /^Criteris de qualitat o estètica$|^Criterios de calidad o estética$/ }).click()
  await page.locator('#diag-frequencia_excedent').click()
  await page.getByRole('option', { name: /^Estacionalment$|^Estacionalmente$/ }).click()
  await page.locator('#diag-volum_excedent').click()
  await page.getByRole('option', { name: /250–500 kg/ }).click()
  await page.locator('[aria-labelledby="diag-canals_actuals-etiqueta"]').getByRole('checkbox', { name: /^Donació$|^Donación$/ }).click()
  await page.locator('[aria-labelledby="diag-sortides_interes-etiqueta"]').getByRole('checkbox', { name: /^Donació$|^Donación$/ }).click()
  await desa.click()
  await expect(page.getByText(/Diagnòstic desat i complet|Diagnóstico guardado y completo/).first()).toBeVisible()
  await expect(page.getByTestId('estat-diagnostic')).toHaveText(/Contestat|Contestado/)

  // UNA fila, completa; productos y temporada derivados; y ni historial ni plan nuevos (P10, D4).
  expect(sql(`select count(*) || ':' || bool_and(complet) from diagnostics where productor_id = '${prod}'`)).toBe('1:true')
  expect(sql(`select array_to_string(productos_habituales, ',') from productores where id = '${prod}'`)).toMatch(/Tomàquet/)
  expect(sql(`select temporada -> 'Tomàquet' from productores where id = '${prod}'`)).toBe('[6, 7, 8]')
  expect(sql(`select count(*) from diagnostics_historial where productor_id = '${prod}'`)).toBe(historial0)
  expect(sql(`select count(*) from planes_prevencion where productor_id = '${prod}'`)).toBe(plans0)

  // Al volver a entrar se abre con lo guardado.
  await page.reload()
  await expect(page.locator('#diag-volum_producte-0')).toHaveValue('12000')
})

test('la ficha del productor enseña el resumen y el botón para actualizarlo', async ({ page }) => {
  const prod = productorDe('productor')
  const org = sql(`select organizacion_id from productores where id = '${prod}'`)
  await entra(page, 'superadmin')
  await page.goto(`/equip/entitats/${org}?pestanya=diagnostic`)
  const resum = page.getByTestId('resum-diagnostic')
  await expect(resum).toBeVisible()
  await expect(resum).toContainText('Tomàquet')
  await expect(resum).toContainText(/Contestat|Contestado/)
  await expect(resum).toContainText(/Actualitzat el|Actualizado el/)
  // Lectura: ni un control de formulario dentro del resumen.
  await expect(resum.locator('input, textarea, [role="checkbox"], [role="combobox"]')).toHaveCount(0)
  const boto = page.getByRole('link', { name: /Actualitza el diagnòstic|Actualiza el diagnóstico/ })
  await expect(boto).toHaveAttribute('href', `/equip/diagnostics/productor/${prod}`)
})

test('el productor lee su diagnóstico: sin campos ni botón «Desa»', async ({ page }) => {
  await entra(page, 'productor')
  await page.goto('/organitzacio/diagnostic')
  const resum = page.getByTestId('resum-diagnostic')
  await expect(resum).toBeVisible()
  await expect(resum).toContainText('Tomàquet')
  await expect(page.getByRole('button', { name: /Desa el diagnòstic|Guarda el diagnóstico/ })).toHaveCount(0)
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
})
