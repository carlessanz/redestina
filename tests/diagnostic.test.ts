// El diagnóstico de prevención, del lado de la pantalla: el estado, los chips de sección y cómo
// se LEEN las respuestas del cuestionario anterior (que tiene que decir lo mismo que el PDF,
// `respuestaLegible` de `_shared/pdf/render/pla.ts`).
//
// A3 (`20270522100000`): el formulario dejó de usar el motor genérico del cuestionario, y con él
// se fueron de `lib/diagnostic.ts` la segunda copia de la gramática de condiciones
// (`avaluar_regla`), el prefill y el cálculo de obligatorias, con sus pruebas. Lo nuevo (estado de
// edición, payload, `faltenLocal`) se prueba en `tests/excedentsDiagnostic.test.ts`.
//
// Lo segundo son las CLAVES i18n. Las de los estados y las secciones se componen
// (`diag.st_${estat}`, `diag.sec_${seccio}`), así que `cobertura.test.ts` —que lee el código
// como texto y solo encuentra literales— no las ve.

import { describe, it, expect } from 'vitest'
import { DICTS } from '../src/lib/i18n'
import {
  ESTATS_DIAGNOSTIC, SECCIONS_CONEGUDES, agrupaRespostes, clauSeccio, estilEstatDiagnostic, idSeccio,
  respostaLlegible, textBilingue,
} from '../src/lib/diagnostic'
import type { RespostaDiagnostic } from '../src/types'

const IDIOMES = ['ca', 'es'] as const

