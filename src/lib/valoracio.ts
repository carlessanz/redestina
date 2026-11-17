// El valor por kilo de una donación (punto 3, fase D2, 17-11-2026). Módulo PURO, con test.
//
// Lo que decide la base (20270601100000): cada canalización guarda su valor, la FUENTE, el mes
// del albarán y si es PROVISIONAL (el mes aún no estaba validado). Aquí solo:
//   · qué coste se guarda en la OFERTA: solo el que el productor CAMBIA respecto a la propuesta
//     (sin cambiarlo queda null y la canalización toma el precio del mes de su albarán);
//   · cómo se escribe la fuente (los textos viven en `_shared/fontValor.ts`, los mismos que el
//     papel).

export { textFontValor, textMes, nomFont } from '../../supabase/functions/_shared/fontValor.ts'
export type { ValorFont, FontValor, IdiomaFont } from '../../supabase/functions/_shared/fontValor.ts'

import { nomFont as nomDeFont, textMes as mesEnText } from '../../supabase/functions/_shared/fontValor.ts'
import type { IdiomaFont } from '../../supabase/functions/_shared/fontValor.ts'

/** Lo que `crear-oferta/campos` manda pegado a cada producto (`preus_vigents_oferta` de hoy). */
export interface ReferenciaOferta {
  font: string | null | undefined
  /** Mes del que SALE el valor (`aaaa-mm-dd`): con el último Gencat, anterior al de hoy. */
  mes: string | null | undefined
  provisional: boolean | null | undefined
  /** Solo Mercabarna sin el mes validado: el día del precio (`aaaa-mm-dd`). */
  dia?: string | null
  /** Solo con `font = 'manual'` (20270604100000): cómo se decidió y de qué fuente sale. */
  origen?: OrigenManual | null
}

/**
 * Cómo se decidió un precio MANUAL, que no sale de una fuente oficial (20270604100000,
 * `costes_producto.criteri`). El orden es el del selector.
 */
export const CRITERIS_ORIGEN = [
  'producte_semblant', 'mediana_familia', 'mediana_global', 'font_externa', 'fixat_equip',
] as const
export type CriteriOrigen = typeof CRITERIS_ORIGEN[number]

const TXT_ORIGEN: Record<IdiomaFont, Record<CriteriOrigen | 'no_oficial' | 'sense_font' | 'sense_criteri', string>> = {
  ca: {
    no_oficial: 'No oficial',
    producte_semblant: "preu oficial d'un producte semblant",
    mediana_familia: 'mediana dels preus de la seva família',
    mediana_global: 'mediana de tots els preus de referència',
    font_externa: 'font externa no oficial',
    fixat_equip: "fixat per l'equip",
    sense_font: 'sense font disponible',
    sense_criteri: 'origen sense documentar',
  },
  es: {
    no_oficial: 'No oficial',
    producte_semblant: 'precio oficial de un producto parecido',
    mediana_familia: 'mediana de los precios de su familia',
    mediana_global: 'mediana de todos los precios de referencia',
    font_externa: 'fuente externa no oficial',
    fixat_equip: 'fijado por el equipo',
    sense_font: 'sin fuente disponible',
    sense_criteri: 'origen sin documentar',
  },
}

export function esCriteriOrigen(v: unknown): v is CriteriOrigen {
  return typeof v === 'string' && (CRITERIS_ORIGEN as readonly string[]).includes(v)
}

/** El nombre de un criterio, para el selector y los rótulos. */
export function textCriteriOrigen(criteri: CriteriOrigen, idioma: IdiomaFont = 'ca'): string {
  return TXT_ORIGEN[idioma][criteri]
}

/** El origen de un precio manual, tal como lo guarda `costes_producto`. */
export interface OrigenManual {
  criteri: string | null | undefined
  font_origen: string | null | undefined
}

/**
 * El origen de un precio manual en una línea, siempre con «No oficial» delante:
 *   «No oficial · preu oficial d'un producte semblant: Préssec — Gencat, setembre 2026»
 *   «No oficial · fixat per l'equip · sense font disponible»
 * Sin criterio (un precio manual de antes de 20270604100000): «No oficial · origen sense documentar».
 */
