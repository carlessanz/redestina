// Enlaces directos (fase 4 de los puntos 4-6, Excel 4.2, 4.4 y 5.4):
//
//   a. Sin sesión, el enlace de una oferta del Mercat lleva al acceso; tras entrar —aunque se haya
//      perdido el `state` de la navegación— vuelve a ESA URL con el formulario de interés abierto.
//   b. Una oferta que la cuenta ya no ve, o una operación que no es suya: aviso claro.
//   c. El equipo: `/equip/ofertes/<id>?accio=recollida&canalitzacio=<id>` abre «Registrar la
//      recollida» de esa canalización; y la receptora, `?operacio=…&accio=recollida`, su ficha
//      con el formulario desplegado.
//   d. Un destino externo guardado en `sessionStorage` se ignora.
//   e. Un enlace de otro panel: aviso y al propio.
//
// Solo contra el CLON LOCAL y en escritorio (escribe una oferta y una asignación de prueba, que se
// dejan anuladas y canceladas).

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { compte, entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
const marca = Date.now()

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'productor', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'escriu al clon: una sola passada')
})

/** Una oferta de donación de prueba, en el estado pedido. */
function novaOferta(sufix: string, estado: 'publicada' | 'cancelada'): string {
  const prod = productorDe('productor')
  return sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, coste_kg, disponible_hasta, observacions, texto_oferta, motivo_no_colocada)
    values ('E-E2E-ED-${sufix}-${marca}', '${prod}', 'Avellana', 150, '${estado}', 'asistido', 'donacio', '{donacio}', 0.5, current_date + 5, '[E2E] enllaços directes', '[E2E] Avellana', ${estado === 'cancelada' ? "'Prova E2E'" : 'null'})
    returning id`).split('\n')[0]
}

/** Rellena el formulario de acceso que ya está en pantalla (sin ir a `/login` antes). */
async function omplAcces(page: Page, rol: string): Promise<void> {
  const c = compte(rol)!
  await page.locator('input[type="email"]').first().fill(c.email)
  await page.locator('input[type="password"]').first().fill(c.password)
  await page.locator('button[type="submit"]').first().click()
}

const ofertes: string[] = []
let canal: string | null = null

test.afterAll(() => {
  if (motiuSaltClon('super_admin', 'productor', RECEPTOR)) return
  if (canal) {
    try { sqlCom('superadmin', `select id from anular_assignacio('${canal}', 'Prova E2E: enllaços directes')`) } catch { /* ya anulada */ }
  }
  for (const o of ofertes) {
    // Con canalización (aunque anulada) no se puede borrar: se cancela.
    if (sql(`select count(*) from canalizaciones where excedente_id = '${o}'`) !== '0') {
      sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${o}'`)
      continue
    }
    try {
      sql(`delete from excedentes where id = '${o}'`)
    } catch {
      sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${o}'`)
    }
  }
})

test('a. sense sessió: l’enllaç de l’oferta sobreviu a l’accés i obre el formulari d’interès', async ({ page }) => {
  const oferta = novaOferta('A', 'publicada')
  ofertes.push(oferta)
  // La receptora tiene que poder verla (RLS: tipo de receptor y entidad activa).
  test.skip(sqlCom(RECEPTOR, `select count(*) from excedentes where id = '${oferta}'`) !== '1',
    'la receptora de prova no veu una donació al clon')

  const enllac = `/receptor/mercat?oferta=${oferta}&accio=interes`
  await page.goto(enllac)
  await page.waitForURL((u) => u.pathname === '/login')
  // Se pierde el `state` de la navegación (como al recargar tras el correo de primer acceso):
  // el destino tiene que salir de `sessionStorage`.
  await page.goto('/login')
  await omplAcces(page, RECEPTOR)
  await page.waitForURL((u) => u.pathname === '/receptor/mercat' && u.searchParams.get('oferta') === oferta,
    { timeout: 30_000 })
  const dialeg = page.getByRole('dialog')
  await expect(dialeg).toBeVisible({ timeout: 30_000 })
  await expect(dialeg.locator('#mk-kg')).toBeVisible()
  await expect(dialeg.getByText('Avellana').first()).toBeVisible()
  // Consumido: no queda nada para el siguiente acceso.
  expect(await page.evaluate(() => sessionStorage.getItem('redestina-desti'))).toBeNull()

  // Cerrar el diálogo quita la oferta de la URL (sin dejar rastro en el historial).
  await page.keyboard.press('Escape')
  await expect(dialeg).toBeHidden()
  await expect.poll(() => new URL(page.url()).searchParams.get('oferta')).toBeNull()
})

