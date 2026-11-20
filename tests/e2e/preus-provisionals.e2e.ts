// Punto 3, fase D2 (17-11-2026): el certificado aplica el precio del MES DEL ALBARÁN. De punta
// a punta contra el CLON LOCAL con el super_admin:
//
//   1. Una donación cuyo albarán es de este mes (M), sin coste declarado, nace con el último
//      precio validado (M-2) y PROVISIONAL: la ficha de la oferta lo dice, y el certificado de
//      la oferta sale bloqueado («Preus provisionals») con un enlace a Productes › Preus de M.
//   2. El enlace abre ese mes con el aviso de lo que espera; fijar el precio de M para el
//      producto ajusta la canalización sola (con rastro) y el aviso desaparece.
//   3. El certificado ya se emite, con el valor de M, la canalización queda sellada con su número
//      y el PDF imprime la fuente del valor.
//
// Solo en el clon, con `E2E_ESCRIU=1`, y en escritorio. Ficha y producto sintéticos
// (`Fruites del Segrià SL`, `Rebost Solidari del Barri`, producto `Nespra`, solo en el clon); el precio de M del producto se borra antes para poder repetirla.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

// Un producto que solo existe en el clon (lo crea esta prueba): nombre real, sin «TEST-E2E» en pantalla.
const PROD = 'Nespra'
const marca = Date.now().toString(36).slice(-5)
let oferta = ''
let canal = ''
let mes = ''       // aaaa-mm del albarán (M)
let numero = ''

const actiu = () => process.env.E2E_CLON === '1' && process.env.E2E_ESCRIU === '1'

test.beforeAll(({}, info) => {
  if (!actiu() || motiuSaltClon('super_admin') || info.project.name !== 'escriptori') return
  const [m, mAny, mMes, m2Any, m2Mes, m1Any, m1Mes] = sql(`select to_char(m, 'YYYY-MM') || '|' || extract(year from m) || '|' || extract(month from m)
       || '|' || extract(year from m2) || '|' || extract(month from m2)
       || '|' || extract(year from m1) || '|' || extract(month from m1)
     from (select date_trunc('month', now() at time zone 'Europe/Madrid')::date as m,
                  (date_trunc('month', now() at time zone 'Europe/Madrid') - interval '2 months')::date as m2,
                  (date_trunc('month', now() at time zone 'Europe/Madrid') - interval '1 month')::date as m1) x`).split('|')
  mes = m
  // El producto, su manual vigente (0,80: la propuesta de M) y M-2 validado a 0,50.
  if (sql(`select count(*) from productos where nombre = '${PROD}'`) === '0') {
    sqlCom('super_admin', `select crear_producte('${PROD}', 'Fruita Dolça', null)`)
  }
  sql(`insert into costes_producto (producto, coste_kg, motivo) values ('${PROD}', 0.80, 'E2E D2')
       on conflict (producto) do update set coste_kg = 0.80`)
  sql(`delete from preus_referencia where producto = '${PROD}' and exercici = ${mAny} and mes = ${mMes}`)
  // Ni M-1: si está validado (una validación del mes entero lo incluye, el producto es del
  // catálogo), «el último validado» es M-1 y no M-2. En el clon lo estaba desde el 17-11-2026.
  sql(`delete from preus_referencia where producto = '${PROD}' and exercici = ${m1Any} and mes = ${m1Mes}`)
  sqlCom('super_admin', `select fixar_preu_referencia('${PROD}', ${m2Any}, ${m2Mes}, 'manual', 0.50, 'E2E D2')`)
  // Ficha de productor y entidad social sintéticas (de prueba), reutilizadas entre pasadas.
  sql(`do $d$
    declare v_nif text; v_base text; v_ctl text;
    begin
      if not exists (select 1 from productores where email = 'e2e-d2-prod@example.invalid') then
        <<cerca>>
        for i in 1..5000 loop
          v_base := 'B' || lpad((floor(random() * 8999999) + 1000000)::int::text, 7, '0');
          foreach v_ctl in array array['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','I','J'] loop
            if public.nif_valid(v_base || v_ctl) and not exists (select 1 from productores where nif = v_base || v_ctl)
               and not exists (select 1 from entidades where nif = v_base || v_ctl) then
              v_nif := v_base || v_ctl; exit cerca;
            end if;
          end loop;
        end loop;
        insert into productores (name, empresa, razon_social, email, nif, direccion, codigo_postal, poblacion, es_test)
        values ('Fruites del Segrià', 'Fruites del Segrià SL', 'Fruites del Segrià SL', 'e2e-d2-prod@example.invalid', v_nif,
                'Carrer de Prova 2', '08001', 'Barcelona', true);
      end if;
      if not exists (select 1 from entidades where email = 'e2e-d2-ent@example.invalid') then
        insert into entidades (nombre, email, es_test, tipo_receptor, estat, activo)
        values ('Rebost Solidari del Barri', 'e2e-d2-ent@example.invalid', true, 'social', 'Signat', false);
      end if;
    end $d$`)
  const prod = sql(`select id from productores where email = 'e2e-d2-prod@example.invalid'`)
  const ent = sql(`select id from entidades where email = 'e2e-d2-ent@example.invalid'`)
  oferta = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen, observacions)
                values ('E-E2E-D2-${marca}', '${prod}', '${PROD}', 100, 'donacio', 'publicada', 'asistido', 'Nespres madures, collides aquesta setmana. Caixes de 10 kg.')
                returning id`).split('\n')[0]
  canal = sql(`insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
               values ('${oferta}', '${ent}', 100, 'donacio', 'confirmada') returning id`).split('\n')[0]
  sql(`select conciliacion_retroactiva('${canal}', 100, null, 'E2E D2')`)
})

test.afterAll(() => {
  if (!oferta) return
  // Deja los certificados de prueba del año como estaban (solo toca lo de prueba).
  sqlCom('super_admin', `select reiniciar_periodes_prova(extract(year from current_date)::int)`)
})

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
  test.skip(process.env.E2E_ESCRIU !== '1', 'Escriu al clon: cal E2E_ESCRIU=1')
  test.skip(info.project.name !== 'escriptori', 'Emet numeració de prova compartida: només a escriptori')
  test.skip(!oferta, 'No s’ha pogut preparar l’oferta de prova')
})

test('1 · provisional: la oferta lo dice y el certificado se bloquea con enlace al mes', async ({ page }) => {
  expect(sql(`select coste_kg::numeric(10,4) || '|' || preu_font || '|' || preu_provisional || '|' || to_char(preu_mes_albara, 'YYYY-MM')
                from canalizaciones where id = '${canal}'`)).toBe(`0.5000|manual|true|${mes}`)

  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${oferta}`)
  const valor = page.getByTestId('valor-canalitzacio').first()
  await expect(valor.getByTestId('valor-provisional')).toBeVisible()
  await expect(valor.getByText(/Valor de referència provisional|Valor de referencia provisional/)).toBeVisible()

  const targeta = page.getByTestId('certificat-oferta')
  await targeta.getByRole('button', { name: /^Certificat de donació$|^Certificado de donación$/ }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: /^Calcula$|^Calcular$/ }).click()
  const calcul = dlg.getByTestId('cdon-calcul')
  await expect(calcul.getByText(/^Preus provisionals$|^Precios provisionales$/)).toBeVisible()
  const enllac = calcul.getByTestId('bloqueig-mesos').getByRole('link').first()
  await expect(enllac).toContainText(PROD)
  await enllac.click()
  await expect(page).toHaveURL(new RegExp(`/equip/productes\\?pestanya=preus&mes=${mes}$`))
  await expect(page.getByTestId('preu-esperen')).toBeVisible()
  await expect(page.locator(`[data-producte="${PROD}"]`).getByTestId('preu-espera-fila')).toBeVisible()
})

