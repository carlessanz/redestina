// El detalle de un producto del catálogo (27-09-2026): su icono —el que sale en las ofertas
// sin foto propia— y su coste de referencia con el histórico.
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
import { eurKg, fixarCostProducte } from '../../lib/tancament'
import { IconaProducte } from '../../components/FotosOferta'
import CarregantSeccio from '../../components/CarregantSeccio'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Fitxa {
  nombre: string
  familia: string | null
}
interface Cost { coste_kg: number; motivo: string; updated_at: string }
interface Hist { id: string; coste_kg: number; motivo: string; vigente_desde: string | null; vigente_hasta: string }

export default function ProducteDetall() {
  const { t } = useT()
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

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    const [p, c, h] = await Promise.all([
      supabase.from('productos').select('nombre, familia')
        .eq('nombre', nom).maybeSingle(),
      supabase.from('costes_producto').select('coste_kg, motivo, updated_at')
        .eq('producto', nom).maybeSingle(),
      supabase.from('costes_producto_hist').select('id, coste_kg, motivo, vigente_desde, vigente_hasta')
        .eq('producto', nom).order('vigente_hasta', { ascending: false }).limit(20),
    ])
    setFitxa((p.data as Fitxa | null) ?? null)
    setCost((c.data as Cost | null) ?? null)
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
          <p className="mt-1 text-sm text-muted-foreground">{fitxa.familia ?? '—'}</p>
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
          {/* Sin el formulario, un técnico no sabía por qué no podía cambiarlo. */}
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
                <Button className="h-11 w-full whitespace-normal sm:w-auto md:h-9" disabled={ocupat}
                  onClick={() => void desaCost()}>
                  {cost ? t('cost.a_edit') : t('cost.a_set')}
                </Button>
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
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
