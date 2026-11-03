// El selector de periodo (año en curso, mes en curso o un rango), compartido por los
// indicadores del tablero (fase 8) y el impacto (fase 10). Controlado.

import { useT } from '../lib/i18n'
import type { Periode } from '../lib/periode'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Desplegable from './Desplegable'

export default function SelectorPeriode({
  periode, onPeriode, rang, onRang, any, idPrefix,
}: {
  periode: Periode
  onPeriode: (p: Periode) => void
  rang: { desDe: string; finsA: string }
  onRang: (r: { desDe: string; finsA: string }) => void
  /** El año en curso, para la etiqueta de la primera opción */
  any: string
  idPrefix: string
}) {
  const { t } = useT()
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      <div className="space-y-1 sm:w-44">
        <Label htmlFor={`${idPrefix}-periode`} className="text-xs text-muted-foreground">{t('kp.periode')}</Label>
        <Desplegable id={`${idPrefix}-periode`} value={periode} onChange={(v) => onPeriode(v as Periode)}
          opcions={[
            { valor: 'any', text: t('kp.p_any', { any }) },
            { valor: 'mes', text: t('kp.p_mes') },
            { valor: 'rang', text: t('kp.p_rang') },
          ]} />
      </div>
      {periode === 'rang' && (
        <>
          <div className="space-y-1 sm:w-44">
            <Label htmlFor={`${idPrefix}-des`} className="text-xs text-muted-foreground">{t('fl.des_de')}</Label>
            <Input id={`${idPrefix}-des`} type="date" value={rang.desDe} onChange={(e) => onRang({ ...rang, desDe: e.target.value })} />
          </div>
          <div className="space-y-1 sm:w-44">
            <Label htmlFor={`${idPrefix}-fins`} className="text-xs text-muted-foreground">{t('fl.fins_a')}</Label>
            <Input id={`${idPrefix}-fins`} type="date" value={rang.finsA} onChange={(e) => onRang({ ...rang, finsA: e.target.value })} />
          </div>
        </>
      )}
    </div>
  )
}
