// «Comparteix» el PDF de un documento (fase 3 de los puntos 4-6, 19-11-2026): el albarán que
// acaba de salir de una recogida, para mandarlo por WhatsApp o por donde quiera quien lo tiene.
//
// El mismo criterio que `compartirOferta.ts`, con una diferencia: aquí siempre hay fichero.
//   1. En el MÓVIL, si el navegador comparte ficheros (`navigator.canShare({ files })`): la hoja
//      de compartir del sistema con el PDF adjunto.
//   2. Si no (el escritorio, o un navegador que no comparte ficheros): se DESCARGA el PDF, para
//      adjuntarlo a mano.
// La decisión es pura (`comCompartirDocument`) y tiene pruebas; lo que toca el navegador, aparte.
//
// ⚠️ La URL es la firmada de 60 s que da `descargar-documento` (nunca una de Storage a mano):
//    se lee al momento y el fichero viaja como `File`, así que nadie recibe un enlace.

export type ComCompartirDocument = 'compartir' | 'descarregar'

/** Qué camino toca, según el dispositivo y lo que sabe hacer el navegador. */
export function comCompartirDocument(args: {
  /** Pantalla de móvil (`useIsMobile`). En escritorio se descarga siempre. */
  esMobil: boolean
  /** `navigator.canShare({ files })` con el PDF de verdad. */
  potFitxers: boolean
}): ComCompartirDocument {
  return args.esMobil && args.potFitxers ? 'compartir' : 'descarregar'
}

/** El nombre del fichero: el que da el servidor, con `.pdf` si no lo lleva. */
export function nomFitxerPdf(nom: string | null | undefined, perDefecte: string): string {
  const base = String(nom ?? '').trim() || perDefecte
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`
}

/**
 * Comparte o descarga un PDF ya resuelto (URL firmada). Devuelve lo que ha pasado:
 * `compartit` (la hoja del sistema), `descarregat`, `cancellat` (la persona cerró la hoja) o
 * `error`. Nunca lanza.
 */
export async function comparteixPdf(
  url: string,
  nom: string,
  esMobil: boolean,
): Promise<'compartit' | 'descarregat' | 'cancellat' | 'error'> {
  let fitxer: File
  try {
    const res = await fetch(url)
    if (!res.ok) return 'error'
    const blob = await res.blob()
    fitxer = new File([blob], nom, { type: 'application/pdf' })
  } catch {
    return 'error'
  }
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const potFitxers = Boolean(nav?.canShare && nav.canShare({ files: [fitxer] }))
  if (comCompartirDocument({ esMobil, potFitxers }) === 'compartir' && nav?.share) {
    try {
      await nav.share({ files: [fitxer], title: nom })
      return 'compartit'
    } catch (err) {
      // Cerrar la hoja no es un error; cualquier otra cosa cae a descargar.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancellat'
    }
  }
  return descarrega(fitxer) ? 'descarregat' : 'error'
}

function descarrega(fitxer: File): boolean {
  try {
    const url = URL.createObjectURL(fitxer)
    const a = document.createElement('a')
    a.href = url
    a.download = fitxer.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return true
  } catch {
    return false
  }
}
