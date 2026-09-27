// El detalle de un producto del catálogo (27-09-2026): su foto en grande —la que sale de
// respaldo en las ofertas sin foto propia— y su coste de referencia con el histórico.
//
// La foto la gestiona SOLO el super_admin (lo imponen la política de Storage y la RPC
// `fixar_foto_producte`, no esta pantalla). Al resto del equipo los botones le salen grises
// con el motivo, no escondidos (§6ter).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Camera, ExternalLink, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { dataCurta } from '../../lib/albarans'
import { eurKg, fixarCostProducte } from '../../lib/tancament'
import {
  BUCKET_PRODUCTES, invalidaCataleg, pujaFotoProducte, treuFotoProducte,
} from '../../lib/fotosProducte'
import type { CreditFoto } from '../../lib/fotosProducte'
import { FotoOferta, useUrlsFotos } from '../../components/FotosOferta'
import BotoAmbMotiu from '../../components/proces/BotoAmbMotiu'
import { useConfirma } from '../../components/DialegConfirma'
import CarregantSeccio from '../../components/CarregantSeccio'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Fitxa {
  nombre: string
  familia: string | null
  foto: string | null
  foto_mini: string | null
  foto_credit: CreditFoto | null
}
interface Cost { coste_kg: number; motivo: string; updated_at: string }
interface Hist { id: string; coste_kg: number; motivo: string; vigente_desde: string | null; vigente_hasta: string }

export default function ProducteDetall() {
  const { t } = useT()
  const { nom = '' } = useParams()
  const { ctx } = useAppContext()
  const esSuper = ctx?.esSuperAdmin ?? false
  const potAprovar = ctx?.potAprovar ?? false
  const { confirma, dialeg } = useConfirma()

  const [fitxa, setFitxa] = useState<Fitxa | null>(null)
  const [cost, setCost] = useState<Cost | null>(null)
  const [hist, setHist] = useState<Hist[]>([])
  const [carregant, setCarregant] = useState(true)
  const [ocupat, setOcupat] = useState(false)
  const [valor, setValor] = useState('')
  const [motiu, setMotiu] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    const [p, c, h] = await Promise.all([
      supabase.from('productos').select('nombre, familia, foto, foto_mini, foto_credit')
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

  const urls = useUrlsFotos(fitxa?.foto ? [fitxa.foto] : [], BUCKET_PRODUCTES)

  async function puja(fitxers: FileList | null) {
    const f = fitxers?.[0]
    if (!f || !fitxa) return
    setOcupat(true)
    const r = await pujaFotoProducte(fitxa.nombre, f)
    setOcupat(false)
    if (!r.ok) { toast.error(r.error.startsWith('foto.') ? t(r.error) : r.error); return }
    toast.success(t('prod.photo_saved'))
    await carrega()
  }

  async function treu() {
    if (!fitxa) return
    const ok = await confirma({
      titol: t('prod.remove_title', { p: fitxa.nombre }),
      descripcio: t('prod.remove_desc'),
      confirmar: t('prod.remove'),
      destructiu: true,
    })
    if (!ok) return
    setOcupat(true)
    const r = await treuFotoProducte(fitxa.nombre)
    setOcupat(false)
    if (!r.ok) { toast.error(r.error); return }
    toast.success(t('prod.photo_removed'))
    invalidaCataleg()
    await carrega()
  }

  async function desaCost() {
    const n = Number(valor.trim().replace(',', '.'))
    if (!valor.trim() || Number.isNaN(n) || n <= 0) { toast.error(t('cost.bad_value')); return }
    if (!motiu.trim()) { toast.error(t('cost.reason_required')); return }
    setOcupat(true)
    const r = await fixarCostProducte({ producte: nom, cost: n, motiu: motiu.trim() })
    setOcupat(false)
    if (!r.ok) { toast.error(r.missatge); return }
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

  const credit = fitxa.foto_credit
  const motiuSuper = esSuper ? undefined : t('prod.only_superadmin')

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
        <CardContent className="space-y-3">
          <FotoOferta url={fitxa.foto ? urls[fitxa.foto] : null} alt={fitxa.nombre}
            familia={fitxa.familia} className="aspect-[4/3] w-full max-w-2xl" />
          {fitxa.foto && credit && (
            <p className="text-xs text-muted-foreground">
              {t('prod.credit')}{' '}
              {[credit.titol, credit.autor, credit.llicencia].filter(Boolean).join(' · ')}
              {credit.font_url && (
                <>
                  {' · '}
                  <a href={credit.font_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline">
                    {t('prod.source')} <ExternalLink className="size-3" aria-hidden />
                  </a>
                </>
              )}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {fitxa.foto ? t('prod.photo_hint') : t('prod.no_photo_hint')}
          </p>
          <div className="flex flex-wrap gap-2">
            <BotoAmbMotiu className="h-11 w-full whitespace-normal sm:w-auto md:h-9" disabled={!esSuper || ocupat}
              motiu={motiuSuper} onClick={() => input.current?.click()}>
              <Camera className="size-4" aria-hidden />
              {ocupat ? t('foto.uploading') : fitxa.foto ? t('prod.change') : t('prod.upload')}
            </BotoAmbMotiu>
            {fitxa.foto && (
              <BotoAmbMotiu variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-9"
                disabled={!esSuper || ocupat} motiu={motiuSuper} onClick={() => void treu()}>
                <Trash2 className="size-4" aria-hidden /> {t('prod.remove')}
              </BotoAmbMotiu>
            )}
          </div>
          <input ref={input} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files; void puja(f); e.target.value = '' }} />
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
      {dialeg}
    </div>
  )
}
