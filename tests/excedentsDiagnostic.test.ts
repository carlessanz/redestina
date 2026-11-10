// Los excedentes del diagnóstico en EDICIÓN (Plan 2, A3, `20270522100000`):
// `src/lib/excedentsDiagnostic.ts`.
//
// Lo que se vigila: (1) el estado sale de lo guardado + los principales VIVOS de la Operativa
// (principal nuevo = bloque vacío; guardado de un no-principal = conservado; no guardado de un
// no-principal = fuera); (2) las operaciones; (3) el payload que reemplaza el conjunto; (4)
// `perdues()`, que cuenta lo que se borraría; (5) `faltenLocal()`, ESPEJO de
// `diagnostic_falten_productor()` (mismos códigos, mismo orden); (6) los chips y los textos.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DICTS } from '../src/lib/i18n'
import { blocsExcedents } from '../src/lib/excedentsLlegible'
import {
  alternaCausa, blocsAEdicio, estatInicial, estilEstatAccio, faltenLocal, llistaTextos, parteixFalta,
  payloadExcedents, perdues, posaAccio, posaCampCausa, posaCauses, posaDestins, posaGestio, posaObservacions,
  posaSenseExcedent, seccionsDiagnostic, sincronitzaPrincipals, textFalta, treuBloc, volumDeText, volumValid,
  type EstatExcedents,
} from '../src/lib/excedentsDiagnostic'
import type { CausaCataleg } from '../src/types'

const CATALEG: CausaCataleg[] = [
  { codigo: 'CE', nombre: 'Criteris Estètics', nombre_es: 'Criterios estéticos' },
  { codigo: 'EX', nombre: 'Excedent', nombre_es: 'Excedente' },
  { codigo: 'PR', nombre: 'Preu', nombre_es: 'Precio' },
]

/** Lo que devolvería `diagnostic_excedents_json()`: Tomàquet principal, Ceba conservada. */
const GUARDAT = [
  {
    producte: 'Tomàquet', principal: true, ordre: 1, sense_excedent: false, observacions: 'Sobretot a l’agost',
    causes: [{
      id: 'e1', causa: 'EX', causa_nom: { ca: 'Excedent', es: 'Excedente' }, frequencia: 'estacional', volum_kg: 500,
      gestio_actual: ['donacio', 'residu'], destins: ['donacio', 'venda'], detall: null,
      accions: [
        { id: 'a1', desti: 'donacio', descripcio: 'Conveni amb un banc', estat: 'feta', notes: 'Signat', feta_at: '2026-11-01', actualitzat_at: null },
        { id: 'a2', desti: 'venda', descripcio: 'Mercat local', estat: 'pendent', notes: null, feta_at: null, actualitzat_at: null },
      ],
    }],
  },
  {
    producte: 'Ceba', principal: false, ordre: null, sense_excedent: true, observacions: null, causes: [],
  },
]

const P = (...x: string[]) => x

describe('el estado: lo guardado + los principales vivos', () => {
  it('lo guardado pasa a edición sin perder nada', () => {
    const e = blocsAEdicio(blocsExcedents(GUARDAT))
    expect(e[0]).toMatchObject({ producte: 'Tomàquet', persistit: true, observacions: 'Sobretot a l’agost' })
    expect(e[0].causes[0]).toMatchObject({
      causa: 'EX', frequencia: 'estacional', volum: '500', gestio: ['donacio', 'residu'], destins: ['donacio', 'venda'],
      accions: { donacio: 'Conveni amb un banc', venda: 'Mercat local' },
    })
  })

  it('un principal nuevo aparece como bloque vacío, en el orden de los principales', () => {
    const e = estatInicial(GUARDAT, P('Carbassó', 'Tomàquet'))
    expect(e.map((b) => [b.producte, b.principal, b.persistit])).toEqual([
      ['Carbassó', true, false], ['Tomàquet', true, true], ['Ceba', false, true],
    ])
    expect(e[0].causes).toEqual([])
  })

  it('un bloque guardado de un producto que ya no es principal se conserva (decisión a)', () => {
    const e = estatInicial(GUARDAT, P('Carbassó'))
    expect(e.map((b) => [b.producte, b.principal])).toEqual([['Carbassó', true], ['Ceba', false], ['Tomàquet', false]])
    // Los conservados, por nombre (como los ordena el servidor).
    expect(e.find((b) => b.producte === 'Tomàquet')!.causes[0].accions.donacio).toBe('Conveni amb un banc')
  })

  it('un bloque NO guardado de un no-principal desaparece', () => {
    let e = estatInicial(GUARDAT, P('Tomàquet', 'Carbassó'))
    e = posaSenseExcedent(e, 'Carbassó', true)
    expect(sincronitzaPrincipals(e, P('Tomàquet')).map((b) => b.producte)).toEqual(['Tomàquet', 'Ceba'])
  })

  it('volver a marcar un principal recupera su bloque guardado como principal', () => {
    const e = estatInicial(GUARDAT, P('Carbassó'))
    expect(sincronitzaPrincipals(e, P('Tomàquet', 'Carbassó'))[0]).toMatchObject({ producte: 'Tomàquet', principal: true })
  })

  it('llistaTextos limpia, sin vacíos ni repetidos', () => {
    expect(llistaTextos([' A', 'A', '', 3, 'B'])).toEqual(['A', 'B'])
    expect(llistaTextos(null)).toEqual([])
  })
})

