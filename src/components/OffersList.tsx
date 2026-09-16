// El listado de ofertas del equipo.
//
// HASTA HOY SOLO ENSEÑABA LAS ACTIVAS, y esa era la única puerta: una oferta cerrada,
// cancelada o no colocada **no era accesible desde ninguna pantalla** de la aplicación.
// Desaparecía del listado el día que se resolvía y, con ella, su texto, sus respuestas y
// sus canalizaciones; para volver a verla había que conocer su UUID. Las tres pestañas de
// abajo no añaden una vista nueva: recuperan el archivo que ya existía en la base.
//
// La pestaña «Tancades» no deja actuar sobre nada —no hay botones de acción en el detalle
// de una oferta cerrada— y lo dice antes de abrirla, para que nadie entre buscando dónde
// pulsar.
//
// EL BADGE SALE DE `etiquetaEstatOferta` (`procesOferta.ts`) y ya no de una copia local:
// había dos mapas idénticos —uno aquí, otro en el panel del productor— y dos sitios donde
// un estado nuevo podía caer en el color equivocado. La leyenda plegada explica los siete.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { etiquetaEstatOferta, llegendaOferta } from '../lib/procesOferta'
import LlegendaEstats from './proces/LlegendaEstats'
import type { Excedente } from '../types'
import CarregantSeccio from './CarregantSeccio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Props {
  onOpen: (excedente: Excedente) => void
}

type KgPorExcedente = Record<string, number>
const ACTIVOS = ['borrador', 'publicada', 'parcial', 'bloqueada']
const TANCADES = ['cerrada', 'no_colocada', 'cancelada']

/**
 * Las cerradas se traen ACOTADAS a 200: es un archivo que crece sin techo y nadie lo lee
 * entero, se busca dentro. La paginación de verdad sigue pendiente (§12.5), y por eso el
 * tope va con su aviso en pantalla en vez de recortar en silencio.
 */
const TOPE_TANCADES = 200

export default function OffersList({ onOpen }: Props) {
  const { t } = useT()
  const [actives, setActives] = useState<Excedente[]>([])
  const [tancades, setTancades] = useState<Excedente[]>([])
  const [kg, setKg] = useState<KgPorExcedente>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [ofertas, cerradas, canalizaciones] = await Promise.all([
      supabase.from('excedentes').select('*').in('estado', ACTIVOS).order('created_at', { ascending: false }),
      supabase.from('excedentes').select('*').in('estado', TANCADES)
        .order('created_at', { ascending: false }).limit(TOPE_TANCADES),
      supabase.from('canalizaciones').select('excedente_id, kg_confirmados'),
    ])
    if (ofertas.error) { setError(ofertas.error.message); setActives([]) }
    else setActives(ofertas.data ?? [])
    setTancades(cerradas.data ?? [])
    const acc: KgPorExcedente = {}
    for (const c of canalizaciones.data ?? []) {
      if (!c.excedente_id) continue
      acc[c.excedente_id] = (acc[c.excedente_id] ?? 0) + Number(c.kg_confirmados ?? 0)
    }
    setKg(acc)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel('redestina-ofertas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'excedentes' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'canalizaciones' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  const filtra = useCallback((files: Excedente[]) => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return files
    return files.filter((o) => {
      const campos = [o.id_excedente, o.producto, o.variedad, t(etiquetaEstatOferta(o.estado).key)]
      return campos.some((c) => (c ?? '').toLowerCase().includes(q))
    })
  }, [busqueda, t])

  const grups = useMemo(() => ({
    actives: filtra(actives),
    tancades: filtra(tancades),
    totes: filtra([...actives, ...tancades]),
  }), [actives, tancades, filtra])

  function taula(files: Excedente[], buitKey: string) {
    if (files.length === 0) return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('off.c_ref')}</TableHead>
              <TableHead>{t('off.c_product')}</TableHead>
              <TableHead>{t('off.c_progress')}</TableHead>
              <TableHead>{t('off.c_state')}</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((o) => {
              const total = Number(o.kg_total ?? 0)
              const canalizados = kg[o.id] ?? 0
              const faltan = Math.max(0, total - canalizados)
              const pct = total > 0 ? Math.min(100, Math.round((canalizados / total) * 100)) : 0
              const est = etiquetaEstatOferta(o.estado)
              return (
                <TableRow key={o.id}>
                  <TableCell><code className="text-xs">{o.id_excedente ?? '—'}</code></TableCell>
                  <TableCell>{o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}</TableCell>
                  <TableCell className="min-w-40">
                    <div className="h-2 w-36 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-exito" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {canalizados}/{total} kg · {faltan > 0 ? t('off.falten', { n: faltan }) : t('off.complet')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', est.clase)}>
                      {t(est.key)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" onClick={() => onOpen(o)}>{t('off.open')}</Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  const senseCoincidencia = busqueda.trim() !== ''

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('off.title_all')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('off.subtitle_all')}</p>
        <LlegendaEstats items={llegendaOferta()} />
      </CardHeader>
      <CardContent className="space-y-4">
        <Input type="search" placeholder={t('off.search')} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        {loading && <CarregantSeccio files={5} ambCapcalera={false} />}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && (
          <Tabs defaultValue="actives">
            {/* A 360 px tres etiquetas con su cifra van justas: la lista scrollea sola en
                vez de empujar la página entera hacia la derecha. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="actives">{t('off.tab_active', { n: grups.actives.length })}</TabsTrigger>
                <TabsTrigger value="tancades">{t('off.tab_closed', { n: grups.tancades.length })}</TabsTrigger>
                <TabsTrigger value="totes">{t('off.tab_all', { n: grups.totes.length })}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="actives" className="space-y-2">
              {taula(grups.actives, senseCoincidencia ? 'off.no_match' : 'off.empty_active')}
            </TabsContent>
            <TabsContent value="tancades" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('off.closed_hint')}</p>
              {tancades.length === TOPE_TANCADES && (
                <p className="text-sm text-muted-foreground">{t('off.closed_capped', { n: TOPE_TANCADES })}</p>
              )}
              {taula(grups.tancades, senseCoincidencia ? 'off.no_match' : 'off.empty_closed')}
            </TabsContent>
            <TabsContent value="totes" className="space-y-2">
              {taula(grups.totes, senseCoincidencia ? 'off.no_match' : 'off.empty_active')}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
