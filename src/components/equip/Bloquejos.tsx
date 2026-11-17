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

import { Link } from 'react-router'
import { useT } from '../../lib/i18n'
import { rutaPreusMes } from '../../lib/preus'
import { textMes } from '../../lib/valoracio'
import type { BloqueigCierre } from '../../types'
import { Badge } from '@/components/ui/badge'

export default function Bloquejos({ llista }: { llista: BloqueigCierre[] }) {
  const { t, lang } = useT()
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
          {/* D2: cada mes por validar, con su enlace a Productes › Preus de ese mes. */}
          {b.codigo === 'preus_provisionals' && Array.isArray(b.mesos) && b.mesos.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 text-xs" data-testid="bloqueig-mesos">
              {[...new Set(b.mesos.map((m) => m.mes))].map((mes) => (
                <li key={mes}>
                  <Link to={rutaPreusMes(mes)} className="font-medium text-primary hover:underline">
                    {t('tan.bl_validate_month', {
                      m: textMes(mes, lang === 'es' ? 'es' : 'ca') ?? mes,
                      p: b.mesos!.filter((x) => x.mes === mes).map((x) => x.producto).join(', '),
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
