// «Certificat de donació»: el certificado de donación de un donante, de UNA OFERTA, de un
// INTERVALO de fechas o del EJERCICIO entero, según el modelo de la Fundació (Tabaquet,
// 05-11-2026). Lo abre el super_admin desde la ficha de la entidad y desde la de la oferta.
//
// 🔴 Lo que entra lo decide la base: solo donación conciliada a una entidad `social`. Lo que
//    se queda fuera (venta, maquila, entidad no social, sin entidad…) se lista abajo, con su
//    motivo, para que nadie emita creyendo que cuenta lo que no cuenta.
//
// Los tres ámbitos, dos motores:
//   · oferta e intervalo → `cierres_periodo` (serie CDP): calcular → mirar → emitir.
//     ⚠️ CALCULAR YA ESCRIBE (inserta el borrador): por eso emitir exige haber calculado.
//   · ejercicio → el CD anual de `cierres_donante`, que nace del cierre. Si el cierre está
//     `tancat`, se emite desde aquí; si no, se enlaza a «Tancament d'exercici».
//
// La FECHA DE EXPEDICIÓN la elige quien emite: por defecto hoy (oferta, intervalo) o el 31-12
// (anual), y la base solo acepta entre el fin del periodo y hoy (`data_expedicio_fora_rang`).
//
// ⚠️ El modo de oferta e intervalo sale de `es_test` (lo pasa quien abre el diálogo); el del
//    anual, del cierre. Nunca se elige aquí.
// ⚠️ El selector de ámbito está aislado (`SelectorAbast` + `ABASTS_DIALEG`): cómo se elige es
//    una decisión pendiente del cliente.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import AvisCorreuDesactivat from '../AvisCorreuDesactivat'
import { avuiMadrid, dataCurta, kg } from '../../lib/format'
import { textError } from '../../lib/textError'
import {
  bloqueja, calcularCertificatPeriode, emetreCertificat, emetreCertificatPeriode, euros, excloses,
} from '../../lib/tancament'
import {
  ABAST_PER_DEFECTE, ABASTS_DIALEG, clauAbast, clauTipus, dataExpedicioPerDefecte,
  dataExpedicioValida, kgExclosos, motiuExclusio, rangDataExpedicio, rangPossible, textExercici,
  textPeriodeUi,
} from '../../lib/certificatsDonacio'
import type { AbastCertificat, Exclosa } from '../../lib/certificatsDonacio'
import { bloquejaProvisionals } from '../../lib/canalitzacio'
import { supabase } from '../../lib/supabase'
import { useAppContext } from '../../hooks/useAppContext'
import { useCertificatOferta } from '../../hooks/useCertificatOferta'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { useConfirma } from '../DialegConfirma'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import Desplegable from '../Desplegable'
import { FilaCasella } from '../Casella'
import Bloquejos from './Bloquejos'
import AccionsCertificat from './AccionsCertificat'
import type { DocCertificat } from './AccionsCertificat'
import { BadgeMode } from '../../routes/equip/Tancament'
import type { BloqueigCierre } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** El borrador de `cierres_periodo` que devuelve el cálculo. */
interface Calcul {
  id: string
  periodo_desde: string
  periodo_hasta: string
  kg_total: number
  valor_total: number
  bloqueos: BloqueigCierre[]
  revisio_estat: string | null
}

/** Una oferta elegible: con alguna canalización conciliada. */
interface OfertaOpcio {
  id: string
  id_excedente: string | null
  producto: string | null
  variedad: string | null
  /** La última recogida conciliada, para reconocerla. */
  data: string | null
}

/** Un CD anual del donante, con su cierre. */
interface Anual {
  id: string
  cierre_id: string
  estado: string
  kg_total: number
  valor_total: number
  certificado_numero: string | null
  bloqueos: BloqueigCierre[] | null
  revisio_estat: string | null
  cierres_ejercicio: { ejercicio: number; modo: 'prueba' | 'real'; estado: string } | null
}

