// El CIRCUITO COMPLETO por pantallas, cambiando de rol en cada paso (20-11-2026, petición de Carles):
//
//   1. La OFERTANTE (`productor`) da de alta 500 kg de tomàquet, en donación y maquila.
//   2. El SUPER_ADMIN la valida y la publica en el Mercat.
//   3. La ENTITAT SOCIAL (`receptor-social`) pide 250 kg en DONACIÓN desde el Mercat.
//   4. El OBRADOR (`receptor-carles`, transformador) pide 250 kg en MAQUILA desde el Mercat.
//   5. El super_admin aprueba los dos intereses en Aprovacions, con la hora de recogida.
//   6. Cada receptora registra su recogida («Coincideixen») en Els meus interessos.
//   7. El super_admin valida las dos: la donación emite y concilia el ENT y el REC (con su PDF);
//      la maquila se concilia SIN albarán. La oferta queda cerrada.
//   8. El super_admin emite el CERTIFICAT DE DONACIÓ de la oferta (solo cuentan los 250 kg a la
//      entidad social; la maquila sale entre las excluidas) y el CERTIFICAT DE RECEPCIÓ de la
//      entidad social; el obrador no tiene certificado de donación que dar.
//   9. Cada parte lo ve en su panel: la ofertante «Producte recollit», las receptoras su histórico.
//
// Solo contra el CLON LOCAL y en escritorio: emite numeración legal de albaranes (ENT/REC) y de
// prueba de certificados (P-CDP/P-CR). Todas las fichas son `es_test` y el modo test está
// encendido: ningún correo sale fuera de las fichas de prueba. La oferta queda cerrada y
// marcada «[E2E circuit tomàquet]» (`scripts/local/cargar-local.sh` devuelve el clon a la copia).
//
//   E2E_CLON=1 E2E_ESCRIU=1 npx playwright test tests/e2e/circuit-tomaquet.e2e.ts --project escriptori
//   (con E2E_CAPTURES=<carpeta>, una captura por paso)

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join } from 'node:path'
import {
  asseguraConveniVigent, entidadDe, entra, motiuSaltClon, productorDe, sql, tria,
} from './ajuda'

test.describe.configure({ mode: 'serial' })

const OFERTANT = 'productor'
const SOCIAL = 'receptor-social'
const OBRADOR = 'receptor-carles'
const marca = `[E2E circuit tomàquet ${Date.now()}]`

let oferta = ''
let codi = ''
let canalSocial = ''
let canalObrador = ''

/** Una captura del paso si se ha pedido (`E2E_CAPTURES`); si no, nada. */
async function captura(page: Page, nom: string) {
  const dir = process.env.E2E_CAPTURES
  if (dir) await page.screenshot({ path: join(dir, `circuit-${nom}.png`), fullPage: true })
}

/** Los enlaces de albaranes viejos sin usar bloquean a la receptora (G1): no es lo que se prueba. */
function desbloqueja(ent: string) {
  sql(`update enlaces_token t set estado = 'revocado'
         from albaranes a join canalizaciones c on c.id = a.canalizacion_id
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id and t.estado = 'activo'
          and t.usado_at is null and c.entidad_id = '${ent}'`)
}

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin', OFERTANT, SOCIAL, OBRADOR) || info.project.name !== 'escriptori') return
  if (process.env.E2E_ESCRIU !== '1') return
  // Las ofertas de una pasada que se quedó a medias (sin canalizaciones), fuera del Mercat.
  sql(`update excedentes e set estado = 'cancelada' where e.observacions like '[E2E circuit tomàquet%'
         and e.estado in ('pendent_validacio', 'publicada')
         and not exists (select 1 from canalizaciones c where c.excedente_id = e.id)`)
  // Las tres partes, con su Conveni de col·laboració vigente (sin él no se publica ni se pide).
  asseguraConveniVigent('productor', productorDe(OFERTANT))
  for (const r of [SOCIAL, OBRADOR]) {
    asseguraConveniVigent('entidad', entidadDe(r))
    desbloqueja(entidadDe(r))
  }
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', OFERTANT, SOCIAL, OBRADOR)
  test.skip(m !== null, m ?? '')
  test.skip(process.env.E2E_ESCRIU !== '1', 'Escriu al clon: només amb E2E_ESCRIU=1')
  test.skip(info.project.name !== 'escriptori', 'Emet numeració: una sola passada, a escriptori')
})

