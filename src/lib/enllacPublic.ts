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
  // Solo en la firma de un convenio (fase 2), por el mismo motivo: la función es una.
  | 'codi_incorrecte' | 'codi_caducat' | 'sense_codi' | 'no_cal_codi' | 'sense_correu'
  | 'no_test_user' | 'error_email'
  | 'falta_declaracio' | 'falta_acceptacio' | 'falta_signatura'
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
  // Firma del convenio. Los del código se separan porque lo que hay que hacer después no
  // es lo mismo en cada caso: volver a teclearlo, pedir otro o dejar de esperarlo.
  codi_incorrecte: 'sig.err_codi_incorrecte',
  codi_caducat: 'sig.err_codi_caducat',
  sense_codi: 'sig.err_sense_codi',
  no_cal_codi: 'sig.err_no_cal_codi',
  sense_correu: 'sig.err_sense_correu',
  no_test_user: 'sig.err_no_test_user',
  error_email: 'sig.err_email',
  falta_declaracio: 'sig.err_declaracio',
  falta_acceptacio: 'sig.err_acceptacio',
  falta_signatura: 'sig.err_signatura',
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

// ---------------------------------------------------------------------------
// FASE 2 — el enlace de firma del convenio
// ---------------------------------------------------------------------------
// Quien abre esto es LA PERSONA QUE REPRESENTA a la organización. Puede estar en su
// despacho o de pie en una finca con el dinamizador al lado (firma asistida, §3.2.5), y
// en los dos casos la pantalla es la misma. Lo que cambia es el canal del enlace y si hay
// segundo factor.
//
// TRES COSAS SIN LAS QUE NO SE FIRMA, y las impone `firmar_convenio_por_enlace()`, no
// esta pantalla: la declaración de representación, la huella del texto exacto que se
// mostró (`sha256_texto`) y —si el enlace lleva código— haberlo validado antes. Aquí se
// piden porque sin ellas el servidor va a decir que no, no porque el cliente decida nada.

/** Los datos de la organización. Nombres **literales** de `p_datos` de la RPC. */
export interface DadesOrganitzacio {
  raso_social: string
  nom_comercial: string
  nif: string
  domicili: string
  codi_postal: string
  poblacio: string
  representant: string
  carrec: string
  email: string
}

export interface DadesConveni {
  proposito: string
  estado: string
  destinatari: string | null
  /** Firma asistida: la conduce el equipo con la persona delante (§3.2.5). */
  assistida: boolean
  /** El enlace lleva código de 6 cifras pendiente de validar. */
  calCodi: boolean
  /** Hay una dirección a la que mandar el código. Sin ella no hay segundo factor. */
  potDemanarCodi: boolean
  conveni: {
    id: string
    tipus: string
    estat: string
    numero_completo: string | null
    idioma: string
    /** Nombre del modelo, ya traducido por el servidor al idioma del convenio. */
    model: string | null
    titol: string | null
    rolesCom: string[]
  }
  organitzacio: DadesOrganitzacio & { tipus_org: string; nom: string | null }
  /** Qué campos exige el servidor. La pantalla los marca; no se inventa la lista. */
  obligatoris: string[]
  /** Texto exacto de las dos declaraciones, tal como aparecen en el convenio. */
  declaracioRepresentacio: string | null
  declaracioAcceptacio: string | null
  /**
   * EL CONVENIO ENTERO, tal cual. Su huella es la evidencia de QUÉ se firmó, no solo de
   * que alguien pulsó un botón: se pinta literal y `sha256_texto` viaja de vuelta.
   */
  textConveni: string | null
  sha256Texto: string | null
}

function textCamp(o: Record<string, unknown>, ...claus: string[]): string {
  for (const c of claus) {
    const v = o[c]
    if (typeof v === 'string' && v !== '') return v
  }
  return ''
}

