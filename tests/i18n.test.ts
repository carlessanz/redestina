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

// ---------------------------------------------------------------------------
// La convención de singular (`<clau>_1`)
// ---------------------------------------------------------------------------
// `t()` sirve `<clau>_1` cuando el parámetro `n` vale 1, y si no existe usa el plural de
// siempre. Es opt-in, así que lo que puede romperse no es que falte una variante —eso solo
// devuelve el comportamiento anterior— sino que la variante MIENTA: que exista en un idioma
// y no en el otro (se leería en catalán una frase castellana), que su clave base no exista
// (texto muerto que nadie verá nunca), o que introduzca un marcador que quien llama no pasa,
// porque un `{x}` sin valor se imprime crudo en la pantalla.
describe('la convención de singular', () => {
  const variantes = Object.keys(ca).filter((k) => k.endsWith('_1') && ca[`${k.slice(0, -2)}`] !== undefined)

  it('hay variantes que comprobar', () => {
    expect(variantes.length).toBeGreaterThan(0)
  })

  it('cada variante existe en los dos idiomas', () => {
    for (const k of variantes) expect(es[k], `falta ${k} en castellà`).toBeDefined()
  })

  it('ninguna variante introduce un marcador que su plural no tenga', () => {
    for (const k of variantes) {
      const base = k.slice(0, -2)
      for (const idioma of [ca, es]) {
        const sobran = marcadores(idioma[k]).filter((m) => !marcadores(idioma[base]).includes(m))
        expect(sobran, `${k} usa ${sobran.join(', ')}, que ${base} no pasa`).toEqual([])
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Las claves que se COMPONEN a partir de un valor de la base
// ---------------------------------------------------------------------------
// `cobertura.test.ts` recorre los literales `t('…')` del código, así que no ve una clave
// montada con una plantilla: `t(`od.ch_${fila.canal}`)`. Y ahí es justo donde el
// diccionario se queda corto en silencio, porque la lista de valores no vive en el código
// sino en un CHECK de Postgres: el día que una migración añade un valor, la pantalla
// empieza a pintar el identificador crudo y el build sigue en verde.
//
// Pasó de verdad: `oferta_respuestas.canal` ganó `asistido` en `20260921160749` y durante
// meses la cola de aprobaciones enseñó `od.ch_asistido` en las dos lenguas, que además es
// el canal MÁS frecuente porque el modelo de la fase inicial es asistido (§1bis).
//
// Cada entrada de aquí es un vocabulario cerrado de la base. Al ampliar uno de esos CHECK
// hay que ampliar también esta lista: es el único sitio donde el diccionario y el dominio
// se comparan.
describe('las claves compuestas cubren todo el vocabulario de la base', () => {
  const COMPUESTAS: { que: string; prefijo: string; valores: string[] }[] = [
    {
      // CHECK de `oferta_respuestas.canal`. Se compone en `Aprovacions.tsx` y `OfferDetail.tsx`.
      que: 'oferta_respuestas.canal',
      prefijo: 'od.ch_',
      valores: ['whatsapp', 'email', 'panel', 'asistido'],
    },
  ]

  for (const { que, prefijo, valores } of COMPUESTAS) {
    it(`${que} → ${prefijo}* en los dos idiomas`, () => {
      for (const v of valores) {
        expect(ca[`${prefijo}${v}`], `falta ${prefijo}${v} en català`).toBeDefined()
        expect(es[`${prefijo}${v}`], `falta ${prefijo}${v} en castellà`).toBeDefined()
      }
    })
  }
})
