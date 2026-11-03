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

import { useSearchParams } from 'react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { filtraCerca } from '../lib/cerca'
import { categoriaDeFamilia } from '../lib/filtresMercat'
import { filtraLlistat, opcionsDisponibles, ordenaPerDisponibilitat, type Dimensio } from '../lib/filtres'
import { useFiltresLlistat } from '../hooks/useFiltresLlistat'
import BarraFiltres from './BarraFiltres'
import Desplegable from './Desplegable'
import { kg as fmtKg } from '../lib/format'
import { useCerca } from '../hooks/useCerca'
import { etiquetaEstatOferta, llegendaOferta } from '../lib/procesOferta'
import LlegendaEstats from './proces/LlegendaEstats'
import type { Excedente } from '../types'
import CarregantSeccio from './CarregantSeccio'
import BotoIcona from './BotoIcona'
import { FotoOfertaResolta, useFotosOfertes } from './FotosOferta'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Props {
  onOpen: (excedente: Excedente) => void
  /** Un botón de cabecera opcional: «Nova oferta» en el panel del equipo (05-10-2026). */
  accio?: ReactNode
}

type KgPorExcedente = Record<string, number>
const ACTIVOS = ['borrador', 'pendent_validacio', 'publicada', 'parcial', 'bloqueada']
const TANCADES = ['cerrada', 'no_colocada', 'cancelada']

/**
 * Las cerradas se traen ACOTADAS a 200: es un archivo que crece sin techo y nadie lo lee
 * entero, se busca dentro. La paginación de verdad sigue pendiente (§12.5), y por eso el
 * tope va con su aviso en pantalla en vez de recortar en silencio.
 */
const TOPE_TANCADES = 200

/**
 * Cuánto se espera antes de recargar por un evento de Realtime (§12.5).
 *
 * Una sola acción del equipo escribe VARIAS filas seguidas —aprobar un interés toca
 * `canalizaciones` y `excedentes` en la misma transacción, y repartir una espigolada
 * inserta una canalización por lote—, así que con una recarga por evento la pantalla
 * pedía tres consultas completas por cada fila que cambiaba. Se coalescen: solo se
 * recarga una vez, tras el último evento de la ráfaga.
 *
 * ⚠️ No afecta a la carga inicial, que sigue siendo inmediata: el debounce vive solo en
 * el manejador de la suscripción.
 */
const ESPERA_RECARREGA_MS = 400


