// «Com funciona»: las seis fases del servicio, con el enlace a donde se trabaja cada una.
//
// Lo que había antes eran cuatro tarjetas de texto sin un solo enlace (`dash.p1-p4`), que
// contaban el circuito de julio —entrada por WhatsApp, distribución, confirmación, cierre—
// y dejaban fuera ocho de las trece entradas del menú: convenios, espigoladas, albaranes,
// costes, cierre anual, documentos. Alguien que entra por primera vez leía cuatro párrafos
// y seguía sin saber para qué sirve la mitad de su menú.
//
// LAS FASES NO SE ESCRIBEN AQUÍ: salen de `FASES_EQUIP` (`procesOferta.ts`), que es también
// lo que ordena el menú del equipo, y sus rutas las comprueba una prueba contra `nav.ts`.
// Un «Com funciona» que enlaza a una sección retirada es peor que no tener enlace.
//
// LA ETIQUETA DEL ENLACE ES LA DEL MENÚ, leída de `nav.ts`: si mañana «Albarans» pasa a
// llamarse de otra forma, este bloque lo dice igual que la barra lateral, sin una segunda
// traducción que se quede vieja.

import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { FASES_EQUIP } from '../../lib/procesOferta'
import { itemsPlans, navPerRol } from '../../lib/nav'
import { Card, CardContent } from '@/components/ui/card'

/** Ruta → clave de su etiqueta en el menú del equipo. */
const ETIQUETES: Record<string, string> = Object.fromEntries(
  itemsPlans(navPerRol('intern')).map((i) => [i.to, i.labelKey]),
)

export default function ComFunciona() {
  const { t } = useT()

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {FASES_EQUIP.map((fase, i) => (
        <Card key={fase.clau}>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center gap-2">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {i + 1}
              </span>
              <h3 className="font-titulos text-base font-semibold">{t(`fase.${fase.clau}_t`)}</h3>
            </div>
            <p className="text-sm text-muted-foreground">{t(`fase.${fase.clau}_d`)}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              {fase.rutes.map((ruta) => (
                <Link
                  key={ruta}
                  to={ruta}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline md:min-h-0"
                >
                  {t(ETIQUETES[ruta] ?? 'c.detail')}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
