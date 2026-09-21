// Los certificados de donación de UNA entidad productora, desde su propia ficha.
//
// POR QUÉ EXISTE. Hasta hoy, para saber si una organización tenía su certificado había que
// salir de su ficha, entrar en «Tancament d'exercici», abrir el cierre del año y buscar su
// fila entre las demás. Y el certificado **a demanda** —el de «lo que lleva donado este
// año»— no se podía emitir desde ninguna pantalla: existía en la base y nada lo llamaba.
//
// Las dos cosas se resuelven donde se preguntan: en la ficha.
//
// ⚠️ **El modo sale de `es_test`, no se elige** (ver `DialegCertificatPeriode`).
// ⚠️ Con `datos_provisionales` a `true` la base se niega a emitir, así que el botón se apaga
//    **con su motivo visible**. Es material de la fase 0 lo que falta (§12.10), no software,
//    y esconder el botón haría parecer que la función no existe.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useT } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { bloquejaProvisionals, dadesFiscalsProvisionals } from '../../lib/canalitzacio'
import { estilEstatDonant } from '../../lib/tancament'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { useAppContext } from '../../hooks/useAppContext'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import DialegCertificatPeriode from './DialegCertificatPeriode'
import { BadgeMode } from '../../routes/equip/Tancament'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface FilaPeriode {
  id: string
  periodo_desde: string
  periodo_hasta: string
  estado: string
  certificado_numero: string | null
}

interface FilaAnual {
  id: string
  cierre_id: string
  estado: string
  certificado_numero: string | null
}

interface Doc {
  id: string
  objeto_id: string
  numero_completo: string
  estado: string
}

export default function CertificatsFitxa(
  { productorId, esTest }: { productorId: string; esTest: boolean },
) {
  const { t } = useT()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false
  const [periodes, setPeriodes] = useState<FilaPeriode[]>([])
  const [anuals, setAnuals] = useState<FilaAnual[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [provisionals, setProvisionals] = useState(true)
  const [obert, setObert] = useState(false)

  const carrega = useCallback(async () => {
    // ⚠️ Columnas EXPLÍCITAS en `documentos`: un `select('*')` lo corta el GRANT por
    // columnas antes de evaluar ninguna política (§4), y `envio` está fuera.
    const [per, anu] = await Promise.all([
      supabase.from('cierres_periodo')
        .select('id, periodo_desde, periodo_hasta, estado, certificado_numero')
        .eq('productor_id', productorId)
        .order('periodo_hasta', { ascending: false }),
      supabase.from('cierres_donante')
        .select('id, cierre_id, estado, certificado_numero')
        .eq('productor_id', productorId).eq('tipo', 'donacio'),
    ])
    const fp = (per.data as FilaPeriode[] | null) ?? []
    const fa = (anu.data as FilaAnual[] | null) ?? []
    setPeriodes(fp)
    setAnuals(fa)

    const ids = [...fp.map((x) => x.id), ...fa.map((x) => x.id)]
    if (ids.length === 0) { setDocs([]); return }
    const { data } = await supabase.from('documentos')
      .select('id, objeto_id, numero_completo, estado')
      .eq('tipo', 'CD').eq('vigente', true).in('objeto_id', ids)
    setDocs((data as Doc[] | null) ?? [])
  }, [productorId])

  useEffect(() => { void carrega() }, [carrega])
  useEffect(() => {
    let viu = true
    void dadesFiscalsProvisionals().then((v) => { if (viu) setProvisionals(v) })
    return () => { viu = false }
  }, [])

  const descarregador = useDescarregaDocument(carrega)
  const emesos = [
    ...anuals.filter((a) => a.certificado_numero).map((a) => ({
      id: a.id,
      numero: a.certificado_numero!,
      estat: a.estado,
      periode: null as string | null,
      cierre: a.cierre_id,
    })),
    ...periodes.filter((p) => p.certificado_numero).map((p) => ({
      id: p.id,
      numero: p.certificado_numero!,
      estat: p.estado,
      periode: `${p.periodo_desde} → ${p.periodo_hasta}`,
      cierre: null as string | null,
    })),
  ]

  const motiu = !potAprovar
    ? t('fit.cert_readonly')
    : bloquejaProvisionals(provisionals, esTest ? 'prueba' : 'real') ? t('tan.why_provisional') : undefined

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-titulos text-sm font-semibold">{t('fit.cert_title')}</p>
          <p className="text-xs text-muted-foreground">{t('fit.cert_hint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {esTest && <BadgeMode mode="prueba" />}
          <BotoAmbMotiu
            size="sm"
            className="h-11 whitespace-normal md:h-8"
            disabled={motiu !== undefined}
            motiu={motiu}
            onClick={() => setObert(true)}
          >
            {t('fit.cert_generate')}
          </BotoAmbMotiu>
        </div>
      </div>

      {/* El motivo, visible y no solo en el tooltip. */}
      {motiu && <p className="mt-2 text-xs text-muted-foreground">{motiu}</p>}

      {emesos.length === 0
        ? <p className="mt-2 text-sm text-muted-foreground">{t('fit.cert_none')}</p>
        : (
          <ul className="mt-2 space-y-1">
            {emesos.map((c) => {
              const doc = docs.find((d) => d.objeto_id === c.id)
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <span className="text-sm">
                    <span className="font-medium tabular-nums">{c.numero}</span>
                    {c.periode
                      ? <span className="text-muted-foreground">{` · ${c.periode}`}</span>
                      : <span className="text-muted-foreground">{` · ${t('fit.cert_annual')}`}</span>}
                    <Badge className={`ml-2 ${estilEstatDonant(c.estat)}`}>
                      {t(`tan.ds_${c.estat}`)}
                    </Badge>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {doc && doc.estado === 'emitido' && (
                      <>
                        <Button
                          size="sm" variant="outline" className="h-11 whitespace-normal md:h-8"
                          disabled={descarregador.ocupat === doc.id}
                          onClick={() => void descarregador.mostra(doc.id)}
                        >
                          {t('doc.view')}
                        </Button>
                        <Button
                          size="sm" variant="outline" className="h-11 whitespace-normal md:h-8"
                          disabled={descarregador.ocupat === doc.id}
                          onClick={() => void descarregador.descarrega(doc.id)}
                        >
                          {t('doc.download')}
                        </Button>
                      </>
                    )}
                    {c.cierre && (
                      <Button asChild size="sm" variant="ghost" className="h-11 whitespace-normal md:h-8">
                        <Link to={`/equip/tancament/${c.cierre}`}>{t('fit.cert_open_closing')}</Link>
                      </Button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

      <DialegCertificatPeriode
        obert={obert}
        onTancar={() => setObert(false)}
        productorId={productorId}
        modo={esTest ? 'prueba' : 'real'}
        provisionals={provisionals}
        onEmes={() => void carrega()}
      />
      {descarregador.visor}
    </div>
  )
}