export default function OffersList({ onOpen, accio }: Props) {
  const { t } = useT()
  const [actives, setActives] = useState<Excedente[]>([])
  const [tancades, setTancades] = useState<Excedente[]>([])
  const [kg, setKg] = useState<KgPorExcedente>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { cerca, setCerca, q } = useCerca()

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
    // Una ráfaga de eventos = una sola recarga, la de después del último (ESPERA_RECARREGA_MS).
    let temporitzador: ReturnType<typeof setTimeout> | undefined
    const recarrega = () => {
      if (temporitzador !== undefined) clearTimeout(temporitzador)
      temporitzador = setTimeout(() => { void load() }, ESPERA_RECARREGA_MS)
    }
    const channel = supabase
      .channel('redestina-ofertas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'excedentes' }, recarrega)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'canalizaciones' }, recarrega)
      .subscribe()
    return () => {
      // El timeout también se limpia al desmontar: si no, una recarga pendiente llamaría a
      // `load()` con el componente fuera y dejaría estado escrito sobre nada.
      if (temporitzador !== undefined) clearTimeout(temporitzador)
      void supabase.removeChannel(channel)
    }
  }, [load])

  // Filtros y orden comunes (fase 6): zona, tipo de producto, producto, modalidad y fecha
  // de alta, más el orden «disponibilidad» o «más recientes». Se aplican a las cuatro
  // pestañas por igual, después del buscador.
  const f = useFiltresLlistat('equip-ofertes')
  const [ordre, setOrdre] = useState<'disponibilitat' | 'recent'>('disponibilitat')
  const dims = useMemo<Dimensio<Excedente>[]>(() => [
    { clau: 'comarca', etiquetaKey: 'fl.d_comarca', valor: (o) => o.comarca },
    { clau: 'categoria', etiquetaKey: 'fl.d_categoria', valor: (o) => categoriaDeFamilia(o.familia) },
    { clau: 'producte', etiquetaKey: 'fl.d_producte', valor: (o) => o.producto },
    { clau: 'modalitat', etiquetaKey: 'fl.d_modalitat', valor: (o) => o.modalitat },
  ], [])
  const rang = useMemo(() => ({ data: (o: Excedente) => o.created_at, desDe: f.desDe, finsA: f.finsA }), [f.desDe, f.finsA])

  const filtra = useCallback((files: Excedente[]) => {
    const r = filtraLlistat(filtraCerca(files, q,
      (o) => [o.id_excedente, o.producto, o.variedad, t(etiquetaEstatOferta(o.estado).key)]), dims, f.valors, rang)
    return ordre === 'disponibilitat'
      ? ordenaPerDisponibilitat(r, (o) => ACTIVOS.includes(o.estado))
      : [...r].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  }, [q, t, dims, f.valors, rang, ordre])

  // La miniatura, con la misma regla que el resto de listas (fotoOferta.ts): la foto
  // propia, la del producto o el icono de su familia. Firmada en lote para las dos pestañas.
  const totes = useMemo(() => [...actives, ...tancades], [actives, tancades])
  const foto = useFotosOfertes(totes)

  const grups = useMemo(() => ({
    // Las que esperan a que el equipo las valide (05-10-2026): son también activas, y esta
    // pestaña es a donde manda el badge del menú y la cola del tablero.
    validar: filtra(actives.filter((o) => o.estado === 'pendent_validacio')),
    actives: filtra(actives),
    tancades: filtra(tancades),
    totes: filtra([...actives, ...tancades]),
  }), [actives, tancades, filtra])

  function taula(files: Excedente[], buitKey: string) {
    if (files.length === 0) return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    // El criterio de las tablas (03-11-2026, AGENTS.md §2): cabe sin scroll horizontal. En
    // móvil quedan producto, estado y la acción; la referencia y los kilos van bajo el
    // nombre hasta que tienen su columna (progreso desde `md`, referencia desde `xl`), y la
    // miniatura aparece desde `sm`. Títulos centrados y la acción en icono con tooltip.
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden xl:table-cell">{t('off.c_ref')}</TableHead>
            <TableHead>{t('off.c_product')}</TableHead>
            <TableHead className="hidden w-44 md:table-cell">{t('off.c_progress')}</TableHead>
            <TableHead className="w-28 sm:w-36">{t('off.c_state')}</TableHead>
            <TableHead className="w-15 md:w-16"><span className="sr-only">{t('doc.c_actions')}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((o) => {
            const total = Number(o.kg_total ?? 0)
            const canalizados = kg[o.id] ?? 0
            const faltan = Math.max(0, total - canalizados)
            const pct = total > 0 ? Math.min(100, Math.round((canalizados / total) * 100)) : 0
            const est = etiquetaEstatOferta(o.estado)
            const resumKg = `${fmtKg(canalizados)}/${fmtKg(total)} kg · ${faltan > 0 ? t('off.falten', { n: fmtKg(faltan) }) : t('off.complet')}`
            return (
              <TableRow key={o.id}>
                <TableCell className="hidden xl:table-cell"><code className="text-xs break-all">{o.id_excedente ?? '—'}</code></TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="hidden shrink-0 sm:block">
                      <FotoOfertaResolta foto={foto(o)} alt={o.producto ?? ''} className="size-10" />
                    </span>
                    <div className="min-w-0">
                      <span className="font-medium">{o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}</span>
                      <code className="block text-xs break-all text-muted-foreground xl:hidden">{o.id_excedente ?? '—'}</code>
                      <span className="block text-xs text-muted-foreground md:hidden">{resumKg}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="mx-auto h-2 w-36 max-w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-exito" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="mt-1 block text-center text-xs text-muted-foreground">{resumKg}</span>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    {/* `Badge` y no un `span` a mano: las clases eran exactamente las suyas
                        —`rounded-full px-2 py-0.5 text-xs font-medium`— copiadas, y una
                        tercera forma de pintar un badge es un sitio más donde el radio o el
                        tamaño pueden dejar de coincidir con el resto (§2bis). Parte línea
                        si no cabe: la columna es estrecha en móvil. */}
                    <Badge className={`${est.clase} max-w-full whitespace-normal`}>{t(est.key)}</Badge>
                    {/* F3. El listado es a donde manda la cola `espigolades_per_convertir`
                        del tablero, así que tiene que poder decir CUÁLES son: una oferta
                        con producto sin cosechar y sin jornada todavía. */}
                    {o.producte_al_camp && !o.espigolada_id && (
                      <Badge className="max-w-full bg-aviso-fondo whitespace-normal text-aviso">{t('conv_esp.tag')}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                    <BotoIcona icona={Eye} etiqueta={t('off.a_open')} onClick={() => onOpen(o)} />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  const senseCoincidencia = q !== ''
  const [params] = useSearchParams()
  const pestanyaInicial = params.get('tab')

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>{t('off.title_all')}</CardTitle>
          {accio}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('off.subtitle_all')}</p>
        <LlegendaEstats items={llegendaOferta()} />
      </CardHeader>
      <CardContent className="space-y-4">
        <Input type="search" placeholder={t('off.search')} value={cerca} onChange={(e) => setCerca(e.target.value)} />
        <BarraFiltres
          id="off"
          desplegables={dims.map((d) => ({
            clau: d.clau, etiquetaKey: d.etiquetaKey,
            opcions: opcionsDisponibles(totes, dims, d.clau, f.valors, rang),
            text: d.clau === 'modalitat' ? (v: string) => t(`od.mod_${v}`)
              : d.clau === 'categoria' ? (v: string) => t(v === 'altres' ? 'mk.f_other' : `pr.o_${v}`) : undefined,
          }))}
          valors={f.valors}
          onValors={f.setValors}
          rang={{ etiquetaKey: 'fl.r_alta', desDe: f.desDe, finsA: f.finsA, onCanvi: f.setRang }}
          mostrant={grups.totes.length}
          total={totes.length}
          extra={(
            <div className="min-w-0 space-y-1 md:w-44">
              <label htmlFor="off-ordre" className="text-xs text-muted-foreground">{t('fl.ordre')}</label>
              <Desplegable id="off-ordre" mida="sm" value={ordre}
                onChange={(v) => setOrdre(v === 'recent' ? 'recent' : 'disponibilitat')}
                opcions={[
                  { valor: 'disponibilitat', text: t('fl.o_disponibilitat') },
                  { valor: 'recent', text: t('fl.o_recent') },
                ]} />
            </div>
          )}
        />
        {loading && <CarregantSeccio files={5} ambCapcalera={false} />}
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}

        {!loading && !error && (
          <Tabs defaultValue={pestanyaInicial === 'validar' ? 'validar' : 'actives'}>
            {/* A 360 px tres etiquetas con su cifra van justas: la lista scrollea sola en
                vez de empujar la página entera hacia la derecha. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="validar">{t('off.tab_validar', { n: grups.validar.length })}</TabsTrigger>
                <TabsTrigger value="actives">{t('off.tab_active', { n: grups.actives.length })}</TabsTrigger>
                <TabsTrigger value="tancades">{t('off.tab_closed', { n: grups.tancades.length })}</TabsTrigger>
                <TabsTrigger value="totes">{t('off.tab_all', { n: grups.totes.length })}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="validar" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('off.validar_hint')}</p>
              {taula(grups.validar, senseCoincidencia ? 'off.no_match' : 'off.empty_validar')}
            </TabsContent>
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
