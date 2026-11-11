// La cola de ficheros huérfanos de Storage (20270526100000): la vacía `recordatorios-documentales`.
import { describe, expect, it } from 'vitest'
import { MAX_FITXERS_PER_EXECUCIO, perBucket } from '../supabase/functions/recordatorios-documentales/fitxersOrfes.ts'

describe('fitxers orfes', () => {
  it('agrupa por bucket conservando el orden', () => {
    const m = perBucket([
      { id: 1, bucket: 'documentos', ruta: 'a' },
      { id: 2, bucket: 'activos', ruta: 'b' },
      { id: 3, bucket: 'documentos', ruta: 'c' },
    ])
    expect([...m.keys()]).toEqual(['documentos', 'activos'])
    expect(m.get('documentos')!.map((f) => f.ruta)).toEqual(['a', 'c'])
    expect(perBucket([]).size).toBe(0)
  })

  it('una ejecución no pasa del máximo de la API de Storage', () => {
    expect(MAX_FITXERS_PER_EXECUCIO).toBeLessThanOrEqual(1000)
  })
})
