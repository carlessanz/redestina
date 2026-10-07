// Contexto de sesión de la app: quién eres, qué paneles tienes y cuál estás mirando.
//
// Una sola llamada a get_my_session_context() (§4bis) al entrar.
//
// 🔴 SI FALLA, NO HAY CONTEXTO: FAIL-CERRADO (07-10-2026). Antes se caía a un «contexto
// degradado» que simulaba equipo interno con todos los permisos —el puente de cuando la
// migración de roles aún no estaba desplegada—, así que un corte de red le enseñaba a
// cualquier cuenta el panel del super_admin. Ahora el provider pinta una pantalla de error
// con «Torna-ho a provar» y «Sortir», y no monta nada de la aplicación hasta tener un
// contexto de verdad. Ver `resolContext()` en `lib/rols.ts`.
//
// EL PANEL ACTIVO SE DERIVA DE LA URL, no es estado. Antes era un `useState` que se
// cambiaba a mano, y eso obligaba a mantenerlo en fase con la ruta desde tres sitios
// distintos: el conmutador del menú, el `RoleGuard` (que lo corregía en pleno render) y
// cada `carrega()`. Se desincronizaba de verdad: un `SIGNED_IN` con una cuenta de doble
// rol devolvía el panel activo al preferido y a un receptor se le vaciaba el mercado
// hasta que la guarda lo arreglaba. Derivándolo del pathname siempre están en fase, y
// además se pueden pintar los dos menús a la vez sin que nada tenga que «conmutar».

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { supabase } from '../lib/supabase'
import {
  resolContext, rolDeLaRuta, rolInicial,
  type ContextSessio, type Organitzacio, type Rol,
} from '../lib/rols'
import { organitzacioActiva } from '../lib/rols'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

const CLAU_ROL = 'redestina-rol'

interface Valor {
  ctx: ContextSessio | null
  carregant: boolean
  /** Panel que se está mirando, deducido de la URL. */
  rolActiu: Rol | null
  organitzacio: Organitzacio | null
  recarrega: () => Promise<void>
}

const Ctx = createContext<Valor | null>(null)

export function AppContextProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<ContextSessio | null>(null)
  const [carregant, setCarregant] = useState(true)
  // La RPC del contexto ha fallado. Mientras valga `true` no se monta la aplicación.
  const [errorCarrega, setErrorCarrega] = useState(false)
  const [reintentant, setReintentant] = useState(false)
  // Último panel visitado. Ya no manda sobre nada mientras navegas: solo decide qué
  // panel abre `/panell` al entrar.
  const [preferit, setPreferit] = useState<Rol | null>(
    () => localStorage.getItem(CLAU_ROL) as Rol | null,
  )

  const { pathname } = useLocation()
  const rolRuta = rolDeLaRuta(pathname)

  // Cada carga lleva un número: si otra más nueva (p. ej. el SIGNED_IN de un acceso directo)
  // arranca mientras esta espera, la vieja no pisa el contexto al terminar.
  const darrera = useRef(0)

  // 🔴 SOLO LA PRIMERA CARGA PUEDE ENCENDER `carregant`, y no es un detalle de eficiencia.
  //
  // `RoleGuard` y `ArrelPerRol` hacen `if (carregant) return <Carregant />`, así que
  // mientras vale `true` el `<Outlet/>` NO está montado: la pantalla entera se desmonta y
  // se vuelve a montar con estado nuevo. Cada recarga del contexto costaba, por tanto, un
  // ciclo completo de peticiones de la pantalla que estuvieras mirando —medido en
  // producción el 22-09-2026: **50 peticiones** para abrir el detalle de una oferta, con
  // `excedentes` 13 veces y la Edge Function `priorizar-entidades` 5, a ~1,4 s cada una—.
  // Y se llevaba por delante cualquier diálogo abierto, porque su `open` es estado local.
  //
  // Una recarga posterior no necesita bloquear nada: ya hay un contexto servido y lo único
  // que puede pasar es que se sustituya por otro. Quien sí lo necesita es la primera, que
  // no tiene qué enseñar todavía.
  const primera = useRef(true)

  // Con qué cuenta se cargó el contexto que hay puesto. Es lo que distingue «han cambiado
  // de usuario» de «supabase-js ha vuelto a emitir SIGNED_IN por lo suyo».
  const usuariCarregat = useRef<string | null>(null)

  const carrega = useCallback(async () => {
    const n = ++darrera.current
    if (primera.current) setCarregant(true)
    const { data: sessio } = await supabase.auth.getSession()
    const usuari = sessio.session?.user
    if (n !== darrera.current) return
    if (!usuari) {
      usuariCarregat.current = null
      primera.current = false
      setErrorCarrega(false)
      setCtx(null)
      setCarregant(false)
      return
    }

    const { data, error } = await supabase.rpc('get_my_session_context')
    if (n !== darrera.current) return
    const r = resolContext(data, error)
    if (!r.ok) {
      // Ni permisos de equipo ni el contexto anterior: el de antes podía ser de OTRA cuenta
      // (esto también corre tras un SIGNED_IN de un usuario distinto).
      console.warn('get_my_session_context:', error?.message ?? 'sense dades')
      usuariCarregat.current = null
      setCtx(null)
      setErrorCarrega(true)
      setCarregant(false)
      return
    }

    usuariCarregat.current = usuari.id
    primera.current = false
    setErrorCarrega(false)
    setCtx(r.ctx)
    setCarregant(false)
  }, [])

  useEffect(() => {
    void carrega()
    // Al cambiar de cuenta hay que recargar el contexto entero, no solo la sesión.
    //
    // ⚠️ `SIGNED_IN` NO significa «alguien acaba de entrar». supabase-js lo emite también
    // al recuperar la sesión del almacenamiento y al volver a la pestaña, así que tratarlo
    // como un cambio de cuenta hacía recargar el contexto una y otra vez sobre el mismo
    // usuario. Con el desmontaje de arriba, cada una de esas emisiones recargaba la
    // pantalla entera. Lo que de verdad hay que mirar es si el usuario es OTRO.
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sessio) => {
      if (evento === 'SIGNED_OUT') { void carrega(); return }
      if (evento !== 'SIGNED_IN') return
      const id = sessio?.user?.id ?? null
      if (id !== null && id === usuariCarregat.current) return
      void carrega()
    })
    return () => sub.subscription.unsubscribe()
  }, [carrega])

  // Recordar dónde se estaba, pero solo si la cuenta tiene ese panel: si no, se guardaría
  // el panel del que la guarda acaba de expulsar y el próximo login abriría ahí.
  useEffect(() => {
    if (!rolRuta || !ctx?.rols.includes(rolRuta)) return
    localStorage.setItem(CLAU_ROL, rolRuta)
    setPreferit(rolRuta)
  }, [rolRuta, ctx])

  const rolActiu = rolRuta ?? (ctx ? rolInicial(ctx, preferit) : null)

  // `rolActiu` es un primitivo a propósito: si aquí entrara el `pathname`, el valor del
  // contexto cambiaría de identidad en cada navegación y se reabrirían los canales de
  // Realtime que dependen de él.
  const valor = useMemo<Valor>(() => ({
    ctx,
    carregant,
    rolActiu,
    organitzacio: ctx ? organitzacioActiva(ctx, rolActiu) : null,
    recarrega: carrega,
  }), [ctx, carregant, rolActiu, carrega])

  const reintenta = useCallback(async () => {
    setReintentant(true)
    try { await carrega() } finally { setReintentant(false) }
  }, [carrega])

  if (errorCarrega && !carregant) {
    return <ErrorCompte reintentant={reintentant} onReintenta={() => void reintenta()} />
  }

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

