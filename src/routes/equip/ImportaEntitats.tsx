// «Importa entitats des d'Excel» (super_admin, 06-11-2026). Ruta `/equip/entitats/importa`,
// desde el botón de `Entitats.tsx` (que solo ve el super_admin). Quien no lo es ve un aviso y
// nada más; la base lo rechaza igual (`42501`).
//
// Tres pasos, sobre el MISMO estado (volver atrás no pierde lo elegido):
//   1. Fitxer — «Descarrega la plantilla» siempre visible; se sube un `.xlsx` o un `.csv`
//      (≤5 MB). Se enseñan las columnas que se importan, las que no y la obligatoria que falta
//      (sin «Nom comercial» se para y explica cómo debe ser el fichero). Varias hojas → se elige.
//   2. Revisió — `previsualitzar_importacio_entitats()` dice qué pasará con cada fila (nova,
//      existent, dubtosa, error). Los papeles se pueden cambiar (casillas) y las dudosas se
//      deciden (crear, «és aquesta», ometre); cada cambio vuelve a preguntar a la base. No se
//      importa con filas sin papel. La confirmación avisa: entran inactivas y solo se rellenan
//      huecos.
//   3. Resultat — `importar_entitats()` (la base RECALCULA todo, no se fía del paso 2): cifras,
//      enlace a cada ficha, avisos y errores por fila, el informe en CSV y, para las filas con
//      «Conveni signat», el enlace a la ficha › Documentació, donde ya está el flujo de
//      declararlo (no se duplica aquí).
//
// La lectura (`lib/fitxerImportacio`), el mapeo y la normalización (`lib/importEntitats`), la
// plantilla (`lib/plantillaEntitats`) y las RPC (`lib/importacions`) viven fuera, puros o sin
// lanzar; las dos librerías de Excel se cargan con `import()` y van en su propio chunk.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Download, Eye, FileSignature, Loader2, Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { usePuntTall } from '../../hooks/usePuntTall'
import { carregaTipusActivitat } from '../../lib/organitzacio'
import { carregaMunicipis } from '../../lib/municipis'
import { dataCurta } from '../../lib/format'
import { llegeixFitxer, type FitxerLlegit } from '../../lib/fitxerImportacio'
import {
  campsOmplerts, clauCodi, csvInforme, ERRORS_LOT, filesPerEnviar, filesSensePaper, llegeixFulla, MAX_FILES,
  normalitzaFulla, type ActivitatCataleg, type FilaInforme, type FilaNormalitzada, type Paper,
} from '../../lib/importEntitats'
import { blobPlantilla } from '../../lib/plantillaEntitats'
import { importarEntitats, jaImportat, previsualitzarImportacio, type RespostaRpc } from '../../lib/importacions'
import { FilaCasella } from '../../components/Casella'
import Desplegable from '../../components/Desplegable'
import BotoIcona from '../../components/BotoIcona'
import BotoAmbMotiu from '../../components/proces/BotoAmbMotiu'
import { useConfirma } from '../../components/DialegConfirma'
import type {
  ImportacioAccio, ImportacioConflicte, ImportacioEstat, Previsualitzacio, PrevisualitzacioFila, ResultatImportacio,
} from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const LLISTA = '/equip/entitats'
const PAPERS: readonly Paper[] = ['productor', 'entidad']
const ESTATS: readonly ImportacioEstat[] = ['nova', 'existent', 'dubtosa', 'error']
const paperKey = (p: Paper) => (p === 'productor' ? 'ef.paper_ofertant' : 'ef.paper_receptor')

type Traductor = (clau: string, params?: Record<string, string | number>) => string

/** Un aviso o error de la base («semblant_a_fila:4»), en palabras. */
function textCodi(t: Traductor, codi: string): string {
  const { clau, detall } = clauCodi(codi)
  const s = t(clau, { detall })
  return s === clau ? codi : s
}

/** Un error de lote de las RPC, en palabras. */
function textErrorLot(t: Traductor, r: Extract<RespostaRpc<unknown>, { ok: false }>, fallback: string): string {
  if (r.codi === 'sense_permis') return t('ie.err_sense_permis')
  if (r.codi && (ERRORS_LOT as readonly string[]).includes(r.codi)) return t(`ie.lot_${r.codi}`)
  return t(fallback)
}

