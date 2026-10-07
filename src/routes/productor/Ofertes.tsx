// Ofertas del productor: inicio (resumen) y listado.
//
// Son las mismas `excedentes` que ve el equipo, filtradas por RLS a las suyas: no hay
// una segunda fuente de datos ni una copia del estado. El progreso y los badges
// reutilizan el mismo criterio visual que OffersList.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, PlusCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { nombre } from '../../lib/format'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { carregaProgresOfertes, perOferta } from '../../lib/progresOfertes'
import { marcaLlegits } from '../../lib/avisos'
import { carregaPendents } from '../../lib/pendents'
import type { ProgresOferta } from '../../lib/progresOfertes'
import {
  estatSimpleOferta, llegendaSimpleOferta, ofertaEnCurs, puntOferta,
} from '../../lib/procesOferta'
import type { PuntProces } from '../../lib/procesOferta'
import LlegendaEstats from '../../components/proces/LlegendaEstats'
import BadgeEstat from '../../components/proces/BadgeEstat'
import { FotoOfertaResolta, useFotosOfertes } from '../../components/FotosOferta'
import type { FotoResolta } from '../../components/FotosOferta'
import type { EstadoAlbaran, Excedente } from '../../types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Lo que cuenta el estado de una oferta, además del propio excedente: su albarán de
 * recepción (el papel dice si ya se ha recogido y si está conciliada) y el embudo de
 * interés (cuántas entidades la han pedido). Se cargan con UNA consulta cada uno para
 * todas las ofertas, nunca una por oferta (§12.5).
 */
interface RecResum { id: string; estado: EstadoAlbaran; numero: string | null; diesEsperant: number | null }

