// Los intereses de la entidad receptora y su histórico.
//
// Son las mismas filas de `oferta_respuestas` y `canalizaciones` que gestiona el
// equipo, filtradas por RLS a las de su organización: el receptor ve el estado real de
// su solicitud, incluida la decisión del equipo, sin que haya que replicar nada.
//
// ⚠️ UN SOLO BADGE, Y NO DOS. Hasta hoy cada fila pintaba a la vez lo que dijo la entidad
// (`od.rs_*`) y lo que decidió el equipo (`od.ap_*`): dos ejes que solo se entienden si ya
// te sabes el modelo de datos, y «Acceptada + Per aprovar» a la vez se lee como una
// contradicción. Ahora los dos ejes —más el albarán de entrega, que es quien cuenta el
// final— los resuelve `puntInteres()` en UNA etapa, y debajo va qué toca hacer. La
// traducción de estados a frases vive en `procesOferta.ts` y la comparten los tres paneles.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { estatSimpleInteres, llegendaSimpleInteres, puntInteres } from '../../lib/procesOferta'
import { dataCurta } from '../../lib/albarans'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { EstadoAlbaran, Excedente, OfertaRespuesta } from '../../types'
import LlegendaEstats from '../../components/proces/LlegendaEstats'
import BadgeEstat from '../../components/proces/BadgeEstat'
import { FotoOfertaResolta, useFotosOfertes } from '../../components/FotosOferta'
import CarregantSeccio from '../../components/CarregantSeccio'
import DetallOfertaReceptor, { kgFmt } from '../../components/DetallOfertaReceptor'
import { Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

// La oferta entera (`excedentes(*)`): la tarjeta abre su detalle (28-09-2026), y el detalle
// es el mismo del Mercat.
type AmbOferta = OfertaRespuesta & { excedentes: Excedente | null }

/** Lo único que hace falta del albarán de entrega para contar la etapa. */
type AlbaraEnt = Pick<AlbaranBandeja, 'id' | 'numero_completo' | 'estado' | 'canalizacion_id'>

interface CanalAmbOferta {
  id: string
  kg_confirmados: number | null
  kg_reales: number | null
  data_hora_recollida: string | null
  created_at: string
  // La oferta entera: la fila abre su detalle, el mismo del Mercat (28-09-2026).
  excedentes: Excedente | null
}

/** «23/09»: en una píldora el año sobra, y la lista va del más reciente al más antiguo. */
function dataCurtaSenseAny(iso: string | null | undefined): string | null {
  if (!iso) return null
  // Montada a mano: con `toLocaleDateString` algunos navegadores ignoran el `2-digit` del
  // mes en esta combinación y pintan «21/9».
  const parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Madrid' })
    .formatToParts(new Date(iso))
  const v = (tipus: string) => parts.find((p) => p.type === tipus)?.value ?? ''
  return `${v('day').padStart(2, '0')}/${v('month').padStart(2, '0')}`
}

/** Un albarán anulado o rectificado no cuenta: la entrega vuelve a estar donde estaba. */
const ALBARA_VIU: EstadoAlbaran[] = ['emitido', 'entregado', 'confirmado', 'conciliado']

export function Interessos() {
  const { t } = useT()
  const organitzacio = useOrganitzacio('entidad')
  const [files, setFiles] = useState<AmbOferta[]>([])
  const [albarans, setAlbarans] = useState<Record<string, AlbaraEnt>>({})
  const [carregant, setCarregant] = useState(true)
  const [obert, setObert] = useState<AmbOferta | null>(null)
  const entidadId = organitzacio?.id ?? null

  const carrega = useCallback(async () => {
    if (!entidadId) { setCarregant(false); return }
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    // `ENT` y `R-ENT`: una entrega rectificada sigue siendo la entrega de ese interés, y
    // mirar solo el original dejaría la etapa colgada en «Assignada» para siempre.
    const [resp, alb] = await Promise.all([
      supabase
        .from('oferta_respuestas')
        .select('*, excedentes(*)')
        .eq('entidad_id', entidadId)
        .order('enviado_at', { ascending: false }),
      supabase
        .from('v_albaranes_bandeja')
        .select('id, numero_completo, estado, canalizacion_id')
        .in('tipo', ['ENT', 'R-ENT']),
    ])

    // El interés aprobado y su albarán de entrega comparten `canalizacion_id`: es lo único
    // que los une, porque el albarán cuelga de la canalización y no de la respuesta.
    const per: Record<string, AlbaraEnt> = {}
    for (const a of ((alb.data as AlbaraEnt[] | null) ?? [])) {
      if (!a.canalizacion_id) continue
      const actual = per[a.canalizacion_id]
      const viu = ALBARA_VIU.includes(a.estado as EstadoAlbaran)
      if (!actual || (viu && !ALBARA_VIU.includes(actual.estado as EstadoAlbaran))) {
        per[a.canalizacion_id] = a
      }
    }
    setAlbarans(per)
    setFiles((resp.data as unknown as AmbOferta[]) ?? [])
    setCarregant(false)
  }, [entidadId])

  useEffect(() => {
    void carrega()
    if (!entidadId) return
    const canal = supabase
      .channel(`meus-interessos-${entidadId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'oferta_respuestas', filter: `entidad_id=eq.${entidadId}` },
        () => void carrega())
      .subscribe()
    return () => { void supabase.removeChannel(canal) }
  }, [carrega, entidadId])

  // Los estados simples con su frase (revisión del 23-09-2026): cuatro que se distinguen de
  // un vistazo —asignada, interés enviado, cerrada, no disponible— más los dos que solo
  // salen a veces. La etapa fina sigue viva en la frase de «qué toca» de cada fila.
  const llegenda = llegendaSimpleInteres()
  const foto = useFotosOfertes(files.map((f) => f.excedentes ?? { producto: null }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('int.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('int.subtitle')}</p>
        <LlegendaEstats items={llegenda} ambPunt />
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
        {!carregant && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('int.empty')}</p>
        )}
        {files.map((f) => {
          const alb = f.canalizacion_id ? albarans[f.canalizacion_id] : undefined
          const punt = puntInteres({
            estado: f.estado,
            aprovacio: f.aprovacio,
            kg: f.kg_solicitados,
            ofertaEstado: f.excedentes?.estado ?? 'publicada',
            albaraEnt: alb ? { estado: alb.estado as EstadoAlbaran, numero: alb.numero_completo } : null,
            motiu: f.motiu_aprovacio,
          })
          // Una línea que resuelve a «—» no se pinta: un hueco con su margen se lee como un
          // fallo de carga. Mismo criterio que `QueTocaAra`.
          const toca = t(punt.claus.toca, punt.vars).trim()
          const est = estatSimpleInteres(punt)
          // La fecha de lo último que ha hecho la entidad: cuándo contestó o, si todavía
          // no lo ha hecho, cuándo le llegó la oferta.
          const data = dataCurtaSenseAny(f.respondido_at ?? f.enviado_at)
          const detall = [
            f.kg_solicitados != null ? `${kgFmt(f.kg_solicitados)} ${t('od.rs_kg')}` : null,
            f.preu_ofert != null
              ? `${Number(f.preu_ofert).toLocaleString('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('od.rs_preu')}`
              : null,
          ].filter(Boolean).join(' · ')
          // Toda la tarjeta abre el detalle de la oferta: antes no se podía abrir y el
          // interés no decía ni dónde estaba ni en qué formato venía.
          return (
            <button type="button" key={f.id} onClick={() => f.excedentes && setObert(f)}
              className="block w-full rounded-lg border p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FotoOfertaResolta foto={foto(f.excedentes ?? { producto: null })}
                    alt={f.excedentes?.producto ?? ''} className="size-12" />
                  <div className="min-w-0">
                    {/* Sin el código interno (E-AAMMDD-…): es del ERP y a la entidad no le dice
                        nada (revisión del 23-09-2026). */}
                    <div className="font-medium">{f.excedentes?.producto ?? '—'}</div>
                    {detall && <div className="text-xs text-muted-foreground">{detall}</div>}
                  </div>
                </div>
                <BadgeEstat clase={est.clase}>
                  {t(est.key)}{data ? ` · ${data}` : ''}
                </BadgeEstat>
              </div>
              {toca && toca !== '—' && toca !== punt.claus.toca && (
                <p className={cn(
                  'mt-2 text-sm',
                  punt.emToca ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}>
                  {toca}
                </p>
              )}
            </button>
          )
        })}
      </CardContent>

      <Dialog open={obert != null} onOpenChange={(v) => !v && setObert(null)}>
        {obert?.excedentes && (() => {
          const alb = obert.canalizacion_id ? albarans[obert.canalizacion_id] : undefined
          const punt = puntInteres({
            estado: obert.estado,
            aprovacio: obert.aprovacio,
            kg: obert.kg_solicitados,
            ofertaEstado: obert.excedentes.estado ?? 'publicada',
            albaraEnt: alb ? { estado: alb.estado as EstadoAlbaran, numero: alb.numero_completo } : null,
            motiu: obert.motiu_aprovacio,
          })
          const est = estatSimpleInteres(punt)
          const toca = t(punt.claus.toca, punt.vars).trim()
          // La oferta todavía se puede pedir: se manda al Mercat, que es donde vive el botón.
          const perDemanar = est.estat === 'per_respondre'
            && ['publicada', 'parcial'].includes(obert.excedentes.estado)
          return (
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
              <DialogHeader><DialogTitle>{t('mk.detail_title')}</DialogTitle></DialogHeader>
              <DetallOfertaReceptor oferta={obert.excedentes} foto={foto(obert.excedentes, true)} />
              {toca && toca !== '—' && toca !== punt.claus.toca && (
                <p className="text-sm text-muted-foreground">{toca}</p>
              )}
              <DialogFooter className="items-center gap-2 sm:justify-between">
                <BadgeEstat clase={est.clase}>{t(est.key)}</BadgeEstat>
                {perDemanar && (
                  <Button asChild className="h-11 md:h-9">
                    <Link to="/receptor/mercat">{t('int.a_mercat')}</Link>
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          )
        })()}
      </Dialog>
    </Card>
  )
}

export function Historic() {
  const { t } = useT()
  const organitzacio = useOrganitzacio('entidad')
  const [files, setFiles] = useState<CanalAmbOferta[]>([])
  const [albarans, setAlbarans] = useState<Record<string, AlbaraEnt>>({})
  const [carregant, setCarregant] = useState(true)
  const [obert, setObert] = useState<CanalAmbOferta | null>(null)
  const entidadId = organitzacio?.id ?? null

  useEffect(() => {
    if (!entidadId) { setCarregant(false); return }
    let viu = true
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46). El albarán de entrega de cada
    // canalización, igual que en Interessos: `ENT` y `R-ENT`, prefiriendo el vivo.
    void Promise.all([
      supabase
        .from('canalizaciones')
        .select('id, kg_confirmados, kg_reales, data_hora_recollida, created_at, excedentes(*)')
        .eq('entidad_id', entidadId)
        .order('created_at', { ascending: false }),
      supabase
        .from('v_albaranes_bandeja')
        .select('id, numero_completo, estado, canalizacion_id')
        .in('tipo', ['ENT', 'R-ENT']),
    ]).then(([can, alb]) => {
      if (!viu) return
      const per: Record<string, AlbaraEnt> = {}
      for (const a of ((alb.data as AlbaraEnt[] | null) ?? [])) {
        if (!a.canalizacion_id) continue
        const actual = per[a.canalizacion_id]
        const viuA = ALBARA_VIU.includes(a.estado as EstadoAlbaran)
        if (!actual || (viuA && !ALBARA_VIU.includes(actual.estado as EstadoAlbaran))) per[a.canalizacion_id] = a
      }
      setAlbarans(per)
      setFiles((can.data as unknown as CanalAmbOferta[]) ?? [])
      setCarregant(false)
    })
    return () => { viu = false }
  }, [entidadId])

  // El título dice «rebudes»: solo cuenta lo que ha llegado (`kg_reales`). Lo asignado
  // y todavía sin recibir va aparte, o la cifra afirmaría kilos que nadie ha entregado.
  const totalKg = files.reduce((s, f) => s + Number(f.kg_reales ?? 0), 0)
  const pendentKg = files.reduce((s, f) => s + (f.kg_reales == null ? Number(f.kg_confirmados ?? 0) : 0), 0)
  const foto = useFotosOfertes(files.map((f) => f.excedentes ?? { producto: null }))

  /** Siempre una fecha, y nunca el código interno. ⚠️ «Recollida» solo con kilos reales:
   *  `emitir_albaran()` escribe `data_hora_recollida` al EMITIR el ENT (la fecha prevista),
   *  así que la fecha sola no dice que haya llegado nada. */
  const quan = (f: CanalAmbOferta) => (f.data_hora_recollida && f.kg_reales != null
    ? t('hist.collected_on', { date: dataCurta(f.data_hora_recollida) })
    : f.data_hora_recollida
      ? t('hist.planned_on', { date: dataCurta(f.data_hora_recollida) })
      : t('hist.assigned_on', { date: dataCurta(f.created_at) }))
  /** Claves propias y no las del productor: aquí los kilos se RECIBEN. */
  const quants = (f: CanalAmbOferta) => (f.kg_reales != null
    ? t('hist.kg_reals', { n: kgFmt(f.kg_reales) })
    : t('hist.kg_assignats', { n: kgFmt(f.kg_confirmados ?? 0) }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hist.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{pendentKg > 0
            ? t('hist.subtitle_pending', { n: kgFmt(totalKg), m: kgFmt(pendentKg) })
            : t('hist.subtitle', { n: kgFmt(totalKg) })}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
        {!carregant && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('hist.empty')}</p>
        )}
        {files.map((f) => (
          // Toda la fila abre el detalle, como en Interessos (28-09-2026).
          <button type="button" key={f.id} onClick={() => f.excedentes && setObert(f)}
            className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="flex min-w-0 items-center gap-3">
              <FotoOfertaResolta foto={foto(f.excedentes ?? { producto: null })}
                alt={f.excedentes?.producto ?? ''} className="size-12" />
              <div className="min-w-0">
                <div className="font-medium">{f.excedentes?.producto ?? '—'}</div>
                <div className="text-xs text-muted-foreground">
                  {quan(f)}
                  {f.excedentes?.modalitat ? ` · ${t(`od.mod_${f.excedentes.modalitat}`)}` : ''}
                </div>
              </div>
            </div>
            <span className="tabular-nums">{quants(f)}</span>
          </button>
        ))}
      </CardContent>

      <Dialog open={obert != null} onOpenChange={(v) => !v && setObert(null)}>
        {obert?.excedentes && (() => {
          const alb = albarans[obert.id]
          return (
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
              <DialogHeader><DialogTitle>{t('mk.detail_title')}</DialogTitle></DialogHeader>
              <DetallOfertaReceptor oferta={obert.excedentes} foto={foto(obert.excedentes, true)} />
              {/* La entrega: lo que llegó, cuándo y con qué albarán. El PDF vive en
                  Documents, que es donde ya se descarga. */}
              <div className="space-y-1 rounded-md border p-3 text-sm">
                <p className="text-xs text-muted-foreground">{t('hist.d_entrega')}</p>
                <p className="font-medium tabular-nums">{quants(obert)}</p>
                <p className="text-muted-foreground">{quan(obert)}</p>
                {alb && (
                  <p>
                    {t('hist.d_albara', { num: alb.numero_completo ?? t('alb.no_number') })}
                    {' · '}{t(`alb.st_${alb.estado}`)}
                  </p>
                )}
              </div>
              {alb?.numero_completo && (
                <DialogFooter>
                  <Button asChild variant="outline" className="h-11 md:h-9">
                    <Link to="/receptor/documents">{t('hist.a_documents')}</Link>
                  </Button>
                </DialogFooter>
              )}
            </DialogContent>
          )
        })()}
      </Dialog>
    </Card>
  )
}