function textConflicte(t: Traductor, c: ImportacioConflicte): string {
  return t('ie.conflicte', { camp: t(`ie.camp_${c.camp}`), actual: c.actual ?? '—', fitxer: c.fitxer ?? '—' })
}

const CLASSE_ESTAT: Record<ImportacioEstat, string> = {
  nova: 'bg-exito-fondo text-exito',
  existent: 'bg-secondary text-secondary-foreground',
  dubtosa: 'bg-aviso-fondo text-aviso',
  error: 'bg-error-fondo text-error',
}
const CLASSE_ACCIO: Record<ImportacioAccio, string> = {
  creada: 'bg-exito-fondo text-exito',
  actualitzada: 'bg-secondary text-secondary-foreground',
  paper_afegit: 'bg-secondary text-secondary-foreground',
  sense_canvis: 'bg-muted text-muted-foreground',
  omesa: 'bg-muted text-muted-foreground',
  error: 'bg-error-fondo text-error',
}

function descarregaBlob(nom: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export default function ImportaEntitats() {
  const { t } = useT()
  const navigate = useNavigate()
  const esSuper = useAppContext().ctx?.esSuperAdmin ?? false
  if (!esSuper) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(LLISTA)} className="text-muted-foreground">
          <ArrowLeft className="size-4" /> {t('ef.tornar')}
        </Button>
        <Card>
          <CardContent>
            <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso" data-testid="ie-nomes-super">{t('ie.nomes_super')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }
  return <Importador />
}

