// La ficha de una operación (fase 2 de la revisión del cliente del 08-10-2026): lo que cada
// parte necesita saber de una canalización ya asignada —qué, cuánto, de quién o para quién,
// dónde y cuándo—. La compone `operacio_detall()` en la base, que solo la da a las partes y
// al equipo. Nunca lanza.

import { supabase } from './supabase'
import { estatValidacio } from './registreRecollida'
import type { DatesValidacio, ResultatRecollida } from './registreRecollida'

// `registrada` (17-10-2026): el receptor ha declarado los kilos y espera la validación de un
// admin; todavía no hay albaranes.
export type EstatRecollida = 'pendent' | 'programada' | 'registrada' | 'entregada' | 'confirmada' | 'conciliada'

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
  /** 17-10-2026: el receptor puede registrar la recogida ahora (la misma regla que la base).
   *  También cuando un admin le devolvió el registro. */
  pot_registrar: boolean | null
  /** Cuándo se recogió de verdad, según quien la registró. */
  recollida_real_at: string | null
  /** Cuándo la registró la entidad desde su panel. */
  recollida_registrada_at: string | null
  /** La diferencia declarada (menys/més) con su motivo, mientras el equipo la revisa. */
  incidencia_recollida: IncidenciaRecollida | null
  rec_numero: string | null
  rec_estat: string | null
  // --- 17-10-2026: el equipo valida el registro antes de generar los albaranes ---
  // ⚠️ Opcionales: llegan al final del `returns table` de `operacio_detall()`, y una base sin
  //    la migración no los trae. Ausentes = como antes.
  /** Lo que declaró el receptor (los kg reales, según él). */
  kg_declarats?: number | null
  resultat_recollida?: ResultatRecollida | null
  /** Cuándo la validó un admin: desde ese momento hay albaranes. */
  recollida_validada_at?: string | null
  /** Cuándo un admin la devolvió al receptor, y por qué. */
  recollida_retornada_at?: string | null
  motiu_retorn?: string | null
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

/**
 * Lo que devuelve `registrar_recollida()` desde el 17-10-2026: el registro, y nada más. Los
 * albaranes los genera la validación del equipo (`validar_recollida()`).
 */
export interface ResultatRegistreRecollida {
  estat: 'pendent_validacio' | string
  kg_declarats: number | null
  kg_assignats: number | null
  resultat: ResultatRecollida | null
}

/** Lo que devuelve `validar_recollida()`. Se lee con tolerancia: cualquier clave puede faltar. */
export interface ResultatValidaRecollida {
  albara_id?: string | null
  /** El número del albarán de salida (ENT u OPE). */
  albara?: string | null
  tipus?: 'ENT' | 'OPE' | string | null
  estat?: string | null
  rec?: { id?: string | null; numero?: string | null; estat?: string | null } | null
  kg_reals?: number | null
  kg_assignats?: number | null
  kg_declarats?: number | null
  /** Todo cuadra y se ha cerrado: los albaranes ya son definitivos. */
  conciliat?: boolean | null
  /** La oferta se repartió entre varias entidades y el REC espera a las demás. */
  esperant_altres?: boolean | null
}

export type ResultatCrida<T> = { ok: true; data: T } | { ok: false; missatge: string; codi: string | null }

/**
 * «Registra la recollida» (17-10-2026): la entidad receptora dice cuántos kilos se llevó.
 * Queda pendiente de que un admin lo valide: registrar NO emite ningún albarán ni gasta
 * ningún número. Nunca lanza.
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

/**
 * «Valida i genera els albarans» (admin, desde Aprovacions). `kg` null = lo declarado; con
 * otro valor, o con diferencia frente a lo asignado, la base exige `motiu`. Al validar se
 * emiten el albarán de salida y el de recepción, con número legal, y se concilian. Nunca lanza.
 */
export async function validaRecollida(camps: {
  canalitzacio: string
  kg: number | null
  motiu: string | null
}): Promise<ResultatCrida<ResultatValidaRecollida>> {
  try {
    const { data, error } = await supabase.rpc('validar_recollida', {
      p_canalizacion: camps.canalitzacio,
      p_kg: camps.kg,
      p_motiu: camps.motiu,
    })
    if (error) return { ok: false, missatge: error.message || 'c.error', codi: error.code ?? null }
    const d = (data && typeof data === 'object' ? data : {}) as ResultatValidaRecollida
    return { ok: true, data: d }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}

/** «Retorna al receptor» (admin): el registro vuelve a la entidad con un motivo. Nunca lanza. */
export async function retornaRecollida(camps: {
  canalitzacio: string
  motiu: string
}): Promise<ResultatCrida<null>> {
  try {
    const { error } = await supabase.rpc('retornar_recollida', {
      p_canalizacion: camps.canalitzacio,
      p_motiu: camps.motiu,
    })
    if (error) return { ok: false, missatge: error.message || 'c.error', codi: error.code ?? null }
    return { ok: true, data: null }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}

/**
 * Cuántas recogidas de cada oferta ha registrado el receptor y esperan la validación del
 * equipo (17-10-2026). UNA consulta para todas las ofertas (§12.5). Nunca lanza: si falla
 * —p. ej. la migración todavía no está aplicada— devuelve {} y el proceso se cuenta como antes.
 */
export async function carregaRecollidesPerValidar(excedentIds: string[]): Promise<Record<string, number>> {
  if (excedentIds.length === 0) return {}
  try {
    const { data, error } = await supabase
      .from('canalizaciones')
      .select('excedente_id, recollida_registrada_at, recollida_validada_at, recollida_retornada_at')
      .in('excedente_id', excedentIds)
      .neq('estado', 'anulada')
      .not('recollida_registrada_at', 'is', null)
      .is('recollida_validada_at', null)
    if (error) return {}
    const per: Record<string, number> = {}
    for (const c of ((data as unknown as (DatesValidacio & { excedente_id: string | null })[] | null) ?? [])) {
      if (!c.excedente_id || estatValidacio(c) !== 'pendent_validacio') continue
      per[c.excedente_id] = (per[c.excedente_id] ?? 0) + 1
    }
    return per
  } catch {
    return {}
  }
}

/** «No m'interessa» desde «Ofertes per a tu». */
export async function declinaOferta(respostaId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('declinar_oferta', { p_resposta: respostaId })
  return error ? { ok: false, error: error.message } : { ok: true }
}
