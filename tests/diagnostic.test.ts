// El diagnóstico de prevención: que la pantalla oculte lo mismo que el servidor descarta, y
// que lo diga en los dos idiomas.
//
// 🔴 POR QUÉ ESTA PRUEBA ES LA QUE SOSTIENE LA FASE. `src/lib/diagnostic.ts` reimplementa en
//    TypeScript la gramática de condiciones que vive en SQL (`avaluar_regla`,
//    20270328101400), porque ocultar una pregunta condicional mientras se escribe no se
//    puede hacer con una ida y vuelta por tecla. Las dos copias tienen que decidir igual, y
//    **divergir no falla: miente**. Si la pantalla oculta una pregunta que el servidor
//    considera aplicable, esa pregunta cuenta como obligatoria sin contestar: el formulario
//    dice «ja està», el botón de emitir responde `falten_obligatories` y nada explica cuál.
//
//    Así que aquí se recorren los ocho operadores contra los casos que el SQL declara
//    explícitamente en su propio cuerpo —el `buit` de cuatro formas, la respuesta ausente,
//    el tipo que no cuadra— y se comparan con el resultado que esa función documenta.
//
// Lo segundo son las CLAVES i18n. Las de los estados y las secciones se componen
// (`diag.st_${estat}`, `diag.sec_${seccio}`), así que `cobertura.test.ts` —que lee el código
// como texto y solo encuentra literales— no las ve. Es exactamente la puerta por la que se
// colaron cuatro entradas de menú enseñando su identificador en la fase 4.
//
// Y lo tercero, desde A1 (`20270520100000`): el estado de cada sección (los chips del
// formulario) y cómo se LEE una respuesta en el resumen, que tiene que decir lo mismo que el
// PDF (`respuestaLegible` de `_shared/pdf/render/pla.ts`).

import { describe, it, expect } from 'vitest'
import { DICTS } from '../src/lib/i18n'
import {
  ESTATS_DIAGNOSTIC, SECCIONS_CONEGUDES, agrupaPerSeccio, agrupaRespostes, avaluarCondicio,
  clauSeccio, esBuit, estilEstatDiagnostic, idSeccio, mesosValids, netejaRespostes,
  obligatoriesQueFalten, opcionsProductes, opcionsVisibles, prefillDesDeFitxa,
  prefillPregunta, preguntaAplica, preguntesQueApliquen, progresDiagnostic, respostaLlegible,
  seccionsAmbEstat, textBilingue,
} from '../src/lib/diagnostic'
import type { PreguntaDiagnostic, RespostaDiagnostic } from '../src/types'

const IDIOMES = ['ca', 'es'] as const

/** Una pregunta mínima; cada prueba le añade lo suyo. */
function pregunta(p: Partial<PreguntaDiagnostic> & { id: string }): PreguntaDiagnostic {
  return {
    tipus: 'text',
    seccio: 'seguiment',
    etiqueta: { ca: 'Pregunta', es: 'Pregunta' },
    obligatoria: false,
    ...p,
  }
}

