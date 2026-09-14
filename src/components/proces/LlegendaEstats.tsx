// «Què vol dir cada estat»: la leyenda de los badges, plegada.
//
// Va cerrada por defecto a propósito. Quien ya conoce el circuito no necesita leer siete
// frases cada vez que abre un listado, y quien no lo conoce no tiene hoy ningún sitio donde
// preguntarlo: el badge dice «Coberta» y no hay nada que explique qué significa. Plegada
// resuelve los dos casos sin quitarle sitio a la tabla.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export interface ItemLlegenda {
  /** Clave i18n de la etiqueta del badge. */
  key: string
  /** Las clases del badge, tal cual las da `etiquetaEstatOferta`. */
  clase: string
  /** Clave i18n de la frase que lo explica. */
  descKey: string
}

export default function LlegendaEstats({ items }: { items: ItemLlegenda[] }) {
  const { t } = useT()
  const [obert, setObert] = useState(false)

  return (
    <Collapsible open={obert} onOpenChange={setObert}>
      <CollapsibleTrigger className="flex h-11 items-center gap-1.5 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground md:h-9">
        <ChevronDown
          className={cn('size-4 transition-transform', obert && 'rotate-180')}
          aria-hidden
        />
        {t('proc.llegenda_t')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 space-y-2 rounded-xl border bg-card p-3">
          {items.map((it) => (
            <li key={it.key} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
              <span
                className={cn(
                  'w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                  it.clase,
                )}
              >
                {t(it.key)}
              </span>
              <span className="text-sm text-muted-foreground">{t(it.descKey)}</span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
