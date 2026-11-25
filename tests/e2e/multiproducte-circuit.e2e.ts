// Ofertas MULTIPRODUCTO, circuito completo de las entregas 6b y 6c (proceso 3.3, 25-11-2026):
//
//   a. NIVEL 2. Una disponibilidad de tres productos. La receptora abre el enlace del mensaje único
//      (`/receptor/mercat?disponibilitat=<id>`) y pide los tres con una fecha: la base rechaza uno
//      por el día (`dia_fora_dies`) y el diálogo marca ESA línea (`error.details`); lo quita y pide
//      dos. El equipo, en Aprovacions, los ve en UNA tarjeta, aprueba uno y rechaza otro
//      (`resoldre_sollicitud`): una canalización, un aviso por destinatario. La receptora registra
//      la recogida conjunta (`?recollida=<sollicitud>`) con diferencia, y el equipo la valida con
//      «Valida totes»: ENT y REC de esa canalización, emitidos y conciliados.
//   b. NIVEL 1. El equipo asigna los otros dos productos a otra entidad en un acto
//      (`assignar_directe_multiple`, por la RPC: el diálogo no está montado en estos ficheros) y
//      registra la recogida conjunta desde Aprovacions (`?recollida=`): registra y valida → ENT y
//      REC por producto.
//   A 360 px, el Mercat con el grupo, el diálogo de la solicitud, la tarjeta de Aprovacions, el de
//   la recogida y «Valida totes» no desbordan (se mira en cada paso, con todo desplegado).
//
// Solo contra el CLON LOCAL y en escritorio: emite numeración legal (ENT/REC). Lo que queda abierto
// se cancela al acabar; lo conciliado queda cerrado y marcado «[E2E]», como en `recollida-un-acte`.

import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { asseguraConveniVigent, entidadDe, entra, motiuSaltClon, productorDe, sql, sqlCom, tria } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-social'
const RECEPTOR_N1 = 'receptor-carles'
const marca = Date.now()
const CAPTURES = process.env.E2E_CAPTURES ?? ''

let disponibilitat = ''
const ofertes: Record<'Carbassa' | 'Ceba' | 'Porro', string> = { Carbassa: '', Ceba: '', Porro: '' }
let sollicitud = ''

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'productor', RECEPTOR, RECEPTOR_N1)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'escriu al clon: una sola passada')
})

