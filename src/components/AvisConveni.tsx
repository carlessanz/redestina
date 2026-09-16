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
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { AlertTriangle, FileSignature } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useConveni } from '../hooks/useConveni'
import { useAppContext } from '../hooks/useAppContext'
import { signarConveniPropi } from '../lib/pendents'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'

export default function AvisConveni() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const { rolActiu, organitzacio } = useAppContext()
  const { estat, dataTall, avisa, bloqueja } = useConveni()
  const [ocupat, setOcupat] = useState(false)

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

  async function signar() {
    if (ocupat || !organitzacio) return
    setOcupat(true)
    const r = await signarConveniPropi(tipusOrg, organitzacio.id)
    setOcupat(false)
    if (!r.ok) {
      // El mensaje del servidor es el útil («ja l'has signat», «no hi ha plantilla
      // vigent»): un «ha habido un error» dejaría a la persona sin saber qué hacer.
      toast.error(r.missatge === 'pend.err_generic' ? t('c.error') : r.missatge)
      return
    }
    // Misma página pública de firma que el enlace del correo, con el botón de volver.
    navigate(r.data.url_path, { state: { tornar: location.pathname } })
  }

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
      <p className="min-w-0">
        <span className="font-medium">{t(clau)}</span>{' '}
        <span className={bloqueja ? undefined : 'text-muted-foreground'}>{consequencia}</span>
      </p>
      {potSignar && (
        <Button
          size="sm"
          className="ml-auto h-11 shrink-0 whitespace-normal md:h-8"
          disabled={ocupat}
          onClick={() => void signar()}
        >
          {ocupat ? t('avis_conv.signant') : t('avis_conv.signa_ara')}
        </Button>
      )}
    </div>
  )
}
