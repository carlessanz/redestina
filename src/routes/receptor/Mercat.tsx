// Mercat del receptor: las ofertas vivas que le encajan.
//
// No hace falta filtrar por tipo de receptor en el cliente: la política de `excedentes`
// ya solo deja ver las compatibles con la matriz `modalitat_receptor_compat` (§4bis).
// Mostrar interés es la RPC `manifestar_interes`, que deja la fila exactamente igual
// que el diálogo de WhatsApp y cae en la misma cola de aprobación del equipo.
//
// ⚠️ LA OFERTA YA SOLICITADA NO DICE «Sol·licitats 300 kg», DICE EN QUÉ PUNTO ESTÁ. Esa
// píldora no distinguía «l'equip encara ho ha de decidir» de «ja és teva», que para quien
// tiene que reservar furgoneta y cámara es toda la diferencia. La etapa la calcula
// `puntInteres()`, el mismo módulo que narra la pantalla de Interessos.
//
// ⚠️ `estado === 'pendent'` SÍ enseña el botón: significa que el equipo le mandó la oferta
// y todavía no ha contestado. Es la fila que existe justamente para que la conteste.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useConveni } from '../../hooks/useConveni'
import { manifestaInteres } from '../../lib/ofertes'
import { estatSimpleInteres, puntInteres } from '../../lib/procesOferta'
import { dataCurta } from '../../lib/albarans'
import BadgeEstat from '../../components/proces/BadgeEstat'
import type { Excedente, OfertaRespuesta } from '../../types'
import CarregantSeccio from '../../components/CarregantSeccio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export default function Mercat() {
  const { t } = useT()
  const { bloqueja } = useConveni()
  const organitzacio = useOrganitzacio('entidad')
  const [ofertes, setOfertes] = useState<Excedente[]>([])
  const [meves, setMeves] = useState<Record<string, OfertaRespuesta>>({})
  const [carregant, setCarregant] = useState(true)
  const [obert, setObert] = useState<Excedente | null>(null)
  /** El diálogo abre en detalle (tocar la tarjeta) o directamente en el interés (el botón). */
  const [mode, setMode] = useState<'detall' | 'interes'>('detall')
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

  function obre(o: Excedente, m: 'detall' | 'interes') {
    setObert(o)
    setMode(m)
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

  /** El interés de esta entidad sobre una oferta, contado en una etapa (o null si se puede pedir). */
  const puntDe = (o: Excedente) => {
    const meva = meves[o.id]
    // Sin `meva`, o con la fila todavía `pendent`, esta oferta se puede pedir.
    return meva && meva.estado !== 'pendent'
      ? puntInteres({
        estado: meva.estado,
        aprovacio: meva.aprovacio,
        kg: meva.kg_solicitados,
        ofertaEstado: o.estado,
      })
      : null
  }

  const obertPunt = obert ? puntDe(obert) : null
  const obertVenda = obert?.modalitat === 'venda' || obert?.modalitat === 'maquila'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('mk.titol_ofertes')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('mk.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
        {!carregant && ofertes.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('mk.empty')}</p>
        )}
        {ofertes.map((o) => {
          const punt = puntDe(o)
          // La tarjeta dice lo que un receptor mira primero (revisión del 23-09-2026):
          // producto, kg, modalidad, DÓNDE —la comarca, no el municipio (D3)— y precio si
          // hay. «Donació» va sin precio, a propósito.
          const detall = [
            `${kgFmt(o.kg_total)} kg`,
            o.modalitat ? t(`od.mod_${o.modalitat}`) : null,
            o.comarca,
            preuDe(o),
            o.disponible_hasta ? t('mk.until', { date: dataCurta(o.disponible_hasta) }) : null,
          ].filter(Boolean).join(' · ')
          return (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              {/* Toda la parte izquierda abre el detalle: es lo que se toca para «ver más». */}
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => obre(o, 'detall')}
              >
                <div className="font-medium">
                  {o.producto ?? '—'}{o.variedad ? ` · ${o.variedad}` : ''}
                </div>
                <div className="text-xs text-muted-foreground">{detall}</div>
                <div className="mt-0.5 text-xs font-medium text-primary">{t('mk.see_detail')}</div>
              </button>
              {punt ? (
                <BadgeEstat clase={estatSimpleInteres(punt).clase}>
                  {t(estatSimpleInteres(punt).key)}
                </BadgeEstat>
              ) : (
                // Sin `size="sm"` y a 44px en móvil: es la única acción del panel del
                // receptor y se repite en cada fila. En escritorio vuelve a la altura
                // normal, donde se pulsa con ratón y 36px sobran.
                <Button
                  className="h-11 md:h-9"
                  disabled={bloqueja}
                  title={bloqueja ? t('avis_conv.bloquejat') : undefined}
                  onClick={() => obre(o, 'interes')}
                >{t('mk.interested')}</Button>
              )}
            </div>
          )
        })}
      </CardContent>

      {/* UN solo diálogo, con dos modos: el detalle de la oferta y, desde él, el interés.
          ⚠️ `max-h` + scroll: al enfocar «quants kg» en un móvil el área visible baja a
          ~350px, y sin tope de altura el botón de enviar quedaba fuera de alcance. */}
      <Dialog open={obert != null} onOpenChange={(v) => !v && setObert(null)}>
        {obert && (
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {mode === 'detall' ? t('mk.detail_title') : t('mk.dialog_title')}
              </DialogTitle>
            </DialogHeader>
            <p className="font-titulos text-lg font-semibold">
              {obert.producto ?? '—'}{obert.variedad ? ` · ${obert.variedad}` : ''}
            </p>

            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <Dada etiqueta={t('mk.d_kg')} valor={`${kgFmt(obert.kg_total)} kg`} />
              <Dada etiqueta={t('mk.d_zone')} valor={obert.comarca ?? '—'} />
              <Dada etiqueta={t('mk.d_mode')} valor={obert.modalitat ? t(`od.mod_${obert.modalitat}`) : '—'} />
              {preuDe(obert) && <Dada etiqueta={t('mk.d_price')} valor={preuDe(obert) ?? ''} />}
              <Dada etiqueta={t('mk.d_until')} valor={obert.disponible_hasta ? dataCurta(obert.disponible_hasta) : '—'} />
              {obert.horari_recollida && <Dada etiqueta={t('mk.d_hours')} valor={obert.horari_recollida} />}
              <Dada etiqueta={t('mk.d_field')} valor={obert.producte_al_camp ? t('mk.d_field_yes') : t('mk.d_field_no')} />
              {(obert.tipo_caixa || obert.num_caixes != null) && (
                <Dada
                  etiqueta={t('mk.d_format')}
                  valor={[obert.num_caixes != null ? `${obert.num_caixes}` : null, obert.tipo_caixa].filter(Boolean).join(' · ')}
                />
              )}
              {obert.retorn_envasos && <Dada etiqueta={t('mk.d_return')} valor={obert.retorn_envasos} />}
              {obert.causa && <Dada etiqueta={t('mk.d_cause')} valor={obert.causa} />}
            </dl>
            {obert.observacions && (
              <div className="text-sm">
                <p className="text-xs text-muted-foreground">{t('mk.d_notes')}</p>
                <p className="whitespace-pre-wrap">{obert.observacions}</p>
              </div>
            )}

            {mode === 'interes' && (
              <>
                <p className="text-sm text-muted-foreground">{t('mk.dialog_desc')}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="mk-kg" className="mb-1.5 block text-xs text-muted-foreground">{t('mk.kg')}</Label>
                    <Input id="mk-kg" name="kg" type="number" min="1" value={kg} onChange={(e) => setKg(e.target.value)} />
                  </div>
                  {obertVenda && (
                    <div>
                      <Label htmlFor="mk-preu" className="mb-1.5 block text-xs text-muted-foreground">
                        {t('mk.price', { min: obert.preu_minim ?? 0 })}
                      </Label>
                      <Input id="mk-preu" name="preu" type="number" step="0.01" value={preu}
                        onChange={(e) => setPreu(e.target.value)} />
                    </div>
                  )}
                </div>
              </>
            )}

            <DialogFooter>
              {mode === 'interes' ? (
                <Button className="h-11 md:h-9" onClick={() => void envia()} disabled={enviant}>
                  {enviant ? t('c.sending') : t('mk.send')}
                </Button>
              ) : obertPunt ? (
                <BadgeEstat clase={estatSimpleInteres(obertPunt).clase}>
                  {t(estatSimpleInteres(obertPunt).key)}
                </BadgeEstat>
              ) : (
                <Button
                  className="h-11 md:h-9"
                  disabled={bloqueja}
                  title={bloqueja ? t('avis_conv.bloquejat') : undefined}
                  onClick={() => setMode('interes')}
                >{t('mk.interested')}</Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  )
}

function Dada({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  )
}

/** «1.320» i «0,45»: el format local, no el del punt decimal de la base. */
function kgFmt(n: number | null | undefined): string {
  return n == null ? '—' : new Intl.NumberFormat('ca-ES', { maximumFractionDigits: 2 }).format(Number(n))
}

/** El precio, solo si la modalidad lo tiene: una donación no lleva precio. */
function preuDe(o: Excedente): string | null {
  if ((o.modalitat !== 'venda' && o.modalitat !== 'maquila') || o.preu_minim == null) return null
  return `${new Intl.NumberFormat('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(o.preu_minim))} €/kg`
}
