// ¿Esta pestaña lleva el código del último despliegue? (29-09-2026)
//
// Cada build compila su identificador (`__VERSIO__`, el SHA del commit en Vercel) y
// publica el mismo valor en `/version.json`, que se pide sin caché. Si no coinciden,
// la pestaña se abrió antes del despliegue y sigue ejecutando el JavaScript viejo:
// `index.html` va sin caché y los assets llevan hash, así que basta con recargar.

declare const __VERSIO__: string

/** La versión con la que se compiló ESTE bundle. `null` en desarrollo y en pruebas. */
export const VERSIO: string | null = typeof __VERSIO__ === 'string' ? __VERSIO__ : null

/**
 * La versión publicada ahora mismo. `null` si no se sabe —sin red, o un 401 de la cortina
 * con la cookie caducada—: ante la duda no se avisa de nada.
 */
export async function versioPublicada(): Promise<string | null> {
  try {
    const r = await fetch('/version.json', { cache: 'no-store' })
    if (!r.ok) return null
    const j: unknown = await r.json()
    const v = (j as { versio?: unknown } | null)?.versio
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/**
 * Retira cualquier service worker y su caché. El `sw.js` que se publica desde el
 * 29-09-2026 ya se autodestruye; esto es la segunda red, para los navegadores que
 * lleguen a cargar el bundle nuevo con uno viejo todavía registrado.
 */
export async function retiraServiceWorkers(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
    await Promise.all(regs.map((r) => r.unregister()))
    if ('caches' in window) {
      const claus = await caches.keys()
      await Promise.all(claus.map((k) => caches.delete(k)))
    }
  } catch {
    // Un navegador que no deja tocarlos (modo privado) no tiene nada que retirar.
  }
}
