// Leer y escribir los datos de la Fundación (`parametros_documentales`, fila única id = 1).
//
// POR QUÉ EXISTE. Las RPC del circuito se niegan a emitir mientras `datos_provisionales`
// sea `true`, y el motivo que devuelven dice «Omple Configuració i desmarca
// datos_provisionales» — pero esa pantalla no existía y la única forma de rellenar la fila
// era SQL a mano. Esto es su cliente. Lo que decide QUÉ falta es `campsFundacio.ts`, que es
// puro y sí se puede probar.
//
// 🔴 EL `select` VA POR COLUMNAS, NO CON `*`. `apoderada_dni` tiene UPDATE pero **no
//    SELECT** (GRANT por columnas, `20260928100400` + `20270325100000`), así que un
//    `select('*')` responde `42501 permission denied for column` y la pantalla se queda sin
//    datos sin que nada explique por qué. Y la lista va en **un solo literal** (§7):
//    supabase-js deduce el tipo de la fila analizando esa cadena, y concatenarla deja la
//    fila sin columnas.
//
// 🔴 UN `UPDATE` DENEGADO POR RLS NO DA ERROR. La política de escritura exige
//    `es_super_admin()`; a quien no lo sea, PostgREST no le encuentra ninguna fila que
//    cumpla el `using` y responde **éxito con cero filas afectadas**. Por eso se piden las
//    filas con `.select('id')` y «cero filas sobre una fila que sé que existe» se trata como
//    denegación (la misma lección del arnés, §4bis y deuda 48).

import { supabase } from './supabase'
import type { CanvisFundacio, DadesFundacio } from './campsFundacio'

export interface ResultatDesat {
  ok: boolean
  /** La escritura salió bien y no afectó a ninguna fila: la RLS la rechazó. */
  denegat: boolean
  error: string | null
}

export async function llegirParametres(): Promise<{
  dades: DadesFundacio | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('parametros_documentales')
    .select('razon_social, cif, domicilio, codigo_postal, poblacion, inscripcion, apoderada_nombre, apoderada_cargo, email_equipo, firma_ruta, sello_ruta, datos_provisionales, actualizado_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) return { dades: null, error: error.message }
  return { dades: (data as DadesFundacio | null) ?? null, error: null }
}

/**
 * Escribe los cambios. `autor` queda en `actualizado_por`; si no se sabe quién es, se deja
 * la columna como estaba en vez de borrar la autoría anterior.
 */
export async function desarParametres(
  canvis: CanvisFundacio,
  autor: string | null,
): Promise<ResultatDesat> {
  const fila: Record<string, unknown> = {
    ...canvis,
    actualizado_at: new Date().toISOString(),
  }
  if (autor) fila.actualizado_por = autor

  const { data, error } = await supabase
    .from('parametros_documentales')
    .update(fila)
    .eq('id', 1)
    .select('id')

  if (error) return { ok: false, denegat: false, error: error.message }
  // Cero filas sobre una fila que sé que existe = la RLS lo rechazó (ver cabecera).
  if (!data || data.length === 0) return { ok: false, denegat: true, error: null }
  return { ok: true, denegat: false, error: null }
}
