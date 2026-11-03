// Listado de convenios del equipo.
//
// Los filtros son los tres con los que se reparte el trabajo de la campaña (§3.2.6): el
// **estado** dice qué hay que hacer hoy (contrafirmar lo firmado, insistir en lo pendiente),
// el **modelo** separa a quien dona de quien recibe y de quien compra, y la **comarca** es
// como se reparten los dinamizadores. Se filtra en cliente, sobre lo ya cargado, igual que
// `OffersList` y `Entitats`: son cientos de filas, no cientos de miles (deuda §12.5).
//
// La comarca no está en `convenios`: sale de la ficha (`area_geografica`), que se pide
// **solo de los ids que salen en pantalla**, como en `Albarans`. Traerse las 343 fichas
// para poner una comarca en 12 filas sería cometer la deuda a propósito.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { casaCerca } from '../../lib/cerca'
import { useCerca } from '../../hooks/useCerca'
import { dataCurta } from '../../lib/albarans'
import { ESTATS_CONVENI, TIPUS_CONVENI, estilEstatConveni, nomOrganitzacio } from '../../lib/convenis'
import type { ConvenioEstado, ConvenioTipo } from '../../types'
import BotoIcona from '../../components/BotoIcona'
import Desplegable from '../../components/Desplegable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Fila {
  id: string
  tipo: ConvenioTipo
  tipo_org: 'productor' | 'entidad'
  productor_id: string | null
  entidad_id: string | null
  numero_completo: string | null
  estado: ConvenioEstado
  idioma: string
  datos_org: Record<string, unknown> | null
  enviado_at: string | null
  firmado_at: string | null
  contrafirmado_at: string | null
  created_at: string
}

interface Org { nom: string; comarca: string | null }

/**
 * Lo que una columna escondida por ancho deja de enseñar, en una línea bajo la organización
 * (criterio de las tablas, 03-11-2026, AGENTS.md §2; la misma pieza que `equip/Documents`).
 * Las piezas van de la que tiene columna MÁS TARDE a la que antes: cada una lleva su «·»
 * delante y, al esconderse las últimas, nunca queda un separador colgando.
 */
type Peca = { text: ReactNode; fins: 'md' | 'lg' | 'xl' }
const AMAGA: Record<Peca['fins'], string> = { md: 'md:hidden', lg: 'lg:hidden', xl: 'xl:hidden' }
const RANG: Record<Peca['fins'], number> = { xl: 0, lg: 1, md: 2 }

function Secundari({ peces }: { peces: Peca[] }) {
  const visibles = peces
    .filter((p) => p.text !== null && p.text !== undefined && p.text !== '')
    .sort((a, b) => RANG[a.fins] - RANG[b.fins])
  if (visibles.length === 0) return null
  return (
    <span className={cn('block text-xs text-muted-foreground', AMAGA[visibles[0].fins])}>
      {visibles.map((p, i) => (
        <span key={i} className={AMAGA[p.fins]}>{i > 0 && ' · '}{p.text}</span>
      ))}
    </span>
  )
}