interface Props {
  obert: boolean
  onTancar: () => void
  /** El id de la FICHA del donante (`productores.id`). */
  productorId: string
  /** Deducido de `es_test`: el modo de oferta e intervalo. */
  modo: 'prueba' | 'real'
  /** Con datos fiscales provisionales la base se niega en modo real: mejor decirlo antes. */
  provisionals: boolean
  onEmes: () => void
  /** Desde la ficha de una oferta: el ámbito y la oferta ya elegidos. */
  abastInicial?: AbastCertificat
  excedenteInicial?: string | null
}

export default function DialegCertificatDonacio({
  obert, onTancar, productorId, modo, provisionals, onEmes, abastInicial, excedenteInicial,
}: Props) {
  const { t, lang } = useT()
  const { confirma, dialeg } = useConfirma()
  const { ctx } = useAppContext()
  const esSuperAdmin = ctx?.esSuperAdmin ?? false
  const avui = avuiMadrid()

  const [abast, setAbast] = useState<AbastCertificat>(abastInicial ?? ABAST_PER_DEFECTE)
  const [excedente, setExcedente] = useState<string>(excedenteInicial ?? '')
  const [desde, setDesde] = useState(`${avui.slice(0, 4)}-01-01`)
  const [hasta, setHasta] = useState(avui)
  const [anualId, setAnualId] = useState('')
  // La fecha que ha tecleado el equipo; mientras no toque nada, manda la de por defecto.
  const [dataManual, setDataManual] = useState<string | null>(null)
  const [annex, setAnnex] = useState(false)
  const [nota, setNota] = useState('')

  const [ofertes, setOfertes] = useState<OfertaOpcio[]>([])
  const [anuals, setAnuals] = useState<Anual[]>([])
  const [docsAnuals, setDocsAnuals] = useState<(DocCertificat & { objeto_id: string })[]>([])
  const [calcul, setCalcul] = useState<Calcul | null>(null)
  const [exclosos, setExclosos] = useState<Exclosa[] | null>(null)
  const [emes, setEmes] = useState<{ doc: DocCertificat } | null>(null)
  const [ocupat, setOcupat] = useState(false)
  const [errorCarrega, setErrorCarrega] = useState(false)

  const descarregador = useDescarregaDocument()
  const certOferta = useCertificatOferta(abast === 'oferta' && excedente ? excedente : null)

  // Al abrir (o al cambiar la oferta de origen) se vuelve al punto de partida.
  useEffect(() => {
    if (!obert) return
    setAbast(abastInicial ?? ABAST_PER_DEFECTE)
    setExcedente(excedenteInicial ?? '')
    setCalcul(null); setExclosos(null); setEmes(null); setDataManual(null); setAnnex(false); setNota('')
  }, [obert, abastInicial, excedenteInicial])

  // Las ofertas del donante con algo conciliado, y sus CD anuales. Dos lecturas, cada una
  // con su error: un fallo no se pinta como «cap oferta».
  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    const [exc, anu] = await Promise.all([
      supabase.from('excedentes')
        .select('id, id_excedente, producto, variedad, created_at')
        .eq('productor_id', productorId)
        .order('created_at', { ascending: false }),
      supabase.from('cierres_donante')
        .select('id, cierre_id, estado, kg_total, valor_total, certificado_numero, bloqueos, revisio_estat, cierres_ejercicio(ejercicio, modo, estado)')
        .eq('productor_id', productorId)
        .eq('tipo', 'donacio'),
    ])
    if (exc.error || anu.error) {
      console.warn('DialegCertificatDonacio:', (exc.error ?? anu.error)?.message)
      setErrorCarrega(true)
      return
    }
    const totes = (exc.data as (Omit<OfertaOpcio, 'data'> & { created_at: string })[] | null) ?? []
    const ids = totes.map((o) => o.id)
    const { data: can, error: e3 } = ids.length
      ? await supabase.from('canalizaciones')
        .select('excedente_id, data_hora_recollida, conciliada_at')
        .eq('estado', 'conciliada')
        .in('excedente_id', ids)
      : { data: [], error: null }
    if (e3) console.warn('DialegCertificatDonacio.canalitzacions:', e3.message)
    const darrera: Record<string, string> = {}
    for (const c of (can as { excedente_id: string; data_hora_recollida: string | null; conciliada_at: string | null }[] | null) ?? []) {
      const d = (c.data_hora_recollida ?? c.conciliada_at ?? '').slice(0, 10)
      if (d && (!darrera[c.excedente_id] || d > darrera[c.excedente_id])) darrera[c.excedente_id] = d
    }
    setOfertes(totes
      .filter((o) => darrera[o.id] || o.id === excedenteInicial)
      .map((o) => ({ ...o, data: darrera[o.id] ?? null })))

    const files = ((anu.data as unknown as Anual[] | null) ?? [])
      .filter((a) => a.cierres_ejercicio)
      .sort((a, b) => (b.cierres_ejercicio!.ejercicio - a.cierres_ejercicio!.ejercicio)
        || a.cierres_ejercicio!.modo.localeCompare(b.cierres_ejercicio!.modo))
    setAnuals(files)
    setAnualId((actual) => actual && files.some((f) => f.id === actual) ? actual : files[0]?.id ?? '')
    const ambCd = files.filter((f) => f.certificado_numero).map((f) => f.id)
    const { data: docs, error: e4 } = ambCd.length
      ? await supabase.from('documentos')
        .select('id, objeto_id, numero_completo, estado')
        .eq('objeto_tipo', 'cierre_donante').eq('tipo', 'CD').eq('vigente', true)
        .in('objeto_id', ambCd)
      : { data: [], error: null }
    if (e4) console.warn('DialegCertificatDonacio.docs:', e4.message)
    setDocsAnuals((docs as (DocCertificat & { objeto_id: string })[] | null) ?? [])
    setErrorCarrega(e3 !== null || e4 !== null)
  }, [productorId, excedenteInicial])

  useEffect(() => { if (obert) void carrega() }, [obert, carrega])

  const anual = anuals.find((a) => a.id === anualId) ?? null
  const docAnual = anual ? docsAnuals.find((d) => d.objeto_id === anual.id) ?? null : null
  const modeEfectiu: 'prueba' | 'real' = abast === 'exercici' ? anual?.cierres_ejercicio?.modo ?? modo : modo

  // Las exclusiones del ejercicio se cargan al elegirlo (no hay «Calcula»: el anual ya está
  // calculado en su cierre). Las de oferta e intervalo, con el cálculo.
  useEffect(() => {
    if (!obert || abast !== 'exercici' || !anual?.cierres_ejercicio) return
    let viu = true
    const y = anual.cierres_ejercicio.ejercicio
    void excloses({ productor: productorId, desde: `${y}-01-01`, fins: `${y}-12-31`, modo: anual.cierres_ejercicio.modo })
      .then((r) => { if (viu) setExclosos(r.ok ? r.data : null) })
    return () => { viu = false }
  }, [obert, abast, anual, productorId])

  // --- La fecha de expedición ----------------------------------------------
  const rang = rangDataExpedicio(abast, {
    avui,
    periodeFins: abast === 'periode' ? (calcul?.periodo_hasta ?? hasta) : calcul?.periodo_hasta ?? null,
    exercici: anual?.cierres_ejercicio?.ejercicio ?? null,
    mode: modeEfectiu,
  })
  const dataPerDefecte = dataExpedicioPerDefecte(abast, {
    avui, exercici: anual?.cierres_ejercicio?.ejercicio ?? null, mode: modeEfectiu,
  })
  const dataExp = dataManual ?? dataPerDefecte
  const dataOk = dataExpedicioValida(dataExp, rang)

  // Cambiar el ámbito, la oferta o las fechas invalida lo calculado: si no, se emitiría otra
  // cosa distinta de la que el equipo está viendo.
  function invalida() { setCalcul(null); setExclosos(null); setEmes(null) }
  function canviaAbast(a: AbastCertificat) { setAbast(a); setDataManual(null); invalida() }

  async function calcula() {
    setOcupat(true)
    const esOferta = abast === 'oferta'
    const [res, exc] = await Promise.all([
      calcularCertificatPeriode({
        productor: productorId,
        desde: esOferta ? null : desde,
        hasta: esOferta ? null : hasta,
        modo,
        excedente: esOferta ? excedente : null,
      }),
      excloses({
        productor: productorId,
        desde: esOferta ? null : desde,
        fins: esOferta ? null : hasta,
        excedente: esOferta ? excedente : null,
        modo,
      }),
    ])
    setOcupat(false)
    setExclosos(exc.ok ? exc.data : null)
    if (!exc.ok) console.warn('excloses:', exc.missatge)
    if (!res.ok) { setCalcul(null); toast.error(textError(t, res)); return }
    setCalcul(res.data as unknown as Calcul)
    setEmes(null)
  }

  /** El periodo que se va a certificar, en texto: lo que se lee en la confirmación. */
  const textQue = abast === 'exercici'
    ? anual?.cierres_ejercicio ? textExercici(anual.cierres_ejercicio.ejercicio, lang) : ''
    : calcul ? textPeriodeUi(abast, calcul.periodo_desde, calcul.periodo_hasta, lang) : ''

  async function emet() {
    if (abast !== 'exercici' && !calcul) return
    if (abast === 'exercici' && !anual) return
    // En real se pregunta: consume numeración legal y no se deshace. En prueba no.
    if (modeEfectiu === 'real') {
      const ok = await confirma({
        titol: t('cdon.confirm_t', { periode: textQue }),
        descripcio: t('cdp.confirm', { serie: abast === 'exercici' ? 'CD' : 'CDP' }),
        confirmar: t('cdon.a_emit'),
        destructiu: true,
      })
      if (!ok) return
    }
    setOcupat(true)
    const opcions = { dataExpedicio: dataExp, annex }
    const res = abast === 'exercici'
      ? await emetreCertificat(anual!.id, opcions)
      : await emetreCertificatPeriode(calcul!.id, { ...opcions, excedente: abast === 'oferta' ? excedente : null })
    setOcupat(false)
    if (!res.ok) { toast.error(textError(t, res)); return }
    toast.success(t('cdp.done', { num: res.data.numero ?? '' }))
    const subst = 'substitueix' in res.data ? Number(res.data.substitueix ?? 0) : 0
    if (subst > 0) toast.info(t('cdp.done_subst', { n: subst }))
    setEmes({ doc: { id: res.data.document, numero_completo: res.data.numero, estado: 'pendiente_fichero' } })
    onEmes()
    void carrega()
    if (abast === 'oferta') void certOferta.recarrega()
  }

  /** El equipo aprueba en nombre del donante, con nota (modelo asistido). */
  async function aprovaEnNom() {
    const id = abast === 'exercici' ? anual?.id : calcul?.id
    if (!id) return
    setOcupat(true)
    const { error } = await supabase.rpc('aprovar_certificat_equip', {
      p_id: id, p_tipus: abast === 'exercici' ? 'anual' : 'periode', p_nota: nota,
    })
    setOcupat(false)
    if (error) { toast.error(textError(t, { missatge: error.message, codi: error.code })); return }
    toast.success(t('tan.rev_ok'))
    if (abast === 'exercici') void carrega()
    else if (calcul) setCalcul({ ...calcul, revisio_estat: 'aprovat_equip' })
  }

  // --- Qué frena la emisión, en el orden en que frena la base -----------------
  const revisio = abast === 'exercici' ? anual?.revisio_estat ?? null : calcul?.revisio_estat ?? null
  const bloqueos = abast === 'exercici' ? anual?.bloqueos ?? [] : calcul?.bloqueos ?? []
  const kgTotal = abast === 'exercici' ? Number(anual?.kg_total ?? 0) : Number(calcul?.kg_total ?? 0)
  const senseRevisio = modeEfectiu === 'real' && revisio !== 'aprovat_ofertant' && revisio !== 'aprovat_equip'
  const anualTancat = anual?.cierres_ejercicio?.estado === 'tancat'
  const motiuEmetre = abast === 'exercici'
    ? !anual ? t('cdon.why_no_annual')
      : anual.certificado_numero ? t('cdon.why_annual_done')
        : !anualTancat ? t('tan.why_close_first')
          : bloqueja(anual.bloqueos) ? t('tan.why_blocked')
            : kgTotal <= 0 ? t('tan.why_no_kg')
              : undefined
    : abast === 'oferta' && !excedente ? t('cdon.why_pick_offer')
      : !calcul ? t('cdp.why_calc_first')
        : bloqueja(calcul.bloqueos) ? t('tan.why_blocked')
          : kgTotal <= 0 ? t('cdp.why_no_kg')
            : undefined
  const motiu = motiuEmetre
    ?? (bloquejaProvisionals(provisionals, modeEfectiu) ? t('tan.why_provisional')
      : senseRevisio ? t('tan.why_sense_revisio')
        : modeEfectiu === 'real' && !esSuperAdmin ? t('tan.why_super_admin')
          : !rangPossible(rang) ? t('cdon.why_rang_impossible')
            : !dataOk ? t('cdon.why_data') : undefined)

  const opcionsOferta = useMemo(() => ofertes.map((o) => ({
    valor: o.id,
    text: [
      [o.producto, o.variedad].filter(Boolean).join(' · ') || '—',
      o.data ? dataCurta(o.data) : null,
      o.id_excedente,
    ].filter(Boolean).join(' · '),
  })), [ofertes])

  const opcionsAnual = useMemo(() => anuals.map((a) => ({
    valor: a.id,
    text: `${t('mydoc.year_title', { y: a.cierres_ejercicio!.ejercicio })} · ${t(a.cierres_ejercicio!.modo === 'prueba' ? 'tan.mode_test' : 'tan.mode_real')}`,
  })), [anuals, t])

  // Ya hay un certificado: de la oferta (vigente) o del ejercicio elegido.
  const jaEmes: { doc: DocCertificat | null; numero: string } | null = abast === 'oferta' && certOferta.cert
    ? { doc: certOferta.cert.doc, numero: certOferta.cert.periode.certificado_numero }
    : abast === 'exercici' && anual?.certificado_numero
      ? { doc: docAnual, numero: anual.certificado_numero }
      : null
  const mostraCampsEmissio = !emes && !(abast === 'exercici' && (anual?.certificado_numero || !anualTancat))

  return (
    <>
      <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('cdon.title')}</DialogTitle>
            <DialogDescription>{t('cdon.desc')}</DialogDescription>
          </DialogHeader>
          {/* `min-w-0` y en bloque: el contenido del diálogo es un grid y sus hijos no encogen
              solos; sin esto, el nombre largo de una oferta lo ensanchaba más allá de 360 px. */}
          <div className="min-w-0 space-y-4">
            <AvisCorreuDesactivat />
            {errorCarrega && <p className="text-sm text-destructive">{t('c.load_error')}</p>}

            <SelectorAbast valor={abast} onChange={canviaAbast} />

            {/* --- Qué se certifica --- */}
            {abast === 'oferta' && (
              <div className="space-y-1.5">
                <Label htmlFor="cdon-oferta">{t('cdon.f_oferta')}</Label>
                {opcionsOferta.length === 0
                  ? <p className="text-sm text-muted-foreground">{t('cdon.f_oferta_buit')}</p>
                  : (
                    <Desplegable
                      id="cdon-oferta" value={excedente} opcions={opcionsOferta}
                      placeholder={t('cdon.f_oferta_tria')}
                      onChange={(v) => { setExcedente(v); invalida() }}
                      data-testid="cdon-oferta"
                    />
                  )}
              </div>
            )}

            {abast === 'periode' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cdon-desde">{t('cdp.f_from')}</Label>
                  <Input id="cdon-desde" type="date" value={desde} max={avui}
                    onChange={(e) => { setDesde(e.target.value); invalida() }} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cdon-hasta">{t('cdp.f_to')}</Label>
                  {/* `max` es hoy: la base rechaza una ventana que acabe en el futuro. */}
                  <Input id="cdon-hasta" type="date" value={hasta} max={avui}
                    onChange={(e) => { setHasta(e.target.value); invalida() }} />
                </div>
              </div>
            )}

            {abast === 'exercici' && (
              <div className="space-y-2">
                <Label htmlFor="cdon-anual">{t('cdon.f_exercici')}</Label>
                {opcionsAnual.length === 0
                  ? <p className="text-sm text-muted-foreground">{t('cdon.why_no_annual')}</p>
                  : (
                    <Desplegable id="cdon-anual" value={anualId} opcions={opcionsAnual}
                      onChange={(v) => { setAnualId(v); setDataManual(null); setExclosos(null) }} />
                  )}
                {anual?.cierres_ejercicio && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <BadgeMode mode={anual.cierres_ejercicio.modo} />
                    <span className="text-muted-foreground">{t(`tan.st_${anual.cierres_ejercicio.estado}`)}</span>
                    <span className="tabular-nums">{t('cdp.calculated', { kg: kg(anual.kg_total), v: euros(anual.valor_total) })}</span>
                  </div>
                )}
                {anual && !anualTancat && !anual.certificado_numero && (
                  <div className="space-y-2 rounded-md border border-aviso bg-aviso-fondo p-3 text-sm text-aviso">
                    <p>{t('cdon.annual_not_closed')}</p>
                    <Button asChild size="sm" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8">
                      <Link to={`/equip/tancament/${anual.cierre_id}`}>{t('fit.cert_open_closing')}</Link>
                    </Button>
                  </div>
                )}
                {anual && (bloqueos ?? []).length > 0 && !anual.certificado_numero && <Bloquejos llista={bloqueos ?? []} />}
              </div>
            )}

            {/* --- Lo que ya está emitido --- */}
            {jaEmes && !emes && (
              <div className="space-y-2 rounded-md border p-3" data-testid="cdon-ja-emes">
                <p className="text-sm">
                  {t('cdon.ja_emes', { num: jaEmes.numero })}
                  {abast === 'oferta' && certOferta.cert && (
                    <span className="text-muted-foreground">
                      {` · ${textPeriodeUi('oferta', certOferta.cert.periode.periodo_desde, certOferta.cert.periode.periodo_hasta, lang)}`}
                    </span>
                  )}
                </p>
                {jaEmes.doc
                  ? <AccionsCertificat doc={jaEmes.doc} descarregador={descarregador} enviar />
                  : <p className="text-xs text-muted-foreground">{t('doc.generating')}</p>}
                {abast === 'oferta' && <p className="text-xs text-muted-foreground">{t('cdon.ja_emes_hint')}</p>}
              </div>
            )}

            {/* --- La emisión --- */}
            {mostraCampsEmissio && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cdon-data">{t('cdon.f_data_exp')}</Label>
                    <Input
                      id="cdon-data" type="date" value={dataExp}
                      min={rang.min ?? undefined} max={rang.max}
                      aria-invalid={!dataOk}
                      onChange={(e) => setDataManual(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {rang.min
                        ? t('cdon.f_data_exp_rang', { min: dataCurta(rang.min), max: dataCurta(rang.max) })
                        : t('cdon.f_data_exp_hint')}
                    </p>
                  </div>
                  <div className="flex items-end">
                    <FilaCasella checked={annex} onChange={setAnnex}>{t('cdon.f_annex')}</FilaCasella>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {abast !== 'exercici' && (
                    <Button
                      variant={calcul ? 'outline' : 'default'}
                      className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
                      disabled={ocupat || (abast === 'oferta' && !excedente)}
                      onClick={() => void calcula()}
                    >
                      {t('cdp.a_calc')}
                    </Button>
                  )}
                  <BotoAmbMotiu
                    className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
                    disabled={ocupat || motiu !== undefined}
                    motiu={motiu}
                    onClick={() => void emet()}
                  >
                    {t('cdon.a_emit')}
                  </BotoAmbMotiu>
                </div>
                {/* El motivo, además, VISIBLE: en táctil no hay hover (§6ter). */}
                {motiu && <p className="text-sm text-muted-foreground">{motiu}</p>}
              </>
            )}

            {/* --- El cálculo --- */}
            {calcul && abast !== 'exercici' && !emes && (
              <div className="space-y-2 rounded-md border p-3" data-testid="cdon-calcul">
                <p className="text-sm font-medium">{textPeriodeUi(abast, calcul.periodo_desde, calcul.periodo_hasta, lang)}</p>
                <p className="text-sm">
                  {Number(calcul.kg_total) <= 0
                    ? t('cdp.no_kg')
                    : t('cdp.calculated', { kg: kg(calcul.kg_total), v: euros(calcul.valor_total) })}
                </p>
                {(calcul.bloqueos ?? []).length > 0 && <Bloquejos llista={calcul.bloqueos} />}
              </div>
            )}

            {/* --- La revisión del donante (en REAL no se firma sin ella) --- */}
            {!emes && revisio === 'pendent_revisio' && (abast === 'exercici' ? !anual?.certificado_numero : calcul !== null) && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm text-muted-foreground">{t('cdp.rev_hint')}</p>
                <Label htmlFor="cdon-nota">{t('tan.f_rev_nota')}</Label>
                <Input id="cdon-nota" value={nota} onChange={(e) => setNota(e.target.value)} />
                <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
                  disabled={ocupat || nota.trim() === ''} onClick={() => void aprovaEnNom()}>
                  {t('tan.a_rev_equip')}
                </Button>
              </div>
            )}

            {/* --- Lo que se queda fuera --- */}
            {exclosos && exclosos.length > 0 && !emes && <Excloses files={exclosos} />}

            {/* --- Recién emitido --- */}
            {emes && (
              <div className="space-y-2 rounded-md border border-exito bg-exito-fondo p-3" data-testid="cdon-emes">
                <p className="text-sm text-exito">{t('cdon.emes', { num: emes.doc.numero_completo ?? '' })}</p>
                <AccionsCertificat doc={emes.doc} descarregador={descarregador} enviar />
              </div>
            )}

          </div>
          {dialeg}
        </DialogContent>
      </Dialog>
      {/* El visor de PDF, fuera del diálogo: es otro modal. */}
      {descarregador.visor}
    </>
  )
}

