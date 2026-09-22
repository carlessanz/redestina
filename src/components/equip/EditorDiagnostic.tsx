// El cuestionario, las medidas y las reglas, desde Configuració.
//
// POR QUÉ ES UN EDITOR MÍNIMO Y NO UN CONSTRUCTOR DE FORMULARIOS. Lo que se edita aquí es
// **texto que redacta la Fundación** y una matriz de reglas de negocio; las dos cosas viven
// en la base justamente para que cambiarlas no sea un despliegue (20260921231946,
// 20260921231947). Lo que hace falta desde la aplicación es poder **publicar la versión
// siguiente** y **retirar** una medida o una regla; inventar aquí un editor visual de doce
// preguntas con sus opciones bilingües sería construir la mitad de un CMS para un contenido
// que va a cambiar dos veces en cinco años.
//
// 🔴 UN CUESTIONARIO NO SE EDITA: SE PUBLICA LA VERSIÓN SIGUIENTE. Lo impide un trigger en
//    cuanto un plan lo cita, y es lo correcto — hay que poder responder con qué cuestionario
//    EXACTO se hizo un diagnóstico de hace cinco años. Así que el botón dice «Publica la
//    versió següent» y no «Desa».
//
// 🔴 Y SE COMPRUEBA ANTES DE PUBLICAR, con la misma función que sostiene el CHECK de la
//    tabla (`questionari_problemes`). No hay una segunda definición de «cuestionario
//    válido» en TypeScript: el CHECK solo sabe decir `23514`, y un `23514` sobre un jsonb de
//    doce preguntas no dice cuál está mal.
//
// ⚠️ UN `tecnic` LO VE EN GRIS CON SU MOTIVO, no se le esconde. Es el criterio del proyecto
//    (§6ter, el mismo «Només admin» de Aprovacions y de `DadesFundacio`): un control apagado
//    con su porqué informa; un control ausente hace pensar que la función no existe.
//
// ⚠️ UNA MEDIDA NO SE BORRA, SE RETIRA (`activa = false`). Un plan emitido cita su código, y
//    un código que desaparece convierte ese plan en un documento que habla de algo que ya no
//    existe. Por eso las tablas no tienen GRANT de DELETE y aquí solo hay un interruptor.

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { Casella } from '../Casella'
import TriaPaper from '../TriaPaper'
import { textBilingue } from '../../lib/diagnostic'
import {
  activarMesura, activarRegla, mesuresCataleg, problemesQuestionari,
  publicarQuestionari, questionarisDelTipus, reglesCataleg,
} from '../../lib/diagnosticApi'
import type { TipusOrg } from '../../lib/diagnosticApi'
import type { MesuraPrevencio, QuestionariDiagnostic, ReglaPla } from '../../types'
import { cn } from '../../lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Los dos cuestionarios. Fuera del render: un array nuevo en cada pasada remontaría el conmutador. */
const PAPERS: readonly TipusOrg[] = ['productor', 'entidad']

