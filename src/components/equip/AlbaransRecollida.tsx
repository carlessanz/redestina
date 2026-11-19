// Los albaranes de UNA recogida, con su PDF a mano (fase 3 de los puntos 4-6, 19-11-2026).
//
// Al registrar (o validar) una recogida de donación salen, en el mismo acto, su ENT y SU REC ya
// conciliados (20270608100200). Lo primero que necesita quien acaba de pulsar es tenerlos:
// verlos, guardarlos o mandarlos por WhatsApp a la otra parte. Por eso cada uno lleva:
//   · «Veure» → el visor (en móvil, una pestaña), por `useDescarregaDocument`;
//   · «Descarrega» → el PDF guardado con su número;
//   · «Comparteix» → en el móvil, la hoja de compartir del sistema con el PDF adjunto; en el
//     escritorio, la descarga (`compartirDocument.ts`).
// Todo pasa por `descargar-documento` (URL firmada de 60 s); aquí no hay ninguna URL de Storage.
//
// Qué albaranes: la salida de la canalización (ENT; un OPE solo si es heredado) y su REC —el
// suyo o, en una oferta del modelo viejo, el heredado— (`albaransDeLaRecollida`). Un documento
// recién emitido tarda unos segundos en tener PDF: se pregunta otra vez cada 2 s durante 30 s
// (polling, sin Realtime), y el hook espera lo que falte si alguien pulsa antes.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Download, Eye, Loader2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { estilEstatAlbara } from '../../lib/albarans'
import { albaransDeLaRecollida } from '../../lib/albaransRecollida'
import type { AlbaraMinim } from '../../lib/albaransRecollida'
import { esperarGeneracio, urlDocument } from '../../lib/documents'
import { comparteixPdf, nomFitxerPdf } from '../../lib/compartirDocument'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { useIsMobile } from '../../hooks/use-mobile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface AlbaraFila extends AlbaraMinim {
  numero_completo: string | null
}

/** Cuántas veces se vuelve a mirar si ya hay PDF (cada 2 s: 30 s en total). */
const INTENTS_PDF = 15
const INTERVAL_PDF_MS = 2_000