test('1. l’ofertant dona d’alta 500 kg de tomàquet (donació i maquila)', async ({ page }) => {
  const prod = productorDe(OFERTANT)
  const lloc = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  expect(lloc, 'la ofertante necesita un lugar principal').toMatch(/^[0-9a-f-]{36}$/)
  const familia = sql(`select familia from productos where nombre = 'Tomàquet'`)
  await entra(page, OFERTANT)
  // El alta guardada a medias en este navegador (lo que hace el propio formulario al escribir):
  // así la prueba no depende del orden de los bloques, y lo esencial se rellena en pantalla.
  await page.evaluate(([k, l, f, obs]) => {
    localStorage.setItem(k, JSON.stringify({
      datos: {
        familia: f, producte: 'Tomàquet', producte_al_camp: 'no', kg: 100, format_entrega: 'caixes',
        retorn: 'No', transport: 'no', ubicacio: l, horari: { inici: '08:00', fi: '13:00' },
        disponible_fins: '2027-12-31', modalitat: ['donacio', 'maquila'], cost_kg: 0.6, causa: 'C4.2',
        observacions: obs,
      },
      pas: 0, pasMaxim: 99, costTocat: true, proposats: [], canviaLloc: false, desat: Date.now(),
    }))
  }, [`redestina-oferta-esborrany:${prod}`, lloc, familia, marca])
  await page.goto('/productor/ofertes/nova')
  await expect(page.getByTestId('formulari-oferta')).toBeVisible()
  // Los kilos, a mano: 500.
  await page.locator('#of-kg').fill('500')
  await captura(page, '1-alta')
  await page.getByRole('button', { name: 'Publicar oferta' }).click()

  await expect.poll(() => sql(`select count(*) from excedentes where observacions = '${marca}'`), { timeout: 20_000 }).toBe('1')
  oferta = sql(`select id from excedentes where observacions = '${marca}'`)
  codi = sql(`select id_excedente from excedentes where id = '${oferta}'`)
  expect(sql(`select estado || '|' || kg_total::numeric(12,2) || '|' || producto || '|' || array_to_string(modalitats, ',') || '|' || coalesce(coste_kg::numeric(12,2)::text, '-')
                from excedentes where id = '${oferta}'`)).toBe('pendent_validacio|500.00|Tomàquet|donacio,maquila|0.60')
  await expect(page.getByTestId('fitxa-oferta')).toBeVisible()
  await captura(page, '1-publicada')
})

test('2. el super_admin la valida i la publica al Mercat', async ({ page }) => {
  test.skip(!oferta, 'depèn del pas 1')
  await entra(page, 'super_admin')
  await page.goto('/equip/ofertes?tab=validar')
  // En la cola «Per validar» (la lista no enseña el código: la fila, por el producto).
  await expect(page.locator('main').getByText(/Tomàquet/).locator('visible=true').first()).toBeVisible({ timeout: 30_000 })
  await captura(page, '2-per-validar')
  await page.goto(`/equip/ofertes/${oferta}`)
  await page.getByRole('button', { name: /^Valida i publica$|^Valida y publica$/ }).click()
  await expect(page.getByText(/Oferta validada|ya está en el Mercado/).first()).toBeVisible()
  await expect.poll(() => sql(`select estado from excedentes where id = '${oferta}'`)).toBe('publicada')
  await captura(page, '2-validada')
})

