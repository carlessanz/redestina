// `/productor/ofertes/nova` — el alta de oferta desde el panel del productor.
//
// Desde el 21-09-2026 aquí no vive el cuestionario, solo su marco: el cuestionario es
// `components/FormulariNovaOferta`, que se usa también en el alta **asistida** del equipo.
// Se partió por una razón concreta: `productorId` salía de `useOrganitzacio('productor')`,
// que un interno no tiene, así que el equipo no podía publicar en nombre de nadie aunque
// `crear-oferta` ya lo aceptara.
//
// Lo que esta página aporta es lo que la hace del productor: su título, de qué organización
// es la oferta, el bloqueo por convenio de SU organización y a dónde se va al publicar.

import { useNavigate } from 'react-router'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useConveni } from '../../hooks/useConveni'
import FormulariNovaOferta from '../../components/FormulariNovaOferta'

export default function NovaOferta() {
  const { t } = useT()
  const navigate = useNavigate()
  const { bloqueja } = useConveni()
  const organitzacio = useOrganitzacio('productor')
  const productorId = organitzacio?.id ?? null

  if (!productorId) {
    return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('po.new_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('po.new_intro')}</p>
      </div>

      <FormulariNovaOferta
        productorId={productorId}
        bloqueja={bloqueja}
        // La referencia, qué pasa ahora y por dónde seguir los cuenta `BlocPublicada` en
        // el detalle, que además se puede volver a mirar. La confirmación por correo solo
        // se promete si ha salido de verdad.
        onCreada={(r) => navigate(`/productor/ofertes/${r.id}`, {
          state: { publicada: true, correuEnviat: r.confirmacio_email === 'enviat' },
        })}
        onCancel={() => navigate('/productor/ofertes')}
      />
    </div>
  )
}
