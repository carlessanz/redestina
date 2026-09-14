// Los helpers de las pantallas de documentos del panel externo.
//
// Son las cuatro decisiones que esas pantallas toman sin pedirle nada a la base, y las
// únicas que se pueden comprobar sin montar React: cómo se ordenan los años, qué PDF vale
// hoy, cómo se nombra un tipo de documento y cuál de varios convenios describe a la
// organización.

import { describe, it, expect } from 'vitest'
import {
  ORDRE_CONVENI,
  agrupaPerExercici,
  docVigent,
  estatConveniMesAvancat,
  etiquetaTipusDocument,
  rutaPerProposit,
} from '../src/lib/documentsPanell'
import type { DocMinim } from '../src/lib/documentsPanell'
import { DICTS } from '../src/lib/i18n'
import type { ConvenioEstado, DocumentoTipo } from '../src/types'

describe('agrupaPerExercici', () => {
  it('ordena de más reciente a más antiguo', () => {
    const r = agrupaPerExercici([{ ejercicio: 2026 }, { ejercicio: 2028 }, { ejercicio: 2027 }])
    expect(r.map((g) => g.exercici)).toEqual([2028, 2027, 2026])
  })

  it('agrupa las filas del mismo año y conserva su orden', () => {
    const r = agrupaPerExercici([
      { ejercicio: 2026, n: 1 }, { ejercicio: 2027, n: 2 }, { ejercicio: 2026, n: 3 },
    ])
    expect(r[0]).toEqual({ exercici: 2027, files: [{ ejercicio: 2027, n: 2 }] })
    expect(r[1].files.map((f) => f.n)).toEqual([1, 3])
  })

  // Un `null` no es «año cero»: es un documento que todavía no ha pedido su número, y el
  // número es lo que fija el ejercicio. Arriba parecería lo más nuevo.
  it('lo que no tiene ejercicio va AL FINAL, no al principio', () => {
    const r = agrupaPerExercici([{ ejercicio: null }, { ejercicio: 2026 }, { ejercicio: 2028 }])
    expect(r.map((g) => g.exercici)).toEqual([2028, 2026, null])
  })

  it('sin filas, sin grupos', () => {
    expect(agrupaPerExercici([])).toEqual([])
  })
})

describe('docVigent', () => {
  const docs: DocMinim[] = [
    { objeto_tipo: 'convenio', objeto_id: 'c1', tipo: 'CONV', ejercicio: 2026, vigente: false },
    { objeto_tipo: 'convenio', objeto_id: 'c1', tipo: 'CONV', ejercicio: 2026, vigente: true },
    { objeto_tipo: 'albaran', objeto_id: 'a1', tipo: 'REC', ejercicio: 2026, vigente: true },
  ]

  it('elige el vigente aunque no sea el primero', () => {
    expect(docVigent(docs, 'convenio', 'c1')?.vigente).toBe(true)
  })

  it('no cruza objetos: el mismo id con otro tipo no cuenta', () => {
    expect(docVigent(docs, 'albaran', 'c1')).toBeUndefined()
    expect(docVigent(docs, 'convenio', 'a1')).toBeUndefined()
  })

  it('sin ninguna coincidencia devuelve undefined', () => {
    expect(docVigent(docs, 'plan', 'p1')).toBeUndefined()
  })

  // Quien no pidió la columna `vigente` sigue teniendo una respuesta razonable: la
  // primera, que es como llegan ordenados por fecha.
  it('sin la columna `vigente`, la primera coincidencia', () => {
    const sense: DocMinim[] = [
      { objeto_tipo: 'plan', objeto_id: 'p1', tipo: 'PLA', ejercicio: 2026 },
      { objeto_tipo: 'plan', objeto_id: 'p1', tipo: 'PLA', ejercicio: 2025 },
    ]
    expect(docVigent(sense, 'plan', 'p1')?.ejercicio).toBe(2026)
  })
})

describe('etiquetaTipusDocument', () => {
  const TIPOS: DocumentoTipo[] = [
    'REC', 'ENT', 'OPE', 'R-REC', 'R-ENT', 'R-OPE',
    'CONV', 'RES', 'CD', 'CT', 'PLA', 'PROVA',
  ]

  // La prueba que de verdad importa: la clave que devuelve tiene que EXISTIR. Como se
  // compone con una plantilla, `cobertura.test.ts` no la ve, así que un tipo nuevo sin su
  // traducción saldría en pantalla como `doc.tipus_XXX` y nadie lo notaría hasta
  // producción.
  it('las doce devuelven una clave que existe en los dos idiomas', () => {
    for (const tipo of TIPOS) {
      const clau = etiquetaTipusDocument(tipo)
      expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
      expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
    }
  })
})

describe('estatConveniMesAvancat', () => {
  it('sin convenios, null', () => {
    expect(estatConveniMesAvancat([])).toBeNull()
  })

  it('con uno, ese', () => {
    expect(estatConveniMesAvancat([{ estado: 'pendent_firma' }])).toBe('pendent_firma')
  })

  // Lo que describe a una organización es su convenio más avanzado: tener uno sustituido
  // y otro vigente es estar en regla, no estar a medias.
  it('con varios, el más avanzado del circuito', () => {
    expect(estatConveniMesAvancat([
      { estado: 'substituit' }, { estado: 'vigent' }, { estado: 'esborrany' },
    ])).toBe('vigent')
    expect(estatConveniMesAvancat([
      { estado: 'esborrany' }, { estado: 'pendent_firma' },
    ])).toBe('pendent_firma')
  })

  it('el orden cubre los siete estados del circuito', () => {
    const tots: ConvenioEstado[] = [
      'esborrany', 'pendent_firma', 'firmat', 'vigent', 'retornat', 'resolt', 'substituit',
    ]
    for (const e of tots) expect(ORDRE_CONVENI).toContain(e)
    expect(ORDRE_CONVENI).toHaveLength(tots.length)
  })
})

describe('rutaPerProposit', () => {
  // Equivocarla no da un error claro: un token de firma en la página de confirmación
  // responde «enlace desconocido», que parece un problema del token y no de la ruta.
  it('cada propósito va a su página pública', () => {
    expect(rutaPerProposit('firma_convenio', 'abc')).toBe('/signar/abc')
    expect(rutaPerProposit('confirmacion_albaran', 'abc')).toBe('/confirmar/abc')
  })

  // El token es base64url (`-` y `_`): no necesita escaparse en una ruta, y tocarlo lo
  // invalidaría contra el hash guardado.
  it('el token viaja tal cual', () => {
    const token = `aA0-_zZ9${'x'.repeat(35)}`
    expect(rutaPerProposit('firma_convenio', token)).toBe(`/signar/${token}`)
  })
})