/** Una receptora pide 250 kg de la oferta desde el Mercat, con la modalidad indicada. */
async function demana(page: Page, rol: string, modalitat: 'donacio' | 'maquila') {
  await entra(page, rol)
  await page.goto('/receptor/mercat')
  await expect(page.getByRole('button').filter({ hasText: 'Tomàquet' }).first()).toBeVisible({ timeout: 30_000 })
  // La oferta concreta, por su enlace directo (en el clon hay otros tomàquets de pasadas viejas).
  await page.goto(`/receptor/mercat?oferta=${oferta}&accio=interes`)
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('heading', { name: /Mostrar interès|Mostrar interés/ })).toBeVisible()
  await expect(dlg.getByText(/500 kg/).first()).toBeVisible()
  await tria(dlg.locator('#mk-mode'), modalitat)
  await dlg.locator('#mk-kg').fill('250')
  await captura(page, `3-interes-${modalitat}`)
  await dlg.getByRole('button', { name: /^Enviar interès$|^Enviar interés$/ }).click()
  await expect(dlg).toHaveCount(0)
  const ent = entidadDe(rol)
  await expect.poll(() => sql(`select modalitat || '|' || kg_solicitados::numeric(12,2) || '|' || aprovacio from oferta_respuestas
                                where excedente_id = '${oferta}' and entidad_id = '${ent}'`)).toBe(`${modalitat}|250.00|pendent`)
}

test('3. l’entitat social demana 250 kg en donació', async ({ page }) => {
  test.skip(!oferta, 'depèn del pas 1')
  await demana(page, SOCIAL, 'donacio')
})

test('4. l’obrador demana 250 kg en maquila', async ({ page }) => {
  test.skip(!oferta, 'depèn del pas 1')
  await demana(page, OBRADOR, 'maquila')
})

test('5. el super_admin aprova els dos interessos a Aprovacions', async ({ page }) => {
  test.skip(!oferta, 'depèn del pas 1')
  await entra(page, 'super_admin')
  await page.goto('/equip/aprovacions')
  // Mañana a las 10:00, dentro de la franja de la oferta (08:00-13:00).
  const dema = sql(`select to_char((now() at time zone 'Europe/Madrid')::date + 1, 'YYYY-MM-DD')`) + 'T10:00'
  for (const rol of [SOCIAL, OBRADOR]) {
    const resp = sql(`select id from oferta_respuestas where excedente_id = '${oferta}' and entidad_id = '${entidadDe(rol)}'`)
    const fila = page.locator(`[data-testid="appr-resposta"][data-resposta="${resp}"]`)
    await expect(fila).toBeVisible({ timeout: 30_000 })
    await expect(fila.locator(`[id="appr-${resp}-kg"]`)).toHaveValue('250')
    await fila.locator(`[id="appr-${resp}-rec"]`).fill(dema)
    await captura(page, `5-aprova-${rol}`)
    await fila.getByRole('button', { name: /^Aprovar i canalitzar$|^Aprobar y canalizar$/ }).click()
    await expect(fila).toHaveCount(0, { timeout: 30_000 })
  }
  canalSocial = sql(`select id from canalizaciones where excedente_id = '${oferta}' and entidad_id = '${entidadDe(SOCIAL)}' and estado <> 'anulada'`)
  canalObrador = sql(`select id from canalizaciones where excedente_id = '${oferta}' and entidad_id = '${entidadDe(OBRADOR)}' and estado <> 'anulada'`)
  expect(sql(`select valorizacion || '|' || kg_confirmados::numeric(12,2) from canalizaciones where id = '${canalSocial}'`)).toBe('donacio|250.00')
  expect(sql(`select valorizacion || '|' || kg_confirmados::numeric(12,2) from canalizaciones where id = '${canalObrador}'`)).toBe('maquila|250.00')
  // La donación nace con su ENT y su REC en borrador; la maquila, sin albarán.
  expect(sql(`select string_agg(tipo || ':' || estado, ',' order by tipo) from albaranes where canalizacion_id = '${canalSocial}' and estado <> 'anulado'`))
    .toBe('ENT:borrador,REC:borrador')
  expect(sql(`select count(*) from albaranes where canalizacion_id = '${canalObrador}' and estado <> 'anulado'`)).toBe('0')
  // La oferta, repartida entera.
  await expect.poll(() => sql(`select estado from excedentes where id = '${oferta}'`)).not.toBe('publicada')
})

