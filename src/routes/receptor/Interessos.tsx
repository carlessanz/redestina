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

import BarraFiltres from '../../components/BarraFiltres'
import { useFiltresLlistat } from '../../hooks/useFiltresLlistat'
import { filtraLlistat, opcionsDisponibles, type Dimensio } from '../../lib/filtres'
import { carregaContraparts, marcaLlegits } from '../../lib/avisos'
import type { Contrapart } from '../../lib/avisos'
import { modalitatsOferta, textModalitats } from '../../lib/modalitats'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { estatSimpleInteres, llegendaSimpleInteres, puntInteres } from '../../lib/procesOferta'
import type { PuntProces } from '../../lib/procesOferta'
import { dataCurta, diaMes, kg, preu } from '../../lib/format'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { EstadoAlbaran, OfertaRespuesta } from '../../types'
import LlegendaEstats from '../../components/proces/LlegendaEstats'
import BadgeEstat from '../../components/proces/BadgeEstat'
import { FotoOfertaResolta, useFotosOfertes } from '../../components/FotosOferta'
import CarregantSeccio from '../../components/CarregantSeccio'
import DetallOfertaReceptor from '../../components/DetallOfertaReceptor'
import FitxaOperacio from '../../components/FitxaOperacio'
import { declinaOferta } from '../../lib/operacio'
import { toast } from 'sonner'
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
  | 'canalizacion_id' | 'enviado_at' | 'respondido_at' | 'kg_aprovats' | 'modalitat' | 'recollida_at'
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
  const [pestanya, setPestanya] = useState<'interessos' | 'per_a_tu'>('interessos')
  const [declinant, setDeclinant] = useState(false)
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
        .select('id, estado, aprovacio, kg_solicitados, kg_aprovats, modalitat, recollida_at, preu_ofert, motiu_aprovacio, canalizacion_id, enviado_at, respondido_at, excedentes(id, estado, familia, producto, variedad, kg_total, num_caixes, tipo_caixa, retorn_envasos, modalitat, modalitats, causa, disponible_hasta, horari_recollida, hora_recollida_inici, hora_recollida_fi, observacions, preu_minim, producte_al_camp, comarca, format_entrega, transport_propi, fotos, foto_producte)')
        .eq('entidad_id', entidadId)
        .order('enviado_at', { ascending: false })
        .overrideTypes<AmbOferta[], { merge: false }>(),
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
    setFiles(resp.data ?? [])
    setCarregant(false)
  }, [entidadId])

  // Abrir la pantalla da por leídos los avisos de intereses (05-10-2026): el badge del
  // menú baja al entrar, que es donde se mira lo que dicen.
  useEffect(() => { void marcaLlegits({ objecteTipo: 'oferta_resposta' }) }, [])
  // D1: con quién has quedado, una vez aprobado.
  const [contraparts, setContraparts] = useState<Record<string, Contrapart>>({})
  useEffect(() => {
    void carregaContraparts().then((cs) => {
      const m: Record<string, Contrapart> = {}
      for (const c of cs) if (c.rol === 'entidad' && c.resposta_id) m[c.resposta_id] = c
      setContraparts(m)
    })
  }, [files])

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

  // «Ofertes per a tu» (fase 2 de la revisión del 08-10-2026): las que el equipo le ha
  // enviado —por WhatsApp, correo o el panel— y que todavía no ha contestado, mientras la
  // oferta siga viva. Cuando tiene otro destino, deja de estar aquí y en la lista sale «No
  // disponible». Las demás son SUS intereses.
  const esPerATu = (f: AmbOferta) =>
    f.estado === 'pendent' && ['publicada', 'parcial'].includes(f.excedentes?.estado ?? '')
  const perATu = files.filter(esPerATu)
  const visibles = pestanya === 'per_a_tu' ? perATu : files.filter((f) => !esPerATu(f))
  /**
   * Lo ASIGNADO, que es lo que la entidad va a recibir: el de la canalización (si el equipo
   * lo cambió después de aprobar, manda ese), si no el aprobado. Antes `puntInteres` recibía
   * lo pedido y «Aquests {kg} kg són per a tu» decía lo que no era.
   */
  const kgAssignat = (f: AmbOferta): number | null =>
    f.aprovacio === 'aprovada' ? (contraparts[f.id]?.kg ?? f.kg_aprovats ?? f.kg_solicitados) : null

  async function declina(f: AmbOferta) {
    setDeclinant(true)
    const r = await declinaOferta(f.id)
    setDeclinant(false)
    if (!r.ok) { toast.error(t('int.err_declina')); return }
    toast.success(t('int.declinada'))
    setObert(null)
    await carrega()
  }

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
        <div role="tablist" className="mb-2 flex flex-wrap gap-2">
          {(['interessos', 'per_a_tu'] as const).map((p) => (
            <Button key={p} role="tab" aria-selected={pestanya === p} type="button" size="sm"
              variant={pestanya === p ? 'default' : 'outline'} className="h-11 md:h-9"
              onClick={() => setPestanya(p)}>
              {t(p === 'interessos' ? 'int.tab_meus' : 'int.tab_per_a_tu')}
              {p === 'per_a_tu' && perATu.length > 0 && (
                <span className="ml-1 rounded-full bg-coral px-1.5 text-xs text-coral-foreground">{perATu.length}</span>
              )}
            </Button>
          ))}
        </div>
        {pestanya === 'per_a_tu' && (
          <p className="text-sm text-muted-foreground">{t('int.per_a_tu_hint')}</p>
        )}
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
        {!carregant && errorCarrega && <p className="text-sm text-destructive">{t('c.error')}</p>}
        {!carregant && !errorCarrega && visibles.length === 0 && (
          <p className="text-sm text-muted-foreground">{t(pestanya === 'per_a_tu' ? 'int.per_a_tu_empty' : 'int.empty')}</p>
        )}
        {!errorCarrega && visibles.map((f) => {
          const alb = f.canalizacion_id ? albarans[f.canalizacion_id] : undefined
          const assignat = kgAssignat(f)
          const punt = puntInteres({
            estado: f.estado,
            aprovacio: f.aprovacio,
            kg: assignat ?? f.kg_solicitados,
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
          const data = diaMes(f.respondido_at ?? f.enviado_at)
          // Lo asignado va aparte y destacado (revisión del 08-10-2026, §1.3): «Sol·licitats
          // 150 · Aprovats 100» con la misma jerarquía no dejaba ver qué iba a recibir.
          const kgs = assignat == null && f.kg_solicitados != null
            ? `${kg(f.kg_solicitados)} ${t('od.rs_kg')}`
            : assignat != null && f.kg_solicitados != null && f.kg_solicitados !== assignat
              ? t('int.sollicitats', { n: kg(f.kg_solicitados) })
              : null
          const qui = contraparts[f.id]
          const detall = [
            kgs,
            f.modalitat ? t(`od.mod_${f.modalitat}`) : null,
            f.recollida_at ? t('int.recollida', { quan: new Date(f.recollida_at).toLocaleString('ca-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }) : null,
            f.preu_ofert != null
              ? `${preu(f.preu_ofert)} ${t('od.rs_preu')}`
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
                    {assignat != null && (
                      <div className="text-sm font-semibold">{t('int.assignada', { n: kg(assignat) })}</div>
                    )}
                    {detall && <div className="text-xs text-muted-foreground">{detall}</div>}
                    {qui?.contrapart && (
                      <div className="text-xs text-muted-foreground">
                        {t('int.ofereix', { nom: qui.contrapart })}{qui.municipi ? ` · ${qui.municipi}` : ''}
                      </div>
                    )}
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
            kg: kgAssignat(obert) ?? obert.kg_solicitados,
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
              {/* Asignada: manda la FICHA DE LA OPERACIÓN (revisión del 08-10-2026, §1.3) —qué,
                  cuánto, de quién, dónde y cuándo—, y la oferta original queda debajo como
                  referencia. Antes se seguía enseñando la ficha original de la oferta. */}
              <DialogHeader>
                <DialogTitle>{t(obert.aprovacio === 'aprovada' && obert.canalizacion_id ? 'op.title' : 'mk.detail_title')}</DialogTitle>
              </DialogHeader>
              {obert.aprovacio === 'aprovada' && obert.canalizacion_id ? (
                <>
                  <FitxaOperacio canalizacionId={obert.canalizacion_id} />
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-sm text-muted-foreground">{t('op.oferta_original')}</summary>
                    <div className="mt-3"><DetallOfertaReceptor oferta={obert.excedentes} foto={foto(obert.excedentes, true)} /></div>
                  </details>
                </>
              ) : (
                <DetallOfertaReceptor oferta={obert.excedentes} foto={foto(obert.excedentes, true)} />
              )}
              {/* D1: una vez aprobada, quién la ofrece y dónde se recoge. */}
              {!(obert.aprovacio === 'aprovada' && obert.canalizacion_id) && contraparts[obert.id]?.contrapart && (
                <div className="space-y-1 rounded-md border p-3 text-sm">
                  <p className="text-xs text-muted-foreground">{t('int.d_contrapart')}</p>
                  <p className="font-medium">{contraparts[obert.id].contrapart}{contraparts[obert.id].municipi ? ` · ${contraparts[obert.id].municipi}` : ''}</p>
                  {contraparts[obert.id].gmaps_url && (
                    <a href={contraparts[obert.id].gmaps_url!} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {t('int.d_maps')}
                    </a>
                  )}
                </div>
              )}
              {passa && <p className="text-sm">{passa}</p>}
              {toca && toca !== '—' && toca !== punt.claus.toca && (
                <p className="text-sm text-muted-foreground">{toca}</p>
              )}
              <DialogFooter className="items-center gap-2 sm:justify-between">
                <BadgeEstat clase={est.clase}>{t(est.key)}</BadgeEstat>
                {perDemanar && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" className="h-11 md:h-9" disabled={declinant}
                      onClick={() => void declina(obert)}>
                      {t('int.no_minteressa')}
                    </Button>
                    <Button asChild className="h-11 md:h-9">
                      <Link to="/receptor/mercat">{t('int.a_mercat')}</Link>
                    </Button>
                  </div>
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
  // De quién vino cada entrega (D1): la contraparte de la canalización.
  const [ofertants, setOfertants] = useState<Record<string, Contrapart>>({})
  useEffect(() => {
    void carregaContraparts().then((cs) => {
      const m: Record<string, Contrapart> = {}
      for (const c of cs) if (c.rol === 'entidad') m[c.canalizacion_id] = c
      setOfertants(m)
    })
  }, [files])

  useEffect(() => {
    if (!entidadId) { setCarregant(false); return }
    let viu = true
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46), y la oferta con las columnas
    // de `OfertaReceptor` (D3). El albarán de entrega de cada canalización, igual que en
    // Interessos: `ENT`/`R-ENT` y `OPE`/`R-OPE`, prefiriendo el vivo.
    void Promise.all([
      supabase
        .from('canalizaciones')
        .select('id, kg_confirmados, kg_reales, data_hora_recollida, created_at, excedentes(id, estado, familia, producto, variedad, kg_total, num_caixes, tipo_caixa, retorn_envasos, modalitat, modalitats, causa, disponible_hasta, horari_recollida, hora_recollida_inici, hora_recollida_fi, observacions, preu_minim, producte_al_camp, comarca, format_entrega, transport_propi, fotos, foto_producte)')
        .eq('entidad_id', entidadId)
        .order('created_at', { ascending: false })
        .overrideTypes<CanalAmbOferta[], { merge: false }>(),
      supabase
        .from('v_albaranes_bandeja')
        .select('id, numero_completo, estado, canalizacion_id, confirmado_at, kg_confirmados')
        .in('tipo', ['ENT', 'R-ENT', 'OPE', 'R-OPE']),
    ]).then(([can, alb]) => {
      if (!viu) return
      if (can.error || alb.error) { setErrorCarrega(true); setCarregant(false); return }
      setAlbarans(albaraPerCanalitzacio((alb.data as AlbaraEnt[] | null) ?? []))
      setFiles(can.data ?? [])
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

  // El Històric es SOLO lo que ya ha llegado (revisión del 08-10-2026, §2.1): lo asignado y
  // pendiente de recibir vive en «Els meus interessos», con su ficha. Ordenado por la fecha
  // de recepción, la más reciente primero (§2.5).
  const quanRebut = (f: CanalAmbOferta) =>
    albarans[f.id]?.confirmado_at ?? f.data_hora_recollida ?? f.created_at
  const totes = files
    .filter((f) => estatEntrega(f) !== 'pendent')
    .sort((a, b) => quanRebut(b).localeCompare(quanRebut(a)))
  // Filtros (fase 6 de la revisión del 08-10-2026): periodo, producto, modalidad, ofertante y
  // zona. El total de arriba es el de lo filtrado: es lo que se está mirando.
  const fl = useFiltresLlistat(entidadId ? `receptor-historic:${entidadId}` : null)
  const dims: Dimensio<CanalAmbOferta>[] = [
    { clau: 'producte', etiquetaKey: 'fl.d_producte', valor: (f) => f.excedentes?.producto },
    { clau: 'modalitat', etiquetaKey: 'fl.d_modalitat', valor: (f) => f.excedentes?.modalitat },
    { clau: 'ofertant', etiquetaKey: 'fl.d_ofertant', valor: (f) => ofertants[f.id]?.contrapart },
    { clau: 'comarca', etiquetaKey: 'fl.d_comarca', valor: (f) => f.excedentes?.comarca },
  ]
  const rang = { data: (f: CanalAmbOferta) => quanRebut(f), desDe: fl.desDe, finsA: fl.finsA }
  const rebudes = filtraLlistat(totes, dims, fl.valors, rang)
  const totalKg = rebudes.reduce((s, f) => s + (kgRebuts(f) ?? 0), 0)
  const foto = useFotosOfertes(rebudes.map((f) => f.excedentes ?? { producto: null }))

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
  /** Asignados y recibidos, los dos (§2.3): la diferencia es justo lo que interesa ver. */
  const quants = (f: CanalAmbOferta) => {
    const rebuts = kgRebuts(f)
    return rebuts != null
      ? t('hist.kg_assig_rebuts', { a: kg(f.kg_confirmados ?? 0), r: kg(rebuts) })
      : t('hist.kg_assignats', { n: kg(f.kg_confirmados ?? 0) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hist.title')}</CardTitle>
        {!errorCarrega && (
          <p className="mt-1 text-sm text-muted-foreground">{t('hist.subtitle', { n: kg(totalKg) })}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
        {!carregant && errorCarrega && <p className="text-sm text-destructive">{t('c.error')}</p>}
        {!carregant && !errorCarrega && totes.length > 0 && (
          <BarraFiltres
            id="hist"
            desplegables={dims.map((d) => ({
              clau: d.clau, etiquetaKey: d.etiquetaKey,
              opcions: opcionsDisponibles(totes, dims, d.clau, fl.valors, rang),
              text: d.clau === 'modalitat' ? (v: string) => t(`od.mod_${v}`) : undefined,
            }))}
            valors={fl.valors}
            onValors={fl.setValors}
            rang={{ etiquetaKey: 'fl.r_recepcio', desDe: fl.desDe, finsA: fl.finsA, onCanvi: fl.setRang }}
            mostrant={rebudes.length}
            total={totes.length}
          />
        )}
        {!carregant && !errorCarrega && totes.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('hist.empty')}</p>
        )}
        {!errorCarrega && rebudes.map((f) => (
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
                  {f.excedentes ? ` · ${textModalitats(modalitatsOferta(f.excedentes), t)}` : ''}
                </div>
                {ofertants[f.id]?.contrapart && (
                  <div className="text-xs text-muted-foreground">
                    {t('int.ofereix', { nom: ofertants[f.id].contrapart! })}
                  </div>
                )}
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
              <DialogHeader><DialogTitle>{t('op.title')}</DialogTitle></DialogHeader>
              {/* La ficha de la operación —ofertante, punto concreto de recogida, kg asignados
                  y recibidos, fecha y hora— y la oferta original como referencia (§2.2). */}
              <FitxaOperacio canalizacionId={obert.id} />
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm text-muted-foreground">{t('op.oferta_original')}</summary>
                <div className="mt-3"><DetallOfertaReceptor oferta={obert.excedentes} foto={foto(obert.excedentes, true)} /></div>
              </details>
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
