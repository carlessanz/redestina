// `/signar/:token` — la página pública de firma del convenio.
//
// Desde el 16-09-2026 aquí no vive el formulario, solo su marco: el formulario es
// `components/FirmaConveni`, que se usa también dentro del diálogo del panel. Lo que esta
// página aporta es lo que la hace pública y usable desde un móvil en un camino:
//
//   · NO monta `AppContextProvider` ni nada que exija sesión. Va fuera de `RequireSessio`.
//     El único permiso es el token del correo.
//   · `LayoutAcces` da el marco verde y la tarjeta centrada, igual que `/confirmar/:token`.
//   · **`ample` se queda a false**, incluso en un escritorio: quien llega por el correo
//     puede estar en cualquier pantalla y la columna única con controles de 44 px es lo que
//     hace que se pueda firmar de pie. Las dos columnas son cosa del diálogo, que solo se
//     abre desde dentro de la aplicación.
//
// El «torna al panell» del final lo pinta el propio formulario cuando hay sesión: se llega
// aquí también desde el panel (`acunar_enllac_propi`, §6ter), y acabar de firmar en una
// pantalla sin salida es el final más fácil de arreglar y el más fácil de olvidar.

import { useLocation, useParams } from 'react-router'
import LayoutAcces from '../../components/LayoutAcces'
import FirmaConveni from '../../components/FirmaConveni'
import { Card, CardContent } from '@/components/ui/card'

export default function Signar() {
  const { token } = useParams<{ token: string }>()
  const tornar = (useLocation().state as { tornar?: string } | null)?.tornar ?? '/panell'

  return (
    <LayoutAcces ample>
      <Card>
        <CardContent className="pt-6">
          <FirmaConveni token={token} tornar={tornar} />
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}
