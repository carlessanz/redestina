// El listado de ofertas del equipo.
//
// HASTA HOY SOLO ENSEÑABA LAS ACTIVAS, y esa era la única puerta: una oferta cerrada,
// cancelada o no colocada **no era accesible desde ninguna pantalla** de la aplicación.
// Desaparecía del listado el día que se resolvía y, con ella, su texto, sus respuestas y
// sus canalizaciones; para volver a verla había que conocer su UUID. Las pestañas de abajo
// no añaden una vista nueva: recuperan el archivo que ya existía en la base.
//
// EL BADGE SALE DE `etiquetaEstatOferta` (`procesOferta.ts`) y ya no de una copia local:
// había dos mapas idénticos —uno aquí, otro en el panel del productor— y dos sitios donde
// un estado nuevo podía caer en el color equivocado. La leyenda plegada explica los siete.
//
// ESBORRANYS (fase C del punto 3, 17-11-2026, fila 3.1.2): las ofertas a medio rellenar, del
// equipo (alta asistida) y de los productores, en su propia pestaña. No son ofertas todavía
// (no circulan, no tienen `E-…`). Abrir una lleva al formulario.
//
// PUNTOS 4-6, FASE 1 (19-11-2026):
//   · Cuatro pestañas —Per validar · Actives · Esborranys · Històric— y la pestaña vive en la
//     URL (`?tab=`, como Albarans), así que «atrás» desde el detalle vuelve a la misma.
//     «Totes» desaparece: mezclaba lo vivo con el archivo y nadie la usaba para trabajar.
//   · `no_colocada` es ACTIVA: todavía falta decir qué pasó con el producto.
//   · El Històric (cerrada y cancelada) se pagina EN EL SERVIDOR, de 25 en 25, con su buscador
//     y sus filtros también en el servidor: antes se traían las 200 más recientes y lo demás
//     no se podía encontrar.
//   · Bajo el badge, el PASO DEL PROCESO (`lib/llistatOfertes.ts`, que se apoya en
//     `puntOferta`): «Recollida per validar», «Esperant recollida»… El estado crudo no decía
//     qué estaba pasando con una oferta «Coberta».
//   · Los kilos canalizados ya no suman las canalizaciones anuladas.
//   · El orden por defecto es «Més recents».

// COLUMNAS (fase 4, 25-11-2026): disponibilidad · ofertante · producto (con los kg ofrecidos) ·
// progreso (kg con salida y pendientes) · estado (badge de color y el paso debajo). La REFERENCIA
// ya no se enseña (ni columna ni línea): vive en el detalle y el buscador la sigue encontrando. Los
// RECEPTORES no son columna: una oferta se reparte entre varios y se ven en el detalle.
// ORDEN por defecto: por disponibilidad —las vencidas sin resolver arriba, después la que se acaba
// antes y las que no tienen fecha al final—; la cabecera «Disponibilitat» invierte el sentido. El
// Històric sigue con su orden de cierre. Los breakpoints (disponibilidad `md`, ofertante `xl`) salen
// de medir: con el menú lateral la tabla solo tiene ~700 px a 1024; hasta `xl` el ofertante va bajo
// el producto, en el color del texto (no en gris). Filtros nuevos: tipus d'operació (excedent ja
// collit · espigolada) y modalitat de sortida prevista, también en el Històric (en el servidor);
// una espigolada lleva su badge en la fila. Detalle en `context/06ter` y `lib/llistatOfertes.ts`.

import { useSearchParams } from 'react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { filtraCerca } from '../lib/cerca'
import { categoriaDeFamilia } from '../lib/filtresMercat'
import { modalitatsOferta } from '../lib/modalitats'
import { provinciesDe } from '../lib/territori'
import { useTerritori } from '../hooks/useTerritori'
import { filtraLlistat, opcionsDisponibles, ordenaPerDisponibilitat, type Dimensio } from '../lib/filtres'
import { clauTipusOperacio, esTipusOperacio, textDia } from '../lib/sortides'
import { useFiltresLlistat } from '../hooks/useFiltresLlistat'
import BarraFiltres from './BarraFiltres'
import Desplegable from './Desplegable'
import { dataCurta, kg as fmtKg } from '../lib/format'
import { useCerca } from '../hooks/useCerca'
import { etiquetaEstatOferta, llegendaOferta } from '../lib/procesOferta'
import {
  ESTATS_ACTIUS, ESTATS_HISTORIC, ESTATS_REC_VIU, MIDA_PAGINA_HISTORIC, ORDRE_PER_DEFECTE,
  filtreCercaHistoric, filtreModalitatHistoric, kgDeLaFila, kgPerOferta, limitsDies, llegeixOrdre, llegeixPestanya,
  nombrePagines, nomOfertant, ordenaPerData, pasDeLaFila, rangPagina, resumPerOferta, textPagina, tipusOperacioDe,
  vencudaSenseResoldre,
  type CanalLlistat, type OfertantLlistat, type OrdreData, type OrdreLlistat, type RecLlistat, type RespostaLlistat,
  type ResumOferta,
} from '../lib/llistatOfertes'
import LlegendaEstats from './proces/LlegendaEstats'
import BadgeEspigolada from './BadgeEspigolada'
import BadgeRegistrePosteriori from './BadgeRegistrePosteriori'
import type { Excedente } from '../types'
import CarregantSeccio from './CarregantSeccio'
import BotoIcona from './BotoIcona'
import { FilaClicable, TitolFila } from './FilaClicable'
import { FotoOfertaResolta, useFotosOfertes } from './FotosOferta'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/** Una oferta con su ofertante (el embebido `productores(name, empresa)`). */
type FilaOferta = Excedente & { productores?: OfertantLlistat | null }

