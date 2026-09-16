// Los documentos de una entidad receptora: lo que le falta hacer, sus convenios, las
// entregas que ha recibido y su plan de prevención.
//
// NI UN IMPORTE, Y NO POR OLVIDO. El valor de una donación es un dato del donante y de la
// Fundación: dice cuánto vale fiscalmente lo que ha dado. La entidad que lo recibe no tiene
// ninguna necesidad —ni ningún derecho— de verlo, así que esta pantalla no consulta
// `cierres_donante` ni `costes_producto`, y `albaran_lineas` no tiene ninguna columna de
// dinero. Es la única diferencia de fondo con la pantalla hermana del productor.
//
// Comparte con ella los cuatro componentes de `components/documents/`: lo que cambia es qué
// se le pide a cada uno, no cómo se pinta.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { Convenio, Documento } from '../../types'
import PendentsDeTu from '../../components/documents/PendentsDeTu'
import LlistaConvenis from '../../components/documents/LlistaConvenis'
import LlistaDocuments from '../../components/documents/LlistaDocuments'
import TaulaAlbarans from '../../components/documents/TaulaAlbarans'
import CarregantSeccio from '../../components/CarregantSeccio'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type DocFila = Pick<
  Documento,
  'id' | 'objeto_id' | 'objeto_tipo' | 'tipo' | 'subtipo' | 'numero_completo' | 'estado' | 'vigente' | 'ejercicio' | 'emitido_at'
>

type ConveniFila = Pick<
  Convenio,
  'id' | 'tipo' | 'tipo_org' | 'estado' | 'numero_completo' | 'ejercicio'
  | 'enviado_at' | 'firmado_at' | 'contrafirmado_at' | 'created_at'
>

export default function ReceptorDocuments() {
  const { t } = useT()
  const org = useOrganitzacio('entidad')
  const orgId = org?.id ?? null

  const [albarans, setAlbarans] = useState<AlbaranBandeja[]>([])
  const [docs, setDocs] = useState<DocFila[]>([])
  const [convenis, setConvenis] = useState<ConveniFila[]>([])
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

    // Sin filtrar por `objeto_tipo`: ahora hacen falta también los convenios y el plan, y
    // la RLS ya devuelve solo los documentos de sus organizaciones (`documents_meus()`).
    const { data: docData } = await supabase
      .from('documentos')
      .select('id, objeto_id, objeto_tipo, tipo, subtipo, numero_completo, estado, vigente, ejercicio, emitido_at')
      .eq('vigente', true)
      .order('emitido_at', { ascending: false })

    // Por columna, como en el panel del productor: una cuenta con doble rol vería si no
    // los convenios de su ficha de productor, que no son de esta pantalla.
    const { data: convData } = orgId
      ? await supabase
        .from('convenios')
        .select('id, tipo, tipo_org, estado, numero_completo, ejercicio, enviado_at, firmado_at, contrafirmado_at, created_at')
        .eq('entidad_id', orgId)
        .order('created_at', { ascending: false })
      : { data: [] }

    return {
      albarans: (albData as AlbaranBandeja[] | null) ?? [],
      docs: (docData as DocFila[] | null) ?? [],
      convenis: (convData as ConveniFila[] | null) ?? [],
      err: null,
    }
  }, [orgId])

  const refresca = useCallback(async () => {
    const r = await carrega()
    if (r.err) { setError(r.err.message); return }
    setAlbarans(r.albarans ?? [])
    setDocs(r.docs ?? [])
    setConvenis(r.convenis ?? [])
  }, [carrega])

  useEffect(() => {
    let viu = true
    void (async () => {
      const r = await carrega()
      if (!viu) return
      if (r.err) { setError(r.err.message); setCarregant(false); return }
      setAlbarans(r.albarans ?? [])
      setDocs(r.docs ?? [])
      setConvenis(r.convenis ?? [])
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega])

  const descarregador = useDescarregaDocument(refresca)

  if (!org) return <p className="text-sm text-muted-foreground">{t('mydoc.no_org_entity')}</p>
  if (carregant) return <CarregantSeccio />
  if (error) return <p className="text-sm text-destructive">{error}</p>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t('entdoc.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('entdoc.subtitle')}</p>
      </div>

      {/* Lo único de esta pantalla que le pide algo. El resto es archivo. */}
      <PendentsDeTu tipusOrg="entidad" tornarA="/receptor/documents" />

      <LlistaConvenis files={convenis} docs={docs} descarregador={descarregador} />

      <Card>
        <CardHeader><CardTitle className="text-base">{t('entdoc.alb_title')}</CardTitle></CardHeader>
        <CardContent>
          {albarans.length === 0
            ? <p className="text-sm text-muted-foreground">{t('entdoc.empty')}</p>
            : <TaulaAlbarans files={albarans} docs={docs} descarregador={descarregador} />}
        </CardContent>
      </Card>

      {/* Se lista desde `documentos` porque no hay pantalla de planes: lo único que existe
          del plan de prevención es su PDF. */}
      <LlistaDocuments
        files={docs.filter((d) => d.objeto_tipo === 'plan')}
        descarregador={descarregador}
        titolKey="mydoc.pla_title"
        buitKey="mydoc.pla_empty"
      />

      {/* El visor de PDF. Una sola vez por pantalla: el hook es uno y el modal también. */}
      {descarregador.visor}
    </div>
  )
}
