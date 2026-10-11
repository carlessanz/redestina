// Selección múltiple con chips (los mismos de `CampsPerfilReceptor`), para listas que no son
// del perfil del receptor: el tipo de actividad, las modalidades que interesan.

import { cn } from '../lib/utils'

export default function XipsTria({
  opcions, triats, onChange, disabled = false, etiquetaId,
}: {
  /** `desactivat`: esta opción no se puede marcar ahora (p. ej. se ha llegado al máximo). */
  opcions: { valor: string; text: string; desactivat?: boolean }[]
  triats: string[]
  onChange: (v: string[]) => void
  disabled?: boolean
  etiquetaId?: string
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-labelledby={etiquetaId}>
      {opcions.map((o) => {
        const on = triats.includes(o.valor)
        return (
          <button
            key={o.valor}
            type="button"
            disabled={disabled || (o.desactivat === true && !on)}
            aria-pressed={on}
            onClick={() => onChange(on ? triats.filter((x) => x !== o.valor) : [...triats, o.valor])}
            className={cn(
              'min-h-11 rounded-full border px-3 text-base md:min-h-9 md:text-sm',
              on ? 'border-primary bg-secondary text-secondary-foreground' : 'border-input bg-background',
              'disabled:opacity-50',
            )}
          >
            {o.text}
          </button>
        )
      })}
    </div>
  )
}
