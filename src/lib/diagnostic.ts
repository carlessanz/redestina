// El diagnóstico operativo, del lado de la pantalla: cómo se pinta su estado, los chips de
// sección del formulario y cómo se LEEN las respuestas del cuestionario anterior. Puro y sin red.
//
// A3 (`20270522100000`): el cuestionario v3 dejó de ser vigente y el formulario ya no pregunta
// nada por el motor genérico (el diagnóstico es la Operativa de la ficha + los excedentes por
// producto × causa, `lib/excedentsDiagnostic.ts`). Se retiró de aquí la segunda copia de la
// gramática de condiciones (`avaluar_regla`), el prefill y el cálculo de obligatorias: no los
// usaba nadie más. Queda lo de LECTURA del legado: los diagnósticos guardados con el v3 (o
// anteriores) siguen enseñando sus respuestas en «Respostes del qüestionari anterior» mientras no
// tengan ningún bloque de excedentes.

import type { EstatDiagnostic, RespostaDiagnostic, TextBilingue } from '../types'

// ---------------------------------------------------------------------------
// 1. Secciones
// ---------------------------------------------------------------------------
// `seccio` es texto libre dentro del jsonb del cuestionario. Por eso una sección desconocida
// se pinta con su texto crudo en vez de con su identificador i18n. La lista se conserva por las
// respuestas del legado: los diagnósticos ya guardados citan estas secciones.

export const SECCIONS_CONEGUDES: readonly string[] = [
  // Las de la versión 0 (siguen haciendo falta: los diagnósticos ya hechos las citan)…
  'planificacio', 'collita', 'conservacio', 'canalitzacio', 'seguiment',
  // …las cuatro de la versión 1 del productor (20270403100000), las de la revisión…
  'produccio', 'generacio', 'gestio', 'necessitats',
  // …y las de la versión 2, el «Diagnòstic operatiu» (fase 9, 20270423100000).
  'productes', 'temporalitat', 'excedents', 'previsio', 'gestio_actual', 'causes', 'sortides', 'ubicacio',
  'logistica', 'relacio',
] as const

/** La clave i18n de una sección, o `null` si no la conocemos (entonces se pinta tal cual). */
export function clauSeccio(seccio: string): string | null {
  return SECCIONS_CONEGUDES.includes(seccio) ? `diag.sec_${seccio}` : null
}

/** El `id` del título de una sección del formulario: el destino de su chip. */
export function idSeccio(seccio: string): string {
  return `diag-sec-${seccio}`
}

/** Una sección con su estado, para los chips de navegación del formulario (T3). */
export interface EstatSeccio {
  seccio: string
  /** Clave i18n del título, o `null` si la sección no es una de las conocidas. */
  clau: string | null
  /** Lo que tiene la sección (campos, productos principales o acciones) */
  n: number
  /** Cuántos de ellos están contestados */
  contestades: number
  /** Lo que falta en la sección (códigos de `falten`) */
  falten: number
  /** Sin nada pendiente y con algo contestado: el punto del chip va lleno */
  completa: boolean
}

// ---------------------------------------------------------------------------
// 2. El estado
// ---------------------------------------------------------------------------
// Desde A1 (`20270520100000`) solo hay cuatro: el plan básico y sus `a_punt`/`emes` se
// retiraron de la pantalla (el plan es el expediente). El estado lo calcula SIEMPRE el
// servidor (`diagnostic_estat`, `diagnostics_equip`); aquí solo se pinta.

/** El badge de estado. Mismo criterio que el resto: `aviso` = a medias, `exito` = hecho. */
export function estilEstatDiagnostic(estat: EstatDiagnostic): string {
  switch (estat) {
    case 'complet': return 'bg-exito-fondo text-exito'
    case 'incomplet': return 'bg-aviso-fondo text-aviso'
    case 'sense_comencar': return 'bg-secondary text-secondary-foreground'
    default: return 'bg-muted text-muted-foreground'
  }
}

