// Fase 1 · el convenio de quien entrega. Prepararlo, firmarlo con la persona delante, darlo por
// vigente o contrafirmarlo, sin salir del ciclo (`AccionsConveni`).

import { useT } from '../../../lib/i18n'
import { cn } from '../../../lib/utils'
import type { ConvenioTipo } from '../../../types'
import MissatgesDelPunt from '../../MissatgesDelPunt'
import AccionsConveni from './AccionsConveni'
import type { ContextFase } from './tipus'
import { Badge } from '@/components/ui/badge'

/**
 * Lo que la modalidad le exige a quien ENTREGA (`parte = 'entrega'`). Desde el Conveni de
 * col·laboració único (fase 5 de la revisión del 08-10-2026), uno para todas las modalidades.
 * Hasta el 28-09-2026 el botón preparaba SIEMPRE `don_gen`, así que en una venta creaba un
 * convenio que la RPC del ciclo no mira y el botón volvía a salir, sin fin.
 */
export function conveniQueCalEntregar(modalitat: string | null): ConvenioTipo | null {
  return modalitat ? 'col_productor' : null
}

export default function FaseConveni({ c }: { c: ContextFase }) {
  const { t } = useT()
  const { extra } = c
  const cv = extra.conveni_gen
  return (
    <div className="space-y-3">
      {/* El estado del convenio, dicho: un declarado es vigente pero sin firma. */}
      <Badge className={cn(
        'max-w-full whitespace-normal text-left',
        cv?.estado === 'vigent' ? 'bg-exito-fondo text-exito' : 'bg-aviso-fondo text-aviso',
      )}>
        {cv ? t(`conv.st_${cv.estado}`) : t('cfase.sense_conveni')}
        {cv?.numero ? ` · ${cv.numero}` : ''}
        {cv?.estado === 'vigent' && cv.origen === 'declarat' ? ` · ${t('conv.origen_declarat')}` : ''}
      </Badge>
      {extra.productor
        ? (
          <AccionsConveni
            tipusOrg="productor"
            orgId={extra.productor.id}
            nom={extra.productor.nom}
            conveni={extra.conveni_gen}
            tipusCal={conveniQueCalEntregar(extra.oferta.modalitat)}
            potAprovar={c.potAprovar}
            esSuperAdmin={c.esSuperAdmin}
            onCanvi={c.onCanvi}
          />
        )
        : <p className="text-sm text-muted-foreground">{t('cfase.sense_productor')}</p>}
      <MissatgesDelPunt missatges={c.missatges} fase="conveni" />
    </div>
  )
}
