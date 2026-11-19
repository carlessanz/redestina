// Los contadores en vivo (fase 5 de los puntos 4-6): UN canal de Realtime por sesión que, cuando
// cambia una tabla que alimenta algún badge, los vuelve a pedir. Qué tabla refresca qué vive en
// `lib/comptadorsEnViu.ts` (puro, con test).
//
// · El equipo: llama directamente a `refrescaComptadors()` (el store de `pendentsEquip.ts`).
// · Los paneles externos: devuelve unos «tics» que `AppShell` pone en las dependencias de sus
//   efectos de pendientes, avisos y Mercat. Solo esos: nada de recargar pantallas enteras.
//
// DEBOUNCE. El primer cambio arma un temporizador de `DEBOUNCE_MS`; los que llegan mientras tanto
// se juntan y salen en la misma tanda. Una ráfaga (aprobar crea respuesta + canalización +
// albaranes + avisos) es UNA llamada por contador, no diez.
//
// Si Realtime falla (sin conexión, tabla fuera de la publicación), no pasa nada visible: los
// contadores se siguen refrescando como antes, al navegar y tras cada acción. Se limpia al
// desmontar y al cambiar de cuenta (`userId` en las dependencias).

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { refrescaComptadors } from '../lib/pendentsEquip'
import { DEBOUNCE_MS, refrescosDe, taulesASubscriure } from '../lib/comptadorsEnViu'
import type { Refresc } from '../lib/comptadorsEnViu'

export interface TicsEnViu {
  pendents: number
  avisos: number
  mercat: number
}

export function useComptadorsEnViu(args: {
  userId: string | null
  intern: boolean
  extern: boolean
  receptor: boolean
}): TicsEnViu {
  const { userId, intern, extern, receptor } = args
  const [tics, setTics] = useState<TicsEnViu>({ pendents: 0, avisos: 0, mercat: 0 })

  useEffect(() => {
    if (!userId) return
    const qui = { intern, extern, receptor }
    const taules = taulesASubscriure(qui)
    if (taules.length === 0) return

    let pendents = new Set<Refresc>()
    let temporitzador: ReturnType<typeof setTimeout> | null = null
    const dispara = () => {
      temporitzador = null
      const r = pendents
      pendents = new Set()
      if (r.has('equip')) void refrescaComptadors()
      if (r.has('pendents') || r.has('avisos') || r.has('mercat')) {
        setTics((t) => ({
          pendents: t.pendents + (r.has('pendents') ? 1 : 0),
          avisos: t.avisos + (r.has('avisos') ? 1 : 0),
          mercat: t.mercat + (r.has('mercat') ? 1 : 0),
        }))
      }
    }
    const enCanvi = (taula: string) => () => {
      for (const x of refrescosDe(taula, qui)) pendents.add(x)
      if (temporitzador == null && pendents.size > 0) temporitzador = setTimeout(dispara, DEBOUNCE_MS)
    }

    let canal = supabase.channel(`comptadors-en-viu-${userId}`)
    for (const taula of taules) {
      canal = canal.on('postgres_changes', { event: '*', schema: 'public', table: taula }, enCanvi(taula))
    }
    // Un error de suscripción no se enseña: los contadores siguen como antes (al navegar).
    canal.subscribe()

    return () => {
      if (temporitzador != null) clearTimeout(temporitzador)
      void supabase.removeChannel(canal)
    }
  }, [userId, intern, extern, receptor])

  return tics
}
