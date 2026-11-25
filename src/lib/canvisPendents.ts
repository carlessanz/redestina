// Cambios sin guardar de un formulario con «Desa» (Taula mestra 1.1, 25-11-2026: «no perder
// información»). Lógica PURA, con test (`tests/canvisPendents.test.ts`); la usan la ficha del
// equipo (`EntitatDetall`) y la de la propia organización (`PerfilOrganitzacio`).
//
// El problema que resuelve `fusionaRecarrega`: en la ficha hay bloques que guardan AL MOMENTO
// (estado de un papel, acceso, enlace con otra organización, naturalesa) y luego piden recargar
// la ficha. Antes esa recarga desmontaba las pestañas y pisaba `valors` con lo que venía de la
// base, así que lo escrito en otra pestaña y aún no guardado se perdía sin aviso. Ahora se
// refresca la foto «inicial» y, de lo que hay en pantalla, solo los campos que el usuario NO
// había tocado (los que seguían iguales a la foto anterior); lo tocado se conserva.

type Fila = Record<string, unknown>

/** ¿Dos valores son el mismo? Por defecto, comparando su JSON (arrays y objetos incluidos). */
export type Igual = (clau: string, a: unknown, b: unknown) => boolean

/** `undefined` y `null` cuentan igual: un campo que no venía y uno vacío no son un cambio. */
export const mateixJson: Igual = (_clau, a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Los valores que se enseñan tras una recarga: para cada campo, el de la base nueva si el
 * usuario no lo había tocado (en pantalla seguía igual a `inicialVell`) y, si lo había tocado,
 * lo que escribió.
 */
export function fusionaRecarrega(inicialVell: Fila, inicialNou: Fila, valors: Fila, igual: Igual = mateixJson): Fila {
  const out: Fila = {}
  const claus = new Set([...Object.keys(inicialNou), ...Object.keys(valors), ...Object.keys(inicialVell)])
  for (const k of claus) {
    const tocat = !igual(k, valors[k], inicialVell[k])
    const v = tocat ? valors[k] : inicialNou[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

/** Las claves que difieren entre lo que hay en pantalla y la foto inicial. */
export function clausCanviades(valors: Fila, inicial: Fila, igual: Igual = mateixJson): string[] {
  const claus = new Set([...Object.keys(valors), ...Object.keys(inicial)])
  return [...claus].filter((k) => !igual(k, valors[k], inicial[k]))
}
