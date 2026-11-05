// Circuito de firma unificado (05-11-2026): CD, CR, REC y ENT se firman con el trazo (en el
// panel o por el enlace del correo) o se suben firmados; lo subido por la organización espera
// en Aprovacions › «Signatures per tancar» a que el super_admin lo cierre o lo rechace.
//
// Solo contra el CLON LOCAL y con las Edge Functions del clon (`enlace-publico`,
// `pujar-document-signat`, `descargar-documento`). Usa los albaranes REALES del fixture
// documental (`crear-datos-documentales-prueba.ts`): un externo no firma documentos de
// `modo='prueba'`. Firmar crea versiones nuevas de un documento inmutable, así que el
// `afterAll` devuelve cada documento a como estaba, sin triggers (solo en el clon): borra las
// versiones nuevas y las firmas y vuelve a hacer vigente la de partida.
//
// Corre solo en escritorio (toca documentos compartidos); el móvil se mide poniendo el
// viewport a 360 px dentro de la prueba.

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { entra, motiuSaltClon, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

interface Doc { id: string; numero: string; version: string; albaran: string }

const PDF = 'tests/e2e/fixtures/signat.pdf'
const PNG = 'tests/e2e/fixtures/signat.png'

let canvas: Doc | null = null
let pujat: Doc | null = null
let rebutjat: Doc | null = null
let public_: Doc | null = null
let equip: Doc | null = null

/** Documentos vigentes pendientes de firma de una ficha TEST-*, en modo real. */
function pendents(tipo: string, codi: string, n: number): Doc[] {
  const files = sql(`select v.documento_id || '|' || v.numero_completo || '|' || v.version || '|' || d.objeto_id
      from v_signatura_document v
      join documentos d on d.id = v.documento_id and d.vigente and d.modo = 'real'
      left join productores p on v.tipo_org = 'productor' and p.id = v.org_id
      left join entidades   e on v.tipo_org = 'entidad'   and e.id = v.org_id
      join albaranes al on d.objeto_tipo = 'albaran' and al.id = d.objeto_id and al.estado = 'conciliado'
     where v.tipo = '${tipo}' and v.estat = 'pendent' and coalesce(p.codigo, e.codigo) = '${codi}'
     order by v.numero_completo desc limit ${n}`)
  return files.split('\n').filter(Boolean).map((l) => {
    const [id, numero, version, albaran] = l.split('|')
    return { id, numero, version, albaran }
  })
}

/** Devuelve un documento a su versión de partida (sin triggers: el documento es inmutable). */
function restaura(d: Doc | null) {
  if (!d) return
  const nous = `select id from documentos where numero_completo = '${d.numero}' and version > ${d.version}`
  sql(`begin; set local session_replication_role = replica;
    delete from avisos where tipus = 'document_signat' and (objecte_id = '${d.id}' or objecte_id in (${nous}));
    delete from firmes_document where documento_id = '${d.id}' or documento_id in (${nous}) or document_signat_id in (${nous});
    delete from documento_envios where documento_id in (${nous});
    delete from documentos where id in (${nous});
    update documentos set vigente = true, sustituido_por = null where id = '${d.id}';
    commit;`)
}

/** El estado del circuito de un documento, según la vista (la versión vigente de su número). */
function estatVigent(d: Doc): string {
  return sql(`select v.estat || '|' || v.version from v_signatura_document v
               join documentos x on x.id = v.documento_id and x.vigente
              where v.numero_completo = '${d.numero}' and v.tipo = (select tipo from documentos where id = '${d.id}')`)
}

/**
 * Ningún elemento sale por la derecha de la ventana (por geometría, también los hijos). Se
 * mide con `expect.poll`: justo tras cambiar el viewport el diálogo aún está en su animación
 * de entrada (`zoom-in-95`) y da un ancho que no es el suyo.
 */
async function desbordaments(el: Locator): Promise<string[]> {
  return el.evaluate((root) => [root, ...root.querySelectorAll('*')]
    .filter((n) => {
      const r = n.getBoundingClientRect()
      return r.width > 0 && r.right > window.innerWidth + 1
    })
    .map((n) => `${n.tagName}.${(n as HTMLElement).className}`.slice(0, 120)))
}

/** Con `E2E_CAPTURES=<carpeta>`, deja la pantalla en PNG (para revisar el móvil a ojo). */
async function captura(page: Page, nom: string) {
  const dir = process.env.E2E_CAPTURES
  if (dir) await page.screenshot({ path: `${dir}/${nom}.png`, fullPage: false })
}

/** Rellena quien firma, la declaración y el trazo, y firma. */
async function signa(page: Page, ambit: Locator) {
  await ambit.locator('[id$="signant-nom"]').fill('Marta Prova E2E')
  await ambit.locator('[id$="signant-carrec"]').fill('Gerent')
  await ambit.locator('[id$="signant-dni"]').fill('12345678Z')
  await ambit.getByRole('checkbox').first().check()
  const c = ambit.locator('canvas')
  await c.scrollIntoViewIfNeeded()
  const box = (await c.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 20 + i * 15, box.y + box.height / 2 + (i % 2 ? 10 : -10))
  await page.mouse.up()
  await ambit.getByTestId('sgn-submit').click()
  await expect(ambit.getByTestId('sgn-fet')).toBeVisible({ timeout: 20_000 })
}

/** Abre la fila de «Pendent de tu» del documento y elige la pestaña. */
async function obrePendent(page: Page, d: Doc, boto: RegExp): Promise<Locator> {
  await page.goto('/productor/documents')
  const fila = page.getByTestId('pendent-signatura').filter({ hasText: d.numero })
  await expect(fila).toBeVisible({ timeout: 20_000 })
  await fila.getByRole('button', { name: boto }).click()
  const dlg = page.getByTestId('dialeg-signa-document')
  await expect(dlg).toBeVisible()
  return dlg
}

test.beforeAll(({}, info) => {
  if (motiuSaltClon('productor-titular', 'superadmin') || info.project.name !== 'escriptori') return
  const recs = pendents('REC', 'TEST-PROD-1', 4)
  ;[canvas, pujat, rebutjat, public_] = [recs[0] ?? null, recs[1] ?? null, recs[2] ?? null, recs[3] ?? null]
  equip = pendents('ENT', 'TEST-ENT-SOCIAL', 1)[0] ?? null
})

test.afterAll(() => {
  const errors: string[] = []
  for (const d of [canvas, pujat, rebutjat, public_, equip]) {
    try { restaura(d) } catch (e) { errors.push(`${d?.numero}: ${(e as Error).message}`) }
  }
  if (errors.length) throw new Error(`No s'han pogut restaurar:\n${errors.join('\n')}`)
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor-titular', 'superadmin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Signa documents compartits del clon: només a escriptori')
  test.skip(!public_ || !equip, 'El clon no té prou albarans reals pendents de signar (crear-datos-documentales-prueba.ts)')
})

test('la titular firma con el trazo desde «Pendent de tu»: v2 «signat», mismo código, y a 360 px no desborda', async ({ page }) => {
  const d = canvas!
  await entra(page, 'productor-titular')
  const dlg = await obrePendent(page, d, /^Signa$|^Firma$/)

  // A 360 px, las dos pestañas del diálogo caben (y el PDF pasa a botón: sin iframe).
  await page.setViewportSize({ width: 360, height: 780 })
  await expect(dlg.getByTestId('sgn-formulari')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => desbordaments(dlg), { message: 'Signa aquí a 360 px' }).toEqual([])
  await captura(page, 'sgn-360-signa')
  await dlg.getByRole('tab', { name: /Puja’l signat|Súbelo firmado/ }).click()
  await expect(dlg.getByTestId('sgn-puja')).toBeVisible()
  await expect(dlg.getByRole('tab', { name: /Puja’l signat|Súbelo firmado/ })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => desbordaments(dlg), { message: 'Puja’l signat a 360 px' }).toEqual([])
  await captura(page, 'sgn-360-puja')
  await dlg.getByRole('tab', { name: /Signa aquí|Firma aquí/ }).click()
  await page.setViewportSize({ width: 1280, height: 800 })

  await signa(page, dlg)

  // La versión nueva: subtipo «signat», vigente, con la MISMA huella impresa (mismo código de
  // verificación) y la firma cerrada (el trazo no pasa por la cola).
  expect(sql(`select count(*) from documentos where numero_completo = '${d.numero}' and version = ${Number(d.version) + 1}
               and subtipo = 'signat' and vigente
               and sha256_datos = (select sha256_datos from documentos where id = '${d.id}')`)).toBe('1')
  expect(estatVigent(d)).toBe(`tancat|${Number(d.version) + 1}`)
  expect(sql(`select via || '|' || estat from firmes_document where documento_id = '${d.id}'`)).toBe('canvas|tancat')
  // Ya no está pendiente.
  await page.goto('/productor/documents')
  await expect(page.getByTestId('pendent-signatura').filter({ hasText: d.numero })).toHaveCount(0)
})

test('la titular sube el PDF firmado → cola «Signatures per tancar» → el super_admin cierra', async ({ page, browser }) => {
  const d = pujat!
  await entra(page, 'productor-titular')
  const dlg = await obrePendent(page, d, /^Puja’l signat$|^Súbelo firmado$/)
  await expect(dlg.getByTestId('sgn-puja')).toBeVisible()
  await dlg.getByTestId('sgn-fitxer').setInputFiles(PDF)
  await dlg.getByTestId('sgn-puja-submit').click()
  await expect(dlg).toHaveCount(0, { timeout: 20_000 })
  expect(estatVigent(d)).toBe(`signat|${d.version}`)

  // El super_admin, en una sesión aparte.
  const ctx = await browser.newContext()
  const sa = await ctx.newPage()
  await entra(sa, 'superadmin')
  await sa.goto('/equip/aprovacions#signatures')
  const cua = sa.getByTestId('cua-signatures')
  const fila = cua.getByTestId('signatura-per-tancar').filter({ hasText: d.numero })
  await expect(fila).toBeVisible({ timeout: 20_000 })
  // «Veure el fitxer» pide el subido a `descargar-documento {firma_document_id}` (URL firmada
  // de 60 s) y lo abre en otra pestaña. El headless no tiene visor de PDF —la pestaña lo
  // descarga y se queda en blanco—: se comprueba la respuesta, no la pestaña.
  const [resposta] = await Promise.all([
    sa.waitForResponse((r) => r.url().includes('/functions/v1/descargar-documento') && r.request().method() === 'POST'),
    sa.waitForEvent('popup').then((p) => p.close().catch(() => {})),
    fila.getByRole('button', { name: /Veure el fitxer|Ver el fichero/ }).click(),
  ])
  expect(resposta.status()).toBe(200)
  const cos = await resposta.json() as { url?: string; mime?: string; via?: string }
  expect(cos.url).toMatch(/\/storage\/v1\/object\/sign\//)
  expect(cos.mime).toBe('application/pdf')

  await fila.getByTestId('sgn-tanca').click()
  const m = sa.getByRole('dialog')
  await m.getByRole('textbox').fill('Comprovat amb l’original (prova E2E)')
  await m.getByRole('button', { name: /Tanca la signatura|Cierra la firma/ }).click()
  await expect(fila).toHaveCount(0, { timeout: 15_000 })
  expect(estatVigent(d)).toBe(`tancat|${Number(d.version) + 1}`)
  expect(sql(`select via || '|' || estat || '|' || coalesce(nota_tancament, '') from firmes_document where documento_id = '${d.id}'`))
    .toBe('pujat|tancat|Comprovat amb l’original (prova E2E)')
  await ctx.close()
})

test('rechazo: la foto subida vuelve a «pendent» con el motivo, y la titular lo ve', async ({ page, browser }) => {
  const d = rebutjat!
  await entra(page, 'productor-titular')
  const dlg = await obrePendent(page, d, /^Puja’l signat$|^Súbelo firmado$/)
  await dlg.getByTestId('sgn-fitxer').setInputFiles(PNG)
  await dlg.getByTestId('sgn-puja-submit').click()
  await expect(dlg).toHaveCount(0, { timeout: 20_000 })
  expect(estatVigent(d)).toBe(`signat|${d.version}`)

  const ctx = await browser.newContext()
  const sa = await ctx.newPage()
  await entra(sa, 'superadmin')
  await sa.goto('/equip/aprovacions#signatures')
  const fila = sa.getByTestId('signatura-per-tancar').filter({ hasText: d.numero })
  await expect(fila).toBeVisible({ timeout: 20_000 })
  await sa.setViewportSize({ width: 360, height: 780 })
  await expect.poll(() => desbordaments(sa.getByTestId('cua-signatures')), { message: 'Cua a 360 px' }).toEqual([])
  await fila.scrollIntoViewIfNeeded()
  await captura(sa, 'sgn-360-cua')
  await sa.setViewportSize({ width: 1280, height: 800 })
  await fila.getByTestId('sgn-rebutja').click()
  const m = sa.getByRole('dialog')
  // Sin motivo no se puede rechazar.
  await expect(m.getByRole('button', { name: /^Rebutja$|^Rechaza$/ })).toBeDisabled()
  await m.getByRole('textbox').fill('La foto no es llegeix: torna-la a fer')
  await m.getByRole('button', { name: /^Rebutja$|^Rechaza$/ }).click()
  await expect(fila).toHaveCount(0, { timeout: 15_000 })
  await ctx.close()

  expect(estatVigent(d)).toBe(`pendent|${d.version}`)
  expect(sql(`select ultim_motiu_rebuig from v_signatura_document where documento_id = '${d.id}'`))
    .toBe('La foto no es llegeix: torna-la a fer')
  await page.goto('/productor/documents')
  const torna = page.getByTestId('pendent-signatura').filter({ hasText: d.numero })
  await expect(torna).toBeVisible({ timeout: 20_000 })
  await expect(torna.getByText(/La foto no es llegeix/)).toBeVisible()
  await page.setViewportSize({ width: 360, height: 780 })
  await expect.poll(() => desbordaments(page.locator('main').first()), { message: 'Pendent de tu a 360 px' }).toEqual([])
  await torna.scrollIntoViewIfNeeded()
  await captura(page, 'sgn-360-pendent')
  await page.setViewportSize({ width: 1280, height: 800 })
})

test('el super_admin sube el ENT firmado desde el albarán → «tancat» al momento', async ({ page }) => {
  const d = equip!
  await entra(page, 'superadmin')
  await page.goto(`/equip/albarans/${d.albaran}`)
  const bloc = page.getByTestId('albara-signatura')
  await expect(bloc).toBeVisible({ timeout: 20_000 })
  await bloc.getByTestId('sgn-accio-puja_equip').click()
  const dlg = page.getByTestId('dialeg-signa-document')
  await expect(dlg).toBeVisible()
  await dlg.getByTestId('sgn-fitxer').setInputFiles(PDF)
  await dlg.getByTestId('sgn-puja-submit').click()
  // Confirmación propia (nunca `window.confirm`).
  const confirma = page.getByRole('dialog').and(page.locator(':not([data-testid="dialeg-signa-document"])'))
  await confirma.getByRole('button', { name: /^Puja el signat$|^Sube el firmado$/ }).click()
  await expect(dlg).toHaveCount(0, { timeout: 20_000 })
  expect(estatVigent(d)).toBe(`tancat|${Number(d.version) + 1}`)
  expect(sql(`select via || '|' || estat from firmes_document where documento_id = '${d.id}'`)).toBe('correu|tancat')
})

test('ruta pública /signar-document/:token: sin sesión, a 360 px, firma y no repite', async ({ browser }) => {
  const d = public_!
  // La titular acuña el enlace (lo mismo que haría «Signa» desde su panel). `->>` y no el
  // json entero: `sqlCom` descarta las líneas que empiezan por «{».
  const token = sqlCom('productor-titular', `select acunar_enllac_propi('firma_document', 'documento', '${d.id}')->>'token'`)
  expect(token).toBeTruthy()

  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto(`/signar-document/${token}`)
  const form = page.getByTestId('sgn-formulari')
  await expect(form).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(d.numero).first()).toBeVisible()
  await expect.poll(() => desbordaments(page.locator('body')), { message: 'Pàgina pública a 360 px' }).toEqual([])
  await captura(page, 'sgn-360-public')

  // El trazo con el dedo (touch → eventos de puntero): el pad lo acepta igual que el ratón.
  await signa(page, page.locator('body'))
  expect(estatVigent(d)).toBe(`tancat|${Number(d.version) + 1}`)

  // El mismo enlace, otra vez: ya está firmado.
  await page.goto(`/signar-document/${token}`)
  await expect(page.getByTestId('sgn-problema')).toBeVisible({ timeout: 20_000 })
  await ctx.close()
})
