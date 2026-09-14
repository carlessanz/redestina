// Un botón que, cuando está gris, dice por qué.
//
// ⚠️ EL `<span tabIndex={0}>` NO ES DECORATIVO. Un botón `disabled` no emite eventos de
// puntero, así que el `Tooltip` colgado directamente de él no se abriría nunca: hace falta
// un envoltorio que sí los reciba, y `tabIndex={0}` para que también se llegue con el
// teclado. `inline-block` porque un `span` sin display no acepta el ancho del botón.
//
// ⚠️ Y EL MOTIVO TIENE QUE SALIR ADEMÁS EN OTRO SITIO. En una pantalla táctil no hay hover,
// así que este tooltip **no existe** para la mitad de quien usa la aplicación. Es un extra
// para el escritorio; la explicación de verdad la da `QueTocaAra`, que la pinta siempre y
// sale del mismo módulo (`alb.why_*`, `tan.why_*` en `seguentPas.ts`).

import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export default function BotoAmbMotiu({
  motiu,
  ...props
}: ComponentProps<typeof Button> & {
  /** Ya traducido: este componente no sabe de idiomas. */
  motiu?: string
}) {
  if (!props.disabled || !motiu) return <Button {...props} />

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-block">
          <Button {...props} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{motiu}</TooltipContent>
    </Tooltip>
  )
}
