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
  | 'oferta_sense_desti' | 'recollida_canviada' | 'kg_assignats_canviats' | 'recollida_confirmada'
  | 'oferta_modificada' | 'oferta_enviada' | 'certificat_per_revisar'
  // 20270426100000: pasada la hora de recogida, se pide al receptor que registre los kilos.
  | 'recollida_per_registrar'

export interface Avis {
  id: string
  destinatari_tipo: 'productor' | 'entidad'
  destinatari_id: string
  tipus: TipusAvis
  objecte_tipo: 'excedente' | 'oferta_resposta' | 'canalizacion' | 'cierre_donante' | 'cierre_periodo'
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
    // Los certificados por revisar no son de ninguna oferta: solo suenan en la campana.
    if (a.objecte_tipo === 'cierre_donante' || a.objecte_tipo === 'cierre_periodo') continue
    if (a.destinatari_tipo === 'productor') ofertes++
    else interessos++
  }
  return { ofertes, interessos }
}

/** A dónde lleva un aviso en la aplicación. */
export function rutaAvis(a: Pick<Avis, 'objecte_tipo' | 'objecte_id'>): string {
  // `oferta_resposta` y `canalizacion` (una entrega sin interés previo, fase 2 del 08-10-2026)
  // son del receptor: van a «Els meus interessos».
  // Un certificado por revisar (fase 4) va a «Els meus certificats» del productor.
  if (a.objecte_tipo === 'cierre_donante' || a.objecte_tipo === 'cierre_periodo') return '/productor/documents'
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
    // Lo asignado, para el aviso de recogida confirmada con diferencia (17-10-2026).
    kg_assig: fmt(p.kg_assignats),
    kg_sol: fmt(p.kg_sol),
    kg_apr: fmt(p.kg_apr),
    entitat: String(p.entitat ?? ''),
    productor: String(p.productor ?? ''),
    motiu: String(p.motiu ?? ''),
    kg_abans: fmt(p.kg_abans),
    // «10/10 · 10:00» en hora de Madrid, como en el correo (`_shared/textAvis.ts`).
    quan: quanAvis(p.recollida_at),
    exercici: String(p.exercici ?? ''),
    valor: new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR' }).format(Number(p.valor ?? 0)),
  }
}

/** ¿La aprobación fue por menos de lo pedido? Elige la variante del texto. */
export function esParcial(a: Pick<Avis, 'tipus' | 'params'>): boolean {
  return a.tipus === 'interes_aprovat'
    && a.params?.kg_sol != null && a.params?.kg_apr != null
    && Number(a.params.kg_sol) !== Number(a.params.kg_apr)
}

/**
 * La clave del texto de un aviso en el panel: `avis.t_<tipus>`, o su variante cuando los
 * parámetros cambian lo que hay que decir (aprobado por menos de lo pedido; recogida
 * confirmada con una diferencia de kilos, que el equipo revisa).
 */
export function clauAvis(a: Pick<Avis, 'tipus' | 'params'>): string {
  if (esParcial(a)) return 'avis.t_interes_aprovat_parcial'
  if (a.tipus === 'recollida_confirmada' && a.params?.diferencia === true) return 'avis.t_recollida_confirmada_dif'
  return `avis.t_${a.tipus}`
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
  /** Fase 2 de la revisión del 08-10-2026: la recogida, para la lista y la ficha. */
  data_hora_recollida: string | null
  kg_aprovats: number | null
  estat_recollida: 'pendent' | 'programada' | 'entregada' | 'confirmada' | 'conciliada' | null
}

export async function carregaContraparts(): Promise<Contrapart[]> {
  const { data, error } = await supabase.rpc('contraparts_canalitzacions')
  if (error) return []
  return (data ?? []) as Contrapart[]
}

/** La fecha y hora de una recogida para los avisos del panel: «10/10 · 10:00» (Madrid). */
export function quanAvis(v: unknown): string {
  if (v == null || v === '') return '—'
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return '—'
  const dia = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit' }).format(d)
  const hora = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(d)
  return `${dia} · ${hora}`
}
