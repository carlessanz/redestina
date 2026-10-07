// El buscador de los listados (`src/lib/cerca.ts`). Lo que se fija aquí es lo que hacían
// a mano las doce pantallas antes de compartirlo, para que unificarlo no cambiara qué
// encuentra cada una: minúsculas sí, acentos no, un campo nulo cuenta como vacío y la
// consulta vacía lo deja pasar todo.

import { describe, it, expect } from 'vitest'
import { casaCerca, consultaCerca, filtraCerca, senseAccents } from '../src/lib/cerca'

describe('consultaCerca', () => {
  it('quita los espacios de los extremos y pasa a minúsculas', () => {
    expect(consultaCerca('  Tomàquet ')).toBe('tomàquet')
  })
  it('deja vacía una consulta de solo espacios', () => {
    expect(consultaCerca('   ')).toBe('')
  })
  it('conserva los espacios de dentro', () => {
    expect(consultaCerca(' Mas de  Prova ')).toBe('mas de  prova')
  })
})

describe('casaCerca', () => {
  it('una consulta vacía casa con todo, aunque no haya campos', () => {
    expect(casaCerca([], '')).toBe(true)
    expect(casaCerca([null, undefined], '')).toBe(true)
  })
  it('no distingue mayúsculas en el campo', () => {
    expect(casaCerca(['Mas de Prova SCP'], 'prova')).toBe(true)
  })
  it('busca por subcadena en cualquiera de los campos', () => {
    expect(casaCerca([null, 'REC-2026-00042'], '0004')).toBe(true)
    expect(casaCerca(['Horta', 'Barcelonès'], 'xyz')).toBe(false)
  })
  it('un campo nulo o indefinido cuenta como vacío, no como «null»', () => {
    expect(casaCerca([null, undefined], 'null')).toBe(false)
    expect(casaCerca([null, undefined], 'undefined')).toBe(false)
  })
  it('DISTINGUE acentos, como hacían las pantallas', () => {
    expect(casaCerca(['Carbassó'], 'carbasso')).toBe(false)
    expect(casaCerca(['Carbassó'], 'carbassó')).toBe(true)
  })
  it('espera la consulta ya normalizada: una con mayúsculas no casa', () => {
    // Es el contrato: quien llama pasa `consultaCerca(text)` (o el `q` de `useCerca`).
    expect(casaCerca(['prova'], 'Prova')).toBe(false)
    expect(casaCerca(['prova'], consultaCerca('Prova'))).toBe(true)
  })
})

describe('filtraCerca', () => {
  const files = [
    { nom: 'Mas de Prova SCP', poble: 'Vic' },
    { nom: 'Horta de Prova SL', poble: null },
    { nom: 'Menjador Social', poble: 'Reus' },
  ]
  it('con la consulta vacía devuelve la misma lista, no una copia', () => {
    expect(filtraCerca(files, '', (f) => [f.nom])).toBe(files)
  })
  it('filtra por cualquiera de los campos que devuelve el selector', () => {
    expect(filtraCerca(files, 'prova', (f) => [f.nom, f.poble]).map((f) => f.nom))
      .toEqual(['Mas de Prova SCP', 'Horta de Prova SL'])
    expect(filtraCerca(files, 'reus', (f) => [f.nom, f.poble]).map((f) => f.nom))
      .toEqual(['Menjador Social'])
  })
  it('solo mira los campos del selector', () => {
    expect(filtraCerca(files, 'reus', (f) => [f.nom])).toEqual([])
  })
  it('conserva el orden', () => {
    expect(filtraCerca(files, 'a', (f) => [f.nom])).toEqual(files)
  })
})

describe('senseAccents', () => {
  it('quita diacríticos, pasa a minúsculas y recorta', () => {
    expect(senseAccents(" l'Ametlla del Vallès ")).toBe("l'ametlla del valles")
    expect(senseAccents('Brócoli')).toBe('brocoli')
    expect(senseAccents('Col de Brussel·les')).toBe('col de brussel·les')
  })
})
