// Los avisos de las organizaciones de la cuenta (05-10-2026, rebanada 2).
//
// Mismo molde que `pendentsEquip.ts`: un store de módulo (`useSyncExternalStore`) que se
// refresca en cada cambio de ruta desde `AppShell` y tras marcar como leídos. Lo leen la
// campana del menú de la persona y los badges de «Les meves ofertes» y «Els meus interessos».
//
// ⚠️ SE FILTRA POR LAS ORGANIZACIONES DE LA CUENTA, no solo por la RLS: el equipo puede
//    leer TODOS los avisos (`es_intern()`), y sin el filtro una cuenta del equipo con panel
//    de productor vería en su campana los de todo el mundo.

import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

export type TipusAvis =
  | 'oferta_validada' | 'oferta_rebutjada' | 'sortida_trobada' | 'interes_aprovat' | 'interes_rebutjat'

export interface Avis {
  id: string
  destinatari_tipo: 'productor' | 'entidad'
  destinatari_id: string
  tipus: TipusAvis
  objecte_tipo: 'excedente' | 'oferta_resposta'
  objecte_id: string
  params: Record<string, unknown>
  llegit_at: string | null
  created_at: string
}

let avisos: Avis[] = []
const escoltes = new Set<() => void>()
const avisa = () => escoltes.forEach((f) => f())
const subscriu = (f: () => void) => { escoltes.add(f); return () => { escoltes.delete(f) } }
const llegeix = () => avisos

/** Carga los últimos 30 de estas fichas. Si falla, conserva los de antes. */
export async function carregaAvisos(fitxes: string[]): Promise<void> {
  if (fitxes.length === 0) { avisos = []; avisa(); return }
  const { data, error } = await supabase
    .from('avisos')
    .select('id, destinatari_tipo, destinatari_id, tipus, objecte_tipo, objecte_id, params, llegit_at, created_at')
    .in('destinatari_id', fitxes)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return
  avisos = (data ?? []) as Avis[]
  avisa()
}

export function useAvisos(): Avis[] {
  return useSyncExternalStore(subscriu, llegeix, () => [] as Avis[])
}

/** Marca como leídos (los míos, lo impone la RPC). Sin ids, todos los de ese tipo de objeto. */
export async function marcaLlegits(args: { ids?: string[]; objecteTipo?: Avis['objecte_tipo'] }): Promise<void> {
  const { error } = await supabase.rpc('marcar_avisos_llegits', {
    p_ids: args.ids ?? null, p_objecte_tipo: args.objecteTipo ?? null,
  })
  if (error) return
  const ara = new Date().toISOString()
  avisos = avisos.map((a) =>
    a.llegit_at == null
      && (!args.ids || args.ids.includes(a.id))
      && (!args.objecteTipo || a.objecte_tipo === args.objecteTipo)
      ? { ...a, llegit_at: ara } : a)
  avisa()
}

/** Cuántos sin leer por panel: los de productor van a «Les meves ofertes», los de entidad a «Els meus interessos». */
export function noLlegitsPerPanell(llista: Avis[]): { ofertes: number; interessos: number } {
  let ofertes = 0
  let interessos = 0
  for (const a of llista) {
    if (a.llegit_at) continue
    if (a.destinatari_tipo === 'productor') ofertes++
    else interessos++
  }
  return { ofertes, interessos }
}

/** A dónde lleva un aviso en la aplicación. */
export function rutaAvis(a: Pick<Avis, 'objecte_tipo' | 'objecte_id'>): string {
  return a.objecte_tipo === 'excedente' ? `/productor/ofertes/${a.objecte_id}` : '/receptor/interessos'
}

/** Los parámetros, con los kg ya formateados, para `t('avis.t_<tipus>', …)`. */
export function varsAvis(a: Pick<Avis, 'params'>): Record<string, string | number> {
  const fmt = (v: unknown) => new Intl.NumberFormat('ca-ES', { maximumFractionDigits: 2 }).format(Number(v ?? 0))
  const p = a.params ?? {}
  return {
    producte: String(p.producte ?? ''),
    ref: String(p.ref ?? ''),
    kg: fmt(p.kg),
    kg_sol: fmt(p.kg_sol),
    kg_apr: fmt(p.kg_apr),
    entitat: String(p.entitat ?? ''),
    productor: String(p.productor ?? ''),
    motiu: String(p.motiu ?? ''),
  }
}

/** ¿La aprobación fue por menos de lo pedido? Elige la variante del texto. */
export function esParcial(a: Pick<Avis, 'tipus' | 'params'>): boolean {
  return a.tipus === 'interes_aprovat'
    && a.params?.kg_sol != null && a.params?.kg_apr != null
    && Number(a.params.kg_sol) !== Number(a.params.kg_apr)
}

/** Las ofertas nuevas del Mercat desde la última visita (`perfiles.mercat_vist_at`). */
export async function comptaMercatNou(userId: string): Promise<number> {
  const { data: perfil } = await supabase.from('perfiles').select('mercat_vist_at').eq('id', userId).maybeSingle()
  const vist = (perfil as { mercat_vist_at: string | null } | null)?.mercat_vist_at ?? null
  let q = supabase.from('excedentes').select('id', { count: 'exact', head: true }).in('estado', ['publicada', 'parcial'])
  if (vist) q = q.or(`created_at.gt.${vist},validada_at.gt.${vist}`)
  const { count } = await q
  return count ?? 0
}

export async function llegeixMercatVist(userId: string): Promise<string | null> {
  const { data } = await supabase.from('perfiles').select('mercat_vist_at').eq('id', userId).maybeSingle()
  return (data as { mercat_vist_at: string | null } | null)?.mercat_vist_at ?? null
}

export async function marcaMercatVist(): Promise<void> {
  await supabase.rpc('marcar_mercat_vist')
}

/** Con quién has quedado, una vez aprobado (D1). */
export interface Contrapart {
  canalizacion_id: string
  excedente_id: string
  resposta_id: string | null
  rol: 'productor' | 'entidad'
  contrapart: string | null
  municipi: string | null
  gmaps_url: string | null
  kg: number | null
  modalitat: string | null
}

export async function carregaContraparts(): Promise<Contrapart[]> {
  const { data, error } = await supabase.rpc('contraparts_canalitzacions')
  if (error) return []
  return (data ?? []) as Contrapart[]
}
