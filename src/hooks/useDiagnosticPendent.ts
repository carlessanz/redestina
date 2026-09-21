// ¿Le queda diagnóstico por hacer a alguna organización de esta cuenta?
//
// ES UN HOOK Y NO VIVE DENTRO DE LA BANDA, por lo mismo que `useFitxaIncompleta`: lo miran
// DOS sitios —la banda de aviso y la marca del menú— y si cada uno lo calculara por su
// cuenta podrían decir cosas distintas. Se calcula una vez en `AppShell` y se reparte
// (§6ter, la misma razón por la que los contadores del equipo salen todos de
// `pendents_equip()`).
//
// ⚠️ NO SE AÑADE A `pendents_equip()`, y es deliberado. Ahí dentro sería una cola de «N
//    diagnòstics pendents» permanente —lo están casi todas las organizaciones, y lo
//    seguirán estando— que ahogaría las colas que sí bloquean el circuito: un albarán sin
//    emitir, un convenio por contrasignar. El listado del equipo lleva su propio contador,
//    que es donde esa cifra significa algo.
//
// ⚠️ Y AQUÍ «PENDIENTE» NO ES «BLOQUEADO». El diagnóstico no impide publicar una oferta ni
//    mostrar interés; por eso lo que sale de aquí se pinta en `aviso` y nunca en rojo.

import { useEffect, useState } from 'react'
import { diagnosticEstat } from '../lib/diagnosticApi'
import type { EstatDiagnostic } from '../types'
import { useAppContext } from './useAppContext'

/** Los estados en los que queda algo por hacer. `emes` está hecho; `sense_questionari`
 *  no es de la organización —es que no hay cuestionario vigente— y no se le puede pedir. */
const PENDENTS: EstatDiagnostic[] = ['sense_comencar', 'incomplet', 'a_punt']

export interface DiagnosticPendent {
  /** ¿Hay alguna organización con el diagnóstico a medias? */
  pendent: boolean
  /** El estado más atrasado que se ha encontrado, para poder decir QUÉ toca. */
  estat: EstatDiagnostic | null
  carregant: boolean
}

export function useDiagnosticPendent(): DiagnosticPendent {
  const { ctx, rolActiu } = useAppContext()
  const [pendent, setPendent] = useState(false)
  const [estat, setEstat] = useState<EstatDiagnostic | null>(null)
  const [carregant, setCarregant] = useState(true)

  const extern = rolActiu === 'productor' || rolActiu === 'receptor'
  const orgs = ctx?.organitzacions ?? []
  // Clave estable del contenido: `ctx.organitzacions` es un array nuevo en cada render del
  // contexto, y con el objeto como dependencia este efecto se relanzaría con cada
  // `SIGNED_IN` que supabase-js reemite (el mismo fallo que documenta `PerfilOrganitzacio`).
  const clau = orgs.map((o) => `${o.tipo}:${o.id}`).join(',')

  useEffect(() => {
    if (!extern || clau === '') { setPendent(false); setEstat(null); setCarregant(false); return }
    let viu = true
    setCarregant(true)

    void (async () => {
      // Como mucho dos organizaciones (productora y receptora): dos llamadas, no una lista.
      const resultats = await Promise.all(
        orgs.map((o) => diagnosticEstat(o.tipo, o.id)),
      )
      if (!viu) return

      let trobat: EstatDiagnostic | null = null
      for (const r of resultats) {
        if (!r.ok) continue
        if (PENDENTS.includes(r.data.estat)) {
          // El más atrasado manda: si una organización no ha empezado y la otra ya tiene el
          // plan a punto, lo que hay que decir es lo primero.
          const ordre = PENDENTS.indexOf(r.data.estat)
          if (trobat === null || ordre < PENDENTS.indexOf(trobat)) trobat = r.data.estat
        }
      }
      setEstat(trobat)
      setPendent(trobat !== null)
      setCarregant(false)
    })()

    return () => { viu = false }
  }, [extern, clau]) // eslint-disable-line react-hooks/exhaustive-deps

  return { pendent, estat, carregant }
}
