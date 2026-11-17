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
  const nom = ref.font ? nomDeFont({ font: ref.font }, idioma) : null
  if (!nom) return { mes, font: null }
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
