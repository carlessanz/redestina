// Los bloqueos de un acumulado —de un donante en el cierre anual, o de una ventana en el
// certificado a demanda— con su badge y su detalle.
//
// Vivía dentro de `TancamentDetall`, y salió de ahí cuando el certificado a demanda necesitó
// enseñar exactamente lo mismo: dos copias de esto acabarían pintando el mismo bloqueo de dos
// colores distintos, y el color es lo que dice si frena o solo avisa.
//
// ⚠️ **El detalle lo escribe la BASE**, ya en catalán y con sus cifras dentro, y se enseña tal
//    cual. Es el mismo criterio que con los mensajes de error de las RPC: quien conoce el dato
//    exacto es quien lo calculó, y reescribirlo aquí solo puede empeorarlo.

import { useT } from '../../lib/i18n'
import type { BloqueigCierre } from '../../types'
import { Badge } from '@/components/ui/badge'

export default function Bloquejos({ llista }: { llista: BloqueigCierre[] }) {
  const { t } = useT()
  if (llista.length === 0) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <ul className="space-y-1">
      {llista.map((b, i) => (
        <li key={`${b.codigo}-${i}`} className="max-w-72">
          {/* Rojo solo si `bloqueja`: los que avisan sin frenar (`sense_rec`,
              `certificat_desactualitzat`) en rojo harían parecer parado lo que no lo está. */}
          <Badge className={b.bloqueja ? 'bg-error-fondo text-error' : 'bg-aviso-fondo text-aviso'}>
            {t(`tan.bl_${b.codigo}`)}
          </Badge>
          <p className="mt-0.5 text-xs text-muted-foreground">{b.detall}</p>
        </li>
      ))}
    </ul>
  )
}
