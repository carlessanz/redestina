// El expediente de prevención entero (fase 11 de la revisión del 08-10-2026): la cabecera
// y, por pestañas, el recorrido del servicio —visitas, procesos, cuantificación, objetivos y
// acciones, seguimiento trimestral, verificación anual, evidencias y los PDF exportados—.
//
// UN componente para las dos miradas: el equipo lo edita (`editable`), la organización lo
// lee (`/organitzacio/pla`). Abrir, verificar, cerrar y exportar es `pot_aprovar()`.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileText, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { avuiMadrid, dataCurta, nombre } from '../../lib/format'
import { avancAccions, comparativaAnual } from '../../lib/expedient'
import {
  desarExpedient, documentsExpedient, elements, evidenciesExpedient, exportarExpedient,
  llegeixExpedient, tancarExpedient, verificarExpedient, volcarQuantificacio,
  type DocExpedient, type Element, type Evidencia, type Expedient,
} from '../../lib/expedientApi'
import { descarregarDocumentExtern, pujarDocumentExtern } from '../../lib/documents'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { useConfirma } from '../DialegConfirma'
import TaulaElements, { type CampElement } from './TaulaElements'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const SELECT = 'h-11 w-full rounded-md border border-input bg-transparent px-3 text-base md:h-9 md:text-sm'

const ESTIL_ESTAT: Record<string, string> = {
  obert: 'bg-aviso-fondo text-aviso',
  en_seguiment: 'bg-secondary text-secondary-foreground',
  verificat: 'bg-exito-fondo text-exito',
  tancat: 'bg-muted text-muted-foreground',
}