export default function EditorDiagnostic() {
  const { t, lang } = useT()
  const { ctx } = useAppContext()
  const potEditar = ctx?.potAprovar === true

  const [tipus, setTipus] = useState<TipusOrg>('productor')
  const [questionaris, setQuestionaris] = useState<QuestionariDiagnostic[]>([])
  const [mesures, setMesures] = useState<MesuraPrevencio[]>([])
  const [regles, setRegles] = useState<ReglaPla[]>([])
  const [esborrany, setEsborrany] = useState('')
  const [problemes, setProblemes] = useState<string[] | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [ocupat, setOcupat] = useState<null | 'comprovar' | 'publicar'>(null)

  const carrega = useCallback(async () => {
    setCarregant(true)
    const [q, m, r] = await Promise.all([
      questionarisDelTipus(tipus), mesuresCataleg(tipus), reglesCataleg(tipus),
    ])
    setQuestionaris(q.ok ? q.data : [])
    setMesures(m.ok ? m.data : [])
    setRegles(r.ok ? r.data : [])
    // El borrador arranca con el cuestionario vigente: lo normal es retocar el que hay, no
    // escribir doce preguntas desde cero en un textarea.
    const vigent = (q.ok ? q.data : []).find((x) => x.vigente) ?? null
    setEsborrany(vigent ? JSON.stringify(vigent.preguntes, null, 2) : '[]')
    setProblemes(null)
    setCarregant(false)
  }, [tipus])

  useEffect(() => { void carrega() }, [carrega])

  const vigent = questionaris.find((q) => q.vigente) ?? null

  /** El JSON tecleado, o `null` si no es JSON. Sin excepciones hacia fuera. */
  function preguntesDelText(): unknown[] | null {
    try {
      const v: unknown = JSON.parse(esborrany)
      return Array.isArray(v) ? v : null
    } catch {
      return null
    }
  }

  async function comprova() {
    const preguntes = preguntesDelText()
    if (!preguntes) { setProblemes([t('cfgd.bad_json')]); return }
    setOcupat('comprovar')
    const r = await problemesQuestionari(preguntes)
    setOcupat(null)
    if (!r.ok) { toast.error(r.missatge); return }
    setProblemes(r.data ?? [])
    if ((r.data ?? []).length === 0) toast.success(t('cfgd.check_ok'))
  }

  async function publica() {
    if (!potEditar || !vigent) return
    const preguntes = preguntesDelText()
    if (!preguntes) { setProblemes([t('cfgd.bad_json')]); return }
    setOcupat('publicar')
    const r = await publicarQuestionari(tipus, vigent.titol, preguntes, vigent.provisional, true)
    setOcupat(null)
    if (!r.ok) { toast.error(r.missatge); return }

    toast.success(t('cfgd.published', { v: r.data.versio }))
    // Las reglas huérfanas NO bloquean la publicación, pero quien publica tiene que verlas:
    // una regla que apunta a una pregunta que ya no existe no dispara, y el plan siguiente
    // saldría con menos medidas sin que nadie supiera por qué.
    const orfes = r.data.regles_orfes ?? []
    if (orfes.length > 0) {
      toast.warning(t('cfgd.orphan_rules', {
        n: orfes.length,
        preguntes: [...new Set(orfes.map((o) => o.pregunta))].join(', '),
      }))
    }
    await carrega()
  }

  /** Un rechazo por RLS llega como la CLAVE `cfgd.denied`, no como una frase de la base:
   *  ahí no hay mensaje que enseñar, porque PostgREST responde éxito con cero filas. */
  function avisa(missatge: string) {
    toast.error(missatge === 'cfgd.denied' ? t('cfgd.denied') : missatge)
  }

  async function canviaMesura(codi: string, activa: boolean) {
    const r = await activarMesura(codi, activa)
    if (!r.ok) { avisa(r.missatge); return }
    setMesures((l) => l.map((m) => (m.codi === codi ? { ...m, activa } : m)))
  }

  async function canviaRegla(id: string, activa: boolean) {
    const r = await activarRegla(id, activa)
    if (!r.ok) { avisa(r.missatge); return }
    setRegles((l) => l.map((x) => (x.id === id ? { ...x, activa } : x)))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('cfgd.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('cfgd.subtitle')}</p>
        {!potEditar && (
          <p className="mt-1 text-sm text-aviso">{t('cfgd.only_admin')}</p>
        )}
      </CardHeader>

      <CardContent className={cn('space-y-6', !potEditar && 'opacity-60')}>
        {/* Los dos cuestionarios son distintos de verdad: lo que se le pregunta a quien
            genera producto y a quien lo recibe no se parece en nada. */}
        <TriaPaper opcions={PAPERS} actiu={tipus} onTria={setTipus} />

        {carregant ? (
          <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
        ) : !vigent ? (
          <p className="text-sm text-muted-foreground">{t('cfgd.no_current')}</p>
        ) : (
          <>
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-titulos text-sm font-semibold">
                  {textBilingue(vigent.titol, lang)}
                </h3>
                <Badge variant="outline">{t('cfgd.version', { v: vigent.versio })}</Badge>
                {vigent.provisional && (
                  <Badge className="bg-aviso-fondo text-aviso">{t('diag.provisional_badge')}</Badge>
                )}
                <span className="text-sm text-muted-foreground">
                  {t('cfgd.questions', { n: vigent.preguntes.length })}
                </span>
              </div>

              <div>
                <Label htmlFor="cfgd-json" className="mb-1.5 block text-xs text-muted-foreground">
                  {t('cfgd.json_label')}
                </Label>
                <Textarea
                  id="cfgd-json"
                  rows={14}
                  spellCheck={false}
                  disabled={!potEditar}
                  value={esborrany}
                  onChange={(e) => { setEsborrany(e.target.value); setProblemes(null) }}
                  className="font-mono text-base md:text-xs"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('cfgd.json_help')}</p>
              </div>

              {problemes !== null && (
                problemes.length === 0
                  ? <p className="text-sm text-exito">{t('cfgd.check_ok')}</p>
                  : (
                    <ul className="space-y-1 rounded-lg border border-error bg-error-fondo p-3 text-sm text-error">
                      {problemes.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  )
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => void comprova()}
                  disabled={!potEditar || ocupat !== null}
                  className="min-h-11 whitespace-normal md:min-h-9"
                >
                  {ocupat === 'comprovar' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {t('cfgd.check')}
                </Button>
                <Button
                  onClick={() => void publica()}
                  disabled={!potEditar || ocupat !== null}
                  className="min-h-11 whitespace-normal md:min-h-9"
                >
                  {ocupat === 'publicar' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {t('cfgd.publish')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('cfgd.publish_help')}</p>
            </section>

            <section className="space-y-2 border-t border-border pt-6">
              <h3 className="font-titulos text-sm font-semibold">{t('cfgd.measures_t')}</h3>
              <p className="text-xs text-muted-foreground">{t('cfgd.measures_help')}</p>
              <ul className="space-y-1">
                {mesures.map((m) => (
                  <li key={m.codi} className="flex min-h-11 items-start gap-3 text-sm">
                    <Casella
                      checked={m.activa}
                      disabled={!potEditar}
                      aria-label={textBilingue(m.titol, lang)}
                      className="mt-0.5"
                      onChange={(v) => void canviaMesura(m.codi, v)}
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{textBilingue(m.titol, lang)}</span>{' '}
                      <span className="text-muted-foreground">
                        · {t(`diag.bloc_${m.bloc}`)} · <code>{m.codi}</code>
                      </span>
                      {m.obligatoria_per_defecte && (
                        <Badge className="ml-2 bg-aviso-fondo text-aviso">{t('pla.required')}</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-2 border-t border-border pt-6">
              <h3 className="font-titulos text-sm font-semibold">{t('cfgd.rules_t')}</h3>
              <p className="text-xs text-muted-foreground">{t('cfgd.rules_help')}</p>
              <ul className="space-y-1">
                {regles.map((r) => (
                  <li key={r.id} className="flex min-h-11 items-start gap-3 text-sm">
                    <Casella
                      checked={r.activa}
                      disabled={!potEditar}
                      aria-label={r.mesura_codi}
                      className="mt-0.5"
                      onChange={(v) => void canviaRegla(r.id, v)}
                    />
                    <span className="min-w-0 font-mono text-xs">
                      {r.pregunta_id ?? t('cfgd.always')} {r.operador}{' '}
                      {r.valor === null || r.valor === undefined ? '' : JSON.stringify(r.valor)}
                      {' → '}
                      {r.mesura_codi}
                      {r.obligatoria && ' *'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  )
}
