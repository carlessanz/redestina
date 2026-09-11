// El importe en letras del certificado de donación.
//
// Esta suite no se ha inventado: la cabecera de `lletres.ts` enumera los sitios donde esto se
// rompe y dice «y por eso están todos probados». No lo estaban. Aquí están.
//
// Por qué importa más que un test normal: el certificado dice el valor «en letras y en cifras»
// (anexo B.2) precisamente para que un dígito cambiado a mano se note. Si las dos formas
// dejaran de decir lo mismo, el documento perdería la garantía que justifica su existencia —y
// lo haría en silencio, porque nada más en el sistema compara las dos.

import { describe, it, expect } from 'vitest'
import {
  numeroEnLletres,
  importEnLletres,
  importEnXifres,
} from '../supabase/functions/_shared/pdf/lletres.ts'

describe('numeroEnLletres · catalán', () => {
  it('escribe las unidades y la decena irregular', () => {
    expect(numeroEnLletres(0, 'ca')).toBe('zero')
    expect(numeroEnLletres(1, 'ca')).toBe('un')
    expect(numeroEnLletres(9, 'ca')).toBe('nou')
  })

  // El caso que la cabecera pone primero: 16 y 17 no se componen, son palabra propia.
  it('16 y 17 son «setze» y «disset», no una composición', () => {
    expect(numeroEnLletres(16, 'ca')).toBe('setze')
    expect(numeroEnLletres(17, 'ca')).toBe('disset')
    expect(numeroEnLletres(15, 'ca')).toBe('quinze')
    expect(numeroEnLletres(18, 'ca')).toBe('divuit')
  })

  it('21 lleva guiones: «vint-i-un»', () => {
    expect(numeroEnLletres(21, 'ca')).toBe('vint-i-un')
  })

  it('100 es «cent» a secas y 101 no cambia la palabra', () => {
    expect(numeroEnLletres(100, 'ca')).toBe('cent')
    expect(numeroEnLletres(100, 'ca')).not.toContain('un cent')
    expect(numeroEnLletres(101, 'ca')).toBe('cent un')
  })

  it('200 lleva guion: «dos-cents»', () => {
    expect(numeroEnLletres(200, 'ca')).toBe('dos-cents')
  })

  it('1.000 es «mil» a secas, pero 1.000.000 sí lleva «un»', () => {
    expect(numeroEnLletres(1000, 'ca')).toBe('mil')
    expect(numeroEnLletres(1000, 'ca')).not.toContain('un mil')
    expect(numeroEnLletres(1000000, 'ca')).toContain('un milió')
  })
})

describe('numeroEnLletres · castellano', () => {
  it('16 lleva acento: «dieciséis»', () => {
    expect(numeroEnLletres(16, 'es', { absoluto: true })).toBe('dieciséis')
  })

  // El error clásico que la cabecera nombra: «veintiuno euros».
  it('21 va apocopado ante nombre y entero cuando va suelto', () => {
    expect(numeroEnLletres(21, 'es')).toBe('veintiún')
    expect(numeroEnLletres(21, 'es', { absoluto: true })).toBe('veintiuno')
  })

  it('100 es «cien» y 101 cambia a «ciento»', () => {
    expect(numeroEnLletres(100, 'es')).toBe('cien')
    expect(numeroEnLletres(101, 'es', { absoluto: true })).toBe('ciento uno')
  })

  it('las centenas irregulares', () => {
    expect(numeroEnLletres(500, 'es')).toBe('quinientos')
    expect(numeroEnLletres(700, 'es')).toBe('setecientos')
    expect(numeroEnLletres(900, 'es')).toBe('novecientos')
  })

  it('1.000 es «mil» a secas', () => {
    expect(numeroEnLletres(1000, 'es')).toBe('mil')
    expect(numeroEnLletres(1000, 'es')).not.toContain('un mil')
  })

  // La apócope es el comportamiento POR DEFECTO porque todos los números de este módulo
  // van seguidos de un nombre masculino (euros, céntimos, mil, millones).
  it('la apócope actúa por defecto en los compuestos', () => {
    expect(numeroEnLletres(21000, 'es')).toBe('veintiún mil')
    expect(numeroEnLletres(1001, 'es')).toBe('mil un')
  })
})

describe('importEnLletres', () => {
  it('los dos ejemplos de la documentación', () => {
    expect(importEnLletres(850, 'ca').texto)
      .toBe('vuit-cents cinquanta euros amb zero cèntims')
    expect(importEnLletres(850, 'es').texto)
      .toBe('ochocientos cincuenta euros con cero céntimos')
  })

  // «Los céntimos SIEMPRE se dicen, aunque sean cero»: un importe legal que calla la parte
  // decimal deja abierto qué pasa con ella.
  it('dice los céntimos aunque sean cero', () => {
    expect(importEnLletres(100, 'ca').texto).toContain('zero cèntims')
    expect(importEnLletres(100, 'es').texto).toContain('cero céntimos')
  })

  it('singular de euro y de céntimo', () => {
    expect(importEnLletres(1.01, 'ca').texto).toBe('un euro amb un cèntim')
    expect(importEnLletres(1.01, 'es').texto).toBe('un euro con un céntimo')
  })

  it('los negativos llevan su palabra', () => {
    expect(importEnLletres(-5, 'ca').texto).toMatch(/^menys /)
    expect(importEnLletres(-5, 'es').texto).toMatch(/^menos /)
  })

  it('devuelve las partes ya redondeadas para poder imprimirlas', () => {
    const r = importEnLletres(1234.56, 'ca')
    expect(r.eurosNum).toBe(1234)
    expect(r.centimosNum).toBe(56)
  })
})

describe('importEnXifres', () => {
  it('coma decimal, punto de millar y símbolo', () => {
    expect(importEnXifres(850)).toBe('850,00 €')
    expect(importEnXifres(1234.5)).toBe('1.234,50 €')
    expect(importEnXifres(1234567.89)).toBe('1.234.567,89 €')
  })

  it('rellena los céntimos a dos cifras', () => {
    expect(importEnXifres(5.4)).toBe('5,40 €')
    expect(importEnXifres(5.04)).toBe('5,04 €')
  })

  it('los negativos llevan el signo delante', () => {
    expect(importEnXifres(-12.3)).toBe('-12,30 €')
  })
})

// ---------------------------------------------------------------------------
// La invariante que justifica el módulo entero
// ---------------------------------------------------------------------------
// Las dos formas tienen que decir lo mismo. No se comparan textos —son idiomas
// distintos—, sino que se comprueba que ambas salen del MISMO número redondeado: si
// `partir()` redondeara distinto en cada una, el certificado diría «850,01 €» en cifras y
// «ochocientos cincuenta euros» en letras, y esa discrepancia es exactamente contra lo que
// el anexo B.2 pide que se impriman las dos.
describe('la cifra y la letra no pueden discrepar', () => {
  const casos = [0, 0.01, 0.99, 1, 1.005, 5.4, 99.995, 850, 1234.56, 1000000.01]

  it.each(casos)('%s coinciden en euros y céntimos', (valor) => {
    const letra = importEnLletres(valor, 'ca')
    const cifra = importEnXifres(valor)
    const [eurosTxt, restoTxt] = cifra.replace(' €', '').split(',')
    expect(Number(eurosTxt.replace(/\./g, ''))).toBe(letra.eurosNum)
    expect(Number(restoTxt)).toBe(letra.centimosNum)
  })
})
