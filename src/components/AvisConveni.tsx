// El aviso de que falta el convenio, en el panel de productor y de receptor.
//
// POR QUÉ ES UNA BANDA Y NO UNA PANTALLA. La decisión (14-09-2026) fue que el panel se
// siga viendo: quien entra tiene que poder mirar sus ofertas, su histórico y su ficha
// aunque el convenio esté a medias. Lo que no puede es operar, y eso se corta en el botón
// que lo intenta, no en la puerta.
//
// CUATRO MENSAJES, PORQUE SON CUATRO SITUACIONES DISTINTAS y la acción que toca en cada
// una también lo es: sin convenio (que lo firme ya), enviado y sin firmar, devuelto para
// corregir, y firmado pendiente de contrafirma (que espere, no hay nada que hacer).
//
// Y DESDE EL 16-09-2026 EL AVISO LLEVA EL BOTÓN, no un enlace a otra pantalla. Hasta hoy
// solo lo llevaban los dos casos en los que el equipo ya había enviado el convenio; el caso
// normal de quien acaba de registrarse —borrador preparado por `registro` y ahí parado— leía
// «encara no tens el conveni signat» y no tenía **nada** que pulsar. `signar_conveni_propi()`
// prepara lo que falte, lo pasa a `pendent_firma` y devuelve el token: un clic, y ya está en
// la página de firma de siempre. Pedido por el cliente: «posa la opció de signar-lo, amb un
// botó directe».
//
// ⚠️ `firmat` NO lleva botón, y es lo correcto: ahí la pelota es del equipo (falta la
//    contrafirma) y ofrecer «signa'l» mandaría a alguien a repetir lo que ya hizo.
//
// El tono cambia con la fecha de corte: antes es un aviso, después es un bloqueo. Ninguno
// de los dos textos inventa la fecha, sale de `data_tall_convenis()`.

import { useState } from 'react'
import { AlertTriangle, FileSignature } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useConveni } from '../hooks/useConveni'
import { useAppContext } from '../hooks/useAppContext'
import { cn } from '../lib/utils'
import DialegFirmaConveni from './DialegFirmaConveni'
import { Button } from '@/components/ui/button'

export default function AvisConveni() {
  const { t } = useT()
  const { rolActiu, organitzacio } = useAppContext()
  const { estat, dataTall, avisa, bloqueja, recarrega } = useConveni()
  const [obert, setObert] = useState(false)

  if (!avisa) return null

  const clau = estat === 'pendent_firma'
    ? 'avis_conv.pendent'
    : estat === 'retornat'
      ? 'avis_conv.retornat'
      : estat === 'firmat'
        ? 'avis_conv.firmat'
        : 'avis_conv.cap'

  // La pelota está en su tejado en todo menos en `firmat`, que espera al equipo.
  const potSignar = estat !== 'firmat' && organitzacio !== null
  const tipusOrg = rolActiu === 'receptor' ? 'entidad' : 'productor'

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
        'mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-4 py-3 text-sm',
        bloqueja
          ? 'border-error bg-error-fondo text-error'
          : 'border-accent bg-accent/30 text-foreground',
      )}
    >
      <Icona className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{t(clau)}</span>{' '}
        <span className={bloqueja ? undefined : 'text-muted-foreground'}>{consequencia}</span>
      </p>
      {potSignar && (
        // En móvil baja a su propia línea: `shrink-0` no deja encoger el botón, así que
        // sin esto el párrafo quedaba en 120 px y 8 líneas a 320 px. Ver `AvisDiagnostic`,
        // que lo sufría peor por llevar además el aspa de descarte.
        <Button
          size="sm"
          className="order-1 h-11 w-full shrink-0 whitespace-normal sm:order-none sm:ml-auto sm:h-8 sm:w-auto"
          onClick={() => setObert(true)}
        >
          {t('avis_conv.signa_ara')}
        </Button>
      )}
      {/* Se firma AQUÍ, sin salir del panel: el diálogo acuña el enlace al abrirse y monta
          el mismo formulario que la página pública (`DialegFirmaConveni`). Antes navegaba
          a `/signar/:token` y eso sacaba de la aplicación. */}
      {organitzacio && (
        <DialegFirmaConveni
          obert={obert}
          tipusOrg={tipusOrg}
          orgId={organitzacio.id}
          onTancar={() => setObert(false)}
          onFirmat={() => { setObert(false); recarrega() }}
        />
      )}
    </div>
  )
}
