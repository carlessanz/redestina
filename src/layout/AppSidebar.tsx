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
import { Building2, Tractor, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import { navPerRol } from '../lib/nav'
import type { Rol } from '../lib/rols'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton,
  SidebarMenuItem, SidebarSeparator, useSidebar,
} from '@/components/ui/sidebar'

interface Props {
  /** Badges en vivo: se calculan una sola vez en el shell y se reparten aquí. */
  comptadors: Partial<Record<'aprovacions' | 'missatges', number>>
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
  const titol = multi ? 'Redestina' : (organitzacio?.nombre ?? t('app.team'))

  // En móvil, elegir una sección cierra el panel; si no, se queda encima del contenido.
  const alNavegar = () => { if (isMobile) setOpenMobile(false) }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 py-4">
        {/* A `/panell`, no a `/`: la raíz es la página pública y sacaría de la aplicación. */}
        <NavLink to="/panell" className="flex items-center gap-2.5 overflow-hidden" onClick={alNavegar}>
          <img src="/logo-redestina-negativo.svg" alt="Redestina" className="h-7 w-auto shrink-0" />
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
            {titol}
          </span>
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
      </SidebarContent>
    </Sidebar>
  )
}
