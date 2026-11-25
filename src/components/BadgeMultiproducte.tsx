// La marca de una oferta MULTIPRODUCTO (plan DIC 26, fase 6a): «Multiproducte · 3».
//
// Cada producto sigue siendo su propia oferta (su fila en el listado, su detalle); este badge dice
// que se publicó junto con otras del mismo productor (`disponibilitat_id`) y cuántas son. Mismo
// patrón que `BadgeEspigolada`: color informativo (`secondary`, DESIGN.md «Badge / estado») y un
// icono que repite la marca sin depender del color.

import { Layers } from 'lucide-react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { Badge } from '@/components/ui/badge'

export default function BadgeMultiproducte({ n, className }: { n: number; className?: string }) {
  const { t } = useT()
  return (
    <Badge variant="secondary" data-testid="badge-multiproducte" title={t('mp.badge_hint')}
      className={cn(className)}>
      <Layers aria-hidden />
      {n > 1 ? t('mp.badge', { n }) : t('mp.badge_sense_n')}
    </Badge>
  )
}
