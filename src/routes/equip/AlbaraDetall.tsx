// Ficha de un albarán: el sitio donde el equipo recorre el circuito documental entero.
//
// Borrador → Emès → Entregat → Confirmat → Conciliat, y en los márgenes Anul·lar y
// Rectificar. Ninguna de esas seis cosas es un `update`: todas son RPC, porque todas mueven
// varias tablas a la vez (pedir número, congelar las partes, crear enlaces, emitir una
// versión nueva del PDF). `authenticated` solo tiene SELECT sobre `albaranes`, así que aquí
// no hay ni puede haber escritura directa.
//
// LAS LÍNEAS SOLO SE EDITAN EN BORRADOR, y no es una decisión de la pantalla: el trigger
// `albaranes_inmutable` congela la identidad y las partes en cuanto el estado deja de ser
// `borrador`, y `emitir_albaran()` es lo único que sustituye líneas. Un albarán emitido con
// un error se rectifica —serie `R-*`, con su motivo—, no se corrige.
//
// NI UN IMPORTE. `albaran_lineas` no tiene ninguna columna de dinero, a propósito: un
// albarán con un precio convierte una donación en una operación comercial a ojos de quien
// lo lea. Si algún día aparece aquí un campo de euros, está mal.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { descarregarDocument, esperarGeneracio } from '../../lib/documents'
import {
  anullarAlbara, conciliarAlbara, dataCurta, emetreAlbara, estilEstatAlbara, kg,
  marcarEntregat, propostaConciliacio, rectificarAlbara,
} from '../../lib/albarans'
import type { LiniaEntrada, PropostaConciliacio } from '../../lib/albarans'
import type { Albaran, AlbaranLinea, DocumentoExterno } from '../../types'
import DialegMotiu from '../../components/DialegMotiu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/** Una línea mientras se edita: todo texto, porque un input vacío no es 0 sino «no sé». */
interface LiniaForm {
  id: string | null
  producto: string
  variedad: string
  num_cajas: string
  tipo_caja: string
  kg_bruto: string
  tara_kg: string
  kg_neto: string
  lote_origen: string
}

interface DocFila {
  id: string
  tipo: string
  subtipo: string | null
  numero_completo: string
  version: number
  estado: 'pendiente_fichero' | 'emitido' | 'error'
  vigente: boolean
  emitido_at: string
}

interface EvidenciaFila {
  id: string
  enlace_id: string
  tipo: string
  nombre: string | null
  cargo: string | null
  ip: string | null
  created_at: string
}

interface EnllacFila {
  id: string
  destinatario_email: string | null
  destinatario_nombre: string | null
  estado: string
  caduca_at: string
  usado_at: string | null
}

const BUIDA: LiniaForm = {
  id: null, producto: '', variedad: '', num_cajas: '', tipo_caja: '',
  kg_bruto: '', tara_kg: '', kg_neto: '', lote_origen: '',
}

function aForm(l: AlbaranLinea): LiniaForm {
  return {
    id: l.id,
    producto: l.producto ?? '',
    variedad: l.variedad ?? '',
    num_cajas: l.num_cajas != null ? String(l.num_cajas) : '',
    tipo_caja: l.tipo_caja ?? '',
    kg_bruto: l.kg_bruto != null ? String(l.kg_bruto) : '',
    tara_kg: l.tara_kg != null ? String(l.tara_kg) : '',
    kg_neto: l.kg_neto != null ? String(l.kg_neto) : (l.kg_previstos != null ? String(l.kg_previstos) : ''),
    lote_origen: l.lote_origen ?? '',
  }
}

function num(v: string): number | null {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

function aEntrada(l: LiniaForm, ordre: number): LiniaEntrada {
  return {
    orden: ordre,
    producto: l.producto || null,
    variedad: l.variedad || null,
    num_cajas: num(l.num_cajas),
    tipo_caja: l.tipo_caja || null,
    kg_bruto: num(l.kg_bruto),
    // `tara_kg` vacía no es 0: la RPC la calcula con `num_cajas × tipos_caja.tara_kg`.
    tara_kg: num(l.tara_kg),
    kg_neto: num(l.kg_neto),
    lote_origen: l.lote_origen || null,
  }
}

/** Texto de una parte congelada de `partes`. Se lee de un jsonb, así que se navega a mano. */
function part(partes: Record<string, unknown> | null, clau: string): Record<string, string> {
  const p = (partes?.[clau] ?? null) as Record<string, unknown> | null
  if (!p) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(p)) if (typeof v === 'string' && v) out[k] = v
  return out
}

