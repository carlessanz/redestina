// La barra de filtros común de los listados (fase 6 de la revisión del 08-10-2026). Una
// sola, con el mismo aspecto y la misma lógica en todas las pantallas: desplegables por
// dimensión (solo con valores que dan resultado), un rango de fechas opcional, «Neteja els
// filtres» y el recuento. En móvil se pliega detrás de un botón «Filtres (n)».
//
// Los desplegables son `<select>` nativos, como los del Mercat: en el móvil abren el selector
// del sistema. ⚠️ `text-base md:text-sm` obligatorio (§2, regla 1: iOS amplía al enfocar).

import { useState } from 'react'
import { Filter, X } from 'lucide-react'
import { useT } from '../lib/i18n'
import { filtresActius, type ValorsFiltre } from '../lib/filtres'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface DesplegableFiltre {
  clau: string
  etiquetaKey: string
  /** Las opciones que dan resultado (`opcionsDisponibles`). */
  opcions: string[]
  /** Cómo se lee un valor: una clave i18n compuesta, un nombre… Por defecto, tal cual. */
  text?: (v: string) => string
}

interface Props {
  id: string
  desplegables: DesplegableFiltre[]
  valors: ValorsFiltre
  onValors: (v: ValorsFiltre) => void
  /** Con rango de fechas: la etiqueta dice sobre qué fecha se filtra. */
  rang?: { etiquetaKey: string; desDe: string; finsA: string; onCanvi: (desDe: string, finsA: string) => void }
  /** «Mostrant N de M». */
  mostrant: number
  total: number
  /** Algo más en la barra (p. ej. el orden). */
  extra?: React.ReactNode
}

const SELECT = 'h-11 w-full rounded-md border border-input bg-transparent px-3 text-base md:h-9 md:text-sm'

export default function BarraFiltres({ id, desplegables, valors, onValors, rang, mostrant, total, extra }: Props) {
  const { t } = useT()
  const [obert, setObert] = useState(false)
  const n = filtresActius(valors, rang)
  const neteja = () => {
    onValors({})
    rang?.onCanvi('', '')
  }

  return (
    <div className="space-y-2" data-testid={`filtres-${id}`}>
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <Button variant="outline" size="sm" className="h-11" onClick={() => setObert((o) => !o)} aria-expanded={obert}>
          <Filter className="size-4" aria-hidden /> {n > 0 ? t('fl.btn_n', { n }) : t('fl.btn')}
        </Button>
      </div>
      <div className={(obert ? 'grid' : 'hidden') + ' grid-cols-1 gap-3 sm:grid-cols-2 md:flex md:flex-wrap md:items-end'}>
        {desplegables.filter((d) => d.opcions.length > 0 || valors[d.clau]).map((d) => (
          <div key={d.clau} className="min-w-0 space-y-1 md:w-44">
            <Label htmlFor={`${id}-${d.clau}`} className="text-xs text-muted-foreground">{t(d.etiquetaKey)}</Label>
            <select id={`${id}-${d.clau}`} className={SELECT} value={valors[d.clau] ?? ''}
              onChange={(e) => onValors({ ...valors, [d.clau]: e.target.value })}>
              <option value="">{t('fl.tots')}</option>
              {d.opcions.map((o) => <option key={o} value={o}>{d.text ? d.text(o) : o}</option>)}
            </select>
          </div>
        ))}
        {rang && (
          <>
            <div className="min-w-0 space-y-1 md:w-40">
              <Label htmlFor={`${id}-des`} className="text-xs text-muted-foreground">{t(rang.etiquetaKey)} · {t('fl.des_de')}</Label>
              <Input id={`${id}-des`} type="date" value={rang.desDe} onChange={(e) => rang.onCanvi(e.target.value, rang.finsA)} />
            </div>
            <div className="min-w-0 space-y-1 md:w-40">
              <Label htmlFor={`${id}-fins`} className="text-xs text-muted-foreground">{t('fl.fins_a')}</Label>
              <Input id={`${id}-fins`} type="date" value={rang.finsA} onChange={(e) => rang.onCanvi(rang.desDe, e.target.value)} />
            </div>
          </>
        )}
        {extra}
        {n > 0 && (
          <Button variant="ghost" size="sm" className="h-11 md:h-9" onClick={neteja}>
            <X className="size-4" aria-hidden /> {t('fl.neteja')}
          </Button>
        )}
      </div>
      {n > 0 && (
        <p className="text-xs text-muted-foreground" aria-live="polite">{t('fl.mostrant', { n: mostrant, m: total })}</p>
      )}
    </div>
  )
}