test.afterAll(() => {
  if (motiuSaltClon('super_admin', 'productor', RECEPTOR, RECEPTOR_N1) || !disponibilitat) return
  sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E'
        where disponibilitat_id = '${disponibilitat}' and estado in ('publicada', 'parcial')`)
})

/** El próximo día (desde mañana) con ese día ISO de la semana, `AAAA-MM-DD`. */
function proper(diaIso: number): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  for (let i = 1; i <= 7; i++) {
    const x = new Date(d.getTime() + i * 86_400_000)
    const w = x.getUTCDay() === 0 ? 7 : x.getUTCDay()
    if (w === diaIso) return x.toISOString().slice(0, 10)
  }
  throw new Error('impossible')
}

/** Los enlaces de albaranes viejos sin usar bloquean a la receptora (G1): no es lo que se prueba. */
function desbloqueja(ent: string) {
  sql(`update enlaces_token t set estado = 'revocado'
         from albaranes a join canalizaciones c on c.id = a.canalizacion_id
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id and t.estado = 'activo'
          and t.usado_at is null and c.entidad_id = '${ent}'`)
}

/** Los elementos que se salen por la derecha de la ventana (el patrón de `signatures.e2e.ts`). */
async function desbordaments(el: Locator): Promise<string[]> {
  return el.evaluate((root) => [root, ...root.querySelectorAll('*')]
    .filter((n) => {
      const r = n.getBoundingClientRect()
      return r.width > 0 && r.right > window.innerWidth + 1
    })
    .map((n) => `${Math.round(n.getBoundingClientRect().right)}>${window.innerWidth} ${n.tagName}.${(n as HTMLElement).className}`.slice(0, 120)))
}

async function captura(page: Page, nom: string) {
  if (!CAPTURES) return
  mkdirSync(CAPTURES, { recursive: true })
  await page.screenshot({ path: `${CAPTURES}/${nom}.png`, fullPage: false })
}

/** A 360 px, el bloque no desborda (§2: 0 px de scroll horizontal); captura y vuelve a escritorio. */
async function a360(page: Page, el: Locator, nom: string) {
  const abans = page.viewportSize()
  await page.setViewportSize({ width: 360, height: 780 })
  // El diálogo se recoloca al cambiar la ventana (animación de entrada y transform): se
  // espera a que se asiente; un desbordamiento real no desaparece y sigue fallando.
  await expect.poll(() => desbordaments(el), { message: nom, timeout: 3000 }).toEqual([])
  await captura(page, `${nom}-360`)
  if (abans) await page.setViewportSize(abans)
}

test('a. nivell 2: sol·licitud de dos productes, aprovació conjunta, recollida amb diferència i «Valida totes»', async ({ page }) => {
  const prod = productorDe('productor')
  const ent = entidadDe(RECEPTOR)
  asseguraConveniVigent('productor', prod)
  asseguraConveniVigent('entidad', ent)
  desbloqueja(ent)

  // La disponibilidad: Carbassa (dl, dt), Ceba (dl, dc) y Porro (dv), de 8 a 12. Los días comunes
  // de Carbassa y Ceba: el dilluns.
  // La fecha límite cubre el dilluns y el divendres siguientes.
  const fins = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10)
  const fila = (n: number, producto: string, kg: number, dies: number[]) => ({
    id_excedente: `E-E2E-MP-${marca}-${n}`, producto, kg_total: kg, modalitat: 'donacio', modalitats: ['donacio'],
    coste_kg: 0.5, disponible_hasta: fins, dies_recollida: dies,
    hora_recollida_inici: '08:00', hora_recollida_fi: '12:00', origen: 'asistido',
    observacions: '[E2E] multiproducte', texto_oferta: `[E2E] ${producto}`,
  })
  const json = JSON.stringify([fila(1, 'Carbassa', 60, [1, 2]), fila(2, 'Ceba', 40, [1, 3]), fila(3, 'Porro', 30, [5])])
  const res = sql(`select crear_disponibilitat('${prod}', '${json.replace(/'/g, "''")}'::jsonb)`)
  const creat = JSON.parse(res.split('\n')[0]) as { disponibilitat_id: string; ofertes: { id: string; producto: string }[] }
  disponibilitat = creat.disponibilitat_id
  for (const o of creat.ofertes) ofertes[o.producto as keyof typeof ofertes] = o.id
  test.skip(sqlCom(RECEPTOR, `select count(*) from excedentes where disponibilitat_id = '${disponibilitat}'`) !== '3',
    'la receptora de prova no veu les tres donacions al clon')

  // ── La receptora: el Mercat marca el grupo, y el enlace abre el diálogo.
  await entra(page, RECEPTOR)
  await page.goto('/receptor/mercat')
  await expect(page.getByTestId('mk-demana-grup').first()).toBeVisible({ timeout: 30_000 })
  await a360(page, page.locator('main').last(), 'a0-mercat-grup')
  await page.goto(`/receptor/mercat?disponibilitat=${disponibilitat}`)
  const dlg = page.getByTestId('dialeg-sollicitud')
  await expect(dlg).toBeVisible({ timeout: 30_000 })
  await expect(dlg.getByTestId('smp-linia')).toHaveCount(3)
  const linia = (p: keyof typeof ofertes) => dlg.locator(`[data-testid="smp-linia"][data-excedent="${ofertes[p]}"]`)

  // Los tres: no comparten días → salen los del primero (Carbassa) y se explica.
  for (const p of ['Carbassa', 'Ceba', 'Porro'] as const) await linia(p).getByRole('checkbox').check()
  await linia('Carbassa').locator('input[type="number"]').fill('30')
  await linia('Ceba').locator('input[type="number"]').fill('20')
  await linia('Porro').locator('input[type="number"]').fill('10')
  await expect(dlg.getByText(/no es recullen els mateixos dies|no se recogen los mismos días/)).toBeVisible()
  const dilluns = proper(1)
  await tria(dlg.locator('#smp-dia'), dilluns)
  await tria(dlg.locator('#smp-hora'), '10:00')
  await captura(page, 'a1-sollicitud-escriptori')
  await a360(page, dlg, 'a1-sollicitud')
  await dlg.getByTestId('smp-envia').click()
  // La base rechaza el Porro (solo divendres) y el diálogo marca ESA línea; no queda nada.
  await expect(linia('Porro').getByTestId('smp-error-linia')).toBeVisible({ timeout: 30_000 })
  await expect(linia('Carbassa').getByTestId('smp-error-linia')).toHaveCount(0)
  await captura(page, 'a1b-sollicitud-error-linia')
  expect(sql(`select count(*) from sollicituds_recollida where disponibilitat_id = '${disponibilitat}'`)).toBe('0')

  // Sin el Porro: los días comunes de Carbassa y Ceba (el dilluns), y se envía.
  await linia('Porro').getByRole('checkbox').uncheck()
  await expect(dlg.getByText(/tots els productes triats|todos los productos elegidos/)).toBeVisible()
  await tria(dlg.locator('#smp-dia'), dilluns)
  await tria(dlg.locator('#smp-hora'), '10:00')
  await dlg.getByTestId('smp-envia').click()
  await expect(page.getByText(/Sol·licitud enviada|Solicitud enviada/)).toBeVisible({ timeout: 30_000 })
  await expect(dlg).toHaveCount(0)
  sollicitud = sql(`select id from sollicituds_recollida where disponibilitat_id = '${disponibilitat}' and entidad_id = '${ent}'`)
  expect(sollicitud).toMatch(/^[0-9a-f-]{36}$/)
  expect(sql(`select string_agg(e.producto || ':' || r.kg_solicitados::int, ',' order by e.producto)
    from oferta_respuestas r join excedentes e on e.id = r.excedente_id where r.sollicitud_id = '${sollicitud}'`))
    .toBe('Carbassa:30,Ceba:20')

  // ── El equipo: UNA tarjeta; aprueba Carbassa (25 kg) y rechaza Ceba con motivo.
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await entra(page, 'super_admin')
  await page.goto('/equip/aprovacions')
  const targeta = page.locator(`[data-testid="appr-sollicitud"][data-sollicitud="${sollicitud}"]`)
  await expect(targeta).toBeVisible({ timeout: 30_000 })
  await expect(targeta.getByTestId('appr-sollicitud-linia')).toHaveCount(2)
  const respCeba = sql(`select id from oferta_respuestas where sollicitud_id = '${sollicitud}' and excedente_id = '${ofertes.Ceba}'`)
  const respCarb = sql(`select id from oferta_respuestas where sollicitud_id = '${sollicitud}' and excedente_id = '${ofertes.Carbassa}'`)
  const lCeba = targeta.locator(`[data-resposta="${respCeba}"]`)
  const lCarb = targeta.locator(`[data-resposta="${respCarb}"]`)
  await lCarb.locator('input[type="number"]').fill('25')
  await lCeba.getByRole('button', { name: /^Rebutja$|^Rechaza$/ }).click()
  await lCeba.locator('input').fill('[E2E] No hi ha transport per a la ceba')
  // El conmutador refleja la decisión de cada línea (no solo el campo que aparece).
  await expect(lCeba.getByRole('button', { name: /^Rebutja$|^Rechaza$/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(lCeba.getByRole('button', { name: /^Aprova$|^Aprueba$/ })).toHaveAttribute('aria-pressed', 'false')
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300) // deja acabar la transición de color antes de la captura
  await captura(page, 'a2-aprovacio-conjunta')
  await a360(page, targeta, 'a2-aprovacio-conjunta')
  await targeta.getByTestId('appr-sollicitud-confirma').click()
  await expect(page.getByText(/Sol·licitud resolta|Solicitud resuelta/)).toBeVisible({ timeout: 30_000 })
  await expect(targeta).toHaveCount(0)

  // Una canalización (la aprobada) con la solicitud, y un aviso por destinatario.
  expect(sql(`select string_agg(e.producto || ':' || c.kg_confirmados::int, ',') from canalizaciones c
    join excedentes e on e.id = c.excedente_id where c.sollicitud_id = '${sollicitud}'`)).toBe('Carbassa:25')
  expect(sql(`select aprovacio from oferta_respuestas where id = '${respCeba}'`)).toBe('rebutjada')
  expect(sql(`select estat from sollicituds_recollida where id = '${sollicitud}'`)).toBe('resolta')
  expect(sql(`select string_agg(destinatari_tipo || ':' || n, ',' order by destinatari_tipo) from (
    select destinatari_tipo, count(*) n from avisos where tipus = 'sollicitud_resolta' and objecte_id = '${sollicitud}'
    group by 1) x`)).toBe('entidad:1,productor:1')
  expect(sql(`select count(*) from avisos where tipus in ('interes_aprovat', 'interes_rebutjat', 'sortida_trobada')
    and objecte_id in ('${respCeba}', '${respCarb}')`)).toBe('0')
  const canal = sql(`select id from canalizaciones where sollicitud_id = '${sollicitud}'`)

  // ── La receptora registra la recogida conjunta con diferencia (22 de 25 kg).
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await entra(page, RECEPTOR)
  await page.goto('/receptor/interessos')
  await expect(page.locator(`[data-testid="int-recollida-conjunta"][data-sollicitud="${sollicitud}"]`)).toBeVisible({ timeout: 30_000 })
  await page.goto(`/receptor/interessos?recollida=${sollicitud}`)
  const rec = page.getByTestId('dialeg-recollida-multi')
  await expect(rec).toBeVisible({ timeout: 30_000 })
  await expect(rec.getByTestId('smp-rec-linia')).toHaveCount(1)
  const lRec = rec.locator(`[data-canalitzacio="${canal}"]`)
  await tria(lRec.locator('[id^="smp-rec-res-"]'), 'inferior')
  await lRec.locator('[id^="smp-rec-kg-"]').fill('22')
  await lRec.locator('[id^="smp-rec-motiu-"]').fill('[E2E] Tres kg en mal estat')
  await captura(page, 'a3-recollida-conjunta')
  await a360(page, rec, 'a3-recollida-conjunta')
  await rec.getByTestId('smp-rec-envia').click()
  await expect(page.getByText(/Recollida registrada\. L’equip|Recogida registrada\. El equipo/)).toBeVisible({ timeout: 30_000 })
  expect(sql(`select (recollida_registrada_at is not null) || ':' || kg_declarats::int || ':' || (recollida_validada_at is null)
    from canalizaciones where id = '${canal}'`)).toBe('true:22:true')

  // ── El equipo: «Valida totes» con el motivo común (hay diferencia) → ENT y REC conciliados.
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await entra(page, 'super_admin')
  await page.goto('/equip/aprovacions#recollides')
  const grup = page.locator(`[data-testid="valida-totes-grup"][data-sollicitud="${sollicitud}"]`)
  await expect(grup).toBeVisible({ timeout: 30_000 })
  await grup.getByTestId('valida-totes').click()
  const vt = page.getByTestId('dialeg-valida-totes')
  await expect(vt).toBeVisible()
  await vt.getByTestId('smp-vt-confirma').click()
  // Sin motivo no deja (hay diferencia).
  await expect(vt.getByRole('alert')).toBeVisible()
  await a360(page, vt, 'a4-valida-totes')
  await vt.locator('#smp-vt-motiu').fill('[E2E] Conforme amb la diferència declarada')
  await vt.getByTestId('smp-vt-confirma').click()
  await expect(page.getByText(/Validada 1 recollida|Validada 1 recogida/)).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => sql(`select string_agg(tipo || ':' || estado || ':' || (numero_completo is not null), ',' order by tipo)
    from albaranes where canalizacion_id = '${canal}' and estado <> 'anulado'`), { timeout: 30_000 })
    .toBe('ENT:conciliado:true,REC:conciliado:true')
  expect(sql(`select estado || ':' || kg_conciliados::int from canalizaciones where id = '${canal}'`)).toBe('conciliada:22')
})

