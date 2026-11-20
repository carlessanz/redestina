// La franja de cifras de «Entrades i sortides» (punto 6.7): salidas, kilos y, en el Resum, los
// indicadores de la hoja del ARA (entidades productoras, receptoras y espigoladas). Son las
// cifras de TODO lo filtrado, no de la página.

import { cn } from '../../lib/utils'

export interface Xifra {
  /** `data-testid` = `es-xifra-<clau>`. */
  clau: string
  etiqueta: string
  valor: string
}

export default function FranjaXifres({ xifres, carregant }: { xifres: readonly Xifra[]; carregant?: boolean }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', xifres.length > 3 && 'lg:grid-cols-6', carregant && 'opacity-60')}
      aria-busy={carregant || undefined}>
      {xifres.map((x) => (
        <div key={x.clau} className="min-w-0 rounded-lg bg-muted/50 p-3" data-testid={`es-xifra-${x.clau}`}>
          <dt className="text-xs text-muted-foreground">{x.etiqueta}</dt>
          <dd className="font-titulos text-xl font-semibold tabular-nums break-words">{x.valor}</dd>
        </div>
      ))}
    </dl>
  )
}
