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
