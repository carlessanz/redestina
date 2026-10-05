// La banda de «pendent de validació» en el detalle de oferta del equipo (05-10-2026).
//
// La oferta la publicó el productor y todavía no ha salido al Mercat: el equipo la revisa
// —producto, kg, modalidades, franja— y la valida o la rechaza con motivo. Va en tono
// `aviso` porque es trabajo del equipo (§2bis: el ámbar dice «et toca a tu»).
//
// Quien no puede aprobar (`tecnic`) ve los botones en gris con el motivo, no escondidos.

import { useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { rebutjarOferta, validarOferta } from '../../lib/validacioOfertes'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import DialegMotiu from '../DialegMotiu'

export default function ValidacioOferta({
  excedenteId,
  potAprovar,
  onFet,
}: {
  excedenteId: string
  potAprovar: boolean
  onFet: () => void | Promise<unknown>
}) {
  const { t } = useT()
  const [ocupat, setOcupat] = useState(false)
  const [rebutjant, setRebutjant] = useState(false)
  const motiu = potAprovar ? undefined : t('appr.need_approver')

  async function valida() {
    setOcupat(true)
    const res = await validarOferta(excedenteId)
    setOcupat(false)
    if (!res.ok) { toast.error(textError(t, res)); return }
    toast.success(t('val.ok'))
    void refrescaComptadors()
    await onFet()
  }

  async function rebutja(m: string) {
    setOcupat(true)
    const res = await rebutjarOferta(excedenteId, m)
    setOcupat(false)
    if (!res.ok) { toast.error(textError(t, res)); return }
    setRebutjant(false)
    toast.success(t('val.rej_ok'))
    void refrescaComptadors()
    await onFet()
  }

  return (
    <div className="rounded-lg border border-aviso/30 bg-aviso-fondo p-3">
      <p className="text-sm font-medium text-aviso">{t('val.banner')}</p>
      <p className="mt-1 text-sm text-aviso">{t('val.banner_d')}</p>
      {motiu && <p className="mt-1 text-sm text-aviso">{motiu}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <BotoAmbMotiu className="h-11 md:h-9" disabled={!potAprovar || ocupat} motiu={motiu}
          onClick={() => void valida()}>
          {t('val.cta')}
        </BotoAmbMotiu>
        <BotoAmbMotiu className="h-11 md:h-9" variant="outline" disabled={!potAprovar || ocupat} motiu={motiu}
          onClick={() => setRebutjant(true)}>
          {t('val.reject')}
        </BotoAmbMotiu>
      </div>
      <DialegMotiu
        obert={rebutjant}
        onObert={setRebutjant}
        titol={t('val.reject_t')}
        descripcio={t('val.reject_d')}
        etiqueta={t('val.reject_reason')}
        confirmar={t('val.reject')}
        destructiu
        ocupat={ocupat}
        onConfirma={(m) => void rebutja(m)}
      />
    </div>
  )
}
