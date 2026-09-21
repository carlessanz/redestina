// Los siete rechazos de convertir una oferta en espigolada (F3).
//
// DOS COSAS, y la segunda es la que justifica el fichero: que el código se extraiga del
// mensaje de Postgres, y que **las siete claves existan en los dos idiomas**. Se componen
// (`conv_esp.err_${codi}`), así que `cobertura.test.ts` —que solo ve literales `t('...')`—
// no las mira ninguna: sin esto, un rechazo sin traducir saldría en pantalla como
// `conv_esp.err_ja_te_albarans`, en un toast rojo y con el build en verde.

import { describe, expect, it } from 'vitest'
import { MOTIUS_CONVERSIO, motiuConversio } from '../src/lib/conversioEspigolada'
import { DICTS } from '../src/lib/i18n'

describe('motiuConversio: del mensaje de la base a una clave', () => {
  it('reconoce los siete códigos tal como los manda la RPC', () => {
    for (const codi of MOTIUS_CONVERSIO) {
      // El formato real: `<codi>: <frase en català>`.
      expect(motiuConversio(`${codi}: una frase qualsevol`), codi).toBe(`conv_esp.err_${codi}`)
    }
  })

  // `null` es una respuesta, no un fallo: quiere decir «esto no es uno de los siete», y
  // entonces manda el contrato de `albarans.ts` y se enseña lo que dijo la base.
  it('devuelve null para lo que no es uno de los siete', () => {
    expect(motiuConversio('permission denied for table excedentes')).toBeNull()
    expect(motiuConversio('')).toBeNull()
    expect(motiuConversio('Nomes l’equip pot crear una espigolada')).toBeNull()
  })

  // Sin los dos puntos, `sense_producte_al_camp` casaría dentro de cualquier frase que lo
  // nombrara de pasada —empezando por los comentarios de la propia migración—.
  it('exige los dos puntos, no el código suelto', () => {
    expect(motiuConversio('parla de ja_es_espigolada però no ho és')).toBeNull()
  })
})

describe('las siete claves existen en ca y en es', () => {
  it.each([...MOTIUS_CONVERSIO])('conv_esp.err_%s', (codi) => {
    const clau = `conv_esp.err_${codi}`
    expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
    expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
  })
})
