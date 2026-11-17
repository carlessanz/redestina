// Los precios de referencia por producto, año y mes (punto 3, fase D1, 17-11-2026).
//
// Lo que la base decide (20270531100000) y aquí solo se pinta:
//   · la PROPUESTA de cada mes (`preus_proposta_mes`, ajuste 20270602100000): Gencat del mes →
//     si Gencat aún no lo tiene, su ÚLTIMO precio publicado (y Mercabarna no se mira) → solo sin
//     Gencat, el ÚLTIMO valor de Mercabarna del mes, con el mes cerrado → manual vigente; un
//     producto `preu_manual` va siempre al manual. Cada precio dice de qué MES sale
//     (`*_mes_font`, `font_mes`): validado con el último Gencat, se queda así;
//   · VALIDAR el mes, en bloque o una celda con motivo (`validar_preus_mes`,
//     `validar_preus_periode`, `fixar_preu_referencia`), las equivalencias con las fuentes,
//     el precio manual y el alta de productos (`crear_producte`).
// Las descargas («Actualitza ara») y el fichero original van por la Edge Function `preus-fonts`.
//
// NUNCA LANZA: contrato de `albarans.ts` (`ResultatRpc`). Los códigos de la base se devuelven
// como clave i18n `preu.err_<codi>` para que `textError()` los traduzca.

import { supabase, supabaseUrl } from './supabase'
import type { ResultatRpc } from './albarans'

export type FontPreu = 'gencat' | 'mercabarna' | 'manual'
export type FontDescarrega = 'gencat' | 'mercabarna'

/** Una fila de `preus_proposta_mes()`. */
export interface PropostaPreu {
  producto: string
  familia: string | null
  preu_manual: boolean
  equivalencies: number
  gencat_eur_kg: number | null
  gencat_nom: string | null
  gencat_carrega: string | null
  mercabarna_eur_kg: number | null
  mercabarna_nom: string | null
  mercabarna_dies: number | null
  manual_eur_kg: number | null
  proposta_font: FontPreu | null
  proposta_eur_kg: number | null
  validat_eur_kg: number | null
  validat_font: FontPreu | null
  validat_nom: string | null
  validat_dies: number | null
  validat_motiu: string | null
  validat_at: string | null
  validat_proposta: number | null
  anterior_eur_kg: number | null
  anterior_exercici: number | null
  anterior_mes: number | null
  /** Mes (`aaaa-mm-dd`) del que sale el valor de Gencat: el pedido o el último publicado. */
  gencat_mes: string | null
  /** Mes del que sale la propuesta (null si es manual). */
  proposta_mes_font: string | null
  /** Mes del que sale lo validado (null si es manual). */
  validat_font_mes: string | null
}

/** Una fila de `preus_carregues` (sin las observaciones). */
export interface CarregaPreus {
  id: string
  font: FontDescarrega
  fitxer_nom: string | null
  mida_bytes: number | null
  data_font: string | null
  periode_fins: string | null
  files: number
  productes: number
  estat: 'pendent' | 'validada' | 'descartada'
  origen: 'job' | 'manual'
  created_at: string
  motiu: string | null
}
// ⚠️ Cada lista de columnas, en UN literal (§7).
export const COLUMNES_CARREGA = 'id, font, fitxer_nom, mida_bytes, data_font, periode_fins, files, productes, estat, origen, created_at, motiu'

/** Una fila de `preus_fonts_estat`. */
export interface EstatFont {
  font: FontDescarrega
  url: string
  automatic: boolean
  darrera_comprovacio_at: string | null
  darrer_resultat: 'nou' | 'sense_canvis' | 'duplicat' | 'error' | null
  darrer_error: string | null
  darrera_carrega_at: string | null
}
export const COLUMNES_ESTAT_FONT = 'font, url, automatic, darrera_comprovacio_at, darrer_resultat, darrer_error, darrera_carrega_at'

/** Una equivalencia de `productes_fonts`. */
export interface EquivalenciaPreu {
  id: string
  producto: string
  font: FontDescarrega
  codi_font: string | null
  nom_font: string
  origen: 'sembra' | 'equip'
}
export const COLUMNES_EQUIVALENCIA = 'id, producto, font, codi_font, nom_font, origen'

