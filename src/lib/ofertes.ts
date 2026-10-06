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
  /** En castellano (28-09-2026). Un servidor anterior no los manda: se cae al catalán. */
  titol_es?: string
  descripcio_es?: string
}

export interface OpcioOferta {
  id: string
  titulo: string
  /** Una línea: qué implica elegir esta opción. La traen las tres modalidades. */
  descripcion?: string
  titulo_es?: string
  descripcion_es?: string
}

export interface CampoOferta {
  clave: string
  tipo: TipoCampo
  etiqueta: string
  ayuda?: string
  /** Los mismos textos en castellano; los sirve `crear-oferta` desde `camposOferta.ts`. */
  etiqueta_es?: string
  ayuda_es?: string
  /**
   * En qué bloque va. **Opcional en el cliente aunque el servidor la dé siempre**: este
   * fichero se despliega antes que la Edge Function (§11, de abajo arriba), así que hay una
   * ventana en la que la respuesta todavía es la vieja. Sin `seccion` el formulario pinta
   * un solo bloque sin título, que es lo que había antes.
   */
  seccion?: SeccioOferta
  obligatorio: boolean
  opciones?: OpcioOferta[]
  /** Una lista es un «o»: basta con que se cumpla una (desde el 27-09-2026). */
  condicion?: CondicioCamp | CondicioCamp[]
  /**
   * La lista completa cuando la condición es compuesta. `crear-oferta` la sirve aparte y deja
   * en `condicion` solo la primera, para no romper el panel anterior durante la publicación.
   */
  condicions?: CondicioCamp[]
  /** Se pueden marcar varias opciones (la modalidad, desde el 06-10-2026). */
  multiple?: boolean
  /** `franja`: dos horas en cuartos, guardadas como «HH:MM-HH:MM». */
  widget?: 'franja'
}

export interface CondicioCamp { campo: string; en: string[] }

export { aplicaCamp, partFranja, respostaBuida, semblaQuantitat, valorsDe } from './ofertaPura'





/**
 * Da de alta un lugar de recogida del productor (campo, almacén…) desde el alta de oferta.
 * Escribe directo en la tabla: la RLS deja al productor gestionar SUS ubicaciones y al
 * equipo las de cualquiera (`ubicaciones: gestio intern o propia`), que es lo mismo que
 * hace falta aquí. Devuelve la fila para añadirla al desplegable sin recargar.
 */
export async function creaUbicacio(args: {
  productorId: string
  alias: string
  gmapsUrl: string | null
  municipi: { codi_ine: string; nom: string } | null
}): Promise<Resultat<{ id: string; alias: string | null; municipio: string | null }>> {
  const { data, error } = await supabase
    .from('productor_ubicaciones')
    .insert({
      productor_id: args.productorId,
      alias: args.alias,
      gmaps_url: args.gmapsUrl,
      municipio: args.municipi?.nom ?? null,
      municipio_ine: args.municipi?.codi_ine ?? null,
    })
    .select('id, alias, municipio')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'c.error' }
  return { ok: true, data }
}

export interface CatalogosOferta {
  familias: string[]
  /** `foto_mini` y `cost_referencia` llegan desde el 27-09-2026; un servidor anterior no los manda. */
  productos: { nombre: string; familia: string | null; foto_mini?: string | null; cost_referencia?: number | null }[]
  causas: { codigo: string; nombre: string | null; nombre_es?: string | null }[]
  ubicaciones: { id: string; alias: string | null; municipio: string | null }[]
  /** Familia (valor catalán, el que se guarda) → cómo se enseña en castellano. */
  familias_es?: Record<string, string>
}

/**
 * El descriptor en el idioma de la pantalla. Los textos en castellano viven en
 * `_shared/camposOferta.ts` junto al catalán; aquí solo se elige. Lo que falte en castellano
 * sale en catalán, nunca vacío. **Los valores no cambian** —ids, familias y códigos de causa
 * son los mismos—: solo cambia lo que se lee.
 */
export function localitzaDescriptor(
  campos: CampoOferta[],
  seccions: BlocOferta[],
  catalogos: CatalogosOferta | null,
  lang: string,
): { campos: CampoOferta[]; seccions: BlocOferta[]; catalogos: CatalogosOferta | null } {
  if (lang !== 'es') return { campos, seccions, catalogos }
  return {
    campos: campos.map((c) => ({
      ...c,
      etiqueta: c.etiqueta_es ?? c.etiqueta,
      ayuda: c.ayuda_es ?? c.ayuda,
      opciones: c.opciones?.map((o) => ({
        ...o,
        titulo: o.titulo_es ?? o.titulo,
        descripcion: o.descripcion_es ?? o.descripcion,
      })),
    })),
    seccions: seccions.map((b) => ({
      ...b,
      titol: b.titol_es ?? b.titol,
      descripcio: b.descripcio_es ?? b.descripcio,
    })),
    catalogos: catalogos && {
      ...catalogos,
      causas: catalogos.causas.map((c) => ({ ...c, nombre: c.nombre_es ?? c.nombre })),
    },
  }
}

/** Cómo se enseña una familia en el idioma de la pantalla. */
export function etiquetaFamilia(f: string, catalogos: CatalogosOferta | null, lang: string): string {
  return lang === 'es' ? catalogos?.familias_es?.[f] ?? f : f
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
): Promise<
  Resultat<{ id: string; id_excedente: string; estado?: string; confirmacio_email?: ConfirmacioEmail }> & {
    /**
     * Las claves (`CampoOferta.clave`) que la RPC echa en falta, cuando el rechazo es
     * `code: 'campos_faltantes'`. El cliente ya valida esto ANTES de llamar (§12.123), así
     * que en el camino normal no se llega aquí con la lista vacía; esto es la red para
     * cuando el descriptor cambió entre que se cargó el formulario y que se envió —la
     * función se despliega antes que este fichero (§11)— y el servidor sabe algo que el
     * cliente no sabía todavía.
     */
    faltan?: string[]
  }
