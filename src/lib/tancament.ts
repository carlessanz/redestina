// Cliente del cierre anual y del certificado de donación (CD: anual, de intervalo y de
// oferta), y lo que hace falta para llegar a ellos (calcular, resumen, factura, 182).
//
// El certificado de transacción (CT, venta y maquila) se retiró el 05-11-2026
// (`20270509100400`): sus RPC responden `22023 certificat_transaccio_retirat` y aquí ya no
// hay envoltorios. Lo emitido se conserva y se descarga como cualquier documento.
//
// Igual que `albarans.ts`, todo es RPC y **ninguna escritura directa**: `authenticated` no
// tiene INSERT ni UPDATE sobre `cierres_ejercicio`, `cierres_donante` ni
// `cierre_donante_lineas` (20261109100000). Cada acción mueve varias tablas en una
// transacción —pedir número de serie, congelar el snapshot, crear el enlace de subida de
// factura, encolar el PDF— y una transacción no cabe en un `update` desde el navegador.
//
// Y **nunca lanza**: devuelve `ok`, y cuando no, el mensaje que da la base. Ese mensaje es
// más útil que cualquier frase nuestra, porque dice la regla incumplida con nombre y
// apellidos: «Aquest donant esta bloquejat: 3 canalitzacions sense conciliar (412.0 kg)».

import { supabase } from './supabase'
import type { ResultatRpc } from './albarans'
import type { BloqueigCierre, CierreDonante, CierrePeriodo } from '../types'
import { bloqueja } from './tancamentFormat'
import type { Fila182 } from './tancamentFormat'
import type { Exclosa } from './certificatsDonacio'

// Lo puro (formato de importes, estilos, el CSV del 182…) vive en `tancamentFormat.ts`, sin
// el cliente de Supabase, para poder probarlo desde Vitest (el patrón de
// `campsFundacio`/`parametresFundacio`). Se reexporta aquí para que nadie cambie su import.
export {
  euros, eurKg, estilEstatDonant, estilEstatTancament, bloqueja, dataTancament,
  exerciciDeNumero, csv182,
} from './tancamentFormat'
export type { Fila182 } from './tancamentFormat'

/** Fila de `comparar_cierre_prueba()`. */
export interface FilaComparacio {
  donante: string | null
  nif: string | null
  kg_calculado: number | null
  valor_calculado: number | null
  kg_real: number | null
  valor_real: number | null
  dif_kg: number | null
  dif_valor: number | null
  coincide: boolean | null
}

/** Lo que devuelve `calcular_cierre()`. */
export interface ResumCalcul {
  tancament: string
  exercici: number
  mode: 'prueba' | 'real'
  donants: number
  linies: number
  kg_total: number
  valor_total: number
  bloquejats: number
}

/** Lo que devuelve `emitir_resumen()`. El `token` es la única vez que existe en claro. */
export interface ResultatResum {
  document: string
  numero: string | null
  enllac: string | null
  token: string | null
  destinatari: Record<string, unknown> | null
}

/** Lo que devuelve `emitir_certificado()` / `rectificar_certificado()`. */
export interface ResultatCertificat {
  document: string
  numero: string | null
  data?: string | null
  import?: number | null
  kg?: number | null
  versio?: number
  excepcio?: boolean
}

export interface ResultatReinici {
  tancament: string
  documents: number
  enllacos: number
  donants: number
  linies: number
  /** Las dos cifras que tienen que ser las mismas antes y después: es la aceptación. */
  canalitzacions: number
  albarans: number
}

/** Envoltorio único de `supabase.rpc`. Mismo contrato que el de `albarans.ts`. */
async function crida<T>(
  nom: string,
  args: Record<string, unknown>,
  claveFallback: string,
): Promise<ResultatRpc<T>> {
  try {
    const { data, error } = await supabase.rpc(nom, args)
    if (error) {
      return { ok: false, missatge: error.message || claveFallback, codi: error.code ?? null }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, missatge: claveFallback, codi: null }
  }
}

// --- El cierre ------------------------------------------------------------

/** Abrir. En modo `real` la base exige super_admin: aquí no se replica esa regla. */
export function obrirTancament(
  exercici: number,
  mode: 'prueba' | 'real',
): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('abrir_cierre', { p_ejercicio: exercici, p_modo: mode }, 'tan.err_generic')
}

