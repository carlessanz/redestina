// EL formulario del diagnóstico operativo del productor (A1 `20270520100000`, A4
// `20270521100000`, A3 `20270522100000`).
//
// Lo rellena SOLO EL EQUIPO (D5), con la persona delante o al teléfono: se monta en
// `/equip/diagnostics/productor/:id` (`DiagnosticDetall`). El productor lo LEE en «El meu
// diagnòstic» (`ResumDiagnostic`). HAY UN SOLO DIAGNÓSTICO POR PRODUCTOR (D1), que se sobrescribe.
//
// TRES SECCIONES, con sus chips (`NavSeccionsDiagnostic`, T3):
//   1. OPERATIVA de la ficha (A4, T4): columnas de `productores` y lugares de recogida, con los
//      mismos controles que la pestaña Operativa (`useOperativaDiagnostic`, `BlocCamps`,
//      `LlocsRecollida`; los lugares se guardan al momento).
//   2. EXCEDENTS (A3): por producto PRINCIPAL vivo de la Operativa, «Sense excedent» o las causas
//      del catálogo `causas` (D7) con frecuencia, kilos (P7), gestión actual, destinos y una
//      acción por destino (`BlocExcedentsProducte`, `CausaExcedent`). Los bloques guardados de un
//      producto que ya no es principal se conservan aparte (decisión a), con «Treu-lo».
//   3. ACCIONS: las guardadas, con su estado y su nota al momento (`AccionsDiagnostic`).
//
// 🔴 UN SOLO «DESA», que guarda SIEMPRE, completo o no: primero la Operativa (si la base la
//    rechaza no se guarda nada más) y después `desar_excedents_diagnostic` (excedentes, notas e
//    idioma en una transacción; REEMPLAZA el conjunto). Si se van a borrar acciones guardadas,
//    se pregunta antes (`perdues()`). Si está completo lo dice el SERVIDOR; `faltenLocal()` solo
//    señala lo pendiente mientras se escribe.
//
// El estado de los bloques vive en `base` (lo editado) y lo que se enseña es
// `sincronitzaPrincipals(base, principals)`: desmarcar un principal y volverlo a marcar sin
// guardar no pierde lo tecleado.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { refrescaAvisos } from '../lib/refrescAvisos'
import { textError } from '../lib/textError'
import { dataCurta } from '../lib/format'
import { estilEstatDiagnostic, idSeccio } from '../lib/diagnostic'
import { causesDiagnostic, desarExcedentsDiagnostic, diagnosticDatos } from '../lib/diagnosticApi'
import { blocsExcedents } from '../lib/excedentsLlegible'
import {
  blocsAEdicio, faltenLocal, llistaTextos, payloadExcedents, perdues, posaAccio, posaCampCausa, posaCauses,
  posaDestins, posaGestio, posaObservacions, posaSenseExcedent, seccionsDiagnostic, sincronitzaPrincipals,
  textFalta, treuBloc, type EstatExcedents,
} from '../lib/excedentsDiagnostic'
import type { CausaCataleg, DiagnosticDatos, EstatDiagnostic } from '../types'
import NavSeccionsDiagnostic from './diagnostic/NavSeccionsDiagnostic'
import { useOperativaDiagnostic } from './diagnostic/useOperativaDiagnostic'
import BlocExcedentsProducte from './diagnostic/BlocExcedentsProducte'
import AccionsDiagnostic from './diagnostic/AccionsDiagnostic'
import { useConfirma } from './DialegConfirma'
import BlocCamps from './fitxa/BlocCamps'
import LlocsRecollida from './LlocsRecollida'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface Props {
  /** El productor (`productores.id`). Desde A1 el diagnóstico es solo de productores. */
  orgId: string
  /** `true` = lo conduce el equipo con la persona delante (modelo asistido): lo dice arriba. */
  assistit?: boolean
  /** Se llama después de cada guardado, para que la pantalla refresque lo que enseñe. */
  onDesat?: (r: { complet: boolean }) => void | Promise<void>
}