export default function AlbaraDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false

  const [albara, setAlbara] = useState<Albaran | null>(null)
  const [linies, setLinies] = useState<AlbaranLinea[]>([])
  const [form, setForm] = useState<LiniaForm[]>([])
  const [recollida, setRecollida] = useState<Record<string, string>>({})
  const [documents, setDocuments] = useState<DocFila[]>([])
  const [externs, setExterns] = useState<DocumentoExterno[]>([])
  const [enllacos, setEnllacos] = useState<EnllacFila[]>([])
  const [evidencies, setEvidencies] = useState<EvidenciaFila[]>([])
  const [productes, setProductes] = useState<string[]>([])
  const [caixes, setCaixes] = useState<{ codigo: string; nombre: string }[]>([])

  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)
  const [descarregant, setDescarregant] = useState<string | null>(null)

  const [dialegAnullar, setDialegAnullar] = useState(false)
  const [dialegRectificar, setDialegRectificar] = useState(false)
  const [dialegConciliar, setDialegConciliar] = useState(false)
  const [proposta, setProposta] = useState<PropostaConciliacio | null>(null)
  const [enllacosNous, setEnllacosNous] = useState<{ nom: string; url: string }[]>([])

  const avortar = useRef<AbortController | null>(null)
  useEffect(() => () => avortar.current?.abort(), [])

  const carrega = useCallback(async () => {
    if (!id) return
    // ⚠️ Cada `.select()` con su lista de columnas en UN literal (§7, deuda 46).
    const { data: a, error: errA } = await supabase
      .from('albaranes')
      .select('id, tipo, serie, ejercicio, numero, numero_completo, excedente_id, espigolada_id, canalizacion_id, estado, partes, recogida, retorn_envasos, observaciones, incidencias, rechazo, motivo_rechazo, idioma, emitido_at, emitido_por, entregado_at, confirmado_at, conciliado_at, conciliado_por, motivo_conciliacion, destino_final, anulado_at, motivo_anulacion, rectifica_a, rectificado_por, created_at')
      .eq('id', id)
      .maybeSingle()

    if (errA) { setError(errA.message); setCarregant(false); return }
    if (!a) { setError(t('alb.not_found')); setCarregant(false); return }

    const fila = a as Albaran
    setAlbara(fila)
    setRecollida(
      Object.fromEntries(
        Object.entries((fila.recogida ?? {}) as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => [k, v as string]),
      ),
    )

    const [ln, docs, ext, enl] = await Promise.all([
      supabase.from('albaran_lineas')
        .select('id, albaran_id, orden, producto, variedad, familia, causa, num_cajas, tipo_caja, kg_bruto, tara_kg, kg_neto, kg_previstos, kg_entregados, kg_confirmados, kg_validados, lote_origen, created_at')
        .eq('albaran_id', id).order('orden'),
      supabase.from('documentos')
        .select('id, tipo, subtipo, numero_completo, version, estado, vigente, emitido_at')
        .eq('objeto_tipo', 'albaran').eq('objeto_id', id)
        .order('version', { ascending: false }),
      supabase.from('documentos_externos')
        .select('id, objeto_tipo, objeto_id, tipo, numero, fecha, ruta, sha256, mime, bytes, origen, subido_por, created_at')
        .eq('objeto_tipo', 'albaran').eq('objeto_id', id)
        .order('created_at', { ascending: false }),
      supabase.from('enlaces_token')
        .select('id, destinatario_email, destinatario_nombre, estado, caduca_at, usado_at')
        .eq('objeto_tipo', 'albaran').eq('objeto_id', id)
        .order('created_at', { ascending: false }),
    ])

    const llistaLinies = (ln.data as AlbaranLinea[] | null) ?? []
    setLinies(llistaLinies)
    setForm(llistaLinies.length ? llistaLinies.map(aForm) : [{ ...BUIDA }])
    setDocuments((docs.data as DocFila[] | null) ?? [])
    setExterns((ext.data as DocumentoExterno[] | null) ?? [])
    const llistaEnllacos = (enl.data as EnllacFila[] | null) ?? []
    setEnllacos(llistaEnllacos)

    if (llistaEnllacos.length) {
      const { data: ev } = await supabase.from('evidencias')
        .select('id, enlace_id, tipo, nombre, cargo, ip, created_at')
        .in('enlace_id', llistaEnllacos.map((e) => e.id))
        .order('created_at', { ascending: false })
      setEvidencies((ev as EvidenciaFila[] | null) ?? [])
    }
    setCarregant(false)
  }, [id, t])

  useEffect(() => { void carrega() }, [carrega])

  // Catálogos del editor de líneas. `producto` es FK a `productos(nombre)` y `tipo_caja` a
  // `tipos_caja(codigo)`: un campo de texto libre acabaría en un error de clave foránea que
  // la persona no puede interpretar, así que van en desplegable.
  useEffect(() => {
    let viu = true
    void (async () => {
      const [p, c] = await Promise.all([
        supabase.from('productos').select('nombre').order('nombre'),
        supabase.from('tipos_caja').select('codigo, nombre').eq('activo', true).order('orden'),
      ])
      if (!viu) return
      setProductes(((p.data as { nombre: string }[] | null) ?? []).map((x) => x.nombre))
      setCaixes((c.data as { codigo: string; nombre: string }[] | null) ?? [])
    })()
    return () => { viu = false }
  }, [])

  const esBorrador = albara?.estado === 'borrador'
  const totals = useMemo(() => {
    const suma = (f: (l: AlbaranLinea) => number | null) =>
      linies.reduce((acc, l) => acc + Number(f(l) ?? 0), 0)
    return {
      previstos: suma((l) => l.kg_previstos),
      net: suma((l) => l.kg_neto),
      confirmats: suma((l) => l.kg_confirmados),
      validats: suma((l) => l.kg_validados),
    }
  }, [linies])

  function actualitza(i: number, camp: keyof LiniaForm, valor: string) {
    setForm((prev) => prev.map((l, j) => {
      if (j !== i) return l
      const nova = { ...l, [camp]: valor }
      // El neto se recalcula solo mientras nadie lo escriba a mano. Es lo que se pesa en la
      // finca: bruto en la báscula y tara del tipo de caja; obligar a hacer la resta a mano
      // con el móvil en una mano es cómo se cuela un kilo mal.
      if (camp === 'kg_bruto' || camp === 'tara_kg') {
        const brut = num(nova.kg_bruto)
        const tara = num(nova.tara_kg) ?? 0
        nova.kg_neto = brut != null ? String(Math.max(0, brut - tara)) : nova.kg_neto
      }
      return nova
    }))
  }

  async function emet() {
    if (!albara) return
    setOcupat(true)
    const res = await emetreAlbara(
      albara.id,
      Object.keys(recollida).length ? recollida : null,
      form.map(aEntrada),
      albara.idioma,
    )
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('alb.emitted'))
    await carrega()
  }

  async function entrega() {
    if (!albara) return
    setOcupat(true)
    const res = await marcarEntregat(albara.id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }

    // El token en claro solo existe aquí. Se enseña como enlace copiable porque el modelo
    // de Redestina es asistido (§1bis): hay confirmaciones que el dinamizador conduce por
    // teléfono. El correo lo manda el servidor por su cuenta; esto es la vía asistida.
    const nous = (res.data.enllacos ?? []).map((e) => ({
      nom: e.nom || e.destinatari,
      url: `${window.location.origin}/confirmar/${e.token}`,
    }))
    setEnllacosNous(nous)
    toast.success(t('alb.delivered', { n: nous.length }))
    await carrega()
  }

  async function obreConciliacio() {
    if (!albara) return
    setOcupat(true)
    const res = await propostaConciliacio(albara.id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    setProposta(res.data)
    setDialegConciliar(true)
  }

  async function concilia(kgValidats: { linea_id: string; kg: number }[], motiu: string, desti: string) {
    if (!albara) return
    setOcupat(true)
    const res = await conciliarAlbara(
      albara.id,
      kgValidats.length ? kgValidats : null,
      motiu.trim() || null,
      desti.trim() || null,
    )
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    setDialegConciliar(false)
    toast.success(t('alb.reconciled'))
    await carrega()
  }

  async function anulla(motiu: string) {
    if (!albara) return
    setOcupat(true)
    const res = await anullarAlbara(albara.id, motiu)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    setDialegAnullar(false)
    toast.success(t('alb.cancelled'))
    await carrega()
  }

  async function rectifica(linesRect: LiniaForm[], motiu: string) {
    if (!albara) return
    setOcupat(true)
    const res = await rectificarAlbara(albara.id, linesRect.map(aEntrada), motiu)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    setDialegRectificar(false)
    const nou = (res.data as { id?: string }).id
    toast.success(t('alb.rectified'))
    if (nou) navigate(`/equip/albarans/${nou}`)
    else await carrega()
  }

  /** Igual que la bandeja de documentos: si el PDF aún se genera, se espera por polling. */
  async function descarrega(docId: string) {
    setDescarregant(docId)
    const res = await descarregarDocument(docId)
    if (res.ok) { toast.success(t('doc.downloaded', { name: res.data.nombre })); setDescarregant(null); return }
    if (res.codi !== 'sense_fitxer') { toast.error(t(res.motiuKey)); setDescarregant(null); return }

    toast.info(t('doc.generating_wait'))
    avortar.current?.abort()
    const control = new AbortController()
    avortar.current = control
    const espera = await esperarGeneracio(docId, control.signal)
    if (espera.resultat === 'cancellat') { setDescarregant(null); return }
    if (espera.resultat !== 'emitido') {
      if (espera.motiuKey) toast.error(t(espera.motiuKey))
      setDescarregant(null)
      await carrega()
      return
    }
    const segon = await descarregarDocument(docId)
    if (segon.ok) toast.success(t('doc.downloaded', { name: segon.data.nombre }))
    else toast.error(t(segon.motiuKey))
    setDescarregant(null)
    await carrega()
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (carregant || !albara) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  const entrega_ = part(albara.partes, 'entrega')
  const rep = part(albara.partes, 'recibe')
  const origen = part(albara.partes, 'origen')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="h-11 md:h-9" onClick={() => navigate('/equip/albarans')}>
          <ArrowLeft className="size-4" />{t('c.back')}
        </Button>
        <h1 className="text-xl tabular-nums">{albara.numero_completo ?? t('alb.no_number')}</h1>
        <Badge variant="outline">{albara.tipo}</Badge>
        <Badge className={estilEstatAlbara(albara.estado)}>{t(`alb.st_${albara.estado}`)}</Badge>
        {albara.rechazo !== 'cap' && (
          <Badge className="bg-error-fondo text-error">{t(`alb.rj_${albara.rechazo}`)}</Badge>
        )}
      </div>

      {albara.motivo_rechazo && (
        <p className="rounded-md bg-error-fondo p-3 text-sm text-error">
          {t('alb.reject_reason')}: {albara.motivo_rechazo}
        </p>
      )}
      {albara.motivo_anulacion && (
        <p className="rounded-md bg-error-fondo p-3 text-sm text-error">
          {t('alb.cancel_reason')}: {albara.motivo_anulacion}
        </p>
      )}

      {/* ── Partes ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('alb.parties')}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          {albara.partes ? (
            <>
              <div>
                <p className="font-medium">{t('alb.delivers')}</p>
                {Object.entries(entrega_).map(([k, v]) => (
                  <p key={k} className="text-muted-foreground">{v}</p>
                ))}
              </div>
              <div>
                <p className="font-medium">{t('alb.receives')}</p>
                {Object.entries(rep).map(([k, v]) => (
                  <p key={k} className="text-muted-foreground">{v}</p>
                ))}
              </div>
              {Object.keys(origen).length > 0 && (
                <div className="sm:col-span-2">
                  <p className="font-medium">{t('alb.origin')}</p>
                  <p className="text-muted-foreground">{Object.values(origen).join(' · ')}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground sm:col-span-2">{t('alb.parties_pending')}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Recogida ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('alb.pickup')}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {(['fecha_hora', 'lugar', 'responsable_origen', 'quien_recoge', 'transportista', 'matricula', 'temperatura'] as const).map((camp) => (
            <div key={camp} className="space-y-1.5">
              <Label htmlFor={`rec-${camp}`}>{t(`alb.pk_${camp}`)}</Label>
              <Input
                id={`rec-${camp}`}
                type={camp === 'fecha_hora' ? 'datetime-local' : 'text'}
                value={recollida[camp] ?? ''}
                disabled={!esBorrador}
                onChange={(e) => setRecollida((p) => ({ ...p, [camp]: e.target.value }))}
              />
            </div>
          ))}
          {!esBorrador && (
            <p className="text-xs text-muted-foreground sm:col-span-2">{t('alb.frozen_hint')}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Líneas ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('alb.lines')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {esBorrador ? (
            <>
              {form.map((l, i) => (
                <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`ln-prod-${i}`}>{t('alb.ln_product')}</Label>
                    {/* ⚠️ `text-base md:text-sm` obligatorio en un `<select>` estilado a mano:
                        iOS amplía la página al enfocarlo y no lo deshace (§2, regla 1). */}
                    <select
                      id={`ln-prod-${i}`}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm"
                      value={l.producto}
                      onChange={(e) => actualitza(i, 'producto', e.target.value)}
                    >
                      <option value="">{t('c.none')}</option>
                      {productes.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ln-var-${i}`}>{t('alb.ln_variety')}</Label>
                    <Input id={`ln-var-${i}`} value={l.variedad}
                      onChange={(e) => actualitza(i, 'variedad', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ln-caixes-${i}`}>{t('alb.ln_boxes')}</Label>
                    <Input id={`ln-caixes-${i}`} type="number" inputMode="numeric" value={l.num_cajas}
                      onChange={(e) => actualitza(i, 'num_cajas', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ln-caixa-${i}`}>{t('alb.ln_boxtype')}</Label>
                    <select
                      id={`ln-caixa-${i}`}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm"
                      value={l.tipo_caja}
                      onChange={(e) => actualitza(i, 'tipo_caja', e.target.value)}
                    >
                      <option value="">{t('c.none')}</option>
                      {caixes.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ln-brut-${i}`}>{t('alb.ln_gross')}</Label>
                    <Input id={`ln-brut-${i}`} type="number" inputMode="decimal" step="0.01" value={l.kg_bruto}
                      onChange={(e) => actualitza(i, 'kg_bruto', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ln-tara-${i}`}>{t('alb.ln_tare')}</Label>
                    <Input id={`ln-tara-${i}`} type="number" inputMode="decimal" step="0.01" value={l.tara_kg}
                      placeholder={t('alb.ln_tare_auto')}
                      onChange={(e) => actualitza(i, 'tara_kg', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ln-net-${i}`}>{t('alb.ln_net')}</Label>
                    <Input id={`ln-net-${i}`} type="number" inputMode="decimal" step="0.01" value={l.kg_neto}
                      onChange={(e) => actualitza(i, 'kg_neto', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`ln-lot-${i}`}>{t('alb.ln_lot')}</Label>
                    <Input id={`ln-lot-${i}`} value={l.lote_origen}
                      onChange={(e) => actualitza(i, 'lote_origen', e.target.value)} />
                  </div>
                  {form.length > 1 && (
                    <div className="sm:col-span-2">
                      <Button variant="outline" size="sm" className="h-11 whitespace-normal md:h-9"
                        onClick={() => setForm((p) => p.filter((_, j) => j !== i))}>
                        {t('alb.ln_remove')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              <Button variant="outline" className="h-11 whitespace-normal md:h-9"
                onClick={() => setForm((p) => [...p, { ...BUIDA }])}>
                {t('alb.ln_add')}
              </Button>
            </>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('alb.ln_product')}</TableHead>
                    <TableHead className="text-right">{t('alb.ln_boxes')}</TableHead>
                    <TableHead className="text-right">{t('alb.ln_planned')}</TableHead>
                    <TableHead className="text-right">{t('alb.ln_net')}</TableHead>
                    <TableHead className="text-right">{t('alb.ln_confirmed')}</TableHead>
                    <TableHead className="text-right">{t('alb.ln_validated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linies.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">
                        {l.producto ?? '—'}
                        {l.variedad ? <span className="text-muted-foreground"> · {l.variedad}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.num_cajas ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{kg(l.kg_previstos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{kg(l.kg_neto)}</TableCell>
                      <TableCell className="text-right tabular-nums">{kg(l.kg_confirmados)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{kg(l.kg_validados)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {t('alb.totals', {
              prev: kg(totals.previstos), net: kg(totals.net),
              conf: kg(totals.confirmats), val: kg(totals.validats),
            })}
          </p>
        </CardContent>
      </Card>

      {/* ── Acciones ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('alb.actions')}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {esBorrador && (
            <Button className="h-11 whitespace-normal md:h-9" disabled={ocupat} onClick={() => void emet()}>
              {ocupat && <Loader2 className="size-4 animate-spin" />}{t('alb.emit')}
            </Button>
          )}
          {albara.estado === 'emitido' && (
            <Button className="h-11 whitespace-normal md:h-9" disabled={ocupat} onClick={() => void entrega()}>
              {t('alb.mark_delivered')}
            </Button>
          )}
          {albara.tipo === 'REC' && (albara.estado === 'entregado' || albara.estado === 'confirmado') && (
            <Button className="h-11 whitespace-normal md:h-9" disabled={ocupat} onClick={() => void obreConciliacio()}>
              {t('alb.reconcile')}
            </Button>
          )}
          {potAprovar && albara.estado !== 'anulado' && albara.estado !== 'conciliado' && (
            <Button variant="destructive" className="h-11 whitespace-normal md:h-9"
              onClick={() => setDialegAnullar(true)}>
              {t('alb.cancel')}
            </Button>
          )}
          {potAprovar && !esBorrador && albara.estado !== 'anulado' && albara.estado !== 'rectificado' && (
            <Button variant="outline" className="h-11 whitespace-normal md:h-9"
              onClick={() => setDialegRectificar(true)}>
              {t('alb.rectify')}
            </Button>
          )}
          {!potAprovar && (
            <p className="w-full text-xs text-muted-foreground">{t('alb.need_approver')}</p>
          )}
        </CardContent>
      </Card>

      {/* Los enlaces recién creados, con su token. Solo existen en esta pantalla y una vez. */}
      {enllacosNous.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('alb.links_new')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('alb.links_new_hint')}</p>
            {enllacosNous.map((e) => (
              <div key={e.url} className="space-y-1">
                <p className="text-sm font-medium">{e.nom}</p>
                <Input readOnly value={e.url} onFocus={(ev) => ev.currentTarget.select()} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Versiones del PDF ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('alb.versions')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {documents.length === 0 && <p className="text-sm text-muted-foreground">{t('alb.no_versions')}</p>}
          {documents.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm">
              <div>
                <span className="font-medium tabular-nums">{d.numero_completo} · v{d.version}</span>
                <span className="text-muted-foreground">
                  {' '}{d.subtipo ? t(`doc.sub_${d.subtipo}`) : ''} · {dataCurta(d.emitido_at)}
                </span>
                {!d.vigente && <Badge className="ml-2 bg-muted text-muted-foreground">{t('alb.superseded')}</Badge>}
              </div>
              <Button size="sm" className="h-11 whitespace-normal md:h-8"
                disabled={descarregant === d.id} onClick={() => void descarrega(d.id)}>
                {descarregant === d.id
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Download className="size-4" />}
                {t('doc.download')}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Documentos externos ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('alb.externals')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {externs.length === 0 && <p className="text-sm text-muted-foreground">{t('alb.no_externals')}</p>}
          {externs.map((x) => (
            <div key={x.id} className="border-b pb-2 text-sm">
              <span className="font-medium">{t(`alb.ex_${x.tipo}`)}</span>
              {x.numero ? <span className="tabular-nums"> · {x.numero}</span> : null}
              <span className="text-muted-foreground"> · {dataCurta(x.fecha ?? x.created_at)} · {t(`alb.or_${x.origen}`)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Evidencias de confirmación ── */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('alb.evidence')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {enllacos.length === 0 && <p className="text-sm text-muted-foreground">{t('alb.no_links')}</p>}
          {enllacos.map((e) => (
            <div key={e.id} className="border-b pb-2 text-sm">
              <p className="font-medium">{e.destinatario_nombre || e.destinatario_email || '—'}</p>
              <p className="text-muted-foreground">
                {t(`alb.lk_${e.estado}`)} · {t('alb.expires', { date: dataCurta(e.caduca_at) })}
              </p>
              {evidencies.filter((v) => v.enlace_id === e.id).map((v) => (
                <p key={v.id} className="text-xs text-muted-foreground">
                  {t(`alb.ev_${v.tipo}`)} · {dataCurta(v.created_at)}
                  {v.nombre ? ` · ${v.nombre}` : ''}{v.cargo ? ` (${v.cargo})` : ''}
                  {v.ip ? ` · ${v.ip}` : ''}
                </p>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <DialegMotiu
        obert={dialegAnullar} onObert={setDialegAnullar}
        titol={t('alb.cancel')} descripcio={t('alb.cancel_desc')}
        etiqueta={t('alb.reason')} confirmar={t('alb.cancel')}
        destructiu ocupat={ocupat} onConfirma={(m) => void anulla(m)}
      />

      <DialegRectificar
        obert={dialegRectificar} onObert={setDialegRectificar}
        linies={linies} ocupat={ocupat} onConfirma={(l, m) => void rectifica(l, m)}
      />

      <DialegConciliar
        obert={dialegConciliar} onObert={setDialegConciliar}
        proposta={proposta} linies={linies} ocupat={ocupat}
        onConfirma={(k, m, d) => void concilia(k, m, d)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rectificar: el rectificativo se EMITE al instante, así que aquí ya hay que decir
// cuáles son los kilos buenos. No hay un paso de borrador donde pensárselo.
// ---------------------------------------------------------------------------
function DialegRectificar({
  obert, onObert, linies, ocupat, onConfirma,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  linies: AlbaranLinea[]
  ocupat: boolean
  onConfirma: (linies: LiniaForm[], motiu: string) => void
}) {
  const { t } = useT()
  const [form, setForm] = useState<LiniaForm[]>([])
  const [motiu, setMotiu] = useState('')

  useEffect(() => {
    if (obert) { setForm(linies.map(aForm)); setMotiu('') }
  }, [obert, linies])

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('alb.rectify')}</DialogTitle>
          <DialogDescription>{t('alb.rectify_desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {form.map((l, i) => (
            <div key={i} className="space-y-1.5">
              <Label htmlFor={`rc-${i}`}>{l.producto || t('alb.ln_product')}</Label>
              <Input
                id={`rc-${i}`} type="number" inputMode="decimal" step="0.01" value={l.kg_neto}
                onChange={(e) => setForm((p) => p.map((x, j) => j === i ? { ...x, kg_neto: e.target.value } : x))}
              />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="rc-motiu">{t('alb.reason')}</Label>
            <Textarea id="rc-motiu" rows={3} value={motiu} onChange={(e) => setMotiu(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onObert(false)} disabled={ocupat}>{t('c.cancel')}</Button>
          <Button className="whitespace-normal" disabled={ocupat || motiu.trim() === ''}
            onClick={() => onConfirma(form, motiu.trim())}>
            {t('alb.rectify')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Conciliar: la propuesta del servidor con su semáforo.
//
// El semáforo no es decoración: verde = la diferencia cabe en la tolerancia y se concilia
// de un clic; rojo = no cabe, y entonces el motivo pasa a ser obligatorio y hay que decir
// qué pasó con los kilos que no llegaron (`destino_final`). El aviso de «todavía no ha
// vencido el plazo» lo pinta también la base como excepción; enseñarlo antes evita que la
// persona rellene el formulario para nada.
// ---------------------------------------------------------------------------
function DialegConciliar({
  obert, onObert, proposta, linies, ocupat, onConfirma,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  proposta: PropostaConciliacio | null
  linies: AlbaranLinea[]
  ocupat: boolean
  onConfirma: (kgValidats: { linea_id: string; kg: number }[], motiu: string, desti: string) => void
}) {
  const { t } = useT()
  const [valors, setValors] = useState<Record<string, string>>({})
  const [motiu, setMotiu] = useState('')
  const [desti, setDesti] = useState('')

  useEffect(() => {
    if (!obert) return
    const inicial: Record<string, string> = {}
    for (const l of linies) {
      const v = l.kg_confirmados ?? l.kg_neto ?? l.kg_previstos
      inicial[l.id] = v != null ? String(v) : ''
    }
    setValors(inicial)
    setMotiu('')
    setDesti('')
  }, [obert, linies])

  if (!proposta) return null

  const fora = !proposta.dins_tolerancia
  const motiuObligatori = fora || !proposta.termini_vencut
  const potConfirmar = !ocupat && (!motiuObligatori || motiu.trim() !== '')

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('alb.reconcile')}</DialogTitle>
          <DialogDescription>{t('alb.reconcile_desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/* El semáforo. `exito` y `error` son tokens; el coral no significa fallo. */}
          <div className={`rounded-md p-3 ${fora ? 'bg-error-fondo text-error' : 'bg-exito-fondo text-exito'}`}>
            <p className="font-medium">
              {fora
                ? t('alb.out_of_tolerance', { pct: proposta.diferencia_pct ?? 0, tol: proposta.tolerancia_pct })
                : t('alb.in_tolerance', { tol: proposta.tolerancia_pct })}
            </p>
            <p>{t('alb.prop_reception', { kg: kg(proposta.kg_recepcio) })}</p>
            <p>{t('alb.prop_delivered', { kg: kg(proposta.kg_entregues) })}</p>
            <p>{t('alb.prop_diff', { kg: kg(proposta.diferencia) })}</p>
          </div>

          {!proposta.termini_vencut && (
            <p className="rounded-md bg-aviso-fondo p-3 text-aviso">{t('alb.deadline_not_due')}</p>
          )}

          {proposta.entregues.length > 0 && (
            <div className="space-y-1">
              <p className="font-medium">{t('alb.prop_entries')}</p>
              {proposta.entregues.map((e, i) => (
                <p key={`${e.albara ?? i}`} className="text-muted-foreground">
                  {e.albara ?? '—'} · {e.entitat ?? '—'} · {kg(e.kg)} kg · {t(`alb.st_${e.estat}`)}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <p className="font-medium">{t('alb.validated_kg')}</p>
            {linies.map((l) => (
              <div key={l.id} className="space-y-1.5">
                <Label htmlFor={`cv-${l.id}`}>{l.producto ?? t('alb.ln_product')}</Label>
                <Input
                  id={`cv-${l.id}`} type="number" inputMode="decimal" step="0.01"
                  value={valors[l.id] ?? ''}
                  onChange={(e) => setValors((p) => ({ ...p, [l.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cv-desti">{t('alb.final_destination')}</Label>
            <Input id="cv-desti" value={desti} placeholder={t('alb.final_destination_ph')}
              onChange={(e) => setDesti(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cv-motiu">{t('alb.reason')}</Label>
            <Textarea id="cv-motiu" rows={3} value={motiu} onChange={(e) => setMotiu(e.target.value)} />
            {motiuObligatori && motiu.trim() === '' && (
              <p className="text-xs text-muted-foreground">{t('alb.reason_required')}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onObert(false)} disabled={ocupat}>{t('c.cancel')}</Button>
          <Button className="whitespace-normal" disabled={!potConfirmar}
            onClick={() => onConfirma(
              linies
                .map((l) => ({ linea_id: l.id, kg: num(valors[l.id] ?? '') }))
                .filter((x): x is { linea_id: string; kg: number } => x.kg !== null),
              motiu, desti,
            )}>
            {t('alb.reconcile')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
