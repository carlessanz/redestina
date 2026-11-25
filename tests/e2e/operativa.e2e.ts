// A4 (`20270521100000`): la Operativa del productor — lugares de recogida con días, franjas y
// UN principal; envases y comercialización en su ficha — y la oferta nueva que nace con lo que
// la ficha propone (lugar principal, su franja y el formato del envase habitual), marcado.
// Solo contra el CLON LOCAL y solo en escritorio (edita la ficha de la cuenta de prueba).

import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { APIRequestContext, Page } from '@playwright/test'
import { compte, entra, motiuSaltClon, productorDe, sql, tria } from './ajuda'

const API = 'http://127.0.0.1:55321'

/** La sesión del equipo en el clon, para llamar a `crear-oferta` como lo hace el panel. */
async function jwtEquip(request: APIRequestContext): Promise<{ jwt: string; clau: string }> {
  const clau = /VITE_SUPABASE_PUBLISHABLE_KEY=(.+)/.exec(readFileSync('.env.supabase-local.local', 'utf8'))![1].trim()
  const c = compte('superadmin')!
  const r = await request.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: clau }, data: { email: c.email, password: c.password },
  })
  expect(r.ok(), 'login del equipo en el clon').toBeTruthy()
  return { jwt: (await r.json()).access_token as string, clau }
}

/** Elige la entidad en el buscador de la oferta asistida: escribe su nombre y toca la sugerencia. */
async function triaProductor(page: Page, prod: string) {
  const nom = sql(`select coalesce(nullif(empresa, ''), name) from productores where id = '${prod}'`)
  const dlg = page.getByRole('dialog')
  await dlg.locator('#dnoa-productor').fill(nom)
  await dlg.locator(`#dnoa-productor-llista [data-valor="${prod}"]`).click()
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', 'superadmin', 'equip')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Edita la fitxa de prova compartida: només a escriptori')
})

const ALIAS_A = 'E2E A4 Magatzem'
const ALIAS_B = 'E2E A4 Camp'

