// Listado de albaranes del equipo.
//
// Lee `v_albaranes_bandeja`, que es una vista con `security_invoker`: no es un agujero en
// la RLS, evalúa las políticas de quien consulta. Aquí siempre consulta el equipo, pero eso
// importa porque la misma vista la usa la bandeja de documentos.
//
// Las pestañas siguen el circuito, no el alfabeto: un albarán nace en BORRADOR (lo crea el
// trigger al canalizar), se EMITE con número, se marca ENTREGAT cuando la recogida se ha
// hecho —y ahí sale el enlace de confirmación—, la otra parte lo CONFIRMA y el equipo lo
// CONCILIA. Cada pestaña es una parada de ese camino y, sobre todo, una cosa que alguien
// tiene que hacer hoy. «Pendents de confirmar» va ordenada por días de espera porque es la
// única que se resuelve sola con el tiempo… o no se resuelve nunca.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { filtraCerca } from '../../lib/cerca'
import { useCerca } from '../../hooks/useCerca'
import { dataCurta, estilEstatAlbara, kg } from '../../lib/albarans'
import type { AlbaranBandeja } from '../../lib/albarans'
import BotoIcona from '../../components/BotoIcona'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type Noms = Record<string, string>

export default function Albarans() {
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const PESTANYES = ['tots', 'esborranys', 'pendents', 'conciliar', 'tancats'] as const
  const tabParam = params.get('tab')
  const tab = (PESTANYES as readonly string[]).includes(tabParam ?? '') ? (tabParam as string) : 'tots'
  const [files, setFiles] = useState<AlbaranBandeja[]>([])
  const [productors, setProductors] = useState<Noms>({})
  const [entitats, setEntitats] = useState<Noms>({})
  // Canalizaciones y ofertas con una diferencia de kilos declarada por la receptora
  // (17-10-2026): sus albaranes llevan la marca «Incidència» hasta que se concilian.
  const [incidencies, setIncidencies] = useState<{ canals: Set<string>; ofertes: Set<string> }>(
    { canals: new Set(), ofertes: new Set() })
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { cerca, setCerca, q } = useCerca()

  const carrega = useCallback(async () => {
    // ⚠️ La lista de columnas va en UN literal (§7, deuda 46): partida, supabase-js pierde
    // el tipo de la fila y deja de compilar.
    const { data, error: err } = await supabase
      .from('v_albaranes_bandeja')
      .select('id, tipo, numero_completo, estado, ejercicio, excedente_id, espigolada_id, canalizacion_id, id_excedente, producto, productor_id, entidad_id, codigo_lote, emitido_at, entregado_at, confirmado_at, conciliado_at, rechazo, kg_previstos, kg_neto, kg_confirmados, kg_validados, dias_esperando')
      // La vista no expone `created_at`: se ordena por lo emitido, y los borradores —que
      // todavía no tienen fecha ni número— quedan arriba, que es donde hay trabajo.
      .order('emitido_at', { ascending: false, nullsFirst: true })
      .order('numero_completo', { ascending: false, nullsFirst: true })

    if (err) return { llista: [] as AlbaranBandeja[], err }
    return { llista: (data as AlbaranBandeja[] | null) ?? [], err: null }
  }, [])

  useEffect(() => {
    let viu = true
    void (async () => {
      const { llista, err } = await carrega()
      if (!viu) return
      if (err) { setError(err.message); setCarregant(false); return }
      setFiles(llista)

      // Los nombres se piden SOLO de los ids que salen en pantalla. Traerse las 343 fichas
      // de productor para poner un nombre en 12 filas es exactamente la deuda §12.5, y aquí
      // no hace falta cometerla: el listado ya sabe a quién necesita.
      const idsProd = [...new Set(llista.map((f) => f.productor_id).filter((v): v is string => !!v))]
      const idsEnt = [...new Set(llista.map((f) => f.entidad_id).filter((v): v is string => !!v))]

      const [prod, ent, inc] = await Promise.all([
        idsProd.length
          ? supabase.from('productores').select('id, name, empresa').in('id', idsProd)
          : Promise.resolve({ data: [] }),
        idsEnt.length
          ? supabase.from('entidades').select('id, nombre').in('id', idsEnt)
          : Promise.resolve({ data: [] }),
        supabase.from('canalizaciones').select('id, excedente_id').not('incidencia_recollida', 'is', null),
      ])
      if (!viu) return

      const mapaProd: Noms = {}
      for (const p of (prod.data ?? []) as { id: string; name: string | null; empresa: string | null }[]) {
        mapaProd[p.id] = p.empresa || p.name || '—'
      }
      const mapaEnt: Noms = {}
      for (const e of (ent.data ?? []) as { id: string; nombre: string | null }[]) {
        mapaEnt[e.id] = e.nombre || '—'
      }
      const ambInc = (inc.data ?? []) as { id: string; excedente_id: string | null }[]
      setIncidencies({
        canals: new Set(ambInc.map((c) => c.id)),
        ofertes: new Set(ambInc.map((c) => c.excedente_id).filter((v): v is string => !!v)),
      })
      setProductors(mapaProd)
      setEntitats(mapaEnt)
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega])

  const contraparte = useCallback((f: AlbaranBandeja): string => {
    if (f.tipo === 'REC') return f.productor_id ? (productors[f.productor_id] ?? '—') : '—'
    return f.entidad_id ? (entitats[f.entidad_id] ?? '—') : '—'
  }, [productors, entitats])

  /** ¿Este albarán espera la revisión de una diferencia declarada por la receptora? */
  const teIncidencia = (f: AlbaranBandeja): boolean => {
    if (f.estado === 'conciliado' || f.estado === 'anulado' || f.estado === 'rectificado') return false
    if (f.tipo === 'REC') return !f.espigolada_id && !!f.excedente_id && incidencies.ofertes.has(f.excedente_id)
    return !!f.canalizacion_id && incidencies.canals.has(f.canalizacion_id)
  }

  const grups = useMemo(() => {
    const tots = filtraCerca(files, q,
      (f) => [f.numero_completo, f.tipo, f.id_excedente, f.producto, f.codigo_lote, contraparte(f)])
    return {
      tots,
      esborranys: tots.filter((f) => f.estado === 'borrador'),
      // Ordenados por espera: quien lleva más días sin contestar es quien bloquea el cierre.
      pendents: tots
        .filter((f) => f.estado === 'entregado')
        .sort((a, b) => (b.dias_esperando ?? 0) - (a.dias_esperando ?? 0)),
      perConciliar: tots.filter((f) => f.estado === 'entregado' || f.estado === 'confirmado'),
      tancats: tots.filter((f) => f.estado === 'conciliado'),
    }
  }, [files, q, contraparte])

  function taula(llista: AlbaranBandeja[], buitKey: string) {
    if (llista.length === 0) return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    // El criterio de las tablas (03-11-2026, AGENTS.md §2): cabe sin scroll horizontal. En
    // móvil quedan el número (enlazado al detalle, con el tipo al lado y la contraparte y el
    // producto debajo), el estado (con la espera debajo) y la acción; los kilos salen desde
    // `sm`, la contraparte y la espera desde `lg`, y el tipo y el producto desde `xl`.
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('alb.c_number')}</TableHead>
            <TableHead className="hidden w-16 xl:table-cell">{t('alb.c_type')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('alb.c_counterpart')}</TableHead>
            <TableHead className="hidden xl:table-cell">{t('alb.c_product')}</TableHead>
            <TableHead className="hidden w-20 sm:table-cell">{t('alb.c_kg')}</TableHead>
            <TableHead className="w-24 sm:w-32">{t('alb.c_status')}</TableHead>
            <TableHead className="hidden w-24 lg:table-cell">{t('alb.c_waiting')}</TableHead>
            <TableHead className="w-15 md:w-16"><span className="sr-only">{t('doc.c_actions')}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {llista.map((f) => {
            const ruta = `/equip/albarans/${f.id}`
            const kilos = kg(f.kg_validados ?? f.kg_confirmados ?? f.kg_neto ?? f.kg_previstos)
            const espera = f.dias_esperando != null
              ? t('alb.days', { n: f.dias_esperando })
              : dataCurta(f.emitido_at)
            return (
              <TableRow key={f.id}>
                <TableCell>
                  <Link to={ruta} className="font-medium text-primary tabular-nums hover:underline sm:whitespace-nowrap">
                    {f.numero_completo ?? t('alb.no_number')}
                  </Link>
                  <Badge variant="outline" className="ml-1 xl:hidden">{f.tipo}</Badge>
                  <span className="block text-xs text-muted-foreground lg:hidden">{contraparte(f)}</span>
                  <span className="block text-xs text-muted-foreground xl:hidden">
                    {f.producto ?? '—'}<span className="sm:hidden"> · {kilos} kg</span>
                  </span>
                </TableCell>
                <TableCell className="hidden text-center xl:table-cell"><Badge variant="outline">{f.tipo}</Badge></TableCell>
                <TableCell className="hidden lg:table-cell">{contraparte(f)}</TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">{f.producto ?? '—'}</TableCell>
                <TableCell className="hidden text-center tabular-nums whitespace-nowrap sm:table-cell">{kilos}</TableCell>
                <TableCell className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Badge className={`${estilEstatAlbara(f.estado)} max-w-full whitespace-normal`}>{t(`alb.st_${f.estado}`)}</Badge>
                    {f.rechazo !== 'cap' && (
                      <Badge className="max-w-full bg-error-fondo whitespace-normal text-error">{t(`alb.rj_${f.rechazo}`)}</Badge>
                    )}
                    {teIncidencia(f) && (
                      <Badge className="max-w-full bg-aviso-fondo whitespace-normal text-aviso">{t('alb.inc_badge')}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums lg:hidden">{espera}</span>
                  </div>
                </TableCell>
                <TableCell className="hidden text-center tabular-nums text-muted-foreground lg:table-cell">
                  {espera}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                    <BotoIcona icona={Eye} etiqueta={t('alb.a_open')} onClick={() => navigate(ruta)} />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  const buitKey = files.length === 0 ? 'alb.empty' : 'alb.no_match'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('alb.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('alb.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          type="search"
          placeholder={t('alb.search')}
          value={cerca}
          onChange={(e) => setCerca(e.target.value)}
        />
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}

        {!carregant && !error && (
          <Tabs value={tab} onValueChange={(v) => setParams(v === 'tots' ? {} : { tab: v }, { replace: true })}>
            {/* La pestaña se lee de la URL (`?tab=esborranys|pendents|conciliar|tancats`): es lo
                que permite que «Pendent de l'equip» (tablero) y los badges lleven a la cola
                exacta y no a «Tots». Un valor desconocido cae en «tots». */}
            {/* Cinco etiquetas no caben a 360 px: la lista scrollea sola en vez de empujar
                la página entera hacia la derecha. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="tots">{t('alb.tab_all', { n: grups.tots.length })}</TabsTrigger>
                <TabsTrigger value="esborranys">{t('alb.tab_drafts', { n: grups.esborranys.length })}</TabsTrigger>
                <TabsTrigger value="pendents">{t('alb.tab_waiting', { n: grups.pendents.length })}</TabsTrigger>
                <TabsTrigger value="conciliar">{t('alb.tab_toreconcile', { n: grups.perConciliar.length })}</TabsTrigger>
                <TabsTrigger value="tancats">{t('alb.tab_done', { n: grups.tancats.length })}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="tots" className="space-y-2">{taula(grups.tots, buitKey)}</TabsContent>
            <TabsContent value="esborranys" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('alb.hint_drafts')}</p>
              {taula(grups.esborranys, 'alb.empty_drafts')}
            </TabsContent>
            <TabsContent value="pendents" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('alb.hint_waiting')}</p>
              {taula(grups.pendents, 'alb.empty_waiting')}
            </TabsContent>
            <TabsContent value="conciliar" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('alb.hint_toreconcile')}</p>
              {taula(grups.perConciliar, 'alb.empty_toreconcile')}
            </TabsContent>
            <TabsContent value="tancats" className="space-y-2">
              {taula(grups.tancats, 'alb.empty_done')}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