export default function ExpedientVista({
  expedientId, editable, potAprovar,
}: {
  expedientId: string
  editable: boolean
  potAprovar: boolean
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const descarregador = useDescarregaDocument()
  const [ex, setEx] = useState<Expedient | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quant, setQuant] = useState<Element[]>([])
  const [objectius, setObjectius] = useState<Element[]>([])
  const [accions, setAccions] = useState<Element[]>([])
  const [verificacions, setVerificacions] = useState<Element[]>([])
  const [docs, setDocs] = useState<DocExpedient[]>([])
  const [evid, setEvid] = useState<Evidencia[]>([])
  const [tic, setTic] = useState(0)
  const [ocupat, setOcupat] = useState<string | null>(null)
  const [cap, setCap] = useState<{ context: string; objectius: string; equip: string } | null>(null)
  const [verif, setVerif] = useState<{ any: string; resum: string; conclusio: string } | null>(null)
  const any = avuiMadrid().slice(0, 4)

  const recarrega = useCallback(async () => {
    const [r, v, d, e] = await Promise.all([
      llegeixExpedient(expedientId), elements('pla_verificacions', expedientId),
      documentsExpedient(expedientId), evidenciesExpedient(expedientId),
    ])
    if (!r.ok) { setError(r.missatge); return }
    setError(null)
    setEx(r.data)
    if (v.ok) setVerificacions(v.data)
    if (d.ok) setDocs(d.data)
    if (e.ok) setEvid(e.data)
  }, [expedientId])

  useEffect(() => { void recarrega() }, [recarrega, tic])

  const pot = editable && ex?.estat !== 'tancat'
  const aprova = potAprovar && ex?.estat !== 'tancat'

  const opcionsObjectius = useMemo(
    () => objectius.map((o) => ({ valor: o.id, text: String(o.descripcio ?? '') })), [objectius])
  const comparativa = useMemo(() => comparativaAnual(quant.map((q) => ({
    mes: String(q.mes ?? ''), kg: Number(q.kg) || 0, categoria: String(q.categoria ?? ''),
  }))), [quant])
  const avanc = useMemo(() => avancAccions(accions.map((a) => ({ estat: String(a.estat ?? '') }))), [accions])

  if (error) return <p className="text-sm text-destructive">{textError(t, error)}</p>
  if (!ex) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  const CAMPS: Record<string, CampElement[]> = {
    visites: [
      { clau: 'data', labelKey: 'exp.f_data', tipus: 'date', obligatori: true },
      { clau: 'tipus', labelKey: 'exp.f_tipus', tipus: 'select', obligatori: true, opcions: ['diagnosi', 'seguiment', 'verificacio', 'altres'].map((v) => ({ valor: v, text: t(`exp.visita_${v}`) })) },
      { clau: 'assistents', labelKey: 'exp.f_assistents', tipus: 'text' },
      { clau: 'notes', labelKey: 'exp.f_notes', tipus: 'textarea' },
    ],
    processos: [
      { clau: 'nom', labelKey: 'exp.f_proces', tipus: 'text', obligatori: true },
      { clau: 'descripcio', labelKey: 'exp.f_descripcio', tipus: 'textarea' },
      { clau: 'punts_critics', labelKey: 'exp.f_punts', tipus: 'textarea' },
      { clau: 'ordre', labelKey: 'exp.f_ordre', tipus: 'number', nomesFormulari: true },
    ],
    quantificacio: [
      { clau: 'mes', labelKey: 'exp.f_mes', tipus: 'mes', obligatori: true },
      { clau: 'producte', labelKey: 'exp.f_producte', tipus: 'text' },
      { clau: 'categoria', labelKey: 'exp.f_categoria', tipus: 'select', obligatori: true, opcions: ['perdua', 'excedent', 'residu'].map((v) => ({ valor: v, text: t(`exp.cat_${v}`) })) },
      { clau: 'kg', labelKey: 'exp.f_kg', tipus: 'number', obligatori: true },
      { clau: 'desti', labelKey: 'exp.f_desti', tipus: 'text' },
      { clau: 'causa', labelKey: 'exp.f_causa', tipus: 'text' },
    ],
    objectius: [
      { clau: 'descripcio', labelKey: 'exp.f_descripcio', tipus: 'text', obligatori: true },
      { clau: 'indicador', labelKey: 'exp.f_indicador', tipus: 'text' },
      { clau: 'valor_inicial', labelKey: 'exp.f_inicial', tipus: 'number' },
      { clau: 'valor_objectiu', labelKey: 'exp.f_objectiu', tipus: 'number' },
      { clau: 'unitat', labelKey: 'exp.f_unitat', tipus: 'text' },
      { clau: 'data_objectiu', labelKey: 'exp.f_data_objectiu', tipus: 'date' },
    ],
    accions: [
      { clau: 'mesura', labelKey: 'exp.f_mesura', tipus: 'text', obligatori: true },
      { clau: 'causa', labelKey: 'exp.f_causa', tipus: 'text' },
      { clau: 'objectiu_id', labelKey: 'exp.f_objectiu_rel', tipus: 'select', opcions: opcionsObjectius },
      { clau: 'responsable', labelKey: 'exp.f_responsable', tipus: 'text' },
      { clau: 'data_objectiu', labelKey: 'exp.f_data_objectiu', tipus: 'date' },
      { clau: 'estat', labelKey: 'exp.f_estat', tipus: 'select', opcions: ['pendent', 'en_curs', 'feta', 'descartada'].map((v) => ({ valor: v, text: t(`exp.accio_${v}`) })) },
      { clau: 'notes', labelKey: 'exp.f_notes', tipus: 'textarea', nomesFormulari: true },
    ],
    seguiment: [
      { clau: 'trimestre', labelKey: 'exp.f_trimestre', tipus: 'text', obligatori: true },
      { clau: 'data', labelKey: 'exp.f_data', tipus: 'date' },
      { clau: 'resum', labelKey: 'exp.f_resum', tipus: 'textarea' },
      { clau: 'notes', labelKey: 'exp.f_notes', tipus: 'textarea', nomesFormulari: true },
    ],
  }

  async function desaCapcalera() {
    if (!cap) return
    setOcupat('cap')
    const equip = cap.equip.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [nom, ...resta] = l.split(',')
      return { nom: nom.trim(), carrec: resta.join(',').trim() }
    })
    const r = await desarExpedient(expedientId, {
      context: cap.context,
      objectius_estrategics: cap.objectius.split('\n').map((l) => l.trim()).filter(Boolean),
      equip,
    })
    setOcupat(null)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    toast.success(t('rec.saved'))
    setCap(null)
    setTic((x) => x + 1)
  }

  async function canviaCamp(dades: Record<string, unknown>) {
    const r = await desarExpedient(expedientId, dades)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    setTic((x) => x + 1)
  }

  async function importa() {
    setOcupat('importa')
    const r = await volcarQuantificacio(expedientId, `${any}-01-01`, `${any}-12-31`)
    setOcupat(null)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    toast.success(t('exp.importat', { n: r.data }))
    setTic((x) => x + 1)
  }

  async function exporta() {
    if (!(await confirma({ titol: t('exp.exporta_t'), descripcio: t('exp.exporta_d'), confirmar: t('exp.exporta') }))) return
    setOcupat('exporta')
    const r = await exportarExpedient(expedientId)
    setOcupat(null)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    toast.success(t('exp.exportat', { numero: r.data.numero, versio: r.data.versio }))
    setTic((x) => x + 1)
    await descarregador.mostra(r.data.document)
  }

  async function verifica() {
    if (!verif) return
    const n = Number(verif.any)
    if (!Number.isInteger(n)) { toast.error(t('exp.falta_camp', { x: t('exp.f_any') })); return }
    setOcupat('verifica')
    const r = await verificarExpedient(expedientId, n, verif.resum, verif.conclusio)
    setOcupat(null)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    toast.success(t('exp.verificat'))
    setVerif(null)
    setTic((x) => x + 1)
  }

  async function tanca() {
    if (!(await confirma({ titol: t('exp.tanca_t'), descripcio: t('exp.tanca_d'), destructiu: true, confirmar: t('exp.tanca') }))) return
    const r = await tancarExpedient(expedientId)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    setTic((x) => x + 1)
  }

  async function pujaEvidencia(fitxer: File) {
    setOcupat('evidencia')
    const r = await pujarDocumentExtern({
      fitxer, objecteTipus: 'expedient', objecteId: expedientId, tipus: 'evidencia', exercici: Number(any),
    })
    setOcupat(null)
    if (!r.ok) { toast.error(t(r.motiuKey)); return }
    toast.success(t('exp.evidencia_pujada'))
    setTic((x) => x + 1)
  }

  const nomOrg = ex.productores?.empresa || ex.productores?.name || '—'

  return (
    <div className="space-y-4" data-testid="expedient">
      {/* ── La cabecera ── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{t('exp.titol', { org: nomOrg })}</CardTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge className={ESTIL_ESTAT[ex.estat]}>{t(`exp.estat_${ex.estat}`)}</Badge>
              <span>{t(ex.nivell === 'personalitzat' ? 'exp.nivell_personalitzat' : 'exp.nivell_basic')}</span>
              <span>· {t('exp.inici', { data: dataCurta(ex.data_inici) })}</span>
              {ex.numero_completo && <span>· {ex.numero_completo}</span>}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t('exp.recorregut')}</p>
          </div>
          {aprova && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button className="h-11 md:h-9" disabled={ocupat !== null} onClick={() => void exporta()}>
                <FileText className="size-4" aria-hidden /> {t('exp.exporta')}
              </Button>
              <Button variant="outline" className="h-11 md:h-9" onClick={() => setVerif({ any, resum: '', conclusio: '' })}>
                {t('exp.verifica')}
              </Button>
              <Button variant="outline" className="h-11 md:h-9" onClick={() => void tanca()}>{t('exp.tanca')}</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {pot && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="exp-estat" className="text-xs text-muted-foreground">{t('exp.f_estat_exp')}</Label>
                <select id="exp-estat" className={SELECT} value={ex.estat === 'verificat' ? 'en_seguiment' : ex.estat}
                  onChange={(e) => void canviaCamp({ estat: e.target.value })}>
                  <option value="obert">{t('exp.estat_obert')}</option>
                  <option value="en_seguiment">{t('exp.estat_en_seguiment')}</option>
                </select>
              </div>
              {aprova && (
                <div className="space-y-1">
                  <Label htmlFor="exp-nivell" className="text-xs text-muted-foreground">{t('exp.f_nivell')}</Label>
                  <select id="exp-nivell" className={SELECT} value={ex.nivell}
                    onChange={(e) => void canviaCamp({ nivell: e.target.value })}>
                    <option value="basic">{t('exp.nivell_basic')}</option>
                    <option value="personalitzat">{t('exp.nivell_personalitzat')}</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {verif && (
            <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
              <p className="text-sm font-medium">{t('exp.verifica_t')}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="exp-v-any" className="text-xs text-muted-foreground">{t('exp.f_any')}</Label>
                  <Input id="exp-v-any" inputMode="numeric" value={verif.any} onChange={(e) => setVerif({ ...verif, any: e.target.value })} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="exp-v-resum" className="text-xs text-muted-foreground">{t('exp.f_resum')}</Label>
                  <Input id="exp-v-resum" value={verif.resum} onChange={(e) => setVerif({ ...verif, resum: e.target.value })} />
                </div>
                <div className="space-y-1 sm:col-span-3">
                  <Label htmlFor="exp-v-conc" className="text-xs text-muted-foreground">{t('exp.f_conclusio')}</Label>
                  <Textarea id="exp-v-conc" rows={2} value={verif.conclusio} onChange={(e) => setVerif({ ...verif, conclusio: e.target.value })} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="h-11 md:h-9" disabled={ocupat !== null} onClick={() => void verifica()}>{t('exp.verifica')}</Button>
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setVerif(null)}>{t('c.cancel')}</Button>
              </div>
            </div>
          )}

          {cap ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="exp-context" className="text-xs text-muted-foreground">{t('exp.f_context')}</Label>
                <Textarea id="exp-context" rows={3} value={cap.context} onChange={(e) => setCap({ ...cap, context: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="exp-obj" className="text-xs text-muted-foreground">{t('exp.f_objectius_est')}</Label>
                <Textarea id="exp-obj" rows={3} value={cap.objectius} onChange={(e) => setCap({ ...cap, objectius: e.target.value })} />
                <p className="text-xs text-muted-foreground">{t('exp.h_una_per_linia')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="exp-equip" className="text-xs text-muted-foreground">{t('exp.f_equip')}</Label>
                <Textarea id="exp-equip" rows={3} value={cap.equip} onChange={(e) => setCap({ ...cap, equip: e.target.value })} />
                <p className="text-xs text-muted-foreground">{t('exp.h_equip')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="h-11 md:h-9" disabled={ocupat !== null} onClick={() => void desaCapcalera()}>{t('c.save')}</Button>
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setCap(null)}>{t('c.cancel')}</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">{t('exp.f_context')}</p>
                <p className="mt-1 text-sm whitespace-pre-line">{ex.context || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('exp.f_objectius_est')}</p>
                {ex.objectius_estrategics.length === 0 ? <p className="mt-1 text-sm">—</p> : (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                    {ex.objectius_estrategics.map((o) => <li key={o}>{o}</li>)}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('exp.f_equip')}</p>
                {ex.equip.length === 0 ? <p className="mt-1 text-sm">—</p> : (
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {ex.equip.map((e, i) => <li key={i}>{e.nom}{e.carrec ? ` · ${e.carrec}` : ''}</li>)}
                  </ul>
                )}
              </div>
              {pot && (
                <div className="md:col-span-3">
                  <Button variant="outline" className="h-11 w-full sm:w-auto md:h-9" onClick={() => setCap({
                    context: ex.context ?? '',
                    objectius: ex.objectius_estrategics.join('\n'),
                    equip: ex.equip.map((e) => [e.nom, e.carrec].filter(Boolean).join(', ')).join('\n'),
                  })}>{t('exp.edita_capcalera')}</Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── El recorrido, por pestañas ── */}
      <Tabs defaultValue="visites">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="visites">{t('exp.tab_visites')}</TabsTrigger>
            <TabsTrigger value="processos">{t('exp.tab_processos')}</TabsTrigger>
            <TabsTrigger value="quantificacio">{t('exp.tab_quantificacio')}</TabsTrigger>
            <TabsTrigger value="accions">{t('exp.tab_accions')}</TabsTrigger>
            <TabsTrigger value="seguiment">{t('exp.tab_seguiment')}</TabsTrigger>
            <TabsTrigger value="evidencies">{t('exp.tab_evidencies')}</TabsTrigger>
            <TabsTrigger value="documents">{t('exp.tab_documents')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="visites" className="mt-4">
          <TaulaElements key={`v-${tic}`} taula="pla_visites" expedientId={expedientId} titolKey="exp.tab_visites"
            ajudaKey="exp.h_visites" camps={CAMPS.visites} editable={pot} testId="exp-visites" />
        </TabsContent>

        <TabsContent value="processos" className="mt-4">
          <TaulaElements taula="pla_processos" expedientId={expedientId} titolKey="exp.tab_processos"
            ajudaKey="exp.h_processos" camps={CAMPS.processos} editable={pot} />
        </TabsContent>

        <TabsContent value="quantificacio" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base">{t('exp.comparativa')}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t('exp.h_comparativa')}</p>
              </div>
              {pot && (
                <Button variant="outline" className="h-11 w-full sm:w-auto md:h-9" disabled={ocupat !== null} onClick={() => void importa()}>
                  <Download className="size-4" aria-hidden /> {t('exp.importa', { any })}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {comparativa.length === 0 ? <p className="text-sm text-muted-foreground">{t('exp.buit')}</p> : (
                <div className="overflow-x-auto" data-testid="exp-comparativa">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('exp.f_any')}</TableHead>
                        <TableHead className="text-right">{t('exp.cat_perdua')}</TableHead>
                        <TableHead className="text-right">{t('exp.cat_excedent')}</TableHead>
                        <TableHead className="text-right">{t('exp.cat_residu')}</TableHead>
                        <TableHead className="text-right">{t('exp.total')}</TableHead>
                        <TableHead className="text-right">{t('exp.variacio')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparativa.map((a) => (
                        <TableRow key={a.any}>
                          <TableCell>{a.any}</TableCell>
                          <TableCell className="text-right tabular-nums">{nombre(a.perdua, 0)}</TableCell>
                          <TableCell className="text-right tabular-nums">{nombre(a.excedent, 0)}</TableCell>
                          <TableCell className="text-right tabular-nums">{nombre(a.residu, 0)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{nombre(a.total, 0)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {a.variacio === null ? '—' : `${a.variacio > 0 ? '+' : ''}${nombre(a.variacio, 1)} %`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <TaulaElements key={`q-${tic}`} taula="pla_quantificacio" expedientId={expedientId} titolKey="exp.tab_quantificacio"
            ajudaKey="exp.h_quantificacio" camps={CAMPS.quantificacio} editable={pot} onCanvi={setQuant} testId="exp-quantificacio" />
        </TabsContent>

        <TabsContent value="accions" className="mt-4 space-y-4">
          <TaulaElements taula="pla_objectius" expedientId={expedientId} titolKey="exp.objectius"
            camps={CAMPS.objectius} editable={pot} onCanvi={setObjectius} />
          {avanc.total > 0 && (
            <p className="text-sm text-muted-foreground">{t('exp.avanc', { f: avanc.fetes, n: avanc.total, p: avanc.pct })}</p>
          )}
          <TaulaElements taula="pla_accions" expedientId={expedientId} titolKey="exp.accions"
            ajudaKey="exp.h_accions" camps={CAMPS.accions} editable={pot} onCanvi={setAccions} testId="exp-accions" />
        </TabsContent>

        <TabsContent value="seguiment" className="mt-4 space-y-4">
          <TaulaElements taula="pla_seguiments" expedientId={expedientId} titolKey="exp.tab_seguiment"
            ajudaKey="exp.h_seguiment" camps={CAMPS.seguiment} editable={pot} />
          <Card>
            <CardHeader><CardTitle className="text-base">{t('exp.verificacions')}</CardTitle></CardHeader>
            <CardContent>
              {verificacions.length === 0 ? <p className="text-sm text-muted-foreground">{t('exp.buit')}</p> : (
                <ul className="space-y-2 text-sm">
                  {verificacions.map((v) => (
                    <li key={v.id}><span className="font-medium">{String(v.any)}</span> · {dataCurta(String(v.data ?? ''))} — {String(v.resum ?? '')} {v.conclusio ? `(${String(v.conclusio)})` : ''}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evidencies" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base">{t('exp.tab_evidencies')}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t('exp.h_evidencies')}</p>
              </div>
              {pot && (
                <label className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium sm:w-auto md:h-9">
                  <Upload className="size-4" aria-hidden /> {t('exp.puja_evidencia')}
                  <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only"
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pujaEvidencia(f) }} />
                </label>
              )}
            </CardHeader>
            <CardContent>
              {evid.length === 0 ? <p className="text-sm text-muted-foreground">{t('exp.buit')}</p> : (
                <ul className="space-y-2 text-sm">
                  {evid.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>{dataCurta(e.created_at)} · {e.numero || t('orgdoc.t_evidencia')}</span>
                      <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={async () => {
                        const r = await descarregarDocumentExtern(e.id)
                        if (!r.ok) toast.error(t(r.motiuKey))
                      }}>{t('exp.descarrega')}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('exp.tab_documents')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t('exp.h_documents')}</p>
            </CardHeader>
            <CardContent>
              {docs.length === 0 ? <p className="text-sm text-muted-foreground">{t('exp.cap_document')}</p> : (
                <ul className="space-y-2 text-sm" data-testid="exp-documents">
                  {docs.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {d.numero_completo} · v{d.version} · {dataCurta(d.emitido_at)}
                        {!d.vigente && <Badge variant="outline" className="ml-2">{t('exp.substituit')}</Badge>}
                      </span>
                      <Button variant="outline" size="sm" className="h-11 md:h-8" disabled={descarregador.ocupat !== null}
                        onClick={() => void descarregador.mostra(d.id)}>
                        <FileText className="size-4" aria-hidden /> {t('exp.veure_pdf')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {descarregador.visor}
      {dialeg}
    </div>
  )
}