/** La receptora registra «Coincideixen» desde su ficha de la operación. */
async function registra(page: Page, rol: string, canal: string, senseAlbara = false) {
  await entra(page, rol)
  await page.goto(`/receptor/interessos?operacio=${canal}&accio=recollida`)
  const fitxa = page.getByTestId('fitxa-operacio')
  await expect(fitxa).toBeVisible({ timeout: 30_000 })
  const obre = fitxa.getByRole('button', { name: /^Registra la recollida$|^Registra la recogida$/ })
  if (await obre.isVisible().catch(() => false)) await obre.click()
  await expect(fitxa.getByRole('radio', { name: /Coincideixen: 250 kg|Coinciden: 250 kg/ })).toHaveAttribute('aria-checked', 'true')
  await captura(page, `6-registra-${rol}`)
  await fitxa.getByRole('button', { name: /^Registra els quilos$|^Registra los kilos$/ }).click()
  await expect(fitxa.getByTestId('recollida-pendent-validacio')).toBeVisible({ timeout: 30_000 })
  // Venta y maquila no llevan albarán: ni el aviso ni la ficha pueden prometer uno.
  const promet = /es generaran els albarans|se generarán los albaranes/
  if (senseAlbara) {
    await expect(page.getByText(/no porten albarà|no llevan albarán/).first()).toBeVisible()
    await expect(fitxa.getByTestId('recollida-pendent-validacio')).not.toContainText(promet)
  } else {
    await expect(fitxa.getByTestId('recollida-pendent-validacio')).toContainText(promet)
  }
  expect(sql(`select (recollida_registrada_at is not null)::text || '|' || coalesce(kg_declarats::numeric(12,2)::text, '') from canalizaciones where id = '${canal}'`))
    .toBe('true|250.00')
}

test('6a. l’entitat social registra la recollida', async ({ page }) => {
  test.skip(!canalSocial, 'depèn del pas 5')
  await registra(page, SOCIAL, canalSocial)
  // Registrar no gasta números: los albaranes siguen en borrador hasta que valide el equipo.
  expect(sql(`select string_agg(tipo || ':' || coalesce(numero_completo, '-'), ',' order by tipo) from albaranes where canalizacion_id = '${canalSocial}' and estado <> 'anulado'`))
    .toBe('ENT:-,REC:-')
})

test('6b. l’obrador registra la recollida', async ({ page }) => {
  test.skip(!canalObrador, 'depèn del pas 5')
  await registra(page, OBRADOR, canalObrador, true)
})

