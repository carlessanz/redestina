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
import { Outlet, useLocation, useMatches } from 'react-router'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import { itemsPlans, navPerRol } from '../lib/nav'
import type { Comptador } from '../lib/nav'
import { buidaComptadors, refrescaComptadors } from '../lib/pendentsEquip'
import { useComptadorsEquip } from '../hooks/useComptadorsEquip'
import { carregaPendents } from '../lib/pendents'
import AppSidebar from './AppSidebar'
import BottomNav from './BottomNav'
import UserMenu from './UserMenu'
import AvisInstallacio from '../components/AvisInstallacio'
import AvisConveni from '../components/AvisConveni'
import AvisRegistreIncomplet from '../components/AvisRegistreIncomplet'
import { useFitxaIncompleta } from '../hooks/useFitxaIncompleta'
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
  // Solo los dos contadores EXTERNOS viven aquí; los del equipo salen del store
  // (`useComptadorsEquip`) y se funden más abajo.
  const [comptadorsExterns, setComptadorsExterns] = useState<Partial<Record<Comptador, number>>>({})

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

  // Contadores del menú del equipo: salen del store de `pendentsEquip.ts`, la misma
  // fuente que la tarjeta «Pendent de l'equip» del tablero, así que las dos cifras no
  // pueden discrepar. Hasta el 14-09-2026 se calculaban aquí con cinco consultas, una vez
  // por sesión, y no se refrescaban nunca: aprobar un registro bajaba la cola pero el
  // badge seguía igual hasta recargar.
  //
  // Se refrescan en cada cambio de ruta —cubre «actúo y navego»— y las pantallas llaman a
  // `refrescaComptadors()` tras cada acción —cubre «actúo y me quedo»—. Sin Realtime: un
  // canal más por sesión para unos números que solo tienen que ser correctos cuando se
  // miran no compensa.
  //
  // Depende de TENER el panel de equipo, no de estar mirándolo: desde que el menú los
  // enseña todos a la vez, el grupo del equipo se ve también desde /productor y sus
  // badges quedarían en blanco justo cuando avisan de algo.
  const esIntern = ctx?.rols.includes('intern') ?? false
  const { pathname } = useLocation()
  useEffect(() => {
    if (!esIntern) { buidaComptadors(); return }
    void refrescaComptadors()
  }, [esIntern, pathname])
  const { comptadors: comptadorsEquip } = useComptadorsEquip()
  const comptadors: Partial<Record<Comptador, number>> = { ...comptadorsEquip, ...comptadorsExterns }
  // Una sola vez, aquí: lo miran la banda de aviso Y el badge del menú, y calculado por
  // separado podrían decir cosas distintas (§6ter, misma razón que `pendents_equip()`).
  const { falten } = useFitxaIncompleta()

  // Lo que las organizaciones de la cuenta tienen pendiente de firmar o confirmar. Va en
  // un efecto aparte del de arriba porque es de las cuentas EXTERNAS, que son justo las
  // que no entran en aquel; y con una sola llamada, porque la base ya sabe repartir por
  // tipo de organización.
  const esExtern = (ctx?.rols.includes('productor') || ctx?.rols.includes('receptor')) ?? false
  useEffect(() => {
    if (!esExtern) return
    let viu = true
    void (async () => {
      const r = await carregaPendents()
      if (!viu || !r.ok) return
      setComptadorsExterns((c) => ({
        ...c,
        pendents_productor: r.data.filter((p) => p.tipo_org === 'productor').length,
        pendents_receptor: r.data.filter((p) => p.tipo_org === 'entidad').length,
      }))
    })()
    return () => { viu = false }
  }, [esExtern])

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <AppSidebar comptadors={comptadors} fitxaIncompleta={falten.length > 0} />
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

        {/* 🔴 `scrollbar-gutter: stable` ES LO QUE QUITA EL SALTO AL NAVEGAR. `main` es el
            que scrollea, así que su barra aparece en las pantallas altas y no en las
            cortas; como el contenido va centrado (`mx-auto`), cada aparición lo desplazaba
            unos 7 px y al cambiar de sección volvía. Reservando el hueco siempre, el ancho
            útil no cambia nunca y la pantalla deja de moverse.
            ⚠️ Va aquí y NO en `html`: el documento no scrollea —el shell es `h-dvh
               overflow-hidden`—, así que ponerlo arriba no reservaría nada. */}
        <main
          className={cn(
            'min-h-0 flex-1 [scrollbar-gutter:stable]',
            handle.fullBleed ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          {handle.fullBleed
            ? <Outlet />
            : (
              // `min-h-full`: una sección que aún no ha cargado deja de desplomar el alto
              // de la página, que era la otra mitad del salto. Con el hueco de la barra ya
              // reservado arriba, esto evita el rebote vertical.
              <div
                className={cn('mx-auto min-h-full w-full py-6', handle.ample ? 'w-[96%] px-2' : 'max-w-6xl px-4')}
                style={{
                  paddingLeft: `max(${handle.ample ? '0.5rem' : '1rem'}, env(safe-area-inset-left))`,
                  paddingRight: `max(${handle.ample ? '0.5rem' : '1rem'}, env(safe-area-inset-right))`,
                }}
              >
                {/* Falta el convenio: se avisa aquí, encima de cualquier pantalla del
                    panel, y no en la puerta. Ver `AvisConveni`. */}
                {rolActiu !== 'intern' && <AvisConveni />}
                {/* Debajo del convenio a propósito: firmar es lo que desbloquea operar, y
                    completar la ficha es lo que hace que firmar salga bien. Ese es el
                    orden en que importan. */}
                {rolActiu !== 'intern' && <AvisRegistreIncomplet falten={falten} />}
                <Outlet />
              </div>
            )}
        </main>

        {/* Solo productor y receptor: el equipo trabaja desde el escritorio y no
            necesita el icono en la pantalla de inicio. El componente ya es `md:hidden`,
            así que la condición de móvil la pone el CSS y no hay parpadeo en el primer
            render (`useIsMobile()` devuelve false hasta que corre su efecto). */}
        {rolActiu !== 'intern' && <AvisInstallacio ambBarraInferior={ambBarraInferior} />}

        {ambBarraInferior && <BottomNav items={itemsBarra} comptadors={comptadors} />}
      </SidebarInset>
    </SidebarProvider>
  )
}
