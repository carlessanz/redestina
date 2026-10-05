// Mercat del receptor: las ofertas vivas que le encajan.
//
// No hace falta filtrar por tipo de receptor en el cliente: la política de `excedentes`
// ya solo deja ver las compatibles con la matriz `modalitat_receptor_compat` (§4bis).
// Mostrar interés es la RPC `manifestar_interes`, que deja la fila exactamente igual
// que el diálogo de WhatsApp y cae en la misma cola de aprobación del equipo.
//
// ⚠️ LA OFERTA YA SOLICITADA NO DICE «Sol·licitats 300 kg», DICE EN QUÉ PUNTO ESTÁ. Esa
// píldora no distinguía «l'equip encara ho ha de decidir» de «ja és teva», que para quien
// tiene que reservar furgoneta y cámara es toda la diferencia. La etapa la calcula
// `puntInteres()`, el mismo módulo que narra la pantalla de Interessos.
//
// ⚠️ `estado === 'pendent'` SÍ enseña el botón: significa que el equipo le mandó la oferta
// y todavía no ha contestado. Es la fila que existe justamente para que la conteste.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useConveni } from '../../hooks/useConveni'
import { clauErrorInteres, manifestaInteres } from '../../lib/ofertes'
import { estatSimpleInteres, puntInteres } from '../../lib/procesOferta'
import { dataCurta } from '../../lib/albarans'
import {
  desaFiltres, filtraMercat, llegeixFiltres, opcionsMercat, SENSE_FILTRES,
} from '../../lib/filtresMercat'
import type { FiltresMercat } from '../../lib/filtresMercat'
import BadgeEstat from '../../components/proces/BadgeEstat'
import { FotoOfertaResolta, useFotosOfertes } from '../../components/FotosOferta'
import type { ConvenioTipo, OfertaRespuesta } from '../../types'
import CarregantSeccio from '../../components/CarregantSeccio'
import DetallOfertaReceptor, { kgFmt, preuDe } from '../../components/DetallOfertaReceptor'
import type { OfertaReceptor } from '../../components/DetallOfertaReceptor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** Lo único que hace falta de la respuesta propia para contar su etapa. */
type RespostaMeva = Pick<OfertaRespuesta, 'excedente_id' | 'estado' | 'aprovacio' | 'kg_solicitados'>

/** Hoy en hora de Madrid, `AAAA-MM-DD`: la sesión del navegador puede ir en otra zona. */
function avuiMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
}

/** `disponible_hasta` ya pasada: la oferta sigue publicada, pero no se puede pedir. */
function vencuda(o: Pick<OfertaReceptor, 'disponible_hasta'>, avui: string): boolean {
  return o.disponible_hasta != null && o.disponible_hasta.slice(0, 10) < avui
}

