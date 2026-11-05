// Cliente de las dos RPC del importador de entidades (super_admin, migración 20270511100000).
// Mismo contrato que el resto de `src/lib`: **nunca lanza**; devuelve `ok` y, si falla, el
// código (`dades_invalides`, `massa_files`, `sense_permis`…) y el mensaje.

import { supabase } from './supabase'
import type { FilaContracte } from './importEntitats'
import type { Previsualitzacio, ResultatImportacio } from '../types'

export type RespostaRpc<T> =
  | { ok: true; dades: T }
  | { ok: false; codi: string | null; missatge: string }

/** El código de un error de la RPC: el prefijo de su mensaje (`massa_files: …`) o el permiso. */
function codiDe(error: { code?: string; message?: string }): string | null {
  if (error.code === '42501') return 'sense_permis'
  const m = /^([a-z_]+):/.exec(error.message ?? '')
  return m ? m[1] : null
}

async function crida<T>(fn: string, args: Record<string, unknown>): Promise<RespostaRpc<T>> {
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) return { ok: false, codi: codiDe(error), missatge: error.message ?? '' }
    return { ok: true, dades: data as T }
  } catch (e) {
    return { ok: false, codi: null, missatge: e instanceof Error ? e.message : String(e) }
  }
}

/** Qué pasaría con cada fila, sin escribir nada. */
export function previsualitzarImportacio(files: FilaContracte[]): Promise<RespostaRpc<Previsualitzacio>> {
  return crida<Previsualitzacio>('previsualitzar_importacio_entitats', { p_files: files })
}

/** La importación de verdad: la base recalcula la identidad de cada fila y deja el registro. */
export function importarEntitats(
  fitxer: { nom: string; sha256: string },
  files: FilaContracte[],
): Promise<RespostaRpc<ResultatImportacio>> {
  return crida<ResultatImportacio>('importar_entitats', { p_fitxer: fitxer, p_files: files })
}

/**
 * Cuándo se importó por última vez un fichero con esta huella (el registro lo lee el equipo),
 * o `null` si nunca o si la consulta falla: es solo un aviso, la importación es idempotente.
 */
export async function jaImportat(sha256: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('importacions_entitats').select('creat_at')
      .eq('fitxer_sha256', sha256).order('creat_at', { ascending: false }).limit(1)
    if (error || !data?.length) return null
    return (data[0] as { creat_at: string }).creat_at
  } catch {
    return null
  }
}
