// Mercat del receptor: las ofertas vivas que le encajan.
//
// No hace falta filtrar por tipo de receptor en el cliente: la política de `excedentes`
// ya solo deja ver las compatibles con la matriz `modalitat_receptor_compat` (§4bis).
// Mostrar interés es la RPC `manifestar_interes`, que deja la fila exactamente igual
// que el diálogo de WhatsApp y cae en la misma cola de aprobación del equipo.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { manifestaInteres } from '../../lib/ofertes'
import type { Excedente, OfertaRespuesta } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

export default function Mercat() {
  const { t } = useT()
  const organitzacio = useOrganitzacio('entidad')
  const [ofertes, setOfertes] = useState<Excedente[]>([])
  const [meves, setMeves] = useState<Record<string, OfertaRespuesta>>({})
  const [carregant, setCarregant] = useState(true)
  const [obert, setObert] = useState<Excedente | null>(null)
  const [kg, setKg] = useState('')
  const [preu, setPreu] = useState('')
  const [enviant, setEnviant] = useState(false)

  const entidadId = organitzacio?.id ?? null

  const carrega = useCallback(async () => {
    const [exc, resp] = await Promise.all([
      supabase.from('excedentes').select('*')
        .in('estado', ['publicada', 'parcial'])
        .order('created_at', { ascending: false }),
      entidadId
        ? supabase.from('oferta_respuestas').select('*').eq('entidad_id', entidadId)
        : Promise.resolve({ data: [] }),
    ])
    setOfertes((exc.data ?? []) as Excedente[])
    const per: Record<string, OfertaRespuesta> = {}
    for (const r of (resp.data ?? []) as OfertaRespuesta[]) per[r.excedente_id] = r
    setMeves(per)
    setCarregant(false)
  }, [entidadId])

  useEffect(() => {
    void carrega()
    const canal = supabase
      .channel('mercat-receptor')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'excedentes' }, () => void carrega())
      .subscribe()
    return () => { void supabase.removeChannel(canal) }
  }, [carrega])

  function obre(o: Excedente) {
    setObert(o)
    setKg(String(o.kg_total ?? ''))
    setPreu(o.preu_minim != null ? String(o.preu_minim) : '')
  }

  async function envia() {
    if (!obert || !entidadId) return
    const nKg = Number(kg)
    if (!nKg || nKg <= 0) { toast.error(t('mk.need_kg')); return }
    setEnviant(true)
    const r = await manifestaInteres({
      excedenteId: obert.id,
      entidadId,
      kg: nKg,
      preu: preu === '' ? null : Number(preu),
    })
    setEnviant(false)
    if (!r.ok) { toast.error(r.error ?? t('c.error')); return }
    toast.success(t('mk.sent'))
    setObert(null)
    await carrega()
  }

  if (!entidadId) return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('mk.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('mk.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && ofertes.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('mk.empty')}</p>
        )}
        {ofertes.map((o) => {
          const meva = meves[o.id]
          const esVenda = o.modalitat === 'venda' || o.modalitat === 'maquila'
          return (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="font-medium">
                  {o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}
                </div>
                <div className="text-xs text-muted-foreground">
                  {o.kg_total ?? '—'} kg
                  {o.modalitat ? ` · ${t(`od.mod_${o.modalitat}`)}` : ''}
                  {esVenda && o.preu_minim != null ? ` · ${o.preu_minim} €/kg` : ''}
                  {o.disponible_hasta ? ` · ${t('mk.until', { date: o.disponible_hasta })}` : ''}
                </div>
              </div>
              {meva && meva.estado === 'acceptada' ? (
                <span className="rounded-full bg-exito-fondo px-2 py-0.5 text-xs font-medium text-exito">
                  {t('mk.already', { n: meva.kg_solicitados ?? 0 })}
                </span>
              ) : (
                <Dialog open={obert?.id === o.id} onOpenChange={(v) => !v && setObert(null)}>
                  <DialogTrigger asChild>
                    {/* Sin `size="sm"` y a 44px en móvil: es la única acción del panel
                        del receptor y se repite en cada fila. En escritorio vuelve a la
                        altura normal, donde se pulsa con ratón y 36px sobran. */}
                    <Button className="h-11 md:h-9" onClick={() => obre(o)}>{t('mk.interested')}</Button>
                  </DialogTrigger>
                  {/* ⚠️ `max-h` + scroll: el diálogo cabe con el teclado cerrado (458px
                      en 667), pero al enfocar «quants kg» el área visible baja a ~350px
                      y, sin tope de altura, se recortaba por los dos extremos —incluido
                      el botón de enviar—, dejando la acción inalcanzable. Se pone aquí y
                      no en `ui/dialog.tsx` para no cambiar de paso los diálogos del
                      panel del equipo, que no se han revisado. */}
                  <DialogContent className="max-h-[85dvh] overflow-y-auto">
                    <DialogHeader><DialogTitle>{t('mk.dialog_title')}</DialogTitle></DialogHeader>
                    <p className="text-sm text-muted-foreground">
                      {t('mk.dialog_desc', { product: o.producto ?? '' })}
                    </p>
                    {o.texto_oferta && (
                      <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-xs">
                        {o.texto_oferta}
                      </pre>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">{t('mk.kg')}</Label>
                        <Input type="number" min="1" value={kg} onChange={(e) => setKg(e.target.value)} />
                      </div>
                      {esVenda && (
                        <div>
                          <Label className="mb-1.5 block text-xs text-muted-foreground">
                            {t('mk.price', { min: o.preu_minim ?? 0 })}
                          </Label>
                          <Input type="number" step="0.01" value={preu}
                            onChange={(e) => setPreu(e.target.value)} />
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button onClick={() => void envia()} disabled={enviant}>
                        {enviant ? t('c.sending') : t('mk.send')}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