export function textOrigenManual(o: OrigenManual | null | undefined, idioma: IdiomaFont = 'ca'): string {
  const T = TXT_ORIGEN[idioma]
  const font = typeof o?.font_origen === 'string' && o.font_origen.trim() ? o.font_origen.trim() : null
  if (!esCriteriOrigen(o?.criteri)) {
    return font ? `${T.no_oficial} · ${font}` : `${T.no_oficial} · ${T.sense_criteri}`
  }
  const criteri = T[o.criteri]
  return font ? `${T.no_oficial} · ${criteri}: ${font}` : `${T.no_oficial} · ${criteri} · ${T.sense_font}`
}

/**
 * Cómo se rotula en el alta de oferta el valor que se propone (17-11-2026). El valor es el
 * del MES DE HOY (Madrid) si está validado; si no, el último validado, provisional. Devuelve:
 *   · `mes`: el mes de hoy, «novembre 2026» (al que se aplica el valor);
 *   · `font`: la fuente y, si el valor sale de otro mes, cuál: «Gencat, preus percebuts pel
 *     pagès, darrer publicat: setembre 2026» o, provisional, «Preu fixat per la Fundació,
 *     octubre 2026».
 * `font` es null sin fuente (un servidor anterior no la manda).
 */
export function rotulReferenciaOferta(
  ref: ReferenciaOferta,
  avui: { exercici: number; mes: number },
  idioma: IdiomaFont = 'ca',
): { mes: string; font: string | null } {
  const mes = mesEnText(`${avui.exercici}-${String(avui.mes).padStart(2, '0')}`, idioma) ?? ''
  // Solo Mercabarna (20270603100000): el precio de un DÍA, «Mercabarna, preu del 16/11/2026».
  const dia = typeof ref.dia === 'string' ? ref.dia.match(/^(\d{4})-(\d{2})-(\d{2})/) : null
  if (dia) {
    return { mes, font: `Mercabarna, ${idioma === 'es' ? 'precio del' : 'preu del'} ${dia[3]}/${dia[2]}/${dia[1]}` }
  }
  const nomBase = ref.font ? nomDeFont({ font: ref.font }, idioma) : null
  if (!nomBase) return { mes, font: null }
  // Un precio manual dice siempre que no es oficial, y de dónde sale (20270604100000).
  const nom = ref.font === 'manual' ? `${nomBase} (${textOrigenManual(ref.origen, idioma)})` : nomBase
  const origen = mesEnText(ref.mes, idioma)
  const delMesDAvui = typeof ref.mes === 'string'
    && ref.mes.startsWith(`${avui.exercici}-${String(avui.mes).padStart(2, '0')}`)
  if (!origen || delMesDAvui) return { mes, font: nom }
  if (ref.provisional) return { mes, font: `${nom}, ${origen}` }
  const darrer = idioma === 'es' ? 'último publicado' : 'darrer publicat'
  return { mes, font: `${nom}, ${darrer}: ${origen}` }
}

/** Dos valores por kilo son el mismo si coinciden a 4 decimales (la precisión de la base). */
export function mateixValor(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.round(a * 10000) === Math.round(b * 10000)
}

/**
 * El coste que se manda a la oferta (`excedentes.coste_kg`):
 *   · vacío → null;
 *   · igual al que la oferta ya tenía declarado → se queda (editar no lo borra);
 *   · igual a la PROPUESTA (el precio de referencia de hoy) → null: no se declara nada y el
 *     certificado aplicará el precio del mes del albarán;
 *   · cualquier otro → ese valor, declarado (definitivo, nunca se ajusta).
 */
export function costADeclarar(
  valor: unknown,
  proposta: number | null | undefined,
  original: number | null | undefined = null,
): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'))
  if (!Number.isFinite(n)) return null
  if (original != null && mateixValor(n, original)) return n
  if (mateixValor(n, proposta)) return null
  return n
}