test('el productor añade dos lugares, con días y franja, y cambia el principal', async ({ page }) => {
  const prod = productorDe('productor')
  sql(`delete from productor_ubicaciones where productor_id = '${prod}' and alias like 'E2E A4 %'
         and not exists (select 1 from excedentes e where e.ubicacion_id = productor_ubicaciones.id)`)
  // Los que no se pueden borrar (los citan ofertas de otras pruebas) se renombran SIN contener el
  // alias de ahora: «E2E A4 Camp (vell)» seguía casando con el filtro de fila de abajo.
  sql(`update productor_ubicaciones set alias = replace(alias, 'E2E A4 ', 'E2E vell A4 ')
        where productor_id = '${prod}' and alias like 'E2E A4 %'`)
  await entra(page, 'productor')
  await page.goto('/organitzacio?pestanya=operativa')

  for (const alias of [ALIAS_A, ALIAS_B]) {
    await page.getByRole('button', { name: /Afegir un lloc nou|Añadir un lugar nuevo/ }).first().click()
    await page.locator('#org-lloc-nom').fill(alias)
    if (alias === ALIAS_B) {
      // Días: lunes y miércoles; una franja de 08:00 a 12:00.
      await page.getByRole('button', { name: /^dl$|^lu$/ }).click()
      await page.getByRole('button', { name: /^dc$|^mi$/ }).click()
      await page.getByRole('button', { name: /Afegeix una franja|Añade una franja/ }).click()
      const franja = page.locator('#org-lloc-franja-0')
      await tria(franja.getByRole('combobox').nth(0), '08')
      await tria(franja.getByRole('combobox').nth(2), '12')
    }
    await page.getByRole('button', { name: /^Desar el lloc$|^Guardar el lugar$/ }).click()
    await expect(page.getByText(alias).first()).toBeVisible()
  }
  const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and alias = '${ALIAS_B}'`)
  expect(sql(`select array_to_string(dies_setmana, ',') || '|' || (franges -> 0 ->> 'inici') || '-' || (franges -> 0 ->> 'fi')
              from productor_ubicaciones where id = '${b}'`)).toBe('1,3|08:00-12:00')
  // Siempre UN principal por productor (índice único parcial).
  expect(sql(`select count(*) from productor_ubicaciones where productor_id = '${prod}' and es_principal`)).toBe('1')

  // «Fes-lo principal» sobre el segundo: pasa a ser el único principal.
  const filaB = page.locator('li, div').filter({ hasText: ALIAS_B }).filter({ has: page.getByRole('button', { name: /Fes-lo principal|Hazlo principal/ }) }).last()
  await filaB.getByRole('button', { name: /Fes-lo principal|Hazlo principal/ }).click()
  await expect(page.getByText(/és ara el lloc principal|es ahora el lugar principal/).first()).toBeVisible()
  expect(sql(`select es_principal from productor_ubicaciones where id = '${b}'`)).toBe('t')
  expect(sql(`select count(*) from productor_ubicaciones where productor_id = '${prod}' and es_principal`)).toBe('1')
})

test('el productor marca envases y canales en su Operativa y se guardan en la ficha', async ({ page }) => {
  const prod = productorDe('productor')
  sql(`update productores set envasos_habituals = null, canals_comercials = null where id = '${prod}'`)
  await entra(page, 'productor')
  await page.goto('/organitzacio?pestanya=operativa')
  await page.locator('[aria-labelledby$="-envasos_habituals-l"]').getByRole('button', { name: /^Caixes$|^Cajas$/ }).click()
  await page.locator('[aria-labelledby$="-canals_comercials-l"]').getByRole('button', { name: /^Venda directa$|^Venta directa$/ }).click()
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).first().click()
  await expect(page.getByText(/Desat|Guardado|desat/i).first()).toBeVisible()
  expect(sql(`select array_to_string(envasos_habituals, ',') || '|' || array_to_string(canals_comercials, ',')
              from productores where id = '${prod}'`)).toBe('caixes|venda_directa')
})

test('la oferta nueva nace con el lugar principal, su franja y el formato del envase', async ({ page }) => {
  const prod = productorDe('productor')
  const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  await entra(page, 'productor')
  // Sin borrador: la precarga solo se aplica a un formulario vacío.
  await page.evaluate((p) => { try { localStorage.removeItem(`redestina-oferta-esborrany:${p}`) } catch { /* */ } }, prod)
  const resposta = page.waitForResponse((r) => r.url().includes('/crear-oferta/campos') && r.request().method() === 'GET')
  await page.goto('/productor/ofertes/nova')
  const cos = await (await resposta).json() as { predeterminats?: { ubicacio: string | null; horari: unknown; format_entrega: string | null } }
  // Fase A del punto 3 (17-11-2026): también los DÍAS del lugar (lunes y miércoles).
  expect(cos.predeterminats).toEqual({
    ubicacio: b, horari: { inici: '08:00', fi: '12:00' }, format_entrega: 'caixes', dies_recollida: [1, 3],
  })

  // El borrador que guarda el formulario ya lleva lo propuesto.
  await expect.poll(async () => page.evaluate((p) => {
    try { return JSON.parse(localStorage.getItem(`redestina-oferta-esborrany:${p}`) ?? 'null')?.datos ?? null } catch { return null }
  }, prod)).toMatchObject({ ubicacio: b, horari: { inici: '08:00', fi: '12:00' }, format_entrega: 'caixes', dies_recollida: [1, 3] })
  await page.evaluate((p) => { try { localStorage.removeItem(`redestina-oferta-esborrany:${p}`) } catch { /* */ } }, prod)
})

// Fase A del punto 3 (17-11-2026): el formulario va por BLOQUES que se abren al completar el
// anterior (sin «Continuar»), el producto se busca escribiendo, las preguntas de sí o no son dos
// botones, el lugar enseña su municipio y su enlace (o pide uno para esta oferta), los días y la
// franja llegan del lugar y «disponible fins» propone hoy + 2. Y a 375 px nada se sale de ancho.
test('el alta va por bloques, con buscador de producto y el lugar con días y Maps', async ({ page }) => {
  const prod = productorDe('productor')
  const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  const clau = `redestina-oferta-esborrany:${prod}`
  await entra(page, 'productor')
  await page.evaluate((k) => { try { localStorage.removeItem(k) } catch { /* */ } }, clau)
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/productor/ofertes/nova')

  await expect(page.getByTestId('bloc-producte')).toHaveAttribute('data-obert', 'true')
  await expect(page.getByTestId('bloc-quantitat')).toHaveAttribute('data-obert', 'false')
  await expect(page.getByRole('button', { name: 'Continuar' })).toHaveCount(0)

  // Producto por buscador, sin acentos; la familia no se pregunta.
  await expect(page.locator('#of-familia')).toHaveCount(0)
  await page.locator('#of-producte').fill('poma')
  await page.locator('#of-producte-llista [role="option"]').filter({ hasText: /^Poma/ }).first().click()
  // «Al camp»: Sí / No; con «Sí» se piden las hectáreas (opcionales), con «No» desaparecen.
  await expect(page.locator('#of-producte_al_camp [data-valor="si"]')).toHaveText(/^Sí$/)
  await page.locator('#of-producte_al_camp [data-valor="si"]').click()
  await expect(page.locator('#of-hectarees')).toBeVisible()
  await page.locator('#of-producte_al_camp [data-valor="no"]').click()
  await expect(page.locator('#of-hectarees')).toHaveCount(0)
  await expect(page.locator('#of-producte_al_camp [data-valor="no"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('bloc-quantitat')).toHaveAttribute('data-obert', 'true')

  // Kilos que no valen: «Publicar» lo marca y no publica.
  await page.locator('#of-kg').fill('0')
  await page.getByRole('button', { name: 'Publicar oferta' }).click()
  await expect(page.locator('#of-kg')).toHaveAttribute('aria-invalid', 'true')
  await page.locator('#of-kg').fill('120')

  // El retorno con «Sí» ya no pide qué envases ni cuántos (19-11-2026: se devuelven todos).
  const retorn = page.locator('#of-retorn')
  if (await retorn.count() === 0) {
    await tria(page.locator('#of-format_entrega'), 'caixes')
  }
  await page.locator('#of-retorn [data-valor="Sí"]').click()
  await expect(page.locator('#of-retorn_envasos')).toHaveCount(0)
  await expect(page.locator('#of-retorn_quantitat')).toHaveCount(0)

  // Recogida: el lugar principal con su municipio y, sin enlace propio, el campo para uno;
  // días y franja del lugar; «disponible fins» = hoy + 2.
  await expect(page.getByTestId('bloc-recollida')).toHaveAttribute('data-obert', 'true')
  await page.getByTestId('lloc-habitual').getByRole('button', { name: /Sí, aquí/ }).click()
  await expect.poll(() => page.evaluate((k) => {
    try { return JSON.parse(localStorage.getItem(k) ?? 'null')?.datos?.ubicacio ?? null } catch { return null }
  }, clau)).toBe(b)
  await expect(page.getByTestId('lloc-detall')).toBeVisible()
  const llocMaps = sql(`select coalesce(gmaps_url, '') from productor_ubicaciones where id = '${b}'`)
  if (llocMaps) await expect(page.getByTestId('lloc-maps')).toHaveAttribute('target', '_blank')
  else await expect(page.locator('#of-gmaps_url')).toBeVisible()
  await expect(page.locator('#of-dies_recollida [aria-pressed="true"]')).toHaveCount(2)
  const avui = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
  const esperat = new Date(`${avui}T12:00:00Z`)
  esperat.setUTCDate(esperat.getUTCDate() + 2)
  await expect(page.locator('#of-disponible_fins')).toHaveValue(esperat.toISOString().slice(0, 10))

  // A 375 px, ningún hijo del formulario más ancho que su caja.
  const desborden = await page.evaluate(() => {
    const out: string[] = []
    const main = document.querySelector('main')
    if (main && main.scrollWidth > main.clientWidth + 1) out.push(`MAIN ${main.scrollWidth}>${main.clientWidth}`)
    for (const el of document.querySelectorAll('[data-testid="formulari-oferta"], [data-testid="formulari-oferta"] *')) {
      const h = el as HTMLElement
      if (h.scrollWidth > h.clientWidth + 1 && getComputedStyle(h).overflowX === 'visible' && h.clientWidth > 0) {
        out.push(`${h.tagName}#${h.id} ${h.scrollWidth}>${h.clientWidth} «${(h.textContent ?? '').slice(0, 40)}» ${h.className}`.slice(0, 200))
      }
    }
    return { doc: document.documentElement.scrollWidth > document.documentElement.clientWidth, out }
  })
  expect(desborden.doc).toBe(false)
  expect(desborden.out).toEqual([])
  await page.evaluate((k) => { try { localStorage.removeItem(k) } catch { /* */ } }, clau)
})

