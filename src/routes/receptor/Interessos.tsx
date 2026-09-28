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
import type { PuntProces } from '../../lib/procesOferta'
import { dataCurta } from '../../lib/albarans'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { EstadoAlbaran, OfertaRespuesta } from '../../types'
import LlegendaEstats from '../../components/proces/LlegendaEstats'
import BadgeEstat from '../../components/proces/BadgeEstat'
import { FotoOfertaResolta, useFotosOfertes } from '../../components/FotosOferta'
import CarregantSeccio from '../../components/CarregantSeccio'
import DetallOfertaReceptor, { kgFmt } from '../../components/DetallOfertaReceptor'
import type { OfertaReceptor } from '../../components/DetallOfertaReceptor'
import { Link } from 'react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

// La oferta con las columnas de `OfertaReceptor` y ninguna más (D3 también en la API: ni
// `texto_oferta` ni `id_excedente` ni `productor_id`). La tarjeta abre su detalle, que es el
// mismo del Mercat.
type AmbOferta = Pick<
  OfertaRespuesta,
  | 'id' | 'estado' | 'aprovacio' | 'kg_solicitados' | 'preu_ofert' | 'motiu_aprovacio'
  | 'canalizacion_id' | 'enviado_at' | 'respondido_at'
> & { excedentes: OfertaReceptor | null }

/**
 * Lo único que hace falta del albarán de entrega para contar la etapa. `ENT` en donación y
 * `OPE` en venta o maquila: los dos cuelgan 1:1 de la canalización.
 */
type AlbaraEnt = Pick<
  AlbaranBandeja,
  'id' | 'numero_completo' | 'estado' | 'canalizacion_id' | 'confirmado_at' | 'kg_confirmados'
>

