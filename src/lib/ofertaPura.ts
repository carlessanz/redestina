// Las piezas PURAS del alta de oferta (06-10-2026): sin red ni cliente de Supabase, para
// que se puedan probar desde Vitest (`supabase.ts` lanza al cargarse sin variables de
// entorno, así que nada que lo importe se puede cargar en una prueba). `ofertes.ts` las
// reexporta: quien ya las usaba no cambia nada.

import type { CampoOferta } from './ofertes'

/** Los valores de una respuesta como lista: una respuesta múltiple llega como array. */
export function valorsDe(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? ''))
  return [String(v ?? '')]
}

/** Vacía: nada, texto en blanco o una lista sin elementos. Espejo de `buit()` en Deno. */
export function respostaBuida(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0
  return v === undefined || v === null || String(v).trim() === ''
}

/**
 * ¿Parece una cantidad? Para el campo «varietat»: en la reunión del 06-10-2026 alguien
 * escribió «200» ahí pensando que eran los kg. Un nombre de variedad nunca es solo un número.
 */
export function semblaQuantitat(v: unknown): boolean {
  return /^\s*\d+(?:[.,]\d+)?\s*(?:kg|quilos?|kilos?)?\s*$/i.test(String(v ?? ''))
}

/** La franja «HH:MM-HH:MM» → [desde, fins], o null. */
export function partFranja(v: unknown): [string, string] | null {
  const m = String(v ?? '').match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/)
  return m ? [`${m[1]}:${m[2]}`, `${m[3]}:${m[4]}`] : null
}

/**
 * ¿Este campo se pregunta, dados los datos? Espejo de `aplica()` en
 * `_shared/camposOferta.ts` —que es Deno y no entra en el bundle—; divergir no rompería
 * nada (el servidor valida con el suyo), pero la pantalla preguntaría otra cosa que el bot.
 */
export function aplicaCamp(campo: CampoOferta, datos: Record<string, unknown>): boolean {
  const conds = campo.condicions
    ?? (campo.condicion ? (Array.isArray(campo.condicion) ? campo.condicion : [campo.condicion]) : [])
  if (conds.length === 0) return true
  return conds.some((c) => valorsDe(datos[c.campo]).some((v) => c.en.includes(v)))
}
