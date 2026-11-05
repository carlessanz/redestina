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
import type { DocumentoEstado, SignaturaBandeja, SignaturaDocument } from '../types'
import type { ResultatRpc } from './albarans'

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

/**
 * El fichero FIRMADO que subió la contraparte (`firmes_document`), para que el super_admin lo
 * revise antes de cerrar. Puede ser un PDF o una foto (JPG/PNG): la extensión la pone el
 * servidor. Mismo canal que todo lo demás: `descargar-documento`, URL de 60 s.
 */
export async function urlFitxerFirma(firmaId: string): Promise<ResultatDescarrega> {
  return demanaUrl({ firma_document_id: firmaId }, firmaId)
}

async function demanaUrl(
  cos: { documento_id: string } | { documento_extern_id: string } | { firma_document_id: string },
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

// ------------------------------------------------------------ reenviar un documento

/**
 * Qué puede contestar `reenviar-documento`, más los fallos que solo ocurren aquí.
 * Los cuatro del medio son las barreras de siempre (§8): el documento está bien, lo que
 * no deja es mandarlo a esa dirección.
 */
export type CodiReenviament =
  | 'unauthorized' | 'forbidden' | 'no_existeix' | 'sense_fitxer' | 'enviat_fa_poc'
  | 'no_s_envia' | 'bloquejat_prova' | 'bloquejat_mode_test' | 'fora_llista_test'
  | 'error_envio' | 'desactivat' | 'xarxa' | 'desconegut'
  // Circuito de firma: el correo con el enlace para firmar (`preparar_enviament_signatura`).
  | 'sense_correu' | 'usa_firma_conveni' | 'ja_signat' | 'versio_substituida' | 'no_signable'

const MOTIU_REENVIAMENT: Record<CodiReenviament, string> = {
  unauthorized: 'doc.err_sessio',
  forbidden: 'doc.resend_err_permis',
  no_existeix: 'doc.err_no_existeix',
  sense_fitxer: 'doc.err_generant',
  enviat_fa_poc: 'doc.resend_err_recent',
  no_s_envia: 'doc.resend_err_no_envia',
  bloquejat_prova: 'doc.resend_err_prova',
  bloquejat_mode_test: 'doc.resend_err_mode_test',
  fora_llista_test: 'doc.resend_err_llista',
  error_envio: 'doc.resend_err_envio',
  // Las notificaciones o el correo están apagados en Configuració (§8).
  desactivat: 'canal.motiu_email',
  sense_correu: 'sgn.err_sense_correu',
  usa_firma_conveni: 'sgn.err_usa_firma_conveni',
  ja_signat: 'sgn.err_ja_signat',
  versio_substituida: 'sgn.err_versio_substituida',
  no_signable: 'sgn.err_no_signable',
  xarxa: 'doc.err_xarxa',
  desconegut: 'doc.resend_err_generic',
}

export type ResultatReenviament =
  | { ok: true; simulat: boolean; destinatari: string | null; ambEnllac?: boolean }
  | { ok: false; codi: CodiReenviament; motiuKey: string }

/**
 * Vuelve a mandar un documento emitido al destinatario que ya tenía, con el PDF adjunto.
 * Solo el equipo. Nunca lanza.
 */
export async function reenviarDocument(
  documentoId: string,
  /** Con las notificaciones apagadas, si la persona lo ha aceptado (`acceptaEnviament`, §8). */
  opcions: {
    manual?: boolean
    /**
     * El correo lleva además el enlace para firmar en línea (`/signar-document/<token>`, 30
     * días). Solo tiene sentido con un documento pendiente de firma con trazo; el servidor
     * lo ignora en los demás.
     */
    ambEnllacSignatura?: boolean
  } = {},
): Promise<ResultatReenviament> {
  const falla = (codi: CodiReenviament): ResultatReenviament =>
    ({ ok: false, codi, motiuKey: MOTIU_REENVIAMENT[codi] })
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return falla('unauthorized')

    const res = await fetch(`${supabaseUrl}/functions/v1/reenviar-documento`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documento_id: documentoId,
        manual: opcions.manual === true,
        amb_enllac_signatura: opcions.ambEnllacSignatura === true,
      }),
    })
    const cos = (await res.json().catch(() => null)) as
      | { resultat?: string; destinatari?: string | null; code?: string; enllac_signatura?: unknown }
      | null

    if (res.ok && cos?.resultat) {
      return {
        ok: true,
        simulat: cos.resultat === 'simulat',
        destinatari: cos.destinatari ?? null,
        ambEnllac: cos.enllac_signatura != null && cos.enllac_signatura !== false,
      }
    }
    const codi = typeof cos?.code === 'string' && cos.code in MOTIU_REENVIAMENT
      ? cos.code as CodiReenviament
      : res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'desconegut'
    return falla(codi)
  } catch {
    return falla('xarxa')
  }
}

