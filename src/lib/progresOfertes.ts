// El embudo de MIS ofertas, en cifras y sin nombres.
//
// Envuelve a `progres_meves_ofertes()` (20270323100000), que devuelve por oferta activa a
// cuántas entidades se envió, cuántas dijeron que sí y cuántas esperan aprobación.
//
// ⚠️ LA RPC NO DEVUELVE NINGÚN NOMBRE, Y ESO ES EL PUNTO. Quién quiere el producto es
//    información de la otra parte y de la coordinación, no del donante: el productor ve
//    «tres entitats han mostrat interès», nunca cuáles. Si algún día hiciera falta el
//    detalle, se decide en la base —cambiando lo que la función concede— y no aquí.
//
// Mismo contrato que `pendents.ts`, `albarans.ts` y `documents.ts`: **nunca lanza**. Un
// panel que se queda sin estas cifras sigue sabiendo contar el resto del proceso (el
// estado del excedente y su albarán bastan para las cuatro etapas), así que un fallo aquí
// degrada la pantalla en vez de vaciarla.

import { supabase } from './supabase'
import type { ResultatRpc } from './albarans'

/** Una fila de `progres_meves_ofertes()`. Solo cifras. */
export interface ProgresOferta {
  excedente_id: string
  n_enviades: number
  n_interessades: number
  n_per_aprovar: number
}

export async function carregaProgresOfertes(): Promise<ResultatRpc<ProgresOferta[]>> {
  try {
    const { data, error } = await supabase.rpc('progres_meves_ofertes')
    if (error) return { ok: false, missatge: error.message || 'c.error', codi: error.code ?? null }
    return { ok: true, data: (data as ProgresOferta[] | null) ?? [] }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}

/** Las filas por `excedente_id`, que es como las consultan las pantallas. */
export function perOferta(files: ProgresOferta[]): Record<string, ProgresOferta> {
  const mapa: Record<string, ProgresOferta> = {}
  for (const f of files) mapa[f.excedente_id] = f
  return mapa
}
