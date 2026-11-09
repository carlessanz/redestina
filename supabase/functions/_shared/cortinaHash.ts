// La huella de la contraseña de la cortina (09-11-2026). Un solo sitio para el cálculo, que
// necesitan tres: el middleware de Vercel (`cortina/cortina.ts`, que lo reexporta), la Edge
// Function `cortina-config` (que guarda la huella al cambiar la contraseña desde Configuració) y
// `scripts/cortina-hash.mjs` (que repite el algoritmo a mano, con test de paridad).
//
//      token = PBKDF2-SHA256(contraseña, sal fija, 100.000 vueltas)   → va en la cookie
//      hash  = SHA-256(token)                                          → lo que se guarda
//
// ⚠️ Módulo PURO (Web Crypto y nada más): corre en Edge (middleware), Deno y Node (Vitest).
// ⚠️ Cambiar `SAL` o `VOLTES` invalida TODAS las huellas guardadas y todas las cookies.

export const SAL = 'redestina-cortina-v1'
export const VOLTES = 100_000

/** Mínimo y máximo de la contraseña que se puede poner desde Configuració. */
export const MIN_CONTRASENYA = 8
export const MAX_CONTRASENYA = 100

export function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** El token que va en la cookie, derivado de la contraseña escrita. */
export async function tokenDeContrasenya(contrasenya: string): Promise<string> {
  const enc = new TextEncoder()
  const clau = await crypto.subtle.importKey('raw', enc.encode(contrasenya), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(SAL), iterations: VOLTES, hash: 'SHA-256' },
    clau,
    256,
  )
  return hex(bits)
}

/** SHA-256 de un token: lo que se guarda y contra lo que se compara. */
export async function huellaDeToken(token: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}

/** La huella que se guarda para una contraseña. */
export async function huellaDeContrasenya(contrasenya: string): Promise<string> {
  return huellaDeToken(await tokenDeContrasenya(contrasenya))
}

/** `null` si la contraseña vale; si no, el motivo (código estable, la interfaz lo traduce). */
export function motiuContrasenyaInvalida(contrasenya: unknown): 'tipus' | 'curta' | 'llarga' | null {
  if (typeof contrasenya !== 'string') return 'tipus'
  if (contrasenya.length < MIN_CONTRASENYA) return 'curta'
  if (contrasenya.length > MAX_CONTRASENYA) return 'llarga'
  return null
}
