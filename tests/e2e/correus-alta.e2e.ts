// Ningún correo sin que el equipo lo decida (20-11-2026, petición de Carles), contra el CLON LOCAL:
//
//   1. IMPORTAR des d'Excel dos fichas con correo (una receptora y una ofertante) no manda nada.
//   2. CREAR una ficha con «Nova entitat» (con correo y SIN marcar «Dona-li accés») no manda nada.
//   3. Ni después: los jobs que envían (avisos, recordatorios documentales) se disparan a mano y
//      tampoco escriben a ninguna de las tres.
//   «Nada» se mira por cuatro lados: ninguna llamada del navegador a una función que envía, ninguna
//   fila que dispare un envío (avisos, enlaces, envíos de documentos, cuentas, membresías), ningún
//   correo en el Mailpit del clon y ninguna línea del log de las funciones locales con esos correos.
//   4. INVITAR es un gesto explícito: en la ficha, el botón con el AVIÓN DE PAPEL («Dona-li accés»).
//      Pulsado, sale UNA llamada a `donar-acces` y UN correo, al contacto de esa ficha y a nadie más.
//
//   E2E_CLON=1 E2E_ESCRIU=1 npx playwright test tests/e2e/correus-alta.e2e.ts --project escriptori

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import writeXlsxFile from 'write-excel-file/node'
import { compte, entra, motiuSaltClon, pestanya, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const MAILPIT = 'http://127.0.0.1:55324'
const LOG = 'scripts/data/funciones-local.log'
/** Las Edge Functions que mandan algo a alguien (correo o WhatsApp). */
const FUNCIONS_ENVIEN = /\/functions\/v1\/(donar-acces|enviar-acceso|enviar-email|enviar-avis|enviar-albara|reenviar-documento|whatsapp-send|recuperar-password)\b/

const marca = Date.now().toString(36)
const correuImpRec = `e2e-correu-imp-rec-${marca}@example.com`
const correuImpOf = `e2e-correu-imp-of-${marca}@example.com`
const correuAlta = `e2e-correu-alta-${marca}@example.com`
const TOTS = [correuImpRec, correuImpOf, correuAlta]
const NOM = `TEST-CORREU ${marca}`
const LLETRES = 'TRWAGMYFPDXBNJZSQVHLCKE'
const dni = (n: number) => { const s = String(Math.floor(n) % 1e8).padStart(8, '0'); return s + LLETRES[Number(s) % 23] }

let dir = ''
let fitxer = ''
let orgAlta = ''
let midaLog = 0

/** Las llamadas del navegador a funciones que envían, desde que se empieza a escuchar. */
function escoltaEnviaments(page: Page): string[] {
  const vistes: string[] = []
  page.on('request', (r) => { if (FUNCIONS_ENVIEN.test(r.url())) vistes.push(`${r.method()} ${r.url()}`) })
  return vistes
}

/** Cuántos correos tiene `correu` en el Mailpit del clon. */
async function correusA(correu: string): Promise<number> {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${correu}"`)}`)
  const d = (await r.json()) as { messages_count?: number; messages?: unknown[] }
  return d.messages_count ?? d.messages?.length ?? 0
}

/** Las líneas NUEVAS del log de las funciones locales que nombran alguno de los correos. */
function logAmb(correus: string[]): string[] {
  if (!existsSync(LOG)) return []
  const nou = readFileSync(LOG, 'utf8').slice(midaLog)
  return nou.split('\n').filter((l) => correus.some((c) => l.includes(c)))
}

/** Lo que dispara un envío, contado para las organizaciones de esas fichas. */
function rastreEnviament(): string {
  const orgs = `(select organizacion_id from entidades where nombre like '${NOM}%' or email in (${TOTS.map((c) => `'${c}'`).join(',')})
                 union select organizacion_id from productores where empresa like '${NOM}%' or email in (${TOTS.map((c) => `'${c}'`).join(',')}))`
  const fitxes = `(select id from entidades where organizacion_id in ${orgs} union select id from productores where organizacion_id in ${orgs})`
  return sql(`select
      (select count(*) from avisos where destinatari_id in ${fitxes}) || '|' ||
      (select count(*) from enlaces_token where objeto_id in ${orgs} or objeto_id in ${fitxes} or destinatario_email in (${TOTS.map((c) => `'${c}'`).join(',')})) || '|' ||
      (select count(*) from documento_envios where objeto_id in ${orgs} or destinatario in (${TOTS.map((c) => `'${c}'`).join(',')})) || '|' ||
      (select count(*) from auth.users where email in (${TOTS.map((c) => `'${c}'`).join(',')})) || '|' ||
      (select count(*) from membresias where entidad_id in ${fitxes} or productor_id in ${fitxes})`)
}

function neteja() {
  const orgs = sql(`select distinct organizacion_id from (
      select organizacion_id from productores where empresa like 'TEST-CORREU %'
      union all select organizacion_id from entidades where nombre like 'TEST-CORREU %') x where organizacion_id is not null`)
  for (const org of orgs.split('\n').filter(Boolean)) {
    const p = sql(`select coalesce((select id::text from productores where organizacion_id = '${org}'), '')`)
    const e = sql(`select coalesce((select id::text from entidades where organizacion_id = '${org}'), '')`)
    if (p) sqlCom('superadmin', `select borrar_ficha_completa('productor', '${p}', true)`)
    else if (e) sqlCom('superadmin', `select borrar_ficha_completa('entidad', '${e}', true)`)
    sql(`delete from documento_envios where objeto_tipo = 'organizacion' and objeto_id = '${org}'`)
  }
  sql(`delete from auth.users where email like 'e2e-correu-%@example.com'`)
  sql(`delete from importacions_entitats where fitxer_nom like 'correus-%.xlsx'`)
}

test.beforeAll(async ({}, info) => {
  if (motiuSaltClon('superadmin') || info.project.name !== 'escriptori' || process.env.E2E_ESCRIU !== '1') return
  neteja()
  midaLog = existsSync(LOG) ? readFileSync(LOG, 'utf8').length : 0
  dir = mkdtempSync(join(tmpdir(), 'correus-alta-'))
  fitxer = join(dir, `correus-${marca}.xlsx`)
  const CAP = ['Nombre comercial', 'Persona de contacto', 'Correo (contacto)', 'Tipo de entidad', 'Municipio', 'Forma jurídica', 'NIF']
  await writeXlsxFile([{ sheet: 'Hoja1', data: [
    CAP,
    [`${NOM} Menjador`, 'Anna Prova', correuImpRec, 'Entidad social', 'Mataró', 'Asociación', null],
    [`${NOM} Hort`, 'Pere Prova', correuImpOf, 'Productor individual', 'Malgrat de Mar', 'Autónomo', null],
  ] }]).toFile(fitxer)
})

test.afterAll(async () => {
  if (!dir) return
  neteja()
  for (const c of TOTS) {
    await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${c}"`)}`, { method: 'DELETE' }).catch(() => null)
  }
  rmSync(dir, { recursive: true, force: true })
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('superadmin')
  test.skip(m !== null, m ?? '')
  test.skip(process.env.E2E_ESCRIU !== '1', 'Crea fitxes: cal E2E_ESCRIU=1')
  test.skip(info.project.name !== 'escriptori', 'Crea fitxes al clon: només a escriptori')
})

test('1. importar des d’Excel dues fitxes amb correu no envia res', async ({ page }) => {
  const enviaments = escoltaEnviaments(page)
  await entra(page, 'superadmin')
  await page.goto('/equip/entitats/importa')
  await page.getByTestId('ie-input').setInputFiles(fitxer)
  await expect(page.getByTestId('ie-mapa')).toBeVisible()
  await page.getByTestId('ie-continua').click()
  await expect(page.getByTestId('ie-fila')).toHaveCount(2, { timeout: 20_000 })
  await page.getByTestId('ie-importa').click()
  await page.getByRole('dialog').getByRole('button', { name: /^Importa$|^Importar$/ }).click()
  await expect(page.getByTestId('ie-pas3')).toBeVisible({ timeout: 30_000 })

  expect(sql(`select count(*) from entidades where nombre = '${NOM} Menjador' and email = '${correuImpRec}'`)).toBe('1')
  expect(sql(`select count(*) from productores where empresa = '${NOM} Hort' and email = '${correuImpOf}'`)).toBe('1')
  // Nacen «potencial»: inactivas, fuera del Mercat y de cualquier aviso.
  expect(sql(`select estat_crm from entidades where nombre = '${NOM} Menjador'`)).toBe('potencial')
  await page.waitForTimeout(1500)
  expect(enviaments, 'crides a funcions que envien').toEqual([])
  expect(rastreEnviament(), 'avisos|enllaços|enviaments|comptes|membresies').toBe('0|0|0|0|0')
})

test('2. crear una fitxa a «Nova entitat» amb correu, sense marcar l’accés, no envia res', async ({ page }) => {
  const enviaments = escoltaEnviaments(page)
  await entra(page, 'superadmin')
  await page.goto('/equip/entitats/nova')
  await page.locator('#ne-cerca').fill('zzz e2e correus sense resultats')
  await page.getByTestId('ne-es-nova').click()
  await page.getByTestId('ne-rol-productor').click()
  await page.locator('#ne-nom_comercial').fill(`${NOM} Alta`)
  await page.locator('#ne-razon_social').fill(`${NOM} Alta SL`)
  await page.locator('#ne-nif').fill(dni(Date.now() / 13))
  await page.locator('#ne-persona_contacte').fill('Persona E2E correus')
  await page.locator('#ne-email').fill(correuAlta)
  await page.getByText(/^Entitat de proves$|^Entidad de pruebas$/).click()
  // La casilla del acceso está, y APAGADA por defecto: no se toca.
  const casella = page.getByTestId('ne-acces').getByRole('checkbox')
  await expect(casella).not.toBeChecked()
  await page.getByTestId('ne-crea').click()
  await page.waitForURL((u) => /^\/equip\/entitats\/[0-9a-f-]{36}$/.test(u.pathname))
  orgAlta = new URL(page.url()).pathname.split('/').pop() as string

  await pestanya(page, 'contacte')
  await expect(page.getByTestId('compte-estat')).toHaveAttribute('data-estat', 'sense')
  await page.waitForTimeout(1500)
  expect(enviaments, 'crides a funcions que envien').toEqual([])
  expect(rastreEnviament(), 'avisos|enllaços|enviaments|comptes|membresies').toBe('0|0|0|0|0')
})

test('3. tampoc després: els jobs que envien no escriuen a cap de les tres', async () => {
  test.skip(!orgAlta, 'depèn del pas 2')
  // Los dos que mandan a organizaciones, disparados ya (sin esperar a cron).
  sql(`select disparar_avisos_pendents()`)
  sql(`select disparar_recordatorios_documentales()`)
  await new Promise((r) => setTimeout(r, 6000))
  expect(rastreEnviament()).toBe('0|0|0|0|0')
  for (const c of TOTS) expect(await correusA(c), `correus a ${c}`).toBe(0)
  expect(logAmb(TOTS), 'línies del log de funcions amb aquests correus').toEqual([])
})

test('3b. un admin no pot convidar: el botó surt gris i donar-acces li respon 403', async ({ page }) => {
  test.skip(!orgAlta, 'depèn del pas 2')
  // La cuenta `equip` del arnés es un Dinamitzador (`admin`) desde el 25-11-2026; el `update` se
  // queda por si un clon viejo la tuviera con otro rol, y se devuelve al acabar.
  const correuEquip = compte('equip')!.email.replace(/'/g, "''")
  const uid = sql(`select id from auth.users where email = '${correuEquip}'`)
  const rolAbans = sql(`select rol from usuario_roles where user_id = '${uid}'`)
  sql(`update usuario_roles set rol = 'admin' where user_id = '${uid}'`)
  try {
    const enviaments = escoltaEnviaments(page)
    await entra(page, 'equip')
    await page.goto(`/equip/entitats/${orgAlta}`)
    await pestanya(page, 'contacte')
    const boto = page.getByTestId('acces-convida')
    await expect(boto).toBeVisible({ timeout: 30_000 })
    await expect(boto).toBeDisabled()
    await expect(page.getByTestId('acces-motiu')).toContainText(/només ho pot fer el Superadmin|solo lo puede hacer el Superadmin/)
    // Y el alta tampoco ofrece la casilla.
    await page.goto('/equip/entitats/nova')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('ne-acces')).toHaveCount(0)
    expect(enviaments, 'la pantalla no ha cridat cap funció que enviï').toEqual([])
    // La segunda red: la función, llamada a mano con su sesión.
    const token = await page.evaluate(() => {
      const clau = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))!
      return JSON.parse(localStorage.getItem(clau)!).access_token as string
    })
    const r = await page.request.post('http://127.0.0.1:55321/functions/v1/donar-acces', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { organizacion_id: orgAlta, email: correuAlta, manual: true },
    })
    const resposta = `${r.status()}|${((await r.json()) as { code?: string }).code ?? ''}`
    expect(resposta).toBe('403|forbidden')
    expect(await correusA(correuAlta)).toBe(0)
    expect(sql(`select count(*) from auth.users where email = '${correuAlta}'`)).toBe('0')
  } finally {
    sql(`update usuario_roles set rol = '${rolAbans}' where user_id = '${uid}'`)
  }
})

