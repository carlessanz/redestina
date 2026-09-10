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
  // Solo aparecen en la subida de factura (fase 4), pero viven en la misma tabla: el
  // vocabulario es el de la función, y la función es una.
  | 'falta_fitxer' | 'massa_gran' | 'mime_no_acceptat'
  | 'sense_carpeta' | 'error_storage' | 'error_bd' | 'cos_invalid' | 'base64_invalid'
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
  falta_fitxer: 'fact.err_falta_fitxer',
  massa_gran: 'fact.err_massa_gran',
  mime_no_acceptat: 'fact.err_mime',
  // Los tres son «no hemos podido guardarlo»: la persona no puede hacer nada distinto
  // según cuál sea, así que decirle cuál de los tres es solo la asusta.
  sense_carpeta: 'conf.err_servidor',
  error_storage: 'conf.err_servidor',
  error_bd: 'conf.err_servidor',
  cos_invalid: 'conf.err_peticio',
  base64_invalid: 'conf.err_peticio',
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
  if (status === 413) return 'massa_gran'
  if (status === 415) return 'mime_no_acceptat'
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

/**
 * El GET, crudo. Los dos propósitos vivos —confirmar un albarán y subir una factura—
 * comparten endpoint y comparten los tres finales del enlace (no existe, ya usado,
 * caducado), así que comparten también esta función: si mañana cambia el contrato del
 * error, cambia en un sitio.
 */