// ---------------------------------------------------------------------------
// El circuito de firma (05-11-2026, `20270510100000`…`100200`)
// ---------------------------------------------------------------------------
// La firma con trazo va por el enlace público (`enllacPublic.ts`, `signaDocument`); aquí
// está todo lo demás: el estado de cada documento, la subida del fichero firmado y las dos
// decisiones del super_admin. Mismo contrato: nunca lanza.

/**
 * El estado de firma de unos documentos, por id. **Fail-soft**: si la vista no responde
 * (migración sin aplicar, un corte) devuelve un mapa vacío y la pantalla se pinta igual, sin
 * badges de firma — un archivo que no se lista por culpa de la firma sería peor.
 */
export async function carregaEstatsSignatura(ids: string[]): Promise<Record<string, SignaturaDocument>> {
  if (ids.length === 0) return {}
  try {
    // ⚠️ Lista de columnas en UN literal (§7, deuda 46).
    const { data, error } = await supabase
      .from('v_signatura_document')
      .select('documento_id, tipo, numero_completo, version, estat, firma_id, via, signant_nom, signat_at, tancat_at, fitxer_mime, part, tipo_org, org_id, admet_canvas, ultim_motiu_rebuig, ultim_rebutjat_at')
      .in('documento_id', ids)
    if (error) { console.warn('v_signatura_document:', error.message); return {} }
    const mapa: Record<string, SignaturaDocument> = {}
    for (const f of (data as SignaturaDocument[] | null) ?? []) mapa[f.documento_id] = f
    return mapa
  } catch {
    return {}
  }
}

/** La bandeja del equipo (Aprovacions › Signatures per tancar, Documents › Signatures). */
export async function carregaBandejaSignatures(
  estat?: 'pendent' | 'signat' | 'tancat',
): Promise<ResultatRpc<SignaturaBandeja[]>> {
  try {
    let q = supabase
      .from('v_signatures_bandeja')
      .select('documento_id, tipo, numero_completo, version, estat, firma_id, via, signant_nom, signat_at, tancat_at, fitxer_mime, part, tipo_org, org_id, admet_canvas, ultim_motiu_rebuig, ultim_rebutjat_at, modo, objeto_tipo, objeto_id, ejercicio, emitido_at, signant_carrec, data_signatura, signat_per, fitxer_bytes, nota_tancament, org_nom, fitxa_id, organizacion_id')
    if (estat) q = q.eq('estat', estat)
    const { data, error } = await q.order('signat_at', { ascending: true, nullsFirst: false })
    if (error) return { ok: false, missatge: error.message, codi: error.code ?? null }
    return { ok: true, data: (data as SignaturaBandeja[] | null) ?? [] }
  } catch {
    return { ok: false, missatge: 'c.load_error', codi: null }
  }
}

/** Qué puede contestar `pujar-document-signat`, más los fallos del cliente. */
export type CodiPujadaSignat =
  | CodiPujada | 'ja_signat' | 'no_signable' | 'versio_substituida' | 'usa_firma_conveni'

const MOTIU_PUJADA_SIGNAT: Record<CodiPujadaSignat, string> = {
  ...MOTIU_PUJADA,
  forbidden: 'sgn.err_permis',
  dades_invalides: 'sgn.err_dades',
  ja_signat: 'sgn.err_ja_signat',
  no_signable: 'sgn.err_no_signable',
  versio_substituida: 'sgn.err_versio_substituida',
  usa_firma_conveni: 'sgn.err_usa_firma_conveni',
}

