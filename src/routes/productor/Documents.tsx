// Los documentos de un productor: lo que le falta hacer, sus convenios, su acumulado del
// año, sus albaranes de recepción, sus certificados y su plan de prevención.
//
// ES LA ÚNICA PANTALLA DEL PROYECTO DONDE UNA ORGANIZACIÓN VE UN IMPORTE SUYO, y por eso
// conviene decir de dónde sale y de dónde no. Sale de `cierres_donante`, que la RLS
// (20261109100000) le deja leer **solo si la fila es suya**; y la fila de un cierre de
// PRUEBA solo la ve si su ficha es `es_test`, precisamente para que un donante real no se
// encuentre un acumulado sin ningún valor fiscal y lo tome por el bueno. Un receptor no ve
// nada de esto: su pantalla hermana (`receptor/Documents`) enseña kilos y ni un euro.
//
// EL AÑO NO SALE DE UN JOIN. `cierres_ejercicio` es del equipo —el donante no tiene por qué
// saber cuántos ensayos se han hecho—, así que aquí el ejercicio se lee de su propio número
// (`P-RES-2026-0001`) o de `documentos.ejercicio`, que también son datos suyos. Si algún día
// aparece aquí un `select` a `cierres_ejercicio`, devolverá null y no será un error: será un
// año en blanco, que es peor.
//
// NINGUNA CONSULTA FILTRA POR ORGANIZACIÓN, y no es un olvido: la RLS ya devuelve solo lo
// suyo. Un `.eq()` de más aquí daría la falsa impresión de que es el filtro lo que protege.
// La excepción son los convenios, que sí llevan `.eq()` por columna: una cuenta con doble
// rol vería también los de su otra ficha, y esta pantalla es la del productor.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Eye, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { pujarDocumentExtern } from '../../lib/documents'
import { kg } from '../../lib/albarans'
import type { AlbaranBandeja } from '../../lib/albarans'
import {
  dataTancament, estilEstatDonant, euros, exerciciDeNumero,
} from '../../lib/tancament'
import type { CierreDonante, Convenio, Documento } from '../../types'
import PendentsDeTu from '../../components/documents/PendentsDeTu'
import LlistaConvenis from '../../components/documents/LlistaConvenis'
import LlistaDocuments from '../../components/documents/LlistaDocuments'
import TaulaAlbarans from '../../components/documents/TaulaAlbarans'
import CarregantSeccio from '../../components/CarregantSeccio'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Donant = Pick<
  CierreDonante,
  | 'id' | 'kg_total' | 'valor_total' | 'estado' | 'resumen_numero' | 'certificado_numero'
  | 'certificado_at' | 'factura_numero' | 'factura_fecha' | 'factura_importe' | 'calculado_at'
>

type DocFila = Pick<
  Documento,
  'id' | 'objeto_id' | 'objeto_tipo' | 'tipo' | 'subtipo' | 'numero_completo' | 'version' | 'modo' | 'ejercicio' | 'estado' | 'vigente' | 'emitido_at'
>

type ConveniFila = Pick<
  Convenio,
  'id' | 'tipo' | 'tipo_org' | 'estado' | 'numero_completo' | 'ejercicio'
  | 'enviado_at' | 'firmado_at' | 'contrafirmado_at' | 'created_at'
>

/** Una ventana de `cierres_periodo`: el certificado a demanda y sus fechas. */
interface PeriodeFila {
  id: string
  periodo_desde: string
  periodo_hasta: string
  modo: 'real' | 'prueba'
}

