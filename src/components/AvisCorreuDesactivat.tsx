// La banda de «el correu està apagat» en las pantallas que EMITEN documentos (cierre,
// certificados). Emitir no se desactiva —es un acto legal y el documento queda en el panel—,
// pero el PDF no se manda por correo mientras el canal esté apagado (§8), y eso se tiene que
// saber ANTES de pulsar, no al ver que no ha llegado nada.

import { MailX } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useCanals } from '../hooks/useAppContext'

export default function AvisCorreuDesactivat() {
  const { t } = useT()
  const canals = useCanals()
  if (canals.email) return null
  return (
    <div className="flex items-start gap-3 rounded-lg border border-aviso/30 bg-aviso-fondo p-3 text-sm">
      <MailX className="mt-0.5 size-5 shrink-0 text-aviso" aria-hidden />
      <p className="min-w-0 text-aviso">{t('canal.doc_no_envia_banda')}</p>
    </div>
  )
}
