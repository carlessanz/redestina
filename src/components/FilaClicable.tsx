// Fila de tabla que abre su detalle al clicarla (10-11-2026, AGENTS.md §2, «Tablas»).
//
// El criterio: en TODAS las tablas de los tres paneles, clicar la fila —o su título— abre lo
// mismo que el icono de «Obre» de la columna de acciones, que se conserva. Antes había que
// apuntar al icono, y cada tabla lo resolvía (o no) a su manera.
//
// Dos piezas, porque cada una cubre a un usuario distinto:
//   · `FilaClicable` (el `<tr>`): el clic de ratón o el toque en cualquier parte de la fila.
//     NO es enfocable: si lo fuera, cada fila sería una parada más del tabulador, por
//     delante de sus propios botones.
//   · `TitolFila` (el título): un enlace o un botón de verdad, y es él quien da el acceso por
//     teclado (Tab + Intro) y lo que anuncia un lector de pantalla.
//
// Los botones, enlaces, casillas y menús de dentro de la fila siguen siendo suyos: un clic
// que nace en un control no abre la fila (`clicDinsControl`). Seleccionar texto tampoco.
// Con `to`, Ctrl/Cmd o el botón central abren el detalle en otra pestaña, como un enlace.
// Sin `to` ni `onObre` (una fila que hoy no tiene detalle, p. ej. un albarán sin PDF), las
// dos piezas se pintan como una fila y un título normales: así la tabla no se bifurca.

import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { clicDinsControl } from '@/lib/filaClicable'

/** Adónde lleva la fila: una ruta (`to`, que gana si vienen los dos) o una acción (`onObre`). */
type Desti = { to?: string; onObre?: () => void }

type PropsFila = Omit<ComponentProps<typeof TableRow>, 'onClick' | 'onAuxClick'> & Desti

export function FilaClicable({ to, onObre, className, children, ...props }: PropsFila) {
  const navigate = useNavigate()
  if (!to && !onObre) return <TableRow {...props} className={className}>{children}</TableRow>

  function obre(e: MouseEvent<HTMLTableRowElement>, novaPestanya: boolean) {
    if (clicDinsControl(e.target as Element | null, e.currentTarget)) return
    // Quien arrastra para copiar un NIF o un número no quiere salir de la pantalla.
    const seleccio = window.getSelection()
    if (seleccio && !seleccio.isCollapsed && e.currentTarget.contains(seleccio.anchorNode)) return
    if (to) {
      if (novaPestanya) window.open(to, '_blank', 'noopener')
      else navigate(to)
    } else {
      onObre?.()
    }
  }

  return (
    <TableRow
      {...props}
      data-fila-clicable=""
      className={cn('cursor-pointer', className)}
      onClick={(e) => obre(e, !!to && (e.metaKey || e.ctrlKey))}
      onAuxClick={(e) => { if (e.button === 1 && to) obre(e, true) }}
    >
      {children}
    </TableRow>
  )
}

type PropsTitol = Desti & { children: ReactNode; className?: string }

/** El título de la fila: lo que se enfoca con el tabulador y abre el detalle con Intro. */
export function TitolFila({ to, onObre, children, className }: PropsTitol) {
  const classes = cn(
    'rounded-sm text-left font-medium text-primary hover:underline',
    'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
    className,
  )
  if (to) return <Link to={to} className={classes}>{children}</Link>
  if (!onObre) return <span className={cn('font-medium', className)}>{children}</span>
  return <button type="button" onClick={onObre} className={classes}>{children}</button>
}
