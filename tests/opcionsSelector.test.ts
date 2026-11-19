// Las opciones de los buscadores predictivos del equipo (`src/lib/opcionsSelector.ts`).

import { describe, it, expect } from 'vitest'
import { opcioFitxa, opcionsProducte } from '../src/lib/opcionsSelector'

describe('opcioFitxa', () => {
  it('nombre de texto, municipio de detalle y NIF y razón social como claves', () => {
    expect(opcioFitxa({ id: 'a', nom: 'Banc de Prova', poblacio: 'Lleida', nif: 'G12345678', rao: 'Fundació Prova' }))
      .toEqual({ valor: 'a', text: 'Banc de Prova', detall: 'Lleida', claus: ['G12345678', 'Fundació Prova'] })
  })
  it('sin nombre usa la razón social, y sin nada un guion', () => {
    expect(opcioFitxa({ id: 'a', nom: null, rao: 'Raó SL' }).text).toBe('Raó SL')
    expect(opcioFitxa({ id: 'b', nom: '  ' }).text).toBe('—')
  })
  it('no pone detalle ni claves vacías', () => {
    const o = opcioFitxa({ id: 'a', nom: 'X', poblacio: ' ', nif: null, rao: '' })
    expect(o).toEqual({ valor: 'a', text: 'X' })
  })
})

describe('opcionsProducte', () => {
  it('el valor es el nombre', () => {
    expect(opcionsProducte(['Ceba', 'Pastanaga'])).toEqual([
      { valor: 'Ceba', text: 'Ceba' }, { valor: 'Pastanaga', text: 'Pastanaga' },
    ])
  })
  it('un valor fuera del catálogo se conserva el primero', () => {
    expect(opcionsProducte(['Ceba'], 'Bròquil antic').map((o) => o.valor)).toEqual(['Bròquil antic', 'Ceba'])
    expect(opcionsProducte(['Ceba'], 'Ceba').map((o) => o.valor)).toEqual(['Ceba'])
    expect(opcionsProducte(['Ceba'], '')).toHaveLength(1)
  })
})
