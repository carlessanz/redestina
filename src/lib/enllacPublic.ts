// Cliente del enlace público (`enlace-publico`).
//
// Lo llama gente SIN CUENTA: quien recibe un albarán y confirma lo que ha llegado. Por eso
// no hay ni sesión ni cabecera `Authorization` —la función se despliega con
// `verify_jwt = false`— y la credencial es el token de 32 bytes que viajó en el correo.
//
// Aquí no se toca `supabase.auth` a propósito. Esta pantalla se abre en una finca, desde el
// móvil, muchas veces en el navegador integrado de WhatsApp: cuanto menos haga la página,
// menos hay que pueda fallar.
//
// Como el resto de clientes del proyecto (`documents.ts`, `redestina.ts`), **nunca lanza**:
// devuelve `ok` y, cuando no, un código con su clave i18n.

import { supabaseUrl } from './supabase'

/**
 * El vocabulario es **el de la Edge Function**, literal (`supabase/functions/enlace-publico`).
 * Traducirlo aquí a nombres propios solo añadiría un sitio donde los dos lados pueden
 * dejar de coincidir sin que nada falle: la traición sería silenciosa y acabaría en un
 * «ha habido un error» delante de quien está en una finca.
 */
export type CodiEnllac =
  | 'desconegut' | 'ja_usat' | 'caducat' | 'revocat'
  | 'dades_invalides' | 'linia_desconeguda' | 'document_canviat'
  | 'proposit_incorrecte' | 'proposit_no_implementat' | 'no_implementat'
  | 'accio_desconeguda' | 'massa_solicituds' | 'error_intern'
  | 'xarxa' | 'desconegut_client'

/** Cada código, su frase. Los tres finales del enlace —no existe, ya usado, caducado— se
 *  explican distinto porque lo que hay que hacer después es distinto en cada caso. */
const MOTIU: Record<CodiEnllac, string> = {
  desconegut: 'conf.err_no_existeix',
  ja_usat: 'conf.err_ja_usat',
  caducat: 'conf.err_caducat',
  revocat: 'conf.err_revocat',
  dades_invalides: 'conf.err_dades',
  linia_desconeguda: 'conf.err_linia',
  document_canviat: 'conf.err_canviat',
  proposit_incorrecte: 'conf.err_proposit',
  proposit_no_implementat: 'conf.err_proposit',
  no_implementat: 'conf.err_proposit',
  accio_desconeguda: 'conf.err_peticio',
  massa_solicituds: 'conf.err_massa_intents',
  error_intern: 'conf.err_servidor',
  xarxa: 'conf.err_xarxa',
  desconegut_client: 'conf.err_generic',
}

export interface LiniaEnllac {
  id: string
  producto: string | null
  variedad: string | null
  num_cajas: number | null
  tipo_caja: string | null
  kg_neto: number | null
}

export interface DadesEnllac {
  proposito: string
  estado: string
  albara: {
    id: string
    tipo: string
    numero_completo: string | null
    entrega: string | null
    recibe: string | null
    fecha: string | null
    retorn_envasos: string | null
    observaciones: string | null
  }
  linies: LiniaEnllac[]
  /**
   * El acta que hay que enseñar **tal cual**: su huella es la evidencia de QUÉ se aceptó,
   * no solo de que alguien pulsó un botón. Por eso se pinta literal y se devuelve
   * `sha256_texto` al confirmar: si el albarán ha cambiado entre abrir y confirmar, el
   * servidor responde 409 en vez de dar por bueno un acuerdo sobre otra cosa.
   */
  textConfirmacio: string | null
  sha256Texto: string | null
  /** Código de verificación impreso en el PDF (huella del snapshot, no del fichero). */
  codiVerificacio: string | null
  /** URL firmada de 60 s del PDF, si el servidor la da. Nunca una ruta de Storage. */
  pdf_url: string | null
}

export type ResultatEnllac<T> =
  | { ok: true; data: T }
  | { ok: false; codi: CodiEnllac; motiuKey: string }

function falla(codi: CodiEnllac): ResultatEnllac<never> {
  return { ok: false, codi, motiuKey: MOTIU[codi] }
}

