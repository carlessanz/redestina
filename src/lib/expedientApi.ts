// El expediente de prevención (fase 11 de la revisión del 08-10-2026): lectura por `select`
// (la RLS ya dice quién ve qué: el equipo todo, la organización lo suyo) y escritura por RPC
// (ninguna tabla tiene GRANT de escritura). Nunca lanza: devuelve `{ok, …}`.

import { supabase } from './supabase'

export type EstatExpedient = 'obert' | 'en_seguiment' | 'verificat' | 'tancat'

export interface Expedient {
  id: string
  tipo_org: 'productor' | 'entidad'
  productor_id: string | null
  entidad_id: string | null
  nivell: 'basic' | 'personalitzat'
  estat: EstatExpedient
  tecnic_id: string | null
  data_inici: string
  objectius_estrategics: string[]
  context: string | null
  equip: { nom?: string; carrec?: string }[]
  pla_id: string | null
  numero_completo: string | null
  versio_document: number
  exportat_at: string | null
  updated_at: string
  productores?: { name: string | null; empresa: string | null } | null
}

/** Las tablas hijas que se editan con `desar_element_expedient`. */
export type TaulaExpedient =
  | 'pla_visites' | 'pla_processos' | 'pla_quantificacio' | 'pla_objectius'
  | 'pla_accions' | 'pla_seguiments'

export type Element = Record<string, unknown> & { id: string }

export type Resultat<T> = { ok: true; data: T } | { ok: false; missatge: string }

const COLUMNES_EXP =
  'id, tipo_org, productor_id, entidad_id, nivell, estat, tecnic_id, data_inici, objectius_estrategics, context, equip, pla_id, numero_completo, versio_document, exportat_at, updated_at, productores(name, empresa)'

function err(e: unknown): { ok: false; missatge: string } {
  const m = (e as { message?: string } | null)?.message
  return { ok: false, missatge: m || 'c.error' }
}

export async function llistaExpedients(): Promise<Resultat<Expedient[]>> {
  const { data, error } = await supabase.from('expedients_prevencion').select(COLUMNES_EXP)
    .order('updated_at', { ascending: false })
  if (error) return err(error)
  return { ok: true, data: (data ?? []) as unknown as Expedient[] }
}

export async function llegeixExpedient(id: string): Promise<Resultat<Expedient | null>> {
  const { data, error } = await supabase.from('expedients_prevencion').select(COLUMNES_EXP)
    .eq('id', id).maybeSingle()
  if (error) return err(error)
  return { ok: true, data: (data as unknown as Expedient | null) ?? null }
}

/** El expediente (no cerrado o el último) de una organización productora. */
export async function expedientDelProductor(productorId: string): Promise<Resultat<Expedient | null>> {
  const { data, error } = await supabase.from('expedients_prevencion').select(COLUMNES_EXP)
    .eq('productor_id', productorId).order('created_at', { ascending: false }).limit(1)
  if (error) return err(error)
  return { ok: true, data: ((data ?? [])[0] as unknown as Expedient | undefined) ?? null }
}

/** Los elementos de una tabla hija, en un orden que tenga sentido para cada una. */
export async function elements(taula: TaulaExpedient | 'pla_verificacions', expedient: string): Promise<Resultat<Element[]>> {
  const ordre: Record<string, string> = {
    pla_visites: 'data', pla_processos: 'ordre', pla_quantificacio: 'mes', pla_objectius: 'created_at',
    pla_accions: 'created_at', pla_seguiments: 'trimestre', pla_verificacions: 'any',
  }
  const { data, error } = await supabase.from(taula).select('*').eq('expedient_id', expedient)
    .order(ordre[taula] ?? 'created_at', { ascending: true })
  if (error) return err(error)
  return { ok: true, data: (data ?? []) as Element[] }
}

async function rpc<T>(nom: string, args: Record<string, unknown>): Promise<Resultat<T>> {
  try {
    const { data, error } = await supabase.rpc(nom, args)
    if (error) return err(error)
    return { ok: true, data: data as T }
  } catch (e) {
    return err(e)
  }
}

export const obrirExpedient = (productor: string, nivell: 'basic' | 'personalitzat') =>
  rpc<string>('obrir_expedient', { p_tipo_org: 'productor', p_org: productor, p_nivell: nivell })
export const desarExpedient = (id: string, dades: Record<string, unknown>) =>
  rpc<Expedient>('desar_expedient', { p_id: id, p_dades: dades })
export const desarElement = (taula: TaulaExpedient, expedient: string, id: string | null, dades: Record<string, unknown>) =>
  rpc<string>('desar_element_expedient', { p_taula: taula, p_expedient: expedient, p_id: id, p_dades: dades })
export const esborrarElement = (taula: TaulaExpedient, id: string) =>
  rpc<boolean>('esborrar_element_expedient', { p_taula: taula, p_id: id })
export const volcarQuantificacio = (expedient: string, desde: string, hasta: string) =>
  rpc<number>('volcar_quantificacio_redestina', { p_expedient: expedient, p_desde: desde, p_hasta: hasta })
export const verificarExpedient = (id: string, any: number, resum: string, conclusio: string) =>
  rpc<string>('verificar_expedient', { p_id: id, p_any: any, p_resum: resum, p_conclusio: conclusio })
export const tancarExpedient = (id: string) => rpc<null>('tancar_expedient', { p_id: id })
export const exportarExpedient = (id: string) =>
  rpc<{ document: string; numero: string; versio: number }>('exportar_expedient', { p_id: id })

export interface DocExpedient { id: string; numero_completo: string; version: number; vigente: boolean; estado: string; emitido_at: string }

/** Los PDF exportados del expediente, del más reciente al más antiguo. */
export async function documentsExpedient(id: string): Promise<Resultat<DocExpedient[]>> {
  const { data, error } = await supabase.from('documentos')
    .select('id, numero_completo, version, vigente, estado, emitido_at')
    .eq('objeto_tipo', 'expedient').eq('objeto_id', id).order('version', { ascending: false })
  if (error) return err(error)
  return { ok: true, data: (data ?? []) as DocExpedient[] }
}

export interface Evidencia { id: string; tipo: string; numero: string | null; fecha: string | null; mime: string | null; created_at: string }

export async function evidenciesExpedient(id: string): Promise<Resultat<Evidencia[]>> {
  const { data, error } = await supabase.from('documentos_externos')
    .select('id, tipo, numero, fecha, mime, created_at')
    .eq('objeto_tipo', 'expedient').eq('objeto_id', id).order('created_at', { ascending: false })
  if (error) return err(error)
  return { ok: true, data: (data ?? []) as Evidencia[] }
}
