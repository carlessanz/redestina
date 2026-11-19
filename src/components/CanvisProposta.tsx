// Lo que cambia una propuesta del equipo respecto de lo que pidió la entidad: «abans → ara»
// campo a campo, y el motivo (fase 5 de los puntos 4-6). Lo pintan la entidad (al aceptar o
// rechazar) y el equipo (la ficha de la oferta, Aprovacions), así que dicen exactamente lo mismo.
//
// Solo se lista lo que cambia: la propuesta guarda los valores efectivos completos, pero lo que
// no cambia no le dice nada a quien decide (`canvisProposta`, puro y con test).

import { useT } from '../lib/i18n'
import { kg as fmtKg } from '../lib/format'
import { canvisProposta } from '../lib/propostaCanvis'
import type { CanviProposta, RespostaAmbProposta } from '../lib/propostaCanvis'

/** «12/11 · 10:30», en hora local: lo mismo que la entidad eligió en su formulario. */
function quan(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function CanvisProposta({ resposta, ambMotiu = true }: {
  resposta: RespostaAmbProposta
  /** El motivo del equipo debajo de los cambios (por defecto, sí). */
  ambMotiu?: boolean
}) {
  const { t } = useT()
  const valor = (c: CanviProposta, v: string | number | null): string => {
    if (v == null || v === '') return t('prop.sense_valor')
    if (c.camp === 'kg') return `${fmtKg(v)} kg`
    if (c.camp === 'modalitat') return t(`od.mod_${v}`)
    return quan(String(v))
  }
  const canvis = canvisProposta(resposta)
  return (
    <div className="space-y-1 text-sm" data-testid="canvis-proposta">
      {canvis.length > 0 && (
        <ul className="space-y-0.5">
          {canvis.map((c) => (
            <li key={c.camp} className="flex flex-wrap gap-x-1.5">
              <span className="text-muted-foreground">{t(`prop.camp_${c.camp}`)}:</span>
              <span className="text-muted-foreground line-through">{valor(c, c.abans)}</span>
              <span aria-hidden>→</span>
              <span className="font-medium">{valor(c, c.ara)}</span>
            </li>
          ))}
        </ul>
      )}
      {ambMotiu && resposta.proposta_motiu && (
        <p className="min-w-0 break-words">{t('prop.motiu_equip', { motiu: resposta.proposta_motiu })}</p>
      )}
    </div>
  )
}
