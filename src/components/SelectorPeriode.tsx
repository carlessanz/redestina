// El selector de periodo (año en curso, mes en curso o un rango), compartido por los
// indicadores del tablero (fase 8) y el impacto (fase 10). Controlado.

import { useT } from '../lib/i18n'
import type { Periode } from '../lib/periode'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const SELECT = 'h-11 w-full rounded-md border border-input bg-transparent px-3 text-base md:h-9 md:text-sm'

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
        <select id={`${idPrefix}-periode`} className={SELECT} value={periode} onChange={(e) => onPeriode(e.target.value as Periode)}>
          <option value="any">{t('kp.p_any', { any })}</option>
          <option value="mes">{t('kp.p_mes')}</option>
          <option value="rang">{t('kp.p_rang')}</option>
        </select>
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
