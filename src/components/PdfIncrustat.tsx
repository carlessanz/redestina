// Un PDF incrustado en la página, con un `<iframe>`.
//
// Salió de `VisorPdf` el 05-11-2026: la firma de un documento (`FormulariSignaDocument`) lo
// enseña al lado del formulario, y dos iframes escritos a mano son dos sitios donde olvidar
// lo que hace que esto funcione. Las dos condiciones, explicadas en `VisorPdf`:
//
//   · La URL de `descargar-documento` se sirve **inline** (sin `content-disposition` ni
//     `x-frame-options`): por eso se puede incrustar. Si se le añade `?download=`, el iframe
//     se queda en blanco.
//   · **En móvil no se usa**: iOS Safari no pinta un PDF dentro de un iframe de forma fiable.
//     Quien lo monta decide (con `useIsMobile`) y ofrece abrirlo en una pestaña.

import { cn } from '../lib/utils'

export default function PdfIncrustat({ url, titol, className }: {
  url: string
  titol: string
  className?: string
}) {
  return (
    <iframe
      key={url}
      src={url}
      title={titol}
      className={cn('w-full rounded-md border border-border bg-muted', className)}
    />
  )
}
