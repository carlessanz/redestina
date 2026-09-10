// Barra inferior de móvil para los paneles de productor y receptor, que tienen pocas
// secciones. El equipo interno no la usa: con siete secciones no cabe, y ahí manda el
// panel deslizante.
//
// Es hermana flex del contenido (no `fixed`) a propósito: así ninguna pantalla necesita
// padding inferior y el composer del chat nunca queda debajo.

import { NavLink, useLocation } from 'react-router'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import type { NavItem } from '../lib/nav'

export default function BottomNav({ items }: { items: NavItem[] }) {
  const { t } = useT()
  const location = useLocation()

  return (
    <nav
      aria-label={t('nav.main')}
      className="shrink-0 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex items-stretch justify-between px-1">
        {items.map((item) => {
          const actiu = item.end
            ? location.pathname === item.to
            : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
          return (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                aria-current={actiu ? 'page' : undefined}
                className={cn(
                  'flex min-h-[60px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 transition-colors',
                  'text-muted-foreground active:bg-muted',
                  actiu && 'text-primary',
                )}
                onClick={() => {
                  // Pequeño toque háptico donde el navegador lo permite (Android).
                  try { navigator.vibrate?.(10) } catch { /* iOS no lo soporta */ }
                }}
              >
                <item.icon className={cn('size-6 transition-transform', actiu && 'scale-110')} />
                {/* `truncate` + `w-full`: las etiquetas son largas a propósito —`nav.ts`
                    las eligió únicas entre paneles para que los tooltips del menú
                    plegado no se repitan—, así que no se pueden acortar. Sin recortar,
                    «Els meus interessos» rompía a 2-3 líneas en una celda de ~85px y las
                    cuatro pestañas dejaban de estar alineadas. */}
                <span className="w-full truncate px-0.5 text-center text-nav font-medium leading-none">
                  {t(item.labelKey)}
                </span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
