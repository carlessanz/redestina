// Pruebas de extremo a extremo (Playwright, transversal I1 del plan del 05-10-2026).
//
// Corren contra `npm run dev` —que apunta al Supabase REMOTO (§7)— con las cuentas de prueba
// de `scripts/data/cuentas-prueba.json` (fuera de git) y la contraseña de la cortina en
// `E2E_CORTINA`. Sin esas dos cosas, cada prueba se SALTA en vez de fallar: no son parte de
// `npm run check`, se lanzan a mano con `npm run test:e2e`.
//
// Dos proyectos: móvil (390 px, el panel del productor y del receptor se usa así) y escritorio.
// Las que ESCRIBEN (crear una oferta, validarla, mostrar interés, aprobar) solo corren con
// `E2E_ESCRIU=1` y siempre con el modo test encendido: nunca emiten numeración legal (la
// emisión solo pasa a la hora de recogida, y estas pruebas no la fijan).
//
// Navegador: el de Playwright, o el que diga `PW_CHROMIUM_PATH` (en el contenedor de Claude
// hay uno preinstalado y no se descarga nada).

import { defineConfig, devices } from '@playwright/test'

const executablePath = process.env.PW_CHROMIUM_PATH || undefined
// Con `E2E_CLON=1` (11-10-2026) las pruebas corren contra el CLON LOCAL de Supabase
// (`npm run dev:local`, en otro puerto para no chocar con un `npm run dev` abierto) y sin
// cortina: es donde pueden escribir de verdad —emitir albaranes, cerrar ofertas— sin tocar
// producción. Sin la variable, todo sigue como antes (contra `npm run dev`).
const CLON = process.env.E2E_CLON === '1'
const baseURL = process.env.E2E_BASE_URL ?? (CLON ? 'http://localhost:5174' : 'http://localhost:5173')

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'mobil', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'escriptori', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: CLON
      ? 'REDESTINA_SENSE_CORTINA=1 npm run dev:local -- --port 5174 --strictPort'
      : 'npm run dev -- --port 5173 --strictPort',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
