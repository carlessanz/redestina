// Los badges de NOVEDADES de la receptora (reunión del 06-10-2026).
//
// Al revés que el del equipo —persistente hasta que alguien actúa, porque si el equipo no
// responde el proceso se para—, el de la receptora DESAPARECE AL SALIR del apartado o al
// cerrar sesión: no tiene obligación de responder a cada oferta, y un badge que se acumula
// acaba en un número que nadie pulsa. No se le pide descartar nada.
//
// Por eso vive en el navegador (`localStorage`, por cuenta) y no en la base: es una
// comodidad de quien mira, no un estado compartido. Si el almacenamiento falla (Safari
// privado), no hay badge — nunca un error.
//
//   · `mercat`     → ofertas que han salido al Mercat desde la última vez que lo dejó.
//   · `interessos` → intereses que el equipo ha decidido desde la última vez que los miró
//                    (es lo que avisa de «de 1.000 kg, se n'han aprovat 500»).

import { supabase } from './supabase'

export type Apartat = 'mercat' | 'interessos'

const clau = (apartat: Apartat, userId: string) => `redestina-vist-${apartat}:${userId}`

/** Cuándo dejó el apartado por última vez. La primera vez se fija ahora: sin avalancha. */
export function darreraVisita(apartat: Apartat, userId: string): string {
  try {
    const v = localStorage.getItem(clau(apartat, userId))
    if (v) return v
    const ara = new Date().toISOString()
    localStorage.setItem(clau(apartat, userId), ara)
    return ara
  } catch {
    return new Date().toISOString()
  }
}

/** Se llama al SALIR del apartado y al cerrar sesión. */
export function marcaVist(apartat: Apartat, userId: string) {
  try { localStorage.setItem(clau(apartat, userId), new Date().toISOString()) } catch { /* sin badge */ }
}

/** Las dos a la vez, para el «Sortir». */
export function marcaTotVist(userId: string | null | undefined) {
  if (!userId) return
  marcaVist('mercat', userId)
  marcaVist('interessos', userId)
}

/**
 * Ofertas nuevas en el Mercat desde `desde`. La RLS de `excedentes` ya deja solo las
 * compatibles con la receptora, así que contar aquí es contar lo que verá. «Nueva» es
 * cuándo salió al Mercat (`validada_at`) o, para las anteriores a la validación, cuándo se
 * creó.
 */
export async function comptaOfertesNoves(desde: string): Promise<number> {
  const { count, error } = await supabase
    .from('excedentes')
    .select('id', { count: 'exact', head: true })
    .in('estado', ['publicada', 'parcial'])
    .or(`validada_at.gt.${desde},and(validada_at.is.null,created_at.gt.${desde})`)
  if (error) return 0
  return count ?? 0
}

/** Intereses de mis entidades que el equipo ha decidido desde `desde`. */
export async function comptaDecisionsNoves(entitats: string[], desde: string): Promise<number> {
  if (entitats.length === 0) return 0
  const { count, error } = await supabase
    .from('oferta_respuestas')
    .select('id', { count: 'exact', head: true })
    .in('entidad_id', entitats)
    .in('aprovacio', ['aprovada', 'rebutjada'])
    .gt('aprovat_at', desde)
  if (error) return 0
  return count ?? 0
}
