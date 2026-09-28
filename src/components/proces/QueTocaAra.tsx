// «Què toca ara»: las cuatro frases con las que cualquier pantalla explica dónde está algo.
//
// La regla de color es la de `PendentsDeTu`: **`aviso` significa «te toca a ti»**, y nada
// más. Un bloque informativo va en `card`; en cuanto se pinta en ámbar, quien mira entiende
// que la pelota está en su tejado, así que usarlo para decorar gastaría la única señal que
// tenemos para eso.
//
// No decide NADA: todo lo que pinta viene de `PuntProces` (`procesOferta.ts` o
// `seguentPas.ts`). Así la misma decisión sirve para los tres paneles y para las fichas del
// equipo, en vez de repetirse —y divergir— en cada pantalla.

import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import type { PuntProces } from '../../lib/procesOferta'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * Lo que este componente lee DE VERDAD de un punto del proceso.
 *
 * `etapa` e `index` no se miran nunca aquí —los usa `PasosProces`, que recibe la escalera
 * aparte—, así que la prop se declara sin `etapa`. Eso deja pintar también los puntos de
 * las máquinas de estado que traen su propio vocabulario (el diagnóstico, F2) sin tener que
 * ampliar `EtapaProces`, que es una unión CERRADA a propósito: si mañana se añade un estado
 * a una tabla de la oferta, el compilador tiene que seguir obligando a decidir qué se
 * cuenta de él (§procesOferta).
 */
export type PuntPintable = Omit<PuntProces, 'etapa'>

export default function QueTocaAra({
  punt,
  compacte = false,
}: {
  punt: PuntPintable
  /** Dentro de otra tarjeta: menos aire, sin el badge de quién. */
  compacte?: boolean
}) {
  const { t } = useT()

  // Una línea que resuelve a «—» (o a su propia clave, si faltara) no se pinta: un hueco en
  // blanco con su margen se lee como un fallo de carga. Las fichas del equipo usan `c.none`
  // justamente para dejar vacíos los huecos que su máquina de estados no llena.
  // Los kilos con separador de miles («1.000», no «1000»). Solo a partir de 1.000: un
  // contador `{n}` que vale 1 tiene que seguir siendo el número 1, que es lo que activa la
  // variante en singular de la clave (§7).
  const varsFormatades = Object.fromEntries(Object.entries(punt.vars).map(([k, v]) => [
    k, typeof v === 'number' && Math.abs(v) >= 1000 ? v.toLocaleString('ca-ES') : v,
  ]))

  const text = (clau: string): string => {
    const v = t(clau, varsFormatades).trim()
    return v === '—' || v === clau ? '' : v
  }

  const titol = text(punt.claus.titol)
  const passa = text(punt.claus.passa)
  const toca = text(punt.claus.toca)
  const qui = text(punt.claus.qui)

  return (
    <div
      className={cn(
        'rounded-xl border',
        compacte ? 'p-3' : 'p-4',
        punt.emToca ? 'border-aviso/30 bg-aviso-fondo' : 'bg-card',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          className={cn(
            'font-titulos font-semibold',
            compacte ? 'text-sm' : 'text-base',
            punt.emToca && 'text-aviso',
          )}
        >
          {titol}
        </h3>
        {!compacte && qui && <Badge variant="outline">{qui}</Badge>}
      </div>

      {passa && <p className="mt-1 text-sm text-foreground">{passa}</p>}
      {toca && (
        <p className={cn('mt-1 text-sm', punt.emToca ? 'font-medium text-foreground' : 'text-muted-foreground')}>
          {toca}
        </p>
      )}

      {punt.enllac && (
        <Button
          asChild
          size="sm"
          variant={punt.emToca ? 'default' : 'outline'}
          className="mt-3 h-11 whitespace-normal md:h-9"
        >
          {/* «Fes-ho ara» solo cuando te toca; si no, «Veure-ho»: con «Res» justo encima,
              «Fes-ho ara» se contradecía. */}
          <Link to={punt.enllac}>
            {t(punt.emToca ? 'proc.a_do' : 'proc.a_see')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      )}

      {/* La nota al margen (hoy, el «producte al camp» de F3). Va en `secondary`, no en
          `aviso`: no es nada que le toque hacer a quien mira —si lo fuera, iría arriba, en
          `toca`—, y gastar el ámbar en información neutra rompería la única señal que
          tenemos para «te toca a ti». */}
      {punt.notaClau && (
        <div className="mt-3 rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
          <p>{t(punt.notaClau)}</p>
          {punt.notaEnllac && (
            <Button asChild size="sm" variant="outline" className="mt-2 h-11 whitespace-normal md:h-8">
              <Link to={punt.notaEnllac}>{t('proc.a_nota')}</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