/**
 * El selector del ámbito, AISLADO a propósito: la forma definitiva la decide el cliente
 * (orden, el de por defecto o quitar uno), y cambiarla tiene que ser tocar esto y
 * `ABASTS_DIALEG`, nada más.
 */
function SelectorAbast({ valor, onChange }: { valor: AbastCertificat; onChange: (a: AbastCertificat) => void }) {
  const { t } = useT()
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium" id="cdon-abast">{t('cdon.f_abast')}</p>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="cdon-abast">
        {ABASTS_DIALEG.map((a) => (
          <Button
            key={a}
            type="button"
            role="radio"
            aria-checked={valor === a}
            variant={valor === a ? 'default' : 'outline'}
            className="h-11 min-w-0 whitespace-normal md:h-8"
            onClick={() => onChange(a)}
          >
            {t(clauAbast(a))}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** «Excloses del certificat»: cada canalización que no cuenta, con su motivo. */
function Excloses({ files }: { files: Exclosa[] }) {
  const { t } = useT()
  return (
    <div className="space-y-2 rounded-md border border-aviso p-3" data-testid="cdon-excloses">
      <p className="font-titulos text-sm font-semibold">{t('cdon.excl_title')}</p>
      <p className="text-xs text-muted-foreground">{t('cdon.excl_hint', { kg: kg(kgExclosos(files)) })}</p>
      <ul className="space-y-1.5">
        {files.map((f) => {
          const m = motiuExclusio(f.motiu)
          return (
            <li key={f.canalizacion_id} className="rounded-md bg-aviso-fondo p-2 text-sm">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="min-w-0 font-medium">
                  {[f.producto, f.entidad].filter(Boolean).join(' · ') || '—'}
                </span>
                <span className="whitespace-nowrap tabular-nums">{kg(f.kg)} kg</span>
              </span>
              <span className="block text-xs text-aviso">
                {t(m.clau, { tipus: m.tipus ? t(clauTipus(m.tipus)) : '' })}
                {f.data ? ` · ${dataCurta(f.data)}` : ''}
                {f.id_excedente ? ` · ${f.id_excedente}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
