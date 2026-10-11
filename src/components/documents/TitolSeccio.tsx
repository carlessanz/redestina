// El título de cada bloque de «Els meus certificats» (revisión del 08-10-2026, §4.5: «cada
// tipus de document ha de tenir el seu espai clar»). Icono de marca y el nombre del bloque:
// se reconoce de un vistazo qué es cada tarjeta, en una pantalla que junta convenios,
// certificados, albaranes y el plan.

import type { LucideIcon } from 'lucide-react'
import { CardTitle } from '@/components/ui/card'

export default function TitolSeccio({ icona: Icona, children }: { icona: LucideIcon; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2 text-base">
      <Icona className="size-5 shrink-0 text-primary" aria-hidden />
      <span>{children}</span>
    </CardTitle>
  )
}
