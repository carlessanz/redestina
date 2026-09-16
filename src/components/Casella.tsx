// La casilla de verificación de Redestina. Una sola, para toda la aplicación.
//
// POR QUÉ EXISTE (16-09-2026). Había **tres** apariencias distintas y ninguna era una
// decisión: `mt-1 size-5 accent-primary` en la firma del convenio, `size-5 accent-primary`
// en la campaña de convenios y, en `OfferDetail`, **un `<input type="checkbox">` sin una
// sola clase** — o sea el control por defecto del navegador, que ni siquiera mide lo mismo
// en Safari que en Chrome. El cliente lo vio en la pantalla de firma: «hay dos checkbox que
// tienen un tamaño distinto; esto no puede suceder».
//
// 🔴 Y LAS DOS DE LA FIRMA LLEVABAN LA MISMA CLASE, que es lo que hace este fallo
//    interesante: se deformaban igualmente. Son hijas de un `flex` y les faltaba
//    **`shrink-0`**, así que la que acompañaba al texto largo —la declaración de
//    aceptación, que ocupa dos líneas— se dejaba aplastar por su propia etiqueta. `size-5`
//    fija el tamaño *preferido*, no el mínimo: en un contenedor flex eso no basta, y esa es
//    exactamente la diferencia que se veía.
//
// ⚠️ `size-5` son 20 px de cuadro, pero el ÁREA TÁCTIL son los 44 px de la fila entera
//    (`FilaCasella`): a 20 px de lado esto es imposible de acertar con un dedo, y subir el
//    cuadro hasta 44 lo convertiría en otra cosa. Se agranda la zona, no el dibujo.
//
// La regla que esto impone está en `design/DESIGN.md §6` y en AGENTS §2bis: ningún control
// de formulario se estila a mano. Si hace falta uno nuevo, se añade aquí.

import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

interface PropsCasella {
  checked: boolean
  onChange: (valor: boolean) => void
  disabled?: boolean
  id?: string
  /** Para las casillas sin etiqueta visible (una columna de tabla, por ejemplo). */
  'aria-label'?: string
  className?: string
}

/** La casilla sola. Para una celda de tabla o cuando la etiqueta ya la pone quien llama. */
export function Casella({
  checked, onChange, disabled, id, className, ...resta
}: PropsCasella) {
  return (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      // `shrink-0` NO es decorativo: sin él, dentro de un flex la casilla se deforma según
      // lo larga que sea la etiqueta de al lado. Ver la nota de la cabecera.
      className={cn(
        'size-5 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      aria-label={resta['aria-label']}
    />
  )
}

/**
 * La casilla con su etiqueta, como fila pulsable de 44 px. Es la forma normal de usarla:
 * toda la fila acepta el clic, no solo el cuadrito.
 */
export function FilaCasella({
  checked, onChange, disabled, children, caixa = false,
}: Omit<PropsCasella, 'id' | 'className'> & {
  children: ReactNode
  /** `true` la dibuja dentro de un recuadro, para las declaraciones que se firman. */
  caixa?: boolean
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 items-start gap-3 text-sm',
        caixa && 'rounded-md border p-3',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {/* `mt-0.5` alinea el cuadro con la PRIMERA línea del texto, no con el centro del
          bloque: con una etiqueta de tres líneas, centrarlo lo deja flotando en medio. */}
      <Casella checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5" />
      <span className="min-w-0">{children}</span>
    </label>
  )
}
