// Rutas comunes: capa raíz, guarda de sesión, raíz por rol y pantalla de cortesía.
//
// La aplicación tiene ahora dos mitades. La pública (landing, accesos, registro) no sabe
// nada de roles. La privada cuelga toda de RequireSessio, que es el único sitio donde se
// monta AppContextProvider: ese contexto tiene un fallback que simula equipo interno
// cuando la RPC falla, así que dejarlo montar sin sesión confirmada sería regalar el
// panel del equipo a cualquiera que abriera la web.

import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Hourglass, ShieldAlert, ShieldX } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useSessio } from '../hooks/useSessio'
import { AppContextProvider, useAppContext } from '../hooks/useAppContext'
import { rutaArrel, type Rol } from '../lib/rols'
import { Button } from '@/components/ui/button'

function Carregant() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <p className="text-sm text-muted-foreground">…</p>
    </div>
  )
}

/**
 * Capa raíz de todas las rutas. Los enlaces de recuperación aterrizan en la raíz, que
 * desde que hay parte pública es la landing: si llega el evento, hay que desviar al
 * formulario de contraseña nueva desde donde sea.
 */
export function ArrelApp() {
  const { esRecovery } = useSessio()
  const { pathname } = useLocation()
  if (esRecovery && pathname !== '/restablir') return <Navigate to="/restablir" replace />
  return <Outlet />
}

/**
 * Guarda de sesión de toda la parte privada. Sin sesión manda al acceso que corresponde
 * —el del equipo si pedías algo de /equip, el de usuarios si no— y se guarda la URL
 * pedida para volver a ella después de entrar.
 */
export function RequireSessio() {
  const { session, carregant } = useSessio()
  const location = useLocation()

  if (carregant) return <Carregant />
  if (!session) {
    const desti = location.pathname.startsWith('/equip') ? '/admin' : '/login'
    return <Navigate to={desti} replace state={{ from: location.pathname + location.search }} />
  }
  return (
    <AppContextProvider>
      <Outlet />
    </AppContextProvider>
  )
}

/** `/panell` manda a cada cual al suyo. */
export function ArrelPerRol() {
  const { carregant, rolActiu } = useAppContext()
  if (carregant) return <Carregant />
  return <Navigate to={rutaArrel(rolActiu)} replace />
}

/**
 * Guarda por rama del árbol de rutas (no por página): es donde de verdad vive la
 * decisión. Si la cuenta no tiene ese panel, se la manda al suyo en vez de dejarla
 * mirando un error.
 */
export function RoleGuard({ rol }: { rol: Rol }) {
  const { ctx, carregant } = useAppContext()
  if (carregant) return <Carregant />
  if (!ctx) return <Navigate to="/sense-acces" replace />
  // A `/panell`, no a `rutaArrel(rolActiu)`: como el panel activo se deduce de la URL,
  // `rolActiu` ES el rol que estamos denegando, y el redirect apuntaría a sí mismo. No
  // daría un bucle —`Navigate` solo dispara una vez— sino algo peor: contenido en blanco
  // sin ningún error. `/panell` es el único sitio que no pertenece a ningún panel, así
  // que ahí sí se resuelve el destino de verdad.
  if (!ctx.rols.includes(rol)) return <Navigate to="/panell" replace />
  return <Outlet />
}

/**
 * Cuenta sin panel. Son tres situaciones distintas y conviene no confundirlas: un alta
 * del registro público esperando validación, un alta rechazada, o una cuenta que
 * sencillamente no está vinculada a ninguna organización.
 */
export function SenseAcces() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const [motiu, setMotiu] = useState<string | null>(null)

  const pendent = ctx?.registrePendent ?? false
  const rebutjat = ctx?.registreRebutjat ?? false

  useEffect(() => {
    if (!rebutjat) return
    void supabase
      .from('membresias')
      .select('motiu_aprovacio')
      .eq('aprovacio', 'rebutjada')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMotiu((data as { motiu_aprovacio: string | null } | null)?.motiu_aprovacio ?? null))
  }, [rebutjat])

  // Carrera al entrar con un acceso directo: `/panell` puede resolverse con el contexto de
  // ANTES del login (vacío) y mandar aquí; cuando llega el de la cuenta nueva, esta pantalla
  // se quedaba puesta aunque la cuenta sí tuviera panel. Si ya lo tiene, se la devuelve.
  if (ctx && ctx.rols.length > 0) return <Navigate to="/panell" replace />

  const { Icona, classeIcona, titol, desc } = pendent
    ? { Icona: Hourglass, classeIcona: 'text-primary', titol: 'noacc.pending_title', desc: 'noacc.pending_desc' }
    : rebutjat
      ? { Icona: ShieldX, classeIcona: 'text-destructive', titol: 'noacc.rejected_title', desc: 'noacc.rejected_desc' }
      : { Icona: ShieldAlert, classeIcona: 'text-accent', titol: 'noacc.title', desc: 'noacc.desc' }

  return (
    <div className="grid min-h-dvh place-items-center bg-primary px-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-sm">
        <Icona className={`mx-auto size-8 ${classeIcona}`} />
        <h1 className="mt-3 text-lg font-semibold">{t(titol)}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t(desc)}</p>
        {motiu && (
          <p className="mt-3 rounded-lg bg-muted p-3 text-left text-sm">
            <span className="font-medium">{t('noacc.reason')}:</span> {motiu}
          </p>
        )}
        {ctx?.email && <p className="mt-3 text-xs text-muted-foreground">{ctx.email}</p>}
        <Button className="mt-5 w-full" variant="outline" onClick={() => void supabase.auth.signOut()}>
          {t('nav.logout')}
        </Button>
      </div>
    </div>
  )
}