describe('operaciones', () => {
  const base = (): EstatExcedents => estatInicial([], P('Tomàquet'))

  it('añadir y quitar causas: por código, con el nombre del catálogo', () => {
    let e = posaCauses(base(), 'Tomàquet', ['PR', 'CE'], CATALEG)
    expect(e[0].causes.map((c) => c.causa)).toEqual(['CE', 'PR'])
    expect(e[0].causes[0].causa_nom).toEqual({ ca: 'Criteris Estètics', es: 'Criterios estéticos' })
    e = posaCampCausa(e, 'Tomàquet', 'CE', 'frequencia', 'mensual')
    e = alternaCausa(e, 'Tomàquet', 'PR', CATALEG)
    expect(e[0].causes.map((c) => c.causa)).toEqual(['CE'])
    // La que sigue conserva lo que tenía.
    expect(e[0].causes[0].frequencia).toBe('mensual')
    e = alternaCausa(e, 'Tomàquet', 'EX', CATALEG)
    expect(e[0].causes.map((c) => c.causa)).toEqual(['CE', 'EX'])
  })

  it('quitar un destino quita su acción; los destinos van en el orden de DESTINS', () => {
    let e = posaCauses(base(), 'Tomàquet', ['EX'], CATALEG)
    e = posaDestins(e, 'Tomàquet', 'EX', ['maquila', 'donacio'])
    expect(e[0].causes[0].destins).toEqual(['donacio', 'maquila'])
    e = posaAccio(e, 'Tomàquet', 'EX', 'donacio', 'Banc')
    e = posaAccio(e, 'Tomàquet', 'EX', 'maquila', 'Conserves')
    e = posaDestins(e, 'Tomàquet', 'EX', ['maquila'])
    expect(e[0].causes[0].accions).toEqual({ maquila: 'Conserves' })
  })

  it('gestión, observaciones y «sense excedent» (que guarda las causas en memoria)', () => {
    let e = posaCauses(base(), 'Tomàquet', ['EX'], CATALEG)
    e = posaGestio(e, 'Tomàquet', 'EX', ['residu', 'residu', 'donacio'])
    expect(e[0].causes[0].gestio).toEqual(['residu', 'donacio'])
    e = posaObservacions(e, 'Tomàquet', 'Nota')
    e = posaSenseExcedent(e, 'Tomàquet', true)
    expect(e[0]).toMatchObject({ sense_excedent: true, observacions: 'Nota' })
    expect(e[0].causes).toHaveLength(1)
    expect(posaSenseExcedent(e, 'Tomàquet', false)[0].causes).toHaveLength(1)
  })

  it('una operación sobre un producto que no estaba crea su bloque', () => {
    const e = posaSenseExcedent([], 'Pera', true)
    expect(e).toEqual([expect.objectContaining({ producte: 'Pera', sense_excedent: true, persistit: false })])
  })

  it('«Treu-lo» quita el bloque conservado', () => {
    const e = estatInicial(GUARDAT, P('Tomàquet'))
    expect(treuBloc(e, 'Ceba').map((b) => b.producte)).toEqual(['Tomàquet'])
  })
})

