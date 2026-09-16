// Ver un PDF sin salir de la aplicación.
//
// POR QUÉ EXISTE (16-09-2026). Hasta hoy la única forma de mirar un documento era
// descargarlo: `descarregarDocument()` devuelve una URL firmada y el cliente hacía
// `window.open`, que en escritorio abre una pestaña y en la mayoría de navegadores dispara
// la descarga. Para repasar un albarán o un convenio —que es lo que el equipo hace a
// diario— eso significa acumular ficheros en Descargas para mirarlos dos segundos.
//
// ⚠️ SE PUEDE INCRUSTAR PORQUE LA URL LO PERMITE, y eso se comprobó antes de escribir esto,
// no después: `descargar-documento` llama a `createSignedUrl(ruta, 60)` **sin** la opción
// `download`, así que Storage sirve el fichero con `content-type: application/pdf` y **sin**
// `content-disposition: attachment` ni `x-frame-options`. Medido contra producción. Si algún
// día alguien añade esa opción para «forzar el nombre del fichero», este visor deja de
// pintar nada y el fallo parecerá del iframe.
//
// ⚠️ EN MÓVIL NO SE USA EL IFRAME, y no es pereza: iOS Safari no renderiza un PDF dentro de
// un `<iframe>` de forma fiable —enseña la primera página, o nada— y no hay forma de
// detectarlo desde el código. Un visor que a veces sale en blanco es peor que no tenerlo, así
// que en móvil el botón abre el PDF como siempre. El modal es de escritorio, que es donde se
// repasan documentos.
//
// LA CADUCIDAD DE 60 s no es un problema mientras el PDF ya esté cargado: el iframe lo pide
// al abrirse y el navegador lo conserva. Lo que caduca es **volver a pedirlo**, así que el
// botón de recargar del visor no reutiliza la URL: pide una nueva.

import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Download, ExternalLink } from 'lucide-react'

export interface PdfObert {
  url: string
  nombre: string
  /** Para ofrecer la descarga desde el propio visor, sin cerrarlo. */
  documentoId: string
}

interface Props {
  pdf: PdfObert | null
  onTancar: () => void
  /** Descargar el que se está viendo. Lo pasa el hook, que ya sabe hacerlo. */
  onDescarregar: (documentoId: string) => void
}

export default function VisorPdf({ pdf, onTancar, onDescarregar }: Props) {
  const { t } = useT()

  return (
    <Dialog open={pdf !== null} onOpenChange={(v) => { if (!v) onTancar() }}>
      {/* 80 % de la pantalla, como pide el uso: repasar un documento de A4 entero. El
          `max-w-none` es imprescindible — `DialogContent` trae un `max-w` estrecho de serie
          y sin quitarlo el 80 % de ancho no se aplica. `flex flex-col` + `min-h-0` en el
          iframe es lo que hace que el visor ocupe todo el alto que sobra bajo la cabecera. */}
      <DialogContent
        className="flex h-[80vh] w-[80vw] max-w-none flex-col gap-3 p-4 sm:max-w-none"
        showCloseButton
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="truncate text-base">{pdf?.nombre ?? ''}</DialogTitle>
        </DialogHeader>

        {pdf && (
          <iframe
            key={pdf.url}
            src={pdf.url}
            title={pdf.nombre}
            className="min-h-0 w-full flex-1 rounded-md border border-border bg-muted"
          />
        )}

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-11 whitespace-normal md:h-8"
            onClick={() => { if (pdf) window.open(pdf.url, '_blank', 'noopener,noreferrer') }}
          >
            <ExternalLink className="mr-1 size-3.5" aria-hidden />
            {t('doc.open_tab')}
          </Button>
          <Button
            size="sm"
            className="h-11 whitespace-normal md:h-8"
            onClick={() => { if (pdf) onDescarregar(pdf.documentoId) }}
          >
            <Download className="mr-1 size-3.5" aria-hidden />
            {t('doc.download')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
