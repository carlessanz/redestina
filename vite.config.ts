import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'
import { gestiona } from './cortina/cortina.ts'

/**
 * La cortina de contraseña también en `npm run dev` (28-09-2026). En Vercel la pone
 * `middleware.js`; Vite no lo ejecuta, así que aquí se engancha la MISMA función
 * (`gestiona()`) al servidor de desarrollo. Así localhost se comporta como producción.
 */
function cortinaDev(): Plugin {
  return {
    name: 'redestina-cortina',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const cos = req.method === 'POST'
            ? await new Promise<Buffer>((ok) => {
              const trossos: Buffer[] = []
              req.on('data', (t: Buffer) => trossos.push(t))
              req.on('end', () => ok(Buffer.concat(trossos)))
            })
            : undefined
          const capcaleres = new Headers()
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') capcaleres.set(k, v)
            else if (Array.isArray(v)) capcaleres.set(k, v.join(', '))
          }
          const resposta = await gestiona(new Request(`http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`, {
            method: req.method, headers: capcaleres, body: cos,
          }))
          if (resposta.headers.get('x-middleware-next') === '1') { next(); return }
          res.statusCode = resposta.status
          // En http://localhost la cookie `Secure` también vale (los navegadores lo tratan
          // como origen seguro), así que no hace falta otra versión para desarrollo.
          resposta.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await resposta.arrayBuffer()))
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

/**
 * Identificador del build (29-09-2026). Va compilado dentro del bundle (`__VERSIO__`) y,
 * a la vez, en `/version.json`, que se pide sin caché: si no coinciden, esa pestaña lleva
 * código de un despliegue anterior (`src/lib/versio.ts`). En Vercel es el SHA del commit;
 * en local, la hora del build.
 */
const VERSIO = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? `local-${Date.now()}`

function fitxerVersio(): Plugin {
  return {
    name: 'redestina-versio',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ versio: VERSIO }) })
    },
  }
}

export default defineConfig({
  define: { __VERSIO__: JSON.stringify(VERSIO) },
  plugins: [
    cortinaDev(),
    fitxerVersio(),
    react(),
    tailwindcss(),
    // PWA instalable. Dos decisiones que importan más que el resto:
    //
    // 1. `autoUpdate` + `cleanupOutdatedCaches`: un service worker mal desplegado se
    //    queda pegado en los dispositivos, y en Vercel cada despliegue cambia el hash
    //    de los assets. Con esto, al recargar se coge la versión nueva sin que nadie
    //    tenga que desinstalar nada.
    //
    // 2. NADA de Supabase se cachea (`NetworkOnly` para *.supabase.co, y las rutas de
    //    API fuera del navigateFallback). Los DATOS siguen siendo 100 % autenticados y
    //    personales: cachear una respuesta de PostgREST en un móvil compartido podría
    //    servirle a la siguiente persona los datos de la anterior. Que ahora haya
    //    landing, accesos y registro públicos no cambia nada de esto: lo público es el
    //    shell estático, que el precache ya sirve igual para cualquier ruta.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'logo-redestina.svg', 'logo-redestina-negativo.svg', 'isotipo-redestina.svg'],
      manifest: {
        name: 'Redestina — Espigoladors',
        short_name: 'Redestina',
        description: 'Canalització d’excedents agrícoles de la Fundació Espigoladors.',
        // La raíz, no una ruta de rol: cada cuenta aterriza en su panel (§6ter).
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ca',
        background_color: '#f5f1ea',
        theme_color: '#4e6b45',
        icons: [
          { src: '/icona-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icona-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icona-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // 🔴 AUTODESTRUCCIÓN (29-09-2026). El service worker ya no aportaba nada —sin red la
      //    aplicación no abre desde la cortina (28-09)— y se había vuelto el motivo de que
      //    el cliente NO VIERA LOS DESPLIEGUES: el de antes del 28-09 servía `index.html`
      //    desde el móvil sin pasar por la red, y el nuevo no llegaba a instalarse porque
      //    su precache pedía `/assets/*.js` sin cookie de la cortina y recibía 401. Con
      //    `selfDestroying`, el `sw.js` (libre de cortina) se instala sin descargar nada,
      //    se da de baja y recarga las pestañas: la siguiente carga ya va a la red.
      //    Lo que queda de «PWA» es el manifest: instalable, sin caché propia.
      selfDestroying: true,
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
