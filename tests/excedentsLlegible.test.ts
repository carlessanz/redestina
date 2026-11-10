// Los excedentes del diagnóstico en lectura (A3, 20270522100000): el módulo hoja
// `_shared/excedentsLlegible.ts` que comparten la pantalla y los PDF (diagnóstico y expediente).
// Vigila tres paridades: las etiquetas del PDF = el diccionario de la pantalla; las listas
// cerradas = los CHECK de la migración; `CAUSES_ES` del intake = el `nombre_es` sembrado.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DICTS } from '../src/lib/i18n'
import {
  blocsExcedents,
  celaAccio,
  celaCausa,
  DESTINS,
  ESTATS_ACCIO,
  filaCausa,
  filesAccions,
  filesCausa,
  FREQUENCIES,
  GESTIONS,
  nomCausa,
  teBlocs,
  textDestins,
  textEstatAccio,
  textFrequencia,
  textGestio,
  textVolum,
  titolBloc,
} from '../src/lib/excedentsLlegible'
import { ETIQUETES_EXCEDENTS, traduccioExcedents } from '../supabase/functions/_shared/excedentsLlegible.ts'
import { CAUSES_ES } from '../supabase/functions/_shared/camposOferta.ts'

const MIGRACIO = readFileSync('supabase/migrations/20270522100000_diagnostic_excedents.sql', 'utf8')

const t = (clau: string) => DICTS.ca[clau] ?? clau

const EXEMPLE = [
  {
    producte: 'Tomàquet', principal: true, ordre: 1, sense_excedent: false, observacions: 'Cada estiu',
    causes: [
      {
        id: 'c1', causa: 'CE', causa_nom: { ca: 'Criteris Estètics', es: 'Criterios estéticos' },
        frequencia: 'setmanal', volum_kg: 1250.5, gestio_actual: ['donacio', 'residu'], destins: ['donacio', 'maquila'],
        detall: 'Calibre petit',
        accions: [
          { id: 'a1', desti: 'donacio', descripcio: 'Banc d’aliments', estat: 'en_curs', notes: 'Dijous', feta_at: null, actualitzat_at: null },
          { id: 'a2', desti: 'maquila', descripcio: 'Salsa', estat: 'pendent', notes: null, feta_at: null, actualitzat_at: null },
        ],
      },
      {
        id: 'c2', causa: 'EX', causa_nom: { ca: 'Excedent', es: 'Excedente' }, frequencia: 'varies_setmana',
        volum_kg: 500, gestio_actual: ['altres'], destins: ['venda'], detall: null,
        accions: [{ id: 'a3', desti: 'venda', descripcio: 'Menjadors', estat: 'feta', notes: null, feta_at: '2026-11-02', actualitzat_at: null }],
      },
    ],
  },
  { producte: 'Pebrot', principal: true, ordre: 2, sense_excedent: true, observacions: null, causes: [] },
  { producte: 'Carxofa', principal: false, ordre: null, sense_excedent: false, observacions: null, causes: [] },
]

