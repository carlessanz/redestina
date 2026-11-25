// Las entidades receptoras ACTIVAS a las que el equipo puede asignar, con lo necesario para saber
// qué modalidades puede recibir cada una: su tipo (`modalitat_receptor_compat`) y su naturalesa
// (`modalitat_naturalesa_compat`, P8; solo la confirmada restringe).
//
// Salió de `FormulariInteresAssistit` (25-11-2026) cuando «Registrar operació realitzada»
// (proceso 3.7) necesitó las mismas tres lecturas: una sola vez cada una, sin copiarlas. La
// autoridad sigue siendo la base (`comprova_interes()`); esto solo evita ofrecer lo que rechazaría.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface EntitatTria {
  id: string
  nombre: string
  /** Para el buscador: municipio de detalle, NIF y razón social como claves (`opcioFitxa`). */
  poblacion: string | null
  nif: string | null
  razon_social: string | null
  tipo_receptor: string | null
  /** A5: la naturalesa de su organización; solo confirmada restringe (P8). */
  organizaciones: { naturalesa: string | null; naturalesa_origen: string | null } | null
}
export type ReglaNaturalesa = { modalitat: string; naturalesa: string }
export type ReglaTipus = { modalitat: string; tipo_receptor: string }

/** `actiu = false` no pide nada (un diálogo cerrado no necesita cientos de fichas). */
export function useEntitatsAssignables(actiu = true): {
  entitats: EntitatTria[]
  /** `modalitat_receptor_compat`; `null` = no se pudo leer (no se filtra: decide la base). */
  matriu: ReglaTipus[] | null
  /** `modalitat_naturalesa_compat` (A5); `null` = no se pudo leer (no se filtra). */
  reglaNat: ReglaNaturalesa[] | null
} {
  const [entitats, setEntitats] = useState<EntitatTria[]>([])
  const [matriu, setMatriu] = useState<ReglaTipus[] | null>(null)
  const [reglaNat, setReglaNat] = useState<ReglaNaturalesa[] | null>(null)

  // Las entidades y la matriz se piden una vez y aparte: traerlas con cada refresco de la
  // pantalla cargaría cientos de filas sin motivo.
  useEffect(() => {
    if (!actiu) return
    let viu = true
    void (async () => {
      const [ents, mat, nat] = await Promise.all([
        // Solo las activas (1A): `comprova_interes()` rechaza una inactiva con `entitat_inactiva`.
        supabase.from('entidades').select('id, nombre, poblacion, nif, razon_social, tipo_receptor, organizaciones(naturalesa, naturalesa_origen)')
          .eq('activo', true).order('nombre').limit(500),
        supabase.from('modalitat_receptor_compat').select('modalitat, tipo_receptor'),
        supabase.from('modalitat_naturalesa_compat').select('modalitat, naturalesa'),
      ])
      if (!viu) return
      if (ents.data) setEntitats(ents.data as unknown as EntitatTria[])
      setMatriu(mat.error ? null : (mat.data as ReglaTipus[]))
      setReglaNat(nat.error ? null : (nat.data as ReglaNaturalesa[]))
    })()
    return () => { viu = false }
  }, [actiu])

  return { entitats, matriu, reglaNat }
}
