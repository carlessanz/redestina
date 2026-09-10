// Shell de la aplicación: menú lateral + barra superior + contenido + barra inferior.
//
// CONTRATO DE ALTURAS (es lo que mantiene viva la Mensajería):
//   · el shell es una columna flex de `h-dvh` con `overflow-hidden`; nadie más vuelve
//     a escribir `h-dvh` en ninguna pantalla
//   · `main` es `min-h-0 flex-1`; scrollea él, salvo en las rutas `fullBleed`
//     (Mensajería), donde no scrollea y el hijo se reparte el alto
//   · la barra inferior es hermana flex `shrink-0`, no `fixed`: así ninguna pantalla
//     necesita padding inferior y el composer del chat nunca queda debajo

import { useEffect, useState } from 'react'
import { Outlet, useMatches } from 'react-router'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import { itemsPlans, navPerRol } from '../lib/nav'
import { countUnanswered } from '../lib/mensajes'
import type { MessageRow } from '../lib/mensajes'
import AppSidebar from './AppSidebar'
import BottomNav from './BottomNav'
import UserMenu from './UserMenu'
import AvisInstallacio from '../components/AvisInstallacio'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

/** Metadatos que cada ruta puede declarar en su `handle`. */
export interface RouteHandle {
  titleKey?: string
  /** La pantalla gestiona su propio alto y scroll (Mensajería). */
  fullBleed?: boolean
  /** Listados anchos, como el 90% que usaba el layout anterior. */
  ample?: boolean
}

export default function AppShell() {
  const { t } = useT()
  const { ctx, rolActiu } = useAppContext()
  const matches = useMatches()
  const [comptadors, setComptadors] = useState<{ aprovacions?: number; missatges?: number; documents?: number }>({})

  const handle = (matches[matches.length - 1]?.handle ?? {}) as RouteHandle
  // La barra inferior enseña SOLO el panel en el que estás, aunque el menú lateral los
  // enseñe todos: con dos paneles serían 8 secciones y ahí abajo no caben. Aquí
  // `rolActiu` es siempre el de la URL —las tres únicas ramas hijas de AppShell son
  // /equip, /productor y /receptor—, así que nunca pasa de 4.
  const grups = navPerRol(rolActiu)
  const items = itemsPlans(grups)
  // La barra inferior reparte el ancho a partes iguales: a 360 px, cinco entradas
  // desbordan hasta 94 px con las etiquetas en catalán (medido). Las marcadas
  // `barra: false` se quedan solo en el menú lateral. Ver el comentario de `NavItem`.
  const itemsBarra = items.filter((i) => i.barra !== false)
  const ambBarraInferior = rolActiu !== 'intern' && itemsBarra.length > 0 && itemsBarra.length <= 4

  // Contadores del menú del equipo. Se calculan una vez aquí y se reparten, para no
  // repetir la consulta en cada sección.
  //
  // Depende de TENER el panel de equipo, no de estar mirándolo: desde que el menú los
  // enseña todos a la vez, el grupo del equipo se ve también desde /productor y sus
  // badges quedarían en blanco justo cuando avisan de algo. Además es un booleano
  // estable, así que la consulta —que se trae todos los wa_messages, deuda §12.5— deja
  // de relanzarse cada vez que se cruza de un panel a otro.
  const esIntern = ctx?.rols.includes('intern') ?? false
  useEffect(() => {
    if (!esIntern) { setComptadors({}); return }
    let viu = true
    void (async () => {
      const [respostes, registres, missatges, documents] = await Promise.all([
        supabase.from('oferta_respuestas')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'acceptada').eq('aprovacio', 'pendent'),
        // Altas del registro público sin validar: la otra cola de la misma pantalla.
        // Si la migración no está aplicada, `count` llega null y cuenta 0: el badge no
        // rompe el menú por una columna que todavía no existe.
        supabase.from('membresias')
          .select('id', { count: 'exact', head: true })
          .eq('aprovacio', 'pendent'),
        supabase.from('wa_messages').select('contact_phone, direction, created_at'),
        // Documentos cuyo PDF no se ha podido generar. El job los reintenta solo cada
        // 5 minutos hasta 5 veces, así que lo que sigue en `error` es lo que ya nadie
        // va a arreglar sin mirarlo.
        supabase.from('documentos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'error'),
      ])
      if (!viu) return
      const pendents = countUnanswered((missatges.data as MessageRow[]) ?? [])
      setComptadors({
        aprovacions: (respostes.count ?? 0) + (registres.count ?? 0),
        missatges: Object.values(pendents).reduce((s, n) => s + n, 0),
        documents: documents.count ?? 0,
      })
    })()
    return () => { viu = false }
  }, [esIntern])

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <AppSidebar comptadors={comptadors} />
      <SidebarInset className="flex h-dvh min-h-0 flex-col overflow-hidden">
        {/* El `env(safe-area-inset-*)` lateral solo hace algo en iPhone con muesca EN
            HORIZONTAL, donde el recorte se come ~44px por cada lado y el `px-3` no
            llega. `max()` lo deja en el padding de siempre en todo lo demás. */}
        <header
          className="flex h-14 shrink-0 items-center gap-2 border-b bg-card"
          style={{
            paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
            paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
          }}
        >
          {/* `size-9` en vez del `size-7` de shadcn: en móvil es la única entrada al
              menú lateral completo, y 28px es poco para un pulgar. */}
          <SidebarTrigger className="-ml-1 size-9" />
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold md:text-base">
            {handle.titleKey ? t(handle.titleKey) : ''}
          </h1>
          {ctx?.degradat && (
            <span
              className="hidden rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground sm:inline"
              title={t('app.degraded_hint')}
            >
              {t('app.degraded')}
            </span>
          )}
          <UserMenu />
        </header>

        <main className={cn('min-h-0 flex-1', handle.fullBleed ? 'overflow-hidden' : 'overflow-y-auto')}>
          {handle.fullBleed
            ? <Outlet />
            : (
              <div
                className={cn('mx-auto w-full py-6', handle.ample ? 'w-[96%] px-2' : 'max-w-6xl px-4')}
                style={{
                  paddingLeft: `max(${handle.ample ? '0.5rem' : '1rem'}, env(safe-area-inset-left))`,
                  paddingRight: `max(${handle.ample ? '0.5rem' : '1rem'}, env(safe-area-inset-right))`,
                }}
              >
                <Outlet />
              </div>
            )}
        </main>

        {/* Solo productor y receptor: el equipo trabaja desde el escritorio y no
            necesita el icono en la pantalla de inicio. El componente ya es `md:hidden`,
            así que la condición de móvil la pone el CSS y no hay parpadeo en el primer
            render (`useIsMobile()` devuelve false hasta que corre su efecto). */}
        {rolActiu !== 'intern' && <AvisInstallacio ambBarraInferior={ambBarraInferior} />}

        {ambBarraInferior && <BottomNav items={itemsBarra} />}
      </SidebarInset>
    </SidebarProvider>
  )
}