export default function ProductorDocuments() {
  const { t } = useT()
  const org = useOrganitzacio('productor')

  const [donants, setDonants] = useState<Donant[]>([])
  const [docs, setDocs] = useState<DocFila[]>([])
  const [albarans, setAlbarans] = useState<AlbaranBandeja[]>([])
  const [convenis, setConvenis] = useState<ConveniFila[]>([])
  const [periodes, setPeriodes] = useState<PeriodeFila[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pujant, setPujant] = useState<string | null>(null)
  const fitxers = useRef<Record<string, HTMLInputElement | null>>({})

  const orgId = org?.id ?? null

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    // Sin `.eq()` de organización: la RLS ya devuelve solo lo suyo, y filtrar aquí además
    // daría la falsa impresión de que es el filtro el que protege.
    const { data: donData, error: errDon } = await supabase
      .from('cierres_donante')
      .select('id, kg_total, valor_total, estado, resumen_numero, certificado_numero, certificado_at, factura_numero, factura_fecha, factura_importe, calculado_at')
      .order('created_at', { ascending: false })
    if (errDon) return { errDon }

    const { data: docData } = await supabase
      .from('documentos')
      .select('id, objeto_id, objeto_tipo, tipo, subtipo, numero_completo, version, modo, ejercicio, estado, vigente, emitido_at')
      .eq('vigente', true)
      .order('emitido_at', { ascending: false })

    const { data: albData } = await supabase
      .from('v_albaranes_bandeja')
      .select('id, tipo, numero_completo, estado, ejercicio, excedente_id, espigolada_id, canalizacion_id, id_excedente, producto, productor_id, entidad_id, codigo_lote, emitido_at, entregado_at, confirmado_at, conciliado_at, rechazo, kg_previstos, kg_neto, kg_confirmados, kg_validados, dias_esperando')
      .eq('tipo', 'REC')
      .order('emitido_at', { ascending: false, nullsFirst: true })

    // Los convenios SÍ se filtran por columna: la RLS deja ver los de todas las fichas de
    // la cuenta, y una con doble rol vería aquí los de su entidad. Mismo criterio que
    // `useConveni`.
    const { data: convData } = orgId
      ? await supabase
        .from('convenios')
        .select('id, tipo, tipo_org, estado, numero_completo, ejercicio, enviado_at, firmado_at, contrafirmado_at, created_at')
        .eq('productor_id', orgId)
        .order('created_at', { ascending: false })
      : { data: [] }

    const { data: perData } = await supabase
      .from('cierres_periodo')
      .select('id, periodo_desde, periodo_hasta, modo')
      .order('periodo_hasta', { ascending: false })

    return {
      donants: (donData as Donant[] | null) ?? [],
      docs: (docData as DocFila[] | null) ?? [],
      albarans: (albData as AlbaranBandeja[] | null) ?? [],
      convenis: (convData as ConveniFila[] | null) ?? [],
      periodes: (perData as PeriodeFila[] | null) ?? [],
      errDon: null,
    }
  }, [orgId])

  const refresca = useCallback(async () => {
    const r = await carrega()
    if (r.errDon) { setError(r.errDon.message); return }
    setDonants(r.donants ?? [])
    setDocs(r.docs ?? [])
    setAlbarans(r.albarans ?? [])
    setConvenis(r.convenis ?? [])
    setPeriodes(r.periodes ?? [])
  }, [carrega])

  useEffect(() => {
    let viu = true
    void (async () => {
      const r = await carrega()
      if (!viu) return
      if (r.errDon) { setError(r.errDon.message); setCarregant(false); return }
      setDonants(r.donants ?? [])
      setDocs(r.docs ?? [])
      setAlbarans(r.albarans ?? [])
      setConvenis(r.convenis ?? [])
      setPeriodes(r.periodes ?? [])
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega])

  const descarregador = useDescarregaDocument(refresca)

  const perDonant = useMemo(() => {
    const mapa: Record<string, DocFila[]> = {}
    for (const d of docs.filter((x) => x.objeto_tipo === 'cierre_donante')) {
      const llista = mapa[d.objeto_id] ?? []
      llista.push(d)
      mapa[d.objeto_id] = llista
    }
    return mapa
  }, [docs])

  /** El año y el modo de una fila, deducidos de lo que el donante SÍ puede leer. */
  const info = useCallback((d: Donant) => {
    const seus = perDonant[d.id] ?? []
    const exercici = exerciciDeNumero(d.certificado_numero)
      ?? exerciciDeNumero(d.resumen_numero)
      ?? seus[0]?.ejercicio
      ?? null
    const prova = seus.some((x) => x.modo === 'prueba')
      || (d.resumen_numero ?? d.certificado_numero ?? '').startsWith('P-')
    return { exercici, prova, docs: seus }
  }, [perDonant])

  const algunaProva = useMemo(
    () => donants.some((d) => info(d).prova) || periodes.some((p) => p.modo === 'prueba'),
    [donants, info, periodes],
  )

  /** Los documentos de un tipo de objeto, que es como se reparten por secciones. */
  const docsDe = useCallback(
    (objetoTipo: string) => docs.filter((d) => d.objeto_tipo === objetoTipo),
    [docs],
  )

  const perPeriode = useMemo(() => {
    const mapa: Record<string, PeriodeFila> = {}
    for (const p of periodes) mapa[p.id] = p
    return mapa
  }, [periodes])

  async function puja(d: Donant, fitxer: File) {
    setPujant(d.id)
    const res = await pujarDocumentExtern({
      fitxer,
      objecteTipus: 'cierre_donante',
      objecteId: d.id,
      tipus: 'factura',
    })
    setPujant(null)
    if (!res.ok) { toast.error(t(res.motiuKey)); return }
    toast.success(t('mydoc.invoice_uploaded', { name: res.data.nombre }))
    await refresca()
  }

  if (!org) return <p className="text-sm text-muted-foreground">{t('mydoc.no_org')}</p>
  if (carregant) return <CarregantSeccio />
  if (error) return <p className="text-sm text-destructive">{error}</p>

  return (
    <div className="space-y-4">
      {algunaProva && (
        <div className="flex items-start gap-2 rounded-md border border-aviso bg-aviso-fondo p-3 text-sm text-aviso">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{t('mydoc.test_banner')}</p>
        </div>
      )}

      {/* --- Lo que espera su firma o su confirmación. Va PRIMERO porque es lo único de
              esta pantalla que le pide algo; el resto es archivo. --- */}
      <PendentsDeTu tipusOrg="productor" tornarA="/productor/documents" />

      {/* --- Sus convenios --- */}
      <LlistaConvenis files={convenis} docs={docs} descarregador={descarregador} />

      {/* --- El acumulado del año --- */}
      <Card>
        <CardHeader>
          <CardTitle>{t('mydoc.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('mydoc.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {donants.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('mydoc.no_closing')}</p>
          )}

          {donants.map((d) => {
            const { exercici, prova, docs: seus } = info(d)
            return (
              <div key={d.id} className="rounded-md border border-input p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base">
                    {t('mydoc.year_title', { y: exercici ?? '—' })}
                  </h3>
                  <Badge className={estilEstatDonant(d.estado)}>{t(`tan.ds_${d.estado}`)}</Badge>
                  {prova && (
                    <Badge className="bg-aviso-fondo text-aviso whitespace-normal">
                      <AlertTriangle className="mr-1 size-3.5 shrink-0" aria-hidden />
                      {t('tan.mode_test')}
                    </Badge>
                  )}
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Dada etiqueta={t('mydoc.f_kg')} valor={kg(d.kg_total)} />
                  {/* El importe es SUYO: aquí sí, y solo aquí. */}
                  <Dada etiqueta={t('mydoc.f_value')} valor={euros(d.valor_total)} />
                  <Dada etiqueta={t('mydoc.f_summary')} valor={d.resumen_numero ?? '—'} />
                  <Dada etiqueta={t('mydoc.f_certificate')} valor={d.certificado_numero ?? '—'} />
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Dada
                    etiqueta={t('mydoc.f_invoice')}
                    valor={d.factura_numero
                      ? `${d.factura_numero} · ${euros(d.factura_importe)}`
                      : t('mydoc.no_invoice')}
                  />
                  <Dada etiqueta={t('mydoc.f_invoice_date')} valor={dataTancament(d.factura_fecha)} />
                </div>

                {/* Qué toca hacer ahora, dicho con palabras y no con un estado en inglés. */}
                <p className="mt-3 text-sm text-muted-foreground">
                  {t(`mydoc.next_${d.estado}`)}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {/* Cada documento, su pareja: mirarlo (lo frecuente) y guardarlo. El
                      número va en el botón de descarga, que es el que ya lo llevaba; el de
                      ver queda al lado, dentro del mismo grupo, para que se lea que los dos
                      son del mismo documento. */}
                  {seus.map((doc) => (
                    <div key={doc.id} className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-11 whitespace-normal md:h-9"
                        disabled={descarregador.ocupat === doc.id}
                        onClick={() => void descarregador.mostra(doc.id)}
                      >
                        <Eye className="mr-1 size-4" aria-hidden />
                        {t('doc.view')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-11 whitespace-normal md:h-9"
                        disabled={descarregador.ocupat === doc.id}
                        onClick={() => void descarregador.descarrega(doc.id)}
                      >
                        {descarregador.generant === doc.id
                          ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
                          : <Download className="mr-1 size-4" aria-hidden />}
                        <span className="tabular-nums">{doc.numero_completo}</span>
                      </Button>
                    </div>
                  ))}

                  {/* El `<input type=file>` va escondido y lo dispara el botón: un input de
                      fichero sin estilar es el único control del sistema de diseño que no
                      se puede pintar, y aquí es además la acción principal. */}
                  <input
                    ref={(el) => { fitxers.current[d.id] = el }}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (f) void puja(d, f)
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-11 whitespace-normal md:h-9"
                    disabled={pujant === d.id}
                    onClick={() => fitxers.current[d.id]?.click()}
                  >
                    {pujant === d.id
                      ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
                      : <Upload className="mr-1 size-4" aria-hidden />}
                    {t('mydoc.a_upload_invoice')}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t('mydoc.upload_hint')}</p>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* --- Sus albaranes de recepción --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('mydoc.rec_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('mydoc.rec_hint')}</p>
        </CardHeader>
        <CardContent>
          {albarans.length === 0
            ? <p className="text-sm text-muted-foreground">{t('mydoc.rec_empty')}</p>
            : <TaulaAlbarans files={albarans} docs={docs} descarregador={descarregador} />}
        </CardContent>
      </Card>

      {/* --- Certificados a demanda: el mismo acumulado, pero de una ventana de fechas.
              Se emiten con `tipo = 'CD'`, así que lo que los distingue del anual es el
              objeto al que cuelgan (`cierre_periodo`), no el tipo. --- */}
      {docsDe('cierre_periodo').length > 0 && (
        <LlistaDocuments
          files={docsDe('cierre_periodo')}
          descarregador={descarregador}
          titolKey="mydoc.cdp_title"
          buitKey="mydoc.cdp_title"
          extra={(d) => {
            const p = perPeriode[d.objeto_id]
            if (!p) return null
            return (
              <p className="text-xs">
                {t('mydoc.cdp_period', {
                  desde: dataTancament(p.periodo_desde),
                  fins: dataTancament(p.periodo_hasta),
                })}
              </p>
            )
          }}
        />
      )}

      {/* --- Su plan de prevención. Se lista desde `documentos` y no desde
              `planes_prevencion` porque no hay ninguna pantalla de planes todavía: lo
              único que existe del plan es su PDF. --- */}
      <LlistaDocuments
        files={docsDe('plan')}
        descarregador={descarregador}
        titolKey="mydoc.pla_title"
        buitKey="mydoc.pla_empty"
      />

      {/* El visor de PDF. Una sola vez por pantalla: el hook es uno y el modal también. */}
      {descarregador.visor}
    </div>
  )
}

function Dada({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="font-medium tabular-nums">{valor}</p>
    </div>
  )
}