test('b. una oferta o una operació que ja no es veu: avís clar, cap diàleg buit', async ({ page }) => {
  const tancada = novaOferta('B', 'cancelada')
  ofertes.push(tancada)
  await entra(page, RECEPTOR)
  await page.goto(`/receptor/mercat?oferta=${tancada}&accio=interes`)
  await expect(page.getByTestId('enllac-no-disponible')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('enllac-no-disponible'))
    .toContainText(/ja no està disponible per a tu|ya no está disponible para ti/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // «D'acord» lo quita y limpia la URL.
  await page.getByTestId('enllac-no-disponible').getByRole('button').click()
  await expect(page.getByTestId('enllac-no-disponible')).toHaveCount(0)
  await expect.poll(() => new URL(page.url()).searchParams.get('oferta')).toBeNull()

  await page.goto('/receptor/interessos?operacio=00000000-0000-4000-8000-000000000000&accio=recollida')
  await expect(page.getByTestId('enllac-no-disponible')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('c. «Registrar la recollida» per enllaç: l’equip i la receptora', async ({ page, browser }) => {
  const ent = entidadDe(RECEPTOR)
  // Albaranes viejos de esta receptora con el enlace sin usar la bloquean (G1): no es lo que se prueba.
  sql(`update enlaces_token t set estado = 'revocado'
         from albaranes a join canalizaciones c on c.id = a.canalizacion_id
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id and t.estado = 'activo'
          and t.usado_at is null and c.entidad_id = '${ent}'`)
  const oferta = novaOferta('C', 'publicada')
  ofertes.push(oferta)
  canal = sqlCom('superadmin', `select id from assignar_directe('${oferta}', '${ent}', 50)`)
  expect(canal).toMatch(/^[0-9a-f-]{36}$/)

  await entra(page, 'superadmin')
  await page.goto(`/equip/ofertes/${oferta}?accio=recollida&canalitzacio=${canal}`)
  const dialeg = page.getByRole('dialog')
  await expect(dialeg).toBeVisible({ timeout: 30_000 })
  await expect(dialeg.getByTestId('fitxa-operacio')).toBeVisible({ timeout: 30_000 })
  await expect(dialeg.locator('#rrec-resultat-assistit')).toBeVisible()
  // Cerrarlo quita la acción de la URL.
  await dialeg.getByRole('button', { name: /^Cancel·lar$|^Cancelar$/ }).first().click()
  await expect(dialeg).toBeHidden()
  await expect.poll(() => new URL(page.url()).searchParams.get('accio')).toBeNull()

  // Una canalización que no es de esta oferta: aviso.
  await page.goto(`/equip/ofertes/${oferta}?accio=recollida&canalitzacio=00000000-0000-4000-8000-000000000000`)
  await expect(page.getByTestId('enllac-no-disponible')).toBeVisible({ timeout: 30_000 })

  // `?accio=assigna`: el formulario a la vista y la acción fuera de la URL.
  await page.goto(`/equip/ofertes/${oferta}?accio=assigna`)
  await expect(page.locator('#od-interes')).toBeInViewport({ timeout: 30_000 })
  await expect.poll(() => new URL(page.url()).searchParams.get('accio')).toBeNull()

  // La receptora, por el enlace del mensaje RECOLLIDA CONFIRMADA: su ficha con el formulario.
  const ctxRec = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const rec = await ctxRec.newPage()
  await entra(rec, RECEPTOR)
  await rec.goto(`/receptor/interessos?operacio=${canal}&accio=recollida`)
  const fitxa = rec.getByRole('dialog')
  await expect(fitxa.getByTestId('fitxa-operacio')).toBeVisible({ timeout: 30_000 })
  if (sqlCom(RECEPTOR, `select pot_registrar from operacio_detall('${canal}')`) === 't') {
    await expect(fitxa.locator('#rrec-resultat-propi')).toBeVisible()
  }
  await ctxRec.close()
})

test('d. un destí extern guardat a sessionStorage s’ignora', async ({ page }) => {
  for (const extern of ['//evil.test/receptor/mercat', 'https://evil.test/receptor/mercat']) {
    await page.goto('/login')
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.evaluate((ruta) => {
      sessionStorage.setItem('redestina-desti', JSON.stringify({ ruta, at: Date.now() }))
    }, extern)
    await page.goto('/login')
    await omplAcces(page, RECEPTOR)
    // Al panel propio: `/panell` resuelve el suyo (no se queda en la raíz por rol).
    await page.waitForURL((u) => !/\/(login|admin|panell)$/.test(u.pathname), { timeout: 30_000 })
    const url = new URL(page.url())
    expect(url.hostname).not.toContain('evil')
    expect(url.pathname.startsWith('/receptor/')).toBe(true)
  }
})

test('e. un enllaç d’un altre panell: avís i al propi', async ({ page }) => {
  await entra(page, RECEPTOR)
  // La cuenta de Carles puede tener doble rol; con el del equipo no hay nada que probar.
  test.skip(sqlCom(RECEPTOR, 'select es_intern()') === 't', 'la compte de prova també és de l’equip')
  await page.goto('/equip/tauler')
  await expect(page.getByText(/d’un altre panell que no tens|de otro panel que no tienes/)).toBeVisible({ timeout: 30_000 })
  await page.waitForURL((u) => !u.pathname.startsWith('/equip'))
})

test('f. entitats prioritzades: el missatge individual porta l’enllaç només si l’entitat té compte', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const oferta = novaOferta('F', 'publicada')
  ofertes.push(oferta)
  await entra(page, 'superadmin')
  await page.goto(`/equip/ofertes/${oferta}`)
  await page.getByTestId('od-ranking').locator('summary').click()
  const copia = page.getByRole('button', { name: /Copia i marca com a enviada|Copia y marca como enviada/ }).first()
  await expect(copia).toBeVisible({ timeout: 30_000 })
  // Se espera a saber si cada fila tiene cuenta (la consulta va aparte del ranking).
  await expect(page.locator('[data-testid="od-ranking-fila"][data-compte="pendent"]')).toHaveCount(0)
  const primera = page.getByTestId('od-ranking-fila').first()
  // Sin cuenta: aviso y «Dona-li accés» a la pestaña Contacte de su ficha. En el clon todas las
  // entidades activas tienen cuenta; si un día no, se comprueba el enlace.
  const senseAcces = await page.getByTestId('od-sense-acces').count()
  if (senseAcces > 0) {
    await expect(page.getByTestId('od-dona-acces').first()).toHaveAttribute('href', /^\/equip\/entitats\/[0-9a-f-]{36}\?pestanya=contacte$/)
  }
  // El texto de la primera fila: con cuenta, el enlace a la oferta; sin ella, que responda.
  const teCompte = await primera.getAttribute('data-compte')
  await primera.getByRole('button', { name: /Copia i marca com a enviada|Copia y marca como enviada/ }).click()
  const text = () => page.evaluate(() => navigator.clipboard.readText())
  if (teCompte === 'true') await expect.poll(text).toContain(`/receptor/mercat?oferta=${oferta}&accio=interes`)
  else await expect.poll(text).toContain('respon aquest missatge')
})