function Importador() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const { confirma, dialeg } = useConfirma()
  const md = usePuntTall('md')
  const lg = usePuntTall('lg')
  const input = useRef<HTMLInputElement>(null)

  const [pas, setPas] = useState<1 | 2 | 3>(1)
  const [activitats, setActivitats] = useState<ActivitatCataleg[]>([])
  const [generant, setGenerant] = useState(false)

  // ------------------------------------------------------------------ paso 1
  const [llegint, setLlegint] = useState(false)
  const [errFitxer, setErrFitxer] = useState<string | null>(null)
  const [fitxer, setFitxer] = useState<Extract<FitxerLlegit, { ok: true }> | null>(null)
  const [fullaIdx, setFullaIdx] = useState(0)
  const [jaAt, setJaAt] = useState<string | null>(null)

  useEffect(() => {
    let viu = true
    void carregaTipusActivitat().then((a) => { if (viu) setActivitats(a) })
    return () => { viu = false }
  }, [])

  const fulla = useMemo(() => (fitxer?.fulles[fullaIdx] ? llegeixFulla(fitxer.fulles[fullaIdx].files) : null), [fitxer, fullaIdx])
  const files = useMemo<FilaNormalitzada[]>(() => (fulla ? normalitzaFulla(fulla, { activitats }) : []), [fulla, activitats])
  const perFila = useMemo(() => new Map(files.map((f) => [f.fila, f])), [files])

  // ------------------------------------------------------------------ paso 2
  const [rols, setRols] = useState<Record<number, Paper[]>>({})
  const [decisions, setDecisions] = useState<Record<number, string>>({})
  const [previ, setPrevi] = useState<Previsualitzacio | null>(null)
  const [revisant, setRevisant] = useState(false)
  const [errPrevi, setErrPrevi] = useState<string | null>(null)
  const [filtre, setFiltre] = useState('')
  const [oberts, setOberts] = useState<Record<number, boolean>>({})
  const peticio = useRef(0)

  // ------------------------------------------------------------------ paso 3
  const [important, setImportant] = useState(false)
  const [resultat, setResultat] = useState<ResultatImportacio | null>(null)

  const enviar = useMemo(() => filesPerEnviar(files, rols, decisions), [files, rols, decisions])
  const sensePaper = useMemo(() => filesSensePaper(files, rols), [files, rols])

  // Cada cambio de papeles o de decisión vuelve a preguntar a la base (con un respiro, y
  // descartando las respuestas que llegan tarde).
  useEffect(() => {
    if (pas !== 2 || enviar.length === 0) return
    const n = ++peticio.current
    setRevisant(true)
    const h = setTimeout(() => {
      void previsualitzarImportacio(enviar).then((r) => {
        if (n !== peticio.current) return
        setRevisant(false)
        if (!r.ok) { setErrPrevi(textErrorLot(t, r, 'ie.err_previsualitza')); return }
        setErrPrevi(null)
        setPrevi(r.dades)
      })
    }, 300)
    return () => clearTimeout(h)
  }, [pas, enviar, t])

  async function triaFitxer(f: File | undefined) {
    if (!f) return
    setLlegint(true)
    setErrFitxer(null)
    const r = await llegeixFitxer(f)
    setLlegint(false)
    if (input.current) input.current.value = ''
    if (!r.ok) { setErrFitxer(t(`ie.err_${r.codi}`)); setFitxer(null); return }
    // Varias hojas: la primera que tenga «Nom comercial»; si ninguna, la primera.
    const idx = Math.max(0, r.fulles.findIndex((x) => llegeixFulla(x.files).mapa.falten.length === 0))
    setFitxer(r)
    setFullaIdx(idx)
    setRols({})
    setDecisions({})
    setPrevi(null)
    setResultat(null)
    setOberts({})
    setJaAt(await jaImportat(r.sha256))
  }

  async function descarregaPlantilla() {
    setGenerant(true)
    const munis = await carregaMunicipis()
    const comarques = [...new Set(munis.map((m) => m.comarca).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ca'))
    const blob = await blobPlantilla({ t, lang, activitats, comarques })
    setGenerant(false)
    if (!blob) { toast.error(t('ie.plantilla_err')); return }
    descarregaBlob(`${t('ie.plantilla_nom')}.xlsx`, blob)
  }

  const botoPlantilla = (
    <Button variant="outline" onClick={() => void descarregaPlantilla()} disabled={generant}
      className="w-full whitespace-normal sm:w-auto" data-testid="ie-plantilla">
      {generant ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} {t('ie.descarrega_plantilla')}
    </Button>
  )

  const massaFiles = files.length > MAX_FILES
  const potRevisar = !!fulla && fulla.mapa.falten.length === 0 && files.length > 0 && !massaFiles

  function canviaRol(fila: number, p: Paper, v: boolean) {
    const actuals = rols[fila] ?? perFila.get(fila)?.rols ?? []
    const nous = PAPERS.filter((x) => (x === p ? v : actuals.includes(x)))
    setRols((r) => ({ ...r, [fila]: nous }))
  }

  async function importa() {
    if (!fitxer) return
    const n = enviar.length
    if (!(await confirma({
      titol: t('ie.confirma_t', { n }),
      descripcio: t('ie.confirma_d'),
      confirmar: t('ie.confirma_ok'),
    }))) return
    setImportant(true)
    const r = await importarEntitats({ nom: fitxer.nom, sha256: fitxer.sha256 }, enviar)
    setImportant(false)
    if (!r.ok) { toast.error(textErrorLot(t, r, 'ie.err_importa')); return }
    setResultat(r.dades)
    setPas(3)
  }

  function reinicia() {
    setFitxer(null)
    setResultat(null)
    setPrevi(null)
    setRols({})
    setDecisions({})
    setJaAt(null)
    setPas(1)
  }

  function informe() {
    if (!resultat) return
    const capcaleres = Object.fromEntries((['fila', 'nom', 'nif', 'accio', 'organitzacio', 'camps', 'conflictes', 'avisos', 'errors', 'conveni'] as const)
      .map((c) => [c, t(`ie.inf_${c}`)])) as Record<keyof FilaInforme, string>
    const filesInf: FilaInforme[] = resultat.files.map((r) => {
      const f = perFila.get(r.fila)
      return {
        fila: r.fila,
        nom: f?.nom ?? null,
        nif: f?.nif ?? null,
        accio: t(`ie.acc_${r.accio}`),
        organitzacio: r.organizacion_id ? `${window.location.origin}${LLISTA}/${r.organizacion_id}` : null,
        camps: campsOmplerts(r.camps_omplerts).map((c) => t(`ie.camp_${c}`)).join(', '),
        conflictes: r.conflictes.map((c) => textConflicte(t, c)).join(' | '),
        avisos: [...(f?.avisosLocals ?? []).map((a) => t(`ie.al_${a}`)), ...r.avisos.map((a) => textCodi(t, a))].join(' | '),
        errors: r.errors.map((e) => textCodi(t, e)).join(' | '),
        conveni: f?.conveni ? [f.conveni.data, f.conveni.signant].filter(Boolean).join(' · ') : '',
      }
    })
    const blob = new Blob([csvInforme(filesInf, capcaleres)], { type: 'text/csv;charset=utf-8' })
    descarregaBlob(`${t('ie.informe_nom')}-${new Date().toISOString().slice(0, 10)}.csv`, blob)
  }

  const titolPas = t(pas === 1 ? 'ie.pas_fitxer' : pas === 2 ? 'ie.pas_revisio' : 'ie.pas_resultat')

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(LLISTA)} className="text-muted-foreground">
        <ArrowLeft className="size-4" /> {t('ef.tornar')}
      </Button>

      <Card>
        <CardHeader>
          <p className="text-xs text-muted-foreground" data-testid="ie-pas">{t('ie.pas', { x: pas })}</p>
          <CardTitle>{t('ie.title')} · {titolPas}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('ie.subtitle')}</p>
        </CardHeader>

        {pas === 1 && (
          <CardContent className="space-y-5" data-testid="ie-pas1">
            <p className="text-sm">{t('ie.fitxer_h')}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <input ref={input} type="file" accept=".xlsx,.csv" className="hidden" data-testid="ie-input"
                onChange={(e) => void triaFitxer(e.target.files?.[0])} />
              {/* Un solo botón primario por vista: con el fichero ya leído, el primario es «Revisa les files». */}
              <Button variant={fitxer ? 'outline' : 'default'} onClick={() => input.current?.click()} disabled={llegint}
                className="w-full whitespace-normal sm:w-auto">
                {llegint ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {' '}{t(fitxer ? 'ie.canvia_fitxer' : 'ie.tria_fitxer')}
              </Button>
              {botoPlantilla}
            </div>

            {llegint && <p className="text-sm text-muted-foreground">{t('ie.llegint')}</p>}
            {errFitxer && <p className="rounded-md bg-error-fondo p-3 text-sm text-error" role="alert">{errFitxer}</p>}

            {fitxer && fulla && (
              <div className="space-y-4" data-testid="ie-mapa">
                <div className="space-y-1 text-sm">
                  <p className="font-medium break-all">{fitxer.nom}</p>
                  {fitxer.fulles.length > 1 && (
                    <div className="max-w-sm space-y-1 pt-1">
                      <label htmlFor="ie-fulla" className="block text-xs text-muted-foreground">{t('ie.fulla')}</label>
                      <Desplegable id="ie-fulla" value={String(fullaIdx)} onChange={(v) => { setFullaIdx(Number(v)); setRols({}); setDecisions({}); setPrevi(null) }}
                        opcions={fitxer.fulles.map((f, i) => ({ valor: String(i), text: f.nom }))} data-testid="ie-fulla" />
                    </div>
                  )}
                  <p className="text-muted-foreground">
                    {t('ie.fila_capcalera', { n: fulla.filaCapcalera + 1 })} · <span data-testid="ie-nfiles">{t('ie.files_n', { n: files.length })}</span>
                  </p>
                  {fulla.exemples > 0 && <p className="text-muted-foreground">{t('ie.exemple_saltat')}</p>}
                </div>

                {jaAt && <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso" data-testid="ie-ja-importat">{t('ie.ja_importat', { data: dataCurta(jaAt) })}</p>}

                {fulla.mapa.falten.length > 0 && (
                  <div className="space-y-2 rounded-md bg-error-fondo p-3 text-sm" role="alert" data-testid="ie-falten">
                    <p className="flex items-start gap-2 font-medium text-error">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      {fulla.mapa.falten.map((c) => t('ie.falten_t', { col: t(`ie.col_${c}`) })).join(' · ')}
                    </p>
                    <p>{t('ie.falten_d')}</p>
                    {botoPlantilla}
                  </div>
                )}
                {massaFiles && <p className="rounded-md bg-error-fondo p-3 text-sm text-error" role="alert">{t('ie.err_massa_files', { n: files.length })}</p>}
                {fulla.mapa.falten.length === 0 && files.length === 0 && (
                  <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('ie.err_sense_files')}</p>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">{t('ie.reconegudes', { n: fulla.mapa.reconegudes.length })}</h3>
                    <ul className="space-y-1 text-sm" data-testid="ie-reconegudes">
                      {fulla.mapa.reconegudes.map((r) => (
                        <li key={r.index} className="break-words">
                          <span className="font-medium">{r.capcalera}</span>
                          <span className="text-muted-foreground"> → {t(`ie.col_${r.clau}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">{t('ie.ignorades', { n: fulla.mapa.ignorades.length })}</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground" data-testid="ie-ignorades">
                      {fulla.mapa.ignorades.map((r) => (
                        <li key={r.index} className="break-words">{r.capcalera} · {t(`ie.motiu_${r.motiu}`)}</li>
                      ))}
                    </ul>
                  </section>
                </div>

                <div className="flex justify-end">
                  <Button onClick={() => { setPrevi(null); setPas(2) }} disabled={!potRevisar}
                    className="h-11 w-full whitespace-normal sm:w-auto md:h-8" data-testid="ie-continua">
                    {t('ie.continua')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        )}

        {pas === 2 && (
          <CardContent className="space-y-4" data-testid="ie-pas2">
            {jaAt && <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('ie.ja_importat', { data: dataCurta(jaAt) })}</p>}
            {errPrevi && <p className="rounded-md bg-error-fondo p-3 text-sm text-error" role="alert">{errPrevi}</p>}
            {!previ && !errPrevi && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('ie.revisant')}</p>
            )}
            {previ && (
              <Revisio
                previ={previ} perFila={perFila} rols={rols} decisions={decisions} filtre={filtre} oberts={oberts}
                revisant={revisant} colSpan={lg ? 4 : md ? 3 : 2}
                onFiltre={setFiltre} onRol={canviaRol}
                onDecisio={(fila, v) => setDecisions((d) => ({ ...d, [fila]: v }))}
                onObert={(fila, v) => setOberts((o) => ({ ...o, [fila]: v }))}
              />
            )}
            {sensePaper.length > 0 && (
              <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso" data-testid="ie-sense-paper">{t('ie.falten_papers', { n: sensePaper.length })}</p>
            )}
            {previ && previ.files.some((f) => f.estat === 'dubtosa' && !decisions[f.fila]) && (
              <p className="text-sm text-muted-foreground">{t('ie.dubtoses_pendents')}</p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="outline" onClick={() => setPas(1)} className="h-11 w-full whitespace-normal sm:w-auto md:h-8">
                {t('ie.torna')}
              </Button>
              <BotoAmbMotiu onClick={() => void importa()}
                disabled={!previ || revisant || important || sensePaper.length > 0 || !!errPrevi}
                motiu={sensePaper.length > 0 ? t('ie.falten_papers', { n: sensePaper.length }) : undefined}
                className="h-11 w-full whitespace-normal sm:w-auto md:h-8" data-testid="ie-importa">
                {important && <Loader2 className="size-4 animate-spin" />}
                {important ? t('ie.important') : t('ie.importa_n', { n: enviar.length })}
              </BotoAmbMotiu>
            </div>
          </CardContent>
        )}

        {pas === 3 && resultat && (
          <CardContent className="space-y-4" data-testid="ie-pas3">
            <Resultat resultat={resultat} perFila={perFila} />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button variant="outline" onClick={informe} className="w-full whitespace-normal sm:w-auto" data-testid="ie-informe">
                <Download className="size-4" /> {t('ie.descarrega_informe')}
              </Button>
              <Button variant="outline" onClick={reinicia} className="w-full whitespace-normal sm:w-auto">
                <Upload className="size-4" /> {t('ie.nova_importacio')}
              </Button>
              <Button onClick={() => navigate(LLISTA)} className="w-full whitespace-normal sm:w-auto">{t('ef.tornar')}</Button>
            </div>
          </CardContent>
        )}
      </Card>
      {dialeg}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Paso 2: la revisión
// ---------------------------------------------------------------------------

function Revisio({
  previ, perFila, rols, decisions, filtre, oberts, revisant, colSpan, onFiltre, onRol, onDecisio, onObert,
}: {
  previ: Previsualitzacio
  perFila: Map<number, FilaNormalitzada>
  rols: Record<number, Paper[]>
  decisions: Record<number, string>
  filtre: string
  oberts: Record<number, boolean>
  revisant: boolean
  colSpan: number
  onFiltre: (v: string) => void
  onRol: (fila: number, p: Paper, v: boolean) => void
  onDecisio: (fila: number, v: string) => void
  onObert: (fila: number, v: boolean) => void
}) {
  const { t } = useT()
  const visibles = previ.files.filter((f) => !filtre || f.estat === filtre)

  return (
    <div className={`space-y-3 ${revisant ? 'opacity-70' : ''}`} aria-busy={revisant}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="ie-resum">
          <span className="font-medium">{t('ie.resum', { n: previ.resum.total })}</span>
          {ESTATS.filter((e) => previ.resum.per_estat[e] > 0).map((e) => (
            <Badge key={e} className={CLASSE_ESTAT[e]} data-testid={`ie-resum-${e}`}>{t(`ie.est_${e}`)} · {previ.resum.per_estat[e]}</Badge>
          ))}
          {revisant && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('ie.revisant')} />}
        </div>
        <div className="w-full space-y-1 sm:w-48">
          <label htmlFor="ie-filtre" className="block text-xs text-muted-foreground">{t('ie.filtre')}</label>
          <Desplegable id="ie-filtre" mida="sm" value={filtre} onChange={onFiltre} buit={t('ie.filtre_totes')}
            opcions={ESTATS.map((e) => ({ valor: e, text: `${t(`ie.est_${e}`)} (${previ.resum.per_estat[e]})` }))} />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-left">{t('ie.t_entitat')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('ie.t_papers')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('ie.t_que')}</TableHead>
            <TableHead className="w-12"><span className="sr-only">{t('ie.t_detall')}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibles.map((p) => {
            const f = perFila.get(p.fila)
            const obert = oberts[p.fila] ?? p.estat === 'dubtosa'
            const rolsFila = rols[p.fila] ?? f?.rols ?? []
            const casselles = (
              <div className="flex flex-wrap gap-x-4" data-testid="ie-rols">
                {PAPERS.map((pp) => (
                  <FilaCasella key={pp} checked={rolsFila.includes(pp)} onChange={(v) => onRol(p.fila, pp, v)}>
                    {t(paperKey(pp))}
                  </FilaCasella>
                ))}
              </div>
            )
            const que = (
              <span className="text-sm">
                {t(`ie.prev_${p.accio_prevista}`)}
                {p.omplira.length > 0 && p.accio_prevista !== 'crear' && (
                  <span className="block text-xs text-muted-foreground">
                    {t('ie.omplira')}: {campsOmplerts(p.omplira).map((c) => t(`ie.camp_${c}`)).join(', ')}
                  </span>
                )}
              </span>
            )
            return (
              <FilaRevisio key={p.fila} p={p} f={f} obert={obert} colSpan={colSpan} casselles={casselles} que={que}
                senseRol={rolsFila.length === 0} decisio={decisions[p.fila] ?? ''}
                onDecisio={(v) => onDecisio(p.fila, v)} onObert={(v) => onObert(p.fila, v)} />
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function FilaRevisio({
  p, f, obert, colSpan, casselles, que, senseRol, decisio, onDecisio, onObert,
}: {
  p: PrevisualitzacioFila
  f: FilaNormalitzada | undefined
  obert: boolean
  colSpan: number
  casselles: ReactNode
  que: ReactNode
  senseRol: boolean
  decisio: string
  onDecisio: (v: string) => void
  onObert: (v: boolean) => void
}) {
  const { t } = useT()
  const avisos = [...(f?.avisosLocals ?? []).map((a) => t(`ie.al_${a}`)), ...p.avisos.map((a) => textCodi(t, a))]
  const errors = p.errors.map((e) => textCodi(t, e))
  return (
    <>
      <TableRow data-testid="ie-fila" data-fila={p.fila} data-estat={p.estat}>
        <TableCell className="text-left">
          <span className="flex flex-wrap items-center gap-2">
            <Badge className={CLASSE_ESTAT[p.estat]}>{t(`ie.est_${p.estat}`)}</Badge>
            <span className="text-xs text-muted-foreground">{t('ie.fila', { n: p.fila })}</span>
            {senseRol && <Badge className="bg-error-fondo text-error">{t('ie.sense_paper')}</Badge>}
          </span>
          <span className="mt-1 block font-medium">{f?.nom ?? t('ie.sense_nom')}</span>
          {f?.nif && <span className="block text-xs tabular-nums text-muted-foreground">{f.nif}</span>}
          <div className="mt-1 md:hidden">{casselles}</div>
          <div className="mt-1 lg:hidden">{que}</div>
        </TableCell>
        <TableCell className="hidden md:table-cell">{casselles}</TableCell>
        <TableCell className="hidden text-left lg:table-cell">{que}</TableCell>
        <TableCell>
          <BotoIcona icona={obert ? ChevronUp : ChevronDown} etiqueta={t(obert ? 'ie.amaga_detall' : 'ie.mostra_detall')}
            aria-expanded={obert} onClick={() => onObert(!obert)} />
        </TableCell>
      </TableRow>
      {obert && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={colSpan} className="bg-muted/30 text-left">
            <div className="space-y-3 text-sm" data-testid="ie-detall">
              {f?.origenRols === 'deduit' && <p className="text-muted-foreground">{t('ie.rols_deduits')}</p>}
              {p.rols_existents.length > 0 && (
                <p className="text-muted-foreground">
                  {t('ie.rols_existents', { rols: p.rols_existents.map((r) => t(paperKey(r)).toLowerCase()).join(', ') })}
                </p>
              )}
              {p.estat === 'dubtosa' && (
                <div className="space-y-2 rounded-md border border-aviso/30 bg-aviso-fondo p-3">
                  <p className="font-medium text-aviso">{t('ie.candidats')}</p>
                  <ul className="space-y-1">
                    {p.candidats.map((c) => (
                      <li key={c.organizacion_id} className="break-words">
                        <span className="font-medium">{c.nom ?? '—'}</span>
                        {c.nif && <span className="text-muted-foreground"> · {c.nif}</span>}
                        <span className="text-muted-foreground">
                          {' · '}{c.motius.map((m) => t(`ie.mot_${m}`)).join(', ')}
                          {c.similitud !== null && ` · ${t('ie.similitud', { pct: Math.round(c.similitud * 100) })}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="max-w-md space-y-1">
                    <label htmlFor={`ie-dec-${p.fila}`} className="block text-xs text-muted-foreground">{t('ie.decisio')}</label>
                    <Desplegable id={`ie-dec-${p.fila}`} value={decisio || 'ometre'} onChange={onDecisio} data-testid="ie-decisio"
                      opcions={[
                        { valor: 'crear', text: t('ie.dec_crear') },
                        ...p.candidats.map((c) => ({ valor: c.organizacion_id, text: t('ie.dec_es', { nom: c.nom ?? '—' }) })),
                        { valor: 'ometre', text: t('ie.dec_ometre') },
                      ]} />
                  </div>
                </div>
              )}
              {p.omplira.length > 0 && (
                <p><span className="font-medium">{t('ie.omplira')}:</span> {campsOmplerts(p.omplira).map((c) => t(`ie.camp_${c}`)).join(', ')}</p>
              )}
              {p.conflictes.length > 0 && (
                <div>
                  <p className="font-medium">{t('ie.conflictes')}</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {p.conflictes.map((c, i) => <li key={i} className="break-words">{textConflicte(t, c)}</li>)}
                  </ul>
                </div>
              )}
              {avisos.length > 0 && (
                <div>
                  <p className="font-medium text-aviso">{t('ie.avisos')}</p>
                  <ul className="list-disc space-y-0.5 pl-5">{avisos.map((a, i) => <li key={i} className="break-words">{a}</li>)}</ul>
                </div>
              )}
              {errors.length > 0 && (
                <div>
                  <p className="font-medium text-error">{t('ie.errors')}</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-error">{errors.map((a, i) => <li key={i} className="break-words">{a}</li>)}</ul>
                </div>
              )}
              {!avisos.length && !errors.length && !p.conflictes.length && !p.omplira.length && p.estat !== 'dubtosa' && (
                <p className="text-muted-foreground">{t('ie.res_a_dir')}</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Paso 3: el resultado
// ---------------------------------------------------------------------------

const XIFRES = ['creades', 'actualitzades', 'paper_afegit', 'sense_canvis', 'omeses', 'errors'] as const

function Resultat({ resultat, perFila }: { resultat: ResultatImportacio; perFila: Map<number, FilaNormalitzada> }) {
  const { t } = useT()
  const navigate = useNavigate()
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">{t('ie.res_t')}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="ie-xifres">
        {XIFRES.map((x) => (
          <div key={x} className="rounded-md border p-3" data-testid={`ie-xifra-${x}`}>
            <p className="font-titulos text-2xl font-semibold tabular-nums">{resultat.resum[x]}</p>
            <p className="text-xs text-muted-foreground">{t(`ie.res_${x}`)}</p>
          </div>
        ))}
      </div>
      {resultat.ja_importat_at && (
        <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('ie.ja_importat', { data: dataCurta(resultat.ja_importat_at) })}</p>
      )}
      {resultat.resum.creades > 0 && <p className="text-sm text-muted-foreground">{t('ie.inactives_nota')}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-left">{t('ie.t_entitat')}</TableHead>
            <TableHead className="w-15 md:w-24"><span className="sr-only md:not-sr-only">{t('el.c_actions')}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resultat.files.map((r) => {
            const f = perFila.get(r.fila)
            const avisos = [...(f?.avisosLocals ?? []).map((a) => t(`ie.al_${a}`)), ...r.avisos.map((a) => textCodi(t, a))]
            const errors = r.errors.map((e) => textCodi(t, e))
            const conveni = f?.conveni ? [f.conveni.data, f.conveni.signant].filter(Boolean).join(' · ') : null
            return (
              <TableRow key={r.fila} data-testid="ie-res-fila" data-fila={r.fila} data-accio={r.accio}>
                <TableCell className="text-left">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge className={CLASSE_ACCIO[r.accio]}>{t(`ie.acc_${r.accio}`)}</Badge>
                    <span className="text-xs text-muted-foreground">{t('ie.fila', { n: r.fila })}</span>
                  </span>
                  <span className="mt-1 block font-medium">{f?.nom ?? t('ie.sense_nom')}</span>
                  {r.camps_omplerts.length > 0 && r.accio !== 'creada' && (
                    <span className="block text-xs text-muted-foreground">
                      {t('ie.omplira')}: {campsOmplerts(r.camps_omplerts).map((c) => t(`ie.camp_${c}`)).join(', ')}
                    </span>
                  )}
                  {conveni && <span className="block text-xs text-aviso" data-testid="ie-conveni">{t('ie.conveni_info', { dades: conveni })}</span>}
                  {r.conflictes.map((c, i) => <span key={`c${i}`} className="block text-xs text-muted-foreground">{textConflicte(t, c)}</span>)}
                  {avisos.map((a, i) => <span key={`a${i}`} className="block text-xs text-aviso">{a}</span>)}
                  {errors.map((e, i) => <span key={`e${i}`} className="block text-xs text-error">{e}</span>)}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                    {r.organizacion_id && (
                      <BotoIcona icona={Eye} etiqueta={t('ie.obre_fitxa')} data-testid="ie-obre-fitxa"
                        onClick={() => navigate(`${LLISTA}/${r.organizacion_id}`)} />
                    )}
                    {r.organizacion_id && conveni && (
                      <BotoIcona icona={FileSignature} etiqueta={t('ie.obre_convenis')}
                        onClick={() => navigate(`${LLISTA}/${r.organizacion_id}?pestanya=documentacio`)} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