/** Recalcular: reescribe líneas, totales y bloqueos; no toca números ni facturas. */
export function calcularTancament(id: string): Promise<ResultatRpc<ResumCalcul>> {
  return crida('calcular_cierre', { p_cierre: id }, 'tan.err_generic')
}

/**
 * Cerrar **este** cierre: recalcula, emite los resúmenes definitivos y lo pasa a `tancat`.
 *
 * ⚠️ Antes esto llamaba a `congelar_ejercicio(int)`, que es del **job**: tiene revocado el
 * EXECUTE a `authenticated` desde `20261109100300`, así que respondía `42501` a cualquier
 * sesión y **el botón no funcionaba nunca**. El comentario de entonces decía que se enseñaba
 * el error «para que quien lo pulsa lea por qué no puede», pero no había ningún «por qué»:
 * era la llamada equivocada. Y además congelaba TODOS los cierres del año, no el que se
 * tiene delante — incluido el real, desde un botón puesto sobre un ensayo.
 *
 * `cerrar_cierre(uuid)` es la buena: existe desde la misma migración, tiene su GRANT, exige
 * `pot_aprovar()` —y `es_super_admin()` si el cierre es real— y actúa sobre uno solo.
 */
export function tancarTancament(id: string): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('cerrar_cierre', { p_cierre: id }, 'tan.err_generic')
}

/** El ejercicio ya se ha presentado en el 182. */
export function marcarDeclarat(id: string): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('marcar_declarado', { p_cierre: id }, 'tan.err_generic')
}

/** Repetir el ensayo. No toca ninguna canalización ni ningún albarán. */
export function reiniciarTancamentProva(id: string): Promise<ResultatRpc<ResultatReinici>> {
  return crida('reiniciar_cierre_prueba', { p_cierre: id }, 'tan.err_generic')
}

// --- El donante -----------------------------------------------------------

/** Resumen anual. `provisional=false` es el definitivo, el que pide la factura de verdad. */
export function emetreResum(cd: string, provisional: boolean): Promise<ResultatRpc<ResultatResum>> {
  return crida('emitir_resumen', { p_cd: cd, p_provisional: provisional }, 'tan.err_generic')
}

/** La factura que ha llegado. Sin importe queda en `factura_rebuda`; con él, compara. */
export function registrarFactura(camps: {
  cd: string
  numero: string
  data: string | null
  import: number | null
  docExtern: string | null
}): Promise<ResultatRpc<CierreDonante>> {
  return crida('registrar_factura', {
    p_cd: camps.cd,
    p_numero: camps.numero,
    p_fecha: camps.data,
    p_importe: camps.import,
    p_doc_externo: camps.docExtern,
  }, 'tan.err_generic')
}

/** Solo en un cierre de prueba: inventa la factura con la desviación que se le pida. */
export function simularFactura(
  cd: string,
  desviacioPct: number,
): Promise<ResultatRpc<CierreDonante>> {
  return crida('simular_factura', {
    p_cd: cd,
    p_desviacion_pct: desviacioPct,
    p_numero: null,
    p_fecha: null,
  }, 'tan.err_generic')
}

/** La fecha de expedición y el anexo por producto (05-11-2026, `20270509100200`). */
export interface OpcionsExpedicio {
  /** ISO. `null` = la de la base: 31-12 del ejercicio en el anual, hoy en los demás. */
  dataExpedicio?: string | null
  /** «Annex amb el detall per producte»: una segunda página con el desglose. */
  annex?: boolean
}

/**
 * El certificado anual de un donante.
 *
 * ⚠️ **La factura ya no lo condiciona** (decisión del cliente, 21-09-2026): `p_motivo_excepcion`
 * se conserva en la firma y se ignora, así que este envoltorio manda siempre `null`.
 *
 * La fecha de expedición la elige el super_admin; la base la acepta entre el 31-12 del
 * ejercicio (hoy, en un ensayo en curso) y hoy, o responde `22023 data_expedicio_fora_rang`.
 */
export function emetreCertificat(
  cd: string,
  opcions: OpcionsExpedicio = {},
): Promise<ResultatRpc<ResultatCertificat>> {
  return crida('emitir_certificado', {
    p_cd: cd,
    p_motivo_excepcion: null,
    p_data_expedicio: opcions.dataExpedicio ?? null,
    p_annex: opcions.annex ?? false,
  }, 'tan.err_generic')
}

