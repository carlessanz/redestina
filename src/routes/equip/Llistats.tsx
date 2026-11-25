// Envoltorio de ruta del listado de ofertas del equipo (`OffersList` conserva sus props: aquí
// solo se traduce «abrir detalle» a una navegación). Los de productores y entidades se
// fundieron en `routes/equip/Entitats.tsx` (plan 1, 1C).

import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import DialegNovaOfertaAssistida from '../../components/equip/DialegNovaOfertaAssistida'
import DialegOperacioRealitzada from '../../components/equip/DialegOperacioRealitzada'
import { Button } from '@/components/ui/button'
import OffersList from '../../components/OffersList'

export function Ofertes() {
  const navigate = useNavigate()
  const { t } = useT()
  const [nova, setNova] = useState(false)
  // Proceso 3.7: una operación que ya pasó fuera del circuito, registrada a posteriori.
  const [realitzada, setRealitzada] = useState(false)
  // Solo quien puede aprobar (Superadmin y Dinamitzador): la RPC exige `pot_aprovar()`.
  const potAprovar = useAppContext().ctx?.potAprovar ?? false
  // El alta EN NOMBRE DE un productor, que es donde Sebastián la buscaba (reunión del
  // 05-10-2026): el mismo diálogo que Canalització, sin un segundo formulario. Al crearla
  // se va a su detalle en Ofertes, no al ciclo guiado, porque se ha empezado desde aquí.
  return (
    <>
      <OffersList
        onOpen={(o) => navigate(`/equip/ofertes/${o.id}`)}
        accio={(
          <div className="flex flex-wrap gap-2">
            {potAprovar && (
              <Button variant="outline" className="h-11 whitespace-normal md:h-8" onClick={() => setRealitzada(true)}>
                {t('opr.boto')}
              </Button>
            )}
            <Button className="h-11 whitespace-normal md:h-8" onClick={() => setNova(true)}>
              {t('canalz.nova_oferta')}
            </Button>
          </div>
        )}
      />
      <DialegNovaOfertaAssistida
        obert={nova}
        onTancar={() => setNova(false)}
        onCreada={(r) => { setNova(false); navigate(`/equip/ofertes/${r.id}`) }}
        // Guardado como esborrany (fase C): a la pestaña donde está.
        onEsborranyDesat={() => { setNova(false); navigate('/equip/ofertes?tab=esborranys') }}
      />
      {/* Queda cerrada: el toast enlaza a su detalle (y está en Ofertes › Històric). */}
      <DialegOperacioRealitzada obert={realitzada} onTancar={() => setRealitzada(false)} />
    </>
  )
}