export interface PujadaSignat {
  firma: { id: string; estat: 'signat' | 'tancat'; via: 'pujat' | 'correu'; document_signat_id: string | null }
  sha256: string | null
  bytes: number | null
  mime: string | null
}

export type ResultatPujadaSignat =
  | { ok: true; data: PujadaSignat }
  | { ok: false; codi: CodiPujadaSignat; motiuKey: string }

/**
 * Sube el fichero firmado de un documento (PDF, JPG o PNG, hasta 10 MB). Lo que pasa
 * después lo decide el servidor por quién lo sube: la organización → `signat` (lo revisa el
 * super_admin); el super_admin → `tancat` al momento.
 */
export async function pujarDocumentSignat(camps: {
  fitxer: File
  documentoId: string
  signantNom?: string | null
  signantCarrec?: string | null
  /** `AAAA-MM-DD`, la fecha que pone el papel. */
  dataSignatura?: string | null
}): Promise<ResultatPujadaSignat> {
  const falla = (codi: CodiPujadaSignat): ResultatPujadaSignat =>
    ({ ok: false, codi, motiuKey: MOTIU_PUJADA_SIGNAT[codi] })
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return falla('unauthorized')

    const form = new FormData()
    form.append('fitxer', camps.fitxer)
    form.append('documento_id', camps.documentoId)
    if (camps.signantNom?.trim()) form.append('signant_nom', camps.signantNom.trim())
    if (camps.signantCarrec?.trim()) form.append('signant_carrec', camps.signantCarrec.trim())
    if (camps.dataSignatura) form.append('data_signatura', camps.dataSignatura)

    // Sin `Content-Type` a mano: el navegador pone el `boundary` del multipart.
    const res = await fetch(`${supabaseUrl}/functions/v1/pujar-document-signat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const cos = (await res.json().catch(() => null)) as
      | (Partial<PujadaSignat> & { code?: string })
      | null

    if (!res.ok || !cos?.firma?.id) {
      const codi: CodiPujadaSignat = typeof cos?.code === 'string' && cos.code in MOTIU_PUJADA_SIGNAT
        ? cos.code as CodiPujadaSignat
        : res.status === 401 ? 'unauthorized'
          : res.status === 403 ? 'forbidden'
            : res.status === 413 ? 'massa_gran'
              : res.status === 415 ? 'mime_no_acceptat'
                : res.status === 400 ? 'dades_invalides'
                  : 'desconegut'
      return falla(codi)
    }
    return {
      ok: true,
      data: {
        firma: cos.firma,
        sha256: cos.sha256 ?? null,
        bytes: cos.bytes ?? null,
        mime: cos.mime ?? null,
      },
    }
  } catch {
    return falla('xarxa')
  }
}

/** El código propio (`22023 <codi>: …`) del mensaje de una RPC, si lo hay. */
function codiDeMissatge(m: string | null | undefined): string | null {
  const c = /^([a-z_]+):/.exec(m ?? '')?.[1]
  return c ?? null
}

/** El super_admin da por buena una firma subida (`tancar_signatura`). Nota opcional. */
export async function tancarSignatura(firmaId: string, nota?: string | null): Promise<ResultatRpc<null>> {
  try {
    const { error } = await supabase.rpc('tancar_signatura', {
      p_firma: firmaId,
      p_nota: nota?.trim() ? nota.trim() : null,
    })
    if (error) return { ok: false, missatge: error.message, codi: codiDeMissatge(error.message) ?? error.code ?? null }
    return { ok: true, data: null }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}

/** El super_admin la rechaza (`rebutjar_signatura`): motivo obligatorio; vuelve a «pendent». */
export async function rebutjarSignatura(firmaId: string, motiu: string): Promise<ResultatRpc<null>> {
  try {
    const { error } = await supabase.rpc('rebutjar_signatura', { p_firma: firmaId, p_motiu: motiu.trim() })
    if (error) return { ok: false, missatge: error.message, codi: codiDeMissatge(error.message) ?? error.code ?? null }
    return { ok: true, data: null }
  } catch {
    return { ok: false, missatge: 'c.error', codi: null }
  }
}
