// Validar o rechazar una oferta que espera al equipo (`pendent_validacio`, 05-10-2026).
//
// Las ofertas que publica el productor —por el panel o por WhatsApp— nacen en ese estado
// mientras `app_settings.validacio_ofertes` esté encendido (trigger `excedentes_validacio`).
// No salen al Mercat hasta que alguien con `pot_aprovar()` las valida. Rechazar las deja
// `cancelada` con el motivo: el productor lo ve en su panel.
//
// Mismo contrato que `aprovarResposta.ts`: **nunca lanza**.

import { supabase } from './supabase'
import type { ResultatRpc } from './albarans'
import type { Excedente } from '../types'

function error(e: { message?: string; code?: string }): ResultatRpc<Excedente> {
  return { ok: false, missatge: e.message || 'c.error', codi: e.code ?? null }
}

export async function validarOferta(id: string): Promise<ResultatRpc<Excedente>> {
  try {
    const { data, error: e } = await supabase.rpc('validar_oferta', { p_id: id })
    if (e) return error(e)
    return { ok: true, data: data as Excedente }
  } catch (e) {
    return { ok: false, missatge: e instanceof Error ? e.message : 'c.error', codi: null }
  }
}

export async function rebutjarOferta(id: string, motiu: string): Promise<ResultatRpc<Excedente>> {
  try {
    const { data, error: e } = await supabase.rpc('rebutjar_oferta', { p_id: id, p_motiu: motiu })
    if (e) return error(e)
    return { ok: true, data: data as Excedente }
  } catch (e) {
    return { ok: false, missatge: e instanceof Error ? e.message : 'c.error', codi: null }
  }
}