// ---------------------------------------------------------------------------
describe('las secciones', () => {
  it('el id del título es estable (el destino del chip)', () => {
    expect(idSeccio('excedents')).toBe('diag-sec-excedents')
  })

  it('una sección conocida tiene clave; una desconocida, no (se pinta tal cual)', () => {
    expect(clauSeccio('causes')).toBe('diag.sec_causes')
    expect(clauSeccio('inventada')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('el estado (A1: cuatro, los del plan se fueron)', () => {
  it('son exactamente cuatro', () => {
    expect([...ESTATS_DIAGNOSTIC].sort()).toEqual(['complet', 'incomplet', 'sense_comencar', 'sense_questionari'])
  })

  it('el badge de estado sale de los tokens, nunca de un color suelto', () => {
    for (const e of ESTATS_DIAGNOSTIC) {
      const clase = estilEstatDiagnostic(e)
      expect(clase, e).toMatch(/^bg-(exito|aviso|secondary|muted)/)
    }
    // `sense_questionari` no es de nadie que mire: nunca en `aviso`.
    expect(estilEstatDiagnostic('sense_questionari')).not.toMatch(/aviso/)
    expect(estilEstatDiagnostic('complet')).toMatch(/exito/)
  })
})

// ---------------------------------------------------------------------------
describe('respostaLlegible: el resumen dice lo mismo que el PDF', () => {
  const r = (x: Partial<RespostaDiagnostic>): RespostaDiagnostic => ({
    id: 'x', tipus: 'text', seccio: 'productes', pregunta: { ca: 'P', es: 'P' }, valor: null, ...x,
  })

  it('primero las etiquetas (multi y productes), en el idioma pedido', () => {
    expect(respostaLlegible(r({
      tipus: 'multi', valor: ['a', 'b'],
      etiquetes: [{ ca: 'Donació', es: 'Donación' }, { ca: 'Venda', es: 'Venta' }],
    }), 'es')).toBe('Donación, Venta')
  })

  it('después la etiqueta (opció, booleà, per producte, mesos): nunca el código interno', () => {
    expect(respostaLlegible(r({ tipus: 'opcio', valor: 'mes_20000', etiqueta: { ca: 'Més de 20.000 kg', es: 'Más de 20.000 kg' } }), 'ca'))
      .toBe('Més de 20.000 kg')
    expect(respostaLlegible(r({ tipus: 'boolea', valor: false, etiqueta: { ca: 'No', es: 'No' } }), 'ca')).toBe('No')
  })

  it('una etiqueta vacía cae al valor; una lista de etiquetas vacía, también', () => {
    expect(respostaLlegible(r({ tipus: 'mesos', valor: [6, 7], etiqueta: { ca: '', es: '' } }), 'ca')).toBe('6, 7')
    expect(respostaLlegible(r({ tipus: 'multi', valor: ['a'], etiquetes: [] }), 'ca')).toBe('a')
  })

  it('el valor crudo: texto, número con el formato del idioma, booleano y objeto', () => {
    expect(respostaLlegible(r({ valor: '  Text lliure  ' }), 'ca')).toBe('Text lliure')
    expect(respostaLlegible(r({ tipus: 'numero', valor: 12000 }), 'es')).toMatch(/^12[.\u202f\u00a0]?000$/)
    expect(respostaLlegible(r({ tipus: 'numero', valor: 2.5 }), 'ca')).toBe('2,5')
    expect(respostaLlegible(r({ tipus: 'boolea', valor: true }), 'es')).toBe('Sí')
    expect(respostaLlegible(r({ tipus: 'per_producte_num', valor: { Poma: 3, Pera: null } }), 'ca')).toBe('Poma: 3')
  })

  it('sin nada que decir, cadena vacía (el guion lo pone quien pinta)', () => {
    expect(respostaLlegible(r({ valor: null }), 'ca')).toBe('')
    expect(respostaLlegible(r({ valor: '   ' }), 'ca')).toBe('')
    expect(respostaLlegible(r({ valor: [] }), 'ca')).toBe('')
  })

  it('agrupaRespostes: por sección, en el orden en que llegan, con su clave', () => {
    const g = agrupaRespostes([
      r({ id: '1', seccio: 'causes' }), r({ id: '2', seccio: 'productes' }), r({ id: '3', seccio: 'causes' }),
      r({ id: '4', seccio: '' }), r({ id: '5', seccio: 'inventada' }),
    ])
    expect(g.map((x) => x.seccio)).toEqual(['causes', 'productes', 'altres', 'inventada'])
    expect(g[0].respostes.map((x) => x.id)).toEqual(['1', '3'])
    expect(g[3].clau).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Las claves. Todas se componen, así que `cobertura.test.ts` no las ve.
// ---------------------------------------------------------------------------
describe('claves i18n compuestas', () => {
  function existeix(clau: string) {
    for (const idioma of IDIOMES) {
      expect(DICTS[idioma][clau], `falta ${clau} en ${idioma}`).toBeDefined()
      expect(DICTS[idioma][clau].trim(), `${clau} està buida en ${idioma}`).not.toBe('')
    }
  }

  it('las secciones', () => {
    for (const s of SECCIONS_CONEGUDES) existeix(`diag.sec_${s}`)
  })

  it('los cuatro estados, con su badge y la línea de la tarjeta del productor', () => {
    for (const e of ESTATS_DIAGNOSTIC) {
      existeix(`diag.st_${e}`)
      existeix(`diag.o_card_${e}`)
    }
  })

  it('las claves de los estados retirados ya no existen (A1)', () => {
    for (const idioma of IDIOMES) {
      for (const k of ['diag.st_a_punt', 'diag.st_emes', 'diag.o_card_a_punt', 'diag.o_card_emes', 'diag.e_card_complet']) {
        expect(DICTS[idioma][k], `${k} sobra en ${idioma}`).toBeUndefined()
      }
    }
  })

  it('la banda de la Operativa y los chips de sección, en los dos idiomas', () => {
    for (const k of ['avop.titol', 'avop.text', 'avop.anar', 'avop.ara_no', 'avop.badge',
      'diag.seccio_completa', 'diag.seccio_pendent', 'diag.seccio_buida', 'diag.nav_seccions',
      'diag.actualitzat', 'diag.actualitzat_per', 'diag.resum_buit_equip', 'diag.resum_buit_extern']) existeix(k)
  })

  it('los marcadores de las claves nuevas son los que se pasan', () => {
    for (const idioma of IDIOMES) {
      expect(DICTS[idioma]['diag.actualitzat_per']).toContain('{data}')
      expect(DICTS[idioma]['diag.actualitzat_per']).toContain('{nom}')
      expect(DICTS[idioma]['diag.seccio_pendent']).toContain('{n}')
    }
  })
})

// ---------------------------------------------------------------------------
describe('textBilingue', () => {
  it('cae al catalán antes que a un hueco', () => {
    // Las dos lenguas son obligatorias desde `questionari_problemes()`, así que un hueco
    // solo puede venir de una fila sembrada antes de ese CHECK. Enseñar el catalán es peor
    // que enseñar el castellano y mucho mejor que dejar un blanco en un formulario.
    expect(textBilingue({ ca: 'Hola', es: 'Hola es' }, 'es')).toBe('Hola es')
    expect(textBilingue({ ca: 'Hola', es: '' }, 'es')).toBe('Hola')
    expect(textBilingue(null, 'ca')).toBe('')
  })
})

