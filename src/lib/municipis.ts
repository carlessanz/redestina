// El nomenclátor oficial de municipios (`municipios`, 947 filas, §4), cargado UNA vez por
// sesión y compartido por todos los selectores.
//
// Es catálogo público —lo puede leer cualquier cuenta con sesión, como `productos`— y no
// cambia nunca en ejecución, así que no tiene sentido pedirlo en cada pantalla.

import { supabase } from './supabase'
import { senseAccents } from './cerca'

export interface Municipi {
  codi_ine: string
  nom: string
  comarca: string
  provincia: string
}

let promesa: Promise<Municipi[]> | null = null

export function carregaMunicipis(): Promise<Municipi[]> {
  if (!promesa) {
    promesa = (async () => {
      const { data, error } = await supabase
        .from('municipios').select('codi_ine, nom, comarca, provincia').order('nom')
      if (error) {
        promesa = null // que el siguiente intento vuelva a preguntar
        return []
      }
      return (data ?? []) as Municipi[]
    })()
  }
  return promesa
}

/**
 * El nombre oficial viene con el artículo pospuesto («Ametlla del Vallès, l'»): para
 * enseñarlo se le da la vuelta («l'Ametlla del Vallès»), que es como lo escribe la gente.
 */
export function nomLlegible(nom: string): string {
  const m = nom.match(/^(.*), (el|la|els|les|l'|L')$/i)
  if (!m) return nom
  const art = m[2]
  return art.endsWith("'") ? `${art}${m[1]}` : `${art} ${m[1]}`
}

/** Sin acentos ni mayúsculas: «sant cugat» encuentra «Sant Cugat del Vallès». Vive en `cerca.ts`. */
export const normalitza = senseAccents
