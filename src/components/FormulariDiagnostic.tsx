// EL formulario del diagnóstico operativo del productor (A1, `20270520100000`).
//
// Desde A1 lo rellena SOLO EL EQUIPO (D5), con la persona delante o al teléfono: se monta en
// `/equip/diagnostics/productor/:id` (`DiagnosticDetall`). El productor lo LEE en «El meu
// diagnòstic» (`ResumDiagnostic`), y `desar_diagnostic()` le respondería `42501`.
//
// 🔴 HAY UN SOLO DIAGNÓSTICO POR PRODUCTOR (D1), en `diagnostics`, que se sobrescribe. El
//    formulario se abre con lo último guardado (`diagnosticActual`) y guardar ya no toca
//    ningún plan: el plan es el expediente (D4).
//
// 🔴 SE GUARDA SIEMPRE, COMPLETO O NO, con un solo botón. Si está completo lo dice el
//    SERVIDOR (`complet`, `falten`) y se enseña como badge: un cuestionario largo no se
//    contesta de una sentada, y exigirlo entero para guardar haría perder lo tecleado.
//
// ⚠️ LO QUE SE VE NO ES TODO LO QUE HAY. Las preguntas condicionales se ocultan con
//    `preguntaAplica()`, que es una **reimplementación** de la gramática que vive en SQL
//    (ver la cabecera de `lib/diagnostic.ts`). Lo que decide si está completo es `falten`
//    tal como lo devuelve el servidor; aquí se calcula en local solo para señalar las
//    preguntas pendientes y el punto de cada chip de sección mientras se escribe.
//
// ⚠️ EL PREFILL SE MARCA. Un valor propuesto desde la ficha se enseña con su nota hasta que
//    alguien lo toca. Sin la marca sería indistinguible de una respuesta dada, y `prefill`
//    existe justamente para no escribir en el diagnóstico algo que la persona no ha dicho
//    (20270328101600).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { refrescaAvisos } from '../lib/refrescAvisos'
import { textError } from '../lib/textError'
import { FilaCasella } from './Casella'
import NavSeccionsDiagnostic from './diagnostic/NavSeccionsDiagnostic'
import {
  agrupaPerSeccio, esBuit, estilEstatDiagnostic, idSeccio, llistaDe, mesosValids, netejaRespostes,
  obligatoriesQueFalten, opcionsProductes, opcionsVisibles, prefillDesDeFitxa, progresDiagnostic,
  seccionsAmbEstat, textBilingue,
} from '../lib/diagnostic'
import type { Respostes } from '../lib/diagnostic'
import {
  desarDiagnostic, diagnosticActual, diagnosticEstat, questionariVigent,
} from '../lib/diagnosticApi'
import { carregaCataleg } from '../lib/fotosProducte'
import { supabase } from '../lib/supabase'
import { dataCurta } from '../lib/format'
import XipsTria from './XipsTria'
import type {
  DiagnosticEstat, OpcioPregunta, PreguntaDiagnostic, QuestionariDiagnostic,
} from '../types'
import { cn } from '../lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

/** Radix no admite `value=""`, así que «sense respondre» necesita un centinela. */
const CAP = '__cap'

export interface Props {
  /** El productor (`productores.id`). Desde A1 el diagnóstico es solo de productores. */
  orgId: string
  /**
   * `true` = lo conduce el equipo con la persona delante (modelo asistido): lo dice arriba.
   * Desde A1 es el único caso real (D5); queda como prop para que el aviso sea explícito.
   */
  assistit?: boolean
  /** La ficha del productor, para proponer valores. Ver la nota de la cabecera. */
  prefill?: Record<string, unknown> | null
  /** Se llama después de cada guardado, para que la pantalla refresque lo que enseñe. */
  onDesat?: (r: { complet: boolean }) => void | Promise<void>
}

