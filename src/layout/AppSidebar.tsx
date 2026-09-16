// Menú lateral vertical y plegable (16rem ↔ 3rem, Ctrl/Cmd+B, estado en cookie).
// En móvil el mismo menú se abre como panel deslizante: lo resuelve el propio
// componente `Sidebar` de shadcn, que por debajo usa un Sheet.
//
// Con varios paneles se enseñan TODOS a la vez, uno debajo de otro, cada uno con su
// cabecera y separados por una línea. Antes había un conmutador en el pie que enseñaba
// uno cada vez, y no funcionaba: cambiaba el panel sin navegar y la guarda de la ruta lo
// revertía en el render siguiente. Ahora el panel activo se deduce de la URL, así que
// basta con que los enlaces estén todos ahí.
//
// Con UN solo panel la interfaz queda exactamente igual que antes —sin cabecera, con el
// nombre de la organización arriba—, que es el caso del 99% de las cuentas.

import { NavLink, useLocation } from 'react-router'
import { Building2, LogOut, Tractor, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import { ORGANITZACIO, navPerRol } from '../lib/nav'
import type { Comptador } from '../lib/nav'
import type { Rol } from '../lib/rols'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton,
  SidebarMenuItem, SidebarSeparator, useSidebar,
} from '@/components/ui/sidebar'

interface Props {
  /** Badges en vivo: se calculan una sola vez en el shell y se reparten aquí. */
  // Reutiliza el tipo en vez de repetir la unión: cuando se añade un contador nuevo,
  // repetirla aquí hacía fallar el build con TS7053 desde el otro extremo del proyecto.
  comptadors: Partial<Record<Comptador, number>>
}

/** Cabecera de cada panel cuando hay más de uno. */
const PANELL: Record<Rol, { clau: string; icona: LucideIcon }> = {
  intern: { clau: 'app.team', icona: Users },
  productor: { clau: 'panel.producer', icona: Tractor },
  receptor: { clau: 'panel.receiver', icona: Building2 },
}

export default function AppSidebar({ comptadors }: Props) {
  const { t } = useT()
  const { ctx, rolActiu, organitzacio } = useAppContext()
  const { setOpenMobile, isMobile } = useSidebar()
  const location = useLocation()

  // `ctx` es null mientras se resuelve la sesión: sin el fallback esto reventaría.
  const rols = ctx?.rols ?? []
  const multi = rols.length > 1
  // El equipo no tiene ficha propia: opera en nombre de otros. Sin esto, la entrada de
  // «La meva organització» le saldría y le llevaría a una pantalla vacía.
  const extern = rols.includes('productor') || rols.includes('receptor')
  // Con varios paneles no hay una organización que poner al lado del logo, y repetir
  // «Redestina» junto a un logo que ya lo dice era ruido: se deja solo el logo. Con un
  // panel sí aporta, porque es el nombre de la organización.
  //
  // ⚠️ Para el equipo el rótulo es **«Admin»** y no «Equip Redestina» (16-09-2026): el logo
  // que tiene al lado ya dice «Redestina», así que la palabra sobraba y lo único que aportaba
  // era decir en qué panel estás. Con un nombre corto, además, cabe empujado a la derecha sin
  // pelearse con el logo.
  const titol = multi ? null : (organitzacio?.nombre ?? t('app.team'))

  // En móvil, elegir una sección cierra el panel; si no, se queda encima del contenido.
  const alNavegar = () => { if (isMobile) setOpenMobile(false) }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 py-4">
        {/* A `/panell`, no a `/`: la raíz es la página pública y sacaría de la aplicación. */}
        {/* Logo a la izquierda y rótulo pegado a la DERECHA del menú: con `gap` los dos
            quedaban juntos en el centro-izquierda y el rótulo parecía parte del logo. El
            `min-w-0` del span es lo que deja actuar al `truncate` cuando el nombre de una
            organización es largo (mismo motivo que la barra inferior, §2). */}
        <NavLink to="/panell" className="flex items-center justify-between gap-2.5 overflow-hidden" onClick={alNavegar}>
          <img src="/logo-redestina-negativo.svg" alt="Redestina" className="h-7 w-auto shrink-0" />
          {titol && (
            <span className="min-w-0 truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
              {titol}
            </span>
          )}
        </NavLink>
      </SidebarHeader>

      {/* Plegado a 3rem, tres paneles son 15 iconos y no caben: `SidebarContent` es
          `overflow-hidden` y la cola quedaría inalcanzable. Se pasa a scroll sin barra
          visible, que en un raíl de 48px sería más estorbo que ayuda. */}
      <SidebarContent className="group-data-[collapsible=icon]:overflow-auto scrollbar-none">
        {rols.map((rol, iRol) => {
          const panell = PANELL[rol]
          return (
            <div key={rol}>
              {/* Solo entre paneles. Es lo único que sobrevive al modo icono: las
                  cabeceras se ocultan y sin la línea serían 8 iconos en fila india. */}
              {multi && iRol > 0 && <SidebarSeparator className="my-1" />}
              {multi && (
                <SidebarGroupLabel
                  className={cn(
                    'mt-2 gap-1.5 text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden',
                    rol !== rolActiu && 'opacity-60',
                  )}
                >
                  <panell.icona />
                  {t(panell.clau)}
                </SidebarGroupLabel>
              )}
              {navPerRol(rol).map((grup, i) => (
                <SidebarGroup key={grup.titolKey ?? `${rol}-${i}`}>
                  {grup.titolKey && (
                    <SidebarGroupLabel className="text-sidebar-foreground/60">
                      {t(grup.titolKey)}
                    </SidebarGroupLabel>
                  )}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {grup.items.map((item) => {
                        const actiu = item.end
                          ? location.pathname === item.to
                          : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
                        const n = item.comptador ? comptadors[item.comptador] ?? 0 : 0
                        return (
                          <SidebarMenuItem key={item.to}>
                            <SidebarMenuButton
                              asChild
                              isActive={actiu}
                              tooltip={t(item.labelKey)}
                              className={cn(item.primari && 'bg-accent/90 text-white hover:bg-accent')}
                            >
                              <NavLink to={item.to} onClick={alNavegar}>
                                <item.icon />
                                <span>{t(item.labelKey)}</span>
                              </NavLink>
                            </SidebarMenuButton>
                            {n > 0 && <SidebarMenuBadge>{n}</SidebarMenuBadge>}
                          </SidebarMenuItem>
                        )
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </div>
          )
        })}

        {/* LA ORGANIZACIÓN, FUERA DE LOS PANELES y después de todos ellos. No pertenece a
            ninguno: con doble rol había dos entradas —«La meva explotació» y «La meva
            entitat»— para una misma organización, con dos nombres distintos. El equipo no
            la ve porque no tiene organización propia: opera en nombre de otros. */}
        {extern && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {ORGANITZACIO[0].items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname.startsWith(item.to)}
                      tooltip={t(item.labelKey)}
                    >
                      <NavLink to={item.to} onClick={alNavegar}>
                        <item.icon />
                        <span>{t(item.labelKey)}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Salir, también aquí. El menú de la persona (arriba a la derecha) lo sigue
          teniendo, con el idioma y la ficha, pero llegar hasta el avatar para cerrar
          sesión obliga a cruzar la pantalla entera. En modo icono queda el icono con
          su tooltip, como el resto. */}
      <SidebarFooter className="pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t('nav.logout')}
              onClick={() => { alNavegar(); void supabase.auth.signOut() }}
            >
              <LogOut />
              <span>{t('nav.logout')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