// Fase A del punto 3 en el servidor: `crear-oferta` rechaza 0 kg (`kg_invalid`) y guarda el
// detalle del retorno, los días y el enlace de Maps propio, que el texto de la oferta enseña.
test('crear-oferta: kg > 0 y guarda retorno, días y Maps de la oferta', async ({ request }) => {
  const prod = productorDe('productor')
  const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  const { jwt, clau } = await jwtEquip(request)
  const marca = `[E2E fase A ${Date.now()}]`
  const datos = {
    familia: 'Fruita Dolça', producte: 'Poma', producte_al_camp: 'no', kg: 0, format_entrega: 'caixes',
    retorn: 'Sí', retorn_envasos: 'caixes verdes', retorn_quantitat: 12, ubicacio: b,
    gmaps_url: 'https://maps.app.goo.gl/e2eFaseA', disponible_fins: '31/12/2027', dies_recollida: [3, 1],
    modalitat: 'donacio', causa: 'C3.1', observacions: marca,
  }
  const crida = (d: Record<string, unknown>) => request.post(`${API}/functions/v1/crear-oferta`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: clau }, data: { productor_id: prod, datos: d },
  })
  const zero = await crida(datos)
  expect(zero.status()).toBe(400)
  expect((await zero.json()).code).toBe('kg_invalid')
  const mitja = await crida({ ...datos, kg: 50, retorn_quantitat: 2.5 })
  expect((await mitja.json()).code).toBe('retorn_quantitat_invalid')

  // Fase B del punto 3: el panel manda la SUBCAUSA; una causa vieja o una categoría a secas
  // piden elegirla, y una que no existe no vale.
  for (const [causa, code] of [['CE', 'subcausa_obligatoria'], ['C3', 'subcausa_obligatoria'], ['', 'campos_faltantes'], ['C9.9', 'subcausa_invalida']]) {
    const r = await crida({ ...datos, kg: 50, causa })
    expect(r.status(), causa).toBe(400)
    expect((await r.json()).code, causa).toBe(code)
  }

  const ok = await crida({ ...datos, kg: 50 })
  expect(ok.status(), JSON.stringify(await ok.json())).toBe(200)
  // La causa sale de la subcausa (trigger `excedentes_subcausa`) y el texto lleva las dos.
  expect(sql(`select causa_codigo || '|' || subcausa_codigo || '|' || causa from excedentes where observacions = '${marca}'`))
    .toBe('C3|C3.1|Preu i rendibilitat')
  const fila = sql(`select retorn_envasos || '|' || retorn_envasos_detall || '|' || retorn_envasos_quantitat || '|'
      || array_to_string(dies_recollida, ',') || '|' || gmaps_url
    from excedentes where observacions = '${marca}'`)
  expect(fila).toBe('Sí|caixes verdes|12|1,3|https://maps.app.goo.gl/e2eFaseA')
  const text = sql(`select texto_oferta from excedentes where observacions = '${marca}'`)
  // Fase C: los días y la franja van en UNA línea (sin franja, solo los días).
  expect(text).toContain('⏰ HORARI DE RECOLLIDA: dl, dc')
  expect(text).toContain('cal retornar-los (12 · caixes verdes)')
  expect(text).toContain('https://maps.app.goo.gl/e2eFaseA')
  expect(text).toContain('🔴 CAUSA: Preu i rendibilitat — Preu de venda insuficient')
})

