// EL formulario del diagnóstico de prevención. Uno solo, para los tres sitios donde se
// contesta: el panel de la organización (`/organitzacio/diagnostic`), la ficha del equipo
// (`/equip/diagnostics/:tipus/:id`) y cualquier acompañamiento asistido que venga después.
//
// Es el patrón de `FirmaConveni` y `FormulariNovaOferta`: el formulario vive en
// `components/`, la pantalla es el marco, y **el tipo y la organización entran por prop**.
// No se deducen de `useOrganitzacio()` porque un interno no tiene ninguna organización
// propia — y el diagnóstico es, antes que nada, un servicio asistido (§1bis).
//
// 🔴 SE GUARDA SIEMPRE, COMPLETO O NO, y por eso hay dos botones y no uno. Doce preguntas no
//    se contestan de una sentada: si «Desar» exigiera el cuestionario entero, lo tecleado se
//    perdería cada vez que alguien se levanta. La base ya está construida así
//    (`desar_diagnostic` guarda y **luego** decide si genera el plan), y esta pantalla solo
//    tiene que no estropearlo.
//
// ⚠️ LO QUE SE VE NO ES TODO LO QUE HAY. Las preguntas condicionales se ocultan con
//    `preguntaAplica()`, que es una **reimplementación** de la gramática que vive en SQL
//    (ver la cabecera de `lib/diagnostic.ts`). Por eso lo que decide si el plan se puede
//    generar no es esta pantalla: es `falten` tal como lo devuelve el servidor. Aquí se
//    calcula en local solo para poder señalar las preguntas en rojo mientras se escribe.
//
// ⚠️ EL PREFILL SE MARCA. Un valor propuesto desde la ficha se enseña con su nota («proposat
//    des de la teva fitxa») hasta que alguien lo toca. Sin la marca sería indistinguible de
//    una respuesta dada, y `prefill` existe justamente para no escribir en el diagnóstico
//    algo que la persona no ha dicho (20260921231949).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { FilaCasella } from './Casella'
import PasosProces from './proces/PasosProces'
import QueTocaAra from './proces/QueTocaAra'
import {
  PASSOS_DIAGNOSTIC_CLAUS, agrupaPerSeccio, esBuit, obligatoriesQueFalten,
  prefillDesDeFitxa, progresDiagnostic, puntDiagnostic, textBilingue,
} from '../lib/diagnostic'
import type { Respostes } from '../lib/diagnostic'
import {
  desarDiagnostic, diagnosticEstat, plaEsborrany, questionariVigent,
} from '../lib/diagnosticApi'
import type { TipusOrg } from '../lib/diagnosticApi'
import type {
  DiagnosticEstat, PreguntaDiagnostic, QuestionariDiagnostic, SobreDiagnostic,
} from '../types'
import { cn } from '../lib/utils'
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
  tipusOrg: TipusOrg
  orgId: string
  /**
   * `true` = lo conduce el equipo con la persona delante (modelo asistido). Solo cambia lo
   * que se dice —quién contesta—, nunca lo que se guarda: la RPC es la misma y deja el
   * mismo borrador, que es lo que hace que los dos caminos produzcan el mismo documento.
   */
  assistit?: boolean
  /** La ficha de la organización, para proponer valores. Ver la nota de la cabecera. */
  prefill?: Record<string, unknown> | null
  /** Se llama después de cada guardado, para que la pantalla refresque lo que enseñe. */
  onDesat?: (r: { complet: boolean; pla: string; mesuresN: number }) => void | Promise<void>
}

