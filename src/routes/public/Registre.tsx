// `/registre` — alta self-service de una organización.
//
// No crea acceso: crea una solicitud. La Edge Function deja la cuenta, la ficha y una
// membresía PENDIENTE, y el equipo la valida desde Aprovacions. Por eso al terminar no se
// inicia sesión automáticamente: no habría nada que enseñar.
//
// El alta la hace el servidor con la clave de servicio porque `anon` no tiene ningún
// privilegio sobre las tablas (§9) y `enable_signup` sigue apagado a propósito.

import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { CheckCircle2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useSessio } from '../../hooks/useSessio'
import LayoutAcces, { ComprovantSessio } from '../../components/LayoutAcces'
import FormulariAlta, { type RolRegistre } from '../../components/FormulariAlta'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Los CTA de la landing dicen «entitat»; dentro se llama «receptor».
 *
 * ⚠️ DEVUELVE UNA LISTA, y desde el 16-09-2026 se pueden marcar LOS DOS. El selector era
 * un `Tabs`, que por definición deja elegir uno: una organización que genera excedente y
 * además recibe —seis de las que hay -- tenía que registrarse dos veces con dos correos
 * distintos y acababa con dos organizaciones que el equipo fusionaba a mano. Con dos
 * casillas, las dos fichas nacen bajo la misma `organizaciones`, que es justo lo que su
 * índice único parcial permite. La URL sigue preseleccionando una sola, que es lo que el
 * enlace de la landing significa.
 */
function rolsDeLaUrl(valor: string | null): RolRegistre[] {
  return valor === 'entitat' || valor === 'receptor' ? ['receptor'] : ['productor']
}

export default function Registre() {
  const { t } = useT()
  const { session, carregant } = useSessio()
  const [params] = useSearchParams()
  const [fet, setFet] = useState(false)
  // La función distingue «alta normal» de «esta organización ya nos consta y estrena papel»
  // (§9). Las dos acaban en la misma pantalla porque las dos esperan al equipo, pero la
  // segunda le debe a la persona el motivo: si no, la espera parece la de todo el mundo.
  const [revisio, setRevisio] = useState(false)

  if (carregant) return <ComprovantSessio />
  if (session && !fet) return <Navigate to="/panell" replace />

  if (fet) {
    return (
      <LayoutAcces ample>
        <Card className="rounded-2xl">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="mx-auto size-8 text-primary" />
            <h1 className="mt-3 text-lg font-semibold">{t('reg.ok_title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('reg.ok_desc')}</p>
            {revisio && (
              <p className="mt-3 rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('reg.ok_revisio')}</p>
            )}
            <Button asChild className="mt-5 w-full">
              <Link to="/login">{t('reg.go_login')}</Link>
            </Button>
          </CardContent>
        </Card>
      </LayoutAcces>
    )
  }

  return (
    <LayoutAcces ample>
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>{t('reg.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('reg.subtitle')}</p>
        </CardHeader>
        <CardContent>
          {/* El formulario es el mismo del alta asistida del equipo (`FormulariAlta`), con
              las casillas RGPD junto a la contraseña (27-10-2026). */}
          <FormulariAlta
            mode="public"
            rolsInicials={rolsDeLaUrl(params.get('rol'))}
            onFet={(r) => { setRevisio(r.revisio); setFet(true) }}
          />
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-sm text-secondary/80">
        {t('reg.have_account')}{' '}
        <Link to="/login" className="font-medium text-secondary underline">{t('login.enter')}</Link>
      </p>
    </LayoutAcces>
  )
}
