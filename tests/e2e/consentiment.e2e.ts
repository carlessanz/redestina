// Consentimiento RGPD por enlace y convenio por correo desde la ficha (04-11-2026,
// 20270506100000). Solo contra el CLON: crea su propia entidad de prueba y la borra al acabar.
//
// Lo que se afirma, en orden (modo serie):
//   1. El equipo pide el consentimiento desde Gestió interna: sale la petición y NO consta
//      ningún consentimiento (el equipo ya no lo marca).
//   2. La persona, sin cuenta, abre `/consentiment/:token`: sin la privacidad no puede
//      responder; con ella, se guardan sus tres respuestas, el enlace se gasta y la ficha lo
//      enseña como «enllaç per correu».
//   3. El convenio se envía por correo desde Documentació: queda pendiente de firma con su
//      enlace al correo de la ficha, sin que la entidad entre en Redestina.

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const LLETRES = 'TRWAGMYFPDXBNJZSQVHLCKE'
const dni = (n: number) => { const s = String(Math.floor(n) % 1e8).padStart(8, '0'); return s + LLETRES[Number(s) % 23] }

let org = ''
let ent = ''
let email = ''

test.beforeEach(() => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
})

test.beforeAll(({}, info) => {
  if (motiuSaltClon('super_admin') !== null) return
  const ara = Date.now()
  const marca = `${info.project.name}-${ara}`
  email = `e2e-cons-${marca}@example.com`.toLowerCase()
  const fila = sql(`insert into entidades (nombre, razon_social, nif, tipo_receptor, email, direccion, es_test)
    values ('E2E Consentiment ${marca}', 'E2E Consentiment ${marca} SL', '${dni(ara / 13)}', 'social',
            '${email}', 'Carrer de Prova 1', true)
    returning id || '|' || organizacion_id`).split('\n')[0]
  ;[ent, org] = fila.split('|')
  // Con la lista de correos de prueba llena, el correo solo sale a quien esté en ella.
  sql(`insert into email_test_recipients (email) values ('${email}') on conflict do nothing`)
})

test.afterAll(() => {
  if (!ent) return
  sql(`delete from email_test_recipients where email = '${email}'`)
  sql(`delete from documento_envios where objeto_tipo = 'organizacion' and objeto_id = '${org}'`)
  sql(`delete from consentiments where email = '${email}'`)
  // Con un convenio preparado puede haber documentos: entonces el borrado se niega y la ficha
  // de prueba se queda inactiva, que no estorba a nadie.
  try {
    sqlCom('super_admin', `select borrar_ficha_completa('entidad', '${ent}', true)`)
  } catch {
    sql(`update entidades set activo = false where id = '${ent}'`)
  }
})

test('el equip demana el consentiment i no en marca cap', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=intern`)
  const bloc = page.getByTestId('consentiments')
  await expect(bloc).toContainText(/Cap consentiment registrat|Ningún consentimiento registrado/)
  await bloc.getByRole('button', { name: /Demana el consentiment per correu|Pide el consentimiento por correo/ }).click()
  await expect(page.getByTestId('consentiment-peticio')).toContainText(email)

  expect(sql(`select count(*) from enlaces_token where objeto_tipo = 'organizacion'
    and objeto_id = '${org}' and proposito = 'consentiment_rgpd' and estado = 'activo'`)).toBe('1')
  expect(sql(`select count(*) from consentiments where organizacion_id = '${org}'`)).toBe('0')
})

test('la persona respon sense compte i queda a la fitxa', async ({ page, browser }) => {
  // El token en claro solo viaja en el correo (simulado en el clon): se acuña otro como
  // servidor, que revoca el del paso anterior.
  const token = sql(`select demanar_consentiment('${org}') ->> 'token'`)
  expect(sql(`select count(*) from enlaces_token where objeto_id = '${org}'
    and proposito = 'consentiment_rgpd' and estado = 'activo'`)).toBe('1')

  const ctx = await browser.newContext()
  const pub = await ctx.newPage()
  await pub.goto(`/consentiment/${token}`)
  const form = pub.getByTestId('consentiment-public')
  await expect(form).toContainText(/E2E Consentiment/)
  const desa = form.getByRole('button', { name: /Desa les meves respostes|Guarda mis respuestas/ })
  await desa.click()
  await expect(form.getByRole('alert')).toContainText(/política de privacitat|política de privacidad/)

  await form.getByText(/He llegit i accepto|He leído y acepto/).click()
  await form.getByText(/comunicacions informatives de la plataforma|comunicaciones informativas de la plataforma/).click()
  await desa.click()
  await expect(form).toContainText(/Gràcies|Gracias/)

  expect(sql(`select string_agg(tipus || ':' || valor || ':' || origen, ',' order by tipus)
    from consentiments where organizacion_id = '${org}'`))
    .toBe('comunicacions_espigoladors:false:enllac,comunicacions_plataforma:true:enllac,privacitat:true:enllac')
  expect(sql(`select count(*) from llista_consentiments() where organizacion_id = '${org}' and email = '${email}'`)).toBe('3')

  // El enlace ya está gastado.
  await pub.reload()
  await expect(form).toContainText(/No es pot obrir aquest enllaç|No se puede abrir este enlace/)
  await ctx.close()

  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=intern`)
  const bloc = page.getByTestId('consentiments')
  await expect(bloc).toContainText(/enllaç per correu|enlace por correo/)
  await expect(page.getByTestId('consentiment-peticio')).toContainText(/Ha respost|Ha respondido/)
})

test('el conveni s’envia per correu des de la fitxa', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto(`/equip/entitats/${org}?pestanya=documentacio`)
  const conv = page.getByTestId('conveni-entidad')
  await conv.getByRole('button', { name: /Envia’l per correu per signar|Envíalo por correo para firmar/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Envia’l per correu per signar|Envíalo por correo para firmar/ }).click()
  await expect(conv.getByRole('button', { name: /Torna a enviar-lo per correu|Vuelve a enviarlo por correo/ })).toBeVisible()

  expect(sql(`select c.estado || '|' || t.destinatario_email from convenios c
    join enlaces_token t on t.id = c.enlace_id
    where c.entidad_id = '${ent}' and c.tipo = 'col_receptor'`)).toBe(`pendent_firma|${email}`)
})
