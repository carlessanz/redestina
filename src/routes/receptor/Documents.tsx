// Los albaranes de entrega de una entidad receptora: lo que ha recibido, y su PDF.
//
// NI UN IMPORTE, Y NO POR OLVIDO. El valor de una donación es un dato del donante y de la
// Fundación: dice cuánto vale fiscalmente lo que ha dado. La entidad que lo recibe no tiene
// ninguna necesidad —ni ningún derecho— de verlo, así que esta pantalla no consulta
// `cierres_donante` ni `costes_producto`. Lee `v_albaranes_bandeja`, cuya RLS le devuelve
// solo sus ENT, y `albaran_lineas` no tiene ninguna columna de dinero.
//
// Es la mitad receptora de `productor/Documents`, y comparte con ella la tabla: la
// diferencia está en el `tipo` que se pide y en lo que se enseña alrededor, no en la tabla.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { Documento } from '../../types'
import { TaulaAlbarans } from '../productor/Documents'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type DocFila = Pick<
  Documento,
  'id' | 'objeto_id' | 'objeto_tipo' | 'numero_completo' | 'estado' | 'vigente'
>

export default function ReceptorDocuments() {
  const { t } = useT()
  const org = useOrganitzacio('entidad')

  const [albarans, setAlbarans] = useState<AlbaranBandeja[]>([])
  const [docs, setDocs] = useState<DocFila[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    // `ENT` y `R-ENT`: una entrega rectificada sigue siendo una entrega suya, y esconderla
    // dejaría a la entidad sin el documento que de verdad vale.
    const { data: albData, error: err } = await supabase
      .from('v_albaranes_bandeja')
      .select('id, tipo, numero_completo, estado, ejercicio, excedente_id, espigolada_id, canalizacion_id, id_excedente, producto, productor_id, entidad_id, codigo_lote, emitido_at, entregado_at, confirmado_at, conciliado_at, rechazo, kg_previstos, kg_neto, kg_confirmados, kg_validados, dias_esperando')
      .in('tipo', ['ENT', 'R-ENT'])
      .order('emitido_at', { ascending: false, nullsFirst: true })
    if (err) return { err }

    const { data: docData } = await supabase
      .from('documentos')
      .select('id, objeto_id, objeto_tipo, numero_completo, estado, vigente')
      .eq('objeto_tipo', 'albaran')
      .eq('vigente', true)

    return {
      albarans: (albData as AlbaranBandeja[] | null) ?? [],
      docs: (docData as DocFila[] | null) ?? [],
      err: null,
    }
  }, [])

  const refresca = useCallback(async () => {
    const r = await carrega()
    if (r.err) { setError(r.err.message); return }
    setAlbarans(r.albarans ?? [])
    setDocs(r.docs ?? [])
  }, [carrega])

  useEffect(() => {
    let viu = true
    void (async () => {
      const r = await carrega()
      if (!viu) return
      if (r.err) { setError(r.err.message); setCarregant(false); return }
      setAlbarans(r.albarans ?? [])
      setDocs(r.docs ?? [])
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega])

  const descarregador = useDescarregaDocument(refresca)

  if (!org) return <p className="text-sm text-muted-foreground">{t('mydoc.no_org_entity')}</p>
  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  if (error) return <p className="text-sm text-destructive">{error}</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('entdoc.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('entdoc.subtitle')}</p>
      </CardHeader>
      <CardContent>
        {albarans.length === 0
          ? <p className="text-sm text-muted-foreground">{t('entdoc.empty')}</p>
          : <TaulaAlbarans files={albarans} docs={docs} descarregador={descarregador} />}
      </CardContent>
    </Card>
  )
}
