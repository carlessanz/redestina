// El esqueleto que ocupa el sitio mientras una sección carga.
//
// POR QUÉ EXISTE (16-09-2026). Al cambiar de apartado, la pantalla daba un salto: la ruta
// nueva se montaba **vacía** mientras pedía sus datos, así que el alto del contenido se
// desplomaba, la barra de scroll de `main` desaparecía y todo lo centrado se movía unos
// píxeles; medio segundo después llegaban los datos y volvía a moverse en sentido
// contrario. El cliente lo describió como «un movimiento no deseado» y «flashes».
//
// La causa de fondo la arregla `scrollbar-gutter: stable` en `main` —el hueco de la barra
// se reserva siempre, aparezca o no—, y esto es la otra mitad: **que la pantalla no se
// quede en blanco**. Un esqueleto del alto aproximado del contenido mantiene la página
// estable y, de paso, dice que algo está pasando.
//
// ⚠️ NO es un spinner centrado, y es deliberado: un spinner no ocupa alto, así que no
//    arregla el salto — solo lo adorna. Lo que estabiliza la página es que haya algo con
//    tamaño mientras no hay contenido.
//
// ⚠️ `aria-busy` + `sr-only` con el texto: para quien no ve el esqueleto, la pantalla
//    pasaría de vacía a llena sin que nada lo anunciara.

import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

export default function CarregantSeccio({
  files = 4,
  ambCapcalera = true,
  className,
}: {
  /** Cuántas filas dibujar. Ajústalo al alto típico de la sección, no al máximo. */
  files?: number
  /** Una barra más ancha arriba, para las pantallas que empiezan con un título. */
  ambCapcalera?: boolean
  className?: string
}) {
  const { t } = useT()
  return (
    <div className={cn('space-y-4', className)} aria-busy="true" role="status">
      <span className="sr-only">{t('c.loading')}</span>
      {ambCapcalera && <Skeleton className="h-8 w-56" />}
      <div className="space-y-3">
        {Array.from({ length: files }, (_, i) => (
          // Anchos distintos: un bloque de barras idénticas se lee como un error de
          // pintado, no como algo cargando.
          <Skeleton key={i} className={cn('h-16 w-full', i % 3 === 2 && 'w-4/5')} />
        ))}
      </div>
    </div>
  )
}
