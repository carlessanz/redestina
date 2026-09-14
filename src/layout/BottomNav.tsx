// Barra inferior de móvil para los paneles de productor y receptor, que tienen pocas
// secciones. El equipo interno no la usa: con siete secciones no cabe, y ahí manda el
// panel deslizante.
//
// Es hermana flex del contenido (no `fixed`) a propósito: así ninguna pantalla necesita
// padding inferior y el composer del chat nunca queda debajo.

import { NavLink, useLocation } from 'react-router'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import type { Comptador, NavItem } from '../lib/nav'

export default function BottomNav({
  items,
  comptadors = {},
}: {
  items: NavItem[]
  /**
   * Los mismos contadores del menú lateral. Aquí NO se pinta el número: la celda mide
   * ~85 px y ya va justa con la etiqueta (§2), así que un badge con cifra empujaría el
   * texto. Un punto dice lo único que hace falta en una barra de navegación: «aquí
   * dentro hay algo».
   */
  comptadors?: Partial<Record<Comptador, number>>
}) {
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
            <li key={item.to} className="min-w-0 flex-1">
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
                <span className="relative">
                  <item.icon className={cn('size-6 transition-transform', actiu && 'scale-110')} />
                  {item.comptador && (comptadors[item.comptador] ?? 0) > 0 && (
                    <span
                      aria-hidden
                      className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-error"
                    />
                  )}
                </span>
                {/* `truncate` + `w-full`: las etiquetas son largas a propósito —`nav.ts`
                    las eligió únicas entre paneles para que los tooltips del menú
                    plegado no se repitan—, así que no se pueden acortar. Sin recortar,
                    «Els meus interessos» rompía a 2-3 líneas en una celda de ~85px y las
                    cuatro pestañas dejaban de estar alineadas.
                    ⚠️ Y el `truncate` NO actúa por sí solo: el `li` es `flex-1` y un flex
                    item con `min-width: auto` no encoge por debajo de su contenido, así
                    que las celdas pedían más ancho del que había y la última quedaba
                    CORTADA POR EL BORDE de la pantalla. Lo que lo arregla es el `min-w-0`
                    del `li`: con él las cuatro celdas miden exactamente un cuarto y el
                    recorte sale con puntos suspensivos, alineado. Medido a 320 px en
                    català (14-09-2026): productor pedía 347 px y receptor 334; con
                    `min-w-0`, los dos piden 320. */}
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
