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

describe('ninguna clave de i18n se queda huérfana', () => {
  // La dirección inversa de la primera suite: una clave que nadie usa es texto muerto, y
  // peor que inofensiva — al cambiar una pantalla se traduce una clave que ya no se pinta y
  // la que sí se pinta se queda vieja. Se juntaron ~45 de funciones retiradas (fotos del
  // catálogo, factura subida por el productor, el contexto degradado…) antes de mirar.
  //
  // CÓMO NO DAR FALSOS POSITIVOS con las claves compuestas (`t(\`od.ch_${canal}\`)`): una
  // clave cuenta como usada si aparece LITERAL entre comillas en cualquier sitio, o si
  // empieza por el prefijo fijo de alguna plantilla (`\`prefijo${…}`) o concatenación
  // (`'prefijo' + …`). Eso es generoso a propósito —`canal.${pas}_t` cubre todo `canal.`—:
  // esta prueba puede dejar pasar una clave muerta, nunca marcar una viva.
  //
  // Se leen también `supabase/functions` y `supabase/migrations`: hay claves que devuelve el
  // servidor como mensaje (`po.err_albara_pendent` de `crear-oferta`) y que la pantalla
  // traduce con `textError()`. Las pruebas NO cuentan como uso: una clave que solo cita un
  // test es exactamente lo que se busca (pasó con `alb.why_only_rec`).
  function recorre(dir: string, ext: RegExp): string[] {
    const fuera: string[] = []
    for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) fuera.push(...recorre(rel, ext))
      else if (ext.test(e.name)) fuera.push(rel)
    }
    return fuera
  }
  const fitxers = [
    ...FUENTES.filter((f) => f !== 'src/lib/i18n.tsx'),
    ...recorre('supabase/functions', /\.ts$/),
    ...recorre('supabase/migrations', /\.sql$/),
  ]
  const text = fitxers.map(lee).join('\n')
  const literals = new Set([...text.matchAll(/['"`]([a-z_0-9]+\.[A-Za-z0-9_]+)['"`]/g)].map((m) => m[1]))
  const prefixos = [
    ...[...text.matchAll(/`([a-z_0-9]+\.[A-Za-z0-9_]*)\$\{/g)].map((m) => m[1]),
    ...[...text.matchAll(/'([a-z_0-9]+\.[A-Za-z0-9_]*)'\s*\+/g)].map((m) => m[1]),
  ]

  it('la extracción encuentra literales y prefijos', () => {
    expect(literals.size).toBeGreaterThan(500)
    expect(prefixos.length).toBeGreaterThan(20)
  })

  it('cada clave del catalán se usa en algún sitio', () => {
    const usada = (k: string) =>
      literals.has(k)
      // La variante singular la sirve `t()` sola cuando `n` vale 1 (§7).
      || (k.endsWith('_1') && literals.has(k.slice(0, -2)))
      || prefixos.some((p) => k.startsWith(p))
    const orfes = [...CLAVES_CA].filter((k) => !usada(k)).sort()
    expect(orfes, `Claves que no usa nadie (bórralas en ca y es):\n  ${orfes.join('\n  ')}`).toEqual([])
  })
})
