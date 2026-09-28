// El texto que se enseña cuando falla una llamada a la base o a una Edge Function.
//
// Los envoltorios de `src/lib` (albarans.ts, tancament.ts, convenis.ts, canalitzacio.ts,
// diagnosticApi.ts…) devuelven `missatge` de TRES formas distintas y la pantalla no puede
// saber cuál: el texto que levanta la RPC (ya legible, en catalán), una CLAVE i18n de
// respaldo (`c.error`, `diag.err_generic`…) o, cuando Postgres corta antes de la RPC, su
// mensaje en inglés («permission denied for table …»). Enseñar `res.missatge` a pelo
// pintaba la clave cruda en dos de los tres casos (revisión del 28-09-2026). Esto decide
// en un solo sitio.

import { DICTS } from './i18n'

type Traductor = (clau: string, params?: Record<string, string | number>) => string

/** Códigos propios que llegan en `codi` o dentro del mensaje, con su texto. */
const CODIS: Record<string, string> = {
  sense_conveni: 'od.conv_blocked',
}

/** Códigos que algunas Edge Functions y envoltorios devuelven COMO mensaje. */
const EXACTES: Record<string, string> = {
  unauthorized: 'msg.w_unauth',
  forbidden: 'msg.w_unauth',
  error: 'c.error',
}

/** Mensajes de Postgres/PostgREST que no dicen nada útil a quien usa la pantalla. */
const CRUS = /permission denied|row-level security|violates|JWT|Failed to fetch|NetworkError|no_autoritzat/i

/** ¿Es una clave del diccionario? (en `ca`, que es el que tiene todas). */
export function esClau(s: string): boolean {
  return Object.prototype.hasOwnProperty.call(DICTS.ca, s)
}

/**
 * El texto de un error, listo para un toast.
 *
 * Orden: un código conocido (por `codi` o dentro del mensaje) → su clave; un mensaje que ES
 * una clave → traducido; un mensaje crudo de Postgres o vacío → `fallback`; el resto (el
 * texto que la RPC levanta a propósito) → tal cual.
 */
export function textError(
  t: Traductor,
  r: { missatge?: string | null; codi?: string | null } | string | null | undefined,
  fallback = 'c.error',
): string {
  const missatge = (typeof r === 'string' ? r : r?.missatge) ?? ''
  const codi = typeof r === 'string' ? null : r?.codi ?? null
  if (codi && CODIS[codi]) return t(CODIS[codi])
  for (const [c, clau] of Object.entries(CODIS)) if (missatge.includes(c)) return t(clau)
  if (missatge === '') return t(fallback)
  if (EXACTES[missatge]) return t(EXACTES[missatge])
  if (esClau(missatge)) return t(missatge)
  if (CRUS.test(missatge)) return t(fallback)
  return missatge
}
