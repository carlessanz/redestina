// El aviso de que falta el convenio, en el panel de productor y de receptor.
//
// POR QUÉ ES UNA BANDA Y NO UNA PANTALLA. La decisión (14-09-2026) fue que el panel se
// siga viendo: quien entra tiene que poder mirar sus ofertas, su histórico y su ficha
// aunque el convenio esté a medias. Lo que no puede es operar, y eso se corta en el botón
// que lo intenta, no en la puerta.
//
// TRES MENSAJES, PORQUE SON TRES SITUACIONES DISTINTAS y la acción que toca en cada una
// también lo es: sin convenio (que se lo preparen), enviado y sin firmar (que mire su
// correo) y firmado pendiente de contrafirma (que espere, no hay nada que hacer).
//
// El tono cambia con la fecha de corte: antes es un aviso, después es un bloqueo. Ninguno
// de los dos textos inventa la fecha, sale de `data_tall_convenis()`.

import { AlertTriangle, FileSignature } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useConveni } from '../hooks/useConveni'
import { cn } from '../lib/utils'

export default function AvisConveni() {
  const { t } = useT()
  const { estat, dataTall, avisa, bloqueja } = useConveni()

  if (!avisa) return null

  const clau = estat === 'pendent_firma'
    ? 'avis_conv.pendent'
    : estat === 'firmat'
      ? 'avis_conv.firmat'
      : 'avis_conv.cap'

  const consequencia = bloqueja
    ? t('avis_conv.bloquejat')
    : dataTall
      ? t('avis_conv.des_de', { data: dataTall })
      : t('avis_conv.encara_no_bloqueja')

  const Icona = bloqueja ? AlertTriangle : FileSignature

  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
        bloqueja
          ? 'border-error bg-error-fondo text-error'
          : 'border-accent bg-accent/30 text-foreground',
      )}
    >
      <Icona className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-medium">{t(clau)}</span>{' '}
        <span className={bloqueja ? undefined : 'text-muted-foreground'}>{consequencia}</span>
      </p>
    </div>
  )
}
