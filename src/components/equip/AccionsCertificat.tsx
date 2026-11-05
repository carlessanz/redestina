// Las tres acciones de un certificado de donación ya emitido: «Veure», «Descarrega» y
// «Envia per correu». Las usan el diálogo del certificado, la tarjeta de la oferta y la
// ficha de la entidad, y por eso viven en un solo sitio.
//
// · Ver y descargar van **solo** por `descargar-documento` (URL firmada de 60 s), con la
//   espera de «Generant…» del hook (`useDescarregaDocument`): un certificado recién emitido
//   tarda unos segundos en tener PDF.
// · «Envia per correu» es el «Reenvia» de `equip/Documents.tsx`, exactamente: con las
//   notificaciones apagadas (§8) es un envío MANUAL —el botón sigue, la confirmación lo dice
//   (`acceptaEnviament`) y viaja `{manual:true}`—; con el correo encendido pregunta igual,
//   porque es un correo que sale a una organización. La lista cerrada de lo que puede salir
//   en manual vive en el servidor (`_shared/enviamentManual.ts`).

import { useEffect, useState } from 'react'
import { Download, Eye, Loader2, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { useCanals } from '../../hooks/useAppContext'
import { motiuCanal } from '../../lib/canals'
import { esperarGeneracio, reenviarDocument } from '../../lib/documents'
import type { Descarregador } from '../../hooks/useDescarregaDocument'
import { useEstatsSignatura } from '../../hooks/useEstatsSignatura'
import { useConfirmaEnviament } from '../DialegEnviament'
import AccionsSignatura from '../AccionsSignatura'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import { Button } from '@/components/ui/button'

export interface DocCertificat {
  id: string
  numero_completo: string | null
  /** `pendiente_fichero` mientras se genera el PDF, `emitido` cuando ya lo hay. */
  estado: string
}

export default function AccionsCertificat({
  doc, descarregador, enviar = false, onCanvi,
}: {
  doc: DocCertificat
  descarregador: Descarregador
  /** «Envia per correu»: solo el equipo (la Edge Function lo exige igualmente). */
  enviar?: boolean
  /**
   * Tras firmar, subir, cerrar o rechazar la firma (circuito de firma, 05-11-2026): la
   * versión vigente puede haber cambiado y quien monta esto la tiene que releer.
   */
  onCanvi?: () => void
}) {
  const { t } = useT()
  const motiuEmail = motiuCanal(useCanals(), 'email')
  const { pregunta, dialeg } = useConfirmaEnviament()
  // El estado de la firma de este certificado (CD/CR). Fail-soft: sin él, no hay badge.
  const { perDoc, recarrega } = useEstatsSignatura([doc.id])
  const sig = perDoc[doc.id] ?? null
  const [enviant, setEnviant] = useState(false)
  // El estado del PDF, vigilado aquí: recién emitido está `pendiente` y el botón de enviar
  // espera a que haya fichero. Polling de 2 s durante 30 s (`esperarGeneracio`), sin Realtime.
  const [estat, setEstat] = useState(doc.estado)
  useEffect(() => {
    setEstat(doc.estado)
    if (doc.estado === 'emitido' || doc.estado === 'error') return
    const control = new AbortController()
    void esperarGeneracio(doc.id, control.signal).then((e) => {
      if (e.resultat !== 'cancellat' && e.estado) setEstat(e.estado)
    })
    return () => control.abort()
  }, [doc.id, doc.estado])
  const ocupat = descarregador.ocupat === doc.id
  const generant = descarregador.generant === doc.id
  // Sin PDF no hay nada que adjuntar: el servidor respondería `sense_fitxer`.
  const motiuEnviar = estat === 'emitido' ? undefined : t('doc.generating')

  async function envia() {
    // Pendiente de firma con trazo: el correo puede llevar el enlace para firmar en línea
    // (marcado por defecto). Con las notificaciones apagadas, el envío es manual (§8).
    const acceptat = await pregunta(motiuEmail, {
      titol: t('doc.resend_title', { num: doc.numero_completo ?? '—' }),
      descripcio: t('cdon.send_desc'),
      confirmar: t('cdon.a_send'),
      ambCasellaSignatura: sig?.estat === 'pendent' && sig.admet_canvas,
    })
    if (!acceptat) return
    setEnviant(true)
    const r = await reenviarDocument(doc.id, acceptat)
    setEnviant(false)
    if (!r.ok) toast.error(t(r.motiuKey))
    else if (r.simulat) toast.info(t('doc.resend_simulat'))
    else toast.success(r.destinatari ? t('doc.resend_ok_to', { email: r.destinatari }) : t('doc.resend_ok'))
  }

  return (
    <span className="flex flex-wrap gap-2">
      <Button
        size="sm" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
        disabled={ocupat}
        onClick={() => void descarregador.mostra(doc.id)}
      >
        <Eye className="mr-1 size-4" aria-hidden />
        {t('doc.view')}
      </Button>
      <Button
        size="sm" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
        disabled={ocupat}
        onClick={() => void descarregador.descarrega(doc.id)}
      >
        {generant
          ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
          : <Download className="mr-1 size-4" aria-hidden />}
        {t('doc.download')}
      </Button>
      {enviar && (
        <BotoAmbMotiu
          size="sm" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
          disabled={enviant || motiuEnviar !== undefined}
          motiu={motiuEnviar}
          onClick={() => void envia()}
        >
          {enviant
            ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
            : <Mail className="mr-1 size-4" aria-hidden />}
          {t('cdon.a_send')}
        </BotoAmbMotiu>
      )}
      {dialeg}
      {/* La firma de la contraparte: su estado y, según quién mire, firmar, subir el firmado,
          o revisarlo y cerrarlo (lo decide `accionsSignatura()`). */}
      {sig && (
        <span className="basis-full">
          <AccionsSignatura sig={sig} onCanvi={() => { void recarrega(); onCanvi?.() }} />
        </span>
      )}
    </span>
  )
}
