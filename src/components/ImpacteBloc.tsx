// El impacto de una organización (o de toda la plataforma) en un periodo: kilos
// aprovechados, CO₂e, agua, raciones, entregas, contrapartes y —solo para el equipo y el
// productor— el valor de lo donado. Fase 10 de la revisión del 08-10-2026.
//
// ⚠️ Las cifras son de la BASE (`impacte_*`): kilos conciliados (D13) por los factores de
//    `factors_impacte`. Mientras esos factores sean provisionales, se dice aquí mismo.

import { useEffect, useState } from 'react'
import { Droplets, HandHeart, Leaf, Scale, Truck, Users, Euro } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { nombre } from '../lib/format'
import {
  normalitzaImpacte, repartimentModalitats, serieMensual, type AmbitImpacte, type Impacte,
} from '../lib/impacte'
import { Card, CardContent } from '@/components/ui/card'

const RPC: Record<AmbitImpacte, string> = {
  receptor: 'impacte_receptor',
  productor: 'impacte_productor',
  global: 'impacte_global',
}

/** Un color de la paleta de gráficos por modalidad, siempre el mismo. */
const COLOR_MODALITAT: Record<'donacio' | 'venda' | 'maquila', string> = {
  donacio: 'bg-chart-1',
  venda: 'bg-chart-2',
  maquila: 'bg-chart-3',
}

export default function ImpacteBloc({
  ambit, desde, hasta, compacte = false,
}: {
  ambit: AmbitImpacte
  desde: string
  hasta: string
  /** Solo las cifras, sin gráfico (el bloque del Inici del productor). */
  compacte?: boolean
}) {
  const { t } = useT()
  const [impacte, setImpacte] = useState<Impacte | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let viu = true
    void supabase.rpc(RPC[ambit], { p_desde: desde, p_hasta: hasta }).then(({ data, error: e }) => {
      if (!viu) return
      setError(Boolean(e))
      setImpacte(e || !data ? null : normalitzaImpacte(data as Record<string, unknown>))
    })
    return () => { viu = false }
  }, [ambit, desde, hasta])

  if (error) return <p className="text-sm text-destructive">{t('c.load_error')}</p>
  if (!impacte) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  const xifra = (Icona: typeof Leaf, valor: string, etiqueta: string, sub?: string) => (
    <Card className="py-0">
      <CardContent className="flex items-start gap-3 py-4">
        <Icona className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <div className="text-2xl font-bold text-primary tabular-nums">{valor}</div>
          <p className="text-sm text-muted-foreground">{etiqueta}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )

  const contraparts = ambit === 'receptor'
    ? t('imp.productors', { n: impacte.n_productors })
    : ambit === 'productor'
      ? t('imp.entitats', { n: impacte.n_entitats })
      : t('imp.productors_entitats', { p: impacte.n_productors, e: impacte.n_entitats })

  const serie = serieMensual(impacte)
  const maxim = Math.max(1, ...serie.map((s) => s.kg))
  const modalitats = repartimentModalitats(impacte)

  return (
    <div className="space-y-4" data-testid={`impacte-${ambit}`}>
      <div className={compacte ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'}>
        {xifra(Scale, `${nombre(impacte.kg_total, 0)} kg`,
          t(ambit === 'receptor' ? 'imp.kg_rebuts' : 'imp.kg_aprofitats'), t('imp.kg_sub'))}
        {xifra(Leaf, `${nombre(impacte.co2e_kg, 0)} kg`, t('imp.co2e'))}
        {!compacte && xifra(Droplets, `${nombre(impacte.aigua_l, 0)} l`, t('imp.aigua'))}
        {!compacte && xifra(HandHeart, nombre(impacte.racions, 0), t('imp.racions'))}
        {!compacte && xifra(Truck, String(impacte.entregues), t('imp.entregues'), contraparts)}
        {impacte.valor_eur !== null && !compacte
          && xifra(Euro, `${nombre(impacte.valor_eur, 2)} €`, t('imp.valor'), t('imp.valor_sub'))}
        {compacte && xifra(Users, String(impacte.entregues), t('imp.entregues'), contraparts)}
      </div>

      {!compacte && impacte.kg_total > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card className="py-0">
            <CardContent className="space-y-3 py-4">
              <h3 className="text-sm font-semibold">{t('imp.per_mes')}</h3>
              <div className="flex h-36 items-end gap-1" role="img" aria-label={t('imp.per_mes')}>
                {serie.map((s) => (
                  <div key={s.mes} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1"
                    title={`${s.mes}: ${nombre(s.kg, 0)} kg`}>
                    {/* El hueco de la barra tiene alto definido (flex-1 dentro de h-full):
                        así el porcentaje de la barra se resuelve contra él. */}
                    <div className="flex w-full flex-1 items-end">
                      <div className="w-full rounded-t bg-chart-1" style={{ height: `${Math.round((s.kg / maxim) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{s.mes.slice(5)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="space-y-3 py-4">
              <h3 className="text-sm font-semibold">{t('imp.per_modalitat')}</h3>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
                {modalitats.map((m) => (
                  <div key={m.modalitat} className={COLOR_MODALITAT[m.modalitat]}
                    style={{ width: `${(m.kg / impacte.kg_total) * 100}%` }} />
                ))}
              </div>
              <ul className="space-y-1 text-sm">
                {modalitats.map((m) => (
                  <li key={m.modalitat} className="flex items-center gap-2">
                    <span className={`size-3 rounded-sm ${COLOR_MODALITAT[m.modalitat]}`} aria-hidden />
                    <span className="flex-1">{t(`imp.mod_${m.modalitat}`)}</span>
                    <span className="tabular-nums">{nombre(m.kg, 0)} kg</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {impacte.kg_total === 0 && !compacte && (
        <p className="text-sm text-muted-foreground">{t('imp.buit')}</p>
      )}

      {impacte.factors_provisionals && (
        <p className="text-xs text-muted-foreground">{t('imp.provisional')}</p>
      )}
    </div>
  )
}
