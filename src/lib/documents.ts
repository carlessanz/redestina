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
import type { DocumentExternObjecte, DocumentExternTipus } from '../types'
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
 * Pide la URL firmada y **no abre nada**: quien llama decide si la descarga o la enseña.
 *
 * ⚠️ La URL que devuelve sirve el PDF **inline** —`content-type: application/pdf`, sin
 * `content-disposition` ni `x-frame-options`, medido contra producción—, que es lo que
 * permite incrustarla en el visor (`VisorPdf`). Quien quiera forzar el guardado le añade el
 * `?download=`, como hace `descarregarDocument()` aquí debajo: **ese parámetro es justamente
 * lo que hace que un iframe no pinte nada**, así que no se añade «por si acaso».
 */
export async function urlDocument(documentoId: string): Promise<ResultatDescarrega> {
  return demanaUrl({ documento_id: documentoId }, `${documentoId}.pdf`)
}

/**
 * Lo mismo para un documento EXTERNO —el que aporta otro: el albarán del productor, la
 * factura, un convenio firmado en papel, un certificado de un ejercicio anterior—.
 *
 * 🔴 Hasta el 22-09-2026 esto NO EXISTÍA: un externo se subía, se listaba y **no se podía
 * volver a abrir**, porque `descargar-documento` solo servía `documentos`. Guardar un
 * certificado para que el productor lo tenga no significa nada si nadie puede descargarlo.
 *
 * ⚠️ Un externo **no tiene por qué ser un PDF** (el bucket acepta también JPG y PNG), así
 * que el nombre de respaldo no lleva extensión inventada: la pone el servidor, que es quien
 * conoce el `mime` de la fila.
 */
export async function urlDocumentExtern(externId: string): Promise<ResultatDescarrega> {
  return demanaUrl({ documento_extern_id: externId }, externId)
}

async function demanaUrl(
  cos: { documento_id: string } | { documento_extern_id: string },
  nomPerDefecte: string,
): Promise<ResultatDescarrega> {
  let dades: Descarrega
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return falla('unauthorized')

    const res = await fetch(`${supabaseUrl}/functions/v1/descargar-documento`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cos),
    })
    const body = (await res.json().catch(() => null)) as
      | (Partial<Descarrega> & { code?: string })
      | null

    if (!res.ok || !body?.url) return falla(codiDeResposta(res.status, body?.code))

    dades = {
      url: body.url,
      nombre: body.nombre ?? nomPerDefecte,
      sha256_fichero: body.sha256_fichero ?? null,
      bytes: body.bytes ?? null,
      paginas: body.paginas ?? null,
      caduca_en: body.caduca_en ?? 60,
    }
  } catch {
    return falla('xarxa')
  }

  return { ok: true, data: dades }
}

/**
 * Pide la URL firmada y la abre para GUARDARLA.
 *
 * El `?download=` hace que el navegador **guarde** el PDF con el número del documento en
 * vez de abrir una pestaña con un nombre de fichero ilegible. La pestaña que abre
 * `window.open` se cierra sola en cuanto empieza la descarga.
 */
export async function descarregarDocument(documentoId: string): Promise<ResultatDescarrega> {
  return obre(await urlDocument(documentoId))
}

/** Lo mismo para un externo. Mismo `?download=` y mismo aviso de ventana bloqueada. */
export async function descarregarDocumentExtern(externId: string): Promise<ResultatDescarrega> {
  return obre(await urlDocumentExtern(externId))
}

