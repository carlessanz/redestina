// ¿Le falta la Operativa a algún productor de esta cuenta? (A1, `20270520100000`.)
//
// Sustituye a `useDiagnosticPendent`: desde A1 el diagnóstico lo actualiza el EQUIPO (D5), así
// que pedirle al productor «fes el teu diagnòstic» le mandaba a una pantalla donde ya no puede
// hacer nada. Lo que sí le toca, y bloquea de verdad la logística, es tener al menos un LUGAR
// DE RECOGIDA, que edita él mismo en «La meva organització» › Operativa (hallazgo 6 del plan
// A1). Desde A4 (`20270521100000`) también cuenta como pendiente no tener PRODUCTOS
// HABITUALES, que el productor ya edita él mismo. «Sin lugar principal» no hace falta mirarlo
// aparte: el trigger `trg_ubicacio_principal` garantiza que, si hay lugares, uno es principal.
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
  /** ¿Hay algún productor de la cuenta sin lugar de recogida o sin productos habituales? */
  pendent: boolean
  /** Qué falta (el primero, para el texto de la banda): lugares antes que productos. */
  motiu: 'llocs' | 'productes' | null
  carregant: boolean
}

export function useOperativaPendent(): OperativaPendent {
  const { ctx, rolActiu } = useAppContext()
  const [motiu, setMotiu] = useState<OperativaPendent['motiu']>(null)
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
    if (!extern || productors.length === 0) { setMotiu(null); setCarregant(false); return }
    let viu = true
    setCarregant(true)

    void (async () => {
      // Como mucho una ficha de productor por cuenta: una llamada por ficha, solo la cuenta.
      const ids = productors.map((o) => o.id)
      const [comptes, fitxes] = await Promise.all([
        Promise.all(ids.map((id) => supabase
          .from('productor_ubicaciones')
          .select('id', { count: 'exact', head: true })
          .eq('productor_id', id))),
        supabase.from('productores').select('id, productos_habituales').in('id', ids),
      ])
      if (!viu) return
      // Un error de lectura NO se convierte en banda: decir «te falta» sin saberlo es peor
      // que callar (la ficha lo enseña igual).
      const senseLlocs = comptes.some((r) => !r.error && (r.count ?? 0) === 0)
      const senseProductes = !fitxes.error && (fitxes.data ?? []).some((f) =>
        !Array.isArray(f.productos_habituales) || f.productos_habituales.length === 0)
      setMotiu(senseLlocs ? 'llocs' : senseProductes ? 'productes' : null)
      setCarregant(false)
    })()

    return () => { viu = false }
  }, [extern, clau, tic])

  return { pendent: motiu !== null, motiu, carregant }
}