test('2 · fijar el precio de M ajusta la canalización sola, con rastro', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/productes?pestanya=preus&mes=${mes}`)
  const fila = page.locator(`[data-producte="${PROD}"]`)
  await fila.getByRole('button', { name: /Canvia el preu|Cambiar el precio/ }).click()
  await page.locator('#preu-valor').fill('0,8')
  await page.locator('#preu-motiu').fill('E2E D2')
  await page.getByRole('button', { name: /^Desar$|^Guardar$/ }).click()
  await expect(page.locator(`[data-producte="${PROD}"]`).getByTestId('preu-espera-fila')).toHaveCount(0)

  expect(sql(`select coste_kg::numeric(10,4) || '|' || preu_font || '|' || preu_provisional || '|' || to_char(preu_mes_font, 'YYYY-MM')
                from canalizaciones where id = '${canal}'`)).toBe(`0.8000|manual|false|${mes}`)
  expect(sql(`select motiu || '|' || coste_anterior::numeric(10,4) || '|' || coste_nou::numeric(10,4) || '|' || (canviat_per is not null)
                from canalizaciones_preu_hist where canalizacion_id = '${canal}' order by id desc limit 1`))
    .toBe('mes_validat|0.5000|0.8000|true')
})

test('3 · el certificado se emite con el valor de M y el PDF dice la fuente', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${oferta}`)
  await expect(page.getByTestId('valor-canalitzacio').first().getByTestId('valor-provisional')).toHaveCount(0)
  const targeta = page.getByTestId('certificat-oferta')
  await targeta.getByRole('button', { name: /^Certificat de donació$|^Certificado de donación$/ }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: /^Calcula$|^Calcular$/ }).click()
  await expect(dlg.getByTestId('cdon-calcul')).toContainText(/80,00/)
  await expect(dlg.getByText(/^Preus provisionals$|^Precios provisionales$/)).toHaveCount(0)
  await dlg.getByRole('button', { name: /^Emet el certificat$|^Emitir el certificado$/ }).click()
  const emes = dlg.getByTestId('cdon-emes')
  await expect(emes).toBeVisible()
  numero = sql(`select certificado_numero from cierres_periodo where excedente_id = '${oferta}'
                 and certificado_numero is not null order by certificado_at desc limit 1`)
  expect(numero).toMatch(/^P-CDP-/)
  expect(sql(`select preu_certificat from canalizaciones where id = '${canal}'`)).toBe(numero)

  // El PDF, generado por las funciones locales: se espera al fichero, se descarga y se lee.
  await expect.poll(() => sql(`select count(*) from documentos d join cierres_periodo cp on cp.id = d.objeto_id
                                 where cp.excedente_id = '${oferta}' and d.vigente and d.fichero_at is not null`),
    { timeout: 60_000 }).toBe('1')
  const [descarrega] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    emes.getByRole('button', { name: /^Descarrega$|^Descargar$/ }).click(),
  ])
  const ruta = test.info().outputPath('certificat-d2.pdf')
  await descarrega.saveAs(ruta)
  const pdftotext = ['/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext', '/usr/bin/pdftotext'].find(existsSync)
  test.skip(!pdftotext, 'Sense pdftotext no es pot llegir el PDF')
  const text = execFileSync(pdftotext!, ['-layout', ruta, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ')
  expect(text).toMatch(/Fonts dels valors: Preu fixat per la Fundació\.|Fuentes de los valores: Precio fijado por la Fundació\./)
})
