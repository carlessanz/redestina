import { describe, expect, it } from 'vitest'
import { convenisQueFalten, type Equivalencia } from '../src/lib/convenisEquivalents'

const EQ: Equivalencia[] = [
  { tipo_nou: 'col_productor', tipo_antic: 'don_gen', valorizacion: 'donacio' },
  { tipo_nou: 'col_productor', tipo_antic: 'com', valorizacion: 'venda' },
  { tipo_nou: 'col_productor', tipo_antic: 'com', valorizacion: 'maquila' },
]

describe('el convenio único y los anteriores', () => {
  it('el de col·laboració cubre todas las modalidades', () => {
    for (const m of ['donacio', 'venda', 'maquila']) {
      expect(convenisQueFalten(m, ['col_productor'], ['col_productor'], EQ)).toEqual([])
    }
  })
  it('un don_gen anterior cubre la donación, pero no la venta', () => {
    expect(convenisQueFalten('donacio', ['col_productor'], ['don_gen'], EQ)).toEqual([])
    expect(convenisQueFalten('venda', ['col_productor'], ['don_gen'], EQ)).toEqual(['col_productor'])
  })
  it('un com anterior cubre la venta y la maquila, pero no la donación', () => {
    expect(convenisQueFalten('maquila', ['col_productor'], ['com'], EQ)).toEqual([])
    expect(convenisQueFalten('donacio', ['col_productor'], ['com'], EQ)).toEqual(['col_productor'])
  })
  it('sin ninguno, falta el único', () => {
    expect(convenisQueFalten('donacio', ['col_productor'], [], EQ)).toEqual(['col_productor'])
  })
})
