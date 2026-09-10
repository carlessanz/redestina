// Ofertas del productor: inicio (resumen) y listado.
//
// Son las mismas `excedentes` que ve el equipo, filtradas por RLS a las suyas: no hay
// una segunda fuente de datos ni una copia del estado. El progreso y los badges
// reutilizan el mismo criterio visual que OffersList.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PlusCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { kgPerOferta } from '../../lib/ofertes'
import type { Excedente } from '../../types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const ACTIVES = ['borrador', 'publicada', 'parcial', 'bloqueada']

export function estatEtiqueta(estado: string): { key: string; clase: string } {
  switch (estado) {
    case 'publicada': return { key: 'off.st_published', clase: 'bg-secondary text-secondary-foreground' }
    case 'parcial': return { key: 'off.st_partial', clase: 'bg-aviso-fondo text-aviso' }
    case 'bloqueada': return { key: 'off.st_blocked', clase: 'bg-exito-fondo text-exito' }
    case 'borrador': return { key: 'off.st_draft', clase: 'bg-muted text-muted-foreground' }
    case 'cancelada': return { key: 'off.st_cancelled', clase: 'bg-error-fondo text-error' }
    case 'no_colocada': return { key: 'off.st_uncoll', clase: 'bg-muted text-muted-foreground' }
    case 'cerrada': return { key: 'off.st_closed', clase: 'bg-muted text-muted-foreground' }
    default: return { key: estado, clase: 'bg-muted text-muted-foreground' }
  }
}

/** Hook compartido por las dos pantallas: las ofertas de mi organización. */
function useMevesOfertes(productorId: string | null) {
  const [ofertes, setOfertes] = useState<Excedente[]>([])
  const [kg, setKg] = useState<Record<string, number>>({})
  const [carregant, setCarregant] = useState(true)

  const carrega = useCallback(async () => {
    if (!productorId) { setCarregant(false); return }
    const { data } = await supabase
      .from('excedentes').select('*')
      .eq('productor_id', productorId)
      .order('created_at', { ascending: false })
    const files = (data ?? []) as Excedente[]
    setOfertes(files)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'canalizaciones' },
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
  const est = estatEtiqueta(o.estado)

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('pi.title', { x: organitzacio?.nombre ?? '' })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pi.subtitle')}</p>
      </div>

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

      <Button onClick={() => navigate('/productor/ofertes/nova')}>
        <PlusCircle className="size-4" /> {t('nav.new_offer')}
      </Button>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('pi.recent')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {!carregant && ofertes.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('pi.empty')}</p>
          )}
          {ofertes.slice(0, 5).map((o) => (
            <FilaOferta key={o.id} o={o} canalitzats={kg[o.id] ?? 0} />
          ))}
        </CardContent>
      </Card>
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
        </div>
        <Button onClick={() => navigate('/productor/ofertes/nova')}>
          <PlusCircle className="size-4" /> {t('nav.new_offer')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && ofertes.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('pi.empty')}</p>
        )}
        {ofertes.map((o) => <FilaOferta key={o.id} o={o} canalitzats={kg[o.id] ?? 0} />)}
      </CardContent>
    </Card>
  )
}
