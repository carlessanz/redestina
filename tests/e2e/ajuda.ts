// Utilidades de las E2E: cuentas, cortina y entrar.

import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

export interface Compte { etiqueta: string; email: string; password: string; rol: string }

/** Las cuentas de `scripts/data/cuentas-prueba.json` (o `CUENTAS_PRUEBA`); vacío si no hay. */
export function comptes(): Compte[] {
  try {
    const raw = process.env.CUENTAS_PRUEBA ?? readFileSync('scripts/data/cuentas-prueba.json', 'utf8')
    return JSON.parse(raw) as Compte[]
  } catch {
    return []
  }
}

export function compte(rol: string): Compte | undefined {
  return comptes().find((c) => c.rol === rol)
}

/** ¿Hay lo necesario para correr? Si no, la prueba se salta con el motivo. */
export function motiuSalt(rol: string): string | null {
  if (!process.env.E2E_CORTINA) return 'Falta E2E_CORTINA (la contrasenya de la cortina)'
  if (!compte(rol)) return `Falta una compte «${rol}» a scripts/data/cuentas-prueba.json`
  return null
}

/** Pasa la cortina de contraseña (§9). La cookie dura 7 días en el contexto de la prueba. */
export async function passaCortina(page: Page): Promise<void> {
  await page.goto('/')
  const camp = page.locator('input[type="password"]').first()
  if (await camp.isVisible().catch(() => false)) {
    await camp.fill(process.env.E2E_CORTINA ?? '')
    await camp.press('Enter')
    await page.waitForLoadState('networkidle')
  }
}

/** Entra con una cuenta: /admin para el equipo, /login para el resto. */
export async function entra(page: Page, rol: string): Promise<void> {
  const c = compte(rol)!
  await passaCortina(page)
  await page.goto(rol === 'equip' || rol === 'super_admin' ? '/admin' : '/login')
  await page.locator('input[type="email"]').first().fill(c.email)
  await page.locator('input[type="password"]').first().fill(c.password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL((u) => !/\/(login|admin)$/.test(u.pathname), { timeout: 30_000 })
}