export default function AlbaransRecollida({ canalitzacio, excedentId, versio = 0 }: {
  canalitzacio: string
  /** La oferta: hace falta para encontrar el REC heredado (sin canalización). */
  excedentId: string | null
  /** Sube cuando algo ha cambiado (p. ej. tras validar): se vuelve a leer. */
  versio?: number
}) {
  const { t } = useT()
  const esMobil = useIsMobile()
  const [albarans, setAlbarans] = useState<AlbaraFila[] | null>(null)
  // El documento vigente de cada albarán con número: `albaran.id → documento.id`.
  const [docs, setDocs] = useState<Record<string, string>>({})
  const [compartint, setCompartint] = useState<string | null>(null)
  const descarregador = useDescarregaDocument()

  const carregaDocs = useCallback(async (ids: string[]): Promise<Record<string, string>> => {
    if (ids.length === 0) return {}
    const { data } = await supabase.from('documentos')
      .select('id, objeto_id')
      .eq('objeto_tipo', 'albaran').eq('vigente', true).in('objeto_id', ids)
    return Object.fromEntries(((data as { id: string; objeto_id: string }[] | null) ?? [])
      .map((d) => [d.objeto_id, d.id]))
  }, [])

  useEffect(() => {
    let viu = true
    let intents = 0
    let temporitzador: ReturnType<typeof setTimeout> | null = null
    void (async () => {
      // ⚠️ La lista de columnas en UN literal (§7). Todos los de la oferta: el REC heredado no
      //    lleva canalización y hay que poder encontrarlo.
      const consulta = supabase.from('albaranes')
        .select('id, tipo, numero_completo, estado, canalizacion_id, espigolada_id')
      const { data, error } = excedentId
        ? await consulta.eq('excedente_id', excedentId)
        : await consulta.eq('canalizacion_id', canalitzacio)
      if (!viu) return
      if (error) { setAlbarans([]); return }
      const meus = albaransDeLaRecollida((data as AlbaraFila[] | null) ?? [], canalitzacio)
      setAlbarans(meus)
      const ambNumero = meus.filter((a) => a.numero_completo).map((a) => a.id)
      // El PDF puede no existir todavía (se acaba de emitir): se vuelve a mirar unas cuantas veces.
      const mira = async () => {
        const d = await carregaDocs(ambNumero)
        if (!viu) return
        setDocs(d)
        intents += 1
        if (ambNumero.some((id) => !d[id]) && intents < INTENTS_PDF) {
          temporitzador = setTimeout(() => { void mira() }, INTERVAL_PDF_MS)
        }
      }
      await mira()
    })()
    return () => {
      viu = false
      if (temporitzador) clearTimeout(temporitzador)
    }
  }, [canalitzacio, excedentId, versio, carregaDocs])

  async function comparteix(a: AlbaraFila, docId: string) {
    setCompartint(docId)
    try {
      let res = await urlDocument(docId)
      if (!res.ok && res.codi === 'sense_fitxer') {
        toast.info(t('doc.generating_wait'))
        const espera = await esperarGeneracio(docId)
        if (espera.resultat !== 'emitido') {
          if (espera.motiuKey) toast.error(t(espera.motiuKey))
          return
        }
        res = await urlDocument(docId)
      }
      if (!res.ok) { toast.error(t(res.motiuKey)); return }
      const nom = nomFitxerPdf(res.data.nombre, a.numero_completo ?? a.tipo)
      const r = await comparteixPdf(res.data.url, nom, esMobil)
      if (r === 'descarregat') toast.success(t('doc.downloaded', { name: nom }))
      else if (r === 'error') toast.error(t('doc.err_generic'))
    } finally {
      setCompartint(null)
    }
  }

  if (albarans === null) {
    return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  }
  if (albarans.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid="albarans-recollida-buit">{t('arec.buit')}</p>
  }

  return (
    <div className="space-y-2" data-testid="albarans-recollida">
      {albarans.map((a) => {
        const docId = docs[a.id]
        const ocupat = descarregador.ocupat === docId || compartint === docId
        return (
          <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-background p-2"
            data-testid="albara-recollida">
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-sm">
                <span className="font-medium">{t(`arec.tipus_${a.tipo}`)}</span>
                {' · '}
                <Link to={`/equip/albarans/${a.id}`} className="tabular-nums text-primary hover:underline">
                  {a.numero_completo ?? t('alb.no_number')}
                </Link>
              </p>
              <Badge className={`mt-1 ${estilEstatAlbara(a.estado)}`}>{t(`alb.st_${a.estado}`)}</Badge>
            </div>
            {docId ? (
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <Button size="sm" variant="outline" className="h-11 whitespace-normal md:h-8" disabled={ocupat}
                  onClick={() => void descarregador.mostra(docId)}>
                  <Eye className="size-4" aria-hidden />{t('doc.view')}
                </Button>
                <Button size="sm" variant="outline" className="h-11 whitespace-normal md:h-8" disabled={ocupat}
                  onClick={() => void descarregador.descarrega(docId)}>
                  {descarregador.ocupat === docId
                    ? <Loader2 className="size-4 animate-spin" aria-hidden />
                    : <Download className="size-4" aria-hidden />}
                  {t('doc.download')}
                </Button>
                <Button size="sm" className="h-11 whitespace-normal md:h-8" disabled={ocupat}
                  onClick={() => void comparteix(a, docId)}>
                  {compartint === docId
                    ? <Loader2 className="size-4 animate-spin" aria-hidden />
                    : <Share2 className="size-4" aria-hidden />}
                  {t('fo.comparteix')}
                </Button>
              </div>
            ) : a.numero_completo ? (
              <p className="text-xs text-muted-foreground">{t('doc.generating')}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('arec.sense_numero')}</p>
            )}
          </div>
        )
      })}
      {descarregador.visor}
    </div>
  )
}
