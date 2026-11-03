// Los albaranes de UNA ficha, en la pestaña «Documentació» de la ficha del equipo (03-11-2026,
// Taula mestra 7.1 y 7.2: «a cada fitxa d'entitat, apartats Albarans, Certificats i Convenis»).
//
// Los mismos que ve la propia organización en su panel, y con la misma tabla
// (`documents/TaulaAlbarans`): a la productora, los REC (lo que se le recogió); a la receptora,
// los ENT y los OPE (lo que se le entregó). El equipo ve toda la bandeja por RLS, así que aquí
// SÍ se filtra por ficha: sin el `.eq()` saldrían los de todas las organizaciones.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { Documento } from '../../types'
import TaulaAlbarans from '../documents/TaulaAlbarans'

type Fila = Pick<
  AlbaranBandeja,
  'id' | 'numero_completo' | 'producto' | 'estado' | 'emitido_at' | 'kg_validados' | 'kg_confirmados' | 'kg_neto' | 'kg_previstos'
>
type Doc = Pick<Documento, 'id' | 'objeto_id' | 'objeto_tipo' | 'numero_completo' | 'estado' | 'vigente'>

export default function AlbaransFitxa({ tipusOrg, orgId, onCompte }: {
  tipusOrg: 'productor' | 'entidad'
  orgId: string
  /** Cuántos hay, para el contador de la pestaña. */
  onCompte?: (n: number) => void
}) {
  const { t } = useT()
  const [files, setFiles] = useState<Fila[] | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [error, setError] = useState(false)

  const carrega = useCallback(async () => {
    const consulta = supabase
      .from('v_albaranes_bandeja')
      .select('id, numero_completo, producto, estado, emitido_at, kg_validados, kg_confirmados, kg_neto, kg_previstos')
    const { data, error: e } = await (tipusOrg === 'productor'
      ? consulta.eq('productor_id', orgId).eq('tipo', 'REC')
      : consulta.eq('entidad_id', orgId).in('tipo', ['ENT', 'OPE']))
      .order('emitido_at', { ascending: false, nullsFirst: true })
    if (e) { setError(true); return }
    const llista = (data as Fila[] | null) ?? []
    let pdfs: Doc[] = []
    if (llista.length > 0) {
      const { data: d, error: ed } = await supabase
        .from('documentos')
        .select('id, objeto_id, objeto_tipo, numero_completo, estado, vigente')
        .eq('objeto_tipo', 'albaran')
        .eq('vigente', true)
        .in('objeto_id', llista.map((f) => f.id))
      if (ed) { setError(true); return }
      pdfs = (d as Doc[] | null) ?? []
    }
    setError(false)
    setFiles(llista)
    setDocs(pdfs)
    onCompte?.(llista.length)
  }, [tipusOrg, orgId, onCompte])

  useEffect(() => { void carrega() }, [carrega])
  const descarregador = useDescarregaDocument(carrega)

  if (error) return <p className="text-sm text-destructive">{t('c.load_error')}</p>
  if (files === null) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  if (files.length === 0) return <p className="text-sm text-muted-foreground">{t('ef.doc_cap_albara')}</p>
  return (
    <>
      <TaulaAlbarans files={files} docs={docs} descarregador={descarregador} />
      {descarregador.visor}
    </>
  )
}
