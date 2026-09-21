// El código de verificación y la URL que lleva a él.
//
// POR QUÉ ESTO TIENE PRUEBA Y OTRAS FUNCIONES DE FORMATO NO. `codiVerificacio()` es la
// SEGUNDA implementación de un mismo formato: la primera es `codigoVerificacion()` en
// `supabase/functions/_shared/pdf/render/comu.ts`, que es la que imprime el código en el
// PDF. Están duplicadas a la fuerza —una corre en Deno y arrastra el motor de PDF, la otra
// en el navegador— y si divergieran no fallaría nada: el sello de una web enlazaría a un
// código distinto del que lleva el papel, y la página de verificación respondería «no
// consta» de un certificado auténtico. A quien lo enseña eso lo hace parecer un
// falsificador, así que es el peor fallo posible de esta parte.
//
// Los casos de abajo son los de `codigoVerificacion()`, con sus mismas entradas: 16 dígitos
// hexadecimales en mayúsculas, en grupos de cuatro, ignorando lo que no sea hexadecimal.

import { describe, expect, it } from 'vitest'
import { codiVerificacio, urlVerificacio } from '../src/lib/codiVerificacio'

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef'

describe('codiVerificacio', () => {
  it('toma los 16 primeros hex, en mayúsculas y de cuatro en cuatro', () => {
    expect(codiVerificacio(SHA)).toBe('A1B2-C3D4-E5F6-0718')
  })

  it('descarta lo que no es hexadecimal antes de recortar', () => {
    // Un sha con guiones o espacios no puede dar un código distinto del mismo sha sin
    // ellos: es la misma huella escrita de otra forma.
    expect(codiVerificacio('a1b2-c3d4 e5f6:0718 zzz')).toBe('A1B2-C3D4-E5F6-0718')
  })

  it('un sha más corto que 16 no se rellena: se agrupa lo que hay', () => {
    expect(codiVerificacio('a1b2c3')).toBe('A1B2-C3')
  })

  it('sin huella no hay código, y eso es null y no un guion', () => {
    // El guion es para pintarlo; `null` es para poder decidir si se esconde el sello. Un
    // «—» metido en una URL daría una página de verificación que no verifica nada.
    expect(codiVerificacio(null)).toBeNull()
    expect(codiVerificacio(undefined)).toBeNull()
    expect(codiVerificacio('')).toBeNull()
    expect(codiVerificacio('zzzz')).toBeNull()
  })
})

describe('urlVerificacio', () => {
  it('compone la ruta pública sobre el origen dado', () => {
    expect(urlVerificacio('https://redestina.example', 'A1B2-C3D4'))
      .toBe('https://redestina.example/verificar/A1B2-C3D4')
  })

  it('no duplica la barra si el origen ya la trae', () => {
    expect(urlVerificacio('https://redestina.example/', 'A1B2'))
      .toBe('https://redestina.example/verificar/A1B2')
  })
})