> {
  try {
    const t = await token()
    if (!t) return { ok: false, error: 'unauthorized' }
    const res = await fetch(`${supabaseUrl}/functions/v1/crear-oferta`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productor_id: productorId, datos }),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const b = body as { error?: string; faltan?: string[] } | null
      return { ok: false, error: b?.error ?? 'error', faltan: b?.faltan }
    }
    return { ok: true, data: body }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Edita una oferta ya creada (06-10-2026): el equipo o su productor. Pasa por `crear-oferta`
 * en PATCH porque el `texto_oferta` se recompone en el servidor con la función del alta.
 * `canvis` usa las claves del cuestionario (kg, varietat, horari…). Nunca lanza.
 */
export async function editaOferta(
  excedenteId: string,
  canvis: Record<string, unknown>,
): Promise<Resultat<{ canvis: Record<string, { abans: unknown; despres: unknown }> }> & { code?: string }> {
  try {
    const t = await token()
    if (!t) return { ok: false, error: 'unauthorized' }
    const res = await fetch(`${supabaseUrl}/functions/v1/crear-oferta`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: excedenteId, canvis }),
    })
    const body = await res.json().catch(() => null) as { error?: string; code?: string; canvis?: Record<string, { abans: unknown; despres: unknown }> } | null
    if (!res.ok) return { ok: false, error: body?.code ? `edit.err_${body.code}` : (body?.error ?? 'error'), code: body?.code }
    return { ok: true, data: { canvis: body?.canvis ?? {} } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** El equipo valida una oferta y fija su modalidad definitiva (`validar_oferta()`). */
export async function validaOferta(excedenteId: string, modalitat: string | null): Promise<Resultat<Excedente>> {
  const { data, error } = await supabase.rpc('validar_oferta', {
    p_excedente: excedenteId,
    p_modalitat: modalitat,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data as Excedente }
}

/** La receptora (o el equipo) dice cuándo irá a recoger. ISO con zona. */
export async function fixaRecollidaInteres(respostaId: string, quan: string): Promise<Resultat<OfertaRespuesta>> {
  const { data, error } = await supabase.rpc('fixar_recollida_interes', {
    p_resposta: respostaId,
    p_quan: quan,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data as OfertaRespuesta }
}

export interface AlbaraBloquejant {
  albaran_id: string
  numero: string | null
  tipo: string
  entregado_at: string
}

/**
 * Los albaranes que esta organización tiene sin confirmar más de 48 h. Con alguno no puede
 * publicar (productor) ni aceptar (receptora). La regla la impone la base; esto es para
 * poder avisar ANTES. Ante un error devuelve lista vacía: avisar de más no, bloquear por
 * un fallo de red, tampoco — el servidor sigue cortando.
 */
export async function albaransBloquejants(
  tipusOrg: 'productor' | 'entidad',
  orgId: string,
): Promise<AlbaraBloquejant[]> {
  const { data, error } = await supabase.rpc('albarans_bloquejants', { p_tipo_org: tipusOrg, p_org: orgId })
  if (error) return []
  return (data as AlbaraBloquejant[] | null) ?? []
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

/**
 * El rechazo de `manifestar_interes()` traducido a una clave i18n.
 *
 * La base responde en catalán sin acentos («Aquesta oferta ja no esta disponible»), y
 * pintarlo tal cual era enseñar a la entidad el texto de Postgres —en castellano incluido—.
 * Se reconoce por el prefijo o por una subcadena estable del mensaje, no por el SQLSTATE:
 * `22023` lo comparten casi todos. Lo que no se reconoce cae a `c.error`.
 */
export function clauErrorInteres(missatge: string | null | undefined): {
  clau: string
  vars?: Record<string, string>
} {
  const m = missatge ?? ''
  const num = (re: RegExp, decimals: number) => {
    const x = m.match(re)?.[1]
    if (x == null) return null
    const n = Number(x.replace(',', '.'))
    if (Number.isNaN(n)) return null
    return new Intl.NumberFormat('ca-ES', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals || 2,
    }).format(n)
  }
  if (m.includes('sense_conveni')) return { clau: 'mk.err_sense_conveni' }
  if (m.includes('albara_pendent')) return { clau: 'bloq.albara_pendent' }
  if (m.startsWith('kg_maxim')) {
    const n = num(/(\d+(?:[.,]\d+)?)\s*kg/, 0)
    return n ? { clau: 'mk.err_kg_maxim', vars: { n } } : { clau: 'c.error' }
  }
  if (m.includes('ja no esta disponible')) return { clau: 'mk.err_no_disponible' }
  if (m.includes('no encaixa')) return { clau: 'mk.err_no_encaixa' }
  if (m.includes('preu ha de ser')) {
    const min = num(/(\d+(?:[.,]\d+)?)\s*EUR/, 2)
    return min ? { clau: 'mk.err_preu', vars: { min } } : { clau: 'c.error' }
  }
  if (m.includes('ja esta resolta')) return { clau: 'mk.err_resolta' }
  if (m.includes('Cal indicar quants kg')) return { clau: 'mk.need_kg' }
  return { clau: 'c.error' }
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
