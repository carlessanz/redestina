// Las entidades productoras ACTIVAS para elegir en nombre de quién actúa el equipo.
//
// Salió de `DialegNovaOfertaAssistida` (25-11-2026) cuando «Registrar operació realitzada»
// (proceso 3.7) necesitó la misma lista: una sola consulta para los dos diálogos, sin copiarla.
// Solo se pide mientras el diálogo está abierto (`actiu`): son cientos de fichas.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface FitxaProductor {
  id: string
  /** `empresa` (el nombre de la organización) o, si no hay, `name`. */
  nom: string
  poblacio: string | null
}

export function useProductorsActius(actiu: boolean): { productors: FitxaProductor[]; carregant: boolean } {
  const [productors, setProductors] = useState<FitxaProductor[]>([])
  const [carregant, setCarregant] = useState(true)

  useEffect(() => {
    if (!actiu) return
    let viu = true
    void (async () => {
      setCarregant(true)
      const { data } = await supabase
        .from('productores')
        .select('id, name, empresa, poblacion')
        .eq('activo', true)
        .order('name')
      if (!viu) return
      const files = (data as { id: string; name: string | null; empresa: string | null; poblacion: string | null }[] | null) ?? []
      setProductors(files.map((x) => ({ id: x.id, nom: x.empresa || x.name || '—', poblacio: x.poblacion })))
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [actiu])

  return { productors, carregant }
}
