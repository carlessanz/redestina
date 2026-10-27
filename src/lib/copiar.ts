// Copiar un texto al portapapeles para pegarlo en WhatsApp, un correo o un documento.
//
// Estaba dentro de `OfferDetail` desde julio. Sale aquí (27-10-2026) porque con el plan de
// gestión autónoma hay que copiar en cada paso del ciclo el mensaje que la plataforma habría
// mandado, y dos copias de la estrategia del portapapeles acabarían divergiendo.

/**
 * HTML para el portapapeles: cada línea en su propio <div> (el formato nativo de los editores
 * rich-text, incluido WhatsApp Web). Es más fiable que un único <div> con <br>, que WhatsApp
 * aplana al pegar perdiendo los saltos. Las líneas vacías llevan <br> para no colapsarse.
 */
export function textoAHtmlPortapapeles(texto: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return texto.split('\n').map((l) => `<div>${l === '' ? '<br>' : esc(l)}</div>`).join('')
}

/**
 * Copia `texto` como text/plain (con los saltos reales) y, además, como text/html: algunos
 * destinos (WhatsApp Web, correo, documentos) colapsan el salto de línea suelto al pegar solo
 * texto plano, y con la versión HTML lo conservan. Sin `ClipboardItem`, cae a `writeText`.
 * Nunca lanza: devuelve si se copió.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false
  try {
    if ('write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const item = new ClipboardItem({
        'text/plain': new Blob([texto], { type: 'text/plain' }),
        'text/html': new Blob([textoAHtmlPortapapeles(texto)], { type: 'text/html' }),
      })
      try {
        await navigator.clipboard.write([item])
        return true
      } catch {
        // Algunos navegadores rechazan el HTML: se intenta con el texto solo.
      }
    }
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
