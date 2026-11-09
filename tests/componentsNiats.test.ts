// Ningún componente de React se define DENTRO de otro (09-11-2026).
//
// `const Seccio = (…) => <section>…</section>` dentro de `NovaEntitat()` creaba un tipo de
// componente nuevo en cada render: React desmontaba la sección entera con cada tecla y el
// campo perdía el foco («cada vez que pongo letra en sección me saca de sección», Taula
// mestra 1.1). Se ve solo al escribir, no en el build ni en los tipos, así que lo vigila esta
// prueba: dentro de una función (línea sangrada), una constante o función con nombre en
// mayúscula que devuelve JSX es un componente anidado.
//
// La comprobación es por texto y deliberadamente estrecha: busca la definición sangrada de
// algo con nombre de componente que abre una función. Si un caso legítimo cae aquí (un
// componente devuelto por un `useMemo`, p. ej.), se saca fuera del componente, que es
// también lo correcto.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fonts(dir: string): string[] {
  const out: string[] = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...fonts(p))
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const NIAT = [
  /^ {2,}const [A-Z][A-Za-z0-9]* = (\([^)]*\)|\(\{[\s\S]*?\}[^)]*\)|[a-z]\w*) =>/,
  /^ {2,}function [A-Z][A-Za-z0-9]*\(/,
]

describe('componentes anidados', () => {
  it('ningún .tsx de src/ define un componente dentro de otro', () => {
    const trobats: string[] = []
    for (const f of fonts('src')) {
      readFileSync(f, 'utf8').split('\n').forEach((linia, i) => {
        if (NIAT.some((re) => re.test(linia))) trobats.push(`${f}:${i + 1}: ${linia.trim()}`)
      })
    }
    expect(trobats).toEqual([])
  })

  it('la regla detecta el caso que rompió «Nova entitat»', () => {
    const cas = "  const Seccio = ({ titol, children }: { titol: string; children: React.ReactNode }) => ("
    expect(NIAT.some((re) => re.test(cas))).toBe(true)
    expect(NIAT.some((re) => re.test('function Seccio({ titol }: { titol: string }) {'))).toBe(false)
  })
})
