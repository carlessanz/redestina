// Rutas comunes: capa raíz, guarda de sesión, raíz por rol y pantalla de cortesía.
//
// La aplicación tiene ahora dos mitades. La pública (landing, accesos, registro) no sabe
// nada de roles. La privada cuelga toda de RequireSessio, que es el único sitio donde se
// monta AppContextProvider. Ese contexto es fail-cerrado desde el 07-10-2026 (si la RPC
// falla no concede nada y enseña una pantalla de error), pero sigue sin tener sentido
// montarlo sin sesión confirmada: no hay a quién preguntar.

import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Hourglass, ShieldAlert, ShieldX } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { esborraDesti, guardaDesti, llegeixDesti } from '../lib/destiLogin'
import { useSessio } from '../hooks/useSessio'
import { useVersioNova } from '../hooks/useVersioNova'
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
  useVersioNova()
  if (esRecovery && pathname !== '/restablir') return <Navigate to="/restablir" replace />
  return <Outlet />
}

/**
 * Guarda de sesión de toda la parte privada. Sin sesión manda al acceso que corresponde
 * —el del equipo si pedías algo de /equip, el de usuarios si no— y se guarda la URL
 * pedida para volver a ella después de entrar: en `state.from`, como siempre, y además en
 * `sessionStorage` (`lib/destiLogin.ts`), que sobrevive a una recarga, al enlace de primer
 * acceso y a la recuperación de contraseña (fase 4 de los puntos 4-6, Excel 4.4).
 *
 * ⚠️ Si la sesión se acaba de CERRAR en esta pestaña, no se guarda: la pantalla de la que se
 *    sale no es un destino, y quien entre después puede ser otra cuenta.
 */
export function RequireSessio() {
  const { session, carregant, haSortit } = useSessio()
  const location = useLocation()

  if (carregant) return <Carregant />
  if (!session) {
    const desti = location.pathname.startsWith('/equip') ? '/admin' : '/login'
    const from = location.pathname + location.search
    return <AlAcces a={desti} from={from} guarda={!haSortit} />
  }
  return (
    <AppContextProvider>
      <Outlet />
    </AppContextProvider>
  )
}

/** Guarda el destino (en un efecto, no en pleno render) y manda a la puerta de entrada. */
function AlAcces({ a, from, guarda }: { a: string; from: string; guarda: boolean }) {
  useEffect(() => { if (guarda) guardaDesti(from) }, [guarda, from])
  return <Navigate to={a} replace state={{ from }} />
}

/**
 * Lleva al destino guardado al entrar, si lo hay y es interno; si no, a `alternativa`. Lo
 * usan las puertas de entrada (`/login`, `/admin`, la landing) y `/panell`.
 *
 * Se lee al montar (lectura pura, aguanta el doble render del modo estricto) y se BORRA en un
 * efecto: un destino se consume una sola vez, y si la cuenta no tiene ese panel, `RoleGuard`
 * la manda al suyo sin que el destino vuelva a dispararse.
 */
export function NavegaAlDesti({ alternativa }: { alternativa: string }) {
  // `alternativa` la pone el código (no viene de fuera): no se valida, y puede ser una ruta de
  // entrada (`/sense-acces` desde `/panell`), que como destino guardado no valdría.
  const [desti] = useState(() => llegeixDesti() ?? alternativa)
  useEffect(() => { esborraDesti() }, [])
  return <Navigate to={desti} replace />
}

/** `/panell` manda a cada cual al suyo. */
export function ArrelPerRol() {
  const { carregant, rolActiu } = useAppContext()
  if (carregant) return <Carregant />
  // Un destino pendiente (un enlace directo pedido antes de entrar) manda sobre la raíz.
  return <NavegaAlDesti alternativa={rutaArrel(rolActiu)} />
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
  if (!ctx.rols.includes(rol)) {
    // Con algún panel, se dice por qué no se ve lo pedido (un enlace de otro panel, típico de un
    // mensaje reenviado). Sin ninguno, `/panell` ya acaba en «sense accés», que lo explica.
    return ctx.rols.length > 0 ? <AvisAltrePanell /> : <Navigate to="/panell" replace />
  }
  return <Outlet />
}

/** El aviso de «este enlace es de otro panel» y, a la vez, al propio. */
function AvisAltrePanell() {
  const { t } = useT()
  // Con `id`: el doble efecto del modo estricto no lo duplica.
  useEffect(() => { toast.warning(t('acces.altre_panell'), { id: 'acces-altre-panell' }) }, [t])
  return <Navigate to="/panell" replace />
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
      : { Icona: ShieldAlert, classeIcona: 'text-muted-foreground', titol: 'noacc.title', desc: 'noacc.desc' }

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
        <Button className="mt-5 w-full" variant="outline" onClick={() => void supabase.auth.signOut({ scope: 'local' })}>
          {t('nav.logout')}
        </Button>
      </div>
    </div>
  )
}
