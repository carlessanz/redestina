// La espigolada manual: la jornada de campo y su reparto en lotes.
//
// Dos pantallas en un fichero, como `Llistats.tsx`, porque son las dos mitades de la misma
// cosa: primero se apunta lo que se ha recogido (`NovaEspigolada`), luego se reparte
// (`EspigoladaDetall`).
//
// LO QUE HAY QUE ENTENDER PARA LEER ESTO. Una espigolada no es una oferta: nadie la publica
// ni nadie la solicita. `crear_espigolada()` crea de un golpe la cabecera, **un registro por
// producto** en estado `borrador` —a propósito, para que no salga en el mercado de ninguna
// entidad— y el albarán de RECEPCIÓN de la jornada, con una línea por producto. Después,
// `repartir_espigolada()` convierte cada lote en una canalización, y el trigger de
// `canalizaciones` le pone su albarán de ENTREGA en borrador. Esta pantalla no inserta nada:
// solo llama a esas dos RPC.
//
// El caso que hay que poder hacer sin pensar es el del plan: 1.000 kg de tomate en 29 cajas
// repartidos 400 / 400 / 200 con una nota por lote.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { crearEspigolada, dataCurta, estilEstatAlbara, kg, repartirEspigolada } from '../../lib/albarans'
import type { LiniaEntrada, LotEspigolada } from '../../lib/albarans'
import type { Espigolada } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Clases de un `<select>` estilado a mano. `text-base md:text-sm` es obligatorio (§2). */
const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm'

interface LiniaForm {
  producto: string
  variedad: string
  num_cajas: string
  tipo_caja: string
  kg_bruto: string
  tara_kg: string
  kg: string
}

const LINIA_BUIDA: LiniaForm = {
  producto: '', variedad: '', num_cajas: '', tipo_caja: '', kg_bruto: '', tara_kg: '', kg: '',
}

