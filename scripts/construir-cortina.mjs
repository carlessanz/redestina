// Empaqueta la cortina (cortina/*.ts) en `middleware.js`, JavaScript plano y sin imports.
//
// POR QUÉ NO ES `middleware.ts`: con el `.ts` el build de Vercel falló (28-09-2026) y el
// despliegue no llegó a publicarse. Vercel compila el middleware con su propio TypeScript, y
// este proyecto importa ficheros con extensión `.ts` (allowImportingTsExtensions), que esa
// compilación no admite. Un `.js` ya empaquetado no le deja nada que compilar.
//
// Uso: node scripts/construir-cortina.mjs   (tests/cortina.test.ts vigila que esté al día)
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

export async function empaqueta() {
  const r = await build({
    stdin: {
      contents: "import { gestiona } from './cortina/cortina.ts'\nexport default function middleware(req) { return gestiona(req) }\n",
      resolveDir: new URL('..', import.meta.url).pathname,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    legalComments: 'none',
  })
  const cap = '// GENERAT per scripts/construir-cortina.mjs a partir de cortina/cortina.ts. NO EDITAR A MÀ.\n'
    + '// La cortina de contrasenya davant de tota la web (AGENTS.md §9).\n'
  return cap + r.outputFiles[0].text
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('../middleware.js', import.meta.url), await empaqueta())
  console.log('middleware.js escrit')
}
