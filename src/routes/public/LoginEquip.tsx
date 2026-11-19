// `/admin` — acceso del equipo interno.
//
// Sin accesos directos y sin enlace al registro: aquí se entra con credenciales y punto.
// Tampoco se enlaza desde la parte pública, pero eso es solo no anunciarlo; lo que de
// verdad protege el panel es RoleGuard y las políticas de la base, no la URL.

import { useLocation } from 'react-router'
import { useT } from '../../lib/i18n'
import { useSessio } from '../../hooks/useSessio'
import { destiValid } from '../../lib/destiLogin'
import { NavegaAlDesti } from '../Comuns'
import LayoutAcces, { ComprovantSessio } from '../../components/LayoutAcces'
import FormulariAcces from '../../components/FormulariAcces'

export default function LoginEquip() {
  const { t } = useT()
  const { session, carregant } = useSessio()
  const location = useLocation()

  if (carregant) return <ComprovantSessio />
  if (session) {
    // El destino guardado (sobrevive a recargas y a la recuperación) manda; si no, el del
    // `state`, validado igual: solo rutas internas (`lib/destiLogin.ts`).
    const desti = destiValid((location.state as { from?: string } | null)?.from)
    return <NavegaAlDesti alternativa={desti ?? '/panell'} />
  }

  return (
    <LayoutAcces>
      <FormulariAcces titol={t('login.title')} subtitol={t('login.subtitle')} />
    </LayoutAcces>
  )
}
