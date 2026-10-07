// El borrador del alta de oferta y su control de fecha (`lib/esborranyOferta.ts`).
//
// El borrador existe por el iPhone (Safari recarga la pestaña al volver de la cámara) y,
// desde la reunión del 05-10-2026, porque se le prometió a la Fundació que «se guarda una
// semana y se borra solo». Lo que se fija aquí es esa semana, y que un borrador con mala
// forma no rompa el alta.

import { describe, it, expect } from 'vitest'
import {
  VIDA_ESBORRANY_MS, ddmmaaaaAIso, interpretaEsborrany, isoADdmmaaaa,
} from '../src/lib/esborranyOferta'

const ARA = Date.UTC(2026, 9, 7, 12, 0, 0)

function guardat(desat: number, datos: Record<string, unknown> = { producte: 'Tomàquet' }) {
  return JSON.stringify({ datos, pas: 2, pasMaxim: 3, costTocat: false, desat })
}

describe('interpretaEsborrany', () => {
  it('no hay nada guardado: ni borrador ni nada que retirar', () => {
    expect(interpretaEsborrany(null, ARA)).toEqual({ esborrany: null, treu: false })
  })

  it('uno de hace un rato vale tal cual', () => {
    const r = interpretaEsborrany(guardat(ARA - 3600_000), ARA)
    expect(r.treu).toBe(false)
    expect(r.esborrany?.datos).toEqual({ producte: 'Tomàquet' })
    expect(r.esborrany?.pas).toBe(2)
  })

  it('la semana es el límite: justo en ella vale, un milisegundo después caduca y se retira', () => {
    expect(interpretaEsborrany(guardat(ARA - VIDA_ESBORRANY_MS), ARA).esborrany).not.toBeNull()
    expect(interpretaEsborrany(guardat(ARA - VIDA_ESBORRANY_MS - 1), ARA))
      .toEqual({ esborrany: null, treu: true })
    expect(VIDA_ESBORRANY_MS).toBe(7 * 24 * 3600 * 1000)
  })

  it('una forma que no es la nuestra se retira', () => {
    expect(interpretaEsborrany('42', ARA)).toEqual({ esborrany: null, treu: true })
    expect(interpretaEsborrany('null', ARA)).toEqual({ esborrany: null, treu: true })
    expect(interpretaEsborrany(JSON.stringify({ pas: 1, desat: ARA }), ARA).treu).toBe(true)
    expect(interpretaEsborrany(JSON.stringify({ datos: {}, pas: 1 }), ARA).treu).toBe(true)
  })

  it('un JSON roto no se retira (puede ser una escritura a medias) y no rompe nada', () => {
    expect(interpretaEsborrany('{"datos":', ARA)).toEqual({ esborrany: null, treu: false })
  })
})

describe('la fecha del control ↔ la de la oferta', () => {
  it('ISO → dd/mm/aaaa y vuelta', () => {
    expect(isoADdmmaaaa('2026-09-30')).toBe('30/09/2026')
    expect(ddmmaaaaAIso('30/09/2026')).toBe('2026-09-30')
    expect(ddmmaaaaAIso(isoADdmmaaaa('2027-01-05'))).toBe('2027-01-05')
  })

  it('lo que no reconoce da vacío (el control se pinta en blanco), no una fecha inventada', () => {
    expect(isoADdmmaaaa('')).toBe('')
    expect(isoADdmmaaaa('30/09/2026')).toBe('')
    expect(isoADdmmaaaa('2026-9-30')).toBe('')
    expect(ddmmaaaaAIso('')).toBe('')
    expect(ddmmaaaaAIso('fins al 30/09')).toBe('')
    expect(ddmmaaaaAIso('2026-09-30')).toBe('')
    expect(ddmmaaaaAIso('1/9/2026')).toBe('')
  })
})
