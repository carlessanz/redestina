// Los indicadores del tablero con PERIODO (fase 8 de la revisión del 08-10-2026): año, mes o
// un rango. Los da la base (`kpis_equip()`), con la fecha en hora de Madrid; antes el tablero
// sumaba en el cliente el total de siempre, sin fecha.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { avuiMadrid, nombre } from '../../lib/format'
import { datesPeriode, type Periode } from '../../lib/periode'
import { Card, CardContent } from '@/components/ui/card'
import SelectorPeriode from '../SelectorPeriode'

interface Kpis {
  kg_canalitzats: number; kg_assignats: number; canalitzacions: number; ofertes_noves: number
  kg_oferts: number; entitats_receptores: number; ofertes_sense_sortida: number
}

export default function IndicadorsPeriode() {
  const { t } = useT()
  const avui = avuiMadrid()
  const [periode, setPeriode] = useState<Periode>('any')
  const [rang, setRang] = useState({ desDe: '', finsA: '' })
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [error, setError] = useState(false)
  const { desde, hasta } = datesPeriode(periode, avui, rang)

  useEffect(() => {
    let viu = true
    void supabase.rpc('kpis_equip', { p_desde: desde, p_hasta: hasta }).then(({ data, error: e }) => {
      if (!viu) return
      setError(Boolean(e))
      setKpis(e ? null : (data as Kpis))
    })
    return () => { viu = false }
  }, [desde, hasta])

  const xifra = (titolKey: string, valor: string, sub?: string) => (
    <Card><CardContent className="pt-6">
      <div className="text-3xl font-bold text-primary tabular-nums">{valor}</div>
      <p className="mt-1 text-sm text-muted-foreground">{t(titolKey)}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </CardContent></Card>
  )

  return (
    <section className="space-y-3" data-testid="indicadors-periode">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('kp.title')}</h2>
        <SelectorPeriode periode={periode} onPeriode={setPeriode} rang={rang} onRang={setRang}
          any={avui.slice(0, 4)} idPrefix="kp" />
      </div>
      {error && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
      {kpis && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {xifra('kp.kg_canalitzats', `${nombre(Number(kpis.kg_canalitzats), 0)} kg`, t('kp.kg_canalitzats_sub'))}
          {xifra('kp.kg_assignats', `${nombre(Number(kpis.kg_assignats), 0)} kg`)}
          {xifra('kp.canalitzacions', String(kpis.canalitzacions), t('kp.entitats', { n: kpis.entitats_receptores }))}
          {xifra('kp.ofertes_noves', String(kpis.ofertes_noves), t('kp.kg_oferts', { n: nombre(Number(kpis.kg_oferts), 0) }))}
          {xifra('kp.sense_sortida', String(kpis.ofertes_sense_sortida))}
        </div>
      )}
    </section>
  )
}
