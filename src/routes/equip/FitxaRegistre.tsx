// Ficha CRUD de un productor o una entidad, por ruta.
//
// `RecordDetail` es genérico y no se toca: aquí solo se resuelve el registro a partir
// de la URL (`/nou` → alta, `/:id` → edición) y se compone la navegación.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { assegurarContacte } from '../../lib/contactes'
import { ENTIDAD_CAMPOS, PRODUCTOR_CAMPOS } from '../../lib/crudCampos'
import RecordDetail from '../../components/RecordDetail'
import BadgeConveni from '../../components/BadgeConveni'

type Registre = Record<string, unknown> & { id: string }

interface Props {
  tabla: 'productores' | 'entidades'
}

export default function FitxaRegistre({ tabla }: Props) {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [registre, setRegistre] = useState<Registre | null>(null)
  const [carregant, setCarregant] = useState(id !== undefined)

  const esProductor = tabla === 'productores'
  const llista = esProductor ? '/equip/productors' : '/equip/entitats'

  useEffect(() => {
    if (!id) { setRegistre(null); setCarregant(false); return }
    let viu = true
    setCarregant(true)
    void supabase.from(tabla).select('*').eq('id', id).maybeSingle()
      .then(({ data }) => {
        if (!viu) return
        setRegistre((data as Registre) ?? null)
        setCarregant(false)
      })
    return () => { viu = false }
  }, [id, tabla])

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  return (
    <RecordDetail
      tipoKey={esProductor ? 'rec.producer' : 'rec.entity'}
      femenino={!esProductor}
      volverKey={esProductor ? 'nav.producers' : 'nav.entities'}
      tabla={tabla}
      campos={esProductor ? PRODUCTOR_CAMPOS : ENTIDAD_CAMPOS}
      registro={registre}
      nombreKey={esProductor ? 'name' : 'nombre'}
      telefonoKey={esProductor ? 'phone' : 'telefono'}
      onBack={() => navigate(llista)}
      onSaved={() => navigate(llista)}
      avisos={(
        // El estado del convenio y, si no hay ninguno vigente, la nota heredada del Excel
        // marcada como lo que es: papel histórico que NO habilita a operar.
        <BadgeConveni
          tipusOrg={esProductor ? 'productor' : 'entidad'}
          orgId={id ?? null}
          conveniPaper={(registre?.[esProductor ? 'conveni' : 'estat'] as string | null) ?? null}
        />
      )}
      onSendMessage={(phone, name) => {
        void assegurarContacte(phone, name).then(() => navigate(`/equip/missatgeria/${phone}`))
      }}
    />
  )
}