describe('payloadExcedents', () => {
  it('con «sense excedent», sin causas; textos limpios; acciones solo con texto y destino marcado', () => {
    let e = estatInicial([], P('Tomàquet', 'Pera'))
    e = posaCauses(e, 'Tomàquet', ['EX'], CATALEG)
    e = posaCampCausa(e, 'Tomàquet', 'EX', 'volum', '250,5')
    e = posaCampCausa(e, 'Tomàquet', 'EX', 'detall', '  ')
    e = posaDestins(e, 'Tomàquet', 'EX', ['donacio', 'venda'])
    e = posaAccio(e, 'Tomàquet', 'EX', 'donacio', '  Banc  ')
    e = posaAccio(e, 'Tomàquet', 'EX', 'venda', '   ')
    e = posaObservacions(e, 'Tomàquet', ' ')
    e = posaCauses(e, 'Pera', ['CE'], CATALEG)
    e = posaSenseExcedent(e, 'Pera', true)
    expect(payloadExcedents(e)).toEqual([
      {
        producte: 'Tomàquet', sense_excedent: false, observacions: null,
        causes: [{
          causa: 'EX', frequencia: null, volum_kg: 250.5, gestio_actual: [], destins: ['donacio', 'venda'], detall: null,
          accions: [{ desti: 'donacio', descripcio: 'Banc' }],
        }],
      },
      { producte: 'Pera', sense_excedent: true, observacions: null, causes: [] },
    ])
  })

  it('un bloque vacío del todo no viaja (si estaba guardado, se borra)', () => {
    const e = estatInicial([], P('Tomàquet'))
    expect(payloadExcedents(e)).toEqual([])
  })

  it('un conservado viaja tal cual (se conserva); quitado, ya no', () => {
    const e = estatInicial(GUARDAT, P('Carbassó'))
    expect(payloadExcedents(e).map((b) => b.producte)).toEqual(['Ceba', 'Tomàquet'])
    expect(payloadExcedents(treuBloc(e, 'Tomàquet')).map((b) => b.producte)).toEqual(['Ceba'])
  })

  it('los kilos: número, vacío = null, un texto no numérico viaja tal cual (lo rechaza el servidor)', () => {
    expect(volumDeText('')).toBeNull()
    expect(volumDeText(' 12 ')).toBe(12)
    expect(volumDeText('1,5')).toBe(1.5)
    expect(volumDeText('molt')).toBe('molt')
    expect(volumValid('0')).toBe(true)
    expect(volumValid('-3')).toBe(false)
    expect(volumValid('')).toBe(false)
  })
})

describe('perdues: las acciones guardadas que se borrarían', () => {
  const abans = blocsExcedents(GUARDAT)

  it('sin cambios, ninguna', () => {
    expect(perdues(abans, payloadExcedents(estatInicial(GUARDAT, P('Tomàquet'))))).toBe(0)
  })

  it('dejar de ser principal no pierde nada (se conserva)', () => {
    expect(perdues(abans, payloadExcedents(estatInicial(GUARDAT, P())))).toBe(0)
  })

  it('quitar un destino, vaciar un texto, quitar la causa o el bloque', () => {
    const e = estatInicial(GUARDAT, P('Tomàquet'))
    expect(perdues(abans, payloadExcedents(posaDestins(e, 'Tomàquet', 'EX', ['donacio'])))).toBe(1)
    expect(perdues(abans, payloadExcedents(posaAccio(e, 'Tomàquet', 'EX', 'venda', ' ')))).toBe(1)
    expect(perdues(abans, payloadExcedents(alternaCausa(e, 'Tomàquet', 'EX')))).toBe(2)
    expect(perdues(abans, payloadExcedents(posaSenseExcedent(e, 'Tomàquet', true)))).toBe(2)
    expect(perdues(abans, payloadExcedents(treuBloc(estatInicial(GUARDAT, P()), 'Tomàquet')))).toBe(2)
  })
})

