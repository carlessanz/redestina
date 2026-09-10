// Listado de convenios del equipo.
//
// Los filtros son los tres con los que se reparte el trabajo de la campaña (§3.2.6): el
// **estado** dice qué hay que hacer hoy (contrafirmar lo firmado, insistir en lo pendiente),
// el **modelo** separa a quien dona de quien recibe y de quien compra, y la **comarca** es
// como se reparten los dinamizadores. Se filtra en cliente, sobre lo ya cargado, igual que
// `OffersList` y `ProducersList`: son cientos de filas, no cientos de miles (deuda §12.5).
//
// La comarca no está en `convenios`: sale de la ficha (`area_geografica`), que se pide
// **solo de los ids que salen en pantalla**, como en `Albarans`. Traerse las 343 fichas
// para poner una comarca en 12 filas sería cometer la deuda a propósito.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { dataCurta } from '../../lib/albarans'
import { ESTATS_CONVENI, TIPUS_CONVENI, estilEstatConveni, nomOrganitzacio } from '../../lib/convenis'
import type { ConvenioEstado, ConvenioTipo } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
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

const TOTS = '__tots'

export default function Convenis() {
  const { t } = useT()
  const [files, setFiles] = useState<Fila[]>([])
  const [orgs, setOrgs] = useState<Record<string, Org>>({})
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  const [estat, setEstat] = useState<string>(TOTS)
  const [tipus, setTipus] = useState<string>(TOTS)
  const [comarca, setComarca] = useState<string>(TOTS)

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
    const q = cerca.trim().toLowerCase()
    return files.filter((f) => {
      if (estat !== TOTS && f.estado !== estat) return false
      if (tipus !== TOTS && f.tipo !== tipus) return false
      const o = orgDe(f)
      if (comarca !== TOTS && (o.comarca ?? '') !== comarca) return false
      if (!q) return true
      const camps = [f.numero_completo, o.nom, o.comarca, nomOrganitzacio(f.datos_org, null)]
      return camps.some((c) => (c ?? '').toLowerCase().includes(q))
    })
  }, [files, cerca, estat, tipus, comarca, orgDe])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('conv.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('conv.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* A 360 px los cuatro controles van uno debajo de otro; desde `sm`, en dos
            columnas. Ningún `<select>` a mano: los de shadcn ya traen `text-base md:text-sm`. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="conv-cerca">{t('c.search')}</Label>
            <Input id="conv-cerca" type="search" placeholder={t('conv.search')}
              value={cerca} onChange={(e) => setCerca(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-estat">{t('conv.f_status')}</Label>
            <Select value={estat} onValueChange={setEstat}>
              <SelectTrigger id="conv-estat"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TOTS}>{t('conv.all')}</SelectItem>
                {ESTATS_CONVENI.map((e) => (
                  <SelectItem key={e} value={e}>{t(`conv.st_${e}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-tipus">{t('conv.f_model')}</Label>
            <Select value={tipus} onValueChange={setTipus}>
              <SelectTrigger id="conv-tipus"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TOTS}>{t('conv.all')}</SelectItem>
                {TIPUS_CONVENI.map((x) => (
                  <SelectItem key={x} value={x}>{t(`sig.model_${x}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-comarca">{t('conv.f_region')}</Label>
            <Select value={comarca} onValueChange={setComarca}>
              <SelectTrigger id="conv-comarca"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TOTS}>{t('conv.all')}</SelectItem>
                {comarques.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
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
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!carregant && !error && (
          visibles.length === 0
            ? <p className="text-sm text-muted-foreground">{t(files.length === 0 ? 'conv.empty' : 'conv.no_match')}</p>
            : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('conv.c_number')}</TableHead>
                      <TableHead>{t('conv.c_org')}</TableHead>
                      <TableHead>{t('conv.c_model')}</TableHead>
                      <TableHead>{t('conv.c_region')}</TableHead>
                      <TableHead>{t('conv.c_status')}</TableHead>
                      <TableHead>{t('conv.c_date')}</TableHead>
                      <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibles.map((f) => {
                      const o = orgDe(f)
                      return (
                        <TableRow key={f.id}>
                          <TableCell className="font-medium whitespace-nowrap tabular-nums">
                            {f.numero_completo ?? t('conv.no_number')}
                          </TableCell>
                          <TableCell className="max-w-56 truncate">
                            {nomOrganitzacio(f.datos_org, o.nom)}
                          </TableCell>
                          <TableCell><Badge variant="outline">{t(`sig.model_${f.tipo}`)}</Badge></TableCell>
                          <TableCell className="text-muted-foreground">{o.comarca ?? '—'}</TableCell>
                          <TableCell>
                            <Badge className={estilEstatConveni(f.estado)}>{t(`conv.st_${f.estado}`)}</Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {dataCurta(f.contrafirmado_at ?? f.firmado_at ?? f.enviado_at ?? f.created_at)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end">
                              {/* `h-11` en móvil: es la acción de la fila y 32 px es poco para un pulgar. */}
                              <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
                                <Link to={`/equip/convenis/${f.id}`}>{t('c.detail')}</Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )
        )}
      </CardContent>
    </Card>
  )
}
