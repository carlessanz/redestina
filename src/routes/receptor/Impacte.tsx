// `/receptor/impacte` — «El meu impacte» (fase 10 de la revisión del 08-10-2026): los kilos
// que la entidad ha rebut i el que suposen en CO₂e, aigua i racions, per període.

import { useT } from '../../lib/i18n'
import ImpacteAmbPeriode from '../../components/ImpacteAmbPeriode'

export default function ReceptorImpacte() {
  const { t } = useT()
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('imp.intro_receptor')}</p>
      <ImpacteAmbPeriode ambit="receptor" titolKey="imp.title" />
    </div>
  )
}