export default function FormulariDiagnostic({
  orgId, assistit = false, prefill = null, onDesat,
}: Props) {
  const { t, lang } = useT()
  const [questionari, setQuestionari] = useState<QuestionariDiagnostic | null>(null)
  const [estat, setEstat] = useState<DiagnosticEstat | null>(null)
  const [respostes, setRespostes] = useState<Respostes>({})
  const [proposats, setProposats] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [desant, setDesant] = useState(false)
  /** El catálogo y los lugares de la ficha: lo que necesitan los tipos de la fase 9. */
  const [dades, setDades] = useState<DadesControls>({ cataleg: [], llocs: [] })

  const carrega = useCallback(async () => {
    setCarregant(true)
    const [q, diag, est, cataleg, llocs] = await Promise.all([
      questionariVigent('productor'),
      diagnosticActual(orgId),
      diagnosticEstat('productor', orgId),
      carregaCataleg(),
      supabase.from('productor_ubicaciones').select('id, alias, municipio').eq('productor_id', orgId),
    ])
    if (!q.ok) { setError(q.missatge); setCarregant(false); return }
    // Sin poder leer lo guardado no se abre el formulario: guardarlo vacío pisaría la fila.
    if (!diag.ok) { setError(diag.missatge); setCarregant(false); return }
    setError(null)
    setQuestionari(q.data)
    setEstat(est.ok ? est.data : null)
    setDades({
      cataleg: [...cataleg.values()],
      llocs: ((llocs.data ?? []) as { id: string; alias: string | null; municipio: string | null }[]),
    })

    // EL diagnóstico (D1): lo último guardado, tal cual se tecleó.
    const desades: Respostes = diag.data?.respostes ?? {}
    setNotes(diag.data?.notes ?? '')

    // La propuesta solo llena los huecos: lo que ya se contestó una vez manda siempre sobre
    // lo que diga la ficha. Al revés, corregir una respuesta y volver a entrar la
    // desharía.
    const proposta = prefillDesDeFitxa(q.data?.preguntes ?? [], prefill)
    const marcats = new Set<string>()
    const inicials: Respostes = { ...desades }
    for (const [id, valor] of Object.entries(proposta)) {
      if (esBuit(desades[id])) { inicials[id] = valor; marcats.add(id) }
    }
    setRespostes(inicials)
    setProposats(marcats)
    setCarregant(false)
  }, [orgId, prefill])

  useEffect(() => { void carrega() }, [carrega])

  // En su propio `useMemo` y no un `??` suelto: un array nuevo en cada render haría que los
  // `useMemo` de abajo recalcularan siempre, que es lo que `react-hooks` señala.
  const preguntes = useMemo(() => questionari?.preguntes ?? [], [questionari])
  const seccions = useMemo(() => agrupaPerSeccio(preguntes, respostes), [preguntes, respostes])
  const estatSeccions = useMemo(() => seccionsAmbEstat(seccions, respostes), [seccions, respostes])
  const falten = useMemo(() => obligatoriesQueFalten(preguntes, respostes), [preguntes, respostes])
  const progres = useMemo(() => progresDiagnostic(preguntes, respostes), [preguntes, respostes])

  function respon(id: string, valor: unknown) {
    setRespostes((r) => {
      const seg = { ...r }
      if (valor === undefined) delete seg[id]
      else seg[id] = valor
      return seg
    })
    // Tocado deja de ser propuesto: a partir de aquí es una respuesta.
    setProposats((p) => {
      if (!p.has(id)) return p
      const seg = new Set(p)
      seg.delete(id)
      return seg
    })
  }

  async function desa() {
    if (desant) return
    setDesant(true)
    const r = await desarDiagnostic(
      'productor', orgId, netejaRespostes(preguntes, respostes),
      notes.trim() === '' ? null : notes.trim(), lang)
    setDesant(false)
    if (!r.ok) { toast.error(textError(t, r)); return }

    if (r.data.complet) {
      toast.success(t('diag.saved_complete'))
    } else {
      toast.success(t('diag.saved_partial', { n: r.data.falten.length }))
    }
    // La banda de la Operativa vive en AppShell y no se enteraría sola (refrescAvisos.ts).
    refrescaAvisos()
    // Se recarga SIEMPRE: el estado que manda es el que calcula el servidor.
    await carrega()
    await onDesat?.({ complet: r.data.complet })
  }

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  // Se traduce al pintar, no al guardar: meter `t` en la carga la relanzaría al cambiar de
  // idioma y se perderían las respuestas sin guardar.
  if (error) return <p className="text-sm text-destructive">{textError(t, error)}</p>

  if (!questionari) {
    return (
      <Card>
        <CardHeader><CardTitle>{t('diag.no_questionnaire_t')}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('diag.no_questionnaire')}</p>
        </CardContent>
      </Card>
    )
  }

  // El estado lo dice el servidor (lo GUARDADO), no lo que hay tecleado sin guardar.
  const estatServidor = estat?.estat ?? 'sense_comencar'

  return (
    <div className="space-y-4" data-testid="formulari-diagnostic">
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{textBilingue(questionari.titol, lang)}</span>
            <Badge className={estilEstatDiagnostic(estatServidor)} data-testid="estat-diagnostic">
              {t(`diag.st_${estatServidor}`)}
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('diag.progress', { n: progres.contestades, total: progres.total })}
            {estat?.actualitzat_at && (
              <> · {estat.actualitzat_per_nom
                ? t('diag.actualitzat_per', { data: dataCurta(estat.actualitzat_at), nom: estat.actualitzat_per_nom })
                : t('diag.actualitzat', { data: dataCurta(estat.actualitzat_at) })}</>
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Que el cuestionario sea texto de trabajo se dice ARRIBA y no en letra pequeña:
              lo que salga de él lo lleva impreso. */}
          {questionari.provisional && (
            <div className="flex items-start gap-2 rounded-lg border border-aviso/30 bg-aviso-fondo px-3 py-2 text-sm text-aviso">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="min-w-0">{t('diag.provisional')}</p>
            </div>
          )}

          {assistit && (
            <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
              {t('diag.assisted_hint')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Los chips, pegados arriba mientras se baja: es lo que deja saltar a una sección
          sin recorrer la página entera. */}
      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur">
        <NavSeccionsDiagnostic seccions={estatSeccions} />
      </div>

      {seccions.map((s) => (
        <Card key={s.seccio} className="scroll-mt-24">
          <CardHeader>
            {/* `tabIndex={-1}`: el chip le lleva el foco al llegar (teclado y lector de pantalla). */}
            <CardTitle id={idSeccio(s.seccio)} tabIndex={-1} className="scroll-mt-24 text-base outline-none">
              {s.clau ? t(s.clau) : s.seccio}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {s.preguntes.map((p) => (
              <Pregunta
                key={p.id}
                pregunta={p}
                valor={respostes[p.id]}
                opcions={opcionsVisibles(p, respostes)}
                respostes={respostes}
                dades={dades}
                falta={falten.includes(p.id)}
                proposat={proposats.has(p.id)}
                onCanvi={(v) => respon(p.id, v)}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader><CardTitle className="text-base">{t('diag.notes_t')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="diag-notes" className="mb-1.5 block text-xs text-muted-foreground">
              {t('diag.notes_label')}
            </Label>
            <Textarea
              id="diag-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('diag.notes_ph')}
            />
          </div>

          {falten.length > 0 && (
            <p className="text-sm text-aviso">{t('diag.missing', { n: falten.length })}</p>
          )}

          {/* UN botón, y NUNCA gris por faltar algo: guardar a medias es exactamente lo que
              esta pantalla tiene que permitir. Si queda completo lo dice el servidor. */}
          <Button
            onClick={() => void desa()}
            disabled={desant}
            className="min-h-11 w-full whitespace-normal sm:w-auto"
          >
            {desant && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('diag.save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Una pregunta
// ---------------------------------------------------------------------------

function Pregunta({
  pregunta, valor, opcions, respostes, dades, falta, proposat, onCanvi,
}: {
  pregunta: PreguntaDiagnostic
  valor: unknown
  opcions: OpcioPregunta[]
  respostes: Respostes
  dades: DadesControls
  falta: boolean
  proposat: boolean
  onCanvi: (valor: unknown) => void
}) {
  const { t, lang } = useT()
  const etiqueta = textBilingue(pregunta.etiqueta, lang)
  const ajuda = textBilingue(pregunta.ajuda, lang)
  const id = `diag-${pregunta.id}`

  // ⚠️ `htmlFor` SOLO cuando existe ese `id` en el DOM. `Control` se lo pone al `Select`, al
  //    `Input` y al `Textarea`, pero un booleano y un `multi` se pintan con VARIAS casillas,
  //    cada una con su propia etiqueta: ahí no hay ningún control que se llame así. Un
  //    `htmlFor` colgando no falla el build ni se ve, pero deja la pregunta sin etiqueta
  //    para un lector de pantalla y hace que pulsar el enunciado no haga nada. Lo que
  //    corresponde entonces es un grupo con `aria-labelledby`.
  const unSolControl = pregunta.tipus === 'opcio' || pregunta.tipus === 'numero'
    || pregunta.tipus === 'text'

  return (
    <div className={cn('space-y-2', falta && 'rounded-lg border border-aviso/40 bg-aviso-fondo/40 p-3')}>
      <div>
        <Label
          id={`${id}-etiqueta`}
          htmlFor={unSolControl ? id : undefined}
          className="block text-sm leading-snug font-medium whitespace-normal"
        >
          {etiqueta}
          {/* Lo opcional se marca; lo obligatorio no lleva asterisco (design/DESIGN.md §6). */}
          {!pregunta.obligatoria && (
            <span className="ml-1 font-normal text-muted-foreground">{t('diag.optional')}</span>
          )}
        </Label>
        {ajuda && <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>}
      </div>

      {unSolControl
        ? <Control pregunta={pregunta} opcions={opcions} valor={valor} id={id} onCanvi={onCanvi} />
        : CONTROLS_FASE9.has(pregunta.tipus)
          ? <ControlFitxaViva pregunta={pregunta} valor={valor} respostes={respostes} dades={dades}
              id={id} onCanvi={onCanvi} />
          : (
            <div role="group" aria-labelledby={`${id}-etiqueta`}>
              <Control pregunta={pregunta} opcions={opcions} valor={valor} id={id} onCanvi={onCanvi} />
            </div>
          )}

      {proposat && <p className="text-xs text-muted-foreground">{t('diag.prefilled')}</p>}
    </div>
  )
}

function Control({
  pregunta, opcions, valor, id, onCanvi,
}: {
  pregunta: PreguntaDiagnostic
  opcions: OpcioPregunta[]
  valor: unknown
  id: string
  onCanvi: (valor: unknown) => void
}) {
  const { t, lang } = useT()

  if (pregunta.tipus === 'boolea') {
    // 🔴 DOS CASILLAS Y NO UNA, y no es un capricho de diseño. Una casilla sola tiene dos
    //    estados y aquí hacen falta TRES: sí, no, y todavía no lo he dicho. Esa tercera es
    //    exactamente lo que `diagnostic_falten()` mide, así que con una sola casilla
    //    «respondre que no» y «no respondre» serían el mismo píxel — y una obligatoria
    //    contestada con «no» quedaría para siempre contada como pendiente.
    //    Volver a pulsar la que ya está marcada deja la pregunta sin contestar, que es la
    //    única forma de deshacer una respuesta en una pregunta opcional.
    const si = valor === true
    const no = valor === false
    return (
      <div className="space-y-0.5">
        <FilaCasella checked={si} onChange={() => onCanvi(si ? undefined : true)}>
          {t('c.yes')}
        </FilaCasella>
        <FilaCasella checked={no} onChange={() => onCanvi(no ? undefined : false)}>
          {t('c.no')}
        </FilaCasella>
      </div>
    )
  }

  if (pregunta.tipus === 'multi') {
    const triats = Array.isArray(valor) ? (valor as unknown[]) : []
    return (
      <div className="space-y-0.5">
        {opcions.map((o) => {
          const marcat = triats.includes(o.valor)
          return (
            <FilaCasella
              key={o.valor}
              checked={marcat}
              onChange={() => {
                const seg = marcat
                  ? triats.filter((v) => v !== o.valor)
                  : [...triats, o.valor]
                // Una lista vacía ES «sin contestar» para `avaluar_regla`, así que se
                // guarda como tal en vez de como un array vacío que confundiría al leerlo.
                onCanvi(seg.length === 0 ? undefined : seg)
              }}
            >
              {textBilingue(o.etiqueta, lang)}
            </FilaCasella>
          )
        })}
      </div>
    )
  }

  if (pregunta.tipus === 'opcio') {
    const actual = typeof valor === 'string' && valor !== '' ? valor : CAP
    return (
      <Select value={actual} onValueChange={(v) => onCanvi(v === CAP ? undefined : v)}>
        {/* `text-base` en móvil: por debajo de 16 px iOS amplía la página al enfocar y no
            deshace el zoom al salir (§2, regla 1). `cn()` es tailwind-merge, así que este
            gana al `text-sm` que el trigger trae de serie. */}
        <SelectTrigger id={id} className="w-full text-base md:text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CAP} className="text-base md:text-sm">
            {t('diag.unanswered')}
          </SelectItem>
          {opcions.map((o) => (
            <SelectItem key={o.valor} value={o.valor} className="text-base md:text-sm">
              {textBilingue(o.etiqueta, lang)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (pregunta.tipus === 'numero') {
    return (
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        className="max-w-40"
        value={typeof valor === 'number' ? String(valor) : ''}
        onChange={(e) => {
          const v = e.target.value.trim()
          // Una cadena numérica NO es un número en jsonb, así que se convierte aquí: las
          // reglas `>=`/`<=` comparan contra un número y con texto no dispararían nunca.
          onCanvi(v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))
        }}
      />
    )
  }

  return (
    <Textarea
      id={id}
      rows={2}
      value={typeof valor === 'string' ? valor : ''}
      onChange={(e) => onCanvi(e.target.value.trim() === '' ? undefined : e.target.value)}
    />
  )
}

// ---------------------------------------------------------------------------
// Los tipos de la ficha viva (fase 9): productos, por producto, meses y lugares
// ---------------------------------------------------------------------------

interface DadesControls {
  cataleg: { nombre: string; familia: string | null }[]
  llocs: { id: string; alias: string | null; municipio: string | null }[]
}

const CONTROLS_FASE9: ReadonlySet<string> = new Set(['productes', 'per_producte_num', 'mesos', 'ubicacio'])

const MESOS: Record<'ca' | 'es', string[]> = {
  ca: ['gen', 'feb', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'des'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
}

function ControlFitxaViva({
  pregunta, valor, respostes, dades, id, onCanvi,
}: {
  pregunta: PreguntaDiagnostic
  valor: unknown
  respostes: Respostes
  dades: DadesControls
  id: string
  onCanvi: (valor: unknown) => void
}) {
  const { t, lang } = useT()
  const etiquetaId = `${id}-etiqueta`

  if (pregunta.tipus === 'productes') {
    const opcions = opcionsProductes(pregunta, respostes, dades.cataleg)
    const triats = llistaDe(respostes, pregunta.id)
    if (opcions.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          {t(pregunta.opcions_de ? 'diag.marca_productes' : 'diag.marca_families')}
        </p>
      )
    }
    const max = pregunta.max ?? null
    const ple = max !== null && triats.length >= max
    return (
      <div className="space-y-1">
        <XipsTria
          etiquetaId={etiquetaId}
          opcions={opcions.map((n) => ({ valor: n, text: n, desactivat: ple && !triats.includes(n) }))}
          triats={triats}
          onChange={(v) => onCanvi(v.length === 0 ? undefined : (max ? v.slice(0, max) : v))}
        />
        {max !== null && <p className="text-xs text-muted-foreground">{t('diag.max_productes', { n: max })}</p>}
      </div>
    )
  }

  if (pregunta.tipus === 'ubicacio') {
    if (dades.llocs.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('diag.sense_llocs')}</p>
    }
    const triats = Array.isArray(valor) ? (valor as string[]) : []
    return (
      <XipsTria
        etiquetaId={etiquetaId}
        opcions={dades.llocs.map((l) => ({ valor: l.id, text: l.alias || l.municipio || '—' }))}
        triats={triats}
        onChange={(v) => onCanvi(v.length === 0 ? undefined : v)}
      />
    )
  }

  // `per_producte_num` y `mesos`: una fila por producto de la pregunta de la que dependen.
  const productes = pregunta.productes_de ? llistaDe(respostes, pregunta.productes_de) : null
  if (productes !== null && productes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('diag.marca_productes')}</p>
  }
  const mapa = valor && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>) : {}
  const posa = (producte: string, v: unknown) => {
    const seg = { ...mapa }
    if (v === undefined) delete seg[producte]
    else seg[producte] = v
    onCanvi(Object.keys(seg).length === 0 ? undefined : seg)
  }

  if (pregunta.tipus === 'per_producte_num') {
    const unitat = textBilingue(pregunta.unitat, lang)
    return (
      <div className="space-y-2" role="group" aria-labelledby={etiquetaId}>
        {(productes ?? []).map((p, i) => (
          <div key={p} className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-${i}`} className="min-w-32 text-sm">{p}</label>
            <Input
              id={`${id}-${i}`}
              type="number"
              inputMode="decimal"
              min={0}
              className="max-w-40"
              value={typeof mapa[p] === 'number' ? String(mapa[p]) : ''}
              onChange={(e) => {
                const v = e.target.value.trim()
                posa(p, v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))
              }}
            />
            {unitat && <span className="text-sm text-muted-foreground">{unitat}</span>}
          </div>
        ))}
      </div>
    )
  }

  // `mesos`
  const opcionsMesos = MESOS[lang].map((m, i) => ({ valor: String(i + 1), text: m }))
  const selector = (actuals: number[], onTria: (m: number[]) => void, etiq: string) => (
    <XipsTria
      etiquetaId={etiq}
      opcions={opcionsMesos}
      triats={actuals.map(String)}
      onChange={(v) => onTria(mesosValids(v.map(Number)))}
    />
  )
  if (productes === null) {
    return selector(mesosValids(valor), (m) => onCanvi(m.length === 0 ? undefined : m), etiquetaId)
  }
  return (
    <div className="space-y-3">
      {productes.map((p, i) => (
        <div key={p} className="space-y-1">
          <p id={`${id}-${i}-l`} className="text-sm font-medium">{p}</p>
          {selector(mesosValids(mapa[p]), (m) => posa(p, m.length === 0 ? undefined : m), `${id}-${i}-l`)}
        </div>
      ))}
    </div>
  )
}