export default function Mercat() {
  const { t } = useT()
  const { bloqueja, tipusVigents, tallPassat } = useConveni()
  const organitzacio = useOrganitzacio('entidad')
  const [ofertes, setOfertes] = useState<OfertaReceptor[]>([])
  const [meves, setMeves] = useState<Record<string, RespostaMeva>>({})
  // La matriz `convenios_exigidos`, fila `parte = 'recibe'`: qué convenio exige cada
  // modalidad a quien recibe (hoy donació → don_rec; venda y maquila → com). Se lee de la
  // tabla, que es catálogo legible, para que cambiar la regla no obligue a tocar esto.
  const [exigits, setExigits] = useState<Record<string, ConvenioTipo[]>>({})
  const [carregant, setCarregant] = useState(true)
  const [errorCarrega, setErrorCarrega] = useState(false)
  const [obert, setObert] = useState<OfertaReceptor | null>(null)
  /** El diálogo abre en detalle (tocar la tarjeta) o directamente en el interés (el botón). */
  const [mode, setMode] = useState<'detall' | 'interes'>('detall')
  const [kg, setKg] = useState('')
  const [preu, setPreu] = useState('')
  const [enviant, setEnviant] = useState(false)

  const entidadId = organitzacio?.id ?? null

  // Zona y tipo de producto (reunión del 05-10-2026). Por defecto, sin filtro: se ve todo lo
  // que la RLS deja ver. Recordado por entidad en este navegador (`filtresMercat.ts`).
  const [filtres, setFiltres] = useState<FiltresMercat>(SENSE_FILTRES)
  useEffect(() => { setFiltres(llegeixFiltres(entidadId)) }, [entidadId])
  function canviaFiltres(f: FiltresMercat) {
    setFiltres(f)
    desaFiltres(entidadId, f)
  }
  const opcions = useMemo(() => opcionsMercat(ofertes), [ofertes])
  const visibles = useMemo(() => filtraMercat(ofertes, filtres), [ofertes, filtres])
  const ambFiltre = filtres.comarca !== '' || filtres.categoria !== ''

  const carrega = useCallback(async () => {
    // ⚠️ Columnas explícitas y en UN literal (§7): sin `texto_oferta`, `id_excedente`,
    // `productor_id` ni `ubicacion_id`, que identifican a la productora (D3). La lista y su
    // porqué, en `OfertaReceptor`.
    const [exc, resp, exi] = await Promise.all([
      supabase.from('excedentes')
        .select('id, estado, familia, producto, variedad, kg_total, num_caixes, tipo_caixa, retorn_envasos, modalitat, causa, disponible_hasta, horari_recollida, observacions, preu_minim, producte_al_camp, comarca, format_entrega, transport_propi, fotos, foto_producte')
        .in('estado', ['publicada', 'parcial'])
        .order('created_at', { ascending: false }),
      entidadId
        ? supabase.from('oferta_respuestas').select('excedente_id, estado, aprovacio, kg_solicitados').eq('entidad_id', entidadId)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('convenios_exigidos').select('valorizacion, tipo_convenio').eq('parte', 'recibe'),
    ])
    if (exc.error) { setErrorCarrega(true); setCarregant(false); return }
    setErrorCarrega(false)
    setOfertes((exc.data ?? []) as OfertaReceptor[])
    const per: Record<string, RespostaMeva> = {}
    for (const r of (resp.data ?? []) as RespostaMeva[]) per[r.excedente_id] = r
    setMeves(per)
    const mapa: Record<string, ConvenioTipo[]> = {}
    for (const f of (exi.data ?? []) as { valorizacion: string; tipo_convenio: ConvenioTipo }[]) {
      (mapa[f.valorizacion] ??= []).push(f.tipo_convenio)
    }
    setExigits(mapa)
    setCarregant(false)
  }, [entidadId])

  useEffect(() => {
    void carrega()
    const canal = supabase
      .channel('mercat-receptor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'excedentes' }, () => void carrega())
      .subscribe()
    return () => { void supabase.removeChannel(canal) }
  }, [carrega])

  function obre(o: OfertaReceptor, m: 'detall' | 'interes') {
    setObert(o)
    setMode(m)
    setKg(String(o.kg_total ?? ''))
    setPreu(o.preu_minim != null ? String(o.preu_minim) : '')
  }

  async function envia() {
    if (!obert || !entidadId) return
    const nKg = Number(kg.replace(',', '.'))
    if (!nKg || nKg <= 0) { toast.error(t('mk.need_kg')); return }
    // Más de lo que hay no: la base también lo rechaza (`kg_maxim`), pero decirlo aquí
    // ahorra el viaje y el mensaje llega antes.
    if (obert.kg_total != null && nKg > Number(obert.kg_total)) {
      toast.error(t('mk.max_kg', { n: kgFmt(obert.kg_total) }))
      return
    }
    setEnviant(true)
    const r = await manifestaInteres({
      excedenteId: obert.id,
      entidadId,
      kg: nKg,
      preu: preu === '' ? null : Number(preu.replace(',', '.')),
    })
    setEnviant(false)
    if (!r.ok) {
      const e = clauErrorInteres(r.error)
      toast.error(t(e.clau, e.vars))
      return
    }
    toast.success(t('mk.sent'))
    setObert(null)
    await carrega()
  }

  // Las URLs firmadas de todas las fotos de la pantalla, en lote (antes de cualquier
  // `return`: son hooks). `foto()` resuelve la principal de cada oferta —la suya, la del
  // producto o el icono—; las demás de la oferta abierta las firma `DetallOfertaReceptor`.
  const foto = useFotosOfertes(obert ? [...ofertes, obert] : ofertes)

  if (!entidadId) return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>

  const avui = avuiMadrid()

  /**
   * Por qué no se puede pedir esta oferta, o null si se puede. Una clave i18n, que es lo que
   * se enseña debajo del botón: en táctil no hay tooltip (§6ter).
   *
   * El convenio se mira POR MODALIDAD, no en bloque: `estat` de `useConveni` dice el más
   * avanzado de todos, y una entidad con `don_rec` vigente sale «vigent» aunque le falte el
   * `com` que exige una venta o una maquila. Antes del corte solo se avisa (como
   * `exigir_convenio()`); desde el corte, se bloquea.
   */
  const motiuNoPot = (o: OfertaReceptor): string | null => {
    if (vencuda(o, avui)) return 'mk.expired'
    if (!tallPassat) return null
    const cal = (o.modalitat ? exigits[o.modalitat] : undefined) ?? []
    const falta = cal.filter((tipus) => !tipusVigents.includes(tipus))
    if (falta.includes('com')) return 'mk.cal_conveni_com'
    if (falta.length > 0 || bloqueja) return 'avis_conv.bloquejat_rec'
    return null
  }

  /** El interés de esta entidad sobre una oferta, contado en una etapa (o null si se puede pedir). */
  const puntDe = (o: OfertaReceptor) => {
    const meva = meves[o.id]
    // Sin `meva`, o con la fila todavía `pendent`, esta oferta se puede pedir.
    return meva && meva.estado !== 'pendent'
      ? puntInteres({
        estado: meva.estado,
        aprovacio: meva.aprovacio,
        kg: meva.kg_solicitados,
        ofertaEstado: o.estado,
      })
      : null
  }

  const obertPunt = obert ? puntDe(obert) : null
  const obertVenda = obert?.modalitat === 'venda' || obert?.modalitat === 'maquila'
  const obertMotiu = obert ? motiuNoPot(obert) : null
  // El precio mínimo con coma y dos decimales, como lo escribe la gente; sin mínimo, sin cifra.
  const preuMinim = obert?.preu_minim != null
    ? new Intl.NumberFormat('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(obert.preu_minim))
    : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('mk.titol_ofertes')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('mk.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
        {!carregant && errorCarrega && (
          <p className="text-sm text-destructive">{t('c.error')}</p>
        )}
        {!carregant && !errorCarrega && ofertes.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('mk.empty')}</p>
        )}
        {!carregant && !errorCarrega && ofertes.length > 0 && (opcions.comarques.length > 1 || opcions.categories.length > 1 || ambFiltre) && (
          <div className="flex flex-wrap items-end gap-2 pb-1">
            <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
              <Label htmlFor="mk-f-zona" className="text-xs text-muted-foreground">{t('mk.f_zone')}</Label>
              <select id="mk-f-zona"
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base sm:w-48 md:h-9 md:text-sm"
                value={filtres.comarca}
                onChange={(e) => canviaFiltres({ ...filtres, comarca: e.target.value })}>
                <option value="">{t('mk.f_all_zones')}</option>
                {/* Una comarca recordada que hoy ya no tiene ofertas se sigue ofreciendo: si no,
                    el select no podría enseñar el valor elegido. */}
                {[...new Set([...opcions.comarques, ...(filtres.comarca ? [filtres.comarca] : [])])].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0 flex-1 space-y-1 sm:flex-none">
              <Label htmlFor="mk-f-tipus" className="text-xs text-muted-foreground">{t('mk.f_type')}</Label>
              <select id="mk-f-tipus"
                className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base sm:w-48 md:h-9 md:text-sm"
                value={filtres.categoria}
                onChange={(e) => canviaFiltres({ ...filtres, categoria: e.target.value as FiltresMercat['categoria'] })}>
                <option value="">{t('mk.f_all_types')}</option>
                {[...new Set([...opcions.categories, ...(filtres.categoria ? [filtres.categoria] : [])])].map((c) => (
                  <option key={c} value={c}>{t(c === 'altres' ? 'mk.f_other' : `pr.o_${c}`)}</option>
                ))}
              </select>
            </div>
            {ambFiltre && (
              <Button variant="ghost" className="h-11 md:h-9" onClick={() => canviaFiltres(SENSE_FILTRES)}>
                {t('mk.f_clear')}
              </Button>
            )}
          </div>
        )}
        {!carregant && !errorCarrega && ofertes.length > 0 && visibles.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('mk.f_empty', { n: ofertes.length })}</p>
        )}
        {visibles.map((o) => {
          const punt = puntDe(o)
          const motiu = motiuNoPot(o)
          // La tarjeta dice lo que un receptor mira primero (revisión del 23-09-2026):
          // producto, kg, modalidad, DÓNDE —la comarca, no el municipio (D3)— y precio si
          // hay. «Donació» va sin precio, a propósito.
          const detall = [
            `${kgFmt(o.kg_total)} kg`,
            o.modalitat ? t(`od.mod_${o.modalitat}`) : null,
            o.comarca,
            preuDe(o),
            o.disponible_hasta && !vencuda(o, avui) ? t('mk.until', { date: dataCurta(o.disponible_hasta) }) : null,
          ].filter(Boolean).join(' · ')
          return (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              {/* Toda la parte izquierda abre el detalle: es lo que se toca para «ver más». */}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => obre(o, 'detall')}
              >
                {/* La foto primero: es lo primero que mira un receptor (revisión del 23-09). */}
                <FotoOfertaResolta foto={foto(o)} alt={o.producto ?? ''} className="size-16" />
                <div className="min-w-0">
                <div className="font-medium">
                  {o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}
                </div>
                <div className="text-xs text-muted-foreground">{detall}</div>
                {vencuda(o, avui) && (
                  <div className="text-xs font-medium text-error">{t('mk.expired')}</div>
                )}
                <div className="mt-0.5 text-xs font-medium text-primary">{t('mk.see_detail')}</div>
                </div>
              </button>
              {punt ? (
                <BadgeEstat clase={estatSimpleInteres(punt).clase}>
                  {t(estatSimpleInteres(punt).key)}
                </BadgeEstat>
              ) : (
                // Sin `size="sm"` y a 44px en móvil: es la única acción del panel del
                // receptor y se repite en cada fila. En escritorio vuelve a la altura
                // normal, donde se pulsa con ratón y 36px sobran.
                // ⚠️ `w-full` en móvil: con la foto de 64 px, el botón en la misma fila dejaba
                // ~69 px al texto a 375 px y el nombre se salía (§2, regla 4).
                <Button
                  className="h-11 w-full sm:w-auto md:h-9"
                  disabled={motiu !== null}
                  title={motiu ? t(motiu) : undefined}
                  onClick={() => obre(o, 'interes')}
                >{t('mk.interested')}</Button>
              )}
              {/* El motivo, visible y no solo en el tooltip: en un móvil no hay hover. La
                  caducidad ya sale en la propia tarjeta. */}
              {!punt && motiu && motiu !== 'mk.expired' && (
                <p className="w-full text-xs text-error">{t(motiu)}</p>
              )}
            </div>
          )
        })}
      </CardContent>

      {/* UN solo diálogo, con dos modos: el detalle de la oferta y, desde él, el interés.
          ⚠️ `max-h` + scroll: al enfocar «quants kg» en un móvil el área visible baja a
          ~350px, y sin tope de altura el botón de enviar quedaba fuera de alcance. */}
      <Dialog open={obert != null} onOpenChange={(v) => !v && setObert(null)}>
        {obert && (
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {mode === 'detall' ? t('mk.detail_title') : t('mk.dialog_title')}
              </DialogTitle>
            </DialogHeader>
            <DetallOfertaReceptor oferta={obert} foto={foto(obert, true)} />

            {mode === 'interes' && (
              <>
                <p className="text-sm text-muted-foreground">{t('mk.dialog_desc')}</p>
                {/* Parte ya asignada: los kilos que pida pueden no caber enteros, y decirlo
                    ahora evita que lo descubra cuando el equipo le asigne menos. */}
                {obert.estado === 'parcial' && (
                  <p className="rounded-md bg-aviso-fondo p-2 text-sm text-aviso">{t('mk.parcial')}</p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="mk-kg" className="mb-1.5 block text-xs text-muted-foreground">{t('mk.kg')}</Label>
                    <Input id="mk-kg" name="kg" type="number" min="1"
                      max={obert.kg_total != null ? String(obert.kg_total) : undefined}
                      value={kg} onChange={(e) => setKg(e.target.value)} />
                    {obert.kg_total != null && (
                      <p className="mt-1 text-xs text-muted-foreground">{t('mk.max_kg', { n: kgFmt(obert.kg_total) })}</p>
                    )}
                  </div>
                  {obertVenda && (
                    <div>
                      <Label htmlFor="mk-preu" className="mb-1.5 block text-xs text-muted-foreground">
                        {preuMinim ? t('mk.price', { min: preuMinim }) : t('mk.price_free')}
                      </Label>
                      <Input id="mk-preu" name="preu" type="number" step="0.01" value={preu}
                        onChange={(e) => setPreu(e.target.value)} />
                    </div>
                  )}
                </div>
              </>
            )}

            {!obertPunt && obertMotiu && (
              <p className="text-sm text-error">{t(obertMotiu)}</p>
            )}
            <DialogFooter>
              {mode === 'interes' ? (
                <Button className="h-11 md:h-9" onClick={() => void envia()}
                  disabled={enviant || obertMotiu !== null}>
                  {enviant ? t('c.sending') : t('mk.send')}
                </Button>
              ) : obertPunt ? (
                <BadgeEstat clase={estatSimpleInteres(obertPunt).clase}>
                  {t(estatSimpleInteres(obertPunt).key)}
                </BadgeEstat>
              ) : (
                <Button
                  className="h-11 md:h-9"
                  disabled={obertMotiu !== null}
                  title={obertMotiu ? t(obertMotiu) : undefined}
                  onClick={() => setMode('interes')}
                >{t('mk.interested')}</Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  )
}
