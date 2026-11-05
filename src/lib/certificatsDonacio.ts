// El certificado de donación visto desde la interfaz: el ámbito, la fecha de expedición y
// el motivo por el que una canalización se queda fuera. PURO, con test
// (`tests/certificatsDonacio.test.ts`).
//
// 🔴 Lo que entra en un certificado lo decide la BASE (`cierre_base_periodo()`: solo
//    donación conciliada a una entidad `social`), y lo que se queda fuera lo lista
//    `cierre_exclosos_periodo()`. Aquí no se filtra nada: solo se dice con palabras.
//
// La fecha de expedición tiene el mismo rango que comprueba la base
// (`emitir_certificado*()`, `22023 data_expedicio_fora_rang`): se replica para no dejar
// elegir una fecha que la base va a rechazar, pero quien manda sigue siendo la RPC.

import { textPeriode } from '../../supabase/functions/_shared/certificatDonacio.ts'
import type { AbastCertificat } from '../../supabase/functions/_shared/certificatDonacio.ts'

export type { AbastCertificat }

/**
 * Los ámbitos que ofrece el diálogo, EN ESTE ORDEN, y el que sale elegido.
 *
 * ⚠️ PENDIENTE DEL CLIENTE: cómo elige el equipo entre oferta, intervalo y ejercicio (plan
 *    «Certificat de donació según el modelo de Tabaquet»). El motor admite los tres; la
 *    respuesta solo cambia estas dos constantes (el orden, el de por defecto o quitar uno).
 */
export const ABASTS_DIALEG: readonly AbastCertificat[] = ['oferta', 'periode', 'exercici']
export const ABAST_PER_DEFECTE: AbastCertificat = 'oferta'

/** La clave i18n del nombre del ámbito («Oferta», «Interval», «Exercici»). */
export function clauAbast(abast: AbastCertificat): string {
  return `cdon.abast_${abast}`
}

/** El ámbito de una fila de `cierres_periodo` (las anteriores al 05-11-2026 no traen `abast`). */
export function abastPeriode(fila: { abast?: string | null; excedente_id?: string | null }): AbastCertificat {
  if (fila.abast === 'oferta' || fila.excedente_id) return 'oferta'
  return 'periode'
}

// --- Las exclusiones ---------------------------------------------------------

/** Lo que pinta la interfaz de un motivo: la clave y, si es una entidad no social, su tipo. */
export interface EtiquetaMotiu {
  clau: string
  /**
   * El `tipo_receptor` de la entidad cuando el motivo es `entitat_no_social:<tipus>`; la
   * pantalla lo traduce con `org.tr_<tipus>` (o `cdon.tipus_desconegut`).
   */
  tipus: string | null
}

const MOTIUS: Record<string, string> = {
  venda: 'cdon.mot_venda',
  maquila: 'cdon.mot_maquila',
  sense_entitat: 'cdon.mot_sense_entitat',
  sense_valoritzacio: 'cdon.mot_sense_valoritzacio',
  conciliacio_retroactiva: 'cdon.mot_retroactiva',
}

/** Los tipos de receptor que tienen nombre (`org.tr_*`); el resto se dice «desconegut». */
const TIPUS_CONEGUTS = ['social', 'animal', 'transformador', 'comercial']

/**
 * El motivo de `cierre_exclosos_periodo().motiu`, listo para traducir. Un motivo que la
 * interfaz no conoce (uno nuevo en la base) se dice como «altre motiu» y no se inventa.
 */
export function motiuExclusio(motiu: string | null | undefined): EtiquetaMotiu {
  const m = (motiu ?? '').trim()
  if (m.startsWith('entitat_no_social')) {
    const tipus = m.split(':')[1] ?? ''
    return { clau: 'cdon.mot_no_social', tipus: TIPUS_CONEGUTS.includes(tipus) ? tipus : 'desconegut' }
  }
  return { clau: MOTIUS[m] ?? 'cdon.mot_altre', tipus: null }
}

/** La clave del nombre del tipo de receptor de una exclusión. */
export function clauTipus(tipus: string): string {
  return tipus === 'desconegut' ? 'cdon.tipus_desconegut' : `org.tr_${tipus}`
}

