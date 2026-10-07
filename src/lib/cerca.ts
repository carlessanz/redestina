// El buscador de los listados: una sola regla para todos.
//
// POR QUÉ UN MÓDULO (07-10-2026). Una docena de pantallas repetían la misma comparación
// —`q.trim().toLowerCase()` y `campo.toLowerCase().includes(q)` sobre una lista de campos—
// escrita a mano en cada una. Era la misma regla, pero nada impedía que una pantalla la
// cambiara y las demás no. Aquí vive una vez, con sus pruebas (`tests/cerca.test.ts`).
//
// ⚠️ LA COMPARACIÓN DISTINGUE ACENTOS, Y ES A PROPÓSITO. Es exactamente lo que hacían las
//    pantallas: buscar «carbasso» no encuentra «Carbassó». `senseAccents()` existe para el
//    día que se quiera lo contrario, pero cambiarlo es cambiar lo que encuentra cada listado,
//    no un refactor, y se decide aparte.
//
// Puro y sin red: se prueba desde Vitest.

/** Lo que se compara: la consulta sin espacios en los extremos y en minúsculas. */
export function consultaCerca(text: string): string {
  return text.trim().toLowerCase()
}

/**
 * ¿Alguno de los campos contiene la consulta? La consulta ya normalizada con
 * `consultaCerca()`; vacía casa con todo. Un campo nulo cuenta como vacío.
 */
export function casaCerca(
  camps: readonly (string | null | undefined)[],
  q: string,
): boolean {
  if (!q) return true
  return camps.some((c) => (c ?? '').toLowerCase().includes(q))
}

/** Filtra una lista con `casaCerca`. Con la consulta vacía devuelve la MISMA lista. */
export function filtraCerca<T>(
  files: readonly T[],
  q: string,
  camps: (fila: T) => readonly (string | null | undefined)[],
): T[] {
  if (!q) return files as T[]
  return files.filter((f) => casaCerca(camps(f), q))
}

/**
 * Minúsculas, sin diacríticos y sin espacios en los extremos: «l'Ametlla del Vallès» →
 * «l'ametlla del valles». La usa el nomenclátor (`municipis.ts`); los listados, NO (ver la
 * cabecera).
 */
export function senseAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}
