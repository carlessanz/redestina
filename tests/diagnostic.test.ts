// El diagnóstico de prevención: que la pantalla oculte lo mismo que el servidor descarta, y
// que lo diga en los dos idiomas.
//
// 🔴 POR QUÉ ESTA PRUEBA ES LA QUE SOSTIENE LA FASE. `src/lib/diagnostic.ts` reimplementa en
//    TypeScript la gramática de condiciones que vive en SQL (`avaluar_regla`,
//    20260921231947), porque ocultar una pregunta condicional mientras se escribe no se
//    puede hacer con una ida y vuelta por tecla. Las dos copias tienen que decidir igual, y
//    **divergir no falla: miente**. Si la pantalla oculta una pregunta que el servidor
//    considera aplicable, esa pregunta cuenta como obligatoria sin contestar: el formulario
//    dice «ja està», el botón de emitir responde `falten_obligatories` y nada explica cuál.
//
//    Así que aquí se recorren los ocho operadores contra los casos que el SQL declara
//    explícitamente en su propio cuerpo —el `buit` de cuatro formas, la respuesta ausente,
//    el tipo que no cuadra— y se comparan con el resultado que esa función documenta.
//
// Lo segundo son las CLAVES i18n. Todas las de este módulo se componen
// (`diag.${p}_${etapa}_t`), así que `cobertura.test.ts` —que lee el código como texto y solo
// encuentra literales— no las ve. Es exactamente la puerta por la que se colaron cuatro
// entradas de menú enseñando su identificador en la fase 4.

import { describe, it, expect } from 'vitest'
import { DICTS } from '../src/lib/i18n'
import {
  BLOCS_MESURA, ETAPES_DIAGNOSTIC, ESTATS_DIAGNOSTIC, PASSOS_DIAGNOSTIC_CLAUS,
  SECCIONS_CONEGUDES, agrupaPerSeccio, avaluarCondicio, clauSeccio, esBuit,
  estilEstatDiagnostic, mesuresPerBloc, obligatoriesQueFalten, prefillDesDeFitxa,
  prefillPregunta, preguntaAplica, preguntesQueApliquen, progresDiagnostic,
  puntDiagnostic, textBilingue,
} from '../src/lib/diagnostic'
import type { MesuraPla, PreguntaDiagnostic } from '../src/types'

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
describe('las medidas por bloque', () => {
  const mesura = (codi: string, bloc: MesuraPla['bloc'], obligatoria = false): MesuraPla => ({
    codi, bloc, titol: codi, descripcio: '', obligatoria, origen: 'regla',
  })

  it('van en el orden de BLOCS_MESURA y sin bloques vacíos', () => {
    const grups = mesuresPerBloc([
      mesura('c', 'seguiment'), mesura('a', 'planificacio'), mesura('b', 'seguiment'),
    ])
    expect(grups.map((g) => g.bloc)).toEqual(['planificacio', 'seguiment'])
    expect(grups[1].mesures.map((m) => m.codi)).toEqual(['c', 'b'])
  })

  it('sin medidas no hay ningún grupo', () => {
    expect(mesuresPerBloc([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('el punto del proceso', () => {
  const fets = (estat: Parameters<typeof puntDiagnostic>[0]['estat']) =>
    puntDiagnostic({ estat, faltenN: 3, mesuresN: 5, numero: 'PLA-2026-0001' }, 'org')

  it('cada estado cae en su paso de la escalera', () => {
    expect(fets('sense_comencar').index).toBe(0)
    expect(fets('incomplet').index).toBe(1)
    expect(fets('a_punt').index).toBe(2)
    expect(fets('emes').index).toBe(3)
  })

  it('`sense_questionari` sale del camino y NO le toca a la organización', () => {
    // No es culpa de quien mira: significa que no hay cuestionario vigente, o sea un
    // problema de configuración. Pintarlo en ámbar le diría que le toca algo que no puede
    // hacer.
    const p = fets('sense_questionari')
    expect(p.index).toBe(-1)
    expect(p.emToca).toBe(false)
  })

  it('lo que está hecho ya no le toca a nadie', () => {
    expect(fets('emes').emToca).toBe(false)
    expect(fets('sense_comencar').emToca).toBe(true)
    expect(fets('incomplet').emToca).toBe(true)
    expect(fets('a_punt').emToca).toBe(true)
  })

  it('las dos voces usan prefijos distintos', () => {
    expect(fets('incomplet').claus.titol).toBe('diag.o_responent_t')
    expect(puntDiagnostic(
      { estat: 'incomplet', faltenN: 1, mesuresN: 0 }, 'equip',
    ).claus.titol).toBe('diag.e_responent_t')
  })

  it('el badge de estado sale de los tokens, nunca de un color suelto', () => {
    for (const e of ESTATS_DIAGNOSTIC) {
      const clase = estilEstatDiagnostic(e)
      expect(clase, e).toMatch(/^bg-(exito|aviso|secondary|muted)/)
    }
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

  it('los pasos de la escalera', () => {
    expect(PASSOS_DIAGNOSTIC_CLAUS.length).toBe(ETAPES_DIAGNOSTIC.length)
    for (const c of PASSOS_DIAGNOSTIC_CLAUS) existeix(c)
  })

  it('las secciones y los bloques', () => {
    for (const s of SECCIONS_CONEGUDES) existeix(`diag.sec_${s}`)
    for (const b of BLOCS_MESURA) existeix(`diag.bloc_${b}`)
  })

  it('los cinco estados, con su badge y su línea de tarjeta en las dos voces', () => {
    for (const e of ESTATS_DIAGNOSTIC) {
      existeix(`diag.st_${e}`)
      existeix(`diag.o_card_${e}`)
      existeix(`diag.e_card_${e}`)
    }
  })

  it('la banda solo tiene texto para lo que de verdad queda pendiente', () => {
    for (const e of ['sense_comencar', 'incomplet', 'a_punt']) existeix(`diag.banner_${e}`)
  })

  it('la cuarteta de cada punto del proceso, en las dos voces', () => {
    for (const rol of ['org', 'equip'] as const) {
      for (const estat of ESTATS_DIAGNOSTIC) {
        const punt = puntDiagnostic({ estat, faltenN: 1, mesuresN: 1, numero: 'X' }, rol)
        for (const clau of Object.values(punt.claus)) existeix(clau)
      }
    }
  })

  it('ningún texto del proceso usa un marcador que `vars` no pase', () => {
    // Es el fallo que no da error: `t('x', {n: 3})` sobre un texto con `{kg}` deja el `{kg}`
    // impreso tal cual en la pantalla.
    for (const rol of ['org', 'equip'] as const) {
      for (const estat of ESTATS_DIAGNOSTIC) {
        const punt = puntDiagnostic({ estat, faltenN: 1, mesuresN: 1, numero: 'X' }, rol)
        const passats = new Set(Object.keys(punt.vars))
        for (const idioma of IDIOMES) {
          for (const clau of Object.values(punt.claus)) {
            const marcadors = DICTS[idioma][clau].match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? []
            for (const m of marcadors) {
              expect(passats.has(m.slice(1, -1)), `${clau} (${idioma}) usa ${m}`).toBe(true)
            }
          }
        }
      }
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
