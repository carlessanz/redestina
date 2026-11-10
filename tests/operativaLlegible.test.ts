// La Operativa en lectura (A4): de `diagnostic_datos().operativa` a filas del resumen, y la
// sección del diagnóstico que la edita (las columnas del `select` = los campos de la ficha).

import { describe, expect, it } from 'vitest'
import { filesOperativa, textDiesFranges, textMesos } from '../src/lib/operativaLlegible'
import { COLUMNES_OPERATIVA, campsOperativa, podaOperativa, normalitzaValor, CAMPS_FITXA } from '../src/lib/campsFitxa'
import { DICTS } from '../src/lib/i18n'
import { ETIQUETES_OPERATIVA, traduccioOperativa } from '../supabase/functions/_shared/operativaLlegible.ts'
import type { OperativaDiagnostic } from '../src/types'

const t = (clau: string, vars?: Record<string, string | number>) => {
  let s = DICTS.ca[clau] ?? clau
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v))
  return s
}

const BUIDA: OperativaDiagnostic = {
  activitat: null, productes: null, principals: null, varietats: null, volum: null, temporada: null,
  envasos: null, canals: null, clients: null, facturacio_eur: null, facturacio_rang: null,
  volum_comercialitzat_kg: null, suport: null, llocs: [],
}

describe('filesOperativa', () => {
  it('sin nada, ninguna fila', () => {
    expect(filesOperativa(BUIDA, t, 'ca')).toEqual([])
    expect(filesOperativa(null, t, 'ca')).toEqual([])
  })

  it('pinta cada bloque con las etiquetas de la ficha y el principal primero', () => {
    const f = filesOperativa({
      ...BUIDA,
      activitat: ['horta'],
      productes: ['Tomàquet', 'Pebrot'], principals: ['Tomàquet'],
      varietats: { Tomàquet: ['Raf', 'Cor de bou'] },
      volum: { Tomàquet: 12000 }, temporada: { Tomàquet: [8, 6, 7] },
      envasos: ['caixes'], canals: ['venda_directa'], clients: ['consumidors_finals'],
      facturacio_eur: 250000, facturacio_rang: '100k-500k', volum_comercialitzat_kg: 30000,
      suport: ['donacions'],
      llocs: [{ alias: 'Magatzem', municipi: 'Lleida', principal: true, dies: [1, 3], franges: [{ inici: '08:00', fi: '12:00' }], horari: null }],
    }, t, 'ca', (c) => (c === 'horta' ? 'Horticultura' : c))
    const m = Object.fromEntries(f.map((x) => [x.clau, x.text]))
    expect(m['org.f_activitat']).toBe('Horticultura')
    expect(m['f.productos_habituales']).toBe('Tomàquet, Pebrot')
    expect(m['op.f_varietats']).toBe('Tomàquet: Raf, Cor de bou')
    expect(m['op.f_volum']).toMatch(/^Tomàquet: 12\.000 kg\/any$/)
    expect(m['op.f_temporada']).toBe('Tomàquet: jun, jul, ago')
    expect(m['op.f_envasos']).toBe('Caixes')
    expect(m['op.f_canals']).toBe('Venda directa')
    expect(m['op.f_suport']).toBe('Canalitzar donacions')
    expect(m['diag.operativa_llocs']).toBe('Magatzem · Lleida (Principal) — dl, dc · 08:00–12:00')
  })

  it('meses y días fuera de rango no salen', () => {
    expect(textMesos([0, 13, 2, 'x'], 'es')).toBe('feb')
    expect(textDiesFranges({ dies: [0, 7], franges: null }, t)).toBe('dg')
  })
})

describe('la sección Operativa del diagnóstico', () => {
  it('el select literal tiene exactamente las columnas de los campos', () => {
    const literal = COLUMNES_OPERATIVA.split(',').map((c) => c.trim()).sort()
    const camps = campsOperativa().map((c) => c.columnes.productores as string).sort()
    expect(literal).toEqual(camps)
  })

  it('todos los campos los edita también el productor (T4: mismo origen)', () => {
    for (const c of campsOperativa()) expect(c.edita, c.clau).toBe('tots')
  })
})

describe('podaOperativa y normalitzaValor (A4)', () => {
  it('poda principales, variedades, volumen y temporada que dejan de colgar', () => {
    const p = podaOperativa({
      productos_habituales: ['A'],
      productes_principals: ['A', 'B'],
      varietats: { A: ['x'], B: ['y'] },
      volum_produccio: { B: 10 },
      temporada: { A: [1] },
    })
    expect(p).toEqual({ productes_principals: ['A'], varietats: { A: ['x'] }, volum_produccio: null })
  })

  it('las variedades tecleadas como texto se guardan como lista', () => {
    const c = CAMPS_FITXA.find((x) => x.clau === 'varietats')!
    expect(normalitzaValor(c, { A: ' Raf, Raf ,  Cor ', B: '' })).toEqual({ A: ['Raf', 'Cor'] })
    expect(normalitzaValor(c, {})).toBeNull()
  })

  it('kilos y meses inválidos se descartan', () => {
    const kg = CAMPS_FITXA.find((x) => x.clau === 'volum_produccio')!
    expect(normalitzaValor(kg, { A: '1200', B: -1, C: 'x' })).toEqual({ A: 1200 })
    const mes = CAMPS_FITXA.find((x) => x.clau === 'temporada')!
    expect(normalitzaValor(mes, { A: [3, 1, 1, 13] })).toEqual({ A: [1, 3] })
  })
})

describe('ETIQUETES_OPERATIVA del PDF (A2) = el diccionario de la pantalla', () => {
  const PREFIXOS = ['op.env_', 'op.canal_', 'op.client_', 'op.suport_']

  for (const lang of ['ca', 'es'] as const) {
    it(`${lang}: cada etiqueta del PDF es idéntica a la de i18n.tsx`, () => {
      for (const [clau, text] of Object.entries(ETIQUETES_OPERATIVA[lang])) {
        expect(DICTS[lang][clau], clau).toBe(text)
      }
    })

    it(`${lang}: el PDF tiene todas las opciones que tiene la pantalla`, () => {
      const pantalla = Object.keys(DICTS[lang]).filter((k) => PREFIXOS.some((p) => k.startsWith(p)))
      expect(pantalla.length).toBeGreaterThan(20)
      for (const k of pantalla) expect(ETIQUETES_OPERATIVA[lang][k], k).toBeDefined()
    })
  }

  it('con una Operativa llena, el PDF no deja ninguna clave sin traducir', () => {
    const tOp = traduccioOperativa('ca')
    const files = filesOperativa({
      ...BUIDA,
      activitat: ['x'], productes: ['A'], principals: ['A'], varietats: { A: ['v'] }, volum: { A: 1 },
      temporada: { A: [1] }, envasos: ['caixes'], canals: ['altres'], clients: ['altres'],
      facturacio_eur: 1, facturacio_rang: '<100k', volum_comercialitzat_kg: 1, suport: ['altres'],
      llocs: [{ alias: 'L', municipi: null, principal: true, dies: [1, 7], franges: null, horari: null }],
    }, tOp, 'ca')
    expect(files).toHaveLength(14)
    for (const f of files) {
      expect(tOp(f.clau), f.clau).not.toBe(f.clau)
      expect(f.text).not.toMatch(/\b(op|org|diag)\.[a-z_0-9]+/)
    }
  })
})