/** Una fila de `preus_referencia` (la rejilla del producto). */
export interface PreuValidat {
  producto: string
  exercici: number
  mes: number
  eur_kg: number
  font: FontPreu
  font_nom: string | null
  font_dies: number | null
  /** Mes del que sale el valor; null = el propio mes (o manual). */
  font_mes: string | null
  motiu: string | null
  validat_at: string
}
export const COLUMNES_PREU_VALIDAT = 'producto, exercici, mes, eur_kg, font, font_nom, font_dies, font_mes, motiu, validat_at'

/** Un nombre visto en las últimas cargas (`noms_fonts_preus()`). */
export interface NomFontVist {
  font: FontDescarrega
  codi_font: string | null
  nom_font: string
  unitat: string
  productes: string[]
}

// ---------------------------------------------------------------------------
// Puras (con test)
// ---------------------------------------------------------------------------

/** Los meses del selector. */
export const MESOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

/** El primer año con datos de Gencat (el fichero empieza en 2020). */
export const PRIMER_EXERCICI = 2020
/** A partir de qué variación entre meses se avisa (30 %). */
export const SALT_GRAN = 0.3

/** El mes actual en hora de Madrid. */
export function mesActual(ara: Date = new Date()): { exercici: number; mes: number } {
  const [a, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' })
    .format(ara).split('-').map(Number)
  return { exercici: a, mes: m }
}

/** El mes anterior a uno dado. */
export function mesAnterior(exercici: number, mes: number): { exercici: number; mes: number } {
  return mes === 1 ? { exercici: exercici - 1, mes: 12 } : { exercici, mes: mes - 1 }
}

/** Los ejercicios del selector, del actual hacia atrás. */
export function exercicisDisponibles(ara: Date = new Date()): number[] {
  const { exercici } = mesActual(ara)
  const out: number[] = []
  for (let a = exercici; a >= PRIMER_EXERCICI; a--) out.push(a)
  return out
}

/** ¿Es futuro (posterior al mes actual)? La base no deja validarlo. */
export function esMesFutur(exercici: number, mes: number, ara: Date = new Date()): boolean {
  const a = mesActual(ara)
  return exercici > a.exercici || (exercici === a.exercici && mes > a.mes)
}

/** Variación relativa, o null si falta alguno de los dos (o el anterior es 0). */
export function variacio(actual: number | null | undefined, anterior: number | null | undefined): number | null {
  if (actual === null || actual === undefined || anterior === null || anterior === undefined) return null
  const a = Number(actual)
  const b = Number(anterior)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null
  return (a - b) / b
}

export function esSaltGran(v: number | null): boolean {
  return v !== null && Math.abs(v) >= SALT_GRAN
}

/** «+12 %» / «−8 %» (signo menos tipográfico). */
export function textVariacio(v: number | null): string {
  if (v === null) return '—'
  const pct = Math.round(v * 100)
  if (pct === 0) return '0 %'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)} %`
}

/** El precio que se enseña en la fila: el validado si lo hay; si no, la propuesta. */
export function preuDeFila(p: PropostaPreu): { eur_kg: number | null; font: FontPreu | null; validat: boolean } {
  if (p.validat_eur_kg !== null) return { eur_kg: Number(p.validat_eur_kg), font: p.validat_font, validat: true }
  return { eur_kg: p.proposta_eur_kg === null ? null : Number(p.proposta_eur_kg), font: p.proposta_font, validat: false }
}

/**
 * ¿La fuente ha cambiado desde que se validó? (un fichero nuevo de Gencat revisa meses). No avisa
 * si lo validado salía de OTRO mes (el último Gencat publicado) y Gencat ya ha publicado este: es
 * lo previsto, y lo validado se queda sin actualizar (decisión del 17-11-2026).
 */
export function fontHaCanviat(p: PropostaPreu): boolean {
  if (p.validat_eur_kg === null || p.validat_font === null || p.validat_font === 'manual') return false
  if (p.validat_font === 'gencat' && p.validat_font_mes !== null && p.gencat_mes !== null
      && p.validat_font_mes.slice(0, 7) !== p.gencat_mes.slice(0, 7)) return false
  const ara = p.validat_font === 'gencat' ? p.gencat_eur_kg : p.mercabarna_eur_kg
  if (ara === null || p.validat_proposta === null) return false
  return Math.abs(Number(ara) - Number(p.validat_proposta)) > 0.00005
}

/** El valor que da cada fuente en una fila (para el desplegable de fuente). */
export function valorDeFont(p: PropostaPreu, font: FontPreu): number | null {
  const v = font === 'gencat' ? p.gencat_eur_kg : font === 'mercabarna' ? p.mercabarna_eur_kg : p.manual_eur_kg
  return v === null ? null : Number(v)
}

export interface ResumMes {
  total: number
  validats: number
  perValidar: number
  sensePreu: number
  salts: number
}

/** Las cifras de la cabecera de un mes. */
export function resumMes(files: readonly PropostaPreu[]): ResumMes {
  let validats = 0
  let perValidar = 0
  let sensePreu = 0
  let salts = 0
  for (const p of files) {
    if (p.validat_eur_kg !== null) validats++
    else if (p.proposta_eur_kg !== null) perValidar++
    else sensePreu++
    if (esSaltGran(variacio(preuDeFila(p).eur_kg, p.anterior_eur_kg))) salts++
  }
  return { total: files.length, validats, perValidar, sensePreu, salts }
}

/** El mes del que sale el precio de la fila (el validado si lo hay; si no, la propuesta). */
export function mesFontDeFila(p: PropostaPreu): string | null {
  return p.validat_eur_kg !== null ? p.validat_font_mes : p.proposta_mes_font
}

/** ¿El precio sale de un mes distinto del de la fila? (el último Gencat publicado) */
export function esDunAltreMes(mesFont: string | null | undefined, exercici: number, mes: number): boolean {
  const m = mesDeData(mesFont ?? null)
  return m !== null && (m.exercici !== exercici || m.mes !== mes)
}

/** «2026-09-01» → { exercici: 2026, mes: 9 }. */
export function mesDeData(d: string | null): { exercici: number; mes: number } | null {
  if (!d) return null
  const m = d.match(/^(\d{4})-(\d{2})/)
  return m ? { exercici: Number(m[1]), mes: Number(m[2]) } : null
}

// ---------------------------------------------------------------------------
// Llamadas
// ---------------------------------------------------------------------------

const CODIS = [
  'mes_futur', 'mes_invalid', 'motiu_obligatori', 'preu_invalid', 'font_invalida', 'producte_inexistent',
  'producte_existent', 'familia_desconeguda', 'nom_invalid', 'nom_font_buit', 'carrega_validada',
  'carrega_inexistent', 'url_invalida', 'periode_invalid', 'periode_massa_llarg',
] as const

function falla<T>(error: { message?: string; code?: string } | null | undefined): ResultatRpc<T> {
  const missatge = error?.message ?? ''
  const codi = CODIS.find((c) => missatge.includes(c))
  if (codi) return { ok: false, missatge: `preu.err_${codi}`, codi: error?.code ?? null }
  if (error?.code === '42501') return { ok: false, missatge: 'preu.err_permis', codi: '42501' }
  return { ok: false, missatge: missatge || 'preu.err_generic', codi: error?.code ?? null }
}

async function rpc<T>(nom: string, args: Record<string, unknown>): Promise<ResultatRpc<T>> {
  try {
    const { data, error } = await supabase.rpc(nom, args)
    if (error) return falla<T>(error)
    return { ok: true, data: data as T }
  } catch {
    return falla<T>(null)
  }
}

export function carregaPropostaMes(exercici: number, mes: number) {
  return rpc<PropostaPreu[]>('preus_proposta_mes', { p_exercici: exercici, p_mes: mes })
}

/**
 * Una fila de `preus_canalitzacions_mes()` (D2, 20270601100000): las canalizaciones cuyo
 * albarán es de ese mes y aún esperan su precio (provisionales, sin certificar). Al validar el
 * mes se ajustan solas; `sense_preu` = ni siquiera tienen uno provisional.
 */
export interface CanalitzacionsMes {
  producto: string
  provisionals: number
  sense_preu: number
  kg: number | null
}

export function carregaCanalitzacionsMes(exercici: number, mes: number) {
  return rpc<CanalitzacionsMes[]>('preus_canalitzacions_mes', { p_exercici: exercici, p_mes: mes })
}

/** `aaaa-mm` → `{exercici, mes}` (el `?mes=` de Productes › Preus). Null si no se lee. */
export function mesDeParam(v: string | null): { exercici: number; mes: number } | null {
  const m = v?.match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const mes = Number(m[2])
  return mes >= 1 && mes <= 12 ? { exercici: Number(m[1]), mes } : null
}

/** El enlace a Productes › Preus de un mes (`aaaa-mm`). */
export function rutaPreusMes(mes: string): string {
  return `/equip/productes?pestanya=preus&mes=${encodeURIComponent(mes)}`
}

export interface CanviPreu { producto: string; font?: FontPreu; eur_kg?: number | null; motiu?: string }

export function validaMes(exercici: number, mes: number, canvis: CanviPreu[] = []) {
  return rpc<{ validats: number; canviats: number; sense_preu: number }>('validar_preus_mes', {
    p_exercici: exercici, p_mes: mes, p_canvis: canvis,
  })
}

export function validaPeriode(des: { exercici: number; mes: number }, fins: { exercici: number; mes: number }) {
  return rpc<{ mesos: number; validats: number }>('validar_preus_periode', {
    p_des_exercici: des.exercici, p_des_mes: des.mes, p_fins_exercici: fins.exercici, p_fins_mes: fins.mes,
  })
}

export function fixaPreu(producto: string, exercici: number, mes: number, font: FontPreu, eurKg: number | null, motiu: string) {
  return rpc<{ validats: number; canviats: number }>('fixar_preu_referencia', {
    p_producto: producto, p_exercici: exercici, p_mes: mes, p_font: font, p_eur_kg: eurKg, p_motiu: motiu,
  })
}

export function afegeixEquivalencia(producto: string, font: FontDescarrega, nomFont: string, codiFont: string | null) {
  return rpc<string>('afegir_equivalencia_preu', {
    p_producto: producto, p_font: font, p_nom_font: nomFont, p_codi_font: codiFont,
  })
}

export function treuEquivalencia(id: string) {
  return rpc<number>('treure_equivalencia_preu', { p_id: id })
}

export function fixaPreuManual(producto: string, manual: boolean) {
  return rpc<null>('fixar_preu_manual', { p_producto: producto, p_manual: manual })
}

export function creaProducte(nom: string, familia: string, nomEs: string | null) {
  return rpc<string>('crear_producte', { p_nombre: nom, p_familia: familia, p_nombre_es: nomEs })
}

export function marcaCarrega(id: string, estat: 'pendent' | 'descartada', motiu: string | null) {
  return rpc<null>('marcar_carrega_preus', { p_id: id, p_estat: estat, p_motiu: motiu })
}

export function fixaFont(font: FontDescarrega, automatic: boolean | null, url: string | null) {
  return rpc<null>('fixar_font_preus', { p_font: font, p_automatic: automatic, p_url: url })
}

export function carregaNomsFonts() {
  return rpc<NomFontVist[]>('noms_fonts_preus', {})
}

// --- La Edge Function `preus-fonts` ---------------------------------------

export interface ResultatActualitza {
  ok: boolean
  font: FontDescarrega
  resultat?: 'nou' | 'sense_canvis' | 'duplicat' | 'desactivat'
  error?: string
  files?: number
  data_font?: string | null
}

async function crida<T>(cos: Record<string, unknown>): Promise<ResultatRpc<T>> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return { ok: false, missatge: 'unauthorized', codi: '401' }
    const res = await fetch(`${supabaseUrl}/functions/v1/preus-fonts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cos),
    })
    const body = (await res.json().catch(() => null)) as (T & { code?: string; error?: string }) | null
    if (!res.ok || !body) {
      const codi = body?.code ?? body?.error ?? String(res.status)
      return { ok: false, missatge: res.status === 403 ? 'preu.err_permis' : `preu.err_font`, codi }
    }
    return { ok: true, data: body }
  } catch {
    return { ok: false, missatge: 'preu.err_font', codi: null }
  }
}

/** «Actualitza ara»: descarga y registra (Gencat condicional; Mercabarna, el día de la página). */
export function actualitzaFont(font: FontDescarrega) {
  return crida<ResultatActualitza>({ accio: font })
}

/** Abre el fichero original de una carga (URL firmada de 60 s, ya con `download`). */
export async function descarregaFitxerCarrega(id: string): Promise<ResultatRpc<{ url: string; nom: string | null }>> {
  const r = await crida<{ url: string; nom: string | null }>({ accio: 'fitxer', carrega_id: id })
  if (!r.ok) return r
  // La URL ya lleva `download=<nombre>`: el navegador guarda el fichero.
  window.open(r.data.url, '_blank', 'noopener,noreferrer')
  return r
}
