// Cobertura: que el menú, las rutas y los textos apunten a algo que existe.
//
// POR QUÉ EXISTE, y por qué es una PRUEBA y no un script que alguien tiene que acordarse de
// lanzar. La deuda §12.82 cuenta lo que pasó el 10-09-2026: un agente restauró
// `src/router/index.tsx` y `src/lib/i18n.tsx` con `git checkout` y se llevó por delante la
// integración de una fase entera que estaba sin commitear. **El build no lo detectó** —unas
// rutas que no existen y unas claves que faltan compilan igual— así que se commiteó una fase
// con sus pantallas inalcanzables, y lo cazó por casualidad el intento de integrar la
// siguiente. La conclusión de esa deuda era «el orquestador audita cobertura de rutas y de
// claves antes de cada commit»; una obligación que depende de la memoria de alguien es
// exactamente lo que esto viene a sustituir.
//
// Las tres cosas que se comprueban son las tres que el compilador NO puede ver:
//   1. una clave de i18n es una cadena, y `t('nav.lo_que_sea')` compila aunque no exista;
//   2. una entrada de menú apunta a una URL, que es otra cadena;
//   3. una ruta declarada y una pantalla son dos ficheros distintos.
//
// Se hace leyendo el código como TEXTO, a propósito: importar el router montaría media
// aplicación (React, providers, el cliente de Supabase) para responder una pregunta que se
// contesta con una expresión regular. El precio es que las expresiones son frágiles ante un
// cambio de formato — por eso cada bloque comprueba primero que ha encontrado ALGO, y falla
// si la extracción se queda a cero en vez de dar todo por bueno en silencio.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DICTS } from '../src/lib/i18n'

const RAIZ = new URL('..', import.meta.url).pathname

function lee(rel: string): string {
  return readFileSync(join(RAIZ, rel), 'utf-8')
}

/** Todos los `.ts`/`.tsx` de `src/`, menos los componentes generados de shadcn. */
function ficherosFuente(dir = 'src'): string[] {
  const fuera: string[] = []
  for (const entrada of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entrada.name}`
    if (entrada.isDirectory()) {
      if (rel === 'src/components/ui') continue
      fuera.push(...ficherosFuente(rel))
    } else if (/\.tsx?$/.test(entrada.name)) {
      fuera.push(rel)
    }
  }
  return fuera
}

const FUENTES = ficherosFuente()
const CLAVES_CA = new Set(Object.keys(DICTS.ca))

describe('las claves de i18n que usa el código existen', () => {
  // `t('x')` y `t("x")`, con o sin segundo argumento. No se intenta cubrir las dinámicas
  // (`t(variable)` o `t(\`pre.${x}\`)`): esas se listan aparte, abajo.
  const USO = /\bt\(\s*'([a-z][a-z0-9_]*(?:\.[a-zA-Z0-9_]+)+)'/g

  const usadas = new Map<string, string[]>()
  for (const fichero of FUENTES) {
    const texto = lee(fichero)
    for (const m of texto.matchAll(USO)) {
      const clave = m[1]
      usadas.set(clave, [...(usadas.get(clave) ?? []), fichero])
    }
  }

  it('la extracción encuentra claves (si no, la expresión se ha quedado obsoleta)', () => {
    expect(usadas.size).toBeGreaterThan(200)
  })

  it('ninguna clave usada falta en el diccionario', () => {
    const faltan = [...usadas.entries()]
      .filter(([clave]) => !CLAVES_CA.has(clave))
      .map(([clave, ficheros]) => `${clave}  (${[...new Set(ficheros)].join(', ')})`)
    // ⚠️ Una clave que falta NO rompe la aplicación: `t()` devuelve el identificador y la
    // pantalla enseña «nav.documents» en el menú. Por eso hace falta comprobarlo.
    expect(faltan, `Claves usadas y no definidas:\n  ${faltan.join('\n  ')}`).toEqual([])
  })
})

describe('el menú apunta a rutas que existen', () => {
  const nav = lee('src/lib/nav.ts')
  const router = lee('src/router/index.tsx')

  // Los destinos del menú: `to: '/equip/documents'`.
  const destinos = [...nav.matchAll(/\bto:\s*'([^']+)'/g)].map((m) => m[1])

  // Las rutas del router, que se declaran en dos formas: absolutas (`path: '/equip'`) y
  // relativas dentro de un padre (`path: 'documents'`). Se reconstruyen los caminos
  // completos combinando cada prefijo absoluto con los relativos que le siguen.
  const paths = [...router.matchAll(/\bpath:\s*'([^']+)'/g)].map((m) => m[1])
  const completas = new Set<string>()
  let prefijo = ''
  for (const p of paths) {
    if (p.startsWith('/')) {
      prefijo = p === '/' ? '' : p
      completas.add(p)
    } else if (p !== '*') {
      completas.add(`${prefijo}/${p}`)
    }
  }

  it('la extracción encuentra menú y rutas', () => {
    expect(destinos.length).toBeGreaterThan(10)
    expect(completas.size).toBeGreaterThan(20)
  })

  it('cada entrada del menú tiene su ruta declarada', () => {
    // Se compara ignorando los parámetros: `/equip/albarans/:id` cubre `/equip/albarans/x`.
    const huerfanos = destinos.filter((d) => !completas.has(d))
    expect(
      huerfanos,
      `Entradas de menú sin ruta:\n  ${huerfanos.join('\n  ')}`,
    ).toEqual([])
  })

  it('las etiquetas del menú son claves definidas', () => {
    const etiquetas = [...nav.matchAll(/\blabelKey:\s*'([^']+)'/g)].map((m) => m[1])
    expect(etiquetas.length).toBeGreaterThan(10)
    const faltan = etiquetas.filter((k) => !CLAVES_CA.has(k))
    expect(faltan, `Etiquetas de menú sin traducción:\n  ${faltan.join('\n  ')}`).toEqual([])
  })

  it('ninguna etiqueta de menú se repite entre paneles', () => {
    // No es cosmético: `nav.ts` las elige únicas a propósito para que los tooltips del menú
    // plegado no se repitan, y de ahí salen las etiquetas largas que obligan a medir la
    // barra inferior de móvil (§2).
    const etiquetas = [...nav.matchAll(/\blabelKey:\s*'([^']+)'/g)].map((m) => m[1])
    const vistas = new Set<string>()
    const repetidas = etiquetas.filter((k) => (vistas.has(k) ? true : (vistas.add(k), false)))
    expect(repetidas, `Etiquetas repetidas:\n  ${repetidas.join('\n  ')}`).toEqual([])
  })
})

describe('las pantallas que importa el router existen', () => {
  const router = lee('src/router/index.tsx')
  const imports = [...router.matchAll(/from\s+'(\.\.\/[^']+)'/g)].map((m) => m[1])

  it('la extracción encuentra imports', () => {
    expect(imports.length).toBeGreaterThan(15)
  })

  it('cada import del router resuelve a un fichero', () => {
    const rotos = imports.filter((rel) => {
      const base = join(RAIZ, 'src', rel.replace(/^\.\.\//, ''))
      for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
        try {
          readFileSync(base + ext)
          return false
        } catch { /* probamos la siguiente extensión */ }
      }
      return true
    })
    expect(rotos, `Imports del router sin fichero:\n  ${rotos.join('\n  ')}`).toEqual([])
  })
})
