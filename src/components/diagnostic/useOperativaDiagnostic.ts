// La Operativa del productor DENTRO del diagnóstico (Plan 2, A4, `20270521100000`; T4).
//
// 🔴 UN SOLO ORIGEN: la sección 1 del diagnóstico no guarda respuestas propias, edita las
//    columnas de `productores` (actividad, productos, principales, variedades, volumen,
//    temporada, envases, comercialización, apoyo) con los mismos campos que la pestaña
//    Operativa de la ficha (`campsFitxa.ts`, bloque `ofertant`). Por eso el cuestionario v3
//    ya no pregunta nada de eso.
//
// Lo usa `FormulariDiagnostic`: carga la fila, la edita en memoria y, al pulsar «Desa», escribe
// SOLO lo que ha cambiado (UPDATE directo: el diagnóstico lo conduce el equipo, D5, y la
// política `productores: edicio intern` lo deja) antes de llamar a `desar_excedents_diagnostic` (A3).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  COLUMNES_OPERATIVA, campsOperativa, mateixValor, normalitzaValor,
} from '../../lib/campsFitxa'
import { activitatsPerPaper, carregaTipusActivitat, type TipusActivitat } from '../../lib/organitzacio'

type Fila = Record<string, unknown>


export function useOperativaDiagnostic(productorId: string) {
  const camps = useMemo(() => campsOperativa(), [])
  const [valors, setValors] = useState<Fila>({})
  const [inicial, setInicial] = useState<Fila>({})
  const [error, setError] = useState<string | null>(null)
  const [cataleg, setCataleg] = useState<TipusActivitat[]>([])

  useEffect(() => { void carregaTipusActivitat().then(setCataleg) }, [])
  const activitats = useMemo(() => activitatsPerPaper(cataleg, 'productor'), [cataleg])

  const carrega = useCallback(async () => {
    // Un solo literal (§7). Tiene que ser exactamente las columnas de `campsOperativa()`:
    // `tests/operativaLlegible.test.ts` lo compara.
    const { data, error: e } = await supabase.from('productores')
      .select(COLUMNES_OPERATIVA)
      .eq('id', productorId).maybeSingle()
    if (e || !data) { setError(e?.message ?? 'c.error'); return }
    const fila = data as Fila
    const v: Fila = {}
    for (const c of camps) v[c.clau] = fila[c.columnes.productores as string] ?? null
    setError(null)
    setValors(v)
    setInicial(v)
  }, [camps, productorId])

  useEffect(() => { void carrega() }, [carrega])

  const onChange = useCallback((clau: string, valor: unknown) => {
    setValors((v) => ({ ...v, [clau]: valor }))
  }, [])

  /** Solo lo que ha cambiado, por columna (las actividades, solo las del papel productor). */
  const canvis = useCallback((): Fila => {
    const valides = new Set(activitats.map((a) => a.codi))
    const out: Fila = {}
    for (const c of camps) {
      let nou = normalitzaValor(c, valors[c.clau])
      const abans = normalitzaValor(c, inicial[c.clau])
      if (c.tipus === 'xips_activitat' && Array.isArray(nou) && valides.size > 0) {
        const f = (nou as string[]).filter((x) => valides.has(x))
        nou = f.length ? f : null
      }
      if (mateixValor(nou, abans)) continue
      out[c.columnes.productores as string] = nou
    }
    return out
  }, [activitats, camps, inicial, valors])

  /** Escribe lo cambiado. `ok:false` con el mensaje si la base lo rechaza (o la RLS, 0 filas). */
  const desa = useCallback(async (): Promise<{ ok: true; n: number } | { ok: false; missatge: string }> => {
    const dades = canvis()
    if (Object.keys(dades).length === 0) return { ok: true, n: 0 }
    const { data, error: e } = await supabase.from('productores').update(dades).eq('id', productorId).select('id')
    if (e) return { ok: false, missatge: e.message }
    if (!data || data.length === 0) return { ok: false, missatge: 'c.error' }
    await carrega()
    return { ok: true, n: Object.keys(dades).length }
  }, [canvis, carrega, productorId])

  /** Para el chip de la sección: con productos habituales y algún principal, «completa». */
  const contestades = camps.filter((c) => {
    const v = normalitzaValor(c, valors[c.clau])
    return v !== null && v !== undefined
  }).length
  const completa = Array.isArray(valors.productos_habituales) && (valors.productos_habituales as unknown[]).length > 0
    && Array.isArray(valors.productes_principals) && (valors.productes_principals as unknown[]).length > 0

  return { camps, valors, onChange, activitats, desa, error, contestades, completa }
}
