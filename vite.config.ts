import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
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
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'logo-redestina.svg'],
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
        background_color: '#f9fafd',
        theme_color: '#234C66',
        icons: [
          { src: '/icona-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icona-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icona-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // El shell responde a cualquier ruta (el router es de cliente), pero nunca a
        // las llamadas al backend.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/functions\//, /^\/rest\//, /^\/auth\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
