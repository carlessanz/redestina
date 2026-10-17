// La ficha de una operación (fase 2 de la revisión del cliente del 08-10-2026): lo que cada
// parte necesita saber de una canalización ya asignada —qué, cuánto, de quién o para quién,
// dónde y cuándo—. La compone `operacio_detall()` en la base, que solo la da a las partes y
// al equipo. Nunca lanza.

import { supabase } from './supabase'
import type { ResultatRecollida } from './registreRecollida'

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
  /** 17-10-2026: el receptor puede registrar la recogida ahora (la misma regla que la base). */
  pot_registrar: boolean | null
  /** Cuándo se recogió de verdad, según quien la registró. */
  recollida_real_at: string | null
  /** Cuándo la registró la entidad desde su panel. */
  recollida_registrada_at: string | null
  /** La diferencia declarada (menys/més) con su motivo, mientras el equipo la revisa. */
  incidencia_recollida: IncidenciaRecollida | null
  rec_numero: string | null
  rec_estat: string | null
}

export interface IncidenciaRecollida {
  resultat: 'menys' | 'mes'
  kg_assignats: number | null
  kg_reals: number
  descripcion: string | null
}

export async function carregaOperacio(canalizacionId: string): Promise<Operacio | null> {
  const { data, error } = await supabase.rpc('operacio_detall', { p_canalizacion: canalizacionId })
  if (error) { console.warn('operacio_detall:', error.message); return null }
  const fila = (data as Operacio[] | null)?.[0]
  return fila ?? null
}

/** Lo que devuelve `registrar_recollida()`. */
export interface ResultatRegistreRecollida {
  albara_id: string
  albara: string | null
  tipus: 'ENT' | 'OPE'
  estat: string
  rec: { id: string; numero: string | null; estat: string } | null
  kg_reals: number
  kg_assignats: number | null
  /** Todo cuadra y se ha cerrado: los dos albaranes ya son definitivos. */
  conciliat: boolean
  /** Hay una diferencia declarada: la revisa el equipo antes de cerrar. */
  en_revisio: boolean
  /** La oferta se repartió entre varias entidades y el REC espera a las demás. */
  esperant_altres: boolean
}

export type ResultatCrida<T> = { ok: true; data: T } | { ok: false; missatge: string; codi: string | null }

/**
 * «Registra la recollida» (17-10-2026): la entidad receptora dice cuántos kilos se llevó.
 * Con eso la base genera los dos albaranes —ofertant → Espigoladors y Espigoladors →
 * receptor— por los kilos reales, en una sola transacción. Nunca lanza.
 */
export async function registraRecollida(camps: {
  canalitzacio: string
  resultat: ResultatRecollida
  kgReals: number | null
  data: string | null
  observacions: string | null
}): Promise<ResultatCrida<ResultatRegistreRecollida>> {
  try {
    const { data, error } = await supabase.rpc('registrar_recollida', {
      p_canalizacion: camps.canalitzacio,
      p_resultat: camps.resultat,
      p_kg_reals: camps.kgReals,
      p_data: camps.data,
      p_observacions: camps.observacions,
    })
    if (error) return { ok: false, missatge: error.message || 'c.error', codi: error.code ?? null }
    return { ok: true, data: data as ResultatRegistreRecollida }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}

/** «No m'interessa» desde «Ofertes per a tu». */
export async function declinaOferta(respostaId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('declinar_oferta', { p_resposta: respostaId })
  return error ? { ok: false, error: error.message } : { ok: true }
}
