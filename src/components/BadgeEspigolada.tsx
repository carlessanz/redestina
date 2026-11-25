// La marca «Espigolada» de una oferta (fase 3, 25-11-2026).
//
// Desde que la espigolada dejó de crear una jornada es una oferta de DONACIÓN más (se asigna,
// se comparte y se registra la recogida igual), así que lo único que la distingue en pantalla
// es este badge: el producto sigue en el campo y quien la recoja irá a cosecharla. Quién lo es
// lo dice `esOfertaEspigolada()` (`tipus_operacio`, columna generada).
//
// Color «en gestión / informativo» (`secondary`, DESIGN.md «Badge / estado»): no pide nada a
// nadie. La hoja (`Leaf`) repite la marca sin depender del color, como el punto de `BadgeEstat`.

import { Leaf } from 'lucide-react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { Badge } from '@/components/ui/badge'

export default function BadgeEspigolada({ className }: { className?: string }) {
  const { t } = useT()
  return (
    <Badge variant="secondary" data-testid="badge-espigolada" title={t('od.espigolada_hint')}
      className={cn(className)}>
      <Leaf aria-hidden />
      {t('po.mod_espigolada')}
    </Badge>
  )
}
