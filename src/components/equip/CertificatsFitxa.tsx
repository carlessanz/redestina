// Los certificados de UNA organización, desde su propia ficha. Un componente, dos usos:
//
//   · ficha de **entidad productora** → certificados de DONACIÓN (`CD`): el anual, que sale
//     del cierre, y los de a demanda (`cierres_periodo`).
//   · ficha de **entidad receptora**  → certificados de RECEPCIÓN (`CR`, fase F4): los
//     kilos que le han entrado en una ventana de fechas (`cierres_receptor`).
//
// POR QUÉ EXISTE. Hasta hoy, para saber si una organización tenía su certificado había que
// salir de su ficha, entrar en «Tancament d'exercici», abrir el cierre del año y buscar su
// fila entre las demás. Y el certificado **a demanda** no se podía emitir desde ninguna
// pantalla: existía en la base y nada lo llamaba. Las dos cosas se resuelven donde se
// preguntan: en la ficha.
//
// POR QUÉ ESTÁ PARAMETRIZADO Y NO DUPLICADO. Lo que cambia entre los dos papeles es de
// dónde salen las filas y cómo se llama el documento; el resto —quién puede emitir, la
// barrera de los datos provisionales, el modo deducido de `es_test`, ver y descargar el
// PDF— es idéntico. Dos copias serían dos sitios donde esa barrera puede quedar puesta en
// uno y no en el otro, y eso no falla: emite.
//
// ⚠️ **El modo sale de `es_test`, no se elige** (ver `DialegCertificatPeriode`).
// ⚠️ Con `datos_provisionales` a `true` la base se niega a emitir en modo REAL, así que el
//    botón se apaga **con su motivo visible**. Es material de la fase 0 lo que falta
//    (§12.10), no software, y esconder el botón haría parecer que la función no existe.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useT } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { bloquejaProvisionals, dadesFiscalsProvisionals } from '../../lib/canalitzacio'
import { estilEstatDonant } from '../../lib/tancament'
import { dataCurta } from '../../lib/albarans'
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

/** Lo que se pinta en la lista, venga de donde venga. */
interface Emes {
  id: string
  numero: string
  estat: string
  /** «01/01/2026 → 30/06/2026», o null si es el anual (que no tiene ventana). */
  periode: string | null
  /** El cierre al que pertenece, para enlazarlo. Solo el certificado anual tiene uno. */
  cierre: string | null
}

/** Los textos y las tablas de cada papel, en un solo sitio: el resto del componente no los mira. */
const PERFIL = {
  productor: {
    tipusDoc: 'CD',
    titolKey: 'fit.cert_title',
    hintKey: 'fit.cert_hint',
    buitKey: 'fit.cert_none',
    accioKey: 'fit.cert_generate',
  },
  entidad: {
    tipusDoc: 'CR',
    titolKey: 'fit.certr_title',
    hintKey: 'fit.certr_hint',
    buitKey: 'fit.certr_none',
    accioKey: 'fit.certr_generate',
  },
} as const

/**
 * La ventana de fechas, con el MISMO formato que el resto de la aplicación.
 *
 * ⚠️ No se componía: se pintaba `2026-01-01 → 2026-06-30`, tal cual sale de la base, en la
 *    única pantalla donde esto se lee. Las otras tres que enseñan el mismo periodo —el panel
 *    del productor, el del receptor y `/verificar/:codi`— ya usaban `mydoc.cdp_period` con
 *    `dataCurta()`. Un mismo dato con dos caras es lo que hace dudar de si son dos cosas.
 */
function periode(
  t: (clau: string, params?: Record<string, string | number>) => string,
  p: { periodo_desde: string; periodo_hasta: string },
): string {
  return t('mydoc.cdp_period', {
    desde: dataCurta(p.periodo_desde),
    fins: dataCurta(p.periodo_hasta),
  })
}

