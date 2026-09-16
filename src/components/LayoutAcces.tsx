// Marco visual de las pantallas de acceso (login, registro, nueva contraseña).
//
// Es el que tenía AuthGate cuando era la única puerta de la aplicación: fondo navy a
// pantalla completa, logo encima y tarjeta blanca centrada. Ahora hay cuatro pantallas
// que lo comparten, así que vive aquí.

import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import SelectorIdioma from './SelectorIdioma'

export default function LayoutAcces({
  children,
  ample = false,
}: {
  children: ReactNode
  /** El formulario de registro necesita más ancho que un login de dos campos. */
  ample?: boolean
}) {
  const { t } = useT()

  return (
    // El padding lateral respeta la muesca del iPhone en horizontal, donde 16px no
    // bastan; `max()` deja el valor de siempre en cualquier otro sitio.
    <div
      className="grid min-h-dvh place-items-center bg-primary py-10"
      style={{
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
    >
      <div className={cn('w-full', ample ? 'max-w-md' : 'max-w-sm')}>
        {/* El logo ya enlazaba a la portada, pero **nadie lo lee como un botón**: desde
            /login y /admin no había forma evidente de volver atrás, y quien entra por la
            URL del equipo ni siquiera tiene el «atrás» del navegador. Pedido el
            16-09-2026. Va aquí y no en cada pantalla porque las cuatro comparten marco.
            `h-11` en móvil: es un área táctil de 44 px (§12.34). */}
        <div className="mb-6 flex justify-center">
          <Link
            to="/"
            className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm text-primary-foreground/80 underline-offset-4 hover:text-primary-foreground hover:underline md:h-8"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t('login.back_home')}
          </Link>
        </div>
        <Link to="/" className="block">
          <img src="/logo-redestina-negativo.svg" alt="Redestina" className="mx-auto mb-8 h-11 w-auto" />
        </Link>
        {children}
        <p className="mt-4 text-center text-xs text-primary-foreground/70">{t('login.foot')}</p>
        <div className="mt-1 flex justify-center">
          <SelectorIdioma clar />
        </div>
      </div>
    </div>
  )
}

/** Pantalla de espera mientras se comprueba si hay sesión. Mismo fondo, sin salto visual. */
export function ComprovantSessio() {
  const { t } = useT()
  return (
    <div className="grid min-h-dvh place-items-center bg-primary">
      <p className="text-primary-foreground/80">{t('login.checking')}</p>
    </div>
  )
}