async function demanaEnllac(token: string): Promise<ResultatEnllac<Record<string, unknown>>> {
  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/enlace-publico?t=${encodeURIComponent(token)}`,
      { method: 'GET' },
    )
    const cos = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !cos) return falla(codiDe(res.status, cos?.code))
    return { ok: true, data: cos }
  } catch {
    return falla('xarxa')
  }
}

/** Carga el albarán que hay detrás del token. El servidor deja de paso la evidencia de apertura. */
export async function carregaEnllac(token: string): Promise<ResultatEnllac<DadesEnllac>> {
  const res = await demanaEnllac(token)
  if (!res.ok) return res
  // Un token de factura abierto en `/confirmar` responde 200 y trae otra cosa. Sin esta
  // comprobación la pantalla pintaría un albarán sin líneas y sin acta, que es la peor
  // manera de fallar: parece que funciona.
  const proposito = text(res.data.proposito)
  if (proposito && proposito !== 'confirmacion_albaran') return falla('proposit_incorrecte')
  return { ok: true, data: normalitza(res.data) }
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

// ---------------------------------------------------------------------------
// FASE 4 — el enlace del cierre anual: subir la factura
// ---------------------------------------------------------------------------
// Quien abre esto es el DONANTE. Ya recibió el resumen anual por correo; ahora tiene que
// hacernos llegar su factura por ese mismo importe. La pantalla no calcula nada: enseña
// el importe que el servidor dice que espera, y el servidor —`registrar_factura()`— es
// quien después decide si cuadra.

/** El importe que la factura tiene que llevar, y por qué. */
export interface DadesFactura {
  proposito: string
  estado: string
  /** El nombre del destinatario tal y como salió en el correo. */
  destinatari: string | null
  resum: {
    id: string
    numero: string | null
    estat: string
    exercici: number | null
    /** `real` o `prueba`. Un ensayo se dice en la pantalla; no se disimula. */
    mode: string
    donant: string | null
    nif: string | null
    kgTotal: number | null
    /** Lo que se espera: `cierres_donante.valor_total`. */
    importEsperat: number | null
    facturaNumero: string | null
    bloquejos: string[]
  }
  /** Qué acepta el servidor. No se inventa aquí ni el máximo ni los formatos. */
  formulari: {
    mimes: string[]
    maxBytes: number
  }
  /** URL firmada de 60 s del resumen anual. Nunca una ruta de Storage. */
  pdf_url: string | null
}

/** Lo que el servidor decidió con la factura recién subida. */
export interface ResultatFactura {
  numero: string
  importe: number | null
  importEsperat: number | null
  coincideix: boolean
  /** `coincident` · `discrepancia` · `factura_rebuda`. */
  estat: string
}

const MIMES_PER_DEFECTE = ['application/pdf', 'image/jpeg', 'image/png']
const MAX_BYTES_PER_DEFECTE = 10 * 1024 * 1024

function llistaText(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []
}

function normalitzaFactura(cos: Record<string, unknown>): DadesFactura {
  const doc = (cos.documento ?? {}) as Record<string, unknown>
  const form = (cos.formulari ?? {}) as Record<string, unknown>
  const mimes = llistaText(form.mimes)
  return {
    proposito: text(cos.proposito) ?? 'subida_factura',
    estado: text(cos.estado) ?? text(cos.estado_efectivo) ?? 'activo',
    destinatari: text(cos.destinatari),
    resum: {
      id: text(doc.id) ?? '',
      numero: text(doc.numero_completo) ?? text(doc.numero),
      estat: text(doc.estado) ?? '',
      exercici: numero(doc.exercici),
      // Ante la duda, `prueba`: decir «esto es real» cuando no lo es es el único error
      // caro de los dos.
      mode: text(doc.mode) ?? 'prueba',
      donant: text(doc.donant),
      nif: text(doc.nif),
      kgTotal: numero(doc.kg_total),
      importEsperat: numero(form.import_esperat) ?? numero(doc.valor_total),
      facturaNumero: text(doc.factura_numero),
      bloquejos: llistaText(doc.bloquejos),
    },
    formulari: {
      mimes: mimes.length > 0 ? mimes : MIMES_PER_DEFECTE,
      maxBytes: numero(form.max_bytes) ?? MAX_BYTES_PER_DEFECTE,
    },
    pdf_url: text(cos.pdf_url),
  }
}

/** Carga el cierre del donante que hay detrás del token. */
export async function carregaFactura(token: string): Promise<ResultatEnllac<DadesFactura>> {
  const res = await demanaEnllac(token)
  if (!res.ok) return res
  const proposito = text(res.data.proposito)
  if (proposito && proposito !== 'subida_factura') return falla('proposit_incorrecte')
  return { ok: true, data: normalitzaFactura(res.data) }
}

export interface Factura {
  numero: string
  data: string | null
  /** El importe que lleva SU factura, no el que esperamos. Puede no ponerlo. */
  importe: number | null
  nom: string | null
  fitxer: File
  /** Honeypot: siempre vacío en una persona. Si viene lleno, el servidor finge un 200. */
  web: string
}

/** El fichero en base64, para el plan B. */
function llegeixBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader()
    lector.onload = () => resolve(String(lector.result ?? ''))
    lector.onerror = () => reject(new Error('lectura'))
    lector.readAsDataURL(f)
  })
}

function resultatDe(cos: Record<string, unknown>, dades: Factura): ResultatFactura {
  const f = (cos.factura ?? {}) as Record<string, unknown>
  return {
    numero: text(f.numero) ?? dades.numero,
    importe: numero(f.importe),
    importEsperat: numero(f.import_esperat),
    coincideix: f.coincideix === true,
    estat: text(f.estat) ?? 'factura_rebuda',
  }
}

/**
 * Sube la factura.
 *
 * **Dos formas de mandar el mismo fichero, y no es por gusto.** Lo natural desde un móvil
 * es `multipart/form-data`, y es lo que se intenta primero. Pero esta pantalla se abre
 * muchas veces desde el navegador integrado de WhatsApp, donde un `FormData` con un
 * fichero grande no siempre llega; por eso, **solo si falló la red** (no si el servidor
 * contestó que no), se reintenta en JSON con el fichero en base64, que la función también
 * acepta. Un error del servidor no se reintenta nunca: la respuesta es la respuesta, y
 * repetir una subida que el servidor ya registró duplicaría la factura.
 */
export async function pujaFactura(
  token: string,
  dades: Factura,
): Promise<ResultatEnllac<ResultatFactura>> {
  const camps: Record<string, string> = { t: token, accion: 'subir_factura', numero: dades.numero }
  if (dades.data) camps.fecha = dades.data
  if (dades.importe !== null) camps.importe = String(dades.importe)
  if (dades.nom) camps.nombre = dades.nom
  if (dades.web) camps.web = dades.web

  // ── Intento 1: multipart ──
  try {
    const form = new FormData()
    for (const [k, v] of Object.entries(camps)) form.append(k, v)
    form.append('fitxer', dades.fitxer, dades.fitxer.name)
    // Sin `Content-Type` a mano: el navegador tiene que poner el `boundary`.
    const res = await fetch(`${supabaseUrl}/functions/v1/enlace-publico`, { method: 'POST', body: form })
    const cos = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !cos) return falla(codiDe(res.status, cos?.code))
    return { ok: true, data: resultatDe(cos, dades) }
  } catch {
    // Solo aquí: la petición no llegó a tener respuesta.
  }

  // ── Intento 2: JSON + base64 ──
  try {
    const dataUri = await llegeixBase64(dades.fitxer)
    const res = await fetch(`${supabaseUrl}/functions/v1/enlace-publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...camps,
        importe: dades.importe,
        fitxer_base64: dataUri,
        mime: dades.fitxer.type,
        nom_fitxer: dades.fitxer.name,
      }),
    })
    const cos = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !cos) return falla(codiDe(res.status, cos?.code))
    return { ok: true, data: resultatDe(cos, dades) }
  } catch {
    return falla('xarxa')
  }
}
