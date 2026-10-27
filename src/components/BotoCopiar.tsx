// El botón de copiar un texto para pegarlo en WhatsApp o en un correo. Uno solo para toda la
// aplicación (27-10-2026): el icono pasa a ✓ un momento y sale el aviso «Copiat».

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { copiarAlPortapapeles } from '../lib/copiar'
import { Button } from '@/components/ui/button'

interface Props {
  text: string
  /** Lo que dice el botón; por defecto, «Copia». */
  etiqueta?: ReactNode
  size?: 'sm' | 'default'
  variant?: 'outline' | 'ghost' | 'secondary' | 'default'
  className?: string
  /** Después de copiar bien (p. ej. marcar la oferta como enviada a mano). */
  onCopiat?: () => void
  disabled?: boolean
}

export default function BotoCopiar({
  text, etiqueta, size = 'sm', variant = 'outline', className, onCopiat, disabled,
}: Props) {
  const { t } = useT()
  const [fet, setFet] = useState(false)
  const temps = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (temps.current) clearTimeout(temps.current) }, [])

  async function copia() {
    const ok = await copiarAlPortapapeles(text)
    if (!ok) { toast.error(t('copia.err')); return }
    setFet(true)
    toast.success(t('od.copied'))
    if (temps.current) clearTimeout(temps.current)
    temps.current = setTimeout(() => setFet(false), 1500)
    onCopiat?.()
  }

  return (
    <Button type="button" variant={variant} size={size} className={className}
      disabled={disabled || !text} onClick={() => void copia()}>
      {fet ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {etiqueta ?? t('copia.boto')}
    </Button>
  )
}
