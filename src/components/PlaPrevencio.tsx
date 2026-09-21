// El plan de prevención: las medidas que salen del diagnóstico, y su PDF.
//
// Uno solo para el panel de la organización y para la ficha del equipo; lo que cambia es
// `potEditar`, que es lo que abre el ajuste a mano. La organización VE su plan entero
// —incluidas las medidas que le han tocado y por qué son obligatorias— y no lo toca: quitar
// una recomendación es una decisión técnica de quien ha hecho el diagnóstico con ella.
//
// 🔴 REGENERAR PIDE CONFIRMACIÓN CUANDO LA LISTA SE HA TOCADO. La base responde
//    `22023 mesures_editades` y eso no es un estorbo que haya que sortear con `forcar: true`
//    por defecto: detrás de esa edición está el criterio de quien estuvo delante de la
//    persona, y descartarlo en silencio no se nota hasta que alguien lee el PDF. Así que se
//    intenta sin forzar, y **solo si la base se niega** se pregunta.
//
// ⚠️ LAS MEDIDAS SE PINTAN DESDE `mesures.llista`, que lleva el título y la descripción
//    COPIADOS y ya resueltos al idioma del plan. No se cruza con `mesures_prevencio`: ese
//    catálogo es del equipo (RLS `es_intern()`), así que una organización no podría leerlo
//    — y aunque pudiera, un plan de hace cinco años no puede depender de que la redacción
//    del catálogo no haya cambiado (20260921231948).
//
// ⚠️ EL PDF SE ESPERA POR POLLING, no por Realtime, y de eso ya se encarga
//    `useDescarregaDocument`: pide la URL firmada, y si el servidor contesta que todavía no
//    hay fichero, espera (2 s durante 30 s) y reintenta una vez.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileText, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { useConfirma } from './DialegConfirma'
import { useDescarregaDocument } from '../hooks/useDescarregaDocument'
import { Casella } from './Casella'
import { mesuresPerBloc } from '../lib/diagnostic'
import {
  desarMesuresPla, documentDelPla, emetrePla, esMesuresEditades, fixarNivellPla,
  generarPla, plaEsborrany, plaPerId,
} from '../lib/diagnosticApi'
import type { TipusOrg } from '../lib/diagnosticApi'
import type { MesuraPla, PlanPrevencion } from '../types'
import { cn } from '../lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export interface Props {
  tipusOrg: TipusOrg
  orgId: string
  /** El equipo ajusta la lista y fija el nivel; la organización solo lee y emite. */
  potEditar?: boolean
  /** El plan ya emitido, si lo hay: se enseña debajo del borrador. */
  plaVigentId?: string | null
  /** Tras emitir o regenerar, para que la pantalla refresque su estado. */
  onCanvi?: () => void | Promise<void>
}