/** Los cuatro estados, para los filtros del listado del equipo. */
export const ESTATS_DIAGNOSTIC: readonly EstatDiagnostic[] = [
  'sense_comencar', 'incomplet', 'complet', 'sense_questionari',
] as const

// ---------------------------------------------------------------------------
// 3. Textos bilingües
// ---------------------------------------------------------------------------

/**
 * El texto de una etiqueta del cuestionario en el idioma de la interfaz.
 *
 * ⚠️ Cae al catalán y no a la clave: `questionari_problemes()` exige las dos lenguas al
 *    publicar, así que un hueco aquí solo puede venir de una fila sembrada antes de ese
 *    CHECK. Enseñar el catalán es peor que enseñar el castellano y mucho mejor que enseñar
 *    un hueco en medio de un formulario.
 */
export function textBilingue(text: TextBilingue | null | undefined, lang: 'ca' | 'es'): string {
  if (!text) return ''
  return text[lang] || text.ca || text.es || ''
}

// ---------------------------------------------------------------------------
// 4. El resumen (lectura): las respuestas del cuestionario anterior
// ---------------------------------------------------------------------------

/**
 * Lo que se enseña como respuesta en el resumen, a partir del sobre que compone el servidor.
 *
 * Mismo criterio que el PDF (`respuestaLegible` de `_shared/pdf/render/pla.ts`): primero las
 * etiquetas —el texto que la persona vio y eligió—; `valor` solo cuando no hay ninguna (un
 * número, un texto libre). Enseñar `valor` habiendo etiqueta pondría el código interno
 * (`mes_20000`) en la pantalla. Devuelve `''` si no hay nada que decir: quien pinta decide el
 * guion.
 */
export function respostaLlegible(r: Pick<RespostaDiagnostic, 'valor' | 'etiqueta' | 'etiquetes'>, lang: 'ca' | 'es'): string {
  if (Array.isArray(r.etiquetes)) {
    const parts = r.etiquetes.map((e) => textBilingue(e, lang).trim()).filter((x) => x !== '')
    if (parts.length > 0) return parts.join(', ')
  }
  const etiqueta = textBilingue(r.etiqueta ?? null, lang).trim()
  if (etiqueta !== '') return etiqueta
  return valorLlegible(r.valor, lang)
}

/** Un valor crudo como texto: el espejo de `valorLegible` del PDF. */
function valorLlegible(valor: unknown, lang: 'ca' | 'es'): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return ''
    return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'ca-ES', { maximumFractionDigits: 2 }).format(valor)
  }
  if (typeof valor === 'string') return valor.trim()
  if (Array.isArray(valor)) {
    return valor.map((v) => valorLlegible(v, lang)).filter((x) => x !== '').join(', ')
  }
  if (typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>)
      .map(([k, v]) => [k, valorLlegible(v, lang)] as const)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ')
  }
  return String(valor)
}

/** Una sección del resumen: sus respuestas, en el orden en que llegan del servidor. */
export interface SeccioResum {
  seccio: string
  clau: string | null
  respostes: RespostaDiagnostic[]
}

/**
 * Las respuestas del sobre agrupadas por sección, en el orden en que aparece cada sección
 * (el del cuestionario: el servidor las compone en ese orden).
 */
export function agrupaRespostes(respostes: RespostaDiagnostic[]): SeccioResum[] {
  const fora: SeccioResum[] = []
  const index = new Map<string, SeccioResum>()
  for (const r of respostes) {
    if (!r || typeof r !== 'object') continue
    const seccio = r.seccio || 'altres'
    let grup = index.get(seccio)
    if (!grup) {
      grup = { seccio, clau: clauSeccio(seccio), respostes: [] }
      index.set(seccio, grup)
      fora.push(grup)
    }
    grup.respostes.push(r)
  }
  return fora
}