interface CanalAmbOferta {
  id: string
  kg_confirmados: number | null
  kg_reales: number | null
  data_hora_recollida: string | null
  created_at: string
  // La oferta, con las columnas de `OfertaReceptor`: la fila abre su detalle (28-09-2026).
  excedentes: OfertaReceptor | null
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

/** De cada canalización, su albarán de entrega, prefiriendo el vivo al anulado. */
function albaraPerCanalitzacio(files: AlbaraEnt[]): Record<string, AlbaraEnt> {
  const per: Record<string, AlbaraEnt> = {}
  for (const a of files) {
    if (!a.canalizacion_id) continue
    const actual = per[a.canalizacion_id]
    const viu = ALBARA_VIU.includes(a.estado as EstadoAlbaran)
    if (!actual || (viu && !ALBARA_VIU.includes(actual.estado as EstadoAlbaran))) {
      per[a.canalizacion_id] = a
    }
  }
  return per
}

export function Interessos() {
  const { t } = useT()
  const organitzacio = useOrganitzacio('entidad')
  const [files, setFiles] = useState<AmbOferta[]>([])
  const [albarans, setAlbarans] = useState<Record<string, AlbaraEnt>>({})
  const [carregant, setCarregant] = useState(true)
  const [errorCarrega, setErrorCarrega] = useState(false)
  const [obert, setObert] = useState<AmbOferta | null>(null)
  const entidadId = organitzacio?.id ?? null

  const carrega = useCallback(async () => {
    if (!entidadId) { setCarregant(false); return }
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46), y la de la oferta sin nada
    // que nombre a la productora (`OfertaReceptor`).
    // `ENT`/`R-ENT` en donación y `OPE`/`R-OPE` en venta o maquila: una entrega rectificada
    // sigue siendo la entrega de ese interés, y mirar solo el original dejaría la etapa
    // colgada en «Assignada» para siempre.
    const [resp, alb] = await Promise.all([
      supabase
        .from('oferta_respuestas')
        .select('id, estado, aprovacio, kg_solicitados, preu_ofert, motiu_aprovacio, canalizacion_id, enviado_at, respondido_at, excedentes(id, estado, familia, producto, variedad, kg_total, num_caixes, tipo_caixa, retorn_envasos, modalitat, causa, disponible_hasta, horari_recollida, observacions, preu_minim, producte_al_camp, comarca, format_entrega, transport_propi, fotos, foto_producte)')
        .eq('entidad_id', entidadId)
        .order('enviado_at', { ascending: false }),
      supabase
        .from('v_albaranes_bandeja')
        .select('id, numero_completo, estado, canalizacion_id, confirmado_at, kg_confirmados')
        .in('tipo', ['ENT', 'R-ENT', 'OPE', 'R-OPE']),
    ])
    // Un fallo de carga no es «todavía no has pedido nada»: se dice.
    if (resp.error || alb.error) { setErrorCarrega(true); setCarregant(false); return }
    setErrorCarrega(false)

    // El interés aprobado y su albarán de entrega comparten `canalizacion_id`: es lo único
    // que los une, porque el albarán cuelga de la canalización y no de la respuesta.
    setAlbarans(albaraPerCanalitzacio((alb.data as AlbaraEnt[] | null) ?? []))
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

  /**
   * Cuando el equipo no se la asignó, el porqué: sin él la entidad solo veía «No
   * disponible» y la leyenda la mandaba a abrirla para ver un motivo que no se pintaba.
   * Con `{motiu}` vacío el texto acaba en espacio; se recorta.
   */
  const passaAmbMotiu = (punt: PuntProces): string | null => (punt.etapa === 'no_assignada'
    ? t(punt.claus.passa, punt.vars).replace(/\s+/g, ' ').trim()
    : null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('int.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('int.subtitle')}</p>
        <LlegendaEstats items={llegenda} ambPunt />
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
        {!carregant && errorCarrega && <p className="text-sm text-destructive">{t('c.error')}</p>}
        {!carregant && !errorCarrega && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('int.empty')}</p>
        )}
        {!errorCarrega && files.map((f) => {
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
          const passa = passaAmbMotiu(punt)
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
              {passa && <p className="mt-2 text-sm text-muted-foreground">{passa}</p>}
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
          const passa = passaAmbMotiu(punt)
          // La oferta todavía se puede pedir: se manda al Mercat, que es donde vive el botón.
          const perDemanar = est.estat === 'per_respondre'
            && ['publicada', 'parcial'].includes(obert.excedentes.estado)
          return (
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
              <DialogHeader><DialogTitle>{t('mk.detail_title')}</DialogTitle></DialogHeader>
              <DetallOfertaReceptor oferta={obert.excedentes} foto={foto(obert.excedentes, true)} />
              {passa && <p className="text-sm">{passa}</p>}
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
  const [errorCarrega, setErrorCarrega] = useState(false)
  const [obert, setObert] = useState<CanalAmbOferta | null>(null)
  const entidadId = organitzacio?.id ?? null

  useEffect(() => {
    if (!entidadId) { setCarregant(false); return }
    let viu = true
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46), y la oferta con las columnas
    // de `OfertaReceptor` (D3). El albarán de entrega de cada canalización, igual que en
    // Interessos: `ENT`/`R-ENT` y `OPE`/`R-OPE`, prefiriendo el vivo.
    void Promise.all([
      supabase
        .from('canalizaciones')
        .select('id, kg_confirmados, kg_reales, data_hora_recollida, created_at, excedentes(id, estado, familia, producto, variedad, kg_total, num_caixes, tipo_caixa, retorn_envasos, modalitat, causa, disponible_hasta, horari_recollida, observacions, preu_minim, producte_al_camp, comarca, format_entrega, transport_propi, fotos, foto_producte)')
        .eq('entidad_id', entidadId)
        .order('created_at', { ascending: false }),
      supabase
        .from('v_albaranes_bandeja')
        .select('id, numero_completo, estado, canalizacion_id, confirmado_at, kg_confirmados')
        .in('tipo', ['ENT', 'R-ENT', 'OPE', 'R-OPE']),
    ]).then(([can, alb]) => {
      if (!viu) return
      if (can.error || alb.error) { setErrorCarrega(true); setCarregant(false); return }
      setAlbarans(albaraPerCanalitzacio((alb.data as AlbaraEnt[] | null) ?? []))
      setFiles((can.data as unknown as CanalAmbOferta[]) ?? [])
      setCarregant(false)
    })
    return () => { viu = false }
  }, [entidadId])

  /**
   * ¿Ha llegado ya? `kg_reales` solo lo escribe la CONCILIACIÓN, así que una entrega que la
   * entidad ya confirmó seguía saliendo «pendent de confirmar» hasta que el equipo
   * conciliara. Lo decide el albarán: confirmado o conciliado = recibida.
   */
  const estatEntrega = (f: CanalAmbOferta): 'conciliada' | 'confirmada' | 'pendent' => {
    const alb = albarans[f.id]
    if (f.kg_reales != null || alb?.estado === 'conciliado') return 'conciliada'
    if (alb?.estado === 'confirmado') return 'confirmada'
    return 'pendent'
  }
  /** Los kilos recibidos: los reales si ya se concilió; los que confirmó la entidad si no. */
  const kgRebuts = (f: CanalAmbOferta): number | null => {
    const e = estatEntrega(f)
    if (e === 'conciliada') return Number(f.kg_reales ?? albarans[f.id]?.kg_confirmados ?? f.kg_confirmados ?? 0)
    if (e === 'confirmada') return Number(albarans[f.id]?.kg_confirmados ?? f.kg_confirmados ?? 0)
    return null
  }

  // El título dice «rebudes»: cuenta lo que ha llegado, conciliado o ya confirmado por la
  // entidad. Lo asignado y todavía sin recibir va aparte, o la cifra afirmaría kilos que
  // nadie ha entregado — y lo ya confirmado no puede seguir contando como «pendent de rebre».
  const totalKg = files.reduce((s, f) => s + (kgRebuts(f) ?? 0), 0)
  const pendentKg = files.reduce((s, f) => s + (kgRebuts(f) == null ? Number(f.kg_confirmados ?? 0) : 0), 0)
  const foto = useFotosOfertes(files.map((f) => f.excedentes ?? { producto: null }))

  /** Siempre una fecha, y nunca el código interno. ⚠️ La fecha sola no dice que haya
   *  llegado nada: `emitir_albaran()` escribe `data_hora_recollida` al EMITIR el albarán
   *  (la fecha prevista). Lo que dice si llegó es `estatEntrega()`. */
  const quan = (f: CanalAmbOferta) => {
    const e = estatEntrega(f)
    const data = f.data_hora_recollida ?? albarans[f.id]?.confirmado_at ?? null
    if (e === 'conciliada' && data) return t('hist.collected_on', { date: dataCurta(data) })
    if (e === 'confirmada' && data) return t('hist.confirmed_on', { date: dataCurta(data) })
    if (f.data_hora_recollida) return t('hist.planned_on', { date: dataCurta(f.data_hora_recollida) })
    return t('hist.assigned_on', { date: dataCurta(f.created_at) })
  }
  /** Claves propias y no las del productor: aquí los kilos se RECIBEN. */
  const quants = (f: CanalAmbOferta) => {
    const rebuts = kgRebuts(f)
    return rebuts != null
      ? t('hist.kg_reals', { n: kgFmt(rebuts) })
      : t('hist.kg_assignats', { n: kgFmt(f.kg_confirmados ?? 0) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hist.title')}</CardTitle>
        {!errorCarrega && (
          <p className="mt-1 text-sm text-muted-foreground">{pendentKg > 0
            ? t('hist.subtitle_pending', { n: kgFmt(totalKg), m: kgFmt(pendentKg) })
            : t('hist.subtitle', { n: kgFmt(totalKg) })}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
        {!carregant && errorCarrega && <p className="text-sm text-destructive">{t('c.error')}</p>}
        {!carregant && !errorCarrega && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('hist.empty')}</p>
        )}
        {!errorCarrega && files.map((f) => (
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
