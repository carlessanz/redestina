// Las fuentes de los precios de referencia (punto 3, fase D1): los lectores puros de
// `_shared/preusFonts.ts` contra las páginas reales guardadas en `tests/fixtures/preus/`
// (datos públicos descargados el 17-11-2026). El XLS de Gencat se prueba en Deno
// (`tests/preus/gencat_test.ts`), porque el lector de XLS es `npm:xlsx`.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  arrodoneix, candidatsUrlGencat, coincidencies, dataExportMercabarna, exportMercabarnaCaducat,
  factorEurKg, llegeixGencat, llegeixMercabarna, normalitzaNom, numeroCella, observatsMercabarna,
} from '../supabase/functions/_shared/preusFonts.ts'

const FIX = 'tests/fixtures/preus'
const html = readFileSync(`${FIX}/mercabarna-2026-11-16.html`, 'utf8')
const csvTrencat = readFileSync(`${FIX}/mercabarna-export-trencat.csv`, 'latin1')

describe('unidades', () => {
  it('€/100 kg y €/kg son de peso; lo demás, no', () => {
    expect(factorEurKg('€/100 kg')).toBe(0.01)
    expect(factorEurKg('€/100kg')).toBe(0.01)
    expect(factorEurKg('€/kg')).toBe(1)
    expect(factorEurKg('€/100 Litres')).toBeNull()
    expect(factorEurKg('€/ Unitat')).toBeNull()
    expect(factorEurKg('€/100 Dotzenes')).toBeNull()
    expect(factorEurKg('€/100kg viu')).toBeNull()
    expect(factorEurKg('')).toBeNull()
    expect(factorEurKg(null)).toBeNull()
  })
  it('lee números de celda y descarta «-»', () => {
    expect(numeroCella(12.5)).toBe(12.5)
    expect(numeroCella('1,80')).toBe(1.8)
    expect(numeroCella('1.234,50')).toBe(1234.5)
    expect(numeroCella('-')).toBeNull()
    expect(numeroCella('')).toBeNull()
    expect(numeroCella(null)).toBeNull()
  })
  it('redondea a 4 decimales', () => {
    expect(arrodoneix(68.58425686448184 * 0.01)).toBe(0.6858)
  })
})

