// Contexto de sesión de la app: quién eres, qué paneles tienes y cuál estás mirando.
//
// Una sola llamada a get_my_session_context() (§4bis) al entrar. Si la RPC todavía no
// existe —porque la migración de roles no está desplegada— se cae a un contexto
// degradado de equipo interno, que es exactamente como se ha comportado la app hasta
// ahora. Así el despliegue del frontend y el de la base son independientes.
//
// EL PANEL ACTIVO SE DERIVA DE LA URL, no es estado. Antes era un `useState` que se
// cambiaba a mano, y eso obligaba a mantenerlo en fase con la ruta desde tres sitios
// distintos: el conmutador del menú, el `RoleGuard` (que lo corregía en pleno render) y
// cada `carrega()`. Se desincronizaba de verdad: un `SIGNED_IN` con una cuenta de doble
// rol devolvía el panel activo al preferido y a un receptor se le vaciaba el mercado
// hasta que la guarda lo arreglaba. Derivándolo del pathname siempre están en fase, y
// además se pueden pintar los dos menús a la vez sin que nada tenga que «conmutar».

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { supabase } from '../lib/supabase'
import {
  contextDegradat, mapejaContext, rolDeLaRuta, rolInicial,
  type ContextCru, type ContextSessio, type Organitzacio, type Rol,
} from '../lib/rols'
import { organitzacioActiva } from '../lib/rols'

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
  // Último panel visitado. Ya no manda sobre nada mientras navegas: solo decide qué
  // panel abre `/panell` al entrar.
  const [preferit, setPreferit] = useState<Rol | null>(
    () => localStorage.getItem(CLAU_ROL) as Rol | null,
  )

  const { pathname } = useLocation()
  const rolRuta = rolDeLaRuta(pathname)

  const carrega = useCallback(async () => {
    setCarregant(true)
    const { data: sessio } = await supabase.auth.getSession()
    const usuari = sessio.session?.user
    if (!usuari) {
      setCtx(null)
      setCarregant(false)
      return
    }

    const { data, error } = await supabase.rpc('get_my_session_context')
    let nou: ContextSessio
    if (error || !data) {
      // La RPC no está desplegada todavía (o ha fallado): se sigue como equipo.
      if (error) console.warn('get_my_session_context:', error.message)
      nou = contextDegradat(usuari.id, usuari.email ?? null)
    } else {
      nou = mapejaContext(data as ContextCru)
    }

    setCtx(nou)
    setCarregant(false)
  }, [])

  useEffect(() => {
    void carrega()
    // Al cambiar de cuenta hay que recargar el contexto entero, no solo la sesión.
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT') void carrega()
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

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
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