/** Una fila de `cierre_exclosos_periodo()`. */
export interface Exclosa {
  canalizacion_id: string
  excedente_id: string
  id_excedente: string | null
  producto: string | null
  entidad_id: string | null
  entidad: string | null
  tipo_receptor: string | null
  valorizacion: string | null
  data: string | null
  kg: number | null
  motiu: string
}

/** Los kilos que se quedan fuera, en total. */
export function kgExclosos(files: readonly Pick<Exclosa, 'kg'>[]): number {
  return files.reduce((s, f) => s + Number(f.kg ?? 0), 0)
}

// --- La fecha de expedición --------------------------------------------------

/** El 31-12 de un ejercicio, en ISO. */
export function fiExercici(exercici: number): string {
  return `${exercici}-12-31`
}

function menor(a: string, b: string): string {
  return a <= b ? a : b
}

export interface ContextData {
  /** Hoy en Madrid (`avuiMadrid()`), ISO. */
  avui: string
  /** Fin del periodo certificado (oferta e intervalo): lo da el cálculo. */
  periodeFins?: string | null
  /** El ejercicio del certificado anual. */
  exercici?: number | null
  /** El modo: en prueba, un anual del ejercicio en curso se puede expedir hoy. */
  mode?: 'prueba' | 'real'
}

/** Rango válido `[min, max]`, en ISO. `min` null = todavía no se sabe (falta calcular). */
export interface Rang { min: string | null; max: string }

/**
 * El rango que acepta la base:
 *   · oferta e intervalo: del fin del periodo a hoy;
 *   · anual: del 31-12 del ejercicio a hoy; en prueba, si el ejercicio no ha acabado, desde
 *     hoy (es un ensayo y la base lo deja: `least(31-12, hoy)`).
 */
export function rangDataExpedicio(abast: AbastCertificat, c: ContextData): Rang {
  if (abast === 'exercici') {
    if (!c.exercici) return { min: null, max: c.avui }
    const fi = fiExercici(c.exercici)
    return { min: c.mode === 'prueba' ? menor(fi, c.avui) : fi, max: c.avui }
  }
  return { min: c.periodeFins ?? null, max: c.avui }
}

/** Por defecto: hoy (oferta e intervalo) o el 31-12 del ejercicio (anual; hoy en un ensayo en curso). */
export function dataExpedicioPerDefecte(abast: AbastCertificat, c: ContextData): string {
  if (abast === 'exercici') return rangDataExpedicio(abast, c).min ?? c.avui
  return c.avui
}

/** ¿Hay alguna fecha posible? (un anual real del ejercicio en curso no la tiene: aún no ha acabado). */
export function rangPossible(r: Rang): boolean {
  return r.min === null || r.min <= r.max
}

/** ¿Vale esta fecha? Formato ISO y dentro del rango (sin `min`, solo se mira el `max`). */
export function dataExpedicioValida(data: string, r: Rang): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false
  if (data > r.max) return false
  return r.min === null || data >= r.min
}

// --- El periodo en texto -----------------------------------------------------

/**
 * El periodo, con las mismas palabras que el PDF (`textPeriode` del módulo hoja) y la
 * primera letra en mayúscula para que funcione como frase suelta: «El període 01/10/2026 a
 * 31/10/2026», «L'exercici 01/01/2026 a 31/12/2026», «El dia 08/10/2026».
 */
export function textPeriodeUi(
  abast: AbastCertificat,
  desDe: string | null | undefined,
  finsA: string | null | undefined,
  idioma: 'ca' | 'es',
): string {
  const t = textPeriode(abast, desDe ?? '', finsA ?? '', idioma)
  return t.charAt(0).toLocaleUpperCase(idioma) + t.slice(1)
}

/** El periodo de un ejercicio entero, para el anual. */
export function textExercici(exercici: number, idioma: 'ca' | 'es'): string {
  return textPeriodeUi('exercici', `${exercici}-01-01`, fiExercici(exercici), idioma)
}