interface Props {
  onOpen: (excedente: Excedente) => void
  /** Un botón de cabecera opcional: «Nova oferta» en el panel del equipo (05-10-2026). */
  accio?: ReactNode
}

/** Una fila de la consulta ligera del Històric: solo lo que alimenta sus desplegables. */
interface FilaOpcioHistoric {
  estado: string
  producto: string | null
  productor_id: string | null
  tancada_at: string | null
  tipus_operacio: string | null
  modalitat: Excedente['modalitat']
  modalitats: Excedente['modalitats']
  productores: { name: string | null; empresa: string | null } | null
}

/**
 * Cuántas filas lee la consulta ligera de las opciones del Històric (producto y productor que
 * dan resultado). Es el tope por defecto de PostgREST: con más ofertas cerradas, los
 * desplegables salen de las 1.000 más recientes —el recuento total sigue siendo exacto— y el
 * buscador encuentra las demás.
 */
const TOPE_OPCIONS_HISTORIC = 1000

/** La espera del buscador del Històric antes de preguntar al servidor. */
const ESPERA_CERCA_MS = 300

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
  const [actives, setActives] = useState<FilaOferta[]>([])
  const [esborranys, setEsborranys] = useState<FilaOferta[]>([])
  const [resum, setResum] = useState<Record<string, ResumOferta>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { cerca, setCerca, q } = useCerca()
  // Cada evento de Realtime sube la versión: el Històric la escucha para releer su página.
  const [versio, setVersio] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    // Las canalizaciones, las respuestas y el REC, SOLO de las ofertas activas (el filtro va
    // por el embebido `excedentes!inner`): son los hechos del paso del proceso. Antes se leían
    // todas las canalizaciones de la base para sumar kilos.
    // ⚠️ Cada lista de columnas, en UN literal (§7).
    const [ofertas, canals, respostes, recs, esb] = await Promise.all([
      supabase.from('excedentes').select('*, productores(name, empresa)').in('estado', ESTATS_ACTIUS).order('created_at', { ascending: false }),
      supabase.from('canalizaciones')
        .select('excedente_id, estado, kg_confirmados, recollida_registrada_at, recollida_validada_at, recollida_retornada_at, excedentes!inner(estado)')
        .in('excedentes.estado', ESTATS_ACTIUS),
      supabase.from('oferta_respuestas')
        .select('excedente_id, estado, aprovacio, excedentes!inner(estado)')
        .in('excedentes.estado', ESTATS_ACTIUS),
      supabase.from('albaranes')
        .select('excedente_id, estado, numero_completo, entregado_at, excedentes!inner(estado)')
        .eq('tipo', 'REC')
        .in('estado', ESTATS_REC_VIU)
        .in('excedentes.estado', ESTATS_ACTIUS)
        .order('created_at', { ascending: false }),
      supabase.from('excedentes').select('*, productores(name, empresa)').eq('estado', 'esborrany').order('created_at', { ascending: false }),
    ])
    if (ofertas.error) { setError(ofertas.error.message); setActives([]) }
    else setActives((ofertas.data ?? []) as unknown as FilaOferta[])
    setEsborranys((esb.data ?? []) as unknown as FilaOferta[])
    // Si falla alguna de las tres, la fila se queda sin su línea de proceso, no sin la lista.
    setResum(resumPerOferta(
      (canals.data ?? []) as CanalLlistat[],
      (respostes.data ?? []) as RespostaLlistat[],
      (recs.data ?? []) as RecLlistat[],
    ))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    // Una ráfaga de eventos = una sola recarga, la de después del último (ESPERA_RECARREGA_MS).
    let temporitzador: ReturnType<typeof setTimeout> | undefined
    const recarrega = () => {
      if (temporitzador !== undefined) clearTimeout(temporitzador)
      temporitzador = setTimeout(() => {
        void load()
        setVersio((v) => v + 1)
      }, ESPERA_RECARREGA_MS)
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

  // --- La pestaña, en la URL -------------------------------------------------------------
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const pestanya = llegeixPestanya(tabParam)
  // Lo último que escribió ESTA pantalla en `?tab=`. Si cambia por otro lado —el diálogo de
  // alta navega a `?tab=esborranys` sin desmontar la lista—, hay una fila nueva que leer.
  const ultimaPestanya = useRef(tabParam)
  useEffect(() => {
    if (tabParam === ultimaPestanya.current) return
    ultimaPestanya.current = tabParam
    void load()
  }, [tabParam, load])
  const canviaPestanya = (v: string) => {
    const p = llegeixPestanya(v)
    // `actives` es la de por defecto: sin parámetro, como Albarans con «tots».
    const valor = p === 'actives' ? null : p
    ultimaPestanya.current = valor
    setParams((prev) => {
      const nous = new URLSearchParams(prev)
      if (valor) nous.set('tab', valor)
      else nous.delete('tab')
      return nous
    }, { replace: true })
  }

  // --- Filtros de Actives, Per validar y Esborranys (en el cliente, como antes) -------------
  // Provincia, zona, municipio, tipo de producto, producto, modalidad de salida prevista y
  // tipus d'operació, más la fecha de DISPONIBILIDAD (fase 4; antes, la de alta) y el orden.
  // Provincia y municipio (16-11-2026) salen del `municipi_ine` de la oferta y del catálogo; la
  // modalidad mira TODAS las de la oferta (`modalitats`), no solo la primera.
  const f = useFiltresLlistat('equip-ofertes')
  const territori = useTerritori()
  // `disponibilitat` (por defecto) = las vencidas sin resolver y después lo que caduca antes;
  // `disponibilitat_desc` = al revés; `recent`/`antiga` = por fecha de alta. La cabecera
  // «Disponibilitat» alterna los dos primeros.
  const [ordre, setOrdre] = useState<OrdreLlistat>(ORDRE_PER_DEFECTE)
  const alternaOrdreDisponibilitat = () => setOrdre((o) => (o === 'disponibilitat' ? 'disponibilitat_desc' : 'disponibilitat'))
  const dims = useMemo<Dimensio<FilaOferta>[]>(() => [
    { clau: 'provincia', etiquetaKey: 'fl.d_provincia', valor: (o) => provinciesDe(o.municipi_ine, o.comarca, territori.perComarca) },
    { clau: 'comarca', etiquetaKey: 'fl.d_comarca', valor: (o) => o.comarca },
    { clau: 'municipi', etiquetaKey: 'fl.d_municipi', valor: (o) => territori.nomMunicipi(o.municipi_ine) },
    { clau: 'categoria', etiquetaKey: 'fl.d_categoria', valor: (o) => categoriaDeFamilia(o.familia) },
    { clau: 'producte', etiquetaKey: 'fl.d_producte', valor: (o) => o.producto },
    { clau: 'modalitat', etiquetaKey: 'fl.d_modalitat_prevista', valor: (o) => modalitatsOferta(o) },
    { clau: 'tipus_operacio', etiquetaKey: 'fl.d_tipus_operacio', valor: (o) => tipusOperacioDe(o) },
  ], [territori])
  const rang = useMemo(() => ({ data: (o: FilaOferta) => o.disponible_hasta, desDe: f.desDe, finsA: f.finsA }), [f.desDe, f.finsA])

  const filtra = useCallback((files: FilaOferta[]) => {
    // El buscador también encuentra por ofertante (20-11-2026): es la columna con la que se
    // reconoce una oferta cuando no se sabe su referencia.
    const r = filtraLlistat(filtraCerca(files, q,
      (o) => [o.id_excedente, o.producto, o.variedad, nomOfertant(o.productores), t(etiquetaEstatOferta(o.estado).key)]), dims, f.valors, rang)
    if (ordre === 'recent' || ordre === 'antiga') return ordenaPerData(r, (o) => o.created_at, ordre, (o) => o.id)
    // Por disponibilidad, todas «en curso» (Esborranys incluidas: no hay cerradas aquí); las
    // vencidas sin resolver, solo entre las activas.
    const ara = new Date()
    return ordenaPerDisponibilitat(r, () => true, {
      sentit: ordre === 'disponibilitat_desc' ? 'desc' : 'asc',
      vencuda: (o) => (ESTATS_ACTIUS as readonly string[]).includes(o.estado)
        && vencudaSenseResoldre(o, resum[o.id]?.kgCanalitzats ?? 0, ara),
    })
  }, [q, t, dims, f.valors, rang, ordre, resum])

  const vives = useMemo(() => [...actives, ...esborranys], [actives, esborranys])

  const grups = useMemo(() => ({
    // Las que esperan a que el equipo las valide (05-10-2026): son también activas, y esta
    // pestaña es a donde manda el badge del menú y la cola del tablero.
    validar: filtra(actives.filter((o) => o.estado === 'pendent_validacio')),
    actives: filtra(actives),
    esborranys: filtra(esborranys),
  }), [actives, esborranys, filtra])

  // --- El Històric, paginado en el servidor ----------------------------------------------
  const fh = useFiltresLlistat('equip-ofertes-historic')
  // El buscador es el mismo cuadro de texto; en el Històric va al servidor, con espera.
  const [cercaHist, setCercaHist] = useState(cerca)
  useEffect(() => {
    const id = setTimeout(() => setCercaHist(cerca), ESPERA_CERCA_MS)
    return () => clearTimeout(id)
  }, [cerca])
  // La página va atada a los filtros con los que se pidió: cambiar un filtro vuelve a la 1
  // sin un efecto que la resetee (que pediría primero la página vieja con el filtro nuevo).
  // El Històric solo conoce dos sentidos (por cierre, y por alta si no se cerró): tiene su propio
  // desplegable; el orden por disponibilidad es de las pestañas vivas.
  const [ordreHist, setOrdreHist] = useState<OrdreData>('recent')
  const clauFiltresHist = JSON.stringify([fh.valors, fh.desDe, fh.finsA, cercaHist.trim(), ordreHist])
  const [paginaHist, setPaginaHist] = useState({ clau: clauFiltresHist, n: 0 })
  const pagina = paginaHist.clau === clauFiltresHist ? paginaHist.n : 0
  const [historic, setHistoric] = useState<FilaOferta[]>([])
  const [kgHistoric, setKgHistoric] = useState<Record<string, number>>({})
  const [totalHist, setTotalHist] = useState(0)
  const [carregantHist, setCarregantHist] = useState(true)
  const [errorHist, setErrorHist] = useState(false)
  const peticioHist = useRef(0)

  useEffect(() => {
    const meva = ++peticioHist.current
    setCarregantHist(true)
    void (async () => {
      const estatFiltre = fh.valors.estat
      const estats = estatFiltre && (ESTATS_HISTORIC as readonly string[]).includes(estatFiltre)
        ? [estatFiltre] : [...ESTATS_HISTORIC]
      const { des, fins } = rangPagina(pagina)
      let consulta = supabase.from('excedentes').select('*, productores(name, empresa)', { count: 'exact' }).in('estado', estats)
      if (fh.valors.producte) consulta = consulta.eq('producto', fh.valors.producte)
      if (fh.valors.productor) consulta = consulta.eq('productor_id', fh.valors.productor)
      // Fase 4: tipus d'operació (columna generada) y modalidad prevista (lista o la de siempre).
      // Lo que no vale (un filtro viejo recordado) no llega a la base.
      if (esTipusOperacio(fh.valors.tipus_operacio)) consulta = consulta.eq('tipus_operacio', fh.valors.tipus_operacio)
      const modOr = filtreModalitatHistoric(fh.valors.modalitat)
      if (modOr) consulta = consulta.or(modOr)
      const cercaOr = filtreCercaHistoric(cercaHist)
      if (cercaOr) consulta = consulta.or(cercaOr)
      // La fecha de cierre, en días locales inclusivos. Una cancelada no tiene `tancada_at`:
      // con un rango puesto, no sale (no se cerró en ningún día).
      const lim = limitsDies(fh.desDe, fh.finsA)
      if (lim.gte) consulta = consulta.gte('tancada_at', lim.gte)
      if (lim.lt) consulta = consulta.lt('tancada_at', lim.lt)
      // Por defecto, lo último que se cerró arriba (o lo primero, con «més antigues»); las
      // canceladas (sin `tancada_at`) van detrás, por fecha de alta.
      const asc = ordreHist === 'antiga'
      const { data, count, error: err } = await consulta
        .order('tancada_at', { ascending: asc, nullsFirst: false })
        .order('created_at', { ascending: asc })
        .range(des, fins)
      if (meva !== peticioHist.current) return
      if (err) {
        setErrorHist(true); setHistoric([]); setTotalHist(0); setCarregantHist(false)
        return
      }
      const files = (data ?? []) as unknown as FilaOferta[]
      const total = count ?? 0
      // La página se ha quedado más allá del final (se ha cerrado o borrado algo): a la última.
      if (files.length === 0 && pagina > 0 && total > 0) {
        setPaginaHist({ clau: clauFiltresHist, n: nombrePagines(total) - 1 })
        return
      }
      const ids = files.map((o) => o.id)
      const canals = ids.length
        ? await supabase.from('canalizaciones').select('excedente_id, estado, kg_confirmados').in('excedente_id', ids)
        : { data: [] as CanalLlistat[] }
      if (meva !== peticioHist.current) return
      setErrorHist(false)
      setHistoric(files)
      setTotalHist(total)
      setKgHistoric(kgPerOferta((canals.data ?? []) as CanalLlistat[]))
      setCarregantHist(false)
    })()
  }, [fh.valors, fh.desDe, fh.finsA, cercaHist, pagina, clauFiltresHist, ordreHist, versio])

  // Las opciones de los desplegables del Històric: una consulta ligera, con el recuento total.
  const [opcionsHist, setOpcionsHist] = useState<FilaOpcioHistoric[]>([])
  const [totalHistSenseFiltres, setTotalHistSenseFiltres] = useState(0)
  useEffect(() => {
    let viu = true
    void (async () => {
      const { data, count } = await supabase.from('excedentes')
        .select('estado, producto, productor_id, tancada_at, tipus_operacio, modalitat, modalitats, productores(name, empresa)', { count: 'exact' })
        .in('estado', ESTATS_HISTORIC)
        .order('created_at', { ascending: false })
        .limit(TOPE_OPCIONS_HISTORIC)
      if (!viu) return
      setOpcionsHist((data ?? []) as unknown as FilaOpcioHistoric[])
      setTotalHistSenseFiltres(count ?? 0)
    })()
    return () => { viu = false }
  }, [versio])

  const nomsProductors = useMemo(() => {
    const m: Record<string, string> = {}
    for (const o of opcionsHist) {
      if (o.productor_id && !m[o.productor_id]) m[o.productor_id] = o.productores?.empresa || o.productores?.name || '—'
    }
    return m
  }, [opcionsHist])
  const dimsHist = useMemo<Dimensio<FilaOpcioHistoric>[]>(() => [
    { clau: 'estat', etiquetaKey: 'fl.d_estat', valor: (o) => o.estado },
    { clau: 'producte', etiquetaKey: 'fl.d_producte', valor: (o) => o.producto },
    { clau: 'productor', etiquetaKey: 'fl.d_ofertant', valor: (o) => o.productor_id },
    { clau: 'modalitat', etiquetaKey: 'fl.d_modalitat_prevista', valor: (o) => modalitatsOferta(o) },
    { clau: 'tipus_operacio', etiquetaKey: 'fl.d_tipus_operacio', valor: (o) => tipusOperacioDe(o) },
  ], [])
  const rangHist = useMemo(() => ({ data: (o: FilaOpcioHistoric) => o.tancada_at, desDe: fh.desDe, finsA: fh.finsA }), [fh.desDe, fh.finsA])

  // La miniatura, con la misma regla que el resto de listas (fotoOferta.ts): la foto
  // propia, la del producto o el icono de su familia. Firmada en lote para todas las pestañas.
  const ambHistoric = useMemo(() => [...vives, ...historic], [vives, historic])
  const foto = useFotosOfertes(ambHistoric)

  function taula(files: FilaOferta[], buitKey: string, kgDe: (o: Excedente) => number, ambPas: boolean, ordenable: boolean) {
    if (files.length === 0) return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    // El criterio de las tablas (03-11-2026, AGENTS.md §2): cabe sin scroll horizontal. Orden de
    // aparición al ensanchar (fase 4): en móvil quedan producto (con kilos ofrecidos, ofertante y
    // disponibilidad debajo), estado y la acción; la disponibilidad gana columna desde `md`, junto
    // con el progreso, y el ofertante desde `xl` (con el menú lateral abierto, a 1024 px la tabla
    // solo tiene ~700 px: más columnas dejarían el producto en 90 px). La miniatura aparece desde
    // `sm`. Los receptores NO tienen columna: una oferta se reparte entre varios y eso se consulta
    // en el detalle (asignaciones y salidas).
    const ara = new Date()
    // La cabecera «Disponibilitat» ordena en las pestañas vivas: un botón de verdad (teclado y
    // lector), con la flecha del sentido actual; con el orden por alta, el primer clic vuelve al
    // de disponibilidad. En el Històric (orden de cierre, en el servidor) es solo un título.
    const sortDisp = ordre === 'disponibilitat' ? 'ascending' : ordre === 'disponibilitat_desc' ? 'descending' : 'none'
    const IconaOrdre = sortDisp === 'ascending' ? ArrowUp : sortDisp === 'descending' ? ArrowDown : ArrowUpDown
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden w-28 md:table-cell" aria-sort={ordenable ? sortDisp : undefined}>
              {ordenable ? (
                <button type="button" onClick={alternaOrdreDisponibilitat} data-testid="ordre-disponibilitat"
                  title={t(ordre === 'disponibilitat' ? 'off.ordre_disp_desc' : 'off.ordre_disp_asc')}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  {t('off.c_disponibilitat')}
                  <IconaOrdre className="size-3.5" aria-hidden />
                </button>
              ) : t('off.c_disponibilitat')}
            </TableHead>
            <TableHead className="hidden xl:table-cell">{t('off.c_ofertant')}</TableHead>
            <TableHead>{t('off.c_product')}</TableHead>
            <TableHead className="hidden w-44 md:table-cell">{t('off.c_progress')}</TableHead>
            <TableHead className="w-28 sm:w-40">{t('off.c_state')}</TableHead>
            <TableHead className="w-15 md:w-16"><span className="sr-only">{t('doc.c_actions')}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((o) => {
            const esEsborrany = o.estado === 'esborrany'
            const kgs = kgDeLaFila(o.kg_total, kgDe(o))
            const est = etiquetaEstatOferta(o.estado)
            const ofertant = nomOfertant(o.productores)
            // La disponibilidad (`disponible_hasta`, un día): «—» sin fecha. Vencida sin resolver
            // en `aviso` (le toca al equipo), solo en las pestañas vivas.
            const disp = textDia(o.disponible_hasta)
            const vencuda = ambPas && (ESTATS_ACTIUS as readonly string[]).includes(o.estado)
              && vencudaSenseResoldre(o, kgDe(o), ara)
            const espigolada = tipusOperacioDe(o) === 'espigolada'
            // Los kilos con salida y los que faltan, en dos frases que sirven igual bajo el
            // producto (móvil) que bajo la barra (desde `md`). Un esborrany no tiene progreso.
            const textSortida = t('off.kg_sortida', { a: fmtKg(kgs.canalitzats), b: fmtKg(kgs.total) })
            const textFalten = kgs.falten > 0 ? t('off.falten', { n: `${fmtKg(kgs.falten)} kg` }) : t('off.complet')
            // El paso del proceso (Actives y Per validar); en el Històric, cuándo se cerró.
            const pas = ambPas ? pasDeLaFila(o, resum[o.id], ara) : null
            return (
              <FilaClicable key={o.id} onObre={() => onOpen(o)}>
                <TableCell className={`hidden whitespace-nowrap tabular-nums md:table-cell ${vencuda ? 'font-medium text-aviso' : ''}`}
                  data-testid="oferta-disponibilitat" data-vencuda={vencuda || undefined}>{disp}</TableCell>
                <TableCell className="hidden font-medium break-words xl:table-cell" data-testid="oferta-ofertant">{ofertant}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="hidden shrink-0 sm:block">
                      <FotoOfertaResolta foto={foto(o)} alt={o.producto ?? ''} className="size-10" />
                    </span>
                    <div className="min-w-0">
                      <TitolFila onObre={() => onOpen(o)}>{o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}</TitolFila>
                      {/* La cantidad que se ofreció al principio, siempre a la vista. */}
                      {kgs.total > 0 && (
                        <span className="block text-xs text-muted-foreground tabular-nums" data-testid="oferta-kg-oferts">
                          {t('off.kg_oferts', { n: fmtKg(kgs.total) })}
                        </span>
                      )}
                      {!esEsborrany && (
                        <span className="block text-xs text-muted-foreground md:hidden">{textSortida} · {textFalten}</span>
                      )}
                      {/* Lo que no tiene columna todavía va bajo el nombre: el ofertante hasta
                          `xl`, en el color del texto (es quien la hizo: se reconoce por él); la
                          disponibilidad, en móvil. */}
                      <span className="block text-sm font-medium break-words xl:hidden">{ofertant}</span>
                      <span className={`block text-xs tabular-nums md:hidden ${vencuda ? 'font-medium text-aviso' : 'text-muted-foreground'}`}>
                        {o.disponible_hasta ? t('off.disponible_fins', { data: disp }) : t('off.sense_disponibilitat')}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {!esEsborrany && (
                    <>
                      <div className="mx-auto h-2 w-36 max-w-full overflow-hidden rounded-full bg-muted"
                        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={kgs.pct}
                        aria-label={`${textSortida} · ${textFalten}`}>
                        <div className="h-full bg-exito" style={{ width: `${kgs.pct}%` }} />
                      </div>
                      <span className="mt-1 block text-center text-xs text-muted-foreground tabular-nums" data-testid="oferta-kg-sortida">{textSortida}</span>
                      <span className="block text-center text-xs text-muted-foreground tabular-nums" data-testid="oferta-kg-falten">{textFalten}</span>
                    </>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    {/* `Badge` y no un `span` a mano (§2bis). Parte línea si no cabe: la
                        columna es estrecha en móvil. */}
                    <Badge className={`${est.clase} max-w-full whitespace-normal`}>{t(est.key)}</Badge>
                    {/* Lo que está pasando, en una frase: en `aviso` si le toca al equipo,
                        neutro si espera a otra parte (§6ter). */}
                    {pas && (
                      <span className={`text-xs ${pas.emToca ? 'text-aviso' : 'text-muted-foreground'}`}
                        data-testid="pas-proces">
                        {t(pas.clau, pas.vars)}
                      </span>
                    )}
                    {!ambPas && o.estado === 'cerrada' && o.tancada_at && (
                      <span className="text-xs text-muted-foreground">{t('off.tancada_el', { data: dataCurta(o.tancada_at) })}</span>
                    )}
                    {/* Fase 4: el tipus d'operació, solo cuando no es el normal (excedent ja collit),
                        con la marca común de la espigolada (`BadgeEspigolada`, fase 3). */}
                    {espigolada && (
                      <span data-testid="oferta-espigolada" className="max-w-full">
                        <BadgeEspigolada className="max-w-full whitespace-normal" />
                      </span>
                    )}
                    {/* Proceso 3.7: registrada por el equipo después de hacerse. */}
                    {o.origen === 'registre' && (
                      <span data-testid="oferta-registre-posteriori" className="max-w-full">
                        <BadgeRegistrePosteriori className="max-w-full whitespace-normal" />
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                    <BotoIcona icona={Eye} etiqueta={t('off.a_open')} onClick={() => onOpen(o)} />
                  </div>
                </TableCell>
              </FilaClicable>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  const senseCoincidencia = q !== ''
  const kgViu = (o: Excedente) => resum[o.id]?.kgCanalitzats ?? 0
  const kgHist = (o: Excedente) => kgHistoric[o.id] ?? 0
  const enHistoric = pestanya === 'historic'
  const pag = textPagina(pagina, historic.length, totalHist)
  const nPagines = nombrePagines(totalHist)
  const filtresHistActius = Boolean(cercaHist.trim()) || Object.values(fh.valors).some(Boolean) || Boolean(fh.desDe || fh.finsA)
  const anaAPagina = (n: number) => setPaginaHist({ clau: clauFiltresHist, n })

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
        <Input type="search" placeholder={t(enHistoric ? 'off.search_historic' : 'off.search')} value={cerca}
          onChange={(e) => setCerca(e.target.value)} />
        {enHistoric ? (
          // Los filtros del Històric van al servidor: estado final, producto, productora y la
          // fecha de cierre. Las opciones salen de la consulta ligera (las que dan resultado).
          <BarraFiltres
            id="off-hist"
            desplegables={dimsHist.map((d) => ({
              clau: d.clau, etiquetaKey: d.etiquetaKey,
              opcions: opcionsDisponibles(opcionsHist, dimsHist, d.clau, fh.valors, rangHist),
              text: d.clau === 'estat' ? (v: string) => t(etiquetaEstatOferta(v as Excedente['estado']).key)
                : d.clau === 'productor' ? (v: string) => nomsProductors[v] ?? v
                  : d.clau === 'modalitat' ? (v: string) => t(`od.mod_${v}`)
                    : d.clau === 'tipus_operacio' ? (v: string) => t(clauTipusOperacio(v)) : undefined,
              // Listas cortas y fijas: desplegable, nunca buscador.
              ...(d.clau === 'modalitat' || d.clau === 'tipus_operacio' ? { cercador: false } : {}),
            }))}
            valors={fh.valors}
            onValors={fh.setValors}
            rang={{ etiquetaKey: 'off.r_tancament', desDe: fh.desDe, finsA: fh.finsA, onCanvi: fh.setRang }}
            mostrant={totalHist}
            total={totalHistSenseFiltres}
            extra={(
              <div className="min-w-0 space-y-1 md:w-56">
                <label htmlFor="off-ordre-hist" className="text-xs text-muted-foreground">{t('fl.ordre')}</label>
                <Desplegable id="off-ordre-hist" mida="sm" value={ordreHist}
                  onChange={(v) => setOrdreHist(v === 'antiga' ? 'antiga' : 'recent')}
                  opcions={[
                    { valor: 'recent', text: t('fl.o_tancament_recent') },
                    { valor: 'antiga', text: t('fl.o_tancament_antic') },
                  ]} />
              </div>
            )}
          />
        ) : (
          <BarraFiltres
            id="off"
            desplegables={dims.map((d) => ({
              clau: d.clau, etiquetaKey: d.etiquetaKey,
              opcions: opcionsDisponibles(vives, dims, d.clau, f.valors, rang),
              text: d.clau === 'modalitat' ? (v: string) => t(`od.mod_${v}`)
                : d.clau === 'tipus_operacio' ? (v: string) => t(clauTipusOperacio(v))
                  : d.clau === 'categoria' ? (v: string) => t(v === 'altres' ? 'mk.f_other' : `pr.o_${v}`) : undefined,
              ...(d.clau === 'modalitat' || d.clau === 'tipus_operacio' ? { cercador: false } : {}),
            }))}
            valors={f.valors}
            onValors={f.setValors}
            rang={{ etiquetaKey: 'fl.r_disponibilitat', desDe: f.desDe, finsA: f.finsA, onCanvi: f.setRang }}
            mostrant={pestanya === 'validar' ? grups.validar.length
              : pestanya === 'esborranys' ? grups.esborranys.length : grups.actives.length}
            total={pestanya === 'validar' ? actives.filter((o) => o.estado === 'pendent_validacio').length
              : pestanya === 'esborranys' ? esborranys.length : actives.length}
            extra={(
              <div className="min-w-0 space-y-1 md:w-44">
                <label htmlFor="off-ordre" className="text-xs text-muted-foreground">{t('fl.ordre')}</label>
                <Desplegable id="off-ordre" mida="sm" value={ordre}
                  onChange={(v) => setOrdre(llegeixOrdre(v))}
                  opcions={[
                    { valor: 'disponibilitat', text: t('fl.o_disponibilitat') },
                    { valor: 'disponibilitat_desc', text: t('fl.o_disponibilitat_desc') },
                    { valor: 'recent', text: t('fl.o_recent') },
                    { valor: 'antiga', text: t('fl.o_antiga') },
                  ]} />
              </div>
            )}
          />
        )}
        {loading && <CarregantSeccio files={5} ambCapcalera={false} />}
        {error && <p className="text-sm text-error">{t('c.load_error')}</p>}

        {!loading && !error && (
          <Tabs value={pestanya} onValueChange={canviaPestanya}>
            {/* A 360 px cuatro etiquetas con su cifra no caben: la lista scrollea sola en
                vez de empujar la página entera hacia la derecha. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="validar">{t('off.tab_validar', { n: grups.validar.length })}</TabsTrigger>
                <TabsTrigger value="actives">{t('off.tab_active', { n: grups.actives.length })}</TabsTrigger>
                <TabsTrigger value="esborranys">{t('off.tab_esborranys', { n: grups.esborranys.length })}</TabsTrigger>
                <TabsTrigger value="historic">{t('off.tab_historic', { n: totalHist })}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="validar" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('off.validar_hint')}</p>
              {taula(grups.validar, senseCoincidencia ? 'off.no_match' : 'off.empty_validar', kgViu, true, true)}
            </TabsContent>
            <TabsContent value="actives" className="space-y-2">
              {taula(grups.actives, senseCoincidencia ? 'off.no_match' : 'off.empty_active', kgViu, true, true)}
            </TabsContent>
            <TabsContent value="esborranys" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('off.esborranys_hint')}</p>
              {taula(grups.esborranys, senseCoincidencia ? 'off.no_match' : 'off.empty_esborranys', kgViu, false, true)}
            </TabsContent>
            <TabsContent value="historic" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('off.historic_hint')}</p>
              {errorHist
                ? <p className="text-sm text-error">{t('c.load_error')}</p>
                : carregantHist && historic.length === 0
                  ? <CarregantSeccio files={5} ambCapcalera={false} />
                  : taula(historic, filtresHistActius ? 'off.no_match' : 'off.empty_historic', kgHist, false, false)}
              {!errorHist && totalHist > MIDA_PAGINA_HISTORIC && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2" data-testid="paginacio-historic">
                  <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                    {t('off.pag_rang', { a: pag.a, b: pag.b, total: pag.total })}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" className="h-11 md:h-8" disabled={pagina === 0 || carregantHist}
                      onClick={() => anaAPagina(pagina - 1)}>
                      <ChevronLeft className="size-4" aria-hidden /> {t('off.pag_anterior')}
                    </Button>
                    <Button variant="outline" className="h-11 md:h-8" disabled={pagina >= nPagines - 1 || carregantHist}
                      onClick={() => anaAPagina(pagina + 1)}>
                      {t('off.pag_seguent')} <ChevronRight className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
