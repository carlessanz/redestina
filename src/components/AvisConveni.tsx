// El aviso de que falta el convenio, en el panel de productor y de receptor.
//
// POR QUÉ ES UNA BANDA Y NO UNA PANTALLA. La decisión (14-09-2026) fue que el panel se
// siga viendo: quien entra tiene que poder mirar sus ofertas, su histórico y su ficha
// aunque el convenio esté a medias. Lo que no puede es operar, y eso se corta en el botón
// que lo intenta, no en la puerta.
//
// CUATRO MENSAJES, PORQUE SON CUATRO SITUACIONES DISTINTAS y la acción que toca en cada
// una también lo es: sin convenio (que se lo preparen), enviado y sin firmar, devuelto para
// corregir, y firmado pendiente de contrafirma (que espere, no hay nada que hacer).
//
// LOS DOS QUE DEPENDEN DE ELLA LLEVAN ENLACE. Hasta el 14-09-2026 el texto decía «te lo
// hemos enviado por correo» y ahí se acababa: si ese correo se perdió o caducó, la persona
// no tenía ninguna salida dentro de la aplicación. Ahora lleva a su pantalla de documentos,
// donde el botón acuña un enlace propio y abre la página de firma.
//
// El tono cambia con la fecha de corte: antes es un aviso, después es un bloqueo. Ninguno
// de los dos textos inventa la fecha, sale de `data_tall_convenis()`.

import { Link } from 'react-router'
import { AlertTriangle, FileSignature } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useConveni } from '../hooks/useConveni'
import { useAppContext } from '../hooks/useAppContext'
import { cn } from '../lib/utils'

export default function AvisConveni() {
  const { t } = useT()
  const { rolActiu } = useAppContext()
  const { estat, dataTall, avisa, bloqueja } = useConveni()

  if (!avisa) return null

  const clau = estat === 'pendent_firma'
    ? 'avis_conv.pendent'
    : estat === 'retornat'
      ? 'avis_conv.retornat'
      : estat === 'firmat'
        ? 'avis_conv.firmat'
        : 'avis_conv.cap'

  // La pelota está en su tejado: puede firmarlo ahora mismo desde sus documentos.
  const potSignar = estat === 'pendent_firma' || estat === 'retornat'
  const desti = rolActiu === 'receptor' ? '/receptor/documents' : '/productor/documents'

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
        {potSignar && (
          <>
            {' '}
            <Link to={desti} className="font-medium underline underline-offset-2">
              {t('avis_conv.pendent_link')}
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
