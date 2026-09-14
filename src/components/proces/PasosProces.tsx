// El indicador de pasos del proceso: dónde está esto y cuánto queda.
//
// ⚠️ POR QUÉ LAS ETIQUETAS SOLO SALEN EN `sm+`. Las cinco etapas de una oferta se llaman
// «Publicada», «Assignada», «Recollida», «Confirmada» i «Tancada»: a 320 px cada celda da
// ~60 px y esas palabras piden el doble, así que o rompen a tres líneas o desbordan. Por
// debajo de `sm` se pintan solo los puntos y una línea de texto —«Pas 3 de 5 · Recollida»—
// que dice exactamente lo mismo en el espacio que hay. Es el mismo problema medido de la
// barra inferior de móvil (§2), y la misma conclusión: `truncate` no lo arregla.
//
// Con `sortida` el camino se apaga entero: una oferta cancelada no está «en el paso 2», está
// fuera del camino. En rojo solo si es destructiva —cancelada, rechazada—; en gris si
// simplemente no llegó a destino, que no es un fallo de nadie.

import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'

export default function PasosProces({
  etapes,
  actual,
  sortida,
  destructiva = false,
}: {
  /** Una clave i18n por paso, en orden. */
  etapes: readonly string[]
  /** Índice del paso actual. Fuera de rango (-1) = ninguno encendido. */
  actual: number
  /** Clave i18n del título de la salida; si viene, el camino se apaga. */
  sortida?: string
  destructiva?: boolean
}) {
  const { t } = useT()
  const total = etapes.length
  const fora = Boolean(sortida)
  const dins = !fora && actual >= 0 && actual < total

  return (
    <div className="space-y-2">
      <ol className="flex items-start" aria-label={t('proc.llegenda_t')}>
        {etapes.map((clau, i) => {
          const fet = !fora && i < actual
          const ara = !fora && i === actual
          return (
            <li
              key={clau}
              aria-current={ara ? 'step' : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-2 left-0 right-1/2 h-0.5 rounded-full',
                    fora ? 'bg-border' : fet || ara ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  'relative z-10 size-4 rounded-full border-2',
                  fora
                    ? 'border-border bg-muted'
                    : ara
                      ? 'border-primary bg-primary ring-4 ring-primary/20'
                      : fet
                        ? 'border-primary bg-primary'
                        : 'border-border bg-card',
                )}
              />
              <span
                className={cn(
                  'hidden px-1 text-center text-xs sm:block',
                  ara ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {t(clau)}
              </span>
            </li>
          )
        })}
      </ol>

      {/* La misma información que las etiquetas, en el espacio que hay en móvil. */}
      {sortida ? (
        <p className={cn('text-sm font-medium', destructiva ? 'text-error' : 'text-muted-foreground')}>
          {t(sortida)}
        </p>
      ) : (
        dins && (
          <p className="text-sm text-muted-foreground sm:hidden">
            {t('proc.step_of', { n: actual + 1, total, titol: t(etapes[actual]) })}
          </p>
        )
      )}
    </div>
  )
}
