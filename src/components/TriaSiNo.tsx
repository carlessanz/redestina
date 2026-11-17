// Una pregunta de sí o no, con dos botones (17-11-2026, fase A del punto 3, fila 3.1.3).
//
// Para las dos preguntas binarias del alta —«el producte encara és al camp?» y «cal retornar els
// envasos?»— un desplegable obligaba a abrirlo para ver dos opciones. Dos botones con
// `aria-pressed` (los estilos de `Button`: el elegido, relleno; el otro, con borde) se contestan
// de un toque. El valor que viaja no cambia: el `id` de cada opción del descriptor («si»/«no»,
// «Sí»/«No»), así que ni el servidor ni el bot notan nada.

import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '../lib/utils'

export interface OpcioSiNo { valor: string; text: string }

export default function TriaSiNo({
  id, opcions, valor, onChange, invalid = false, disabled = false, 'aria-labelledby': etiqueta,
}: {
  id: string
  /** Las dos opciones, en el orden en que se pintan (sí, no). */
  opcions: readonly OpcioSiNo[]
  valor: string | null | undefined
  onChange: (valor: string) => void
  invalid?: boolean
  disabled?: boolean
  'aria-labelledby'?: string
}) {
  return (
    <div id={id} role="group" aria-labelledby={etiqueta} aria-invalid={invalid} tabIndex={-1}
      className={cn('flex flex-wrap gap-2 rounded-md', invalid && 'ring-2 ring-destructive/40')}>
      {opcions.map((o) => {
        const on = valor === o.valor
        return (
          <Button key={o.valor} type="button" variant={on ? 'default' : 'outline'} disabled={disabled}
            aria-pressed={on} data-valor={o.valor}
            className="h-11 min-w-20 whitespace-nowrap shrink-0 md:h-8"
            onClick={() => onChange(o.valor)}>
            {on && <Check className="size-4" aria-hidden />}
            {o.text}
          </Button>
        )
      })}
    </div>
  )
}
