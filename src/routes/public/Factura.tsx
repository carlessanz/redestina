// `/factura/:token` — la página pública del cierre anual.
//
// Desde el 21-09-2026 aquí no vive el formulario, solo su marco: el formulario es
// `components/FormulariFactura`, que se usa también dentro del diálogo asistido del panel
// del equipo. Mismo reparto que `/confirmar/:token` y `/signar/:token`, y por el mismo
// motivo: lo que se sube y la evidencia que deja tienen que ser idénticos por los dos
// caminos.
//
// Lo que esta página aporta es lo que la hace pública:
//
//   · NO monta `AppContextProvider` ni nada que exija sesión. Va fuera de `RequireSessio`.
//     El único permiso es el token del correo con el resumen anual.
//   · `LayoutAcces` da el marco verde y la tarjeta centrada.
//   · **`ample` se queda a false** dentro del formulario: el donante puede estar en un
//     móvil, y la columna única con controles de 44 px es lo que lo hace usable.

import { useParams } from 'react-router'
import LayoutAcces from '../../components/LayoutAcces'
import FormulariFactura from '../../components/FormulariFactura'
import { Card, CardContent } from '@/components/ui/card'

export default function Factura() {
  const { token } = useParams<{ token: string }>()

  return (
    <LayoutAcces ample>
      <Card>
        <CardContent className="pt-6">
          <FormulariFactura token={token} />
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}