export default function PlaPrevencio({
  tipusOrg, orgId, potEditar = false, plaVigentId = null, onCanvi,
}: Props) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const descarregador = useDescarregaDocument()

  const [pla, setPla] = useState<PlanPrevencion | null>(null)
  const [vigent, setVigent] = useState<PlanPrevencion | null>(null)
  const [docVigent, setDocVigent] = useState<string | null>(null)
  const [observacions, setObservacions] = useState('')
  const [tretes, setTretes] = useState<Set<string>>(new Set())
  const [carregant, setCarregant] = useState(true)
  const [ocupat, setOcupat] = useState<null | 'generar' | 'emetre' | 'desar' | 'nivell'>(null)

  const carrega = useCallback(async () => {
    setCarregant(true)
    const [esb, vig] = await Promise.all([
      plaEsborrany(tipusOrg, orgId),
      plaVigentId ? plaPerId(plaVigentId) : Promise.resolve({ ok: true as const, data: null }),
    ])
    const p = esb.ok ? esb.data : null
    setPla(p)
    setObservacions(typeof p?.mesures?.observacions === 'string' ? p.mesures.observacions : '')
    setTretes(new Set())

    const v = vig.ok ? vig.data : null
    setVigent(v)
    if (v) {
      const d = await documentDelPla(v.id)
      setDocVigent(d.ok ? d.data?.id ?? null : null)
    } else {
      setDocVigent(null)
    }
    setCarregant(false)
  }, [tipusOrg, orgId, plaVigentId])

  useEffect(() => { void carrega() }, [carrega])

  const llista: MesuraPla[] = useMemo(() => pla?.mesures?.llista ?? [], [pla])
  const grups = useMemo(() => mesuresPerBloc(llista), [llista])
  const editat = pla?.mesures?.editat === true
  const obligatories = llista.filter((m) => m.obligatoria).length

  async function regenera() {
    if (ocupat) return
    setOcupat('generar')
    let r = await generarPla(tipusOrg, orgId, false)

    // Solo se pregunta cuando la base se niega. Preguntar siempre —o forzar siempre—
    // convertiría el aviso en un trámite que nadie lee.
    if (!r.ok && esMesuresEditades(r)) {
      setOcupat(null)
      const segur = await confirma({
        titol: t('pla.regen_confirm_t'),
        descripcio: t('pla.regen_confirm'),
        confirmar: t('pla.regen_confirm_btn'),
      })
      if (!segur) return
      setOcupat('generar')
      r = await generarPla(tipusOrg, orgId, true)
    }

    setOcupat(null)
    if (!r.ok) { toast.error(r.missatge); return }
    toast.success(t('pla.regenerated', { n: r.data.mesures_n }))
    await carrega()
    await onCanvi?.()
  }

  async function desaAjust() {
    if (!pla || ocupat) return
    setOcupat('desar')
    const seg = llista.filter((m) => !tretes.has(m.codi))
    const r = await desarMesuresPla(pla.id, seg, observacions.trim() === '' ? null : observacions.trim())
    setOcupat(null)
    if (!r.ok) { toast.error(r.missatge); return }
    toast.success(t('pla.adjusted', { n: r.data.mesures_n }))
    await carrega()
    await onCanvi?.()
  }

  async function canviaNivell(nivell: 'basic' | 'personalitzat') {
    if (!pla || ocupat) return
    setOcupat('nivell')
    const r = await fixarNivellPla(pla.id, nivell)
    setOcupat(null)
    if (!r.ok) { toast.error(r.missatge); return }
    await carrega()
  }

  async function emet() {
    if (!pla || ocupat) return
    const segur = await confirma({
      titol: t('pla.emit_confirm_t'),
      descripcio: t('pla.emit_confirm'),
      confirmar: t('pla.emit_confirm_btn'),
    })
    if (!segur) return

    setOcupat('emetre')
    const r = await emetrePla(pla.id)
    setOcupat(null)
    if (!r.ok) { toast.error(r.missatge); return }
    toast.success(t('pla.emitted', { numero: r.data.numero ?? '—' }))
    // El PDF lo genera una Edge Function que el trigger acaba de encolar, así que lo normal
    // es que todavía no exista: `mostra()` espera y reintenta sola.
    await descarregador.mostra(r.data.document)
    await carrega()
    await onCanvi?.()
  }

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  const hiHaCanvis = tretes.size > 0
    || observacions.trim() !== (typeof pla?.mesures?.observacions === 'string' ? pla.mesures.observacions : '')

  return (
    <div className="space-y-4">
      {/* ── El plan vigente, si ya se emitió uno ── */}
      {vigent && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">{t('pla.current_t')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('pla.current_desc', {
                  numero: vigent.numero_completo ?? '—',
                  versio: vigent.version,
                })}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={!docVigent || descarregador.ocupat !== null}
              onClick={() => { if (docVigent) void descarregador.mostra(docVigent) }}
              className="h-11 shrink-0 whitespace-normal md:h-9"
            >
              {descarregador.generant === docVigent
                ? <Loader2 className="size-4 animate-spin" aria-hidden />
                : <FileText className="size-4" aria-hidden />}
              {t('pla.view_pdf')}
            </Button>
          </CardHeader>
        </Card>
      )}

      {/* ── El borrador ── */}
      {!pla ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('pla.none_t')}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('pla.none')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="text-base">{t('pla.draft_t')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('pla.count', { n: llista.length, o: obligatories })}
            </p>
            {editat && (
              <p className="text-xs text-muted-foreground">{t('pla.edited_note')}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            {llista.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('pla.empty')}</p>
            ) : (
              grups.map((g) => (
                <section key={g.bloc} className="space-y-2">
                  <h3 className="font-titulos text-sm font-semibold">{t(g.clau)}</h3>
                  <ul className="space-y-2">
                    {g.mesures.map((m) => {
                      const treta = tretes.has(m.codi)
                      return (
                        <li
                          key={m.codi}
                          className={cn(
                            'rounded-lg border p-3',
                            treta && 'border-dashed opacity-50',
                          )}
                        >
                          <div className="flex items-start gap-3">
                            {/* Quitar una medida es del equipo. Las obligatorias no llevan
                                casilla: la base rechaza la lista que las pierda
                                (`22023 falten_obligatories`), así que ofrecer el control
                                sería ofrecer un botón que va a fallar. */}
                            {potEditar && !m.obligatoria && (
                              <Casella
                                checked={!treta}
                                aria-label={m.titol}
                                className="mt-0.5"
                                onChange={(v) => setTretes((s) => {
                                  const seg = new Set(s)
                                  if (v) seg.delete(m.codi)
                                  else seg.add(m.codi)
                                  return seg
                                })}
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{m.titol}</span>
                                <Badge
                                  className={m.obligatoria
                                    ? 'bg-aviso-fondo text-aviso'
                                    : 'bg-secondary text-secondary-foreground'}
                                >
                                  {t(m.obligatoria ? 'pla.required' : 'pla.recommended')}
                                </Badge>
                                {m.origen === 'manual' && (
                                  <Badge variant="outline">{t('pla.manual')}</Badge>
                                )}
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{m.descripcio}</p>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))
            )}

            {/* Las observaciones se imprimen en el plan, así que solo las escribe quien lo
                firma con el sello de la Fundación. La organización las lee. */}
            {(potEditar || observacions.trim() !== '') && (
              <div>
                <Label htmlFor="pla-obs" className="mb-1.5 block text-xs text-muted-foreground">
                  {t('pla.notes_label')}
                </Label>
                {potEditar ? (
                  <Textarea
                    id="pla-obs"
                    rows={3}
                    value={observacions}
                    onChange={(e) => setObservacions(e.target.value)}
                    placeholder={t('pla.notes_ph')}
                  />
                ) : (
                  <p className="text-sm whitespace-pre-line">{observacions}</p>
                )}
              </div>
            )}

            {potEditar && (
              <div className="max-w-xs">
                <Label htmlFor="pla-nivell" className="mb-1.5 block text-xs text-muted-foreground">
                  {t('pla.level_label')}
                </Label>
                <Select
                  value={pla.nivel}
                  disabled={ocupat !== null}
                  onValueChange={(v) => void canviaNivell(v as 'basic' | 'personalitzat')}
                >
                  <SelectTrigger id="pla-nivell" className="w-full text-base md:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic" className="text-base md:text-sm">
                      {t('pla.level_basic')}
                    </SelectItem>
                    <SelectItem value="personalitzat" className="text-base md:text-sm">
                      {t('pla.level_custom')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">{t('pla.level_help')}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void emet()}
                disabled={ocupat !== null || llista.length === 0}
                className="min-h-11 whitespace-normal"
              >
                {ocupat === 'emetre' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('pla.emit')}
              </Button>

              {potEditar && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void desaAjust()}
                    disabled={ocupat !== null || !hiHaCanvis}
                    className="min-h-11 whitespace-normal"
                  >
                    {ocupat === 'desar' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {t('pla.save_adjust')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void regenera()}
                    disabled={ocupat !== null}
                    className="min-h-11 whitespace-normal"
                  >
                    {ocupat === 'generar'
                      ? <Loader2 className="size-4 animate-spin" aria-hidden />
                      : <RefreshCw className="size-4" aria-hidden />}
                    {t('pla.regenerate')}
                  </Button>
                </>
              )}
            </div>

            {/* El motivo, visible y no solo en un tooltip: en táctil no hay hover. */}
            {llista.length === 0 && (
              <p className="flex items-start gap-2 text-sm text-aviso">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t('pla.why_cannot_emit')}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {descarregador.visor}
      {dialeg}
    </div>
  )
}
