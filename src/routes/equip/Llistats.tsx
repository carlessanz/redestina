// Envoltorios de ruta de los tres listados del equipo. Los componentes originales
// (OffersList, ProducersList, EntitiesList) conservan sus props tal cual: aquí solo se
// traduce «abrir detalle» a una navegación.

import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '../../lib/i18n'
import DialegNovaOfertaAssistida from '../../components/equip/DialegNovaOfertaAssistida'
import { Button } from '@/components/ui/button'
import { assegurarContacte } from '../../lib/contactes'
import OffersList from '../../components/OffersList'
import ProducersList from '../../components/ProducersList'
import EntitiesList from '../../components/EntitiesList'

export function Ofertes() {
  const navigate = useNavigate()
  const { t } = useT()
  const [nova, setNova] = useState(false)
  // El alta EN NOMBRE DE un productor, que es donde Sebastián la buscaba (reunión del
  // 05-10-2026): el mismo diálogo que Canalització, sin un segundo formulario. Al crearla
  // se va a su detalle en Ofertes, no al ciclo guiado, porque se ha empezado desde aquí.
  return (
    <>
      <OffersList
        onOpen={(o) => navigate(`/equip/ofertes/${o.id}`)}
        accio={(
          <Button className="h-11 whitespace-normal md:h-9" onClick={() => setNova(true)}>
            {t('canalz.nova_oferta')}
          </Button>
        )}
      />
      <DialegNovaOfertaAssistida
        obert={nova}
        onTancar={() => setNova(false)}
        onCreada={(r) => { setNova(false); navigate(`/equip/ofertes/${r.id}`) }}
      />
    </>
  )
}

export function Productors() {
  const navigate = useNavigate()
  return (
    <ProducersList
      onOpenDetail={(p) => navigate(`/equip/productors/${p.id}`)}
      onNew={() => navigate('/equip/productors/nou')}
      onSendMessage={(phone, name) => {
        void assegurarContacte(phone, name).then(() => navigate(`/equip/missatgeria/${phone}`))
      }}
    />
  )
}

export function Entitats() {
  const navigate = useNavigate()
  return (
    <EntitiesList
      onOpenDetail={(e) => navigate(`/equip/entitats/${e.id}`)}
      onNew={() => navigate('/equip/entitats/nova')}
      onSendMessage={(phone, name) => {
        void assegurarContacte(phone, name).then(() => navigate(`/equip/missatgeria/${phone}`))
      }}
    />
  )
}