// Fase B del punto 3 (fila 3.6): en el alta del panel la causa se elige por su SUBCAUSA, en un
// solo desplegable agrupado por las 7 categorías; la causa guardada es la de la subcausa. Un
// borrador de antes con una causa vieja (`CE`) llega vacío.
test('el alta elige la subcausa y la causa guardada es la suya', async ({ page }) => {
  const prod = productorDe('productor')
  const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  const clau = `redestina-oferta-esborrany:${prod}`
  const marca = `[E2E fase B ${Date.now()}]`
  await entra(page, 'productor')
  await page.evaluate(([k, lloc, obs]) => {
    localStorage.setItem(k, JSON.stringify({
      datos: {
        familia: 'Fruita Dolça', producte: 'Poma', producte_al_camp: 'no', kg: 80, format_entrega: 'caixes',
        retorn: 'No', ubicacio: lloc, dies_recollida: [1, 3], horari: { inici: '08:00', fi: '12:00' },
        disponible_fins: '2027-12-31', modalitat: ['donacio'], cost_kg: 0.4, causa: 'CE', observacions: obs,
      },
      pas: 0, pasMaxim: 99, costTocat: true, proposats: [], canviaLloc: false, desat: Date.now(),
    }))
  }, [clau, b, marca])
  await page.goto('/productor/ofertes/nova')
  const control = page.locator('#of-causa')
  await expect(control).toBeVisible()
  await expect(control).toHaveAttribute('data-testid', 'of-subcausa')
  // La causa vieja del borrador no es una subcausa: el control llega vacío.
  await expect(control).not.toContainText(/Criteris/)

  // Siete grupos (las categorías activas, en orden) y una opción por subcausa activa.
  await control.click()
  const llista = page.getByRole('listbox')
  await expect(llista.getByRole('option')).toHaveCount(Number(sql('select count(*) from subcausas where activa')))
  const grups = await llista.locator('[data-slot="select-label"]').allTextContents()
  expect(grups).toEqual(sql('select string_agg(nombre, \'|\' order by orden) from causas where activa').split('|'))
  await page.keyboard.press('Escape')
  await llista.waitFor({ state: 'hidden' })

  await tria(control, 'C4.2')
  await expect(page.getByTestId('formulari-oferta'))
    .toContainText('Qualitat i requisits comercials — Qualitat o especificacions no acceptades pel comprador')
  await page.getByRole('button', { name: 'Publicar oferta' }).click()
  await expect.poll(() => sql(`select count(*) from excedentes where observacions = '${marca}'`), { timeout: 15_000 }).toBe('1')
  expect(sql(`select causa_codigo || '|' || subcausa_codigo || '|' || causa from excedentes where observacions = '${marca}'`))
    .toBe('C4|C4.2|Qualitat i requisits comercials')
  expect(sql(`select causa_codigo = (select causa_codigo from subcausas where codigo = 'C4.2') from excedentes where observacions = '${marca}'`))
    .toBe('t')

  // Y se cambia desde «Edita l’oferta»: otra subcausa, otra categoría (`editar_oferta()`).
  const id = sql(`select id from excedentes where observacions = '${marca}'`)
  await page.goto(`/productor/ofertes/${id}`)
  await page.getByRole('button', { name: /^Edita l’oferta$|^Edita la oferta$/ }).click()
  const dlg = page.getByRole('dialog')
  // Fase C: el diálogo es el MISMO formulario del alta, así que el control es el del alta.
  await expect(dlg.locator('#of-causa')).toContainText('Qualitat o especificacions no acceptades pel comprador')
  await tria(dlg.locator('#of-causa'), 'C7.2')
  await expect(dlg).toContainText('Factors externs i sanitaris — Plagues o malalties')
  await dlg.getByRole('button', { name: /^Desa els canvis$|^Guardar los cambios$/ }).click()
  await expect(dlg).toHaveCount(0)
  expect(sql(`select causa_codigo || '|' || subcausa_codigo || '|' || causa from excedentes where id = '${id}'`))
    .toBe('C7|C7.2|Factors externs i sanitaris')
})

