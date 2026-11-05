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
  // 1. Un certificado de intervalo, «limpio»: del 1 de enero a hoy. (Antes era solo de hoy,
  //    y desde que solo cuenta la donación a una entidad social —05-11-2026— el día de hoy
  //    del clon no tiene kilos: sin kilos no entra en revisión.)
  periode = sqlCom('super_admin', `select (calcular_certificado_periodo('${prod}', date_trunc('year', current_date)::date, current_date, 'prueba')).id`)
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
  // El badge se pinta dos veces (bajo el nombre en móvil y en su columna): el visible.
  await expect(page.getByText(/Aprovat per l’equip|Aprobado por el equipo/).filter({ visible: true }).first()).toBeVisible()
  expect(sql(`select revisio_estat || '|' || (revisio_nota is not null) from cierres_donante where id = '${donant}'`))
    .toBe('aprovat_equip|true')

  // La emisión, desde la fila: pide antes la fecha de expedición (por defecto el 31-12; en
  // un ensayo del ejercicio en curso, hoy) y el anexo (05-11-2026, `DialegExpedicio`).
  const nomDonant = sql(`select coalesce(datos_fiscales->>'raó_social', datos_fiscales->>'nombre') from cierres_donante where id = '${donant}'`)
  const fila = page.getByRole('row').filter({ hasText: nomDonant }).first()
  await fila.getByRole('button', { name: /^Emet certificat$|^Emitir certificado$/ }).click()
  const exp = page.getByRole('dialog')
  const avui = sql(`select to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD')`)
  const any = sql(`select ce.ejercicio from cierres_ejercicio ce where ce.id = '${tancament}'`)
  await expect(exp.getByLabel(/Data d’expedició|Fecha de expedición/))
    .toHaveValue(Number(any) < Number(avui.slice(0, 4)) ? `${any}-12-31` : avui)
  await exp.getByText(/Annex amb el detall per producte|Anexo con el detalle por producto/).click()
  await exp.getByRole('button', { name: /^Emet certificat$|^Emitir certificado$/ }).click()
  await expect(exp).toHaveCount(0)
  const r = sql(`select certificado_numero || '|' || annex || '|' || (data_expedicio is not null) from cierres_donante where id = '${donant}'`)
  expect(r).toMatch(/^P-CD-.*\|true\|true$/)
  // La revisión sigue en el snapshot del certificado.
  expect(sql(`select datos->'revisio'->>'estat' from documentos where objeto_id = '${donant}' and tipo = 'CD' and vigente`))
    .toBe('aprovat_equip')
})

