// «Completa la teva Operativa» — la banda que lo recuerda en el panel externo (A1,
// `20270520100000`). Sustituye a la del diagnóstico, que desde A1 actualiza el equipo (D5).
//
// Sale cuando un productor de la cuenta no tiene NINGÚN lugar de recogida o, desde A4, ningún
// producto habitual (lo decide
// `useOperativaPendent`, que también alimenta la marca del menú). Enlaza a la pestaña
// Operativa de «La meva organització», donde el productor los añade él mismo.
//
// 🔴 VA EN `aviso`, NO EN ROJO. `AvisConveni` y `AvisRegistreIncomplet` son rojas porque lo
//    que anuncian impide operar; esto no corta nada en el panel —se puede publicar una
//    oferta—, solo hace que la recogida haya que concretarla a mano.
//
// 🔴 Y SE PUEDE DESCARTAR, como lo hacía la del diagnóstico: sin descarte sería una banda
//    permanente encima de todas las pantallas. Descartar no es hacerlo: la marca del menú
//    sigue ahí hasta que haya un lugar. La clave de `localStorage` es NUEVA a propósito
//    (`redestina-operativa-descartat`): un descarte de la banda vieja del diagnóstico no
//    puede silenciar esta, que pide otra cosa.
//
// ⚠️ Mismo mecanismo que `AvisInstallacio`: se guarda la FECHA (vuelve a preguntar a los 30
//    días) y el `try/catch` cubre Safari en navegación privada, que lanza al tocar
//    `localStorage`.

import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { MapPin, X } from 'lucide-react'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'

const CLAU_DESCARTAT = 'redestina-operativa-descartat'
const DIES_ESPERA = 30

// Donde NO se pinta: «La meva organització», que es justo donde se arregla.
const RUTES_MUDES = ['/organitzacio']

function descartatFaPoc(): boolean {
  try {
    const quan = Number(localStorage.getItem(CLAU_DESCARTAT))
    return Number.isFinite(quan) && quan > 0 && Date.now() - quan < DIES_ESPERA * 86_400_000
  } catch {
    return false
  }
}

export default function AvisOperativa({
  pendent, motiu = 'llocs',
}: { pendent: boolean; motiu?: 'llocs' | 'productes' | null }) {
  const { t } = useT()
  const { pathname } = useLocation()
  const [amagat, setAmagat] = useState(descartatFaPoc)

  if (!pendent || amagat || RUTES_MUDES.includes(pathname)) return null

  function descarta() {
    try { localStorage.setItem(CLAU_DESCARTAT, String(Date.now())) } catch { /* ver arriba */ }
    setAmagat(true)
  }

  return (
    <div
      role="status"
      data-testid="avis-operativa"
      className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-aviso/30 bg-aviso-fondo px-4 py-3 text-sm text-aviso"
    >
      <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{t('avop.titol')}</span>{' '}
        <span>{t(motiu === 'productes' ? 'avop.text_productes' : 'avop.text')}</span>
      </p>
      {/* En móvil el botón baja a su propia línea (`w-full`): con `shrink-0` en la misma fila
          el texto se quedaba en una palabra por línea a 320 px (ver `AvisConveni`). */}
      <Button asChild size="sm" className="order-1 h-11 w-full shrink-0 whitespace-normal sm:order-none sm:ml-auto sm:h-8 sm:w-auto">
        <Link to="/organitzacio?pestanya=operativa">{t(motiu === 'productes' ? 'avop.anar_productes' : 'avop.anar')}</Link>
      </Button>
      {/* 44 px de área táctil en móvil con `-m-2 p-2`, sin ocupar 44 px de ancho en la fila. */}
      <button
        type="button"
        onClick={descarta}
        aria-label={t('avop.ara_no')}
        title={t('avop.ara_no')}
        className="-m-2 shrink-0 rounded-md p-2 opacity-80 transition-opacity hover:opacity-100"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
