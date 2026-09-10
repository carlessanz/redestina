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
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { dataCurta, estilEstatAlbara, kg } from '../../lib/albarans'
import type { AlbaranBandeja } from '../../lib/albarans'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type Noms = Record<string, string>

export default function Albarans() {
  const { t } = useT()
  const [files, setFiles] = useState<AlbaranBandeja[]>([])
  const [productors, setProductors] = useState<Noms>({})
  const [entitats, setEntitats] = useState<Noms>({})
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')

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

      const [prod, ent] = await Promise.all([
        idsProd.length
          ? supabase.from('productores').select('id, name, empresa').in('id', idsProd)
          : Promise.resolve({ data: [] }),
        idsEnt.length
          ? supabase.from('entidades').select('id, nombre').in('id', idsEnt)
          : Promise.resolve({ data: [] }),
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

  const grups = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    const casa = (f: AlbaranBandeja) => {
      if (!q) return true
      const camps = [f.numero_completo, f.tipo, f.id_excedente, f.producto, f.codigo_lote, contraparte(f)]
      return camps.some((c) => (c ?? '').toLowerCase().includes(q))
    }
    const tots = files.filter(casa)
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
  }, [files, cerca, contraparte])

  function taula(llista: AlbaranBandeja[], buitKey: string) {
    if (llista.length === 0) return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('alb.c_number')}</TableHead>
              <TableHead>{t('alb.c_type')}</TableHead>
              <TableHead>{t('alb.c_counterpart')}</TableHead>
              <TableHead>{t('alb.c_product')}</TableHead>
              <TableHead className="text-right">{t('alb.c_kg')}</TableHead>
              <TableHead>{t('alb.c_status')}</TableHead>
              <TableHead>{t('alb.c_waiting')}</TableHead>
              <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {llista.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium whitespace-nowrap tabular-nums">
                  {f.numero_completo ?? t('alb.no_number')}
                </TableCell>
                <TableCell><Badge variant="outline">{f.tipo}</Badge></TableCell>
                <TableCell className="max-w-56 truncate">{contraparte(f)}</TableCell>
                <TableCell className="text-muted-foreground">{f.producto ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {kg(f.kg_validados ?? f.kg_confirmados ?? f.kg_neto ?? f.kg_previstos)}
                </TableCell>
                <TableCell>
                  <Badge className={estilEstatAlbara(f.estado)}>{t(`alb.st_${f.estado}`)}</Badge>
                  {f.rechazo !== 'cap' && (
                    <Badge className="ml-1 bg-error-fondo text-error">{t(`alb.rj_${f.rechazo}`)}</Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                  {f.dias_esperando != null
                    ? t('alb.days', { n: f.dias_esperando })
                    : dataCurta(f.emitido_at)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    {/* `h-11` en móvil: es la acción de la fila y 32 px es poco para un pulgar. */}
                    <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
                      <Link to={`/equip/albarans/${f.id}`}>{t('c.detail')}</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!carregant && !error && (
          <Tabs defaultValue="tots">
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
