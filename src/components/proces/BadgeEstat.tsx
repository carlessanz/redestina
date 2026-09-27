// El badge de un estado SIMPLE (productor y receptor): la píldora con un punto delante.
//
// El punto no es decoración: la revisión del 23-09-2026 pedía estados «más visuales», con
// un código de color por estado, y en una píldora pequeña el fondo solo se distingue mal
// entre el crema y el verde claro. El punto repite el color del texto, así que la
// diferencia se ve también en blanco y negro y sin depender de un tono de fondo.

import { Badge } from '@/components/ui/badge'
import { cn } from '../../lib/utils'

export default function BadgeEstat({
  clase, children, gran,
}: { clase: string; children: React.ReactNode; gran?: boolean }) {
  return (
    <Badge className={cn(clase, gran && 'px-2.5 py-1 text-sm')}>
      <span className={cn('rounded-full bg-current', gran ? 'size-2' : 'size-1.5')} aria-hidden />
      {children}
    </Badge>
  )
}