describe('faltenLocal: espejo de diagnostic_falten_productor()', () => {
  const op = { habituals: P('Tomàquet', 'Carbassó'), principals: P('Tomàquet', 'Carbassó'), llocOk: true }

  it('los tres de la Operativa, en su orden', () => {
    expect(faltenLocal([], { habituals: [], principals: [], llocOk: false }))
      .toEqual(['operativa_productes', 'operativa_principals', 'operativa_lloc'])
  })

  it('por principal en su orden: excedents:<p>, después dades:<p>:<causa> por código', () => {
    let e = estatInicial([], op.principals)
    e = posaCauses(e, 'Carbassó', ['PR', 'CE'], CATALEG)
    e = posaCampCausa(e, 'Carbassó', 'CE', 'frequencia', 'puntual')
    e = posaCampCausa(e, 'Carbassó', 'CE', 'volum', '10')
    e = posaGestio(e, 'Carbassó', 'CE', ['residu'])
    expect(faltenLocal(e, op)).toEqual(['excedents:Tomàquet', 'dades:Carbassó:PR'])
    e = posaSenseExcedent(e, 'Tomàquet', true)
    e = posaCampCausa(e, 'Carbassó', 'PR', 'frequencia', 'mensual')
    e = posaCampCausa(e, 'Carbassó', 'PR', 'volum', '0')
    expect(faltenLocal(e, op)).toEqual(['dades:Carbassó:PR'])
    e = posaGestio(e, 'Carbassó', 'PR', ['altres'])
    expect(faltenLocal(e, op)).toEqual([])
  })

  it('los conservados no cuentan (decisión a)', () => {
    const e = estatInicial([{ ...GUARDAT[0], causes: [{ ...GUARDAT[0].causes[0], frequencia: null }] }], P('Carbassó'))
    expect(faltenLocal(e, { ...op, principals: P('Carbassó') })).toEqual(['excedents:Carbassó'])
  })

  it('el fixture del arnés (Tomàquet × EX, estacional, 500 kg, gestión) está completo', () => {
    const e = estatInicial(GUARDAT, P('Tomàquet'))
    expect(faltenLocal(e, { habituals: P('Tomàquet', 'Carbassó'), principals: P('Tomàquet'), llocOk: true })).toEqual([])
  })

  it('el SQL de la migración tiene los mismos códigos', () => {
    const sql = readFileSync('supabase/migrations/20270522100000_diagnostic_excedents.sql', 'utf8')
    for (const c of ["'operativa_productes'", "'operativa_principals'", "'operativa_lloc'", "'excedents:'", "'dades:'"]) {
      expect(sql, c).toContain(c)
    }
  })
})

describe('textos y chips', () => {
  const t = (clau: string, vars?: Record<string, string | number>) => {
    const s = DICTS.ca[clau] ?? clau
    return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`))
  }

  it('parteixFalta separa producto y causa (el producto puede llevar «:»)', () => {
    expect(parteixFalta('dades:Pera: conferència:EX')).toEqual({ tipus: 'dades', producte: 'Pera: conferència', causa: 'EX' })
    expect(parteixFalta('excedents:Pera')).toEqual({ tipus: 'excedents', producte: 'Pera' })
    expect(parteixFalta('operativa_lloc')).toEqual({ tipus: 'operativa_lloc' })
  })

  it('textFalta traduce cada código; uno desconocido sale tal cual', () => {
    expect(textFalta('excedents:Pera', t)).toContain('Pera')
    expect(textFalta('dades:Pera:EX', t, (c) => (c === 'EX' ? 'Excedent' : c))).toMatch(/Pera · Excedent/)
    expect(textFalta('operativa_lloc', t)).not.toMatch(/dexc\./)
    expect(textFalta('inventat', t)).toBe('inventat')
  })

  it('las claves compuestas existen en los dos idiomas, con sus marcadores', () => {
    for (const lang of ['ca', 'es'] as const) {
      for (const k of ['operativa_productes', 'operativa_principals', 'operativa_lloc', 'excedents', 'dades']) {
        expect(DICTS[lang][`dexc.falta_${k}`], `${lang} ${k}`).toBeTruthy()
      }
      expect(DICTS[lang]['dexc.falta_dades']).toContain('{causa}')
      expect(DICTS[lang]['dexc.perdues_t']).toContain('{n}')
      expect(DICTS[lang]['dexc.accio_per']).toContain('{desti}')
    }
  })

  it('seccionsDiagnostic: tres chips con su estado', () => {
    const s = seccionsDiagnostic(['operativa_lloc', 'excedents:Pera', 'dades:Poma:EX', 'dades:Poma:CE'], {
      operativa: { n: 10, contestades: 4 }, principals: 3, accions: 0,
    })
    expect(s.map((x) => [x.seccio, x.clau, x.falten, x.completa])).toEqual([
      ['operativa', 'diag.sec_operativa', 1, false],
      ['excedents', 'dexc.titol', 3, false],
      ['accions', 'dexc.accions', 0, false],
    ])
    expect(s[1].contestades).toBe(1)
    const ok = seccionsDiagnostic([], { operativa: { n: 10, contestades: 4 }, principals: 1, accions: 2 })
    expect(ok.every((x) => x.completa)).toBe(true)
  })

  it('el badge del estado de una acción sale de los tokens', () => {
    for (const e of ['pendent', 'en_curs', 'feta', 'descartada']) {
      expect(estilEstatAccio(e)).toMatch(/^bg-(aviso|secondary|exito|muted)/)
    }
    expect(estilEstatAccio('feta')).toMatch(/exito/)
  })
})
