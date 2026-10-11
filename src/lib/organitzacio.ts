// La ficha de la organización: el catálogo de actividades, las personas de contacto y el
// otro papel (fase 7 de la revisión del 08-10-2026). Mismo contrato que el resto de `lib/`:
// nunca lanza.

import { supabase } from './supabase'

export interface TipusActivitat { codi: string; nom_ca: string; nom_es: string; aplica: 'productor' | 'entidad' | 'ambdos'; ordre: number }

let catalegActivitats: Promise<TipusActivitat[]> | null = null

/** El catálogo, una vez por sesión. Si falla, la próxima llamada lo vuelve a pedir. */
export function carregaTipusActivitat(): Promise<TipusActivitat[]> {
  if (!catalegActivitats) {
    catalegActivitats = (async () => {
      const { data, error } = await supabase.from('tipus_activitat').select('codi, nom_ca, nom_es, aplica, ordre').order('ordre')
      if (error) { catalegActivitats = null; return [] }
      return (data ?? []) as TipusActivitat[]
    })()
  }
  return catalegActivitats
}

/** Las que aplican a un papel. */
export function activitatsPerPaper(cat: readonly TipusActivitat[], paper: 'productor' | 'entidad'): TipusActivitat[] {
  return cat.filter((a) => a.aplica === paper || a.aplica === 'ambdos')
}

export const TIPUS_CONTACTE = ['general', 'administratiu', 'recollides', 'altres'] as const
export type TipusContacte = typeof TIPUS_CONTACTE[number]

export interface Contacte {
  id: string
  organizacion_id: string
  nom: string
  carrec: string | null
  telefon: string | null
  email: string | null
  tipus: TipusContacte
  es_principal: boolean
}

export async function carregaContactes(org: string): Promise<{ ok: true; data: Contacte[] } | { ok: false; missatge: string }> {
  const { data, error } = await supabase.from('organizacion_contactos')
    .select('id, organizacion_id, nom, carrec, telefon, email, tipus, es_principal')
    .eq('organizacion_id', org).order('created_at')
  if (error) return { ok: false, missatge: error.message }
  return { ok: true, data: (data ?? []) as Contacte[] }
}

export async function desaContacte(id: string | null, org: string, dades: Partial<Contacte>): Promise<{ ok: boolean; missatge?: string }> {
  const { error } = await supabase.rpc('desar_contacte_org', { p_id: id, p_organizacion: org, p_dades: dades })
  return error ? { ok: false, missatge: error.message } : { ok: true }
}

export async function esborraContacte(id: string): Promise<{ ok: boolean; missatge?: string }> {
  const { error } = await supabase.rpc('esborrar_contacte_org', { p_id: id })
  return error ? { ok: false, missatge: error.message } : { ok: true }
}

/** Estrenar el otro papel: ficha hermana y membresía pendiente de validar por el equipo. */
export async function afegeixPaper(tipusActual: 'productor' | 'entidad', id: string): Promise<{ ok: boolean; missatge?: string }> {
  const { error } = await supabase.rpc('afegir_paper_organitzacio', { p_tipo_actual: tipusActual, p_id_actual: id })
  return error ? { ok: false, missatge: error.message } : { ok: true }
}