/** Los valores de un CHECK `col in ('a', 'b')` o `col <@ array['a', 'b']` de la migración. */
function valorsCheck(constraint: string): string[] {
  const i = MIGRACIO.indexOf(`constraint ${constraint} check`)
  expect(i, constraint).toBeGreaterThan(-1)
  const tros = MIGRACIO.slice(i, MIGRACIO.indexOf(')', MIGRACIO.indexOf('(', MIGRACIO.indexOf('check', i) + 6)) + 1)
  return [...tros.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

describe('las listas cerradas = los CHECK de la migración', () => {
  it('frecuencia, gestión actual, destinos y estado de la acción', () => {
    expect([...FREQUENCIES]).toEqual(valorsCheck('diagnostic_excedents_frequencia'))
    expect([...GESTIONS]).toEqual(valorsCheck('diagnostic_excedents_gestio_actual'))
    expect([...DESTINS]).toEqual(valorsCheck('diagnostic_excedents_destins'))
    expect([...DESTINS]).toEqual(valorsCheck('diagnostic_accions_desti'))
    expect([...ESTATS_ACCIO]).toEqual(valorsCheck('diagnostic_accions_estat'))
  })

  it('los destinos son las modalidades de las ofertas (od.mod_*)', () => {
    for (const d of DESTINS) expect(DICTS.ca[`od.mod_${d}`], d).toBeDefined()
  })
})

describe('CAUSES_ES del intake = causas.nombre_es sembrado en la migración', () => {
  it('mismos códigos y mismos textos', () => {
    const i = MIGRACIO.indexOf('update public.causas c')
    const tros = MIGRACIO.slice(i, MIGRACIO.indexOf(') as v(codigo, nombre_es)', i))
    const sembrat = Object.fromEntries([...tros.matchAll(/\('([A-Z]{2})',\s*'([^']+)'\)/g)].map((m) => [m[1], m[2]]))
    expect(Object.keys(sembrat).length).toBe(8)
    expect(sembrat).toEqual(CAUSES_ES)
  })
})

describe('ETIQUETES_EXCEDENTS del PDF = el diccionario de la pantalla', () => {
  const PREFIXOS = ['dexc.freq_', 'dexc.gestio_', 'dexc.estat_']

  for (const lang of ['ca', 'es'] as const) {
    it(`${lang}: cada etiqueta del PDF es idéntica a la de i18n.tsx`, () => {
      for (const [clau, text] of Object.entries(ETIQUETES_EXCEDENTS[lang])) {
        expect(DICTS[lang][clau], clau).toBe(text)
      }
    })

    it(`${lang}: el PDF tiene todas las opciones que tiene la pantalla`, () => {
      const pantalla = Object.keys(DICTS[lang]).filter((k) => PREFIXOS.some((p) => k.startsWith(p)))
      expect(pantalla.length).toBe(FREQUENCIES.length + GESTIONS.length + ESTATS_ACCIO.length)
      for (const k of pantalla) expect(ETIQUETES_EXCEDENTS[lang][k], k).toBeDefined()
    })

    it(`${lang}: cada valor de las listas tiene su etiqueta`, () => {
      const e = ETIQUETES_EXCEDENTS[lang]
      for (const f of FREQUENCIES) expect(e[`dexc.freq_${f}`], f).toBeDefined()
      for (const g of GESTIONS) expect(e[`dexc.gestio_${g}`], g).toBeDefined()
      for (const s of ESTATS_ACCIO) expect(e[`dexc.estat_${s}`], s).toBeDefined()
      for (const d of DESTINS) expect(e[`od.mod_${d}`], d).toBeDefined()
    })
  }

  it('ca y es tienen las mismas claves', () => {
    expect(Object.keys(ETIQUETES_EXCEDENTS.es).sort()).toEqual(Object.keys(ETIQUETES_EXCEDENTS.ca).sort())
  })

  it('los dos PDF piden solo claves que están (ninguna sale cruda)', () => {
    const fonts = [
      'supabase/functions/_shared/pdf/render/diagnostic.ts',
      'supabase/functions/_shared/pdf/render/expedient.ts',
      'supabase/functions/_shared/excedentsLlegible.ts',
    ].map((f) => readFileSync(f, 'utf8')).join('\n')
    const usades = new Set([...fonts.matchAll(/(?:tEx|t)\(\s*["']((?:dexc)\.[a-z_]+)["']/g)].map((m) => m[1]))
    expect(usades.size).toBeGreaterThan(10)
    for (const k of usades) expect(ETIQUETES_EXCEDENTS.ca[k], k).toBeDefined()
  })
})

describe('blocsExcedents y teBlocs', () => {
  it('normaliza sin lanzar y descarta lo que no es un bloque', () => {
    expect(blocsExcedents(null)).toEqual([])
    expect(blocsExcedents({})).toEqual([])
    expect(teBlocs([])).toBe(false)
    expect(teBlocs(EXEMPLE)).toBe(true)
    const b = blocsExcedents([null, 'x', { producte: ' ' }, {
      producte: 'Ceba', principal: 'sí', causes: [null, { causa: '' }, {
        causa: 'CL', volum_kg: '12.5', gestio_actual: null, destins: ['venda', ''],
        accions: [{ desti: 'venda', descripcio: '  ' }, { desti: 'venda', descripcio: 'X' }],
      }],
    }])
    expect(b).toHaveLength(1)
    expect(b[0].principal).toBe(false)
    expect(b[0].causes).toHaveLength(1)
    expect(b[0].causes[0]).toMatchObject({ volum_kg: 12.5, gestio_actual: [], destins: ['venda'], causa_nom: null })
    expect(b[0].causes[0].accions).toEqual([
      { id: '', desti: 'venda', descripcio: 'X', estat: 'pendent', notes: null, feta_at: null, actualitzat_at: null },
    ])
  })
})

describe('textos y filas', () => {
  const blocs = blocsExcedents(EXEMPLE)

  it('opciones traducidas; un código desconocido sale como código, nunca como clave', () => {
    expect(textFrequencia('varies_setmana', t)).toBe('Diverses vegades per setmana')
    expect(textFrequencia('cada_lluna', t)).toBe('cada_lluna')
    expect(textFrequencia(null, t)).toBe('')
    expect(textGestio(['venda_alternativa', 'altres_aprofitaments', 'x'], t)).toBe('Venda alternativa, Altres aprofitaments, x')
    expect(textDestins(['donacio', 'venda', 'maquila'], t)).toBe('Donació, Venda, Maquila')
    expect(textEstatAccio('en_curs', t)).toBe('En curs')
    expect(textVolum(1250.5, 'ca')).toBe('1.250,5')
    expect(textVolum(null, 'ca')).toBe('')
  })

  it('el nombre de la causa en el idioma, con caída al otro y al código', () => {
    const c = blocs[0].causes[0]
    expect(nomCausa(c, 'ca')).toBe('Criteris Estètics')
    expect(nomCausa(c, 'es')).toBe('Criterios estéticos')
    expect(nomCausa({ causa: 'ZZ', causa_nom: { ca: 'Només ca', es: '' } }, 'es')).toBe('Només ca')
    expect(nomCausa({ causa: 'ZZ', causa_nom: null }, 'ca')).toBe('ZZ')
  })

  it('títulos de bloque: el conservado, marcado', () => {
    expect(titolBloc(blocs[0], t)).toBe('Tomàquet')
    expect(titolBloc(blocs[2], t)).toBe('Carxofa · ja no és principal')
  })

  it('filas de causas y de acciones (con el detalle y la nota de seguimiento)', () => {
    const files = filesCausa(blocs[0], t, 'ca')
    expect(files[0]).toEqual({
      codi: 'CE', causa: 'Criteris Estètics', detall: 'Calibre petit', frequencia: 'Setmanal', volum: '1.250,5',
      gestio: 'Donació, Residu', destins: 'Donació, Maquila',
    })
    expect(celaCausa(files[0], t)).toBe('Criteris Estètics\nDetall: Calibre petit')
    expect(celaCausa(filaCausa(blocs[0].causes[1], t, 'ca'), t)).toBe('Excedent')
    const accions = filesAccions(blocs[0], t, 'ca')
    expect(accions.map((a) => [a.causa, a.desti, a.estat])).toEqual([
      ['Criteris Estètics', 'Donació', 'En curs'],
      ['Criteris Estètics', 'Maquila', 'Pendent'],
      ['Excedent', 'Venda', 'Feta'],
    ])
    expect(celaAccio(accions[0], t)).toBe('Banc d’aliments — Seguiment: Dijous')
    expect(celaAccio(accions[1], t)).toBe('Salsa')
    expect(filesAccions(blocs[1], t, 'ca')).toEqual([])
  })

  it('con la traducción del PDF (es), ninguna clave sin traducir', () => {
    const tEs = traduccioExcedents('es')
    const textos = blocs.flatMap((b) => [
      titolBloc(b, tEs),
      ...filesCausa(b, tEs, 'es').flatMap((f) => [celaCausa(f, tEs), f.frequencia, f.volum, f.gestio, f.destins]),
      ...filesAccions(b, tEs, 'es').flatMap((f) => [f.desti, f.estat, celaAccio(f, tEs)]),
    ])
    expect(textos).toContain('Carxofa · ya no es principal')
    expect(textos).toContain('Varias veces por semana')
    expect(textos).toContain('Hecha')
    for (const x of textos) expect(x).not.toMatch(/\b(dexc|od)\.[a-z_]+/)
  })
})