function normalitzaConveni(cos: Record<string, unknown>): DadesConveni {
  // El bloque bueno es `documento` (mismo nombre que en el albarán: para la función es
  // «el documento de este enlace»), y los datos de la organización van dentro, en
  // `organitzacio`. Se aceptan `conveni`/`convenio` como alias por si el contrato se
  // mueve: prefiero un cliente que aguante la variante a una página en blanco delante de
  // quien está a punto de firmar.
  const conv = (cos.documento ?? cos.conveni ?? cos.convenio ?? {}) as Record<string, unknown>
  const org = (conv.organitzacio ?? conv.datos_org ?? cos.organitzacio ?? {}) as Record<string, unknown>
  const form = (cos.formulari ?? {}) as Record<string, unknown>
  const decl = (cos.declaracions ?? {}) as Record<string, unknown>
  const camp = (...claus: string[]) => textCamp(org, ...claus)
  const roles = Array.isArray(conv.roles_com)
    ? (conv.roles_com as unknown[]).filter((r): r is string => typeof r === 'string')
    : []
  const obligatoris = Array.isArray(form.obligatoris)
    ? (form.obligatoris as unknown[]).filter((r): r is string => typeof r === 'string')
    : []

  return {
    proposito: text(cos.proposito) ?? 'firma_convenio',
    estado: text(cos.estado) ?? text(cos.estado_efectivo) ?? 'activo',
    destinatari: text(cos.destinatari) ?? text(cos.destinatario_nombre),
    assistida: form.assistida === true,
    // Ante la duda, **sí hace falta código**: pedirlo de más solo cuesta un paso; darlo por
    // no necesario cuando el enlace lo lleva acaba en un 403 después de rellenarlo todo,
    // que es la peor manera de enterarse.
    calCodi: form.cal_codi === true,
    potDemanarCodi: form.pot_demanar_codi === true,
    conveni: {
      id: text(conv.id) ?? '',
      tipus: text(conv.variant) ?? text(conv.tipo) ?? '',
      estat: text(conv.estado) ?? text(conv.estat) ?? '',
      numero_completo: text(conv.numero_completo) ?? text(conv.numero),
      idioma: text(conv.idioma) ?? 'ca',
      /** El nombre del modelo ya traducido por el servidor, en el idioma del convenio. */
      model: text(conv.model),
      titol: text(conv.titol),
      rolesCom: roles,
    },
    organitzacio: {
      tipus_org: text(conv.tipo_org) ?? text(org.tipo_org) ?? '',
      nom: text(org.raso_social) ?? text(org.nom) ?? text(org.nombre),
      raso_social: camp('raso_social', 'razon_social', 'nom', 'nombre'),
      nom_comercial: camp('nom_comercial', 'nombre_comercial'),
      nif: camp('nif'),
      domicili: camp('domicili', 'domicilio', 'direccion'),
      codi_postal: camp('codi_postal', 'codigo_postal'),
      poblacio: camp('poblacio', 'poblacion'),
      representant: camp('representant', 'representante'),
      carrec: camp('carrec', 'cargo'),
      email: camp('email'),
    },
    // Qué campos son obligatorios lo dice el SERVIDOR, que es quien va a rechazar el
    // envío. Si esta lista se escribiera aquí, el día que cambie la regla el formulario
    // dejaría firmar y el 400 llegaría después de todo el trabajo.
    obligatoris,
    // Las dos declaraciones vienen con el texto de la plantilla, en el idioma del
    // convenio: son parte de lo que se firma, no una etiqueta de interfaz.
    declaracioRepresentacio: text(decl.representacio),
    declaracioAcceptacio: text(decl.acceptacio),
    textConveni: text(cos.text_conveni) ?? text(cos.text_confirmacio) ?? null,
    sha256Texto: text(cos.sha256_texto),
  }
}

