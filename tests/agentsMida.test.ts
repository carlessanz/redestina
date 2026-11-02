// AGENTS.md se carga ENTERO en cada sesión de Claude Code (CLAUDE.md lo importa). Llegó a
// 681 KB —unos 200.000 tokens, la ventana de contexto entera— y cada sesión del proyecto se
// compactaba antes de empezar (02-11-2026). Desde entonces el canónico es compacto y el detalle
// de cada sección vive en context/<sección>.md. Este test es lo que impide que vuelva a crecer.
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOPE_BYTES = 48 * 1024

describe('AGENTS.md cabe en el contexto', () => {
  it(`no pasa de ${TOPE_BYTES / 1024} KB (el detalle va a context/)`, () => {
    const bytes = statSync(join(RAIZ, 'AGENTS.md')).size
    expect(bytes, `AGENTS.md pesa ${bytes} bytes`).toBeLessThanOrEqual(TOPE_BYTES)
  })

  it('cada fichero de context/ que cita existe', () => {
    const texto = readFileSync(join(RAIZ, 'AGENTS.md'), 'utf-8')
    const citados = [...texto.matchAll(/`context\/([\w-]+\.md)`/g)].map((m) => m[1])
    expect(citados.length).toBeGreaterThan(10)
    for (const f of citados) expect(existsSync(join(RAIZ, 'context', f)), f).toBe(true)
  })

  it('cada context/<sección>.md conserva su cabecera de sección', () => {
    const texto = readFileSync(join(RAIZ, 'AGENTS.md'), 'utf-8')
    const citados = new Set([...texto.matchAll(/`context\/([\w-]+\.md)`/g)].map((m) => m[1]))
    for (const f of citados) {
      const cuerpo = readFileSync(join(RAIZ, 'context', f), 'utf-8')
      expect(/^## /m.test(cuerpo), `${f} sin cabecera ##`).toBe(true)
    }
  })
})