export default function CertificatsFitxa(
  { tipus, orgId, esTest }: {
    tipus: 'productor' | 'entidad'
    /** El id de la FICHA (`productores.id` o `entidades.id`), no el de la organización. */
    orgId: string
    esTest: boolean
  },
) {
  const { t } = useT()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false
  const perfil = PERFIL[tipus]
  const [emesos, setEmesos] = useState<Emes[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [provisionals, setProvisionals] = useState(true)
  const [obert, setObert] = useState(false)

  const carrega = useCallback(async () => {
    // ⚠️ Columnas EXPLÍCITAS en `documentos`: un `select('*')` lo corta el GRANT por
    // columnas antes de evaluar ninguna política (§4), y `envio` está fuera.
    // ⚠️ Y cada lista de columnas, en UN literal (§7, deuda 46).
    let files: Emes[]

    if (tipus === 'productor') {
      const [per, anu] = await Promise.all([
        supabase.from('cierres_periodo')
          .select('id, periodo_desde, periodo_hasta, estado, certificado_numero')
          .eq('productor_id', orgId)
          .order('periodo_hasta', { ascending: false }),
        supabase.from('cierres_donante')
          .select('id, cierre_id, estado, certificado_numero')
          .eq('productor_id', orgId).eq('tipo', 'donacio'),
      ])
      const fp = (per.data as FilaPeriode[] | null) ?? []
      const fa = (anu.data as FilaAnual[] | null) ?? []
      files = [
        ...fa.filter((a) => a.certificado_numero).map((a) => ({
          id: a.id, numero: a.certificado_numero!, estat: a.estado,
          periode: null, cierre: a.cierre_id,
        })),
        ...fp.filter((p) => p.certificado_numero).map((p) => ({
          id: p.id, numero: p.certificado_numero!, estat: p.estado,
          periode: periode(t, p), cierre: null,
        })),
      ]
    } else {
      // El certificado de recepción es SIEMPRE a demanda: no cuelga de ningún cierre, así
      // que aquí no hay un «anual» que enseñar aparte ni ningún enlace al que ir.
      const { data } = await supabase.from('cierres_receptor')
        .select('id, periodo_desde, periodo_hasta, estado, certificado_numero')
        .eq('entidad_id', orgId)
        .order('periodo_hasta', { ascending: false })
      files = ((data as FilaPeriode[] | null) ?? [])
        .filter((p) => p.certificado_numero)
        .map((p) => ({
          id: p.id, numero: p.certificado_numero!, estat: p.estado,
          periode: periode(t, p), cierre: null,
        }))
    }

    setEmesos(files)
    if (files.length === 0) { setDocs([]); return }
    const { data } = await supabase.from('documentos')
      .select('id, objeto_id, numero_completo, estado')
      .eq('tipo', perfil.tipusDoc).eq('vigente', true)
      .in('objeto_id', files.map((f) => f.id))
    setDocs((data as Doc[] | null) ?? [])
  }, [orgId, tipus, perfil.tipusDoc, t])

  useEffect(() => { void carrega() }, [carrega])
  useEffect(() => {
    let viu = true
    void dadesFiscalsProvisionals().then((v) => { if (viu) setProvisionals(v) })
    return () => { viu = false }
  }, [])

  const descarregador = useDescarregaDocument(carrega)

  const motiu = !potAprovar
    ? t('fit.cert_readonly')
    : bloquejaProvisionals(provisionals, esTest ? 'prueba' : 'real') ? t('tan.why_provisional') : undefined

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-titulos text-sm font-semibold">{t(perfil.titolKey)}</p>
          <p className="text-xs text-muted-foreground">{t(perfil.hintKey)}</p>
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
            {t(perfil.accioKey)}
          </BotoAmbMotiu>
        </div>
      </div>

      {/* El motivo, visible y no solo en el tooltip. */}
      {motiu && <p className="mt-2 text-xs text-muted-foreground">{motiu}</p>}

      {emesos.length === 0
        ? <p className="mt-2 text-sm text-muted-foreground">{t(perfil.buitKey)}</p>
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
        tipus={tipus}
        orgId={orgId}
        modo={esTest ? 'prueba' : 'real'}
        provisionals={provisionals}
        onEmes={() => void carrega()}
      />
      {descarregador.visor}
    </div>
  )
}
