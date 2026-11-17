// «Comparteix» una oferta (fase C del punto 3, 17-11-2026, fila 3.7.5 del Excel de la Fundació):
// el texto de la oferta y su foto, en un solo gesto, al WhatsApp o a donde elija quien comparte.
//
// Tres caminos, por este orden:
//   1. El navegador comparte FICHEROS (`navigator.canShare({ files })`, el móvil casi siempre):
//      la hoja de compartir del sistema con la foto como fichero y el texto.
//   2. No hay foto y el navegador comparte texto (`navigator.share`): la hoja con el texto.
//   3. Si no (el escritorio, casi siempre): se copia el texto y se descarga la foto, para
//      pegarlo y adjuntarla a mano.
// La decisión es pura (`comCompartir`) y tiene pruebas; lo que toca el navegador, aparte.

import { copiarAlPortapapeles } from './copiar'

/** Solo se comparte lo que circula: ni un esborrany ni una oferta pendiente de validar. */
export function esCompartible(estado: string | null | undefined): boolean {
  return estado === 'publicada' || estado === 'parcial'
}

export type ComCompartir = 'fitxer' | 'text' | 'copia'

/** Qué camino toca, según lo que hay y lo que sabe hacer el navegador. */
export function comCompartir(args: {
  teFitxer: boolean
  /** `navigator.canShare({ files })` con el fichero de verdad. */
  potFitxers: boolean
  /** Existe `navigator.share`. */
  potText: boolean
}): ComCompartir {
  if (args.teFitxer && args.potFitxers) return 'fitxer'
  if (!args.teFitxer && args.potText) return 'text'
  return 'copia'
}

/** El nombre del fichero de la foto: el producto, sin nada raro, y la extensión de la ruta. */
export function nomFitxerFoto(producte: string | null | undefined, ruta: string): string {
  const ext = (/\.(jpe?g|png|webp)$/i.exec(ruta)?.[1] ?? 'jpg').toLowerCase()
  const base = String(producte ?? 'oferta')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'oferta'
  return `${base}.${ext}`
}

/**
 * Comparte. Devuelve lo que ha pasado: `compartit` (la hoja del sistema), `copiat` (texto copiado
 * y, si había foto, descargada), `cancellat` (la persona cerró la hoja) o `error`. Nunca lanza.
 */
export async function comparteixOferta(
  text: string,
  foto: { url: string; nom: string } | null,
): Promise<'compartit' | 'copiat' | 'cancellat' | 'error'> {
  let fitxer: File | null = null
  if (foto) {
    try {
      const res = await fetch(foto.url)
      if (res.ok) {
        const blob = await res.blob()
        fitxer = new File([blob], foto.nom, { type: blob.type || 'image/jpeg' })
      }
    } catch { /* sin foto: se comparte el texto igual */ }
  }
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const potFitxers = Boolean(fitxer && nav?.canShare && nav.canShare({ files: [fitxer] }))
  const cami = comCompartir({ teFitxer: fitxer !== null, potFitxers, potText: Boolean(nav?.share) })
  if (cami !== 'copia' && nav?.share) {
    try {
      await nav.share(cami === 'fitxer' && fitxer ? { text, files: [fitxer] } : { text })
      return 'compartit'
    } catch (err) {
      // Cerrar la hoja no es un error; cualquier otra cosa cae a copiar.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancellat'
    }
  }
  const ok = await copiarAlPortapapeles(text)
  if (fitxer) descarrega(fitxer)
  return ok ? 'copiat' : 'error'
}

function descarrega(fitxer: File) {
  try {
    const url = URL.createObjectURL(fitxer)
    const a = document.createElement('a')
    a.href = url
    a.download = fitxer.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch { /* si no se puede descargar, el texto ya está copiado */ }
}