// --- Certificado a demanda: intervalo u oferta -----------------------------
//
// El mismo acumulado de un donante, pero de una VENTANA de fechas dentro de un ejercicio
// (`abast = 'periode'`) o de UNA oferta (`abast = 'oferta'`, la ventana la deriva la base de
// sus recogidas certificables). Vive en `cierres_periodo`, con serie propia (`CDP`), y **no
// abre ningún cierre**. 🔴 Solo cuenta la donación conciliada a una entidad `social`; lo que
// se queda fuera lo dice `excloses()`.

export interface ResultatCertificatPeriode {
  document: string
  numero: string | null
  /** Cuántos certificados anteriores quedan sustituidos por este. */
  substitueix?: number
  abast?: 'periode' | 'oferta'
  data_expedicio?: string | null
  periode?: { des_de: string; fins_a: string } | null
}

/**
 * El borrador de un certificado a demanda, con sus kilos y sus bloqueos.
 *
 * ⚠️ **Escribe**: inserta (o actualiza) la fila de `cierres_periodo` aunque después no se
 * emita nada (deuda §12.112). Con `excedente` las fechas se ignoran: la ventana es la de la
 * oferta. La base rechaza con `22023` y un mensaje útil (`oferta_sense_certificable`, dos
 * ejercicios, periodo no acabado, ya certificado).
 */
export function calcularCertificatPeriode(c: {
  productor: string
  desde: string | null
  hasta: string | null
  modo: 'prueba' | 'real'
  excedente?: string | null
}): Promise<ResultatRpc<CierrePeriodo>> {
  return crida('calcular_certificado_periodo', {
    p_productor: c.productor,
    p_desde: c.desde,
    p_hasta: c.hasta,
    p_modo: c.modo,
    p_excedente: c.excedente ?? null,
  }, 'tan.err_generic')
}

/**
 * Emitirlo. Consume un número de la serie `CDP` y no se puede deshacer: solo rectificar.
 * Con `excedente`, la base comprueba que el borrador es de esa oferta (`oferta_no_coincideix`).
 * La fecha de expedición, por defecto hoy, entre el fin del periodo y hoy.
 */
export function emetreCertificatPeriode(
  periode: string,
  opcions: OpcionsExpedicio & { excedente?: string | null } = {},
): Promise<ResultatRpc<ResultatCertificatPeriode>> {
  return crida('emitir_certificado_periodo', {
    p_periodo: periode,
    p_motivo_excepcion: null,
    p_data_expedicio: opcions.dataExpedicio ?? null,
    p_annex: opcions.annex ?? false,
    p_excedente: opcions.excedente ?? null,
  }, 'tan.err_generic')
}

/**
 * Lo que se queda FUERA del certificado de un donante, con su motivo: venta, maquila,
 * entidad no social, sin entidad, sin modalidad o conciliación retroactiva (en real). Solo
 * el equipo (`es_intern`). Con `excedente`, las fechas pueden ir a null.
 */
export function excloses(c: {
  productor: string
  desde: string | null
  fins: string | null
  excedente?: string | null
  modo: 'prueba' | 'real'
}): Promise<ResultatRpc<Exclosa[]>> {
  return crida('cierre_exclosos_periodo', {
    p_productor: c.productor,
    p_desde: c.desde,
    p_fins: c.fins,
    p_excedente: c.excedente ?? null,
    p_modo: c.modo,
  }, 'tan.err_generic')
}

/** Un donante saltado por la emisión en bloque, con el motivo que dio la base. */
export interface DonantSaltat {
  cd: string
  donant: string | null
  codi: 'bloquejat' | 'sense_kg' | 'error'
  motiu: string
}

export interface ResultatCertificatsMassius {
  tancament: string
  exercici: number
  mode: 'prueba' | 'real'
  emesos: number
  ja_tenien: number
  saltats: DonantSaltat[]
}

/**
 * Todos los certificados de un cierre, de una vez.
 *
 * Es un botón APARTE de «Tanca l'exercici», y eso es deliberado: cerrar ya es el acto
 * irreversible, y encadenarle la emisión quitaría el momento de revisar la lista. Lo mismo
 * vale para el job del 31 de diciembre, que corre sin sesión: emitiría N documentos legales
 * con la autoría en blanco y nadie mirando.
 *
 * Nunca lanza: los saltados vienen dentro del resultado, con su motivo, para poder
 * enseñarlos uno a uno en vez de un «han fallado 3».
 */
