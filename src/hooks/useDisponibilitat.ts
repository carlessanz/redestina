// Lee una DISPONIBILIDAD multiproducto (fase 6a): sus ofertas, su código y lo que el mensaje
// único necesita (productor, lugar y subcausa). La parte pura —qué ofertas van en el texto, el
// contexto y el texto mismo— está en `lib/disponibilitat.ts`.
//
// La RLS decide qué ve cada uno: el equipo, todo; el productor, lo suyo (la cabecera también,
// pero su `D-…` no se le enseña: es de gestión interna, como el `E-…`).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { carregaCatalegCauses, trobaSubcausa } from '../lib/causes'
import {
  COLUMNES_GRUP, contextText, midesGrups, ordenaGrup, textDelGrup, type ContextGrup, type OfertaGrup,
} from '../lib/disponibilitat'
import type { ContextTextDisponibilitat } from '../../supabase/functions/_shared/textOferta.ts'

export interface DadesDisponibilitat {
  id: string
  /** `D-…`; null si no se pudo leer la cabecera. Solo para el equipo. */
  codi: string | null
  /** Todas las ofertas del grupo (también las cerradas), en el orden del servidor. */
  ofertes: OfertaGrup[]
  /** El contexto del texto (productor, municipio, lugar, causa) ya resuelto. */
  ctx: ContextTextDisponibilitat
  /** El mensaje único con las que circulan; null con menos de dos. */
  text: string | null
}

/**
 * `null` mientras no hay grupo o se está leyendo. `recarrega` vuelve a leer; `firma`, si cambia,
 * también (quien lo monta pasa lo que cambia al editar la oferta: su estado y su texto).
 */
export function useDisponibilitat(disponibilitatId: string | null | undefined, firma = ''): {
  grup: DadesDisponibilitat | null
  error: boolean
  recarrega: () => void
} {
  const [crues, setCrues] = useState<{ id: string; codi: string | null; ofertes: OfertaGrup[]; c: ContextGrup } | null>(null)
  const [error, setError] = useState(false)
  const [versio, setVersio] = useState(0)
  const recarrega = useCallback(() => setVersio((v) => v + 1), [])

  useEffect(() => {
    if (!disponibilitatId) { setCrues(null); return }
    let viu = true
    void (async () => {
      const [o, d, cat] = await Promise.all([
        supabase.from('excedentes').select(COLUMNES_GRUP).eq('disponibilitat_id', disponibilitatId),
        supabase.from('disponibilitats').select('codi').eq('id', disponibilitatId).maybeSingle(),
        carregaCatalegCauses(),
      ])
      if (!viu) return
      if (o.error) { setError(true); return }
      const ofertes = ordenaGrup((o.data ?? []) as unknown as OfertaGrup[])
      const primera = ofertes[0]
      const [p, u] = await Promise.all([
        primera?.productor_id
          ? supabase.from('productores').select('name, empresa, poblacion').eq('id', primera.productor_id).maybeSingle()
          : Promise.resolve({ data: null }),
        primera?.ubicacion_id
          ? supabase.from('productor_ubicaciones').select('municipio, gmaps_url').eq('id', primera.ubicacion_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (!viu) return
      // El texto va en catalán, como el de la oferta: el nombre catalán de la subcausa.
      const sub = cat.ok && primera?.subcausa_codigo ? trobaSubcausa(cat.data, primera.subcausa_codigo) : null
      setError(false)
      setCrues({
        id: disponibilitatId,
        codi: (d.data as { codi: string } | null)?.codi ?? null,
        ofertes,
        c: {
          productor: (p.data as ContextGrup['productor']) ?? null,
          lloc: (u.data as ContextGrup['lloc']) ?? null,
          subcausa: sub?.subcausa.nombre ?? null,
        },
      })
    })()
    return () => { viu = false }
  }, [disponibilitatId, versio, firma])

  const grup = useMemo<DadesDisponibilitat | null>(() => {
    if (!crues || crues.id !== disponibilitatId) return null
    const ctx = contextText(crues.ofertes[0], crues.c, crues.id, window.location.origin)
    return { id: crues.id, codi: crues.codi, ofertes: crues.ofertes, ctx, text: textDelGrup(crues.ofertes, ctx) }
  }, [crues, disponibilitatId])

  return { grup, error, recarrega }
}

/**
 * Cuántas ofertas tiene cada disponibilidad de unas filas (el distintivo «Multiproducte · N» del
 * listado). Una consulta ligera por el conjunto de grupos que se ven: contarlas entre las filas
 * cargadas fallaría en cuanto una hermana está en otra pestaña (validada, cerrada…).
 */
export function useMidesGrups(files: readonly { disponibilitat_id?: string | null }[]): Record<string, number> {
  const clau = [...new Set(files.map((f) => f.disponibilitat_id).filter((v): v is string => !!v))].sort().join(',')
  const [mides, setMides] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!clau) { setMides({}); return }
    let viu = true
    void supabase.from('excedentes').select('disponibilitat_id').in('disponibilitat_id', clau.split(','))
      .then(({ data, error }) => {
        if (!viu || error) return
        setMides(midesGrups((data ?? []) as { disponibilitat_id: string | null }[]))
      })
    return () => { viu = false }
  }, [clau])
  return mides
}