/**
 * Pantalla de cuando no se ha podido leer quién eres. Va dentro del provider y no como
 * ruta porque **nada** de la aplicación privada debe montarse sin contexto: una ruta más
 * dejaría a `RoleGuard` decidir con `ctx = null`.
 */
function ErrorCompte({ reintentant, onReintenta }: { reintentant: boolean; onReintenta: () => void }) {
  const { t } = useT()
  return (
    <div className="grid min-h-dvh place-items-center bg-primary px-4">
      <div role="alert" className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto size-8 text-error" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">{t('app.ctx_error_title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('app.ctx_error_desc')}</p>
        <Button className="mt-5 h-11 w-full whitespace-normal" disabled={reintentant} onClick={onReintenta}>
          {reintentant ? t('app.ctx_error_retrying') : t('app.ctx_error_retry')}
        </Button>
        <Button
          className="mt-2 h-11 w-full whitespace-normal"
          variant="outline"
          onClick={() => void supabase.auth.signOut({ scope: 'local' })}
        >
          {t('nav.logout')}
        </Button>
      </div>
    </div>
  )
}

export function useAppContext(): Valor {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAppContext debe usarse dentro de <AppContextProvider>')
  return v
}

/**
 * La organización de un tipo concreto. La pantalla **declara** cuál quiere en vez de
 * heredar la del panel activo: así una pantalla de productor no puede acabar leyendo la
 * ficha de la entidad porque el panel activo fuera otro.
 *
 * ⚠️ Devuelve la primera de ese tipo. Una cuenta puede tener varias (`membresias` no
 * tiene UNIQUE por `(user_id, tipo)`) y la segunda es hoy inalcanzable (deuda §12.31).
 */
export function useOrganitzacio(tipus: 'productor' | 'entidad'): Organitzacio | null {
  const { ctx } = useAppContext()
  return ctx?.organitzacions.find((o) => o.tipo === tipus) ?? null
}

/**
 * ¿WhatsApp está activo como canal? (`app_settings.whatsapp_activo`, §8).
 *
 * Viene en el contexto de sesión, así que no cuesta ninguna consulta y lo pueden usar los
 * tres paneles — un productor no puede leer `app_settings` por su cuenta.
 *
 * **Fail-safe encendido**: sin contexto o con una RPC anterior a la migración, `true`. Lo
 * que decide de verdad es el servidor; esto es para no enseñar botones que van a fallar.
 */
export function useWhatsappActiu(): boolean {
  const { ctx } = useAppContext()
  return ctx?.whatsappActiu ?? true
}