function obre(res: ResultatDescarrega): ResultatDescarrega {
  if (!res.ok) return res

  const separador = res.data.url.includes('?') ? '&' : '?'
  const enllac = `${res.data.url}${separador}download=${encodeURIComponent(res.data.nombre)}`
  const finestra = window.open(enllac, '_blank', 'noopener,noreferrer')
  // Un bloqueador de ventanas emergentes deja la descarga sin ocurrir y sin decirlo:
  // devolvemos el motivo para que la pantalla pueda avisar en vez de quedarse muda.
  if (!finestra) return falla('popup_bloquejat')

  return res
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

// ---------------------------------------------------------------------------
// Subida de un documento ajeno (la factura del donante, su albarán en papel)
// ---------------------------------------------------------------------------
// Va por la Edge Function `subir-documento-externo` y no por Storage por la misma razón
// que la descarga: el bucket no tiene ninguna política para `authenticated`. Y aquí hay
// además tres reglas que una política de Storage no sabría decir —qué MIME se acepta,
// cuánto puede pesar y en qué carpeta va— y que la función sí dice.
//
// QUIÉN PUEDE SUBIR QUÉ, y no es lo mismo para todos los objetos. Un titular sube a su
// albarán (`albarans_de_les_meves_orgs`), a su cierre (`cierres_donante_meus`, abierto
// desde 20261109100400 — este comentario afirmó lo contrario hasta el 22-09-2026) y a su
// convenio; a una FICHA (`productor`/`entidad`) solo sube el equipo, porque eso no es algo
// que aporte la organización sino archivo que la Fundación guarda sobre ella. Por eso
// `forbidden` tiene su propia frase, que manda al enlace del correo del resumen en vez de
// decir «no tienes permiso», que sería verdad pero no ayudaría a nadie.

export type CodiPujada =
  | 'unauthorized' | 'forbidden' | 'no_existeix' | 'cos_invalid' | 'dades_invalides'
  | 'falta_fitxer' | 'fitxer_buit' | 'massa_gran' | 'mime_no_acceptat'
  | 'sense_carpeta' | 'error_storage' | 'error_bd' | 'xarxa' | 'desconegut'

const MOTIU_PUJADA: Record<CodiPujada, string> = {
  unauthorized: 'doc.err_sessio',
  forbidden: 'mydoc.err_pujada_permis',
  no_existeix: 'doc.err_no_existeix',
  cos_invalid: 'doc.err_peticio',
  dades_invalides: 'doc.err_peticio',
  falta_fitxer: 'mydoc.err_falta_fitxer',
  fitxer_buit: 'mydoc.err_fitxer_buit',
  massa_gran: 'mydoc.err_massa_gran',
  mime_no_acceptat: 'mydoc.err_mime',
  sense_carpeta: 'doc.err_servidor',
  error_storage: 'doc.err_servidor',
  error_bd: 'doc.err_servidor',
  xarxa: 'doc.err_xarxa',
  desconegut: 'doc.err_generic',
}

export interface Pujada {
  id: string
  ruta: string
  sha256: string | null
  bytes: number | null
  nombre: string
}

export type ResultatPujada =
  | { ok: true; data: Pujada }
  | { ok: false; codi: CodiPujada; motiuKey: string }

/** Sube un fichero (PDF, JPG o PNG, hasta 10 MB) y lo enlaza con un objeto del circuito. */
export async function pujarDocumentExtern(camps: {
  fitxer: File
  objecteTipus: DocumentExternObjecte
  objecteId: string
  tipus: DocumentExternTipus
  numero?: string | null
  data?: string | null
  /**
   * En qué carpeta de ejercicio se archiva. Solo lo usan `productor` y `entidad`: un
   * certificado de 2023 va a `2023/`, no al año en que alguien lo sube. En los demás
   * objetos el ejercicio sale de la propia fila y esto se ignora.
   */
  exercici?: number | null
}): Promise<ResultatPujada> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return { ok: false, codi: 'unauthorized', motiuKey: MOTIU_PUJADA.unauthorized }

    const form = new FormData()
    form.append('fitxer', camps.fitxer)
    form.append('objeto_tipo', camps.objecteTipus)
    form.append('objeto_id', camps.objecteId)
    form.append('tipo', camps.tipus)
    if (camps.numero) form.append('numero', camps.numero)
    if (camps.data) form.append('fecha', camps.data)
    if (camps.exercici) form.append('ejercici', String(camps.exercici))

    // Sin `Content-Type` a mano: el navegador tiene que poner el `boundary` del multipart.
    const res = await fetch(`${supabaseUrl}/functions/v1/subir-documento-externo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const cos = (await res.json().catch(() => null)) as
      | (Partial<Pujada> & { code?: string })
      | null

    if (!res.ok || !cos?.id) {
      const codi = typeof cos?.code === 'string' && cos.code in MOTIU_PUJADA
        ? cos.code as CodiPujada
        : res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'desconegut'
      return { ok: false, codi, motiuKey: MOTIU_PUJADA[codi] }
    }

    return {
      ok: true,
      data: {
        id: cos.id,
        ruta: cos.ruta ?? '',
        sha256: cos.sha256 ?? null,
        bytes: cos.bytes ?? null,
        nombre: cos.nombre ?? camps.fitxer.name,
      },
    }
  } catch {
    return { ok: false, codi: 'xarxa', motiuKey: MOTIU_PUJADA.xarxa }
  }
}