// ---------------------------------------------------------------------------
// Certificat de donació según el modelo de Tabaquet (05-11-2026): el super_admin lo emite
// desde la ficha de una oferta de donación, con su fecha de expedición, viendo lo que se
// queda fuera; el ofertante lo ve en «Els meus documents» y en la ficha de su oferta.
// Todo en MODO PRUEBA (la ficha del productor de prueba es `es_test`: serie `P-CDP`).
// ---------------------------------------------------------------------------
test.describe('certificat de donació d’una oferta', () => {
  let oferta = ''
  let numero = ''

  test.beforeAll(({}, info) => {
    if (motiuSaltClon('productor', 'super_admin') || info.project.name !== 'escriptori') return
    const prod = productorDe('productor')
    // Una oferta suya con donación conciliada a una entidad SOCIAL y, además, algo conciliado
    // que no cuenta (entidad no social, venta o maquila), sin certificado de oferta vigente.
    oferta = sql(`select e.id from excedentes e
                   where e.productor_id = '${prod}'
                     and exists (select 1 from canalizaciones c join entidades en on en.id = c.entidad_id
                                  where c.excedente_id = e.id and c.estado = 'conciliada'
                                    and c.valorizacion = 'donacio' and en.tipo_receptor = 'social')
                     and exists (select 1 from canalizaciones c left join entidades en on en.id = c.entidad_id
                                  where c.excedente_id = e.id and c.estado = 'conciliada'
                                    and (c.valorizacion <> 'donacio' or en.tipo_receptor is distinct from 'social'))
                   order by e.created_at desc limit 1`)
    if (!oferta) return
    // Si una pasada anterior lo dejó emitido, se vuelve al punto de partida (solo prueba).
    sqlCom('super_admin', `select reiniciar_periodes_prova(extract(year from current_date)::int)`)
  })

  test.afterAll(() => {
    if (!oferta) return
    sqlCom('super_admin', `select reiniciar_periodes_prova(extract(year from current_date)::int)`)
  })

  test.beforeEach(({}, info) => {
    const m = motiuSaltClon('productor', 'super_admin')
    test.skip(m !== null, m ?? '')
    test.skip(info.project.name !== 'escriptori', 'Emet numeració de prova compartida: només a escriptori')
    test.skip(!oferta, 'El clon no té cap oferta de donació amb canalitzacions excloses')
  })

  test('el super_admin lo emite desde la oferta, con fecha y viendo las excluidas', async ({ page }) => {
    await entra(page, 'super_admin')
    await page.goto(`/equip/ofertes/${oferta}`)
    const targeta = page.getByTestId('certificat-oferta')
    await expect(targeta).toBeVisible()
    await targeta.getByRole('button', { name: /^Certificat de donació$|^Certificado de donación$/ }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('radio', { name: /^Oferta$/ })).toHaveAttribute('aria-checked', 'true')

    // A 360 px el diálogo no desborda (ni él ni sus hijos).
    await page.setViewportSize({ width: 360, height: 780 })
    // Por geometría, no por `scrollWidth`: el contenido del diálogo hace scroll y un hijo
    // que lo ensancha no se ve desbordando él mismo.
    const desborda = await dlg.evaluate((el) => [el, ...el.querySelectorAll('*')]
      .filter((n) => {
        const r = n.getBoundingClientRect()
        return r.width > 0 && r.right > window.innerWidth + 1
      })
      .map((n) => `${n.tagName}.${(n as HTMLElement).className}`.slice(0, 120)))
    expect(desborda, `Desborden a 360 px:\n${desborda.join('\n')}`).toEqual([])
    await page.setViewportSize({ width: 1280, height: 800 })

    // La fecha de expedición: hoy (la de por defecto), escrita a mano.
    const avui = sql(`select to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD')`)
    await dlg.getByLabel(/Data d’expedició|Fecha de expedición/).fill(avui)
    await dlg.getByRole('button', { name: /^Calcula$|^Calcular$/ }).click()
    await expect(dlg.getByTestId('cdon-calcul')).toBeVisible()
    const excl = dlg.getByTestId('cdon-excloses')
    await expect(excl).toBeVisible()
    await expect(excl.getByText(/Entitat no social|Entidad no social|Venda|Venta|Maquila/).first()).toBeVisible()

    await dlg.getByRole('button', { name: /^Emet el certificat$|^Emitir el certificado$/ }).click()
    const emes = dlg.getByTestId('cdon-emes')
    await expect(emes).toBeVisible()
    numero = sql(`select certificado_numero from cierres_periodo where excedente_id = '${oferta}'
                   and certificado_numero is not null and estado <> 'substituit' order by certificado_at desc limit 1`)
    expect(numero).toMatch(/^P-CDP-/)
    expect(sql(`select abast || '|' || data_expedicio from cierres_periodo where certificado_numero = '${numero}'`))
      .toBe(`oferta|${avui}`)

    // La descarga: por `descargar-documento`, esperando a que el PDF se genere.
    const [descarrega] = await Promise.all([
      page.waitForEvent('download', { timeout: 45_000 }),
      emes.getByRole('button', { name: /^Descarrega$|^Descargar$/ }).click(),
    ])
    expect(descarrega.suggestedFilename()).toMatch(/\.pdf$/)
  })

  // ⚠️ Un documento de PRUEBA no lo ve nunca una organización: la política de `documentos`
  //    («intern o meus») exige `modo <> 'prueba'` a los externos. En el clon todo certificado
  //    es de prueba (los datos de la Fundació son provisionales y el modo real está cerrado),
  //    así que aquí se comprueba lo que sí ve el ofertante —su fila de `cierres_periodo`, con
  //    el ámbito y la oferta— y que las dos pantallas no enseñan el documento de prueba ni
  //    desbordan a 360 px. Con un certificado real, la misma lectura trae el documento.
  test('el ofertante: lee su certificado de oferta y no ve el documento de prueba', async ({ page }) => {
    test.skip(!numero, 'La prova anterior no ha emès el certificat')
    expect(sqlCom('productor', `select abast || '|' || certificado_numero from cierres_periodo where excedente_id = '${oferta}' and certificado_numero is not null`))
      .toBe(`oferta|${numero}`)
    expect(sqlCom('productor', `select count(*) from documentos d join cierres_periodo cp on cp.id = d.objeto_id where cp.excedente_id = '${oferta}'`))
      .toBe('0')

    await entra(page, 'productor')
    await page.setViewportSize({ width: 360, height: 780 })
    await page.goto('/productor/documents')
    await expect(page.getByText(/^Els meus certificats$|^Mis certificados$/)).toBeVisible()
    await expect(page.getByText(numero)).toHaveCount(0)
    // Sin el código `E-…` en ningún sitio (§6ter).
    await expect(page.getByText(/\bE-\d{6}-[A-Z]{3}-/)).toHaveCount(0)
    const ample = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ample).toBeLessThanOrEqual(0)

    await page.goto(`/productor/ofertes/${oferta}`)
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(page.getByTestId('certificat-oferta-propi')).toHaveCount(0)
    const ample2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(ample2).toBeLessThanOrEqual(0)
  })
})
