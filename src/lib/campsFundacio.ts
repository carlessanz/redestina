// Qué campos tiene la ficha de la Fundación y cuáles siguen sin rellenar de verdad.
//
// MÓDULO PURO, SIN RED, y por el mismo motivo que `documentsPanell.ts`: lo que decide aquí
// —si se puede desmarcar `datos_provisionales`— abre la emisión de documentos con efecto
// fiscal, así que tiene que poder probarse sin base de datos. La parte con red vive en
// `parametresFundacio.ts`, que importa el cliente de Supabase y por eso no se puede
// importar desde Vitest.

/** Los campos de texto que se pueden leer y escribir desde Configuració. */
export const CAMPS_FUNDACIO = [
  'razon_social',
  'cif',
  'domicilio',
  'codigo_postal',
  'poblacion',
  'inscripcion',
  'apoderada_nombre',
  'apoderada_cargo',
  'email_equipo',
] as const

export type CampFundacio = (typeof CAMPS_FUNDACIO)[number]

export type DadesFundacio = Record<CampFundacio, string | null> & {
  /** Rutas dentro del bucket privado `activos`. Solo lectura: se cargan aparte (§4). */
  firma_ruta: string | null
  sello_ruta: string | null
  datos_provisionales: boolean
  actualizado_at: string | null
}

/** Lo que se puede escribir. `apoderada_dni` entra pero nunca sale: no tiene SELECT. */
export interface CanvisFundacio {
  razon_social?: string | null
  cif?: string | null
  domicilio?: string | null
  codigo_postal?: string | null
  poblacion?: string | null
  inscripcion?: string | null
  apoderada_nombre?: string | null
  apoderada_cargo?: string | null
  email_equipo?: string | null
  apoderada_dni?: string
  datos_provisionales?: boolean
}

/**
 * Los valores SEMBRADOS por `20260928100400` que tienen forma de dato real y no lo son.
 *
 * El resto de la fila lleva el aviso dentro del propio texto («PROVISIONAL — pendent
 * de…») y se detecta leyéndolo; estos dos no: `G00000000` es un CIF con el dígito de
 * control mal **a propósito** y `00000` no es ningún código postal. Se comparan
 * **literales**: aquí no se valida ningún CIF, solo se reconoce lo que la migración puso.
 */
const SEMBRATS = new Set(['G00000000', '00000'])

/**
 * Qué campos siguen sin rellenar. Lista vacía = se puede desmarcar
 * `datos_provisionales`, que es lo que desbloquea la emisión real.
 *
 * ⚠️ Se mide sobre lo GUARDADO, no sobre lo que hay en pantalla: lo que la base leerá al
 * emitir es la fila.
 *
 * ⚠️ `apoderada_dni` no puede entrar aquí: no se puede leer (GRANT por columnas), así que
 * exigirlo lo bloquearía para siempre. Lo advierte el texto de ayuda del campo.
 */
export function campsPendents(dades: DadesFundacio | null): CampFundacio[] {
  if (!dades) return [...CAMPS_FUNDACIO]
  return CAMPS_FUNDACIO.filter((camp) => {
    const valor = (dades[camp] ?? '').trim()
    return valor === '' || valor.toUpperCase().includes('PROVISIONAL') || SEMBRATS.has(valor)
  })
}