test('7. el super_admin valida les dues: ENT i REC de la donació, maquila sense albarà, oferta tancada', async ({ page }) => {
  test.skip(!canalSocial || !canalObrador, 'depèn del pas 6')
  await entra(page, 'super_admin')
  await page.goto('/equip/aprovacions#recollides')
  const files = page.getByTestId('recollida-per-validar').filter({ hasText: codi })
  await expect(files).toHaveCount(2, { timeout: 30_000 })

  // La donación: «Valida i genera els albarans».
  const donacio = files.filter({ hasText: /Donació|Donación/ })
  await expect(donacio).toContainText(/Declarats: 250 kg|Declarados: 250 kg/)
  await donacio.getByRole('button', { name: /^Valida i genera els albarans$|^Valida y genera los albaranes$/ }).click()
  let dlg = page.getByRole('dialog')
  await expect(dlg.getByLabel(/Quilos que es validen|Kilos que se validan/)).toHaveValue('250')
  await dlg.getByRole('button', { name: /^Valida i genera els albarans$|^Valida y genera los albaranes$/ }).click()
  const fet = dlg.getByTestId('validacio-feta')
  await expect(fet).toBeVisible({ timeout: 30_000 })
  await expect(fet).toContainText(/ENT-\d{4}-\d+/)
  await expect(fet).toContainText(/REC-\d{4}-\d+/)
  await captura(page, '7-donacio-validada')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // La maquila: «Valida i concilia», sin albarán.
  const maquila = page.getByTestId('recollida-per-validar').filter({ hasText: codi })
  await expect(maquila).toHaveCount(1, { timeout: 30_000 })
  await expect(maquila).toContainText(/Maquila|maquila|obrador/)
  await maquila.getByRole('button', { name: /^Valida i concilia$|^Valida y concilia$/ }).click()
  dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: /^Valida i concilia$|^Valida y concilia$/ }).click()
  await expect(dlg.getByTestId('validacio-feta')).toBeVisible({ timeout: 30_000 })
  await captura(page, '7-maquila-validada')
  await page.keyboard.press('Escape')

  // En la base: la donación con su ENT y su REC numerados y conciliados por 250 kg…
  expect(sql(`select string_agg(tipo || ':' || estado || ':' || (numero_completo is not null), ',' order by tipo)
                from albaranes where canalizacion_id = '${canalSocial}' and estado <> 'anulado'`)).toBe('ENT:conciliado:true,REC:conciliado:true')
  expect(sql(`select string_agg(a.tipo || '=' || l.kg_validados::numeric(12,2), ',' order by a.tipo) from albaran_lineas l
                join albaranes a on a.id = l.albaran_id where a.canalizacion_id = '${canalSocial}' and a.estado <> 'anulado'`))
    .toBe('ENT=250.00,REC=250.00')
  // …la maquila conciliada sin ningún albarán…
  expect(sql(`select estado || '|' || kg_conciliados::numeric(12,2) from canalizaciones where id = '${canalObrador}'`)).toBe('conciliada|250.00')
  expect(sql(`select count(*) from albaranes where canalizacion_id = '${canalObrador}' and estado <> 'anulado'`)).toBe('0')
  expect(sql(`select estado || '|' || kg_conciliados::numeric(12,2) from canalizaciones where id = '${canalSocial}'`)).toBe('conciliada|250.00')
  // …el precio de la donación, el declarado (definitivo): 250 kg × 0,60 €.
  expect(sql(`select coste_kg::numeric(12,2) || '|' || preu_provisional from canalizaciones where id = '${canalSocial}'`)).toBe('0.60|false')
  // …la fecha de las dos recogidas es la REAL (hoy), no la prevista (mañana): la misma que los
  // albaranes, y la que usan certificados y cierres (20270613100000). Sin aviso de «canvi d'hora».
  expect(sql(`select string_agg((data_hora_recollida = recollida_real_at)::text, ',') from canalizaciones
                where id in ('${canalSocial}', '${canalObrador}')`)).toBe('true,true')
  expect(sql(`select count(*) from avisos where tipus = 'recollida_canviada' and (params->>'excedente_id') = '${oferta}'`)).toBe('0')
  // …y la oferta, cerrada: los 500 kg tienen salida.
  await expect.poll(() => sql(`select estado from excedentes where id = '${oferta}'`), { timeout: 20_000 }).toBe('cerrada')
})

test('7b. els PDF dels dos albarans es generen', async () => {
  test.skip(!canalSocial, 'depèn del pas 5')
  // Los genera `generar-documento` por pg_net: hacen falta las funciones locales.
  let n = ''
  for (let i = 0; i < 30 && n !== '2'; i++) {
    n = sql(`select count(*) from documentos d join albaranes a on a.id = d.objeto_id
              where a.canalizacion_id = '${canalSocial}' and d.estado = 'emitido' and d.vigente and d.ruta is not null`)
    if (n !== '2') await new Promise((r) => setTimeout(r, 2000))
  }
  test.skip(n === '0', 'generar-documento no respon: cal `bash scripts/local/funciones-local.sh`')
  expect(n).toBe('2')
})

