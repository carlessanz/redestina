// El estado de la firma de un documento, en una etiqueta (05-11-2026).
//
// El mismo estado se dice distinto según quién mire (`lib/signatures.ts`): a la
// organización, «Pendent de signar» es lo que le toca (ámbar); al equipo, eso mismo es
// «espera a l'entitat» (neutro), y lo que le toca es «Signat, per tancar». Lo resuelto, en
// verde. Sin estado (el documento no se firma), no pinta nada.

import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { clauEstatSignatura, estilEstatSignatura, type PerspectivaSignatura } from '../lib/signatures'
import type { EstatSignatura } from '../types'
import { Badge } from '@/components/ui/badge'

export default function BadgeSignatura({ estat, perspectiva, className }: {
  estat: EstatSignatura | null | undefined
  perspectiva: PerspectivaSignatura
  className?: string
}) {
  const { t } = useT()
  if (!estat) return null
  return (
    <Badge
      data-testid="badge-signatura"
      data-estat={estat}
      className={cn('max-w-full whitespace-normal', estilEstatSignatura(estat, perspectiva), className)}
    >
      {t(clauEstatSignatura(estat, perspectiva))}
    </Badge>
  )
}
