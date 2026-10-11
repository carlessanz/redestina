// La revisión del certificado de donación por el ofertante (fase 4 de la revisión del
// 08-10-2026). Antes de firmar, la Fundació le enseña los kilos y el valor y le pide que los
// apruebe; si no cuadran, habla con el equipo. Una vez aprobado, el super_admin firma y emite.
//
// Va en ámbar porque es lo único de la tarjeta que le pide algo a quien mira (§6ter: «lo
// que te toca a ti va en aviso»). Aprobado y sin número, una línea neutra.

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { kg } from '../../lib/albarans'
import { euros } from '../../lib/tancamentFormat'
import { refrescaAvisos } from '../../lib/refrescAvisos'
import { useConfirma } from '../DialegConfirma'
import { Button } from '@/components/ui/button'

interface Props {
  tipus: 'anual' | 'periode'
  id: string
  revisioEstat: string | null
  certificat: boolean
  kgTotal: number | string | null
  valorTotal: number | string | null
  /** Solo para el texto: «2026» o «del 01/01 al 30/06». */
  quin: string
  onFet: () => void
}

export default function RevisioCertificat({ tipus, id, revisioEstat, certificat, kgTotal, valorTotal, quin, onFet }: Props) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [ocupat, setOcupat] = useState(false)

  if (certificat) return null
  if (revisioEstat === 'aprovat_ofertant' || revisioEstat === 'aprovat_equip') {
    return <p className="mt-3 text-sm text-muted-foreground" data-testid="revisio-aprovada">{t('rev.aprovat')}</p>
  }
  if (revisioEstat !== 'pendent_revisio') return null

  const aprova = async () => {
    const ok = await confirma({
      titol: t('rev.confirm_t'),
      descripcio: t('rev.confirm_d', { kg: kg(kgTotal), valor: euros(valorTotal), quin }),
      confirmar: t('rev.go'),
    })
    if (!ok) return
    setOcupat(true)
    const { error } = await supabase.rpc('aprovar_certificat_ofertant', { p_id: id, p_tipus: tipus })
    setOcupat(false)
    if (error) { toast.error(textError(t, { missatge: error.message, codi: error.code })); return }
    toast.success(t('rev.ok'))
    refrescaAvisos()
    onFet()
  }

  return (
    <div className="mt-3 space-y-2 rounded-md bg-aviso-fondo p-3 text-sm text-aviso" data-testid="revisio-pendent">
      <p className="font-medium">{t('rev.title')}</p>
      <p>{t('rev.body', { kg: kg(kgTotal), valor: euros(valorTotal), quin })}</p>
      <Button className="h-11 w-full whitespace-normal sm:w-auto md:h-9" disabled={ocupat} onClick={() => void aprova()}>
        {ocupat && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />}
        {t('rev.go')}
      </Button>
      {dialeg}
    </div>
  )
}
