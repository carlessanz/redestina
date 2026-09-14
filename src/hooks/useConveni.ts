// ¿La organización activa puede operar, o le falta el convenio?
//
// LA REGLA, EN UN SITIO (§3.2.2 del plan y D7). Sin convenio vigente:
//   · antes de la fecha de corte  → se AVISA, y se puede operar;
//   · desde la fecha de corte      → se BLOQUEA.
// Es exactamente lo que hace `exigir_convenio()` en la base, que antes del corte devuelve
// texto y después levanta 42501. Aquí no se decide nada nuevo: se lee lo mismo para poder
// enseñarlo y para no dejar al usuario delante de un botón que va a fallar.
//
// POR QUÉ NO SE COMPRUEBA CON `convenio_vigente()`. Esa RPC responde por valorización y
// por parte (entrega o recibe), que es lo que necesita una operación concreta. El panel no
// tiene todavía ninguna operación entre manos: quiere saber si la organización está en
// regla. Así que se leen sus convenios —la RLS ya solo le deja ver los suyos— y se mira el
// estado más avanzado, igual que hace `BadgeConveni` en la ficha.
//
// El equipo no pasa por aquí: trabaja en nombre de otros y no tiene organización propia.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAppContext } from './useAppContext'
import type { ConvenioEstado } from '../types'
import { ORDRE_CONVENI as ORDRE } from '../lib/documentsPanell'

/** Lo que el panel necesita saber, ya masticado. */
export interface EstatConveni {
  /** Estado más avanzado de sus convenios, o null si no tiene ninguno. */
  estat: ConvenioEstado | null
  /** La fecha de corte, o null si la Fundación todavía no la ha puesto. */
  dataTall: string | null
  /** Sin convenio vigente. Es el que decide si se avisa. */
  avisa: boolean
  /** Sin convenio vigente Y con el corte ya pasado. Es el que decide si se bloquea. */
  bloqueja: boolean
  carregant: boolean
}


export function useConveni(): EstatConveni {
  const { rolActiu, organitzacio } = useAppContext()
  const [estat, setEstat] = useState<ConvenioEstado | null>(null)
  const [dataTall, setDataTall] = useState<string | null>(null)
  const [carregant, setCarregant] = useState(true)

  const orgId = organitzacio?.id ?? null
  const extern = rolActiu === 'productor' || rolActiu === 'receptor'
  const columna = rolActiu === 'productor' ? 'productor_id' : 'entidad_id'

  useEffect(() => {
    if (!extern || !orgId) { setEstat(null); setCarregant(false); return }
    let viu = true
    setCarregant(true)

    void (async () => {
      const [convenis, tall] = await Promise.all([
        supabase.from('convenios').select('estado').eq(columna, orgId),
        supabase.rpc('data_tall_convenis'),
      ])
      if (!viu) return

      const files = (convenis.data as { estado: ConvenioEstado }[] | null) ?? []
      let millor: ConvenioEstado | null = null
      for (const f of files) {
        if (f.estado === 'substituit') continue
        if (!millor || ORDRE.indexOf(f.estado) > ORDRE.indexOf(millor)) millor = f.estado
      }
      setEstat(millor)
      setDataTall((tall.data as string | null) ?? null)
      setCarregant(false)
    })()

    return () => { viu = false }
  }, [extern, orgId, columna])

  const avisa = extern && !carregant && estat !== 'vigent'
  // `new Date('2027-04-01')` es medianoche UTC y aquí basta: la fecha de corte es un día
  // entero, no un instante, y la base decide de verdad con `current_date`.
  const passat = dataTall !== null && new Date(dataTall) <= new Date()

  return { estat, dataTall, avisa, bloqueja: avisa && passat, carregant }
}
