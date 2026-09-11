// Paridad de los dos diccionarios de la interfaz.
//
// POR QUÉ ESTA ES LA SUITE MÁS IMPORTANTE DEL LOTE: `t()` resuelve
// `DICTS[lang][key] ?? DICTS.ca[key] ?? key`, o sea que una clave que falte en castellano
// **no rompe nada**: se sirve el catalán y la pantalla sigue funcionando. Nadie se entera
// hasta que alguien que trabaja en castellano mira esa pantalla concreta. Y cuando falta en
// los dos, lo que se pinta es el identificador crudo — eso fue lo que en la fase 4 dejó
// cuatro entradas de menú enseñando `nav.algo` en producción, con el build en verde.
//
// `tsc` no puede cazarlo (los diccionarios son `Record<string, string>`, no una unión de
// claves) y ningún test de comportamiento pasa por las 850 claves. Así que la única red
// posible es esta comparación, y por eso `i18n.tsx` exporta `DICTS`.
//
// Las tres cosas que se comprueban son las tres formas distintas en que esto se rompe:
//   1. una clave existe en un idioma y no en el otro  → texto en el idioma equivocado
//   2. un valor está vacío                            → hueco en blanco en la pantalla
//   3. los marcadores {x} no coinciden                → la interpolación se pierde EN SILENCIO
//      (`t('x', {n: 3})` sobre un texto sin `{n}` no avisa: devuelve el texto tal cual)

import { describe, it, expect } from 'vitest'
import { DICTS } from '../src/lib/i18n'

const ca = DICTS.ca
const es = DICTS.es

/** Marcadores `{algo}` de un texto, ordenados y sin repetidos. */
function marcadores(texto: string): string[] {
  const encontrados = texto.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? []
  return [...new Set(encontrados)].sort()
}

describe('los dos diccionarios existen y no están vacíos', () => {
  it('ca y es tienen claves', () => {
    expect(Object.keys(ca).length).toBeGreaterThan(100)
    expect(Object.keys(es).length).toBeGreaterThan(100)
  })
})

describe('paridad de claves entre català i castellà', () => {
  // Las dos direcciones por separado: el informe tiene que decir QUÉ falta y DÓNDE, no
  // solo que los dos juegos difieren.
  it('ninguna clave del català falta en castellà', () => {
    const faltan = Object.keys(ca).filter((k) => !(k in es)).sort()
    expect(faltan, `claves sin traducir al castellano: ${faltan.join(', ')}`).toEqual([])
  })

  it('ninguna clave del castellà sobra (falta en català)', () => {
    // Esta dirección importa igual aunque `t()` no la note: el catalán es el idioma por
    // defecto, así que una clave que solo exista en castellano es texto muerto — o peor,
    // una pantalla que en catalán enseña su identificador.
    const faltan = Object.keys(es).filter((k) => !(k in ca)).sort()
    expect(faltan, `claves que solo existen en castellano: ${faltan.join(', ')}`).toEqual([])
  })

  it('los dos diccionarios tienen exactamente el mismo número de claves', () => {
    expect(Object.keys(es).length).toBe(Object.keys(ca).length)
  })
})

describe('ningún valor vacío', () => {
  it.each(['ca', 'es'] as const)('%s no tiene textos en blanco', (lang) => {
    const vacias = Object.entries(DICTS[lang])
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => k)
      .sort()
    expect(vacias, `claves con texto vacío en ${lang}: ${vacias.join(', ')}`).toEqual([])
  })

  it.each(['ca', 'es'] as const)('%s no tiene valores que no sean texto', (lang) => {
    const raras = Object.entries(DICTS[lang])
      .filter(([, v]) => typeof v !== 'string')
      .map(([k]) => k)
    expect(raras).toEqual([])
  })
})

describe('los marcadores {x} coinciden en los dos idiomas', () => {
  // El caso que justifica esto: si `ca` dice «{n} files exportades» y la traducción
  // castellana se escribe «filas exportadas» sin el `{n}`, `t('tan.exported_182', {n: 12})`
  // devuelve la frase sin el número y **no da ningún error**. El dato desaparece.
  it('cada clave común usa los mismos marcadores en ca y en es', () => {
    const comunes = Object.keys(ca).filter((k) => k in es)
    const divergentes = comunes
      .map((k) => ({ k, ca: marcadores(ca[k]), es: marcadores(es[k]) }))
      .filter(({ ca: a, es: b }) => a.join(',') !== b.join(','))
      .map(({ k, ca: a, es: b }) => `${k} (ca: ${a.join(' ') || '—'} / es: ${b.join(' ') || '—'})`)
    expect(divergentes, `marcadores descompensados:\n  ${divergentes.join('\n  ')}`).toEqual([])
  })
})

describe('higiene de las claves', () => {
  // Las claves llevan prefijo de pantalla (`nav.`, `set.`, `tan.`…). Una clave sin punto
  // suele ser un literal colado por error en el sitio de la clave.
  it('todas las claves llevan prefijo de sección', () => {
    const sinPrefijo = Object.keys(ca).filter((k) => !k.includes('.'))
    expect(sinPrefijo).toEqual([])
  })

  it('ninguna clave tiene espacios en blanco alrededor', () => {
    const sucias = [...Object.keys(ca), ...Object.keys(es)].filter((k) => k !== k.trim())
    expect(sucias).toEqual([])
  })
})
