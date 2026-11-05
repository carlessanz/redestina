// `/signar-document/:token` — la página pública de firma de un documento (CD, CR, REC, ENT),
// desde el 05-11-2026.
//
// Es el marco y nada más: el formulario es `components/FormulariSignaDocument`, el mismo que
// la pestaña «Signa aquí» del panel. Lo que esta página aporta es lo que la hace pública y
// usable desde un móvil:
//
//   · NO monta `AppContextProvider` ni nada que exija sesión: va fuera de `RequireSessio`.
//     El único permiso es el token del correo («Envia per correu» con el enlace, 30 días).
//   · `LayoutAcces ample` da el marco verde y la tarjeta ancha, como `/signar/:token`.
//   · El formulario va con `ample = false`: una sola columna con controles de 44 px, que es
//     lo que se puede firmar de pie. En escritorio el PDF se incrusta; en móvil, no.

import { useLocation, useParams } from 'react-router'
import LayoutAcces from '../../components/LayoutAcces'
import FormulariSignaDocument from '../../components/FormulariSignaDocument'
import { Card, CardContent } from '@/components/ui/card'

export default function SignarDocument() {
  const { token } = useParams<{ token: string }>()
  const tornar = (useLocation().state as { tornar?: string } | null)?.tornar ?? '/panell'

  return (
    <LayoutAcces ample>
      <Card>
        <CardContent className="pt-6">
          <FormulariSignaDocument token={token} tornar={tornar} />
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}
