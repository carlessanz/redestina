// Carga lo que hace falta para componer los mensajes de una oferta (`missatgesOferta.ts`) y
// los compone (27-10-2026, fase 4 del plan de gestión autónoma). Lo usan los tres paneles: la
// RLS decide qué ve cada uno —el equipo, todo; ofertante y receptor, lo suyo—, y cada pantalla
// filtra después por destinatario.
//
// Nunca lanza: lo que no se puede leer se queda fuera y `error` lo dice.
//
// ⚠️ `perspectiva` no es cosmética. Para ofertante y receptor solo se piden los avisos y lo
//    que hace falta para componerlos: el `texto_oferta` lleva «PRODUCTOR: …» (D3, §12.131) y el
//    navegador de la receptora no lo recibe desde el 28-09-2026; y el agradecimiento del alta
//    lleva el código `E-…`, que el ofertante ya no ve (fase 0 del 08-10-2026). Los paneles
//    externos enseñan solo los avisos, que es exactamente lo que la plataforma les manda.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { missatgesDeLOferta } from '../lib/missatgesOferta'
import type { AvisMissatge, FetsMissatges, Missatge } from '../lib/missatgesOferta'

export type PerspectivaMissatges = 'equip' | 'productor' | 'entidad'

export function useMissatgesOferta(
  excedenteId: string | null | undefined,
  /** Cualquier valor que cambie cuando haya que volver a leer (una firma del estado). */
  versio: number | string = 0,
  perspectiva: PerspectivaMissatges = 'equip',
): {
  missatges: Missatge[]
  carregant: boolean
  error: boolean
  recarrega: () => void
} {
  const { t, lang } = useT()
  const [missatges, setMissatges] = useState<Missatge[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState(false)
  const [tic, setTic] = useState(0)
  const recarrega = useCallback(() => setTic((n) => n + 1), [])

  useEffect(() => {
    if (!excedenteId) { setMissatges([]); setCarregant(false); return }
    let viu = true
    void (async () => {
      const equip = perspectiva === 'equip'
      const [ex, cans, resps, avs] = await Promise.all([
        equip
          ? supabase.from('excedentes')
            .select('id, producto, id_excedente, estado, texto_oferta, kg_total, origen, validada_at, created_at, productor_id')
            .eq('id', excedenteId).maybeSingle()
          : supabase.from('excedentes')
            .select('id, producto, estado, kg_total, origen, validada_at, created_at')
            .eq('id', excedenteId).maybeSingle(),
        // Fuera del equipo solo se enseñan los avisos, y para componerlos basta la oferta.
        equip
          ? supabase.from('canalizaciones')
            .select('id, entidad_id, kg_confirmados, data_hora_recollida, estado, comentarios, created_at')
            .eq('excedente_id', excedenteId)
          : Promise.resolve({ data: [], error: null }),
        equip
          ? supabase.from('oferta_respuestas')
            .select('id, entidad_id, canal, estado, kg_solicitados, respondido_at, enviado_at')
            .eq('excedente_id', excedenteId)
          : Promise.resolve({ data: [], error: null }),
        supabase.rpc('avisos_de_oferta', { p_excedente: excedenteId }),
      ])
      if (!viu) return
      const fila = ex.data as (Partial<FetsMissatges['oferta']> & { id: string; estado: string; productor_id?: string | null }) | null
      if (!fila) { setMissatges([]); setError(Boolean(ex.error)); setCarregant(false); return }
      // Fuera del equipo, sin texto ni código: lo compuesto que los necesita no se compone.
      const oferta: FetsMissatges['oferta'] & { productor_id: string | null } = {
        producto: null, kg_total: null, ...fila,
        id_excedente: equip ? (fila.id_excedente ?? null) : null,
        texto_oferta: equip ? (fila.texto_oferta ?? null) : null,
        productor_id: equip ? (fila.productor_id ?? null) : null,
      }

      const canalitzacions = (cans.data ?? []) as NonNullable<FetsMissatges['canalitzacions']>
      const respostes = (resps.data ?? []) as NonNullable<FetsMissatges['respostes']>
      const avisos = (avs.data ?? []) as AvisMissatge[]
      // Los nombres: lo que la RLS deje leer (al productor no le deja leer entidades, y no
      // pasa nada: el mensaje se compone igual, sin el nombre en la etiqueta).
      const ids = [...new Set([...canalitzacions, ...respostes].map((x) => x.entidad_id).filter(Boolean))] as string[]
      const [ents, prod] = await Promise.all([
        ids.length > 0
          ? supabase.from('entidades').select('id, nombre').in('id', ids)
          : Promise.resolve({ data: [] as { id: string; nombre: string }[], error: null }),
        oferta.productor_id
          ? supabase.from('productores').select('id, name, empresa').eq('id', oferta.productor_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])
      if (!viu) return
      const entitats = Object.fromEntries(((ents.data ?? []) as { id: string; nombre: string }[]).map((e) => [e.id, e.nombre]))
      const p = prod.data as { id: string; name: string | null; empresa: string | null } | null

      setMissatges(missatgesDeLOferta({
        oferta, respostes, canalitzacions, avisos, entitats,
        productor: p ? { id: p.id, nom: p.empresa || p.name } : null,
      }, { idioma: lang, appUrl: window.location.origin, t }))
      setError(Boolean(ex.error || cans.error || resps.error || avs.error))
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [excedenteId, versio, tic, lang, t, perspectiva])

  return { missatges, carregant, error, recarrega }
}