export default function FormulariDiagnostic({ orgId, assistit = false, onDesat }: Props) {
  const { t, lang } = useT()
  const { confirma, dialeg } = useConfirma()
  const operativa = useOperativaDiagnostic(orgId)
  const [dades, setDades] = useState<DiagnosticDatos | null>(null)
  const [base, setBase] = useState<EstatExcedents>([])
  const [notes, setNotes] = useState('')
  const [cataleg, setCataleg] = useState<CausaCataleg[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [desant, setDesant] = useState(false)

  const carrega = useCallback(async () => {
    const r = await diagnosticDatos('productor', orgId)
    // Sin poder leer lo guardado no se abre el formulario: guardarlo vacío pisaría la fila.
    if (!r.ok) { setError(r.missatge); setCarregant(false); return }
    setError(null)
    setDades(r.data)
    setBase(blocsAEdicio(blocsExcedents(r.data.excedents)))
    setNotes(r.data.notes ?? '')
    setCarregant(false)
  }, [orgId])

  useEffect(() => { void carrega() }, [carrega])
  useEffect(() => {
    void causesDiagnostic().then((r) => { if (r.ok) setCataleg(r.data) })
  }, [])

  // Los principales y los habituales VIVOS (lo marcado en la Operativa, aunque no se haya guardado).
  const principalsBrut = operativa.valors.productes_principals
  const habitualsBrut = operativa.valors.productos_habituales
  const principals = useMemo(() => llistaTextos(principalsBrut), [principalsBrut])
  const habituals = useMemo(() => llistaTextos(habitualsBrut), [habitualsBrut])
  const blocs = useMemo(() => sincronitzaPrincipals(base, principals), [base, principals])
  const persistits = useMemo(() => blocsExcedents(dades?.excedents), [dades])

  // Los lugares se guardan al momento en su componente: si hay un principal con días o franjas lo
  // dice el servidor (se refresca al guardar).
  const llocOk = !(dades?.falten ?? []).includes('operativa_lloc')
  const falten = useMemo(
    () => faltenLocal(blocs, { habituals, principals, llocOk }), [blocs, habituals, principals, llocOk])
  const nAccions = persistits.reduce((n, b) => n + b.causes.reduce((m, c) => m + c.accions.length, 0), 0)
  const seccions = useMemo(() => seccionsDiagnostic(falten, {
    operativa: { n: operativa.camps.length, contestades: operativa.contestades },
    principals: principals.length,
    accions: nAccions,
  }), [falten, operativa.camps.length, operativa.contestades, principals.length, nAccions])

  const nomCausa = useCallback((codi: string) => {
    const c = cataleg.find((x) => x.codigo === codi)
    return c ? (lang === 'es' ? c.nombre_es || c.nombre : c.nombre) : codi
  }, [cataleg, lang])

  async function desa() {
    if (desant) return
    const payload = payloadExcedents(blocs)
    const n = perdues(persistits, payload)
    if (n > 0 && !(await confirma({
      titol: t('dexc.perdues_t', { n }),
      descripcio: t('dexc.perdues_d'),
      confirmar: t('dexc.perdues_ok'),
      destructiu: true,
    }))) return
    setDesant(true)
    // Primero la Operativa (columnas de la ficha): si la base la rechaza, no se guarda nada más
    // y lo tecleado sigue en pantalla. Un principal nuevo tiene que estar en la ficha ANTES de
    // guardar su bloque (`producte_fora_principals`).
    const op = await operativa.desa()
    if (!op.ok) { setDesant(false); toast.error(textError(t, op.missatge)); return }
    // ⚠️ Las notas viajan SIEMPRE con su valor actual: `null` las borra.
    const r = await desarExcedentsDiagnostic(orgId, payload, notes.trim() === '' ? null : notes.trim(), lang)
    setDesant(false)
    if (!r.ok) { toast.error(textError(t, r)); return }

    if (r.data.complet) toast.success(t('diag.saved_complete'))
    else toast.success(t('diag.saved_partial', { n: r.data.falten.length }))
    // La banda de la Operativa vive en AppShell y no se enteraría sola (refrescAvisos.ts).
    refrescaAvisos()
    // Se recarga SIEMPRE: el estado que manda es el que calcula el servidor.
    await carrega()
    await onDesat?.({ complet: r.data.complet })
  }

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  // Se traduce al pintar, no al guardar: meter `t` en la carga la relanzaría al cambiar de idioma.
  if (error || !dades) return <p className="text-sm text-destructive">{textError(t, error ?? 'diag.err_generic')}</p>

  // El estado lo dice el servidor (lo GUARDADO), no lo que hay tecleado sin guardar.
  const estatServidor: EstatDiagnostic = !dades.diagnostic_id ? 'sense_comencar' : dades.complet ? 'complet' : 'incomplet'
  const principalsBlocs = blocs.filter((b) => b.principal)
  const conservats = blocs.filter((b) => !b.principal)
  const canvia = (fn: (e: EstatExcedents) => EstatExcedents) => setBase((b) => fn(b))
  const indexDe = (producte: string) => blocs.findIndex((b) => b.producte === producte)
  const faltenDe = (producte: string) =>
    falten.filter((f) => f === `excedents:${producte}` || f.startsWith(`dades:${producte}:`))

  const bloc = (b: (typeof blocs)[number]) => (
    <BlocExcedentsProducte
      key={b.producte}
      bloc={b}
      index={indexDe(b.producte)}
      cataleg={cataleg}
      falten={faltenDe(b.producte)}
      onSenseExcedent={(v) => canvia((e) => posaSenseExcedent(e, b.producte, v))}
      onCauses={(codis) => canvia((e) => posaCauses(e, b.producte, codis, cataleg))}
      onCamp={(causa, camp, valor) => canvia((e) => posaCampCausa(e, b.producte, causa, camp, valor))}
      onGestio={(causa, g) => canvia((e) => posaGestio(e, b.producte, causa, g))}
      onDestins={(causa, d) => canvia((e) => posaDestins(e, b.producte, causa, d))}
      onAccio={(causa, desti, text) => canvia((e) => posaAccio(e, b.producte, causa, desti, text))}
      onObservacions={(text) => canvia((e) => posaObservacions(e, b.producte, text))}
      onTreu={b.principal ? undefined : () => canvia((e) => treuBloc(e, b.producte))}
    />
  )

  return (
    <div className="space-y-4" data-testid="formulari-diagnostic">
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>{t('diagd.title')}</span>
            <Badge className={estilEstatDiagnostic(estatServidor)} data-testid="estat-diagnostic">
              {t(`diag.st_${estatServidor}`)}
            </Badge>
          </CardTitle>
          {dades.actualitzat_at && (
            <p className="text-sm text-muted-foreground">
              {dades.actualitzat_per_nom
                ? t('diag.actualitzat_per', { data: dataCurta(dades.actualitzat_at), nom: dades.actualitzat_per_nom })
                : t('diag.actualitzat', { data: dataCurta(dades.actualitzat_at) })}
            </p>
          )}
        </CardHeader>
        {assistit && (
          <CardContent>
            <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
              {t('diag.assisted_hint')}
            </p>
          </CardContent>
        )}
      </Card>

      {/* Los chips, pegados arriba mientras se baja: dejan saltar a una sección sin recorrer la página. */}
      <div className="sticky top-0 z-10 bg-background/95 py-2 backdrop-blur">
        <NavSeccionsDiagnostic seccions={seccions} />
      </div>

      {/* 1 · La Operativa de la ficha (A4). */}
      <Card className="scroll-mt-24" data-testid="diag-operativa">
        <CardHeader>
          <CardTitle id={idSeccio('operativa')} tabIndex={-1} className="scroll-mt-24 text-base outline-none">
            {t('diag.sec_operativa')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('diag.operativa_hint')}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {operativa.error
            ? <p className="text-sm text-destructive">{textError(t, operativa.error)}</p>
            : (
              <BlocCamps camps={operativa.camps} valors={operativa.valors} onChange={operativa.onChange}
                veu="equip" potEditar idPrefix="diag-op" activitats={operativa.activitats} />
            )}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('diag.operativa_llocs')}</p>
            <LlocsRecollida productorId={orgId} idPrefix="diag-lloc" />
          </div>
        </CardContent>
      </Card>

      {/* 2 · Los excedentes por producto principal × causa (A3). */}
      <Card className="scroll-mt-24" data-testid="diag-excedents">
        <CardHeader>
          <CardTitle id={idSeccio('excedents')} tabIndex={-1} className="scroll-mt-24 text-base outline-none">
            {t('dexc.titol')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('dexc.hint')}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {principalsBlocs.length === 0
            ? <p className="text-sm text-aviso" data-testid="exc-sense-principals">{t('dexc.sense_principals')}</p>
            : principalsBlocs.map(bloc)}

          {conservats.length > 0 && (
            <div className="space-y-4 rounded-lg border border-dashed border-border p-3" data-testid="exc-conservats">
              <div>
                <p className="text-sm font-semibold">{t('dexc.conservats_t')}</p>
                <p className="text-sm text-muted-foreground">{t('dexc.conservats_hint')}</p>
              </div>
              {conservats.map(bloc)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3 · Las acciones guardadas, con su estado y su nota al momento. */}
      <Card className="scroll-mt-24" data-testid="diag-accions">
        <CardHeader>
          <CardTitle id={idSeccio('accions')} tabIndex={-1} className="scroll-mt-24 text-base outline-none">
            {t('dexc.accions')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('dexc.accions_hint')}</p>
        </CardHeader>
        <CardContent>
          <AccionsDiagnostic productorId={orgId} editable excedents={dades.excedents ?? null} />
        </CardContent>
      </Card>

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
            <div className="space-y-1" data-testid="diag-falten">
              <p className="text-sm text-aviso">{t('diag.missing', { n: falten.length })}</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {falten.map((f) => <li key={f} className="break-words">{textFalta(f, t, nomCausa)}</li>)}
              </ul>
            </div>
          )}

          {/* UN botón, y NUNCA gris por faltar algo: guardar a medias es lo que esta pantalla
              tiene que permitir. Si queda completo lo dice el servidor. */}
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
      {dialeg}
    </div>
  )
}
