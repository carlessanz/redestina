// Cliente del sistema documental.
//
// Dos operaciones, y las dos existen por el mismo motivo: el bucket `documentos` es
// privado y no tiene ninguna política para `authenticated`, así que **nadie llega a un
// PDF por su cuenta**. La única puerta es la Edge Function `descargar-documento`, que
// comprueba la sesión y `puede_ver_documento()` y devuelve una URL firmada de 60 s.
// Aquí nunca se construye una URL de Storage a mano: si algún día apareciera una, sería
// un enlace permanente a un documento con datos personales.
//
// Igual que `redestina.ts` y `ofertes.ts`: **nunca lanza**. Devuelve `ok` y, cuando no,
// una clave i18n con el motivo, para que la pantalla decida cómo lo cuenta.

import { supabase, supabaseUrl } from './supabase'
import type { DocumentoEstado } from '../types'

/** Códigos que devuelve `descargar-documento`, más los que solo ocurren en el cliente. */
export type CodiDescarrega =
  | 'unauthorized' | 'forbidden' | 'no_existeix' | 'sense_fitxer'
  | 'cos_invalid' | 'falta_id' | 'error_bd' | 'error_storage'
  | 'popup_bloquejat' | 'xarxa' | 'desconegut'

/** Cada código, su frase. La pantalla hace `t(motiuKey)`; el código queda para decidir. */
const MOTIU: Record<CodiDescarrega, string> = {
  unauthorized: 'doc.err_sessio',
  forbidden: 'doc.err_permis',
  no_existeix: 'doc.err_no_existeix',
  sense_fitxer: 'doc.err_generant',
  cos_invalid: 'doc.err_peticio',
  falta_id: 'doc.err_peticio',
  error_bd: 'doc.err_servidor',
  error_storage: 'doc.err_servidor',
  popup_bloquejat: 'doc.err_popup',
  xarxa: 'doc.err_xarxa',
  desconegut: 'doc.err_generic',
}

export interface Descarrega {
  url: string
  nombre: string
  sha256_fichero: string | null
  bytes: number | null
  paginas: number | null
  caduca_en: number
}

export type ResultatDescarrega =
  | { ok: true; data: Descarrega }
  | { ok: false; codi: CodiDescarrega; motiuKey: string }

function falla(codi: CodiDescarrega): ResultatDescarrega {
  return { ok: false, codi, motiuKey: MOTIU[codi] }
}

/** El `code` del cuerpo si lo reconocemos; si no, se deduce del status. */
function codiDeResposta(status: number, code: unknown): CodiDescarrega {
  if (typeof code === 'string' && code in MOTIU) return code as CodiDescarrega
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'no_existeix'
  if (status === 409) return 'sense_fitxer'
  return 'desconegut'
}

/**
 * Pide la URL firmada y la abre.
 *
 * El `?download=` hace que el navegador **guarde** el PDF con el número del documento en
 * vez de abrir una pestaña con un nombre de fichero ilegible. La pestaña que abre
 * `window.open` se cierra sola en cuanto empieza la descarga.
 */
export async function descarregarDocument(documentoId: string): Promise<ResultatDescarrega> {
  let dades: Descarrega
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return falla('unauthorized')

    const res = await fetch(`${supabaseUrl}/functions/v1/descargar-documento`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documento_id: documentoId }),
    })
    const body = (await res.json().catch(() => null)) as
      | (Partial<Descarrega> & { code?: string })
      | null

    if (!res.ok || !body?.url) return falla(codiDeResposta(res.status, body?.code))

    dades = {
      url: body.url,
      nombre: body.nombre ?? `${documentoId}.pdf`,
      sha256_fichero: body.sha256_fichero ?? null,
      bytes: body.bytes ?? null,
      paginas: body.paginas ?? null,
      caduca_en: body.caduca_en ?? 60,
    }
  } catch {
    return falla('xarxa')
  }

  const separador = dades.url.includes('?') ? '&' : '?'
  const enllac = `${dades.url}${separador}download=${encodeURIComponent(dades.nombre)}`
  const finestra = window.open(enllac, '_blank', 'noopener,noreferrer')
  // Un bloqueador de ventanas emergentes deja la descarga sin ocurrir y sin decirlo:
  // devolvemos el motivo para que la pantalla pueda avisar en vez de quedarse muda.
  if (!finestra) return falla('popup_bloquejat')

  return { ok: true, data: dades }
}

export type ResultatEspera = 'emitido' | 'error' | 'espera_esgotada' | 'cancellat'

/** Cada final de la espera, su frase. `emitido` no la necesita: ahí no se avisa de nada. */
const MOTIU_ESPERA: Record<Exclude<ResultatEspera, 'emitido' | 'cancellat'>, string> = {
  error: 'doc.err_generacio',
  espera_esgotada: 'doc.err_espera',
}

export interface Espera {
  resultat: ResultatEspera
  estado: DocumentoEstado | null
  /** Clave i18n del motivo; `null` cuando el documento se generó bien o se canceló. */
  motiuKey: string | null
}

const INTERVAL_MS = 2_000
const LIMIT_MS = 30_000

/**
 * Espera a que la generación del PDF acabe, consultando `documentos.estado`.
 *
 * Es **polling** a propósito, no Realtime: el volumen de documentos de las fases 1-4 no
 * lo justifica y una suscripción por fila sería más máquina de la que hace falta para
 * un «Generant…» que dura segundos. A los 30 s se rinde: el job de reintentos
 * (`disparar_generacion_pendiente`, cada 5 min) es quien recupera lo que se atasca, así
 * que seguir mirando aquí no arreglaría nada.
 */
export async function esperarGeneracio(
  documentoId: string,
  senyal?: AbortSignal,
): Promise<Espera> {
  const fi = Date.now() + LIMIT_MS
  let estado: DocumentoEstado | null = null

  while (Date.now() < fi) {
    if (senyal?.aborted) return { resultat: 'cancellat', estado, motiuKey: null }

    const { data } = await supabase
      .from('documentos')
      .select('estado')
      .eq('id', documentoId)
      .maybeSingle()

    estado = (data as { estado: DocumentoEstado } | null)?.estado ?? estado

    if (estado === 'emitido') return { resultat: 'emitido', estado, motiuKey: null }
    if (estado === 'error') {
      return { resultat: 'error', estado, motiuKey: MOTIU_ESPERA.error }
    }

    await new Promise((resolt) => setTimeout(resolt, INTERVAL_MS))
  }

  if (senyal?.aborted) return { resultat: 'cancellat', estado, motiuKey: null }
  return { resultat: 'espera_esgotada', estado, motiuKey: MOTIU_ESPERA.espera_esgotada }
}
