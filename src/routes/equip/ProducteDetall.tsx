// El detalle de un producto del catálogo (27-09-2026): su icono —el que sale en las ofertas
// sin foto propia—, su coste de referencia con el histórico y (punto 3, D1, 17-11-2026) sus
// precios de referencia por mes con las equivalencias en Gencat y Mercabarna (`PreusProducte`).
//
// 20270604100000: el precio de un producto «preu manual» no es oficial; la tarjeta del coste dice
// cómo se decidió y de qué fuente sale (`costes_producto.criteri`/`font_origen`) y deja fijarlo.
//
// ⚠️ Hasta el 29-09-2026 aquí se subía una FOTO por producto. Se sustituyeron por iconos
// propios (`scripts/icones-productes.ts`), que no se editan desde la aplicación.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { useAppContext } from '../../hooks/useAppContext'
import { dataCurta } from '../../lib/albarans'
import { eurKg, fixarCostProducte, fixarOrigenCost } from '../../lib/tancament'
import { CRITERIS_ORIGEN, textCriteriOrigen, textOrigenManual } from '../../lib/valoracio'
import Desplegable from '../../components/Desplegable'
import { Badge } from '@/components/ui/badge'
import { IconaProducte } from '../../components/FotosOferta'
import CarregantSeccio from '../../components/CarregantSeccio'
import PreusProducte from '../../components/preus/PreusProducte'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Fitxa {
  nombre: string
  familia: string | null
  nombre_es: string | null
  preu_manual: boolean
}
interface Cost { coste_kg: number; motivo: string; updated_at: string; criteri: string | null; font_origen: string | null }
interface Hist {
  id: string; coste_kg: number; motivo: string; vigente_desde: string | null; vigente_hasta: string
  criteri: string | null; font_origen: string | null
}