/** El `code` del cuerpo si lo reconocemos; si no, se deduce del status HTTP. */
function codiDe(status: number, code: unknown): CodiEnllac {
  if (typeof code === 'string' && code in MOTIU) return code as CodiEnllac
  if (status === 404) return 'desconegut'
  if (status === 409) return 'ja_usat'
  if (status === 410) return 'caducat'
  if (status === 400) return 'dades_invalides'
  if (status === 429) return 'massa_solicituds'
  if (status >= 500) return 'error_intern'
  return 'desconegut_client'
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function numero(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

/**
 * Normaliza lo que devuelve el servidor.
 *
 * El bloque bueno es `documento` y las líneas van dentro, en `linies`. Se aceptan también
 * `albara`/`albaran` y `lineas` porque esta pantalla y la Edge Function se escribieron a la
 * vez: prefiero un cliente que aguante la variante a una página en blanco delante de quien
 * está en una finca. Cuando el contrato lleve un tiempo quieto, esto se poda.
 */
function normalitza(cos: Record<string, unknown>): DadesEnllac {
  const alb = (cos.documento ?? cos.albara ?? cos.albaran ?? {}) as Record<string, unknown>
  const brutes = (cos.linies ?? cos.lineas ?? alb.linies ?? alb.lineas ?? []) as unknown[]

  return {
    proposito: text(cos.proposito) ?? 'confirmacion_albaran',
    estado: text(cos.estado) ?? 'activo',
    albara: {
      id: text(alb.id) ?? '',
      tipo: text(alb.tipo) ?? '',
      numero_completo: text(alb.numero_completo) ?? text(alb.numero),
      entrega: text(alb.entrega) ?? text(alb.entrega_nombre),
      recibe: text(alb.recibe) ?? text(alb.recibe_nombre),
      fecha: text(alb.fecha) ?? text(alb.fecha_hora) ?? text(alb.entregado_at),
      retorn_envasos: text(alb.retorn_envasos),
      observaciones: text(alb.observaciones),
    },
    linies: brutes.map((l) => {
      const o = l as Record<string, unknown>
      return {
        id: text(o.id) ?? '',
        producto: text(o.producto),
        variedad: text(o.variedad),
        num_cajas: numero(o.num_cajas),
        tipo_caja: text(o.tipo_caja),
        kg_neto: numero(o.kg_neto) ?? numero(o.kg_previstos),
      }
    }),
    textConfirmacio: text(cos.text_confirmacio),
    sha256Texto: text(cos.sha256_texto),
    codiVerificacio: text(alb.codi_verificacio),
    pdf_url: text(cos.pdf_url),
  }
}

/** Carga lo que hay detrás del token. El servidor deja de paso la evidencia de apertura. */
export async function carregaEnllac(token: string): Promise<ResultatEnllac<DadesEnllac>> {
  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/enlace-publico?t=${encodeURIComponent(token)}`,
      { method: 'GET' },
    )
    const cos = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !cos) return falla(codiDe(res.status, cos?.code))
    return { ok: true, data: normalitza(cos) }
  } catch {
    return falla('xarxa')
  }
}

export interface Confirmacio {
  nom: string
  carrec: string | null
  kg: { linea_id: string; kg: number }[]
  caixesRetornades: number | null
  incidencies: string | null
  rebuig: 'cap' | 'parcial' | 'total'
  motiuRebuig: string | null
  /** Huella del acta que se ha enseñado. El servidor corta con 409 si ya no coincide. */
  sha256Texto: string | null
  /** Honeypot: siempre vacío en una persona. Si viene lleno, el servidor finge un 200. */
  web: string
}

export async function confirmaEnllac(
  token: string,
  dades: Confirmacio,
): Promise<ResultatEnllac<{ ok: true }>> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/enlace-publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        t: token,
        accion: 'confirmar',
        nombre: dades.nom,
        cargo: dades.carrec,
        kg_confirmados: dades.kg,
        caixes_retornades: dades.caixesRetornades,
        incidencias: dades.incidencies,
        rechazo: dades.rebuig,
        motivo_rechazo: dades.motiuRebuig,
        sha256_texto: dades.sha256Texto,
        web: dades.web,
      }),
    })
    if (!res.ok) {
      const cos = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return falla(codiDe(res.status, cos?.code))
    }
    return { ok: true, data: { ok: true } }
  } catch {
    return falla('xarxa')
  }
}
