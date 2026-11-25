// La marca «Registrada a posteriori» de una oferta (proceso 3.7, 25-11-2026).
//
// Una operación que el equipo registró después de hacerse, fuera del circuito
// (`registrar_operacio_realitzada()`, `excedentes.origen = 'registre'`): no se publicó ni nadie
// mostró interés, así que quien mira la oferta, el listado o Entrades i sortides tiene que poder
// distinguirla de las que sí pasaron por la plataforma.
//
// Igual que `BadgeEspigolada`: color «informativo» (`secondary`, DESIGN.md «Badge / estado»),
// no pide nada a nadie; el icono (`History`) repite la marca sin depender del color.

import { History } from 'lucide-react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { Badge } from '@/components/ui/badge'

export default function BadgeRegistrePosteriori({ className }: { className?: string }) {
  const { t } = useT()
  return (
    <Badge variant="secondary" data-testid="badge-registre-posteriori" title={t('opr.badge_hint')}
      className={cn(className)}>
      <History aria-hidden />
      {t('opr.badge')}
    </Badge>
  )
}
