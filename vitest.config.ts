/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Configuración de las pruebas, aparte de `vite.config.ts` a propósito.
//
// POR QUÉ UN FICHERO PROPIO Y NO UN BLOQUE `test` EN `vite.config.ts`:
// el de producción monta `VitePWA` con `generateSW`, que en cada arranque genera un service
// worker y un manifest que a una prueba no le sirven de nada y solo cuestan tiempo. Aquí no
// hay ningún plugin: los módulos que se prueban son TypeScript puro.
//
// QUÉ SE PUEDE PROBAR Y QUÉ NO (la razón de que esto sea barato):
// los módulos de negocio de `supabase/functions/_shared/` no tienen ni una referencia a
// `Deno.` ni un solo import `npm:`/`jsr:` — se escribieron así a propósito, y la cabecera de
// `priorizacion.ts` lo dice—, así que **Node los importa tal cual**, sin adaptadores ni mocks
// del runtime. Lo que SÍ está fuera del alcance de Vitest, y seguirá estándolo:
//
//   · `supabase/functions/*/index.ts` — usan `Deno.serve` y los import maps `jsr:`. Los cubren
//     `deno check` (§11) y, en comportamiento, `scripts/comprobar-rls.ts`.
//   · `_shared/pdf/maquetador.ts`, `fuentes.ts` y los renderizadores — importan `npm:pdf-lib`.
//     Lo que sí se prueba de ahí es `bloques.ts` y `lletres.ts`, que son puros y son donde
//     está la lógica que decide lo que dice un documento.
//   · `_shared/whatsapp.ts`, `cors.ts`, `resend.ts` — leen `Deno.env` al cargar el módulo.
//
// El alias `@` tiene que repetirse aquí: media aplicación importa por `@/components/ui/...`
// y sin él las pruebas de `src/` no resuelven.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // `node` por defecto: las tandas 1-3 no tocan el DOM. Las pruebas de componentes
    // declaran `// @vitest-environment jsdom` en su cabecera cuando lleguen.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Sin `globals`: los `import { describe, it, expect } from 'vitest'` son explícitos, que
    // es lo que hace que `tsc` los compruebe sin añadir "vitest/globals" a los tipos.
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'supabase/functions/_shared/**'],
      exclude: ['**/*.d.ts', 'supabase/functions/_shared/pdf/render/**'],
    },
  },
})