// ---------------------------------------------------------------------------
describe('esBuit: las cuatro formas de «sin contestar» que declara avaluar_regla', () => {
  it.each([
    ['null', null],
    ['undefined (la clave que no está)', undefined],
    ['cadena vacía', ''],
    ['cadena en blanco', '   '],
    ['array vacío', []],
    ['objeto vacío (respuesta por producto, fase 9)', {}],
  ])('%s cuenta como vacío', (_nom, valor) => {
    expect(esBuit(valor)).toBe(true)
  })

  it.each([
    ['false', false],
    ['cero', 0],
    ['texto', 'x'],
    ['array con algo', ['a']],
  ])('%s NO cuenta como vacío', (_nom, valor) => {
    // `false` y `0` son respuestas, no huecos. Confundirlos dejaría una obligatoria
    // contestada con «no» para siempre en la lista de pendientes.
    expect(esBuit(valor)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('avaluarCondicio: el espejo de avaluar_regla', () => {
  it('`sempre` es true aunque no haya respuesta', () => {
    expect(avaluarCondicio('sempre', null, undefined)).toBe(true)
  })

  it('`buit` es la ÚNICA que se cumple sin respuesta', () => {
    expect(avaluarCondicio('buit', null, undefined)).toBe(true)
    for (const op of ['=', '!=', 'in', 'conte', '>=', '<='] as const) {
      expect(avaluarCondicio(op, 'x', undefined), op).toBe(false)
      expect(avaluarCondicio(op, 'x', null), op).toBe(false)
    }
  })

  it('`=` y `!=` comparan al nivel del JSON', () => {
    expect(avaluarCondicio('=', true, true)).toBe(true)
    expect(avaluarCondicio('=', true, false)).toBe(false)
    expect(avaluarCondicio('=', 'si', 'si')).toBe(true)
    expect(avaluarCondicio('!=', 'si', 'no')).toBe(true)
    // Arrays y objetos: `jsonb` los compara por contenido, no por identidad.
    expect(avaluarCondicio('=', ['a', 'b'], ['a', 'b'])).toBe(true)
    expect(avaluarCondicio('=', ['a', 'b'], ['b', 'a'])).toBe(false)
  })

  it('`in` mira si la RESPUESTA está entre los valores de la regla', () => {
    expect(avaluarCondicio('in', ['a', 'b'], 'b')).toBe(true)
    expect(avaluarCondicio('in', ['a', 'b'], 'c')).toBe(false)
    // «jsonb_typeof(p_valor) <> 'array' → false»
    expect(avaluarCondicio('in', 'a', 'a')).toBe(false)
  })

  it('`conte` mira al revés: si la respuesta múltiple incluye el valor', () => {
    expect(avaluarCondicio('conte', 'calibre', ['calibre', 'estetic'])).toBe(true)
    expect(avaluarCondicio('conte', 'plaga', ['calibre'])).toBe(false)
    // «si v_tipus <> 'array' → false»: una respuesta que no es lista no contiene nada.
    expect(avaluarCondicio('conte', 'calibre', 'calibre')).toBe(false)
  })

  it('`>=` y `<=` exigen que LOS DOS sean números', () => {
    expect(avaluarCondicio('>=', 5, 7)).toBe(true)
    expect(avaluarCondicio('>=', 5, 5)).toBe(true)
    expect(avaluarCondicio('>=', 5, 3)).toBe(false)
    expect(avaluarCondicio('<=', 5, 3)).toBe(true)
    // El caso que la cabecera de `avaluar_regla` pone como ejemplo:
    //   select public.avaluar_regla('>=', '5'::jsonb, '"molt"'::jsonb);  -- f
    expect(avaluarCondicio('>=', 5, 'molt')).toBe(false)
    // Y una cadena numérica NO es un número en jsonb. Si aquí se aceptara, la pantalla
    // enseñaría una pregunta que el servidor descarta.
    expect(avaluarCondicio('>=', 5, '7')).toBe(false)
  })

  it('un operador desconocido es false, nunca una excepción', () => {
    // «ANTE UN TIPO QUE NO CUADRA, false, NUNCA UN ERROR»: una regla mal configurada
    // produce una medida de menos, no una organización que no puede guardar su diagnóstico.
    expect(avaluarCondicio('vete-a-saber' as never, 'x', 'x')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('preguntaAplica', () => {
  it('sin `aplica_a` aplica siempre', () => {
    expect(preguntaAplica(pregunta({ id: 'a' }), {})).toBe(true)
    expect(preguntaAplica(pregunta({ id: 'a', aplica_a: null }), {})).toBe(true)
  })

  it('el operador por defecto es `=`', () => {
    const p = pregunta({ id: 'dies', aplica_a: { pregunta: 'fred', valor: true } })
    expect(preguntaAplica(p, { fred: true })).toBe(true)
    expect(preguntaAplica(p, { fred: false })).toBe(false)
  })

  it('una hija de una padre que tampoco aplicaba NO aplica, sin recursión', () => {
    // Es lo que documenta `pregunta_aplica()`: si la padre no aplicó, su respuesta no está,
    // y cualquier operador que no sea `buit` devuelve false.
    const filla = pregunta({ id: 'neta', aplica_a: { pregunta: 'filla', operador: '=', valor: true } })
    expect(preguntaAplica(filla, {})).toBe(false)
  })

  it('una condición que apunta a una pregunta inexistente no aplica (no revienta)', () => {
    const p = pregunta({ id: 'a', aplica_a: { pregunta: 'no_existeix', operador: '=', valor: 1 } })
    expect(preguntaAplica(p, { a: 1 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('obligatoriesQueFalten: el espejo de diagnostic_falten', () => {
  const preguntes = [
    pregunta({ id: 'fred', tipus: 'boolea', obligatoria: true }),
    pregunta({
      id: 'dies', tipus: 'numero', obligatoria: true,
      aplica_a: { pregunta: 'fred', operador: '=', valor: true },
    }),
    pregunta({ id: 'notes', obligatoria: false }),
  ]

  it('una obligatoria sin contestar falta', () => {
    expect(obligatoriesQueFalten(preguntes, {})).toEqual(['fred'])
  })

  it('una obligatoria contestada con `false` NO falta', () => {
    // Es la diferencia entre «ha dicho que no» y «no ha dicho nada». Y con `fred = false`
    // la condicional deja de aplicar, así que tampoco falta ella.
    expect(obligatoriesQueFalten(preguntes, { fred: false })).toEqual([])
  })

  it('una obligatoria CONDICIONAL solo falta cuando su condición se cumple', () => {
    expect(obligatoriesQueFalten(preguntes, { fred: true })).toEqual(['dies'])
    expect(obligatoriesQueFalten(preguntes, { fred: true, dies: 4 })).toEqual([])
  })

  it('una opcional nunca falta', () => {
    expect(obligatoriesQueFalten(preguntes, { fred: false, notes: '' })).toEqual([])
  })

  it('devuelve IDS, no un booleano: la pantalla tiene que poder señalar cuáles', () => {
    const dues = [
      pregunta({ id: 'a', obligatoria: true }),
      pregunta({ id: 'b', obligatoria: true }),
    ]
    expect(obligatoriesQueFalten(dues, {})).toEqual(['a', 'b'])
  })
})

// ---------------------------------------------------------------------------
describe('lo que se ve', () => {
  const preguntes = [
    pregunta({ id: 'fred', tipus: 'boolea', seccio: 'conservacio', obligatoria: true }),
    pregunta({
      id: 'dies', tipus: 'numero', seccio: 'conservacio',
      aplica_a: { pregunta: 'fred', operador: '=', valor: true },
    }),
    pregunta({ id: 'notes', seccio: 'seguiment' }),
  ]

  it('preguntesQueApliquen esconde la condicional hasta que toca', () => {
    expect(preguntesQueApliquen(preguntes, {}).map((p) => p.id)).toEqual(['fred', 'notes'])
    expect(preguntesQueApliquen(preguntes, { fred: true }).map((p) => p.id))
      .toEqual(['fred', 'dies', 'notes'])
  })

  it('agrupaPerSeccio respeta el orden DEL CUESTIONARIO, no el nuestro', () => {
    // `conservacio` va después de `planificacio` en `SECCIONS_CONEGUDES`, pero aquí aparece
    // primero: quien redacta el cuestionario decide el orden, y reordenarlo haría que
    // publicar una versión nueva no cambiara lo que se ve.
    const grups = agrupaPerSeccio(preguntes, {})
    expect(grups.map((g) => g.seccio)).toEqual(['conservacio', 'seguiment'])
    expect(grups[0].preguntes.map((p) => p.id)).toEqual(['fred'])
  })

  it('una sección desconocida se queda sin clave, para pintarla tal cual', () => {
    const grups = agrupaPerSeccio([pregunta({ id: 'x', seccio: 'annex_b_nou' })], {})
    expect(grups[0].clau).toBeNull()
    expect(clauSeccio('planificacio')).toBe('diag.sec_planificacio')
  })

  it('el progreso solo cuenta lo que aplica', () => {
    expect(progresDiagnostic(preguntes, {})).toEqual({ contestades: 0, total: 2, pct: 0 })
    expect(progresDiagnostic(preguntes, { fred: true })).toEqual({ contestades: 1, total: 3, pct: 33 })
  })
})

// ---------------------------------------------------------------------------
describe('prefill: proponer, nunca inventar', () => {
  it('un booleano llena una pregunta booleana', () => {
    expect(prefillPregunta(pregunta({ id: 'a', tipus: 'boolea' }), true)).toBe(true)
    expect(prefillPregunta(pregunta({ id: 'a', tipus: 'boolea' }), false)).toBe(false)
    expect(prefillPregunta(pregunta({ id: 'a', tipus: 'boolea' }), 'sí')).toBeUndefined()
  })

  it('un booleano NO llena una pregunta de selección múltiple', () => {
    // Es el caso real de `entidades.productes_frescos` → `productes_acceptats`: la columna
    // es un booleano y la pregunta pide una lista de familias. Mapearlo sería escribir una
    // respuesta plausible y falsa dentro de un documento con el sello de la Fundación.
    const p = pregunta({
      id: 'acceptats', tipus: 'multi',
      opcions: [{ valor: 'fruita', etiqueta: { ca: 'Fruita', es: 'Fruta' } }],
    })
    expect(prefillPregunta(p, true)).toBeUndefined()
  })

  it('una lista que no casa con ninguna opción no propone nada', () => {
    // `productores.productos_habituales` guarda nombres de producto («Poma») y las opciones
    // son familias (`fruita_dolca`): no hay correspondencia, así que no se propone nada.
    const p = pregunta({
      id: 'principals', tipus: 'multi',
      opcions: [{ valor: 'fruita_dolca', etiqueta: { ca: 'Fruita dolça', es: 'Fruta dulce' } }],
    })
    expect(prefillPregunta(p, ['Poma', 'Pera'])).toBeUndefined()
    // Y de una lista mixta se quedan SOLO los válidos.
    expect(prefillPregunta(p, ['Poma', 'fruita_dolca'])).toEqual(['fruita_dolca'])
  })

  it('una opción que no existe en el cuestionario no se propone', () => {
    const p = pregunta({
      id: 'volum', tipus: 'opcio',
      opcions: [{ valor: 'menys_1000', etiqueta: { ca: 'Menys', es: 'Menos' } }],
    })
    expect(prefillPregunta(p, 'menys_1000')).toBe('menys_1000')
    expect(prefillPregunta(p, 'un_munt')).toBeUndefined()
  })

  it('un número puede llegar como cadena (numeric de Postgres)', () => {
    const p = pregunta({ id: 'dies', tipus: 'numero' })
    expect(prefillPregunta(p, '12')).toBe(12)
    expect(prefillPregunta(p, 'dotze')).toBeUndefined()
  })

  it('prefillDesDeFitxa lee la COLUMNA del `taula.columna`', () => {
    const preguntes = [
      pregunta({ id: 'transport', tipus: 'boolea', prefill: 'entidades.transport_plataforma' }),
      pregunta({ id: 'sense', tipus: 'boolea' }),
    ]
    expect(prefillDesDeFitxa(preguntes, { transport_plataforma: true })).toEqual({ transport: true })
    // Una columna nula no propone nada, y una pregunta sin `prefill` tampoco.
    expect(prefillDesDeFitxa(preguntes, { transport_plataforma: null })).toEqual({})
    expect(prefillDesDeFitxa(preguntes, null)).toEqual({})
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
describe('seccionsAmbEstat: los chips del formulario (T3)', () => {
  const preguntes = [
    pregunta({ id: 'a', seccio: 'productes', obligatoria: true }),
    pregunta({ id: 'b', seccio: 'productes' }),
    pregunta({ id: 'c', seccio: 'causes', obligatoria: true }),
    pregunta({ id: 'd', seccio: 'relacio' }),
    // Condicional: solo aplica si `a` vale «si».
    pregunta({ id: 'e', seccio: 'relacio', obligatoria: true, aplica_a: { pregunta: 'a', operador: '=', valor: 'si' } }),
  ]
  const estat = (r: Record<string, unknown>) => seccionsAmbEstat(agrupaPerSeccio(preguntes, r), r)

  it('una sección por grupo, en el orden del cuestionario, con su clave', () => {
    const e = estat({})
    expect(e.map((s) => s.seccio)).toEqual(['productes', 'causes', 'relacio'])
    expect(e[0].clau).toBe('diag.sec_productes')
  })

  it('cuenta lo que aplica, lo contestado y las obligatorias pendientes', () => {
    const [prod, causes, rel] = estat({ a: 'no', b: 'x' })
    expect(prod).toMatchObject({ n: 2, contestades: 2, falten: 0, completa: true })
    expect(causes).toMatchObject({ n: 1, contestades: 0, falten: 1, completa: false })
    // `e` no aplica (a ≠ si): no cuenta ni como pendiente.
    expect(rel).toMatchObject({ n: 1, contestades: 0, falten: 0 })
  })

  it('una sección de opcionales sin tocar NO está completa: está sin empezar', () => {
    const rel = estat({ a: 'no' })[2]
    expect(rel.falten).toBe(0)
    expect(rel.completa).toBe(false)
  })

  it('una condicional que pasa a aplicar vuelve a dejar la sección pendiente', () => {
    const rel = estat({ a: 'si', d: 'ok' })[2]
    expect(rel).toMatchObject({ n: 2, contestades: 1, falten: 1, completa: false })
  })

  it('el id del título es estable (el destino del chip)', () => {
    expect(idSeccio('causes')).toBe('diag-sec-causes')
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

describe('opcionsVisibles: «dels que has marcat»', () => {
  const op = (v: string) => ({ valor: v, etiqueta: { ca: v, es: v } })
  const principals = pregunta({
    id: 'productes_principals', tipus: 'multi', opcions: ['a', 'b', 'c'].map(op),
  })

  it('sin respuesta arriba, todas las opciones', () => {
    expect(opcionsVisibles(principals, {}).map((o) => o.valor)).toEqual(['a', 'b', 'c'])
  })

  it('con respuesta arriba, solo lo marcado', () => {
    expect(opcionsVisibles(principals, { productes: ['c', 'a'] }).map((o) => o.valor))
      .toEqual(['a', 'c'])
  })

  it('lo ya elegido se queda aunque se desmarque arriba, para poder quitarlo', () => {
    expect(opcionsVisibles(principals, { productes: ['a'], productes_principals: ['b'] })
      .map((o) => o.valor)).toEqual(['a', 'b'])
  })

  it('una pregunta que no deriva de otra no cambia', () => {
    const altra = pregunta({ id: 'causes', tipus: 'multi', opcions: ['a', 'b'].map(op) })
    expect(opcionsVisibles(altra, { productes: ['a'] })).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
describe('los tipos de la ficha viva (fase 9)', () => {
  const cataleg = [
    { nombre: 'Tomàquet', familia: 'Horta Fruit' },
    { nombre: 'Carbassó', familia: 'Horta Fruit' },
    { nombre: 'Poma', familia: 'Fruita Dolça' },
  ]
  const productes = pregunta({ id: 'productes', tipus: 'productes', familia_de: 'families' })
  const principals = pregunta({ id: 'principals', tipus: 'productes', opcions_de: 'productes', max: 2 })

  it('el catálogo se filtra por las familias contestadas', () => {
    expect(opcionsProductes(productes, { families: ['Horta Fruit'] }, cataleg)).toEqual(['Tomàquet', 'Carbassó'])
    expect(opcionsProductes(productes, {}, cataleg)).toEqual([])
  })

  it('los principales salen de lo contestado arriba, y lo marcado no desaparece', () => {
    expect(opcionsProductes(principals, { productes: ['Poma'] }, cataleg)).toEqual(['Poma'])
    expect(opcionsProductes(principals, { productes: ['Poma'], principals: ['Tomàquet'] }, cataleg))
      .toEqual(['Poma', 'Tomàquet'])
  })

  it('al guardar se quita lo que ya no toca', () => {
    const volum = pregunta({ id: 'volum', tipus: 'per_producte_num', productes_de: 'principals' })
    const temporada = pregunta({ id: 'temp', tipus: 'mesos', productes_de: 'principals' })
    const r = netejaRespostes([principals, volum, temporada], {
      principals: ['Tomàquet', 'Poma', 'Carbassó'],
      volum: { Tomàquet: 1000, Pera: 50, Poma: 'molt' },
      temp: { Tomàquet: [9, 6, 6, 13], Pera: [1] },
    })
    expect(r.principals).toEqual(['Tomàquet', 'Poma'])
    expect(r.volum).toEqual({ Tomàquet: 1000 })
    expect(r.temp).toEqual({ Tomàquet: [6, 9] })
  })

  it('una respuesta por producto que se queda vacía desaparece', () => {
    const volum = pregunta({ id: 'volum', tipus: 'per_producte_num', productes_de: 'principals' })
    expect(netejaRespostes([volum], { principals: ['Poma'], volum: { Pera: 3 } })).toEqual({ principals: ['Poma'] })
  })

  it('meses válidos: enteros de 1 a 12, ordenados y sin repetir', () => {
    expect(mesosValids([12, 1, 1, 0, 7.5, '3'])).toEqual([1, 12])
    expect(mesosValids('x')).toEqual([])
  })

  it('el prefill de productos acepta los nombres de la ficha', () => {
    expect(prefillPregunta(productes, ['Poma', '', 3])).toEqual(['Poma'])
    expect(prefillPregunta(pregunta({ id: 'u', tipus: 'ubicacio' }), ['x'])).toBeUndefined()
  })

  it('una obligatoria por producto con el objeto vacío cuenta como pendiente', () => {
    const volum = pregunta({ id: 'volum', tipus: 'per_producte_num', productes_de: 'p', obligatoria: true })
    expect(obligatoriesQueFalten([volum], { volum: {} })).toEqual(['volum'])
    expect(obligatoriesQueFalten([volum], { volum: { Poma: 1 } })).toEqual([])
  })
})
