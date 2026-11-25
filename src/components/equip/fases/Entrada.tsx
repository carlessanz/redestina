// Fase 2 · la entrada. Validar la oferta del productor sin salir del ciclo
// (`ValidacioOferta`, la misma banda del detalle).
//
// «Espigolada» (fase 3, 25-11-2026): ya no se convierte en jornada. Es una oferta de donación
// con el producto en el campo que sigue el ciclo de cualquier donación; aquí solo se marca con
// su badge. Un lote heredado de una jornada (`espigolada_id`) se enseña igual, sin acciones.
//
// ⚠️ «Publica» un borrador no tiene botón: el alta asistida (`crear-oferta`) nace
//    `publicada`, y la del productor, `pendent_validacio`. Un borrador del equipo no existe
//    hoy; si apareciera, su detalle sigue enlazado abajo.

import { Link } from 'react-router'
import { useT } from '../../../lib/i18n'
import { esOfertaEspigolada } from '../../../lib/modalitatsOferta'
import BadgeEspigolada from '../../BadgeEspigolada'
import MissatgesDelPunt from '../../MissatgesDelPunt'
import ValidacioOferta from '../ValidacioOferta'
import { Button } from '@/components/ui/button'
import type { ContextFase } from './tipus'

export default function FaseEntrada({ c }: { c: ContextFase }) {
  const { t } = useT()
  const { fets, extra, oferta } = c

  return (
    <div className="space-y-3">
      {fets.oferta.estado === 'pendent_validacio' && (
        <ValidacioOferta excedenteId={extra.oferta.id} potAprovar={c.potAprovar} onFet={c.onCanvi} />
      )}

      {oferta && esOfertaEspigolada(oferta) && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <BadgeEspigolada />
          <span className="min-w-0 break-words">{t('od.espigolada_hint')}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-11 whitespace-normal md:h-8">
          <Link to={`/equip/ofertes/${extra.oferta.id}`}>{t('canalz.b_obre_oferta')}</Link>
        </Button>
      </div>

      <MissatgesDelPunt missatges={c.missatges} fase="entrada" />
    </div>
  )
}
