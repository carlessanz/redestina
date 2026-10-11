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
import DialegFirmaConveni from '../../components/DialegFirmaConveni'
import { Button } from '@/components/ui/button'
import type { ConvenioTipo } from '../../types'
import { convenisQueFalten, type Equivalencia } from '../../lib/convenisEquivalents'

export default function NovaOferta() {
  const { t } = useT()
  const navigate = useNavigate()
  const { bloqueja, tipusVigents, tallPassat, recarrega } = useConveni()
  const organitzacio = useOrganitzacio('productor')
  const productorId = organitzacio?.id ?? null

  // La matriz `convenios_exigidos`, fila `parte = 'entrega'`: qué convenio exige cada
  // modalidad a quien entrega (hoy donació → don_gen; venda y maquila → com). Se lee de la
  // tabla, como en el Mercat, para que cambiar la regla no obligue a tocar esto.
  const [exigits, setExigits] = useState<Record<string, ConvenioTipo[]>>({})
  const [equivalents, setEquivalents] = useState<Equivalencia[]>([])
  useEffect(() => {
    let viu = true
    // Los convenios anteriores siguen valiendo para lo que valían (fase 5): sin esto, un
    // `don_gen` vigente no contaría para la donación y el panel bloquearía sin motivo.
    void supabase.from('convenis_equivalents').select('tipo_nou, tipo_antic, valorizacion')
      .then(({ data }) => { if (viu) setEquivalents((data ?? []) as Equivalencia[]) })
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
    const falta = convenisQueFalten(modalitat, exigits[modalitat] ?? [], tipusVigents, equivalents)
    if (falta.length === 0) return null
    // Con un convenio anterior de donación vigente, lo que falta es para vender o maquilar.
    return modalitat === 'donacio' ? 'po.cal_conveni_don' : 'po.cal_conveni_com'
  }, [exigits, tallPassat, tipusVigents, equivalents])

  const [dlgConveni, setDlgConveni] = useState(false)
  // Le falta el Conveni de col·laboració para ALGUNA modalidad (fase 5): normalmente, tiene
  // el convenio anterior de donación y quiere vender. El aviso del panel no sale —para él el
  // convenio ya está «vigent»—, así que el botón para firmarlo va aquí.
  const faltaCol = tallPassat && ['donacio', 'venda', 'maquila'].some((m) => motiuModalitat(m) !== null)

  if (!productorId) {
    return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('po.new_title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('po.new_intro')}</p>
      </div>

      {faltaCol && !bloqueja && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-aviso-fondo p-3 text-sm text-aviso">
          <p className="min-w-0 flex-1">{t('po.col_falta')}</p>
          <Button className="order-1 w-full sm:order-none sm:w-auto" onClick={() => setDlgConveni(true)}>
            {t('pend.sign')}
          </Button>
        </div>
      )}
      <DialegFirmaConveni
        obert={dlgConveni}
        tipusOrg="productor"
        orgId={productorId}
        onTancar={() => setDlgConveni(false)}
        onFirmat={() => { setDlgConveni(false); recarrega() }}
      />

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