function num(v: string): number | null {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

// ---------------------------------------------------------------------------
// Alta de la jornada
// ---------------------------------------------------------------------------
export function NovaEspigolada() {
  const { t } = useT()
  const navigate = useNavigate()

  const [productors, setProductors] = useState<{ id: string; nom: string }[]>([])
  const [ubicacions, setUbicacions] = useState<{ id: string; alias: string | null; municipio: string | null }[]>([])
  const [productes, setProductes] = useState<string[]>([])
  const [caixes, setCaixes] = useState<{ codigo: string; nombre: string }[]>([])

  const [productor, setProductor] = useState('')
  const [ubicacio, setUbicacio] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [voluntaris, setVoluntaris] = useState('')
  const [notes, setNotes] = useState('')
  const [refExterna, setRefExterna] = useState('')
  const [linies, setLinies] = useState<LiniaForm[]>([{ ...LINIA_BUIDA }])
  const [ocupat, setOcupat] = useState(false)

  useEffect(() => {
    let viu = true
    void (async () => {
      // ⚠️ Cada lista de columnas en UN literal (§7, deuda 46).
      const [p, pr, c] = await Promise.all([
        supabase.from('productores').select('id, name, empresa').eq('activo', true).order('name'),
        supabase.from('productos').select('nombre').order('nombre'),
        supabase.from('tipos_caja').select('codigo, nombre').eq('activo', true).order('orden'),
      ])
      if (!viu) return
      setProductors(((p.data as { id: string; name: string | null; empresa: string | null }[] | null) ?? [])
        .map((x) => ({ id: x.id, nom: x.empresa || x.name || '—' })))
      setProductes(((pr.data as { nombre: string }[] | null) ?? []).map((x) => x.nombre))
      setCaixes((c.data as { codigo: string; nombre: string }[] | null) ?? [])
    })()
    return () => { viu = false }
  }, [])

  // Las ubicaciones son del productor elegido: 329 de 341 fichas no tienen ninguna, así que
  // el desplegable puede quedarse vacío y eso está bien (la RPC acepta `p_ubicacion` null).
  useEffect(() => {
    if (!productor) { setUbicacions([]); setUbicacio(''); return }
    let viu = true
    void (async () => {
      const { data: u } = await supabase.from('productor_ubicaciones')
        .select('id, alias, municipio')
        .eq('productor_id', productor)
        .order('es_principal', { ascending: false })
      if (!viu) return
      setUbicacions((u as { id: string; alias: string | null; municipio: string | null }[] | null) ?? [])
      setUbicacio('')
    })()
    return () => { viu = false }
  }, [productor])

  function actualitza(i: number, camp: keyof LiniaForm, valor: string) {
    setLinies((prev) => prev.map((l, j) => {
      if (j !== i) return l
      const nova = { ...l, [camp]: valor }
      // El neto se deduce del bruto menos la tara mientras nadie lo escriba a mano.
      if (camp === 'kg_bruto' || camp === 'tara_kg') {
        const brut = num(nova.kg_bruto)
        const tara = num(nova.tara_kg) ?? 0
        if (brut != null) nova.kg = String(Math.max(0, brut - tara))
      }
      return nova
    }))
  }

  async function desa() {
    if (!productor) { toast.error(t('esp.need_producer')); return }
    const utils = linies.filter((l) => l.producto && num(l.kg) !== null)
    if (utils.length === 0) { toast.error(t('esp.need_lines')); return }

    setOcupat(true)
    const res = await crearEspigolada({
      productor,
      ubicacio: ubicacio || null,
      data: data || null,
      voluntaris: num(voluntaris),
      notes: notes || null,
      refExterna: refExterna || null,
      linies: utils.map((l, i): LiniaEntrada => ({
        orden: i + 1,
        producto: l.producto,
        variedad: l.variedad || null,
        num_cajas: num(l.num_cajas),
        tipo_caja: l.tipo_caja || null,
        kg_bruto: num(l.kg_bruto),
        tara_kg: num(l.tara_kg),
        // La RPC de espigolada lee `kg` (no `kg_neto`): es el peso de la jornada, que va a
        // la vez al registro y a la línea del albarán de recepción.
        kg: num(l.kg),
      })),
    })
    setOcupat(false)

    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('esp.created', { n: res.data.registres.length }))
    navigate(`/equip/espigolades/${res.data.espigolada_id}`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('esp.new_title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('esp.new_subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="esp-prod">{t('esp.producer')}</Label>
            <select id="esp-prod" className={SELECT} value={productor}
              onChange={(e) => setProductor(e.target.value)}>
              <option value="">{t('esp.pick_producer')}</option>
              {productors.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-ubi">{t('esp.location')}</Label>
            <select id="esp-ubi" className={SELECT} value={ubicacio}
              onChange={(e) => setUbicacio(e.target.value)} disabled={ubicacions.length === 0}>
              <option value="">{ubicacions.length === 0 ? t('esp.no_locations') : t('c.none')}</option>
              {ubicacions.map((u) => (
                <option key={u.id} value={u.id}>{u.alias || u.municipio || u.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-data">{t('esp.date')}</Label>
            <Input id="esp-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-vol">{t('esp.volunteers')}</Label>
            <Input id="esp-vol" type="number" inputMode="numeric" value={voluntaris}
              onChange={(e) => setVoluntaris(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="esp-ref">{t('esp.ref')}</Label>
            <Input id="esp-ref" value={refExterna} onChange={(e) => setRefExterna(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="esp-notes">{t('esp.notes')}</Label>
            <Textarea id="esp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-base">{t('esp.lines')}</h2>
          {linies.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`el-prod-${i}`}>{t('alb.ln_product')}</Label>
                <select id={`el-prod-${i}`} className={SELECT} value={l.producto}
                  onChange={(e) => actualitza(i, 'producto', e.target.value)}>
                  <option value="">{t('c.none')}</option>
                  {productes.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`el-var-${i}`}>{t('alb.ln_variety')}</Label>
                <Input id={`el-var-${i}`} value={l.variedad}
                  onChange={(e) => actualitza(i, 'variedad', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`el-cx-${i}`}>{t('alb.ln_boxes')}</Label>
                <Input id={`el-cx-${i}`} type="number" inputMode="numeric" value={l.num_cajas}
                  onChange={(e) => actualitza(i, 'num_cajas', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`el-tc-${i}`}>{t('alb.ln_boxtype')}</Label>
                <select id={`el-tc-${i}`} className={SELECT} value={l.tipo_caja}
                  onChange={(e) => actualitza(i, 'tipo_caja', e.target.value)}>
                  <option value="">{t('c.none')}</option>
                  {caixes.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`el-br-${i}`}>{t('alb.ln_gross')}</Label>
                <Input id={`el-br-${i}`} type="number" inputMode="decimal" step="0.01" value={l.kg_bruto}
                  onChange={(e) => actualitza(i, 'kg_bruto', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`el-ta-${i}`}>{t('alb.ln_tare')}</Label>
                <Input id={`el-ta-${i}`} type="number" inputMode="decimal" step="0.01" value={l.tara_kg}
                  onChange={(e) => actualitza(i, 'tara_kg', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`el-kg-${i}`}>{t('alb.ln_net')}</Label>
                <Input id={`el-kg-${i}`} type="number" inputMode="decimal" step="0.01" value={l.kg}
                  onChange={(e) => actualitza(i, 'kg', e.target.value)} />
              </div>
              {linies.length > 1 && (
                <div className="sm:col-span-2">
                  <Button variant="outline" size="sm" className="h-11 whitespace-normal md:h-9"
                    onClick={() => setLinies((p) => p.filter((_, j) => j !== i))}>
                    {t('alb.ln_remove')}
                  </Button>
                </div>
              )}
            </div>
          ))}
          <Button variant="outline" className="h-11 whitespace-normal md:h-9"
            onClick={() => setLinies((p) => [...p, { ...LINIA_BUIDA }])}>
            {t('alb.ln_add')}
          </Button>
        </div>

        <Button className="h-11 whitespace-normal md:h-9" disabled={ocupat} onClick={() => void desa()}>
          {ocupat ? t('c.saving') : t('esp.create')}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// La jornada y su reparto
// ---------------------------------------------------------------------------
interface RegistreFila {
  id: string
  id_excedente: string | null
  producto: string | null
  variedad: string | null
  kg_total: number | null
  estado: string
}

interface AlbaraFila {
  id: string
  tipo: string
  numero_completo: string | null
  estado: string
  excedente_id: string | null
  canalizacion_id: string | null
}

interface LotForm {
  excedente_id: string
  entidad_id: string
  kg: string
  nota: string
  codigo_lote: string
}

export function EspigoladaDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [espigolada, setEspigolada] = useState<Espigolada | null>(null)
  const [registres, setRegistres] = useState<RegistreFila[]>([])
  const [albarans, setAlbarans] = useState<AlbaraFila[]>([])
  const [repartit, setRepartit] = useState<Record<string, number>>({})
  const [entitats, setEntitats] = useState<{ id: string; nombre: string }[]>([])
  const [lots, setLots] = useState<LotForm[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)

  const carrega = useCallback(async () => {
    if (!id) return
    const { data: e, error: errE } = await supabase.from('espigoladas')
      .select('id, productor_id, ubicacion_id, fecha, num_voluntarios, notas, ref_externa, estado, creada_por, created_at')
      .eq('id', id).maybeSingle()
    if (errE) { setError(errE.message); setCarregant(false); return }
    if (!e) { setError(t('esp.not_found')); setCarregant(false); return }
    setEspigolada(e as Espigolada)

    const { data: regs } = await supabase.from('excedentes')
      .select('id, id_excedente, producto, variedad, kg_total, estado')
      .eq('espigolada_id', id)
      .order('created_at')
    const llista = (regs as RegistreFila[] | null) ?? []
    setRegistres(llista)

    const ids = llista.map((r) => r.id)
    const [alb, can] = await Promise.all([
      supabase.from('albaranes')
        .select('id, tipo, numero_completo, estado, excedente_id, canalizacion_id')
        .or(`espigolada_id.eq.${id}${ids.length ? `,excedente_id.in.(${ids.join(',')})` : ''}`),
      ids.length
        ? supabase.from('canalizaciones').select('id, excedente_id, kg_confirmados').in('excedente_id', ids)
        : Promise.resolve({ data: [] }),
    ])
    setAlbarans((alb.data as AlbaraFila[] | null) ?? [])

    const suma: Record<string, number> = {}
    for (const c of (can.data ?? []) as { excedente_id: string | null; kg_confirmados: number | null }[]) {
      if (!c.excedente_id) continue
      suma[c.excedente_id] = (suma[c.excedente_id] ?? 0) + Number(c.kg_confirmados ?? 0)
    }
    setRepartit(suma)
    setCarregant(false)
  }, [id, t])

  useEffect(() => { void carrega() }, [carrega])

  useEffect(() => {
    let viu = true
    void supabase.from('entidades').select('id, nombre').order('nombre').then(({ data }) => {
      if (viu) setEntitats((data as { id: string; nombre: string }[] | null) ?? [])
    })
    return () => { viu = false }
  }, [])

  function afegeixLot(excedenteId: string) {
    setLots((p) => [...p, { excedente_id: excedenteId, entidad_id: '', kg: '', nota: '', codigo_lote: '' }])
  }

  async function reparteix() {
    if (!id) return
    const utils: LotEspigolada[] = lots
      .filter((l) => l.entidad_id && num(l.kg) !== null)
      .map((l) => ({
        excedente_id: l.excedente_id,
        entidad_id: l.entidad_id,
        kg: num(l.kg) as number,
        nota: l.nota || null,
        codigo_lote: l.codigo_lote || null,
      }))
    if (utils.length === 0) { toast.error(t('esp.need_lots')); return }

    setOcupat(true)
    const res = await repartirEspigolada(id, utils)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }

    // Los avisos de convenio no bloquean nada hoy (el `exigir_convenio()` de la base es un
    // stub hasta la fase 2), pero se enseñan: cuando dejen de ser avisos y pasen a ser
    // bloqueos, la persona ya estará acostumbrada a leerlos.
    for (const avis of res.data.avisos) toast.warning(avis)
    toast.success(t('esp.distributed', { n: res.data.lots.length }))
    setLots([])
    await carrega()
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (carregant || !espigolada) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  const rec = albarans.find((a) => a.tipo === 'REC')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="h-11 md:h-9" onClick={() => navigate('/equip/albarans')}>
          <ArrowLeft className="size-4" />{t('c.back')}
        </Button>
        <h1 className="text-xl">{t('esp.title', { date: dataCurta(espigolada.fecha) })}</h1>
        <Badge className={espigolada.estado === 'oberta' ? 'bg-aviso-fondo text-aviso' : 'bg-muted text-muted-foreground'}>
          {t(`esp.st_${espigolada.estado}`)}
        </Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('esp.summary')}</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <p>{t('esp.volunteers')}: <span className="tabular-nums">{espigolada.num_voluntarios ?? '—'}</span></p>
          <p>{t('esp.ref')}: {espigolada.ref_externa ?? '—'}</p>
          {espigolada.notas && <p className="sm:col-span-2 text-muted-foreground">{espigolada.notas}</p>}
          {rec && (
            <p className="sm:col-span-2">
              {t('esp.reception')}:{' '}
              <Link className="underline" to={`/equip/albarans/${rec.id}`}>
                {rec.numero_completo ?? t('alb.no_number')}
              </Link>{' '}
              <Badge className={estilEstatAlbara(rec.estado)}>{t(`alb.st_${rec.estado}`)}</Badge>
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Registros y su reparto ── */}
      {registres.map((r) => {
        const jaRepartit = repartit[r.id] ?? 0
        const resta = Number(r.kg_total ?? 0) - jaRepartit
        const meus = lots.filter((l) => l.excedente_id === r.id)
        const entregues = albarans.filter((a) => a.tipo !== 'REC' && a.excedente_id === r.id)
        return (
          <Card key={r.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {r.producto ?? '—'}{r.variedad ? ` · ${r.variedad}` : ''}
              </CardTitle>
              <p className="text-sm text-muted-foreground tabular-nums">
                {t('esp.kg_line', { total: kg(r.kg_total), done: kg(jaRepartit), left: kg(resta) })}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {entregues.length > 0 && (
                <div className="space-y-1 text-sm">
                  {entregues.map((a) => (
                    <p key={a.id}>
                      <Link className="underline" to={`/equip/albarans/${a.id}`}>
                        {a.numero_completo ?? t('alb.no_number')}
                      </Link>{' '}
                      <Badge variant="outline">{a.tipo}</Badge>{' '}
                      <Badge className={estilEstatAlbara(a.estado)}>{t(`alb.st_${a.estado}`)}</Badge>
                    </p>
                  ))}
                </div>
              )}

              {espigolada.estado === 'oberta' && (
                <>
                  {meus.map((l, i) => {
                    const idx = lots.indexOf(l)
                    return (
                      <div key={`${r.id}-${i}`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor={`lot-ent-${idx}`}>{t('esp.entity')}</Label>
                          <select id={`lot-ent-${idx}`} className={SELECT} value={l.entidad_id}
                            onChange={(e) => setLots((p) => p.map((x, j) => j === idx ? { ...x, entidad_id: e.target.value } : x))}>
                            <option value="">{t('esp.pick_entity')}</option>
                            {entitats.map((en) => <option key={en.id} value={en.id}>{en.nombre}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`lot-kg-${idx}`}>{t('esp.lot_kg')}</Label>
                          <Input id={`lot-kg-${idx}`} type="number" inputMode="decimal" step="0.01" value={l.kg}
                            onChange={(e) => setLots((p) => p.map((x, j) => j === idx ? { ...x, kg: e.target.value } : x))} />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`lot-cod-${idx}`}>{t('esp.lot_code')}</Label>
                          <Input id={`lot-cod-${idx}`} value={l.codigo_lote}
                            onChange={(e) => setLots((p) => p.map((x, j) => j === idx ? { ...x, codigo_lote: e.target.value } : x))} />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor={`lot-nota-${idx}`}>{t('esp.lot_note')}</Label>
                          <Textarea id={`lot-nota-${idx}`} rows={2} value={l.nota}
                            onChange={(e) => setLots((p) => p.map((x, j) => j === idx ? { ...x, nota: e.target.value } : x))} />
                        </div>
                        <div className="sm:col-span-2">
                          <Button variant="outline" size="sm" className="h-11 whitespace-normal md:h-9"
                            onClick={() => setLots((p) => p.filter((_, j) => j !== idx))}>
                            {t('esp.lot_remove')}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                  <Button variant="outline" className="h-11 whitespace-normal md:h-9"
                    onClick={() => afegeixLot(r.id)}>
                    {t('esp.lot_add')}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )
      })}

      {espigolada.estado === 'oberta' && lots.length > 0 && (
        <Button className="h-11 whitespace-normal md:h-9" disabled={ocupat} onClick={() => void reparteix()}>
          {ocupat ? t('c.saving') : t('esp.distribute', { n: lots.length })}
        </Button>
      )}
    </div>
  )
}
