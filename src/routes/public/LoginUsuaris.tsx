// `/login` — acceso de productores y entidades receptoras.
//
// Mismo formulario que el del equipo, otro copy y dos cosas más: el enlace al registro y,
// solo en entornos de prueba, los accesos directos.

import { Link, Navigate, useLocation } from 'react-router'
import { useT } from '../../lib/i18n'
import { useSessio } from '../../hooks/useSessio'
import { accessosActius } from '../../lib/accessosTest'
import LayoutAcces, { ComprovantSessio } from '../../components/LayoutAcces'
import FormulariAcces from '../../components/FormulariAcces'
import AccessosTest from '../../components/AccessosTest'
import AccesAmbCodi from '../../components/AccesAmbCodi'

export default function LoginUsuaris() {
  const { t } = useT()
  const { session, carregant } = useSessio()
  const location = useLocation()

  if (carregant) return <ComprovantSessio />
  // Con sesión, a donde se iba (RequireSessio guarda la URL que se pidió) o al panel.
  if (session) {
    const desti = (location.state as { from?: string } | null)?.from
    return <Navigate to={desti ?? '/panell'} replace />
  }

  return (
    <LayoutAcces>
      <FormulariAcces titol={t('login.user_title')} subtitol={t('login.user_subtitle')} />
      {/* El código de 6 cifras que manda `enviar-acceso`. Va AQUÍ y no en una ruta aparte
          porque es una forma de entrar más, y quien lo tiene ya está buscando la puerta. */}
      <AccesAmbCodi />
      <p className="mt-4 text-center text-sm text-secondary/80">
        {t('login.no_account')}{' '}
        <Link to="/registre" className="font-medium text-secondary underline">
          {t('login.register_link')}
        </Link>
      </p>
      {accessosActius && <AccessosTest />}
    </LayoutAcces>
  )
}