/** Hook compartido por las dos pantallas: las ofertas de mi organización. */
function useMevesOfertes(productorId: string | null) {
  const [ofertes, setOfertes] = useState<Excedente[]>([])
  const [kg, setKg] = useState<Record<string, number>>({})
  /** Cuántos destinos (canalizaciones) tiene cada oferta: una oferta puede ir a varios. */
  const [destins, setDestins] = useState<Record<string, number>>({})
  const [recs, setRecs] = useState<Record<string, RecResum>>({})
  const [progres, setProgres] = useState<Record<string, ProgresOferta>>({})
  /** Los REC que esperan la confirmación de esta organización (`pendents_meus`). */
  const [recsPendents, setRecsPendents] = useState<Set<string>>(new Set())
  const [carregant, setCarregant] = useState(true)
  /** Un fallo de carga NO es «no tienes ofertas»: antes se pintaba el estado vacío. */
  const [errorCarrega, setErrorCarrega] = useState(false)

  /**
   * Los ids de mis ofertas, para poder decidir si un evento de `canalizaciones` me toca.
   * En una `ref` y no en el estado: solo lo lee el manejador de Realtime, y meterlo en las
   * dependencias del efecto lo volvería a suscribir con cada recarga.
   */
  const meusIds = useRef<Set<string>>(new Set())

  /** ¿Esta fila de `canalizaciones` cuelga de una de mis ofertas? */
  function esMeva(fila: Record<string, unknown> | undefined): boolean {
    const id = fila?.excedente_id
    return typeof id === 'string' && meusIds.current.has(id)
  }

  const carrega = useCallback(async () => {
    if (!productorId) { setCarregant(false); return }
    const { data, error } = await supabase
      .from('excedentes').select('*')
      .eq('productor_id', productorId)
      .order('created_at', { ascending: false })
    if (error) { setErrorCarrega(true); setCarregant(false); return }
    setErrorCarrega(false)
    const files = (data ?? []) as Excedente[]
    const ids = files.map((o) => o.id)
    meusIds.current = new Set(ids)
    const espIds = [...new Set(files.map((o) => o.espigolada_id).filter((v): v is string => !!v))]

    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46). Sin `.eq()` de organización
    // en el albarán: la RLS ya devuelve solo lo suyo, y nunca los borradores.
    const [c, a, p, pend] = ids.length === 0
      ? [null, null, null, null]
      : await Promise.all([
        supabase.from('canalizaciones').select('excedente_id, kg_confirmados').in('excedente_id', ids),
        // El REC de una ESPIGOLADA no cuelga de la oferta sino de la jornada
        // (`espigolada_id`): sin buscarlo también por ahí, una oferta convertida y ya
        // conciliada se quedaba en «Espera el contacte de l'equip» (28-09-2026).
        supabase.from('v_albaranes_bandeja')
          .select('id, excedente_id, espigolada_id, estado, numero_completo, dias_esperando, emitido_at')
          .eq('tipo', 'REC')
          .or(`excedente_id.in.(${ids.join(',')})${espIds.length ? `,espigolada_id.in.(${espIds.join(',')})` : ''}`)
          .order('emitido_at', { ascending: false, nullsFirst: true }),
        carregaProgresOfertes(),
        // Lo que espera SU confirmación: sin esto, una oferta con el REC por confirmar salía
        // en la lista sin el ámbar de «et toca a tu», al revés que en el detalle.
        carregaPendents(),
      ])

    // Los kilos y el REC deciden el estado que se pinta: sin ellos una oferta recogida
    // saldría «Buscant sortida». Un fallo aquí es un fallo de carga, no «0 kg».
    if (c?.error || a?.error) {
      console.warn('MevesOfertes:', (c?.error ?? a?.error)?.message)
      setErrorCarrega(true)
      setCarregant(false)
      return
    }

    const kgs: Record<string, number> = {}
    const ns: Record<string, number> = {}
    for (const f of ((c?.data ?? []) as { excedente_id: string | null; kg_confirmados: number | null }[])) {
      if (!f.excedente_id) continue
      kgs[f.excedente_id] = (kgs[f.excedente_id] ?? 0) + Number(f.kg_confirmados ?? 0)
      ns[f.excedente_id] = (ns[f.excedente_id] ?? 0) + 1
    }
    // El REC vigente de cada oferta es el primero de la lista, igual que en el detalle
    // (`OfertaDetall`): así el badge de la lista y la etapa del detalle no pueden discrepar.
    const rs: Record<string, RecResum> = {}
    for (const r of ((a?.data ?? []) as {
      id: string; excedente_id: string | null; espigolada_id: string | null; estado: string
      numero_completo: string | null; dias_esperando: number | null
    }[])) {
      // De una espigolada, el REC vale para todas las ofertas de esa jornada.
      const destins = r.excedente_id
        ? [r.excedente_id]
        : files.filter((o) => r.espigolada_id && o.espigolada_id === r.espigolada_id).map((o) => o.id)
      for (const eid of destins) {
        if (rs[eid]) continue
        rs[eid] = {
          id: r.id, estado: r.estado as EstadoAlbaran, numero: r.numero_completo, diesEsperant: r.dias_esperando,
        }
      }
    }

    setOfertes(files)
    setKg(kgs)
    setDestins(ns)
    setRecs(rs)
    // La RPC «nunca lanza»: sin ella se pierde el matiz «en gestió», no la pantalla.
    setProgres(p && p.ok ? perOferta(p.data) : {})
    setRecsPendents(new Set(pend && pend.ok
      ? pend.data.filter((x) => x.proposito === 'confirmacion_albaran' && x.tipo_org === 'productor').map((x) => x.objeto_id)
      : []))
    setCarregant(false)
  }, [productorId])

  // Entrar en «Les meves ofertes» da por leídos los avisos de ofertas (05-10-2026): el
  // badge del menú baja aquí, que es donde se ve el estado de cada una.
  useEffect(() => { void marcaLlegits({ objecteTipo: 'excedente' }) }, [])

  useEffect(() => {
    void carrega()
    if (!productorId) return
    const canal = supabase
      .channel(`meves-ofertes-${productorId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'excedentes', filter: `productor_id=eq.${productorId}` },
        () => void carrega())
      // ⚠️ `canalizaciones` NO tiene `productor_id`, así que no se puede acotar con el
      // `filter` del servidor como su hermana de arriba: un filtro de Realtime es una sola
      // comparación sobre una columna de la propia tabla. Lo que sí sabe la fila es de qué
      // excedente es, así que el evento se descarta aquí cuando no es de ninguna de mis
      // ofertas — antes, la canalización de cualquier productor recargaba la pantalla de
      // todos los que tuvieran la suya abierta (§12.5).
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'canalizaciones' },
        (payload) => { if (esMeva(payload.new)) void carrega() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'canalizaciones' },
        (payload) => { if (esMeva(payload.new) || esMeva(payload.old)) void carrega() })
      // El DELETE se queda sin guarda a propósito: con la replica identity por defecto solo
      // viaja la clave primaria (§12.24), así que no hay `excedente_id` con el que decidir.
      // Borrar una canalización es excepcional; una recarga de más no hace daño, y perderse
      // la que sí era mía dejaría los kilos mal en pantalla.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'canalizaciones' },
        () => void carrega())
      .subscribe()
    return () => { void supabase.removeChannel(canal) }
  }, [carrega, productorId])

  /** El punto del proceso de una oferta, con todo lo que la lista sabe de ella. */
  const puntDe = useCallback((o: Excedente): PuntProces => {
    const pr = progres[o.id]
    return puntOferta({
      estado: o.estado,
      kgTotal: Number(o.kg_total ?? 0),
      kgCanalitzats: kg[o.id] ?? 0,
      nInteressades: pr?.n_interessades,
      nPerAprovar: pr?.n_per_aprovar,
      albaraRec: recs[o.id] ?? null,
      motiu: o.motivo_no_colocada ?? null,
      pendentDeMi: recs[o.id] ? recsPendents.has(recs[o.id].id) : false,
    }, 'productor')
  }, [kg, progres, recs, recsPendents])

  return { ofertes, kg, destins, puntDe, carregant, errorCarrega }
}

/** «1.320» y no «1320»: los kilos se leen de un vistazo, y ahí los miles importan. Sin decimales. */
const fmtKg = (n: number) => nombre(n, 0)

function FilaOferta({
  o, canalitzats, punt, ambCodi, foto,
}: { o: Excedente; canalitzats: number; punt: PuntProces; ambCodi?: boolean; foto?: FotoResolta }) {
  const { t } = useT()
  const total = Number(o.kg_total ?? 0)
  const falten = Math.max(0, total - canalitzats)
  const pct = total > 0 ? Math.min(100, Math.round((canalitzats / total) * 100)) : 0
  const est = estatSimpleOferta(punt)

  return (
    <Link
      to={`/productor/ofertes/${o.id}`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40"
    >
      <div className="flex min-w-0 items-center gap-3">
        {foto && <FotoOfertaResolta foto={foto} alt={o.producto ?? ''} className="size-12" />}
        <div className="min-w-0">
          <div className="font-medium">
            {o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}
          </div>
          {ambCodi && <div className="text-xs text-muted-foreground"><code>{o.id_excedente ?? '—'}</code></div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* Una oferta que ya no busca salida (cancelada o sin destino) no tiene progreso
            que enseñar: «0 de 40 kg · falten 40» sugiere que todavía se espera algo. */}
        {est.estat === 'cancellada' || est.estat === 'sense_sortida'
          ? <span className="text-xs text-muted-foreground tabular-nums">{t('pi.kg_offered', { n: fmtKg(total) })}</span>
          : (
            <div>
              <div className="h-2.5 w-32 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-exito" style={{ width: `${pct}%` }} />
              </div>
              <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
                {t('pi.kg_of', { n: fmtKg(canalitzats), m: fmtKg(total) })}
                {' · '}{falten > 0 ? t('off.falten', { n: fmtKg(falten) }) : t('off.complet')}
              </span>
            </div>
          )}
        <BadgeEstat clase={est.clase} gran={ambCodi}>{t(est.key)}</BadgeEstat>
      </div>
    </Link>
  )
}

/**
 * Lo que hay cuando todavía no hay nada: el patrón de `design/DESIGN.md §6` —isotipo,
 * título, una frase y el botón que crea el primer elemento, dentro de una tarjeta con
 * borde discontinuo—. Antes era una línea gris sin ninguna salida, que en la pantalla de
 * inicio de un productor nuevo es justo donde más falta hace una.
 */
function CapOferta() {
  const { t } = useT()
  const navigate = useNavigate()
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        {/* El isotipo se usa tal cual: sobre el logo no se aplican filtros ni recoloreos
            (design/DESIGN.md §4). */}
        <img src="/isotipo-redestina.svg" alt="" aria-hidden width={48} height={48} className="h-12 w-auto" />
        <h2 className="font-titulos text-lg font-semibold">{t('pi.empty_title')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t('pi.empty_desc')}</p>
        <Button
          className="h-11 whitespace-normal md:h-9"
          onClick={() => navigate('/productor/ofertes/nova')}
        >
          <PlusCircle className="size-4" /> {t('pi.empty_cta')}
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * Las ofertas que siguen en marcha, cada una con lo que hace falta saber de un vistazo:
 * producto, kilos, situación, cuánto ha encontrado salida y qué toca ahora (revisión del
 * 23-09-2026). El «qué toca» lo cuenta `procesOferta.ts`, el mismo que el detalle.
 *
 * ⚠️ QUÉ NO SE ENSEÑA: a qué entidades va. `progres_meves_ofertes()` y la RLS dan
 *    cuántos destinos, nunca cuáles (20270323100000); aquí se dice el número y basta.
 */
function QuePassaAmbLesMeves({
  ofertes, kg, destins, puntDe, foto,
}: {
  ofertes: Excedente[]
  kg: Record<string, number>
  destins: Record<string, number>
  puntDe: (o: Excedente) => PuntProces
  foto: (o: Excedente) => FotoResolta
}) {
  const { t } = useT()
  if (ofertes.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('pi.process_title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('pi.process_hint')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {ofertes.map((o) => {
          const punt = puntDe(o)
          const est = estatSimpleOferta(punt)
          const total = Number(o.kg_total ?? 0)
          const amb = kg[o.id] ?? 0
          const falten = Math.max(0, total - amb)
          const nDestins = destins[o.id] ?? 0
          const toca = t(punt.claus.toca, punt.vars).trim()
          return (
            <Link
              key={o.id}
              to={`/productor/ofertes/${o.id}`}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/40"
            >
              {/* La misma foto que en el histórico de abajo (fotoOferta.ts): sin ella, las
                  ofertas en curso —las que más se miran— eran las únicas sin imagen. */}
              <FotoOfertaResolta foto={foto(o)} alt={o.producto ?? ''} className="size-12" />
              <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 font-medium">
                  {o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}
                  <span className="ml-2 font-normal text-muted-foreground tabular-nums">{fmtKg(total)} kg</span>
                </div>
                <BadgeEstat clase={est.clase}>{t(est.key)}</BadgeEstat>
              </div>
              {/* Cuánto ha encontrado salida y cuánto queda: el dato que más pregunta el
                  productor, y que antes solo se veía entrando en el detalle. */}
              <p className="mt-1 text-sm tabular-nums">
                {amb > 0
                  ? t('pi.split', { n: fmtKg(amb), m: fmtKg(falten) })
                  : t('pi.split_none', { m: fmtKg(falten) })}
                {nDestins > 1 ? ` · ${t('pi.n_destins', { n: nDestins })}` : ''}
              </p>
              {toca && toca !== '—' && toca !== punt.claus.toca && (
                <p className={cn(
                  'mt-1 flex items-start gap-1 text-sm',
                  punt.emToca ? 'font-medium text-aviso' : 'text-muted-foreground',
                )}>
                  <ArrowRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {toca}
                </p>
              )}
              </div>
            </Link>
          )
        })}
      </CardContent>
    </Card>
  )
}

/** El año en curso en hora de Madrid, que es la del servicio (no la del navegador). */
function anyActual(): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(new Date()))
}
function anyDe(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(new Date(iso)))
}

export function ProductorInici() {
  const { t } = useT()
  const navigate = useNavigate()
  const organitzacio = useOrganitzacio('productor')
  const productorId = organitzacio?.id ?? null
  const { ofertes, kg, destins, puntDe, carregant, errorCarrega } = useMevesOfertes(productorId)
  const foto = useFotosOfertes(ofertes)

  // Las dos secciones ya NO se solapan (revisión del 23-09-2026): arriba lo que está en
  // marcha —pide atención o se está gestionando—, abajo lo que ya es historia. Antes las
  // dos listaban las mismas ofertas y parecían hacer lo mismo.
  const enCurs = ofertes.filter((o) => ofertaEnCurs(estatSimpleOferta(puntDe(o)).estat))
  const historic = ofertes.filter((o) => !ofertaEnCurs(estatSimpleOferta(puntDe(o)).estat))

  // Los kilos canalizados, SIEMPRE con su año: «1.320 kg» sin fecha no dice si es de este
  // año o de toda la vida. Cuenta el año de la oferta, en hora de Madrid.
  const any = anyActual()
  const canalitzatsAny = ofertes
    .filter((o) => anyDe(o.created_at) === any)
    .reduce((s, o) => s + (kg[o.id] ?? 0), 0)
  const pendents = enCurs.reduce(
    (s, o) => s + Math.max(0, Number(o.kg_total ?? 0) - (kg[o.id] ?? 0)), 0)
  const buit = !carregant && !errorCarrega && ofertes.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('pi.title', { x: organitzacio?.nombre ?? '' })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pi.subtitle')}</p>
      </div>

      {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
      {!carregant && errorCarrega && <p className="text-sm text-destructive">{t('po.err_load')}</p>}

      {/* Sin ninguna oferta, los tres contadores a cero y la lista vacía solo repiten lo
          mismo tres veces: se enseña el estado vacío y nada más. */}
      {buit && <CapOferta />}

      {!carregant && !errorCarrega && !buit && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card><CardContent className="pt-6">
              <div className="text-3xl font-bold text-primary tabular-nums">{enCurs.length}</div>
              <p className="mt-1 text-sm text-muted-foreground">{t('pi.active_offers')}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-3xl font-bold text-primary tabular-nums">{fmtKg(canalitzatsAny)}</div>
              <p className="mt-1 text-sm text-muted-foreground">{t('pi.kg_channeled_year', { any })}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-3xl font-bold text-primary tabular-nums">{fmtKg(pendents)}</div>
              <p className="mt-1 text-sm text-muted-foreground">{t('pi.kg_pending')}</p>
            </CardContent></Card>
          </div>

          <QuePassaAmbLesMeves ofertes={enCurs} kg={kg} destins={destins} puntDe={puntDe} foto={foto} />

          <Button
            className="h-11 whitespace-normal md:h-9"
            onClick={() => navigate('/productor/ofertes/nova')}
          >
            <PlusCircle className="size-4" /> {t('nav.new_offer')}
          </Button>

          {historic.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{t('pi.recent')}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{t('pi.recent_hint')}</p>
                </div>
                <Link to="/productor/ofertes" className="text-sm font-medium text-primary hover:underline">
                  {t('pi.see_all')}
                </Link>
              </CardHeader>
              <CardContent className="space-y-2">
                {historic.slice(0, 5).map((o) => (
                  <FilaOferta key={o.id} o={o} canalitzats={kg[o.id] ?? 0} punt={puntDe(o)} foto={foto(o)} />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

export function ProductorOfertes() {
  const { t } = useT()
  const navigate = useNavigate()
  const organitzacio = useOrganitzacio('productor')
  const productorId = organitzacio?.id ?? null
  const { ofertes, kg, puntDe, carregant, errorCarrega } = useMevesOfertes(productorId)
  const foto = useFotosOfertes(ofertes)

  return (
    <Card>
      {/* `flex-wrap` y el botón a lo ancho en móvil: con `shrink-0` de serie, en la misma
          fila aplastaba el título y la leyenda a 320 px (§2, regla 4). */}
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <CardTitle>{t('po.list_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('po.list_subtitle')}</p>
          {/* Plegada: quien conoce el circuito no necesita releer las frases cada vez, y
              quien no lo conoce tiene aquí qué significa cada estado. */}
          <LlegendaEstats items={llegendaSimpleOferta()} ambPunt />
        </div>
        <Button
          className="h-11 w-full whitespace-normal sm:w-auto md:h-9"
          onClick={() => navigate('/productor/ofertes/nova')}
        >
          <PlusCircle className="size-4" /> {t('nav.new_offer')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && errorCarrega && <p className="text-sm text-destructive">{t('po.err_load')}</p>}
        {!carregant && !errorCarrega && ofertes.length === 0 && <CapOferta />}
        {ofertes.map((o) => (
          <FilaOferta key={o.id} o={o} canalitzats={kg[o.id] ?? 0} punt={puntDe(o)} ambCodi
            foto={foto(o)} />
        ))}
      </CardContent>
    </Card>
  )
}
