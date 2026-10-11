// Utilidades de las E2E: cuentas, cortina y entrar.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

/** Por etiqueta (`receptor-carles`) o, si no, la primera con ese rol (`receptor`). */
export function compte(rol: string): Compte | undefined {
  return comptes().find((c) => c.etiqueta === rol) ?? comptes().find((c) => c.rol === rol)
}

/** ¿Corremos contra el clon local? (`E2E_CLON=1`, ver `playwright.config.ts`). */
export const CLON = process.env.E2E_CLON === '1'

/** ¿Hay lo necesario para correr? Si no, la prueba se salta con el motivo. */
export function motiuSalt(rol: string): string | null {
  if (!CLON && !process.env.E2E_CORTINA) return 'Falta E2E_CORTINA (la contrasenya de la cortina)'
  if (!compte(rol)) return `Falta una compte «${rol}» a scripts/data/cuentas-prueba.json`
  return null
}

/**
 * Las pruebas que ESCRIBEN de verdad (emitir, cerrar, registrar destinos) solo corren contra
 * el clon local, y lo comprueban dos veces: la variable y que el frontend del clon apunte a
 * 127.0.0.1 (misma defensa que `scripts/local/*`). Contra producción se saltan.
 */
export function motiuSaltClon(...rols: string[]): string | null {
  if (!CLON) return 'Només contra el clon local (E2E_CLON=1)'
  const env = existsSync('.env.supabase-local.local') ? readFileSync('.env.supabase-local.local', 'utf8') : ''
  if (!/VITE_SUPABASE_URL=http:\/\/(127\.0\.0\.1|localhost)/.test(env)) {
    return 'El frontend del clon no apunta a 127.0.0.1 (.env.supabase-local.local)'
  }
  for (const r of rols) {
    const m = motiuSalt(r)
    if (m) return m
  }
  return null
}

/**
 * SQL contra la base del CLON (como `postgres`, así que `auth.uid()` es nulo y los jobs pasan
 * su guarda). Devuelve la salida de `psql -At`. Solo con `motiuSaltClon()` resuelto: es la
 * forma de preparar datos y de disparar `marcar_excedentes_vencidos()` sin esperar a cron.
 */
export function sql(consulta: string): string {
  if (!CLON) throw new Error('sql() només contra el clon local')
  return execFileSync('docker', [
    'exec', '-i', 'supabase_db_Redestina', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', consulta,
  ], { encoding: 'utf8' }).trim()
}

/** El `productor_id` de la cuenta con ese rol (por su membresía activa). */
export function productorDe(rol: string): string {
  const c = compte(rol)!
  return sql(`select m.productor_id from membresias m join auth.users u on u.id = m.user_id
               where u.email = '${c.email.replace(/'/g, "''")}' and m.productor_id is not null and m.activo
               limit 1`)
}

/** Pasa la cortina de contraseña (§9). La cookie dura 7 días en el contexto de la prueba. */
export async function passaCortina(page: Page): Promise<void> {
  await page.goto('/')
  if (CLON) return
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
  const esEquip = ['equip', 'super_admin'].includes(c.rol)
  await page.goto(esEquip ? '/admin' : '/login')
  await page.locator('input[type="email"]').first().fill(c.email)
  await page.locator('input[type="password"]').first().fill(c.password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL((u) => !/\/(login|admin)$/.test(u.pathname), { timeout: 30_000 })
}

/** El `entidad_id` de la cuenta (por etiqueta o rol), por su membresía activa. */
export function entidadDe(rol: string): string {
  const c = compte(rol)!
  return sql(`select m.entidad_id from membresias m join auth.users u on u.id = m.user_id
               where u.email = '${c.email.replace(/'/g, "''")}' and m.entidad_id is not null and m.activo
               limit 1`)
}

/**
 * Ejecuta SQL COMO una cuenta (rol `authenticated` y su `sub` en los claims), en una
 * transacción: es como llamar a una RPC desde su sesión, sin pasar por la pantalla. Sirve
 * para preparar lo que en la vida real haría otra persona (el equipo aprobando, p. ej.).
 */
export function sqlCom(rol: string, consulta: string): string {
  const c = compte(rol)!
  const uid = sql(`select id from auth.users where email = '${c.email.replace(/'/g, "''")}'`)
  const sortida = sql(`begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
    ${consulta};
    commit;`)
  // La última línea con contenido es el resultado de la consulta (antes van los de set_config).
  return sortida.split('\n').filter((l) => l && !l.startsWith('{') && l !== 'BEGIN' && l !== 'COMMIT' && l !== 'SET').pop() ?? ''
}