export function emetreCertificatsTancament(
  cierre: string,
  opcions: OpcionsExpedicio = {},
): Promise<ResultatRpc<ResultatCertificatsMassius>> {
  return crida('emitir_certificados_cierre', {
    p_cierre: cierre,
    p_data_expedicio: opcions.dataExpedicio ?? null,
    p_annex: opcions.annex ?? false,
  }, 'tan.err_generic')
}

/** Versión siguiente del mismo CD; no consume número nuevo. */
export function rectificarCertificat(
  cd: string,
  motiu: string,
): Promise<ResultatRpc<ResultatCertificat>> {
  return crida('rectificar_certificado', { p_cd: cd, p_motivo: motiu }, 'tan.err_generic')
}

export function marcarEnviat(cd: string): Promise<ResultatRpc<CierreDonante>> {
  return crida('marcar_enviado', { p_cd: cd }, 'tan.err_generic')
}

/** Lo que la escalera del ciclo guiado necesita del cierre de un generador. */
export interface CertificatDelGenerador {
  tipo: 'donacio' | 'transaccio'
  certificado_numero: string | null
  bloqueja: boolean
}

/**
 * Los acumulados (CD y/o CT) de UN generador en UN cierre, para el último escalón de la
 * pantalla guiada. `null` si no se han podido leer: entonces la escalera usa su
 * aproximación de siempre en vez de afirmar que no hay certificado.
 */
export async function certificatsDelGenerador(
  cierre: string,
  productor: string,
): Promise<CertificatDelGenerador[] | null> {
  try {
    const { data, error } = await supabase
      .from('cierres_donante')
      .select('tipo, certificado_numero, bloqueos')
      .eq('cierre_id', cierre)
      .eq('productor_id', productor)
    if (error || !data) return null
    return data.map((f) => ({
      tipo: f.tipo as CertificatDelGenerador['tipo'],
      certificado_numero: (f.certificado_numero as string | null) ?? null,
      bloqueja: bloqueja(f.bloqueos as BloqueigCierre[] | null),
    }))
  } catch {
    return null
  }
}

// --- Informes -------------------------------------------------------------

export function dades182(cierre: string): Promise<ResultatRpc<Fila182[]>> {
  return crida('datos_182', { p_cierre: cierre }, 'tan.err_generic')
}

export function compararTancamentProva(
  cierre: string,
  reals: unknown[],
): Promise<ResultatRpc<FilaComparacio[]>> {
  return crida('comparar_cierre_prueba', { p_cierre: cierre, p_reales: reals }, 'tan.err_generic')
}

// --- Costes por kilo de REFERENCIA ----------------------------------------
//
// Uno por producto, sin ejercicio (20270405100200). Es solo la referencia: el coste de cada
// oferta lo declara el productor al publicarla (`excedentes.coste_kg`).

export function fixarCostProducte(camps: {
  producte: string
  cost: number
  motiu: string
}): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('fijar_coste_producto', {
    p_producto: camps.producte,
    p_coste: camps.cost,
    p_motivo: camps.motiu,
  }, 'cost.err_generic')
}

export function esborrarCostProducte(
  producte: string,
  motiu: string,
): Promise<ResultatRpc<Record<string, unknown>>> {
  // El motivo NO es opcional: la RPC responde 22023 si llega vacío. Borrar un coste es
  // tan trazable como cambiarlo, y queda en `costes_producto_hist` con prefijo [esborrat].
  return crida('borrar_coste_producto', {
    p_producto: producte,
    p_motivo: motiu,
  }, 'cost.err_generic')
}

/** Descarga un texto como fichero. Sin dependencias: un blob y un `<a>` de un solo uso. */
export function descarregarText(nom: string, contingut: string, mime: string) {
  descarregarBlob(nom, new Blob([contingut], { type: mime }))
}

/** Descarga un fichero ya hecho (el Excel de la plantilla o de la exportación de entidades). */
export function descarregarBlob(nom: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Sin esto el blob se queda en memoria hasta que se cierre la pestaña.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