export default function FormulariDiagnostic({
  tipusOrg, orgId, assistit = false, prefill = null, onDesat,
}: Props) {
  const { t, lang } = useT()
  const [questionari, setQuestionari] = useState<QuestionariDiagnostic | null>(null)
  const [estat, setEstat] = useState<DiagnosticEstat | null>(null)
  const [respostes, setRespostes] = useState<Respostes>({})
  const [proposats, setProposats] = useState<Set<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [desant, setDesant] = useState<null | 'parcial' | 'complet'>(null)

  const carrega = useCallback(async () => {
    setCarregant(true)
    const [q, pla, est] = await Promise.all([
      questionariVigent(tipusOrg),
      plaEsborrany(tipusOrg, orgId),
      diagnosticEstat(tipusOrg, orgId),
    ])
    if (!q.ok) { setError(q.missatge); setCarregant(false); return }
    setError(null)
    setQuestionari(q.data)
    setEstat(est.ok ? est.data : null)

    const sobre = pla.ok ? (pla.data?.respuestas as SobreDiagnostic | undefined) : undefined
    const desades: Respostes = (sobre?.respostes_crues as Respostes | undefined) ?? {}
    setNotes(typeof sobre?.notes === 'string' ? sobre.notes : '')

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
  }, [tipusOrg, orgId, prefill])

  useEffect(() => { void carrega() }, [carrega])

  // En su propio `useMemo` y no un `??` suelto: un array nuevo en cada render haría que los
  // tres `useMemo` de abajo recalcularan siempre, que es lo que `react-hooks` señala.
  const preguntes = useMemo(() => questionari?.preguntes ?? [], [questionari])
  const seccions = useMemo(() => agrupaPerSeccio(preguntes, respostes), [preguntes, respostes])
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

  async function desa(mode: 'parcial' | 'complet') {
    if (desant) return
    setDesant(mode)
    const r = await desarDiagnostic(
      tipusOrg, orgId, respostes, notes.trim() === '' ? null : notes.trim(), lang)
    setDesant(null)
    if (!r.ok) { toast.error(r.missatge); return }

    if (r.data.complet) {
      toast.success(r.data.te_mesures
        ? t('diag.saved_plan', { n: r.data.mesures_n })
        : t('diag.saved_complete'))
    } else {
      toast.success(t('diag.saved_partial', { n: r.data.falten.length }))
    }
    // Se recarga SIEMPRE, también tras un guardado parcial: la respuesta trae `falten` tal
    // como lo ve el servidor, y esa es la lista que manda sobre la que se calcula aquí.
    await carrega()
    await onDesat?.({ complet: r.data.complet, pla: r.data.pla, mesuresN: r.data.mesures_n })
  }

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  if (error) return <p className="text-sm text-destructive">{error}</p>

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

  const punt = puntDiagnostic({
    estat: estat?.estat ?? 'sense_comencar',
    faltenN: falten.length,
    mesuresN: estat?.mesures_n ?? 0,
    numero: estat?.numero ?? null,
  }, assistit ? 'equip' : 'org')

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3">
          <CardTitle>{textBilingue(questionari.titol, lang)}</CardTitle>
          <PasosProces etapes={PASSOS_DIAGNOSTIC_CLAUS} actual={punt.index} />
        </CardHeader>
        <CardContent className="space-y-3">
          <QueTocaAra punt={punt} compacte />

          {/* Que el cuestionario sea texto de trabajo se dice ARRIBA y no en letra pequeña:
              un plan emitido con él lo lleva impreso, así que quien lo contesta tiene que
              saberlo antes de empezar, no después. */}
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

          <p className="text-sm text-muted-foreground">
            {t('diag.progress', { n: progres.contestades, total: progres.total })}
          </p>
        </CardContent>
      </Card>

      {seccions.map((s) => (
        <Card key={s.seccio}>
          <CardHeader>
            <CardTitle className="text-base">{s.clau ? t(s.clau) : s.seccio}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {s.preguntes.map((p) => (
              <Pregunta
                key={p.id}
                pregunta={p}
                valor={respostes[p.id]}
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

          {/* Dos botones, y el de la izquierda NUNCA está gris: guardar a medias es
              exactamente lo que esta pantalla tiene que permitir. El de la derecha sí se
              apaga cuando falta algo, y entonces la línea de arriba dice cuánto. */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void desa('complet')}
              disabled={desant !== null || falten.length > 0}
              className="min-h-11 whitespace-normal"
            >
              {desant === 'complet' && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('diag.save_generate')}
            </Button>
            <Button
              variant="outline"
              onClick={() => void desa('parcial')}
              disabled={desant !== null}
              className="min-h-11 whitespace-normal"
            >
              {desant === 'parcial' && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('diag.save_later')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Una pregunta
// ---------------------------------------------------------------------------

function Pregunta({
  pregunta, valor, falta, proposat, onCanvi,
}: {
  pregunta: PreguntaDiagnostic
  valor: unknown
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
        ? <Control pregunta={pregunta} valor={valor} id={id} onCanvi={onCanvi} />
        : (
          <div role="group" aria-labelledby={`${id}-etiqueta`}>
            <Control pregunta={pregunta} valor={valor} id={id} onCanvi={onCanvi} />
          </div>
        )}

      {proposat && <p className="text-xs text-muted-foreground">{t('diag.prefilled')}</p>}
    </div>
  )
}

function Control({
  pregunta, valor, id, onCanvi,
}: {
  pregunta: PreguntaDiagnostic
  valor: unknown
  id: string
  onCanvi: (valor: unknown) => void
}) {
  const { t, lang } = useT()
  const opcions = pregunta.opcions ?? []

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
