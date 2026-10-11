// La ficha de una operación (fase 2 de la revisión del cliente del 08-10-2026): lo que cada
// parte necesita saber de una canalización ya asignada —qué, cuánto, de quién o para quién,
// dónde y cuándo—. La compone `operacio_detall()` en la base, que solo la da a las partes y
// al equipo. Nunca lanza.

import { supabase } from './supabase'

export type EstatRecollida = 'pendent' | 'programada' | 'entregada' | 'confirmada' | 'conciliada'

export interface Operacio {
  canalizacion_id: string
  excedente_id: string
  resposta_id: string | null
  rol: 'productor' | 'entidad' | 'equip'
  producte: string | null
  varietat: string | null
  modalitat: string | null
  kg_sollicitats: number | null
  kg_assignats: number | null
  kg_rebuts: number | null
  data_hora_recollida: string | null
  estat_recollida: EstatRecollida
  productor_nom: string | null
  productor_contacte: string | null
  productor_telefon: string | null
  entitat_nom: string | null
  entitat_contacte: string | null
  entitat_telefon: string | null
  lloc_alias: string | null
  lloc_adreca: string | null
  lloc_municipi: string | null
  lloc_maps: string | null
  lloc_contacte: string | null
  lloc_telefon: string | null
  lloc_horari: string | null
  lloc_observacions: string | null
  condicions: string | null
  albara_numero: string | null
  albara_estat: string | null
}

export async function carregaOperacio(canalizacionId: string): Promise<Operacio | null> {
  const { data, error } = await supabase.rpc('operacio_detall', { p_canalizacion: canalizacionId })
  if (error) { console.warn('operacio_detall:', error.message); return null }
  const fila = (data as Operacio[] | null)?.[0]
  return fila ?? null
}

/** «No m'interessa» desde «Ofertes per a tu». */
export async function declinaOferta(respostaId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('declinar_oferta', { p_resposta: respostaId })
  return error ? { ok: false, error: error.message } : { ok: true }
}
