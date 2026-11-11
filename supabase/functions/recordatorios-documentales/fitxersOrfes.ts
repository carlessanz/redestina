// La cola de ficheros huérfanos de Storage (`fitxers_orfes`, 20270526100000).
//
// La base no puede borrar objetos de Storage (`storage.protect_objects_delete`), así que
// `borrar_una_fitxa()` y la limpieza dejan aquí las rutas que se han quedado sin fila (archivo
// previo de la ficha, PDF de convenios sin número, evidencias, trazos de firma). Este job diario
// las borra del bucket con la API de Storage y retira de la cola las que ha podido borrar.
//
// ⚠️ No depende de los interruptores de notificaciones: no envía nada a nadie.
// ⚠️ Si Storage falla, las filas se quedan y se reintenta mañana. Un objeto que ya no existe
//    cuenta como borrado (`remove` no da error por eso): la fila sale igual.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Cuántas rutas como máximo por ejecución (la API acepta 1.000 por llamada). */
export const MAX_FITXERS_PER_EXECUCIO = 500;

type Fila = { id: number; bucket: string; ruta: string };

/** Agrupa las filas por bucket, en el orden en que llegan. PURO (con test). */
export function perBucket(files: readonly Fila[]): Map<string, Fila[]> {
  const m = new Map<string, Fila[]>();
  for (const f of files) {
    const l = m.get(f.bucket) ?? [];
    l.push(f);
    m.set(f.bucket, l);
  }
  return m;
}

/** Vacía la cola. Devuelve cuántas rutas se han borrado y cuántas quedan para mañana. */
export async function purgaFitxersOrfes(
  supabase: SupabaseClient,
): Promise<{ esborrats: number; pendents: number }> {
  const { data, error } = await supabase
    .from("fitxers_orfes")
    .select("id, bucket, ruta")
    .order("id", { ascending: true })
    .limit(MAX_FITXERS_PER_EXECUCIO);
  if (error) {
    console.error("recordatorios-documentales: fitxers_orfes:", error.message);
    return { esborrats: 0, pendents: 0 };
  }
  const files = (data ?? []) as Fila[];
  let esborrats = 0;
  let pendents = 0;
  for (const [bucket, llista] of perBucket(files)) {
    const { error: errRemove } = await supabase.storage.from(bucket).remove(llista.map((f) => f.ruta));
    if (errRemove) {
      console.error(`recordatorios-documentales: Storage no ha esborrat ${llista.length} fitxer(s) de ${bucket}:`, errRemove.message);
      pendents += llista.length;
      continue;
    }
    const { error: errDel } = await supabase.from("fitxers_orfes").delete().in("id", llista.map((f) => f.id));
    if (errDel) console.error("recordatorios-documentales: no s'ha pogut buidar la cua:", errDel.message);
    esborrats += llista.length;
  }
  return { esborrats, pendents };
}
