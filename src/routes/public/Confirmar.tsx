// `/confirmar/:token` — la página pública del albarán.
//
// Desde el 21-09-2026 aquí no vive el formulario, solo su marco: el formulario es
// `components/FormulariConfirmacio`, que se usa también dentro del diálogo asistido del
// panel del equipo. Mismo reparto que `/signar/:token` con `FirmaConveni`, y por el mismo
// motivo: lo que se confirma y la evidencia que deja tienen que ser idénticos por los dos
// caminos.
//
// Lo que esta página aporta es lo que la hace pública y usable desde una finca:
//
//   · NO monta `AppContextProvider` ni nada que exija sesión. Va fuera de `RequireSessio`.
//     El único permiso es el token del correo.
//   · `LayoutAcces` da el marco verde y la tarjeta centrada, igual que `/signar/:token`.
//   · **`ample` se queda a false** dentro del formulario, incluso en un escritorio: esto se
//     rellena de pie, con el camión delante. Las dos columnas son cosa del diálogo.
//
// El «torna al panell» lo pinta el propio formulario cuando hay sesión: aquí se llega
// también desde el panel (`acunar_enllac_propi`, §6ter).

import { useLocation, useParams } from 'react-router'
import LayoutAcces from '../../components/LayoutAcces'
import FormulariConfirmacio from '../../components/FormulariConfirmacio'
import { Card, CardContent } from '@/components/ui/card'

export default function Confirmar() {
  const { token } = useParams<{ token: string }>()
  const tornar = (useLocation().state as { tornar?: string } | null)?.tornar ?? '/panell'

  return (
    <LayoutAcces ample>
      <Card>
        <CardContent className="pt-6">
          <FormulariConfirmacio token={token} tornar={tornar} />
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}