/** Carga el convenio que hay detrás del token. El servidor deja la evidencia de apertura. */
export async function carregaConveni(token: string): Promise<ResultatEnllac<DadesConveni>> {
  const res = await demanaEnllac(token)
  if (!res.ok) return res
  // Un token de albarán abierto en `/signar` responde 200 y trae otra cosa. Sin esto la
  // pantalla pintaría un convenio vacío, que es la peor forma de fallar: parece que va.
  const proposito = text(res.data.proposito)
  if (proposito && proposito !== 'firma_convenio') return falla('proposit_incorrecte')
  return { ok: true, data: normalitzaConveni(res.data) }
}

export interface Firma {
  dades: DadesOrganitzacio
  /** Quién firma y con qué cargo. Suele coincidir con representante/cargo, pero no siempre. */
  nom: string
  carrec: string
  /**
   * ⚠️ DNI/NIE de quien firma. Viaja al servidor y muere en `evidencias`, que está fuera
   * del GRANT de SELECT de `authenticated`: **ninguna pantalla del equipo lo lee**.
   */
  documentIdentitat: string
  declaracioRepresentacio: boolean
  acceptacio: boolean
  /** PNG del trazo en data URI. El servidor lo guarda en la carpeta de evidencias. */
  firmaPng: string
  /** Huella del texto que se ha enseñado. El servidor corta con 409 si ya no coincide. */
  sha256Texto: string | null
  /** Honeypot: siempre vacío en una persona. Si viene lleno, el servidor finge un 200. */
  web: string
}

export interface ResultatFirma {
  numero: string | null
  estat: string
  /** El PDF se genera después del commit: al firmar todavía no hay nada que descargar. */
  pdfPendent: boolean
}

/**
 * Firma el convenio.
 *
 * Los campos van **planos**, con los nombres que la función lee: es su vocabulario, no el
 * nuestro (misma regla que los códigos de error). El servidor valida otra vez todo lo que
 * se valida aquí, y su 400 dice qué campo falla; esta pantalla solo evita llegar hasta ahí.
 */
export async function signaConveni(
  token: string,
  firma: Firma,
): Promise<ResultatEnllac<ResultatFirma>> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/enlace-publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        t: token,
        accion: 'firmar',
        ...firma.dades,
        nombre: firma.nom,
        cargo: firma.carrec,
        documento_identidad: firma.documentIdentitat,
        declaracio_representacio: firma.declaracioRepresentacio,
        acceptacio: firma.acceptacio,
        signatura_base64: firma.firmaPng,
        sha256_texto: firma.sha256Texto,
        web: firma.web,
      }),
    })
    const cos = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !cos) return falla(codiDe(res.status, cos?.code))
    const conv = (cos.conveni ?? cos.convenio ?? {}) as Record<string, unknown>
    return {
      ok: true,
      data: {
        numero: text(conv.numero) ?? text(conv.numero_completo),
        estat: text(conv.estat) ?? text(conv.estado) ?? 'firmat',
        pdfPendent: cos.pdf_pendent === true,
      },
    }
  } catch {
    return falla('xarxa')
  }
}

/** Pide el código de 6 cifras por correo (segundo factor de la firma asistida). */
export async function enviaCodiFirma(token: string): Promise<ResultatEnllac<{ destinatari: string | null }>> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/enlace-publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, accion: 'enviar_codi' }),
    })
    const cos = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !cos) return falla(codiDe(res.status, cos?.code))
    return { ok: true, data: { destinatari: text(cos.destinatari) } }
  } catch {
    return falla('xarxa')
  }
}

/** Valida el código. Un fallo también deja evidencia: un intento fallido es información. */
export async function validaCodiFirma(
  token: string,
  codi: string,
): Promise<ResultatEnllac<{ valid: boolean }>> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/enlace-publico`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, accion: 'validar_codi', codi }),
    })
    const cos = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !cos) return falla(codiDe(res.status, cos?.code))
    // Un código incorrecto puede llegar como 200 con `valid:false` o como 4xx con su
    // código: los dos caminos tienen que acabar en el mismo mensaje.
    if (cos.valid === false) return falla('codi_incorrecte')
    return { ok: true, data: { valid: true } }
  } catch {
    return falla('xarxa')
  }
}
