// Sesión cruda: ¿hay token? Nada más.
//
// Es deliberadamente distinto de useAppContext, que resuelve QUIÉN eres (rol,
// organizaciones) con una llamada a la base. Ese otro contexto tiene un fallback que
// simula equipo interno cuando la RPC falla, así que solo puede montarse con sesión ya
// confirmada; este provider, en cambio, envuelve la aplicación entera —incluida la parte
// pública— y por eso no consulta nada.
//
// También es el único sitio donde se escucha PASSWORD_RECOVERY. Los enlaces de
// recuperación y los mágicos aterrizan en la raíz (redirectTo = APP_URL) y supabase-js
// consume los tokens del hash en cualquier ruta; desde que la raíz es una página pública,
// alguien tiene que capturar ese evento y llevar al formulario de nueva contraseña.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface ValorSessio {
  session: Session | null
  /** true hasta que getSession() resuelve: antes de eso no se sabe si hay sesión. */
  carregant: boolean
  /** Se ha entrado por un enlace de recuperación y falta poner la contraseña nueva. */
  esRecovery: boolean
  netejaRecovery: () => void
}

const Ctx = createContext<ValorSessio | null>(null)

export function SessioProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [esRecovery, setEsRecovery] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCarregant(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, nova) => {
      if (evento === 'PASSWORD_RECOVERY') setEsRecovery(true)
      // Se conserva el objeto anterior cuando la sesión es LA MISMA. supabase-js emite
      // varios eventos por token (INITIAL_SESSION, SIGNED_IN al volver a la pestaña,
      // TOKEN_REFRESHED) y cada uno trae un objeto nuevo: guardarlo tal cual cambiaba la
      // identidad del contexto y re-renderizaba la aplicación entera —este provider
      // envuelve la parte pública y la privada— sin que nada hubiera cambiado de verdad.
      // Devolver `prev` hace que React no re-renderice nada.
      setSession((prev) =>
        prev?.access_token === nova?.access_token && prev?.user?.id === nova?.user?.id
          ? prev
          : nova)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const netejaRecovery = useCallback(() => setEsRecovery(false), [])

  const valor = useMemo<ValorSessio>(
    () => ({ session, carregant, esRecovery, netejaRecovery }),
    [session, carregant, esRecovery, netejaRecovery],
  )

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useSessio(): ValorSessio {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSessio debe usarse dentro de <SessioProvider>')
  return v
}
