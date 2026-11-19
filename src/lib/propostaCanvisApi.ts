// Las dos RPC de la propuesta de cambios (fase 5 de los puntos 4-6, 20270610100000). La lógica
// pura (qué cambia, qué se manda) vive en `propostaCanvis.ts`.
//
// Mismo contrato que `aprovarResposta.ts` y el resto de clientes de `src/lib`: **nunca lanza**.
// Devuelve `ok` y, si no, el mensaje de la base y el SQLSTATE en `codi`; la pantalla lo traduce
// con `textError()` (los códigos `no_proposable`, `sense_proposta`, `proposta_pendent`… están
// en su tabla).

import { supabase } from './supabase'
import type { ResultatRpc } from './albarans'
import type { Modalitat, OfertaRespuesta } from '../types'

export type { ResultatRpc }

/** Lo que devuelve `respondre_proposta`. */
export interface RespostaProposta {
  resposta_id: string
  /** `aprovada`: canalización confirmada · `pendent_preu`: venta, vuelve al equipo · `rebutjada`. */
  resultat: 'aprovada' | 'pendent_preu' | 'rebutjada'
  aprovacio: OfertaRespuesta['aprovacio']
  canalizacion_id: string | null
}

/**
 * Traduce los dos códigos que la tabla común de `textError` no puede distinguir de los de otras
 * pantallas: el motivo que falta (allí `cal_motiu` es el de cancelar una oferta) y la hora que ya
 * ha pasado al ACEPTAR (no es «la recollida no pot ser en el passat»: hace falta otra propuesta).
 */
function codiDe(missatge: string, codi: string | null, alAcceptar: boolean): string | null {
  if (missatge.startsWith('cal_motiu')) return 'cal_motiu_proposta'
  if (alAcceptar && missatge.startsWith('hora_passada')) return 'hora_proposta_passada'
  return codi
}

/**
 * El equipo propone cambios (`pot_aprovar()`). `null` en kilos, modalidad u hora = lo que pidió
 * la entidad; el motivo es obligatorio. Crea el aviso `canvis_proposats` para la entidad.
 */
export async function proposarCanvis(args: {
  resposta: string
  kg: number | null
  modalitat: Modalitat | null
  recollidaAt: string | null
  motiu: string
}): Promise<ResultatRpc<OfertaRespuesta>> {
  try {
    const { data, error } = await supabase.rpc('proposar_canvis', {
      p_resposta: args.resposta,
      p_kg: args.kg,
      p_modalitat: args.modalitat,
      p_recollida_at: args.recollidaAt,
      p_motiu: args.motiu,
    })
    if (error) {
      const m = error.message ?? ''
      return { ok: false, missatge: m || 'c.error', codi: codiDe(m, error.code ?? null, false) }
    }
    return { ok: true, data: data as OfertaRespuesta }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}

/**
 * La entidad (o el equipo por ella, vía asistida) acepta o rechaza la propuesta. Rechazar admite
 * un motivo opcional; el equipo «retira» una propuesta rechazándola en nombre de la entidad.
 */
export async function respondreProposta(args: {
  resposta: string
  accepta: boolean
  motiu?: string | null
}): Promise<ResultatRpc<RespostaProposta>> {
  try {
    const { data, error } = await supabase.rpc('respondre_proposta', {
      p_resposta: args.resposta,
      p_accepta: args.accepta,
      p_motiu: args.motiu?.trim() || null,
    })
    if (error) {
      const m = error.message ?? ''
      return { ok: false, missatge: m || 'c.error', codi: codiDe(m, error.code ?? null, args.accepta) }
    }
    return { ok: true, data: data as RespostaProposta }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}
