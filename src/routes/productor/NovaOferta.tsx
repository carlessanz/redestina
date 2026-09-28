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

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useConveni } from '../../hooks/useConveni'
import FormulariNovaOferta from '../../components/FormulariNovaOferta'
import type { ConvenioTipo } from '../../types'

export default function NovaOferta() {
  const { t } = useT()
  const navigate = useNavigate()
  const { bloqueja, tipusVigents, tallPassat } = useConveni()
  const organitzacio = useOrganitzacio('productor')
  const productorId = organitzacio?.id ?? null

  // La matriz `convenios_exigidos`, fila `parte = 'entrega'`: qué convenio exige cada
  // modalidad a quien entrega (hoy donació → don_gen; venda y maquila → com). Se lee de la
  // tabla, como en el Mercat, para que cambiar la regla no obligue a tocar esto.
  const [exigits, setExigits] = useState<Record<string, ConvenioTipo[]>>({})
  useEffect(() => {
    let viu = true
    void supabase.from('convenios_exigidos').select('valorizacion, tipo_convenio').eq('parte', 'entrega')
      .then(({ data }) => {
        if (!viu) return
        const mapa: Record<string, ConvenioTipo[]> = {}
        for (const f of (data ?? []) as { valorizacion: string; tipo_convenio: ConvenioTipo }[]) {
          (mapa[f.valorizacion] ??= []).push(f.tipo_convenio)
        }
        setExigits(mapa)
      })
    return () => { viu = false }
  }, [])

  // Antes del corte solo se avisa (la banda de arriba), igual que `exigir_convenio()`; desde
  // el corte, una modalidad cuyo convenio no está vigente no se publica.
  const motiuModalitat = useCallback((modalitat: string): string | null => {
    if (!tallPassat) return null
    const falta = (exigits[modalitat] ?? []).filter((tipus) => !tipusVigents.includes(tipus))
    if (falta.includes('com')) return 'po.cal_conveni_com'
    if (falta.length > 0) return 'po.cal_conveni_don'
    return null
  }, [exigits, tallPassat, tipusVigents])

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
        motiuModalitat={motiuModalitat}
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
