// Cliente de las RPC multiproducto (proceso 3.3, fase 6b-6c, 25-11-2026). Mismo contrato que
// `operacio.ts`, `canalitzacio.ts` y `aprovarResposta.ts`: **nunca lanza**. Devuelve `ok` y,
// cuando no, el mensaje de la base, su SQLSTATE y QUÉ línea falló (`detall`, leído del
// `details` JSON que ponen las RPC: `{"linia": n, "excedente_id"|"resposta_id"|"canalizacion_id": …}`).
//
// Las reglas no viven aquí ni en la pantalla: cada línea pasa por la puerta de siempre dentro de
// la RPC, en una sola transacción (todo o nada). Contratos en `context/04bis` «Multiproducto».

import { supabase } from './supabase'
import { clauErrorMultiple, llegeixDetall, type DetallLinia } from './sollicitudMultiproducte'
import { clauErrorInteres } from './ofertes'
import { clauErrorAssistit, clauErrorBase, clauErrorValidacio } from './registreRecollida'
import { textError } from './textError'
import type { OfertaDisponibilitat } from '../types'

export type ResultatMultiple<T> =
  | { ok: true; data: T }
  | { ok: false; missatge: string; codi: string | null; detall: DetallLinia | null }

async function crida<T>(nom: string, args: Record<string, unknown>): Promise<ResultatMultiple<T>> {
  try {
    const { data, error } = await supabase.rpc(nom, args)
    if (error) {
      return {
        ok: false, missatge: error.message || 'c.error', codi: error.code ?? null,
        detall: llegeixDetall(error.details),
      }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null, detall: null }
  }
}

/** Las ofertas de una disponibilidad que esta cuenta ve, con `kg_lliures` y `modalitats_meves`. */
export function ofertesDisponibilitat(disponibilitatId: string): Promise<ResultatMultiple<OfertaDisponibilitat[]>> {
  return crida<OfertaDisponibilitat[]>('ofertes_disponibilitat', { p_disponibilitat: disponibilitatId })
}

export interface RespostaSollicitud {
  sollicitud_id: string
  estat?: string
  recollida_at?: string | null
  avisos?: number
  linies?: { resposta_id: string; excedente_id: string; kg: number; modalitat: string | null; canalizacion_id?: string }[]
}

/** La entidad pide varios productos con UNA fecha (`manifestar_interes_multiple`). */
export function manifestaInteresMultiple(a: {
  disponibilitat: string
  linies: Record<string, unknown>[]
  recollida: string
  entitat: string | null
}): Promise<ResultatMultiple<RespostaSollicitud>> {
  return crida('manifestar_interes_multiple', {
    p_disponibilitat: a.disponibilitat, p_linies: a.linies, p_recollida_at: a.recollida,
    p_entidad: a.entitat,
  })
}

/** Nivel 1: el equipo asigna varios productos a una entidad en un acto (`assignar_directe_multiple`). */
export function assignaDirecteMultiple(a: {
  disponibilitat: string
  entitat: string
  linies: Record<string, unknown>[]
  recollida: string | null
  motiu?: string | null
}): Promise<ResultatMultiple<RespostaSollicitud>> {
  return crida('assignar_directe_multiple', {
    p_disponibilitat: a.disponibilitat, p_entidad: a.entitat, p_linies: a.linies,
    p_recollida_at: a.recollida, p_motiu: a.motiu ?? null,
  })
}

export interface RespostaResolucio {
  sollicitud_id: string
  estat: string
  recollida_at: string | null
  avisos: number
  aprovades: { resposta_id: string; canalizacion_id: string; excedente_id: string; kg: number; modalitat: string }[]
  rebutjades: { resposta_id: string; excedente_id: string }[]
}

/** Aprueba y rechaza TODAS las líneas pendientes de una solicitud en un acto (`resoldre_sollicitud`). */
export function resolSollicitud(a: {
  sollicitud: string
  linies: Record<string, unknown>[]
  recollida: string | null
  motiu?: string | null
}): Promise<ResultatMultiple<RespostaResolucio>> {
  return crida('resoldre_sollicitud', {
    p_sollicitud: a.sollicitud, p_linies: a.linies, p_recollida_at: a.recollida, p_motiu: a.motiu ?? null,
  })
}

export interface RespostaRecollidaMultiple {
  sollicitud_id: string
  registrada_per: 'equip' | 'entitat_receptora'
  linies: { canalizacion_id: string; resultat: string; resposta: unknown }[]
}

/** La recogida real de una solicitud (`registrar_recollida_multiple`): la entidad declara; el equipo registra y valida. */
export function registraRecollidaMultiple(a: {
  sollicitud: string
  linies: Record<string, unknown>[]
  quan: string | null
  motiu?: string | null
}): Promise<ResultatMultiple<RespostaRecollidaMultiple>> {
  return crida('registrar_recollida_multiple', {
    p_sollicitud: a.sollicitud, p_linies: a.linies, p_quan: a.quan, p_motiu: a.motiu ?? null,
  })
}

/** «Valida totes» (`validar_recollides_sollicitud`). */
export function validaRecollidesSollicitud(a: {
  sollicitud: string
  motiu: string | null
}): Promise<ResultatMultiple<{ sollicitud_id: string; validades: number }>> {
  return crida('validar_recollides_sollicitud', { p_sollicitud: a.sollicitud, p_motiu: a.motiu })
}

type Traductor = (clau: string, params?: Record<string, string | number>) => string

/**
 * El texto de un rechazo de las RPC multiproducto. Primero los códigos propios
 * (`sollicitud_pendent`, `falten_linies`…); después, los de la puerta de cada línea con la
 * traducción de siempre según qué se estaba haciendo (`interes`: `comprova_interes`;
 * `recollida`: el registro, de la entidad o asistido; `validacio`: `validar_recollida`); al final,
 * `textError`.
 */
export function textErrorMultiple(
  t: Traductor,
  r: { missatge: string; codi: string | null },
  context: 'interes' | 'resolucio' | 'recollida' | 'validacio',
): string {
  const propia = clauErrorMultiple(r.missatge, r.codi)
  if (propia && propia !== 'smp.err_permis') return t(propia)
  if (context === 'interes' || context === 'resolucio') {
    // `textError` conoce los de `aprova_resposta_intern`/`assignar_directe` (`cal_preu_acordat`,
    // `sense_conveni`, `cal_modalitat`…); lo demás es de `comprova_interes()`.
    if (/^(cal_preu_acordat|cal_preu_acceptat|preu_invalid|ja_assignada|hora_passada)/.test(r.missatge)) return textError(t, r)
    const e = clauErrorInteres(r.missatge)
    if (e.clau !== 'c.error') return t(e.clau, e.vars)
  }
  if (context === 'recollida') {
    const c = clauErrorAssistit(r.missatge, null) ?? clauErrorBase(r.missatge, null)
    if (c) return t(c)
  }
  if (context === 'validacio') {
    const c = clauErrorValidacio(r.missatge, null)
    if (c) return t(c)
  }
  if (propia) return t(propia)
  return textError(t, r)
}