// P5 en el panel (11-11-2026): como en WhatsApp, el lugar habitual se confirma o se cambia; el
// propuesto no cuenta como respuesta hasta entonces. El mismo formulario sirve al equipo.
test('la oferta nueva pide confirmar el lugar habitual o cambiarlo', async ({ page }) => {
  const prod = productorDe('productor')
  const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  const alias = sql(`select alias from productor_ubicaciones where id = '${b}'`)
  const clau = `redestina-oferta-esborrany:${prod}`
  await entra(page, 'productor')
  // Un borrador que ya está en «Recollida» y dice que hay que ir a buscarlo, sin lugar.
  await page.evaluate(([k]) => {
    localStorage.setItem(k, JSON.stringify({
      datos: { familia: 'Fruita', producte: 'Poma', producte_al_camp: 'no', kg: 100, transport: 'no' },
      pas: 2, pasMaxim: 2, costTocat: false, desat: Date.now(),
    }))
  }, [clau])
  await page.goto('/productor/ofertes/nova')
  const caixa = page.getByTestId('lloc-habitual')
  await expect(caixa).toBeVisible()
  await expect(caixa).toContainText(alias)
  const llegeix = () => page.evaluate((k) => {
    try { return JSON.parse(localStorage.getItem(k) ?? 'null')?.datos?.ubicacio ?? null } catch { return null }
  }, clau)

  // Sin confirmar no se publica (17-11-2026: ya no hay «Continuar»; «Publicar» lo marca).
  await page.getByRole('button', { name: 'Publicar oferta' }).click()
  await expect(caixa).toHaveClass(/border-error/)

  await caixa.getByRole('button', { name: /Sí, aquí/ }).click()
  await expect(caixa.getByText(/Confirmat|Confirmado/)).toBeVisible()
  await expect.poll(llegeix).toBe(b)

  // «Canvia el lloc»: la lista de siempre, sin nada elegido.
  await caixa.getByRole('button', { name: /Canvia el lloc|Cambiar el lugar/ }).click()
  await expect(page.getByTestId('lloc-habitual')).toHaveCount(0)
  await expect.poll(llegeix).toBe('')
  await page.evaluate((k) => { try { localStorage.removeItem(k) } catch { /* */ } }, clau)
})

