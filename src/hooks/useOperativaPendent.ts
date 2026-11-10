// ¿Le falta la Operativa a algún productor de esta cuenta? (A1, `20270520100000`.)
//
// Sustituye a `useDiagnosticPendent`: desde A1 el diagnóstico lo actualiza el EQUIPO (D5), así
// que pedirle al productor «fes el teu diagnòstic» le mandaba a una pantalla donde ya no puede
// hacer nada. Lo que sí le toca, y bloquea de verdad la logística, es tener al menos un LUGAR
// DE RECOGIDA, que edita él mismo en «La meva organització» › Operativa (hallazgo 6 del plan
// A1). A4 añadirá «sin productos habituales» y «sin lugar principal» cuando sean editables
// por el productor.
//
// ES UN HOOK Y NO VIVE DENTRO DE LA BANDA, por lo mismo que `useFitxaIncompleta`: lo miran DOS
// sitios —la banda de aviso y la marca del menú— y calculado por separado podrían decir cosas
// distintas. Se calcula una vez en `AppShell` y se reparte.
//
// ⚠️ NO SE AÑADE A `pendents_equip()`: es del panel externo, y ahí no ahogaría nada, pero
//    tampoco es trabajo del equipo.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAppContext } from './useAppContext'
import { useTicAvisos } from '../lib/refrescAvisos'
import { clauOrganitzacions, organitzacionsDeClau } from '../lib/rols'

export interface OperativaPendent {
  /** ¿Hay algún productor de la cuenta sin ningún lugar de recogida? */
  pendent: boolean
  carregant: boolean
}

export function useOperativaPendent(): OperativaPendent {
  const { ctx, rolActiu } = useAppContext()
  const [pendent, setPendent] = useState(false)
  const [carregant, setCarregant] = useState(true)

  const extern = rolActiu === 'productor' || rolActiu === 'receptor'
  // Cambia cuando alguien guarda la ficha o un lugar: la banda se vuelve a calcular.
  const tic = useTicAvisos()
  // Clave estable del contenido: `ctx.organitzacions` es un array nuevo en cada render del
  // contexto, y con el objeto como dependencia este efecto se relanzaría con cada
  // `SIGNED_IN` que supabase-js reemite.
  const clau = clauOrganitzacions(ctx?.organitzacions ?? [])

  useEffect(() => {
    const productors = organitzacionsDeClau(clau).filter((o) => o.tipo === 'productor')
    if (!extern || productors.length === 0) { setPendent(false); setCarregant(false); return }
    let viu = true
    setCarregant(true)

    void (async () => {
      // Como mucho una ficha de productor por cuenta: una llamada por ficha, solo la cuenta.
      const comptes = await Promise.all(productors.map((o) => supabase
        .from('productor_ubicaciones')
        .select('id', { count: 'exact', head: true })
        .eq('productor_id', o.id)))
      if (!viu) return
      // Un error de lectura NO se convierte en banda: decir «te falta» sin saberlo es peor
      // que callar (la ficha lo enseña igual).
      setPendent(comptes.some((r) => !r.error && (r.count ?? 0) === 0))
      setCarregant(false)
    })()

    return () => { viu = false }
  }, [extern, clau, tic])

  return { pendent, carregant }
}