describe('Gencat (filas sintéticas con la forma del fichero)', () => {
  const cap = ['Codi', 'Producte', 'Any', 'Gen.', 'Feb.', 'Mar.', 'Abr.', 'Mai.', 'Jun.', 'Jul.', 'Ago.', 'Set.', 'Oct.', 'Nov.', 'Des.', 'Anual']
  const full = {
    nom: 'FRUITA',
    files: [
      ['Preus percebuts pel pagès. Catalunya 2020-2026'],
      cap,
      ['052111', 'Poma consum en fresc', 2025, 60, 62, '-', '-', '-', '-', '-', '-', 68, 75, 68, 66, 65],
      [null, '€/100 kg', 2026, 65.7, 65.9, 64.95, 64.97, '-', '-', '-', '-', 68.58, null, null, null, null],
      ['062111', 'Vi blanc DOP+IGP', 2025, 62, 59, 58, 63, 62, '-', '-', '-', '-', '-', 57, 48, 59],
      [null, '€/100 Litres', 2026, 78, 76, 72, 70, 69, '-', '-', '-', '-', null, null, null, null],
      ['038000', 'Safrà', 2026, '-', '-', '-', '-', 6365, 6365, 6365, '-', '-', null, null, null, null],
      [null, '€/kg', null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ],
  }
  it('convierte €/100 kg a €/kg, ignora «-» y las unidades que no son de peso', () => {
    const r = llegeixGencat([{ nom: 'NOTA METODOLÒGICA', files: [['Nota']] }, full])
    const poma = r.observats.filter((o) => o.codi_font === '052111')
    expect(poma).toHaveLength(6 + 5)
    expect(poma.find((o) => o.exercici === 2026 && o.mes === 9)).toMatchObject({
      nom_font: 'Poma consum en fresc', unitat: '€/100 kg', valor_original: 68.58, eur_kg: 0.6858, dia: null,
    })
    expect(poma.some((o) => o.exercici === 2026 && o.mes === 10)).toBe(false)
    expect(r.observats.some((o) => o.codi_font === '062111')).toBe(false)
    expect(r.ignorats).toEqual([{ codi: '062111', nom: 'Vi blanc DOP+IGP', unitat: '€/100 Litres' }])
    // €/kg: tal cual.
    expect(r.observats.find((o) => o.codi_font === '038000' && o.mes === 5)?.eur_kg).toBe(6365)
    expect(r.productes).toBe(2)
    expect(r.fins).toEqual({ exercici: 2026, mes: 9 })
  })
  it('una cabecera con los meses desplazados no se carga', () => {
    const malament = { nom: 'X', files: [['Codi', 'Producte', 'Any', 'Anual', 'Gen.']] }
    expect(() => llegeixGencat([malament])).toThrow('format_desconegut')
  })
  it('propone el año nuevo cuando la dirección da 404', () => {
    const url = 'https://agricultura.gencat.cat/x/Plantilla_Preus_percebuts2020_2026_20.xls'
    expect(candidatsUrlGencat(url, 2027)).toEqual([
      'https://agricultura.gencat.cat/x/Plantilla_Preus_percebuts2020_2027_20.xls',
      'https://agricultura.gencat.cat/x/Plantilla_Preus_percebuts2020_2028_20.xls',
    ])
    expect(candidatsUrlGencat(url, 2026)).toEqual([
      'https://agricultura.gencat.cat/x/Plantilla_Preus_percebuts2020_2027_20.xls',
    ])
    expect(candidatsUrlGencat('https://x/sense-anys.xls', 2027)).toEqual([])
  })
})

describe('Mercabarna (la tabla HTML del 16-11-2026)', () => {
  const r = llegeixMercabarna(html)
  it('lee el día de la página y las 132 filas', () => {
    expect(r.data).toBe('2026-11-16')
    expect(r.files).toHaveLength(132)
    expect(r.files[0]).toEqual({ nom: 'ACEITUNAS', dominant: 1.8, maxim: 2, minim: 1.5 })
    // Los nombres llegan con espacios al final: se recortan.
    expect(r.files.some((f) => f.nom === 'ALBARICOQUES')).toBe(true)
    expect(r.files.every((f) => f.nom === f.nom.trim())).toBe(true)
  })
  it('observaciones del día: €/kg salvo los calçots', () => {
    const obs = observatsMercabarna(r)
    expect(obs).toHaveLength(132)
    const acelgas = obs.find((o) => o.nom_font === 'ACELGAS')!
    expect(acelgas).toMatchObject({ exercici: 2026, mes: 11, dia: 16, valor_original: 0.8, unitat: '€/kg', eur_kg: 0.8, valor_max: 1, valor_min: 0.7 })
    const calcots = obs.find((o) => o.nom_font === 'CALÇOTS')!
    expect(calcots.unitat).toBe('€/unitat')
    expect(calcots.eur_kg).toBeNull()
  })
  it('sin fecha o sin tabla no se guarda nada', () => {
    expect(() => llegeixMercabarna('<html><table class="estadistiques"></table></html>')).toThrow('sense_data')
    expect(() => llegeixMercabarna('<p>Estadístiques de preus del dia 16-11-2026</p>')).toThrow('sense_taula')
    const buida = '<caption>Estadístiques de preus del dia 16-11-2026</caption><table class="estadistiques"><tbody></tbody></table>'
    expect(() => llegeixMercabarna(buida)).toThrow('sense_taula')
  })
  it('detecta la exportación CSV rota (siempre el 07-03-2024)', () => {
    expect(dataExportMercabarna(csvTrencat)).toBe('2024-03-07')
    expect(exportMercabarnaCaducat(csvTrencat, '2026-11-17')).toBe(true)
    expect(exportMercabarnaCaducat('"Fecha: 16-11-2026"', '2026-11-17')).toBe(false)
    expect(exportMercabarnaCaducat('sense data', '2026-11-17')).toBe(true)
  })
})

describe('equivalencias propuestas (ca/es, sin acentos ni mayúsculas)', () => {
  const noms = [
    ...llegeixMercabarna(html).files.map((f) => ({ font: 'mercabarna' as const, codi_font: null, nom_font: f.nom })),
    { font: 'gencat' as const, codi_font: '054049', nom_font: 'Tomàquet per consum en fresc' },
    { font: 'gencat' as const, codi_font: '054170', nom_font: 'Espinacs' },
  ]
  it('normaliza', () => {
    expect(normalitzaNom('Col de Brussel·les')).toBe('col de brusselles')
    expect(normalitzaNom(' MANZANA  ROJA ')).toBe('manzana roja')
    expect(normalitzaNom('Pèsol verd (consum en fresc)')).toBe('pesol verd consum en fresc')
  })
  it('Tomàquet / Tomate: las dos fuentes', () => {
    const c = coincidencies(['Tomàquet', 'Tomate'], noms).map((x) => x.nom_font)
    expect(c).toContain('TOMATE MADURO')
    expect(c).toContain('TOMATE VERDE')
    expect(c).toContain('Tomàquet per consum en fresc')
    expect(c).not.toContain('PATATA ROJA')
  })
  it('singular y plural: Espinac ↔ Espinacs / ESPINACAS', () => {
    const c = coincidencies(['Espinac', 'Espinaca'], noms).map((x) => x.nom_font)
    expect(c).toEqual(expect.arrayContaining(['Espinacs', 'ESPINACAS']))
  })
  it('el nombre exacto puntúa más', () => {
    const c = coincidencies(['Escarola'], noms)
    expect(c[0]).toMatchObject({ nom_font: 'ESCAROLA', punts: 3 })
  })
  it('sin parecido, nada', () => {
    expect(coincidencies(['Xyzzy'], noms)).toEqual([])
  })
})
