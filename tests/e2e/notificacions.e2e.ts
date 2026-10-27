// Los interruptores de notificaciones y el RGPD del alta (27-10-2026, §8 y §9).
// Escribe en `app_settings` del CLON, así que solo contra el clon y solo en escritorio, y deja
// los tres interruptores encendidos al acabar pase lo que pase.

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { entra, motiuSaltClon, sql } from './ajuda'

const encen = () => sql(`update app_settings set value = 'true' where key in ('notificacions_actives','email_activo','whatsapp_activo')`)
const valors = () => Object.fromEntries(
  sql(`select key || '=' || value from app_settings where key in ('notificacions_actives','email_activo','whatsapp_activo')`)
    .split('\n').map((l) => l.split('=')),
)

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Configuració és d’escriptori')
  encen()
})
test.afterEach(() => { if (!motiuSaltClon('super_admin')) encen() })

/** La tarjeta de Configuració por su título. */
const targeta = (page: Page, titol: RegExp) =>
  page.locator('[data-slot="card"]', { has: page.getByText(titol) }).first()

test('apagar el general apaga los canales; encenderlo no los enciende', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.goto('/equip/configuracio?tab=notificacions')
  const general = targeta(page, /Notificacions de la plataforma|Notificaciones de la plataforma/)
  await expect(general).toBeVisible()
  // Missatgeria al menú mentre WhatsApp està actiu.
  await expect(page.locator('a[href="/equip/missatgeria"]').first()).toBeVisible()

  await general.getByRole('button', { name: /^Desactivat$|^Desactivado$/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Desactivar/ }).click()
  await expect.poll(valors).toEqual({ notificacions_actives: 'false', email_activo: 'false', whatsapp_activo: 'false' })
  // Missatgeria desapareix del menú i l'«Activat» del correu queda gris.
  await expect(page.locator('a[href="/equip/missatgeria"]')).toHaveCount(0)
  const correu = targeta(page, /Canal correu|Canal correo/)
  await expect(correu.getByRole('button', { name: /^Activat$|^Activado$/ })).toBeDisabled()
  await page.screenshot({ path: 'test-results/notificacions-apagades.png', fullPage: true })

  // Reactivar el general NO encén els canals.
  await general.getByRole('button', { name: /^Activat$|^Activado$/ }).click()
  await expect.poll(valors).toEqual({ notificacions_actives: 'true', email_activo: 'false', whatsapp_activo: 'false' })

  // Només el correu: torna el correu, Missatgeria continua amagada.
  await correu.getByRole('button', { name: /^Activat$|^Activado$/ }).click()
  await expect.poll(valors).toEqual({ notificacions_actives: 'true', email_activo: 'true', whatsapp_activo: 'false' })
  await expect(page.locator('a[href="/equip/missatgeria"]')).toHaveCount(0)
  // I la ruta directa torna al tauler.
  await page.goto('/equip/missatgeria')
  await expect(page).toHaveURL(/\/equip\/tauler/)
})

test('con el correo apagado, «Correu» de los listados queda gris', async ({ page }) => {
  sql(`update app_settings set value = 'false' where key = 'email_activo'`)
  await entra(page, 'super_admin')
  await page.goto('/equip/productors')
  const boto = page.getByRole('button', { name: /^Correu$|^Correo$/ }).first()
  await expect(boto).toBeVisible()
  await expect(boto).toBeDisabled()
})

test('el registro pide aceptar la privacidad y enlaza la política', async ({ page }) => {
  await page.goto('/registre')
  await expect(page.getByText(/Privacitat i comunicacions|Privacidad y comunicaciones/)).toBeVisible()
  await expect(page.getByRole('link', { name: /política de privaci/ })).toHaveAttribute('href', '/privacitat')
  await page.screenshot({ path: 'test-results/registre-rgpd.png', fullPage: true })
  await page.goto('/privacitat')
  await expect(page.getByText(/PROVISIONAL/)).toBeVisible()
})

test('Configuració a 320 px: las pestañas scrollean solas y nada desborda', async ({ page }) => {
  await entra(page, 'super_admin')
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/equip/configuracio?tab=notificacions')
  await expect(page.getByText(/Notificacions de la plataforma|Notificaciones de la plataforma/)).toBeVisible()
  // §2: no basta la página; se miran los hijos (salvo los que scrollean a propósito).
  const desborden = await page.evaluate(() => [...document.querySelectorAll('main *')]
    .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0
      && !['auto', 'scroll', 'hidden'].includes(getComputedStyle(e).overflowX))
    .map((e) => `${e.tagName}.${String(e.className).slice(0, 90)} ${e.scrollWidth}>${e.clientWidth} :: ${(e.textContent ?? '').slice(0, 40)}`))
  expect(desborden).toEqual([])
})
