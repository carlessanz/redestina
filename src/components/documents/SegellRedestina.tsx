// El sello de Redestina y el trocito de HTML que hay que pegar en una web para enseñarlo.
//
// PARA QUÉ SIRVE. Un certificado de recepción se enseña a un tercero —una memoria anual,
// una subvención, un ayuntamiento—, y en una web eso se hace con un sello que enlaza a la
// página de verificación. Sin esto, la entidad tendría el PDF y ninguna forma de
// demostrarlo en línea salvo colgarlo y pedir que se lo crean.
//
// 🔴 EL SELLO NO ACREDITA NADA POR SÍ MISMO, Y ASÍ SE EXPLICA. Una imagen se copia; lo que
//    vale es el ENLACE, que lleva a `/verificar/<codi>` y es donde el servidor dice si ese
//    número existe, si es el vigente y de qué periodo es. Por eso el fragmento es siempre
//    `<a>` envolviendo al `<img>` y nunca el `<img>` suelto: un sello sin enlace es un
//    dibujo.
//
// ⚠️ La URL es ABSOLUTA (`window.location.origin`): un `/verificar/…` pegado en otra web
//    apuntaría al dominio de esa web. Y el `alt` lleva el texto, porque el SVG no tiene
//    ninguna palabra dentro a propósito (ver `public/segell-redestina.svg`).

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { urlVerificacio } from '../../lib/codiVerificacio'
import { Button } from '@/components/ui/button'

export default function SegellRedestina({ codi, numero }: {
  /** El código de verificación impreso en el PDF, ya formateado (`A1B2-C3D4-…`). */
  codi: string
  /** El número del certificado, solo para el `alt`: es lo que un tercero reconoce. */
  numero: string | null
}) {
  const { t } = useT()
  const [copiat, setCopiat] = useState(false)

  const origen = typeof window !== 'undefined' ? window.location.origin : ''
  const enllac = urlVerificacio(origen, codi)
  const alt = numero ? t('seg.alt_num', { n: numero }) : t('seg.alt')
  const fragment = `<a href="${enllac}" target="_blank" rel="noopener">`
    + `<img src="${origen}/segell-redestina.svg" alt="${alt}" width="120" height="120">`
    + `</a>`

  async function copia() {
    try {
      await navigator.clipboard.writeText(fragment)
      setCopiat(true)
      toast.success(t('seg.copied'))
      window.setTimeout(() => setCopiat(false), 2000)
    } catch {
      // Sin portapapeles —navegador antiguo, o sin permiso— el texto sigue delante y se
      // puede seleccionar a mano: decir que se ha copiado cuando no es cierto sería peor.
      toast.error(t('seg.copy_failed'))
    }
  }

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-start gap-4">
        <img
          src="/segell-redestina.svg"
          alt={alt}
          className="size-20 shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-titulos text-sm font-semibold">{t('seg.title')}</p>
          <p className="text-xs text-muted-foreground">{t('seg.hint')}</p>

          {/* El fragmento, legible y seleccionable aunque el botón de copiar falle.
              `break-all`: es una sola palabra larguísima y a 360 px desbordaría. */}
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs break-all whitespace-pre-wrap text-muted-foreground">
            {fragment}
          </pre>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-11 whitespace-normal md:h-8"
              onClick={() => void copia()}
            >
              {copiat
                ? <Check className="mr-1 size-3.5" aria-hidden />
                : <Copy className="mr-1 size-3.5" aria-hidden />}
              {t('seg.copy')}
            </Button>
            <a
              href={enllac}
              target="_blank"
              rel="noopener"
              className="inline-flex h-11 items-center text-sm underline underline-offset-4 md:h-8"
            >
              {t('seg.preview')}
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
