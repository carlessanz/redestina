import { describe, expect, it } from 'vitest'
import { provinciaDeIne, provinciesDe, provinciesPerComarca } from '../src/lib/territori'

const CATALEG = [
  { comarca: 'Osona', provincia: 'Barcelona' },
  { comarca: 'Osona', provincia: 'Girona' },
  { comarca: 'Osona', provincia: 'Barcelona' },
  { comarca: 'Segrià', provincia: 'Lleida' },
  { comarca: '', provincia: 'Lleida' },
]

describe('territori', () => {
  it('saca la provincia del prefijo INE y rechaza lo que no es un código', () => {
    expect(provinciaDeIne('08019')).toBe('Barcelona')
    expect(provinciaDeIne('17079')).toBe('Girona')
    expect(provinciaDeIne('25120')).toBe('Lleida')
    expect(provinciaDeIne('43148')).toBe('Tarragona')
    expect(provinciaDeIne('28079')).toBeNull()
    expect(provinciaDeIne('0801')).toBeNull()
    expect(provinciaDeIne(null)).toBeNull()
  })
  it('una comarca repartida da todas sus provincias, ordenadas y sin repetir', () => {
    const m = provinciesPerComarca(CATALEG)
    expect(m.get('Osona')).toEqual(['Barcelona', 'Girona'])
    expect(m.get('Segrià')).toEqual(['Lleida'])
    expect(m.has('')).toBe(false)
  })
  it('el municipio manda; sin él, la comarca; sin nada, ninguna', () => {
    const m = provinciesPerComarca(CATALEG)
    expect(provinciesDe('17001', 'Osona', m)).toEqual(['Girona'])
    expect(provinciesDe(null, 'Osona', m)).toEqual(['Barcelona', 'Girona'])
    expect(provinciesDe(null, 'Inventada', m)).toEqual([])
    expect(provinciesDe(null, null, m)).toEqual([])
  })
})
