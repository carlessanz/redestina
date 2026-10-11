// El impacto con su selector de periodo: la pantalla del receptor y el tablero del equipo.

import { useState } from 'react'
import { useT } from '../lib/i18n'
import { avuiMadrid } from '../lib/format'
import { datesPeriode, type Periode } from '../lib/periode'
import type { AmbitImpacte } from '../lib/impacte'
import SelectorPeriode from './SelectorPeriode'
import ImpacteBloc from './ImpacteBloc'

export default function ImpacteAmbPeriode({ ambit, titolKey }: { ambit: AmbitImpacte; titolKey: string }) {
  const { t } = useT()
  const avui = avuiMadrid()
  const [periode, setPeriode] = useState<Periode>('any')
  const [rang, setRang] = useState({ desDe: '', finsA: '' })
  const { desde, hasta } = datesPeriode(periode, avui, rang)
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{t(titolKey)}</h2>
        <SelectorPeriode periode={periode} onPeriode={setPeriode} rang={rang} onRang={setRang}
          any={avui.slice(0, 4)} idPrefix={`imp-${ambit}`} />
      </div>
      <ImpacteBloc ambit={ambit} desde={desde} hasta={hasta} />
    </section>
  )
}