test('4. convidar és el botó de l’avió de paper: una crida i un sol correu, al contacte de la fitxa', async ({ page }) => {
  test.skip(!orgAlta, 'depèn del pas 2')
  const enviaments = escoltaEnviaments(page)
  await entra(page, 'superadmin')
  await page.goto(`/equip/entitats/${orgAlta}`)
  await pestanya(page, 'contacte')
  const boto = page.getByTestId('acces-convida')
  await expect(boto).toBeVisible({ timeout: 30_000 })
  // El icono: el avión de papel de lucide (`Send`).
  await expect(boto.locator('svg.lucide-send')).toHaveCount(1)
  await boto.click()
  // Con el correo apagado pediría confirmación (§8); en el clon está encendido.
  const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog'))
  if (await dlg.isVisible().catch(() => false)) await dlg.getByRole('button').last().click()
  await expect(page.getByTestId('compte-estat')).toHaveAttribute('data-estat', 'enviat', { timeout: 30_000 })

  expect(enviaments.filter((e) => e.startsWith('POST')), 'una sola crida, a donar-acces').toHaveLength(1)
  expect(enviaments[0]).toMatch(/donar-acces/)
  await expect.poll(() => correusA(correuAlta), { timeout: 15_000 }).toBe(1)
  // Ni a las importadas.
  expect(await correusA(correuImpRec)).toBe(0)
  expect(await correusA(correuImpOf)).toBe(0)
  // Y ahora sí hay cuenta y membresía, solo de esta.
  expect(sql(`select count(*) from auth.users where email = '${correuAlta}'`)).toBe('1')
  expect(sql(`select count(*) from auth.users where email in ('${correuImpRec}', '${correuImpOf}')`)).toBe('0')
})
