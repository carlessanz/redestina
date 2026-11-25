// Una sección de una pestaña de ficha (Taula mestra 1.3, 25-11-2026: «contenedores o bloques
// diferenciados, fondos suaves ligeramente contrastados, títulos más visibles y jerarquizados,
// más separación vertical»). UNA sola definición para la ficha del equipo (`EntitatDetall`),
// la de la propia organización (`PerfilOrganitzacio`) y el alta (`NovaEntitat`), que tenían
// cada una su copia (una raya entre secciones y un título pequeño).
//
// Un bloque con borde y radio `xl`, fondo `muted` suave sobre la tarjeta blanca (los campos,
// blancos, resaltan encima) y una cabecera algo más marcada con el título en Sora. Sin
// `overflow-hidden` a propósito: las listas de sugerencias (`CercadorOpcions`) son absolutas y
// se cortarían. La separación entre bloques la pone el contenedor (`space-y-6`).
//
// Fuera de cualquier componente, siempre: definida dentro, cada render es un tipo nuevo, React
// desmonta la sección y el campo pierde el foco en cada tecla (`tests/componentsNiats.test.ts`).

import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface Props {
  /** Sin título, el bloque va sin cabecera (un control suelto, p. ej. el canal preferido). */
  titol?: string
  /** Una línea de ayuda bajo el título. */
  ajuda?: string
  children: ReactNode
  testid?: string
  className?: string
}

export default function Seccio({ titol, ajuda, children, testid, className }: Props) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-border bg-muted/30', className)} data-testid={testid}>
      {titol && (
        <header className="rounded-t-xl border-b border-border bg-muted/60 px-3 py-3 sm:px-5">
          <h3 className="font-titulos text-lg font-semibold leading-snug">{titol}</h3>
          {ajuda && <p className="mt-1 text-sm text-muted-foreground">{ajuda}</p>}
        </header>
      )}
      <div className="min-w-0 space-y-4 p-3 sm:p-5">{children}</div>
    </section>
  )
}
