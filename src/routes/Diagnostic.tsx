// `/organitzacio/diagnostic` — «El meu diagnòstic»: el diagnóstico operativo del propio
// productor, en SOLO LECTURA (A1, `20270520100000`, D5).
//
// Desde A1 el diagnóstico lo actualiza el equipo de Redestina con la persona (modelo
// asistido) y el productor lo lee: aquí no hay ni un campo ni un botón «Desa». Lo que el
// productor sí edita —sus lugares de recogida, su explotación— está en «La meva
// organització», pestaña Operativa, y la pantalla lo dice con su enlace.
//
// El receptor no tiene diagnóstico (fase 9): su sitio es «El meu perfil de recepció», adonde
// se le redirige.

import { Link, Navigate } from 'react-router'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import ResumDiagnostic from '../components/diagnostic/ResumDiagnostic'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Diagnostic() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const orgs = ctx?.organitzacions ?? []
  const productor = orgs.find((o) => o.tipo === 'productor')

  if (!productor) {
    if (orgs.some((o) => o.tipo === 'entidad')) return <Navigate to="/organitzacio/perfil-recepcio" replace />
    return <p className="text-sm text-muted-foreground">{t('org.cap_fitxa')}</p>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('nav.my_diagnostic')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="diagnostic-qui-actualitza">
          {t('diag.org_qui_actualitza')}{' '}
          <Link to="/organitzacio?pestanya=operativa" className="font-medium text-primary underline-offset-4 hover:underline">
            {t('nav.my_org')}
          </Link>
          .
        </p>
      </CardHeader>
      <CardContent>
        <ResumDiagnostic key={productor.id} productorId={productor.id} veu="extern" />
      </CardContent>
    </Card>
  )
}
