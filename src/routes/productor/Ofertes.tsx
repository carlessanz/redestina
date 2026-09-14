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
import { useOrganitzacio } from '../../hooks/useAppContext'
import { kgPerOferta } from '../../lib/ofertes'
import { etiquetaEstatOferta, llegendaOferta, puntOferta } from '../../lib/procesOferta'
import LlegendaEstats from '../../components/proces/LlegendaEstats'
import type { Excedente } from '../../types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const ACTIVES = ['borrador', 'publicada', 'parcial', 'bloqueada']

/** Hook compartido por las dos pantallas: las ofertas de mi organización. */
function useMevesOfertes(productorId: string | null) {
  const [ofertes, setOfertes] = useState<Excedente[]>([])
  const [kg, setKg] = useState<Record<string, number>>({})
  const [carregant, setCarregant] = useState(true)

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
    const { data } = await supabase
      .from('excedentes').select('*')
      .eq('productor_id', productorId)
      .order('created_at', { ascending: false })
    const files = (data ?? []) as Excedente[]
    setOfertes(files)
    meusIds.current = new Set(files.map((o) => o.id))
    setKg(await kgPerOferta(files.map((o) => o.id)))
    setCarregant(false)
  }, [productorId])

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


  return { ofertes, kg, carregant }
}

function FilaOferta({ o, canalitzats }: { o: Excedente; canalitzats: number }) {
  const { t } = useT()
  const total = Number(o.kg_total ?? 0)
  const falten = Math.max(0, total - canalitzats)
  const pct = total > 0 ? Math.min(100, Math.round((canalitzats / total) * 100)) : 0
  const est = etiquetaEstatOferta(o.estado)

  return (
    <Link
      to={`/productor/ofertes/${o.id}`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40"
    >
      <div className="min-w-0">
        <div className="font-medium">
          {o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}
        </div>
        <div className="text-xs text-muted-foreground"><code>{o.id_excedente ?? '—'}</code></div>
      </div>
      <div className="flex items-center gap-3">
        <div>
          <div className="h-2 w-28 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-exito" style={{ width: `${pct}%` }} />
          </div>
          <span className="mt-1 block text-xs text-muted-foreground">
            {canalitzats}/{total} kg · {falten > 0 ? t('off.falten', { n: falten }) : t('off.complet')}
          </span>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', est.clase)}>{t(est.key)}</span>
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
 * Una línea por oferta activa con lo que está pasando con ella, contado por
 * `procesOferta.ts`.
 *
 * Aquí NO se piden ni el albarán ni el embudo: con el estado del excedente y los kilos
 * basta para las dos primeras etapas, que es donde está casi siempre lo que se publica, y
 * el detalle —que sí los carga— completa el resto. Una consulta por oferta en la pantalla
 * de inicio sería el problema de la deuda §12.5 otra vez.
 */
function QuePassaAmbLesMeves({ ofertes, kg }: { ofertes: Excedente[]; kg: Record<string, number> }) {
  const { t } = useT()
  if (ofertes.length === 0) return null

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('pi.process_title')}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {ofertes.map((o) => {
          const punt = puntOferta({
            estado: o.estado,
            kgTotal: Number(o.kg_total ?? 0),
            kgCanalitzats: kg[o.id] ?? 0,
          }, 'productor')
          return (
            <Link
              key={o.id}
              to={`/productor/ofertes/${o.id}`}
              className="flex items-start justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t(punt.claus.toca, punt.vars)}
                </p>
              </div>
              <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function ProductorInici() {
  const { t } = useT()
  const navigate = useNavigate()
  const organitzacio = useOrganitzacio('productor')
  const productorId = organitzacio?.id ?? null
  const { ofertes, kg, carregant } = useMevesOfertes(productorId)

  const actives = ofertes.filter((o) => ACTIVES.includes(o.estado))
  const canalitzatsTotal = Object.values(kg).reduce((s, n) => s + n, 0)
  const pendents = actives.reduce(
    (s, o) => s + Math.max(0, Number(o.kg_total ?? 0) - (kg[o.id] ?? 0)), 0)
  const buit = !carregant && ofertes.length === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('pi.title', { x: organitzacio?.nombre ?? '' })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pi.subtitle')}</p>
      </div>

      {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}

      {/* Sin ninguna oferta, los tres contadores a cero y la lista vacía solo repiten lo
          mismo tres veces: se enseña el estado vacío y nada más. */}
      {buit && <CapOferta />}

      {!carregant && !buit && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="pt-6">
              <div className="text-3xl font-bold text-primary">{actives.length}</div>
              <p className="mt-1 text-sm text-muted-foreground">{t('pi.active_offers')}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-3xl font-bold text-primary">{canalitzatsTotal}</div>
              <p className="mt-1 text-sm text-muted-foreground">{t('pi.kg_channeled')}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-3xl font-bold text-primary">{pendents}</div>
              <p className="mt-1 text-sm text-muted-foreground">{t('pi.kg_pending')}</p>
            </CardContent></Card>
          </div>

          <QuePassaAmbLesMeves ofertes={actives} kg={kg} />

          <Button
            className="h-11 whitespace-normal md:h-9"
            onClick={() => navigate('/productor/ofertes/nova')}
          >
            <PlusCircle className="size-4" /> {t('nav.new_offer')}
          </Button>

          <Card>
            <CardHeader><CardTitle className="text-base">{t('pi.recent')}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {ofertes.slice(0, 5).map((o) => (
                <FilaOferta key={o.id} o={o} canalitzats={kg[o.id] ?? 0} />
              ))}
            </CardContent>
          </Card>
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
  const { ofertes, kg, carregant } = useMevesOfertes(productorId)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t('po.list_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('po.list_subtitle')}</p>
          {/* Plegada: quien conoce el circuito no necesita releer siete frases cada vez,
              y quien no lo conoce no tenía hasta ahora dónde preguntar qué es «Coberta». */}
          <LlegendaEstats items={llegendaOferta()} />
        </div>
        <Button
          className="h-11 whitespace-normal md:h-9"
          onClick={() => navigate('/productor/ofertes/nova')}
        >
          <PlusCircle className="size-4" /> {t('nav.new_offer')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && ofertes.length === 0 && <CapOferta />}
        {ofertes.map((o) => <FilaOferta key={o.id} o={o} canalitzats={kg[o.id] ?? 0} />)}
      </CardContent>
    </Card>
  )
}
