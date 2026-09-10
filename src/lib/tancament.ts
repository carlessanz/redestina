// Cliente del cierre anual: los certificados de donación y lo que hace falta para llegar
// a ellos (calcular, resumen, factura, excepción, 182).
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
import type { BloqueigCierre, CierreDonante } from '../types'

/** Fila de `datos_182()`. Es el retorno de una función, no una tabla: vive aquí. */
export interface Fila182 {
  nif: string | null
  razon_social: string | null
  codigo_postal: string | null
  provincia: string | null
  importe: number | null
  kg: number | null
  en_especie: boolean
  certificado_numero: string | null
  fecha: string | null
  modo: string
}

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
 * Cerrar el ejercicio.
 *
 * ⚠️ `congelar_ejercicio()` es hoy del **job**: la migración 20261109100200 le revoca el
 * EXECUTE a `authenticated`. Se llama igual y se enseña el error de la base tal cual, en
 * vez de esconder el botón: la acción existe en el circuito y quien la pulsa merece leer
 * por qué no puede, no encontrarse un panel sin ella.
 */
export function congelarExercici(exercici: number): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('congelar_ejercicio', { p_ejercicio: exercici }, 'tan.err_generic')
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

/** El certificado. Sin factura coincidente lo exige la base: super_admin **y** motivo. */
export function emetreCertificat(
  cd: string,
  motiuExcepcio: string | null,
): Promise<ResultatRpc<ResultatCertificat>> {
  return crida('emitir_certificado', {
    p_cd: cd,
    p_motivo_excepcion: motiuExcepcio,
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

// --- Costes por kilo ------------------------------------------------------

export function fixarCostProducte(camps: {
  producte: string
  exercici: number
  cost: number
  motiu: string
}): Promise<ResultatRpc<Record<string, unknown>>> {
  return crida('fijar_coste_producto', {
    p_producto: camps.producte,
    p_ejercicio: camps.exercici,
    p_coste: camps.cost,
    p_motivo: camps.motiu,
  }, 'cost.err_generic')
}

export function esborrarCostProducte(
  producte: string,
  exercici: number,
  motiu: string,
): Promise<ResultatRpc<Record<string, unknown>>> {
  // El motivo NO es opcional: la RPC responde 22023 si llega vacío. Borrar un coste es
  // tan trazable como cambiarlo, y queda en `costes_producto_hist` con prefijo [esborrat].
  return crida('borrar_coste_producto', {
    p_producto: producte,
    p_ejercicio: exercici,
    p_motivo: motiu,
  }, 'cost.err_generic')
}

// --- Presentación ---------------------------------------------------------

/** Importe en euros. Siempre con los dos decimales: es una cifra fiscal. */
export function euros(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = Number(valor)
  if (Number.isNaN(n)) return '—'
  return n.toLocaleString('es-ES', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

/** Coste por kilo: 4 decimales, porque 0,32 €/kg y 0,3175 €/kg no son lo mismo. */
export function eurKg(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = Number(valor)
  if (Number.isNaN(n)) return '—'
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/kg`
}

/** Estado del donante → clase de token. El error es rojo; el coral no significa fallo. */
export function estilEstatDonant(estat: string): string {
  switch (estat) {
    case 'declarat':
    case 'enviat':
    case 'certificat_emes':
    case 'coincident':
      return 'bg-exito-fondo text-exito'
    case 'discrepancia':
      return 'bg-error-fondo text-error'
    case 'resum_enviat':
    case 'factura_pendent':
    case 'factura_rebuda':
      return 'bg-aviso-fondo text-aviso'
    default:
      return 'bg-secondary text-secondary-foreground'
  }
}

/** Estado del cierre → clase de token. */
export function estilEstatTancament(estat: string): string {
  switch (estat) {
    case 'declarat': return 'bg-exito-fondo text-exito'
    case 'tancat': return 'bg-secondary text-secondary-foreground'
    case 'provisional': return 'bg-aviso-fondo text-aviso'
    default: return 'bg-muted text-muted-foreground'
  }
}

/** ¿Hay algún bloqueo que impida el certificado? Los demás solo avisan. */
export function bloqueja(bloqueos: BloqueigCierre[] | null | undefined): boolean {
  return (bloqueos ?? []).some((b) => b.bloqueja)
}

/** Fecha del ISO, sin hora. */
export function dataTancament(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

/**
 * El ejercicio que se lee en un número de serie (`P-RES-2026-0001` → 2026).
 *
 * Hace falta porque la política de `cierres_ejercicio` es **solo del equipo**
 * (20261109100000): el donante ve su fila de `cierres_donante` pero no la cabecera, así
 * que en su panel el año no puede salir de un `join`. Sale de su propio número, que es un
 * dato suyo, o de `documentos.ejercicio`, que también lo es.
 */
export function exerciciDeNumero(numero: string | null | undefined): number | null {
  if (!numero) return null
  const m = /(?:^|-)((?:19|20)\d{2})-/.exec(numero)
  return m ? Number(m[1]) : null
}

// --- Exportación del 182 --------------------------------------------------

const COLUMNES_182: (keyof Fila182)[] = [
  'nif', 'razon_social', 'codigo_postal', 'provincia', 'importe', 'kg',
  'en_especie', 'certificado_numero', 'fecha', 'modo',
]

/** Una celda de CSV con `;`: comillas dobladas y entrecomillado si hace falta. */
function cella(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  // Los números van con COMA decimal: el destino es un Excel en español, y un punto
  // decimal ahí se lee como texto (o como millares, que es peor porque no avisa).
  const text = typeof valor === 'number'
    ? valor.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
    : String(valor)
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * El CSV del 182, con `;` y **con BOM**.
 *
 * Las dos cosas son por Excel en español y ninguna es opcional: sin `;` mete la fila
 * entera en la columna A, y sin el BOM `UTF-8` lee los acentos como mojibake —«Fundació»
 * sale «FundaciÃ³»— en un fichero que va a una gestoría. `\r\n` por lo mismo.
 */
export function csv182(files: Fila182[], capceleres: Record<string, string>): string {
  const linies = [
    COLUMNES_182.map((c) => cella(capceleres[c] ?? c)).join(';'),
    ...files.map((f) => COLUMNES_182.map((c) => cella(f[c])).join(';')),
  ]
  return `\uFEFF${linies.join('\r\n')}\r\n`
}

/** Descarga un texto como fichero. Sin dependencias: un blob y un `<a>` de un solo uso. */
export function descarregarText(nom: string, contingut: string, mime: string) {
  const blob = new Blob([contingut], { type: mime })
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
