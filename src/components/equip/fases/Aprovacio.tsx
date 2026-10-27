// Fase 4 · el interés y su aprobación. La entidad dice por teléfono cuántos kilos quiere,
// cómo y cuándo los recoge, y el equipo lo registra **como lo haría ella desde el Mercat**
// (`manifestar_interes_assistit` pasa por la misma `comprova_interes()`, 20270430100100).
// Debajo, los intereses que esperan decisión, aprobables aquí con el mismo formulario que
// Aprovacions y el detalle de la oferta, y CON EL CONVENIO DE CADA RECEPTORA al lado:
// `aprovar_resposta()` lo exige desde la fecha de corte (42501 `sense_conveni`), así que los
// botones que lo resuelven viven en la misma fila.

import { useT } from '../../../lib/i18n'
import { cn } from '../../../lib/utils'
import type { ConvenioTipo } from '../../../types'
import MissatgesDelPunt from '../../MissatgesDelPunt'
import FormulariAprovacio from '../FormulariAprovacio'
import FormulariInteresAssistit from '../FormulariInteresAssistit'
import { Badge } from '@/components/ui/badge'
import AccionsConveni from './AccionsConveni'
import type { ContextFase } from './tipus'

/**
 * Qué convenio le exige a la RECEPTORA la modalidad de esta oferta. Desde el Conveni de
 * col·laboració único (fase 5), uno para todas las modalidades.
 *
 * ⚠️ Si algún día la matriz deja de ser una función de la modalidad —dos convenios para una
 *    misma—, esto deja de poder derivarse y hay que pedirlo a la base.
 */
export function conveniQueCalRebre(modalitat: string | null): ConvenioTipo | null {
  return modalitat ? 'col_receptor' : null
}

export default function FaseAprovacio({ c }: { c: ContextFase }) {
  const { t } = useT()
  const { fets, extra, oferta } = c
  // Lo que falta por cubrir: contra lo que se avisa al aprobar de más (las anuladas no cuentan).
  const kgCanalitzats = extra.canalitzacions
    .filter((x) => x.estado !== 'anulada')
    .reduce((s, x) => s + Number(x.kg_confirmados ?? 0), 0)
  const faltan = Math.max(0, Number(fets.oferta.kg_total ?? 0) - kgCanalitzats)
  const pendents = extra.respostes.filter((r) => r.estado === 'acceptada' && r.aprovacio === 'pendent')

  return (
    <div className="space-y-3">
      {oferta && (
        <FormulariInteresAssistit oferta={oferta} idPrefix="cd-interes" onFet={c.onCanvi} />
      )}

      {pendents.map((r) => {
        const cv = r.conveni_rec
        const vigent = cv?.estado === 'vigent'
        return (
          <div key={r.id} className="space-y-2 rounded-md border p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm">
                {r.entitat}
                {r.kg_solicitados != null && (
                  <span className="tabular-nums"> · {Number(r.kg_solicitados).toLocaleString('ca-ES', { maximumFractionDigits: 2 })} kg</span>
                )}
                {r.modalitat ? ` · ${t(`od.mod_${r.modalitat}`)}` : ''}
                {r.canal ? ` · ${t(`od.ch_${r.canal}`)}` : ''}
              </span>
              <Badge className={cn(
                'max-w-full whitespace-normal text-left',
                vigent ? 'bg-exito-fondo text-exito' : 'bg-aviso-fondo text-aviso',
              )}>
                {cv ? t(`conv.st_${cv.estado}`) : t('canalz.rec_sense_conveni')}
                {vigent && cv?.origen === 'declarat' ? ` · ${t('conv.origen_declarat')}` : ''}
              </Badge>
            </div>

            <FormulariAprovacio
              resposta={r}
              oferta={{
                modalitat: extra.oferta.modalitat,
                modalitats: extra.oferta.modalitats ?? null,
                productor_id: extra.productor?.id ?? null,
                preu_minim: oferta?.preu_minim ?? null,
              }}
              faltan={faltan}
              potAprovar={c.potAprovar}
              bloqueig={vigent ? undefined : t('canalz.rec_sense_conveni')}
              idPrefix={`cd-apr-${r.id}`}
              onFet={c.onCanvi}
            />

            {/* Sin convenio vigente: qué falta y los botones que lo resuelven. */}
            {!vigent && r.entidad_id && (
              <div className="space-y-2 rounded-md bg-aviso-fondo p-2">
                <p className="text-sm text-aviso">{t('canalz.rec_conveni_cal')}</p>
                <AccionsConveni
                  tipusOrg="entidad"
                  orgId={r.entidad_id}
                  nom={r.entitat}
                  conveni={cv}
                  tipusCal={conveniQueCalRebre(extra.oferta.modalitat)}
                  potAprovar={c.potAprovar}
                  esSuperAdmin={c.esSuperAdmin}
                  onCanvi={c.onCanvi}
                  petit
                />
              </div>
            )}
          </div>
        )
      })}

      <MissatgesDelPunt missatges={c.missatges} fase="aprovacio" />
    </div>
  )
}
