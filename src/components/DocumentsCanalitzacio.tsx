// Los documentos PROPIOS de una venta o una maquila (fase 3 de los puntos 4-6, 19-11-2026).
//
// Desde esta fase una venta y una maquila no tienen albarán de Redestina: la recogida validada
// deja la canalización conciliada y nada más. Lo que acredite la operación (el albarán del
// productor, la factura, una foto) lo aportan las partes o el equipo, y cuelga de la propia
// recogida: `documentos_externos` con `objeto_tipo = 'canalizacion'` (20270608100400).
//
// Subir va por la Edge Function `subir-documento-externo` (`pujarDocumentExtern`) y abrir por
// `descargar-documento` (`descarregarDocumentExtern`): ninguna URL de Storage desde aquí. Quién
// puede subir lo decide la base (`puc_pujar_document_extern`: el equipo y las dos partes).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { dataCurta } from '../lib/format'
import { descarregarDocumentExtern, pujarDocumentExtern } from '../lib/documents'
import type { DocumentoExterno } from '../types'
import BotoIcona from './BotoIcona'
import Desplegable from './Desplegable'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

/** Lo que tiene sentido colgar de una venta o maquila. */
type TipusDoc = 'albaran_productor' | 'factura' | 'foto_incidencia' | 'altre'
const TIPUS: TipusDoc[] = ['albaran_productor', 'factura', 'foto_incidencia', 'altre']

export default function DocumentsCanalitzacio({ canalitzacio, idPrefix, onCanvi }: {
  canalitzacio: string
  /** Prefijo de los `id` de los campos (puede haber varias en la misma pantalla). */
  idPrefix: string
  /** Tras subir uno: quien lo contiene puede querer recontar. */
  onCanvi?: (n: number) => void
}) {
  const { t } = useT()
  const [docs, setDocs] = useState<DocumentoExterno[] | null>(null)
  const [tipus, setTipus] = useState<TipusDoc>('albaran_productor')
  const [pujant, setPujant] = useState(false)
  const [obrint, setObrint] = useState<string | null>(null)
  const fitxer = useRef<HTMLInputElement | null>(null)
  const canvi = useRef(onCanvi)
  canvi.current = onCanvi

  const carrega = useCallback(async () => {
    // ⚠️ La lista de columnas en UN literal (§7).
    const { data, error } = await supabase.from('documentos_externos')
      .select('id, objeto_tipo, objeto_id, tipo, numero, fecha, ruta, sha256, mime, bytes, origen, subido_por, created_at')
      .eq('objeto_tipo', 'canalizacion').eq('objeto_id', canalitzacio)
      .order('created_at', { ascending: false })
    const llista = error ? [] : ((data as DocumentoExterno[] | null) ?? [])
    setDocs(llista)
    canvi.current?.(llista.length)
  }, [canalitzacio])

  useEffect(() => { void carrega() }, [carrega])

  async function puja(f: File) {
    setPujant(true)
    const res = await pujarDocumentExtern({
      fitxer: f, objecteTipus: 'canalizacion', objecteId: canalitzacio, tipus,
    })
    setPujant(false)
    if (!res.ok) { toast.error(t(res.motiuKey)); return }
    toast.success(t('alb.ex_uploaded', { name: res.data.nombre }))
    await carrega()
  }

  async function obre(id: string) {
    setObrint(id)
    const res = await descarregarDocumentExtern(id)
    setObrint(null)
    if (!res.ok) toast.error(t(res.motiuKey))
  }

  return (
    <div className="space-y-3" data-testid="documents-canalitzacio">
      {docs === null && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
      {docs !== null && docs.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('dcan.buit')}</p>
      )}
      {docs?.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-2 border-b pb-2 text-sm">
          <span className="min-w-0 break-words">
            <span className="font-medium">{t(`alb.ex_${d.tipo}`)}</span>
            {d.numero ? <span className="tabular-nums"> · {d.numero}</span> : null}
            <span className="text-muted-foreground"> · {dataCurta(d.fecha ?? d.created_at)}</span>
          </span>
          <BotoIcona icona={obrint === d.id ? Loader2 : Download} etiqueta={t('doc.download')}
            disabled={obrint === d.id} onClick={() => void obre(d.id)} />
        </div>
      ))}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-tipus`}>{t('alb.ex_type')}</Label>
          <Desplegable id={`${idPrefix}-tipus`} value={tipus} onChange={(v) => setTipus(v as TipusDoc)}
            opcions={TIPUS.map((tp) => ({ valor: tp, text: t(`alb.ex_${tp}`) }))} />
        </div>
        {/* El `<input type=file>` va escondido y lo dispara el botón (patrón de `AlbaraDetall`). */}
        <input ref={fitxer} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden"
          data-testid={`${idPrefix}-fitxer`}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void puja(f)
          }} />
        <Button className="h-11 w-full whitespace-normal sm:w-auto md:h-8" disabled={pujant}
          onClick={() => fitxer.current?.click()}>
          {pujant ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {t('alb.ex_upload')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('dcan.hint')}</p>
    </div>
  )
}