export default function ProducteDetall() {
  const { t, lang } = useT()
  const { nom = '' } = useParams()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false

  const [fitxa, setFitxa] = useState<Fitxa | null>(null)
  const [cost, setCost] = useState<Cost | null>(null)
  const [hist, setHist] = useState<Hist[]>([])
  const [carregant, setCarregant] = useState(true)
  const [ocupat, setOcupat] = useState(false)
  const [valor, setValor] = useState('')
  const [motiu, setMotiu] = useState('')
  const [criteri, setCriteri] = useState('')
  const [fontOrigen, setFontOrigen] = useState('')

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    const [p, c, h] = await Promise.all([
      supabase.from('productos').select('nombre, familia, nombre_es, preu_manual')
        .eq('nombre', nom).maybeSingle(),
      supabase.from('costes_producto').select('coste_kg, motivo, updated_at, criteri, font_origen')
        .eq('producto', nom).maybeSingle(),
      supabase.from('costes_producto_hist').select('id, coste_kg, motivo, vigente_desde, vigente_hasta, criteri, font_origen')
        .eq('producto', nom).order('vigente_hasta', { ascending: false }).limit(20),
    ])
    setFitxa((p.data as Fitxa | null) ?? null)
    const cc = (c.data as Cost | null) ?? null
    setCost(cc)
    setCriteri(cc?.criteri ?? '')
    setFontOrigen(cc?.font_origen ?? '')
    setHist((h.data as Hist[] | null) ?? [])
    setCarregant(false)
  }, [nom])

  useEffect(() => { void carrega() }, [carrega])

  async function desaCost() {
    const n = Number(valor.trim().replace(',', '.'))
    if (!valor.trim() || Number.isNaN(n) || n <= 0) { toast.error(t('cost.bad_value')); return }
    if (!motiu.trim()) { toast.error(t('cost.reason_required')); return }
    setOcupat(true)
    const r = await fixarCostProducte({ producte: nom, cost: n, motiu: motiu.trim() })
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('cost.saved', { p: nom }))
    setValor('')
    setMotiu('')
    await carrega()
  }

  async function desaOrigen() {
    if (!cost) { toast.error(t('cost.origin_need_cost')); return }
    if (!criteri) { toast.error(t('cost.err_criteri')); return }
    if (!fontOrigen.trim() && (criteri === 'producte_semblant' || criteri === 'font_externa')) {
      toast.error(t('cost.err_cal_font')); return
    }
    setOcupat(true)
    const r = await fixarOrigenCost({ producte: nom, criteri, font: fontOrigen })
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('cost.origin_saved', { p: nom }))
    await carrega()
  }

  if (carregant) return <CarregantSeccio />
  if (!fitxa) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm text-muted-foreground">{t('prod.not_found')}</p>
          <Link to="/equip/productes" className="text-sm text-primary hover:underline">{t('prod.back')}</Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Link to="/equip/productes" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> {t('prod.back')}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{fitxa.nombre}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {fitxa.familia ?? '—'}{fitxa.nombre_es && ` · ${fitxa.nombre_es}`}
          </p>
        </CardHeader>
        <CardContent>
          <IconaProducte producto={fitxa.nombre} familia={fitxa.familia} className="size-40 sm:size-48" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('prod.cost_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('prod.cost_hint')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-2xl font-semibold tabular-nums">{cost ? eurKg(cost.coste_kg) : t('cost.missing')}</p>
          {cost && (
            <p className="text-sm text-muted-foreground">
              {cost.motivo} · {dataCurta(cost.updated_at)}
            </p>
          )}
          {/* Un precio manual no es oficial: lo dice siempre, con su criterio y su fuente. */}
          {cost && (fitxa.preu_manual || cost.criteri) && (
            <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="cost-origen">
              <Badge className="bg-aviso-fondo text-aviso">{t('cost.origin_title')}</Badge>
              <span className="min-w-0 break-words">{textOrigenManual(cost, lang)}</span>
            </p>
          )}
          {/* Sin el formulario, quien no puede fijarlo no sabía por qué no podía cambiarlo. */}
          {!potAprovar && <p className="text-sm text-muted-foreground">{t('cost.readonly')}</p>}
          {potAprovar && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="prod-cost" className="mb-1.5 block text-xs text-muted-foreground">{t('cost.f_cost')}</Label>
                <Input id="prod-cost" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="prod-motiu" className="mb-1.5 block text-xs text-muted-foreground">{t('cost.f_reason')}</Label>
                <Input id="prod-motiu" value={motiu} onChange={(e) => setMotiu(e.target.value)} />
              </div>
              <div className="sm:col-span-3">
                <Button className="h-11 w-full whitespace-normal sm:w-auto md:h-8" disabled={ocupat}
                  onClick={() => void desaCost()}>
                  {cost ? t('cost.a_edit') : t('cost.a_set')}
                </Button>
              </div>
            </div>
          )}
          {potAprovar && fitxa.preu_manual && (
            <div className="space-y-3 border-t pt-4" data-testid="cost-origen-form">
              <p className="text-xs text-muted-foreground">{t('cost.origin_hint')}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="prod-criteri" className="mb-1.5 block text-xs text-muted-foreground">{t('cost.f_criteri')}</Label>
                  <Desplegable id="prod-criteri" value={criteri} onChange={setCriteri} disabled={!cost} placeholder="—"
                    opcions={CRITERIS_ORIGEN.map((c) => ({ valor: c, text: textCriteriOrigen(c, lang) }))} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="prod-font" className="mb-1.5 block text-xs text-muted-foreground">{t('cost.f_font')}</Label>
                  <Input id="prod-font" value={fontOrigen} maxLength={300} disabled={!cost}
                    placeholder={t('cost.f_font_ph')} onChange={(e) => setFontOrigen(e.target.value)} />
                </div>
                <div className="sm:col-span-3">
                  <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8" disabled={ocupat || !cost}
                    onClick={() => void desaOrigen()}>
                    {t('cost.a_origin')}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {hist.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{t('prod.history')}</p>
              <ul className="space-y-1 text-sm">
                {hist.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                    <span className="tabular-nums text-foreground">{eurKg(h.coste_kg)}</span>
                    <span>{dataCurta(h.vigente_desde)} – {dataCurta(h.vigente_hasta)}</span>
                    <span className="min-w-0 break-words">{h.motivo}</span>
                    {h.criteri && <span className="min-w-0 break-words">({textOrigenManual(h, lang)})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <PreusProducte producte={fitxa.nombre} nomEs={fitxa.nombre_es} preuManual={fitxa.preu_manual}
        potAprovar={potAprovar} onCanviat={() => void carrega()} />
    </div>
  )
}