test('b. nivell 1: assignació directa de dos productes i recollida conjunta registrada i validada per l’equip', async ({ page }) => {
  test.skip(!disponibilitat, 'sense la disponibilitat de la prova a')
  const ent = entidadDe(RECEPTOR_N1)
  asseguraConveniVigent('entidad', ent)
  desbloqueja(ent)

  // El botón de la ficha de la oferta abre la asignación conjunta con las líneas abiertas del grupo.
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${ofertes.Ceba}`)
  await page.getByTestId('od-assigna-grup').click()
  const asg = page.getByTestId('dialeg-assignacio-multi')
  await expect(asg).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => asg.getByTestId('smp-asg-linia').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
  await page.keyboard.press('Escape')
  await expect(asg).toBeHidden()

  const linies = JSON.stringify([
    { excedente_id: ofertes.Ceba, kg: 40 },
    { excedente_id: ofertes.Porro, kg: 30 },
  ])
  // `sqlCom` descarta las líneas que empiezan por «{»: se pide solo el id.
  const sol2 = sqlCom('super_admin', `select assignar_directe_multiple('${disponibilitat}', '${ent}',
    '${linies}'::jsonb, null, null)->>'sollicitud_id'`)
  expect(sol2).toMatch(/^[0-9a-f-]{36}$/)
  expect(sql(`select estat from sollicituds_recollida where id = '${sol2}'`)).toBe('resolta')
  expect(sql(`select count(*) from canalizaciones where sollicitud_id = '${sol2}' and estado <> 'anulada'`)).toBe('2')
  expect(sql(`select string_agg(destinatari_tipo || ':' || n, ',' order by destinatari_tipo) from (
    select destinatari_tipo, count(*) n from avisos where tipus = 'sollicitud_resolta' and objecte_id = '${sol2}'
    group by 1) x`)).toBe('entidad:1,productor:1')

  // La sesión del equipo ya está abierta (la comprobación del botón).
  await page.goto(`/equip/aprovacions?recollida=${sol2}`)
  const rec = page.getByTestId('dialeg-recollida-multi')
  await expect(rec).toBeVisible({ timeout: 30_000 })
  await expect(rec.getByTestId('smp-rec-linia')).toHaveCount(2)
  await rec.getByTestId('smp-rec-envia').click()
  await expect(page.getByText(/Recollida registrada i validada|Recogida registrada y validada/)).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => sql(`select string_agg(e.producto || ':' || a.tipo || ':' || a.estado, ',' order by e.producto, a.tipo)
    from albaranes a join canalizaciones c on c.id = a.canalizacion_id join excedentes e on e.id = c.excedente_id
    where c.sollicitud_id = '${sol2}' and a.estado <> 'anulado'`), { timeout: 30_000 })
    .toBe('Ceba:ENT:conciliado,Ceba:REC:conciliado,Porro:ENT:conciliado,Porro:REC:conciliado')
  await expect.poll(() => sql(`select string_agg(producto || ':' || estado, ',' order by producto) from excedentes
    where id in ('${ofertes.Ceba}', '${ofertes.Porro}')`)).toBe('Ceba:cerrada,Porro:cerrada')
})
