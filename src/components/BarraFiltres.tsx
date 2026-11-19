// La barra de filtros común de los listados (fase 6 de la revisión del 08-10-2026). Una
// sola, con el mismo aspecto y la misma lógica en todas las pantallas: desplegables por
// dimensión (solo con valores que dan resultado), un rango de fechas opcional, «Neteja els
// filtres» y el recuento. En móvil se pliega detrás de un botón «Filtres (n)».
//
// Los desplegables son `Desplegable` (el Select de shadcn con los tokens, 03-11-2026): el
// `<select>` nativo se pintaba con el borde azul y la flecha del sistema y no casaba con nada.
// Compactos (`mida="sm"`): la barra es una herramienta, no un formulario.
//
// AUTOCOMPLETAR (19-11-2026, buscadores predictivos). Una dimensión con muchas opciones
// —municipio, entidad, producto— se recorre mal en un desplegable: pasa a un buscador
// (`CercadorOpcions`) en el que se escribe un trozo y se toca la sugerencia. Se decide SOLO,
// por número de opciones (más de `LLINDAR_CERCADOR`), para no tocar las pantallas que usan la
// barra; `cercador: true|false` en la dimensión lo fuerza. Y una vez buscador, se queda buscador
// mientras la barra viva: las opciones se recortan al poner otros filtros y el control no
// debe cambiar de forma bajo el dedo. Con buscador sigue estando «Tots» (la primera
// sugerencia, sin teclear) y el placeholder lo dice cuando no hay nada elegido; mide 32 px en
// escritorio (`md:h-7`, como las fechas) y 16 px de texto en móvil (`Input`).

import { useState } from 'react'
import { Filter, X } from 'lucide-react'
import { useT } from '../lib/i18n'
import { filtresActius, type ValorsFiltre } from '../lib/filtres'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Desplegable from './Desplegable'
import CercadorOpcions from './CercadorOpcions'

/** Más opciones que esto y la dimensión pasa a autocompletar (salvo `cercador: false`). */
const LLINDAR_CERCADOR = 12

export interface DesplegableFiltre {
  clau: string
  etiquetaKey: string
  /** Las opciones que dan resultado (`opcionsDisponibles`). */
  opcions: string[]
  /** Cómo se lee un valor: una clave i18n compuesta, un nombre… Por defecto, tal cual. */
  text?: (v: string) => string
  /**
   * Autocompletar en vez de desplegable. Sin él se decide solo: más de `LLINDAR_CERCADOR`
   * opciones (y una vez decidido, se mantiene).
   */
  cercador?: boolean
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

export default function BarraFiltres({ id, desplegables, valors, onValors, rang, mostrant, total, extra }: Props) {
  const { t } = useT()
  const [obert, setObert] = useState(false)
  // Las dimensiones que ya han pasado a buscador: no vuelven a desplegable al recortarse sus
  // opciones (patrón «guardar lo de renders anteriores»: el `set` en el render es legítimo).
  const [ambCercador, setAmbCercador] = useState<readonly string[]>([])
  const nous = desplegables
    .filter((d) => d.cercador === undefined && d.opcions.length > LLINDAR_CERCADOR && !ambCercador.includes(d.clau))
    .map((d) => d.clau)
  if (nous.length > 0) setAmbCercador([...ambCercador, ...nous])
  const usaCercador = (d: DesplegableFiltre) =>
    d.cercador ?? (ambCercador.includes(d.clau) || d.opcions.length > LLINDAR_CERCADOR)
  const n = filtresActius(valors, rang)
  const neteja = () => {
    onValors({})
    rang?.onCanvi('', '')
  }

  return (
    <div className="space-y-2" data-testid={`filtres-${id}`}>
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <Button variant="outline" size="sm" onClick={() => setObert((o) => !o)} aria-expanded={obert}>
          <Filter className="size-4" aria-hidden /> {n > 0 ? t('fl.btn_n', { n }) : t('fl.btn')}
        </Button>
      </div>
      <div className={(obert ? 'grid' : 'hidden') + ' grid-cols-2 gap-x-2 gap-y-2.5 md:flex md:flex-wrap md:items-end'}>
        {desplegables.filter((d) => d.opcions.length > 0 || valors[d.clau]).map((d) => (
          <div key={d.clau} className="min-w-0 space-y-1 md:w-40">
            <Label htmlFor={`${id}-${d.clau}`} className="text-xs font-normal text-muted-foreground">{t(d.etiquetaKey)}</Label>
            {usaCercador(d) ? (
              <CercadorOpcions id={`${id}-${d.clau}`} className="md:h-7" valor={valors[d.clau] ?? ''}
                buit={t('fl.tots')} placeholder={t('fl.tots')} detallSota={false}
                onChange={(v) => onValors({ ...valors, [d.clau]: v })}
                opcions={d.opcions.map((o) => ({ valor: o, text: d.text ? d.text(o) : o }))} />
            ) : (
              <Desplegable id={`${id}-${d.clau}`} mida="sm" value={valors[d.clau] ?? ''} buit={t('fl.tots')}
                onChange={(v) => onValors({ ...valors, [d.clau]: v })}
                opcions={d.opcions.map((o) => ({ valor: o, text: d.text ? d.text(o) : o }))} />
            )}
          </div>
        ))}
        {rang && (
          <>
            <div className="min-w-0 space-y-1 md:w-36">
              <Label htmlFor={`${id}-des`} className="text-xs font-normal text-muted-foreground">{t(rang.etiquetaKey)} · {t('fl.des_de')}</Label>
              <Input id={`${id}-des`} type="date" className="md:h-7" value={rang.desDe} onChange={(e) => rang.onCanvi(e.target.value, rang.finsA)} />
            </div>
            <div className="min-w-0 space-y-1 md:w-36">
              <Label htmlFor={`${id}-fins`} className="text-xs font-normal text-muted-foreground">{t('fl.fins_a')}</Label>
              <Input id={`${id}-fins`} type="date" className="md:h-7" value={rang.finsA} onChange={(e) => rang.onCanvi(rang.desDe, e.target.value)} />
            </div>
          </>
        )}
        {extra}
        {n > 0 && (
          <Button variant="ghost" size="sm" className="col-span-2 justify-self-start text-muted-foreground" onClick={neteja}>
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
