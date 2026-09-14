// Cliente de las operaciones de los paneles externos.
//
// El formulario de alta NO lleva los campos escritos: los pide a la Edge Function
// `crear-oferta`, que los sirve desde el mismo descriptor que usa el bot de WhatsApp
// (`_shared/camposOferta.ts`). El resto son RPC con `security definer`, que es donde
// viven las validaciones (§4bis).

import { supabase, supabaseUrl } from './supabase'
import type { Canalizacion, Excedente, OfertaRespuesta } from '../types'

export type TipoCampo = 'familia' | 'producte' | 'text' | 'numero' | 'opcions' | 'ubicacio' | 'causa'

/** Los cinco bloques del cuestionario, en el orden en que se pintan. */
export type SeccioOferta = 'producte' | 'quantitat' | 'recollida' | 'modalitat' | 'causa'

export interface BlocOferta {
  clau: SeccioOferta
  titol: string
  descripcio?: string
}

export interface OpcioOferta {
  id: string
  titulo: string
  /** Una línea: qué implica elegir esta opción. La traen las tres modalidades. */
  descripcion?: string
}

export interface CampoOferta {
  clave: string
  tipo: TipoCampo
  etiqueta: string
  ayuda?: string
  /**
   * En qué bloque va. **Opcional en el cliente aunque el servidor la dé siempre**: este
   * fichero se despliega antes que la Edge Function (§11, de abajo arriba), así que hay una
   * ventana en la que la respuesta todavía es la vieja. Sin `seccion` el formulario pinta
   * un solo bloque sin título, que es lo que había antes.
   */
  seccion?: SeccioOferta
  obligatorio: boolean
  opciones?: OpcioOferta[]
  condicion?: { campo: string; en: string[] }
}

export interface CatalogosOferta {
  familias: string[]
  productos: { nombre: string; familia: string | null }[]
  causas: { codigo: string; nombre: string | null }[]
  ubicaciones: { id: string; alias: string | null; municipio: string | null }[]
}

export interface Resultat<T> {
  ok: boolean
  data?: T
  error?: string
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/** Descriptor de los 14 pasos + catálogos. Nunca lanza. */
export async function carregaCamps(
  productorId: string,
): Promise<Resultat<{
  campos: CampoOferta[]
  /** Igual que `CampoOferta.seccion`: puede no llegar todavía. */
  secciones?: BlocOferta[]
  catalogos: CatalogosOferta
}>> {
  try {
    const t = await token()
    if (!t) return { ok: false, error: 'unauthorized' }
    const res = await fetch(
      `${supabaseUrl}/functions/v1/crear-oferta/campos?productor=${encodeURIComponent(productorId)}`,
      { headers: { Authorization: `Bearer ${t}` } },
    )
    const body = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: (body as { error?: string })?.error ?? 'error' }
    return { ok: true, data: body }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Crea la oferta. Devuelve el identificador legible (E-AAMMDD-XXX-YYY-N). */
/**
 * Qué ha pasado con el correo de confirmación de la oferta. `omes` = la ficha no tiene
 * correo o el modo test lo bloquea; `simulat` = `RESEND_ENVIO_REAL` apagado. Ninguno hace
 * fallar el alta: la oferta ya está creada y su referencia va en la misma respuesta.
 */
export type ConfirmacioEmail = 'enviat' | 'simulat' | 'omes' | 'error'

export async function creaOferta(
  productorId: string,
  datos: Record<string, unknown>,
): Promise<Resultat<{ id: string; id_excedente: string; confirmacio_email?: ConfirmacioEmail }>> {
  try {
    const t = await token()
    if (!t) return { ok: false, error: 'unauthorized' }
    const res = await fetch(`${supabaseUrl}/functions/v1/crear-oferta`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productor_id: productorId, datos }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: (body as { error?: string })?.error ?? 'error' }
    return { ok: true, data: body }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** El productor cancela su propia oferta (RPC con comprobación de pertenencia). */
export async function cancelaOferta(excedenteId: string, motiu: string): Promise<Resultat<Excedente>> {
  const { data, error } = await supabase.rpc('cancelar_meva_oferta', {
    p_excedente: excedenteId,
    p_motiu: motiu,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data as Excedente }
}

/** El receptor muestra interés: cae en la misma cola de aprobación que WhatsApp. */
export async function manifestaInteres(args: {
  excedenteId: string
  entidadId: string
  kg: number
  preu?: number | null
  caixes?: number | null
}): Promise<Resultat<OfertaRespuesta>> {
  const { data, error } = await supabase.rpc('manifestar_interes', {
    p_excedente: args.excedenteId,
    p_entidad: args.entidadId,
    p_kg: args.kg,
    p_preu: args.preu ?? null,
    p_caixes: args.caixes ?? null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data as OfertaRespuesta }
}

/** Kg ya canalizados por oferta, para pintar el progreso. */
export async function kgPerOferta(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {}
  const { data } = await supabase
    .from('canalizaciones').select('excedente_id, kg_confirmados').in('excedente_id', ids)
  const acc: Record<string, number> = {}
  for (const c of (data ?? []) as Pick<Canalizacion, 'excedente_id' | 'kg_confirmados'>[]) {
    if (!c.excedente_id) continue
    acc[c.excedente_id] = (acc[c.excedente_id] ?? 0) + Number(c.kg_confirmados ?? 0)
  }
  return acc
}