test('8a. el super_admin emet el certificat de donació de l’oferta: 250 kg a l’entitat social, la maquila exclosa', async ({ page }) => {
  test.skip(!canalSocial, 'depèn del pas 7')
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${oferta}`)
  const targeta = page.getByTestId('certificat-oferta')
  await expect(targeta).toBeVisible({ timeout: 30_000 })
  await targeta.getByRole('button', { name: /^Certificat de donació$|^Certificado de donación$/ }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('radio', { name: /^Oferta$/ })).toHaveAttribute('aria-checked', 'true')
  await dlg.getByRole('button', { name: /^Calcula$|^Calcular$/ }).click()
  await expect(dlg.getByTestId('cdon-calcul')).toBeVisible({ timeout: 30_000 })
  await expect(dlg.getByTestId('cdon-calcul')).toContainText(/250/)
  await expect(dlg.getByTestId('cdon-excloses')).toContainText(/Maquila|maquila/)
  await captura(page, '8-certificat-donacio')
  await dlg.getByRole('button', { name: /^Emet el certificat$|^Emitir el certificado$/ }).click()
  await expect(dlg.getByTestId('cdon-emes')).toBeVisible({ timeout: 30_000 })
  const fila = sql(`select certificado_numero || '|' || kg_total::numeric(12,2) || '|' || valor_total::numeric(12,2) from cierres_periodo
                     where excedente_id = '${oferta}' and certificado_numero is not null and estado <> 'substituit'
                     order by certificado_at desc limit 1`)
  expect(fila).toMatch(/^P-CDP-\S+\|250\.00\|150\.00$/)
  // El PDF del certificado se descarga (espera a que se genere).
  const [descarrega] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    dlg.getByTestId('cdon-emes').getByRole('button', { name: /^Descarrega$|^Descargar$/ }).click(),
  ])
  expect(descarrega.suggestedFilename()).toMatch(/\.pdf$/)
})

test('8b. el super_admin emet el certificat de recepció de l’entitat social', async ({ page }) => {
  test.skip(!canalSocial, 'depèn del pas 7')
  const ent = entidadDe(SOCIAL)
  const org = sql(`select organizacion_id from entidades where id = '${ent}'`)
  // Un CR por periodo: si otra pasada de hoy ya emitió el del día, no se puede emitir otro
  // (el CR no se rectifica, deuda 138). Se comprueba ese y se salta la emisión.
  const jaEmes = sql(`select count(*) from cierres_receptor where entidad_id = '${ent}' and certificado_numero is not null
                        and periodo_desde = current_date and periodo_hasta = current_date and kg_total >= 250`)
  test.skip(jaEmes !== '0', 'el CR d’avui ja el va emetre una passada anterior (un per període)')
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=documentacio`)
  const bloc = page.getByTestId('bloc-certificats')
  await expect(bloc).toBeVisible({ timeout: 30_000 })
  await bloc.getByRole('button', { name: /^Emet-ne un$|^Emitir uno$/ }).last().click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('heading', { name: /Certificat de recepció|Certificado de recepción/ })).toBeVisible()
  const avui = sql(`select to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD')`)
  await dlg.locator('#crec-desde').fill(avui)
  await dlg.locator('#crec-hasta').fill(avui)
  await dlg.getByRole('button', { name: /^Calcula$|^Calcular$/ }).click()
  await expect(dlg.getByText(/250/).first()).toBeVisible({ timeout: 30_000 })
  await captura(page, '8-certificat-recepcio')
  const emet = dlg.getByRole('button', { name: /^Emet el certificat de recepció$|^Emitir el certificado de recepción$/ })
  test.skip(await emet.isDisabled(), 'el càlcul del dia té bloquejos d’altres proves al clon')
  await emet.click()
  // Confirmación.
  await page.getByRole('alertdialog').or(page.getByRole('dialog').last())
    .getByRole('button', { name: /^Emet el certificat de recepció$|^Emitir el certificado de recepción$/ }).last().click()
  await expect.poll(() => sql(`select count(*) from cierres_receptor where entidad_id = '${ent}' and certificado_numero is not null
                                 and periodo_desde = current_date`), { timeout: 30_000 }).not.toBe('0')
})

test('9a. l’ofertant veu «Producte recollit»', async ({ page }) => {
  test.skip(!oferta, 'depèn del pas 1')
  await entra(page, OFERTANT)
  await page.goto(`/productor/ofertes/${oferta}`)
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 })
  await captura(page, '9-ofertant')
  await page.goto('/productor/ofertes')
  await expect(page.getByRole('link').or(page.getByRole('button')).filter({ hasText: 'Tomàquet' })
    .filter({ hasText: /Producte recollit|Producto recogido|Tancada|Cerrada/ }).first()).toBeVisible({ timeout: 30_000 })
})

test('9b. l’entitat social i l’obrador veuen l’entrega al seu Històric', async ({ browser }) => {
  test.skip(!canalSocial, 'depèn del pas 7')
  for (const rol of [SOCIAL, OBRADOR]) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await entra(page, rol)
    await page.goto('/receptor/historic')
    await expect(page.getByRole('button').filter({ hasText: 'Tomàquet' }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/250 kg/).first()).toBeVisible()
    await captura(page, `9-historic-${rol}`)
    await ctx.close()
  }
})