export default function Convenis() {
  const { t } = useT()
  const navigate = useNavigate()
  const [files, setFiles] = useState<Fila[]>([])
  const [orgs, setOrgs] = useState<Record<string, Org>>({})
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { cerca, setCerca, q } = useCerca()
  // '' = «Tots» (la opción vacía de `Desplegable`).
  const [estat, setEstat] = useState('')
  const [tipus, setTipus] = useState('')
  const [comarca, setComarca] = useState('')

  const carrega = useCallback(async () => {
    // ⚠️ La lista de columnas va en UN literal (§7, deuda 46): partida, supabase-js pierde
    // el tipo de la fila y deja de compilar.
    const { data, error: err } = await supabase
      .from('convenios')
      .select('id, tipo, tipo_org, productor_id, entidad_id, numero_completo, estado, idioma, datos_org, enviado_at, firmado_at, contrafirmado_at, created_at')
      .order('created_at', { ascending: false })
    if (err) return { llista: [] as Fila[], err }
    return { llista: (data as Fila[] | null) ?? [], err: null }
  }, [])

  useEffect(() => {
    let viu = true
    void (async () => {
      const { llista, err } = await carrega()
      if (!viu) return
      if (err) { setError(err.message); setCarregant(false); return }
      setFiles(llista)

      const idsProd = [...new Set(llista.map((f) => f.productor_id).filter((v): v is string => !!v))]
      const idsEnt = [...new Set(llista.map((f) => f.entidad_id).filter((v): v is string => !!v))]
      const [prod, ent] = await Promise.all([
        idsProd.length
          ? supabase.from('productores').select('id, name, empresa, area_geografica').in('id', idsProd)
          : Promise.resolve({ data: [] }),
        idsEnt.length
          ? supabase.from('entidades').select('id, nombre, area_geografica').in('id', idsEnt)
          : Promise.resolve({ data: [] }),
      ])
      if (!viu) return

      const mapa: Record<string, Org> = {}
      for (const p of (prod.data ?? []) as { id: string; name: string | null; empresa: string | null; area_geografica: string | null }[]) {
        mapa[p.id] = { nom: p.empresa || p.name || '—', comarca: p.area_geografica }
      }
      for (const e of (ent.data ?? []) as { id: string; nombre: string | null; area_geografica: string | null }[]) {
        mapa[e.id] = { nom: e.nombre || '—', comarca: e.area_geografica }
      }
      setOrgs(mapa)
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega])

  const orgDe = useCallback((f: Fila): Org => {
    const id = f.productor_id ?? f.entidad_id
    return (id ? orgs[id] : undefined) ?? { nom: '—', comarca: null }
  }, [orgs])

  const comarques = useMemo(() => {
    const set = new Set<string>()
    for (const f of files) {
      const c = orgDe(f).comarca
      if (c) set.add(c)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ca'))
  }, [files, orgDe])

  const visibles = useMemo(() => {
    return files.filter((f) => {
      if (estat && f.estado !== estat) return false
      if (tipus && f.tipo !== tipus) return false
      const o = orgDe(f)
      if (comarca && (o.comarca ?? '') !== comarca) return false
      return casaCerca([f.numero_completo, o.nom, o.comarca, nomOrganitzacio(f.datos_org, null)], q)
    })
  }, [files, q, estat, tipus, comarca, orgDe])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('conv.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('conv.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* A 360 px los cuatro controles van uno debajo de otro; desde `sm`, en dos
            columnas. Los desplegables son `Desplegable`, que ya trae `text-base md:text-sm`
            (§2, regla 1) y `w-full min-w-0`; van a la altura normal y no a `sm` para casar
            con el buscador de al lado, que es un `Input` con su etiqueta encima. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="conv-cerca">{t('c.search')}</Label>
            <Input id="conv-cerca" type="search" placeholder={t('conv.search')}
              value={cerca} onChange={(e) => setCerca(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-estat">{t('conv.f_status')}</Label>
            <Desplegable id="conv-estat" value={estat} onChange={setEstat} buit={t('conv.all')}
              opcions={ESTATS_CONVENI.map((e) => ({ valor: e, text: t(`conv.st_${e}`) }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-tipus">{t('conv.f_model')}</Label>
            <Desplegable id="conv-tipus" value={tipus} onChange={setTipus} buit={t('conv.all')}
              opcions={TIPUS_CONVENI.map((x) => ({ valor: x, text: t(`sig.model_${x}`) }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-comarca">{t('conv.f_region')}</Label>
            <Desplegable id="conv-comarca" value={comarca} onChange={setComarca} buit={t('conv.all')}
              opcions={comarques.map((c) => ({ valor: c, text: c }))} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className="whitespace-normal">
            <Link to="/equip/convenis/campanya">{t('conv.go_campaign')}</Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            {t('conv.count', { n: visibles.length, total: files.length })}
          </span>
        </div>

        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}

        {!carregant && !error && (
          visibles.length === 0
            ? <p className="text-sm text-muted-foreground">{t(files.length === 0 ? 'conv.empty' : 'conv.no_match')}</p>
            : (
              // Criterio de las tablas (03-11-2026, AGENTS.md §2): a 360 px quedan
              // organización, estado y acción; lo demás va bajo la organización hasta que
              // tiene columna —número desde `md`, modelo y fecha desde `lg`, comarca en `xl`—.
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden md:table-cell">{t('conv.c_number')}</TableHead>
                    <TableHead>{t('conv.c_org')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('conv.c_model')}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t('conv.c_region')}</TableHead>
                    <TableHead>{t('conv.c_status')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('conv.c_date')}</TableHead>
                    <TableHead className="w-15 md:w-22">
                      <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((f) => {
                    const o = orgDe(f)
                    const ruta = `/equip/convenis/${f.id}`
                    const numero = f.numero_completo ?? t('conv.no_number')
                    const data = dataCurta(f.contrafirmado_at ?? f.firmado_at ?? f.enviado_at ?? f.created_at)
                    return (
                      <TableRow key={f.id}>
                        <TableCell className="hidden text-center font-medium tabular-nums md:table-cell">
                          {numero}
                        </TableCell>
                        {/* La organización ACTUAL, que es por lo que se busca; la razón social
                            con la que se firmó, debajo, solo si es otra cosa. Enlaza al
                            detalle, como el icono de la última columna. */}
                        <TableCell>
                          <Link to={ruta} className="font-medium text-primary hover:underline">
                            {o.nom !== '—' ? o.nom : nomOrganitzacio(f.datos_org, null)}
                          </Link>
                          {o.nom !== '—' && nomOrganitzacio(f.datos_org, o.nom) !== o.nom && (
                            <span className="block text-xs text-muted-foreground">{nomOrganitzacio(f.datos_org, o.nom)}</span>
                          )}
                          <Secundari peces={[
                            { text: o.comarca, fins: 'xl' },
                            { text: t(`sig.model_${f.tipo}`), fins: 'lg' },
                            { text: data, fins: 'lg' },
                            { text: numero, fins: 'md' },
                          ]} />
                        </TableCell>
                        <TableCell className="hidden text-center lg:table-cell">
                          <Badge variant="outline" className="whitespace-normal">{t(`sig.model_${f.tipo}`)}</Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground xl:table-cell">{o.comarca ?? '—'}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={`whitespace-normal ${estilEstatConveni(f.estado)}`}>{t(`conv.st_${f.estado}`)}</Badge>
                        </TableCell>
                        <TableCell className="hidden text-center whitespace-nowrap text-muted-foreground lg:table-cell">
                          {data}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                            <BotoIcona icona={Eye} etiqueta={t('conv.a_open')} onClick={() => navigate(ruta)} />
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )
        )}
      </CardContent>
    </Card>
  )
}
