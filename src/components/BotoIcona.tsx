// La acción de una fila de tabla como ICONO, con su nombre en un tooltip (03-11-2026).
//
// El criterio de las tablas (AGENTS.md §2, «Tablas»): las acciones van en iconos para que la
// tabla quepa sin scroll horizontal, y al pasar por encima se lee qué hacen. El nombre va
// también en `aria-label`, así que un lector de pantalla lo anuncia igual que un botón con
// texto, y en una pantalla táctil —donde no hay hover— el icono tiene que bastar: por eso
// solo se usa para acciones con un icono inequívoco (editar, borrar, abrir, enviar…).
//
// Gris con motivo: el tooltip dice el motivo en vez del nombre. Un botón `disabled` no emite
// eventos de puntero, de ahí el `span tabIndex={0}` que recibe el hover (igual que
// `BotoAmbMotiu`). Área táctil de 44 px en móvil, 32 px desde `md`.

import type { ComponentProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type Props = Omit<ComponentProps<typeof Button>, 'children' | 'size'> & {
  icona: LucideIcon
  /** Qué hace, ya traducido: tooltip y `aria-label`. */
  etiqueta: string
  /** Por qué está gris, ya traducido. Solo se usa con `disabled`. */
  motiu?: string
}

export default function BotoIcona({ icona: Icona, etiqueta, motiu, className, variant = 'ghost', ...props }: Props) {
  const gris = !!props.disabled
  const boto = (
    <Button
      {...props}
      variant={variant}
      size="icon"
      aria-label={etiqueta}
      className={cn('size-11 md:size-8', className)}
    >
      <Icona className="size-4" aria-hidden />
    </Button>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {gris ? <span tabIndex={0} className="inline-flex">{boto}</span> : boto}
      </TooltipTrigger>
      <TooltipContent>{gris && motiu ? motiu : etiqueta}</TooltipContent>
    </Tooltip>
  )
}
