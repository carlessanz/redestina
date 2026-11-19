// Las opciones de los buscadores predictivos del panel del equipo (19-11-2026): cómo se lee
// una entidad, una entidad productora o un producto en `SelectorEntitat` / `CercadorOpcions`.
//
// Una sola forma para todas las pantallas: el nombre como texto, el municipio de detalle (se
// ve a la derecha de la sugerencia y también se busca en él) y el NIF y la razón social como
// claves ocultas, para encontrar una ficha por cualquiera de los tres datos que el equipo
// suele tener a mano. La comparación (sin acentos ni mayúsculas) la hace `CercadorOpcions`.
//
// Puro y sin red: se prueba desde Vitest (`tests/opcionsSelector.test.ts`).

/** La misma forma que `OpcioCercador` (se repite aquí para que el módulo siga siendo puro). */
export interface OpcioSelector {
  valor: string
  text: string
  detall?: string
  claus?: readonly string[]
}

export interface FitxaSelector {
  id: string
  /** El nombre con el que se la conoce (`entidades.nombre`, `empresa || name` del productor). */
  nom: string | null
  poblacio?: string | null
  nif?: string | null
  rao?: string | null
}

/** Una ficha (entidad o productor) como opción: nombre, municipio de detalle, NIF y razón social ocultos. */
export function opcioFitxa(f: FitxaSelector): OpcioSelector {
  const claus = [f.nif, f.rao].filter((c): c is string => !!c && c.trim() !== '')
  return {
    valor: f.id,
    text: f.nom?.trim() || f.rao?.trim() || '—',
    ...(f.poblacio?.trim() ? { detall: f.poblacio.trim() } : {}),
    ...(claus.length ? { claus } : {}),
  }
}

/**
 * Los productos por nombre (el valor ES el nombre: así se guardan en las líneas de albarán y
 * en la Operativa). Si el valor actual no está en el catálogo (texto libre de un import antiguo),
 * se añade al principio para que el campo no se quede en blanco.
 */
export function opcionsProducte(noms: readonly string[], actual?: string | null): OpcioSelector[] {
  const llista = actual && !noms.includes(actual) ? [actual, ...noms] : [...noms]
  return llista.map((n) => ({ valor: n, text: n }))
}