// Lo mismo desde el panel del equipo: la oferta asistida («Nova oferta» en Ofertes) usa el mismo
// formulario. Se prueba con el super_admin y con la cuenta del equipo (Dinamitzadora): el servidor da
// los lugares a cualquier cuenta interna, y la pantalla no mira el rol.
for (const rol of ['superadmin', 'equip'] as const) {
  test(`el equipo (${rol}) también confirma el lugar habitual o lo cambia en la oferta asistida`, async ({ page }) => {
    const prod = productorDe('productor')
    const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
    const alias = sql(`select alias from productor_ubicaciones where id = '${b}'`)
    const clau = `redestina-oferta-esborrany:${prod}`
    await entra(page, rol)
    await page.evaluate(([k]) => {
      localStorage.setItem(k, JSON.stringify({
        datos: { familia: 'Fruita', producte: 'Poma', producte_al_camp: 'no', kg: 100, transport: 'no' },
        pas: 2, pasMaxim: 2, costTocat: false, desat: Date.now(),
      }))
    }, [clau])
    await page.goto('/equip/ofertes')
    await page.getByRole('button', { name: /Nova oferta|Nueva oferta/ }).first().click()
    const dlg = page.getByRole('dialog')
    // 17-11-2026: un solo buscador de entidades (`CercadorOpcions`).
    await triaProductor(page, prod)
    const caixa = dlg.getByTestId('lloc-habitual')
    await expect(caixa).toBeVisible()
    await expect(caixa).toContainText(alias)
    await dlg.getByRole('button', { name: 'Publicar oferta' }).click()
    await expect(caixa).toHaveClass(/border-error/)
    await caixa.getByRole('button', { name: /Sí, aquí/ }).click()
    await expect(caixa.getByText(/Confirmat|Confirmado/)).toBeVisible()
    await caixa.getByRole('button', { name: /Canvia el lloc|Cambiar el lugar/ }).click()
    await expect(dlg.getByTestId('lloc-habitual')).toHaveCount(0)
    await page.evaluate((k) => { try { localStorage.removeItem(k) } catch { /* */ } }, clau)
  })
}

// Un borrador recuperado recuerda que el lugar era PROPUESTO: hay que confirmarlo igual (11-11-2026).
test('un borrador con el lugar propuesto sin confirmar lo vuelve a pedir', async ({ page }) => {
  const prod = productorDe('productor')
  const b = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  const clau = `redestina-oferta-esborrany:${prod}`
  await entra(page, 'productor')
  await page.evaluate(([k, lloc]) => {
    localStorage.setItem(k, JSON.stringify({
      datos: { familia: 'Fruita', producte: 'Poma', producte_al_camp: 'no', kg: 100, transport: 'no', ubicacio: lloc },
      pas: 2, pasMaxim: 2, costTocat: false, desat: Date.now(), proposats: ['ubicacio'],
    }))
  }, [clau, b])
  await page.goto('/productor/ofertes/nova')
  const caixa = page.getByTestId('lloc-habitual')
  await expect(caixa.getByRole('button', { name: /Sí, aquí/ })).toBeVisible()
  await expect(caixa.getByText(/Confirmat|Confirmado/)).toHaveCount(0)
  await page.evaluate((k) => { try { localStorage.removeItem(k) } catch { /* */ } }, clau)
})
