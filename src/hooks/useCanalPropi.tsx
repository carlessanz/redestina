// Por dónde quiere que le contactemos, leído y escrito desde cualquier sitio.
//
// POR QUÉ SALE DE `PerfilOrganitzacio` (16-09-2026). Estaba enterrado al final de la ficha
// de la organización, que es una pantalla a la que se entra a corregir el NIF, no a decidir
// cómo te avisan. El cliente lo pidió arriba a la derecha, con el idioma: «me gustaría que
// se pudiera acceder desde el profile del usuario». Sigue estando también en la ficha — es
// el mismo dato y la misma RPC—, así que quien lo busque donde estaba lo encuentra.
//
// ⚠️ EL CANAL ES DE LA ORGANIZACIÓN, NO DE LA PERSONA, y eso tiene una consecuencia que la
//    pantalla debe decir: si dos personas comparten organización, cambiarlo se lo cambia a
//    las dos. Vive en `organizaciones.canal_preferido` justo para que una organización con
//    los dos papeles tenga UN canal y no dos que puedan discrepar (§4).
//
// ⚠️ SE ESCRIBE POR RPC (`actualizar_meu_canal`), nunca por `update`: esa tabla no tiene
//    GRANT de escritura para nadie. Da igual con cuál de las dos fichas se llame —las dos
//    cuelgan de la misma organización—, así que se usa la primera que haya.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAppContext } from './useAppContext'

/** `auto` es el centinela de `canal_preferido = null`. */
export type TriaCanal = 'auto' | 'whatsapp' | 'email'

export function useCanalPropi() {
  const { ctx, rolActiu } = useAppContext()
  const [canal, setCanal] = useState<TriaCanal>('auto')
  const [carregant, setCarregant] = useState(true)
  const [desant, setDesant] = useState(false)

  // Cualquiera de las fichas vale: comparten organización. El equipo no tiene ninguna.
  const fitxa = (ctx?.organitzacions ?? [])[0] ?? null
  const extern = rolActiu === 'productor' || rolActiu === 'receptor'

  useEffect(() => {
    if (!extern || !fitxa) { setCarregant(false); return }
    let viu = true
    void (async () => {
      const taula = fitxa.tipo === 'productor' ? 'productores' : 'entidades'
      const { data } = await supabase
        .from(taula).select('organizacion_id').eq('id', fitxa.id).maybeSingle()
      const orgId = (data as { organizacion_id: string | null } | null)?.organizacion_id
      if (!orgId) { if (viu) setCarregant(false); return }
      const { data: org } = await supabase
        .from('organizaciones').select('canal_preferido').eq('id', orgId).maybeSingle()
      if (!viu) return
      setCanal(((org as { canal_preferido: TriaCanal | null } | null)?.canal_preferido ?? 'auto'))
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [extern, fitxa?.tipo, fitxa?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const desa = useCallback(async (nou: TriaCanal): Promise<boolean> => {
    if (!fitxa) return false
    setDesant(true)
    const { data, error } = await supabase.rpc('actualizar_meu_canal', {
      p_tipo: fitxa.tipo,
      p_ficha: fitxa.id,
      p_canal: nou === 'auto' ? null : nou,
    })
    setDesant(false)
    if (error) return false
    const org = data as { canal_preferido: TriaCanal | null } | null
    setCanal(org?.canal_preferido ?? 'auto')
    return true
  }, [fitxa])

  return { canal, desa, carregant, desant, disponible: extern && fitxa !== null }
}
