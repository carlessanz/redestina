// Los `components` de envío de las dos plantillas de oferta de Meta (25-11-2026):
// `oferta_excedent` (revisada: modalidad, precio, botones, sin productor) y
// `oferta_disponibilitat` (multiproducto, botón al Mercat).
//
// POR QUÉ IMPORTA, Y POR QUÉ EL ORDEN ES LO PRIMERO QUE SE COMPRUEBA: una plantilla de Meta
// no tiene nombres de variable, tiene posiciones — `{{1}}` … `{{n}}`. Intercambiar dos
// parámetros **no da ningún error**: el mensaje sale, se cobra y llega a la entidad con el
// municipio en el hueco de la cantidad. Si el número de parámetros no cuadra con la plantilla
// aprobada, Meta rechaza el envío entero (132000); si uno lleva un salto de línea, también
// (132018). Nada de eso lo ve `tsc`: es un array de objetos.
//
// Las dos están tras un flag a `false` (`src/lib/plantillas.ts`): es código que se estrenaría
// en producción sin haberse ejecutado jamás, así que la red está aquí.
//
// El texto autoritativo de las plantillas está en `supabase/functions/_shared/plantillasMeta.ts`;
// los recuentos se leen de ahí, no se escriben a mano.

import { describe, it, expect } from 'vitest'
import {
  construirComponentsDisponibilitat, construirComponentsOferta, llistaProductesPlantilla,
  type DatosDisponibilitatPlantilla, type DatosOfertaPlantilla, type OfertaDisponibilitatPlantilla,
} from '../src/lib/ofertaTemplate'
import {
  cosAmbValors, nombreVariables, OFERTA_DISPONIBILITAT, OFERTA_EXCEDENT,
} from '../supabase/functions/_shared/plantillasMeta.ts'

interface Param { type: string; text?: string; payload?: string }
interface Comp { type: string; sub_type?: string; index?: string; parameters: Param[] }

const COMPLETA: DatosOfertaPlantilla = {
  producto: 'Tomàquet',
  variedad: 'Pera',
  municipi: 'El Prat de Llobregat',
  comarca: 'Baix Llobregat',
  kg: 120,
  caixes: 8,
  format: 'caixes',
  disponible: '2026-07-30',
  dies: [1, 3, 5],
  horari: 'de 8:00 a 12:00',
  modalitats: ['donacio', 'venda'],
  preuMinim: 0.8,
}

const BUIDA: DatosOfertaPlantilla = {
  producto: null, variedad: null, municipi: null, kg: null, caixes: null, disponible: null, horari: null,
}

function comps(d: DatosOfertaPlantilla): Comp[] {
  return construirComponentsOferta(d) as Comp[]
}
/** Los textos de los parámetros del cuerpo, en orden. */
function textos(d: DatosOfertaPlantilla): string[] {
  return comps(d).find((c) => c.type === 'body')!.parameters.map((p) => p.text!)
}

/** La invariante de Meta para un parámetro de envío. */
function parametreValid(t: string): void {
  expect(t.trim()).not.toBe('')
  expect(t).not.toMatch(/[\n\r\t]/)
  expect(t).not.toMatch(/ {5,}/)
  expect(t).not.toMatch(/\b(null|undefined|NaN)\b/)
}

describe('oferta_excedent · forma del array `components`', () => {
  it('cuerpo + los dos botones de respuesta rápida, sin `header` (la cabecera es fija)', () => {
    const c = comps(COMPLETA)
    expect(c.map((x) => x.type)).toEqual(['body', 'button', 'button'])
  })

  it('el número de parámetros es SIEMPRE el de la plantilla, pase lo que pase con los datos', () => {
    const n = nombreVariables(OFERTA_EXCEDENT)
    expect(n).toBe(7)
    expect(textos(COMPLETA)).toHaveLength(n)
    expect(textos(BUIDA)).toHaveLength(n)
  })

  it('los botones llevan el payload que consume el diálogo de oferta (`accept:si|no`)', () => {
    const botons = comps(COMPLETA).filter((c) => c.type === 'button')
    expect(botons).toEqual([
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'accept:si' }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'accept:no' }] },
    ])
  })
})

describe('oferta_excedent · el ORDEN del mapeo (plantillas-meta.md §1)', () => {
  it('produce exactamente el ejemplo documentado', () => {
    expect(textos(COMPLETA)).toEqual([
      'Tomàquet (Pera)',
      'El Prat de Llobregat (Baix Llobregat)',
      '120 kg · 8 caixes',
      '30/07/2026',
      'dl, dc, dv · de 8:00 a 12:00',
      'Donació o venda',
      '0,80 €/kg',
    ])
  })

  it('el nombre del productor no sale en ningún parámetro (D3)', () => {
    // El tipo ya no lo admite; esto vigila que nadie lo cuele por el municipio.
    const d = { ...COMPLETA, productor: 'Cal Pere' } as DatosOfertaPlantilla
    expect(textos(d).join(' ')).not.toContain('Cal Pere')
  })
})

describe('oferta_excedent · modalidad y precio', () => {
  it('donación sola: el precio «no s\'aplica»', () => {
    const p = textos({ ...COMPLETA, modalitats: ['donacio'], preuMinim: 0.8 })
    expect(p[5]).toBe('Donació')
    expect(p[6]).toBe("no s'aplica")
  })

  it('venta sin precio: «a convenir», nunca un 0', () => {
    expect(textos({ ...COMPLETA, modalitats: ['venda'], preuMinim: null })[6]).toBe('a convenir')
    expect(textos({ ...COMPLETA, modalitats: ['venda'], preuMinim: 0 })[6]).toBe('a convenir')
  })

  it('la modalidad única de siempre (string) también vale', () => {
    expect(textos({ ...COMPLETA, modalitats: 'venda' })[5]).toBe('Venda')
  })

  it('sin modalidad: «a convenir» en las dos', () => {
    const p = textos({ ...COMPLETA, modalitats: null })
    expect([p[5], p[6]]).toEqual(['a convenir', 'a convenir'])
  })
})

describe('oferta_excedent · composición', () => {
  it('sin variedad, el producto solo; sin producto, la variedad sola; nunca «null»', () => {
    expect(textos({ ...COMPLETA, variedad: null })[0]).toBe('Tomàquet')
    expect(textos({ ...COMPLETA, producto: null, variedad: 'Pera' })[0]).toBe('Pera')
    expect(textos({ ...COMPLETA, producto: null, variedad: null })[0]).toBe('—')
  })

  it('palets en vez de cajas; sin cajas, solo los kg; sin kg, «a convenir»', () => {
    expect(textos({ ...COMPLETA, format: 'palet', caixes: 2 })[2]).toBe('120 kg · 2 palets')
    expect(textos({ ...COMPLETA, caixes: null })[2]).toBe('120 kg')
    expect(textos({ ...COMPLETA, kg: 12.5, caixes: 1 })[2]).toBe('12,5 kg · 1 caixa')
    expect(textos({ ...COMPLETA, kg: 0 })[2]).toBe('a convenir')
  })

  it('la comarca no se repite si es igual que el municipio', () => {
    expect(textos({ ...COMPLETA, municipi: 'Garrigues', comarca: 'Garrigues' })[1]).toBe('Garrigues')
    expect(textos({ ...COMPLETA, comarca: null })[1]).toBe('El Prat de Llobregat')
  })

  it('una fecha que no es ISO se deja como está', () => {
    expect(textos({ ...COMPLETA, disponible: 'finals de juliol' })[3]).toBe('finals de juliol')
  })
})

describe('oferta_excedent · lo que Meta rechaza', () => {
  it('los valores de reserva: ningún parámetro vacío', () => {
    expect(textos(BUIDA)).toEqual(['—', '—', 'a convenir', 'consultar', 'a convenir', 'a convenir', 'a convenir'])
    for (const t of textos(BUIDA)) parametreValid(t)
  })

  it('saltos de línea, tabuladores y espacios repetidos se convierten en un espacio', () => {
    const p = textos({ ...COMPLETA, horari: 'de 8:00\na 12:00\t(matí)     tard', municipi: '  El   Prat  ' })
    for (const t of p) parametreValid(t)
    expect(p[4]).toBe('dl, dc, dv · de 8:00 a 12:00 (matí) tard')
    expect(p[1]).toBe('El Prat (Baix Llobregat)')
  })

  it('cada parámetro cabe en su tope y el cuerpo, en 1024', () => {
    const llarg = 'x'.repeat(2000)
    const p = textos({ ...COMPLETA, producto: llarg, municipi: llarg, horari: llarg, disponible: llarg })
    p.forEach((t, i) => expect(t.length).toBeLessThanOrEqual(OFERTA_EXCEDENT.maxims[i]))
    expect(cosAmbValors(OFERTA_EXCEDENT, p).length).toBeLessThanOrEqual(1024)
  })
})

// ---------------------------------------------------------------------------------------------

const OFERTES: OfertaDisponibilitatPlantilla[] = [
  { producto: 'Ceba', kg_total: 200, modalitats: ['donacio'], disponible_hasta: '2026-07-30', dies_recollida: [1, 3], horari_recollida: 'de 8:00 a 12:00' },
  { producto: 'Tomàquet', variedad: 'Cor de bou', kg_total: 300, modalitats: ['donacio', 'venda'] },
]
const GRUP: DatosDisponibilitatPlantilla = {
  disponibilitatId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  municipi: 'Vilafranca del Penedès',
  comarca: 'Alt Penedès',
  ofertes: OFERTES,
}

function compsGrup(d: DatosDisponibilitatPlantilla): Comp[] {
  return construirComponentsDisponibilitat(d) as Comp[]
}
function textosGrup(d: DatosDisponibilitatPlantilla): string[] {
  return compsGrup(d).find((c) => c.type === 'body')!.parameters.map((p) => p.text!)
}

describe('oferta_disponibilitat · components', () => {
  it('cuerpo + botón de URL, con el número de variables de la plantilla', () => {
    const c = compsGrup(GRUP)
    expect(c.map((x) => x.type)).toEqual(['body', 'button'])
    expect(nombreVariables(OFERTA_DISPONIBILITAT)).toBe(5)
    expect(textosGrup(GRUP)).toHaveLength(5)
    expect(textosGrup({ ...GRUP, municipi: null, ofertes: [] })).toHaveLength(5)
  })

  it('el botón lleva el id de la disponibilidad como sufijo de la URL', () => {
    const boto = compsGrup(GRUP).find((c) => c.type === 'button')!
    expect(boto).toEqual({
      type: 'button', sub_type: 'url', index: '0',
      parameters: [{ type: 'text', text: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }],
    })
    const def = OFERTA_DISPONIBILITAT.botons[0]
    expect(def.type === 'URL' && def.url).toMatch(/\/receptor\/mercat\?disponibilitat=\{\{1\}\}$/)
  })

  it('el mapeo, en orden (plantillas-meta.md §1bis)', () => {
    expect(textosGrup(GRUP)).toEqual([
      'Ceba 200 kg · Tomàquet (Cor de bou) 300 kg',
      'Vilafranca del Penedès (Alt Penedès)',
      '30/07/2026',
      'dl, dc · de 8:00 a 12:00',
      'Donació o venda',
    ])
  })

  it('sin datos: valores de reserva válidos', () => {
    const p = textosGrup({ disponibilitatId: 'x', municipi: null, ofertes: [] })
    expect(p).toEqual(['—', '—', 'consultar', 'a convenir', 'a convenir'])
    for (const t of p) parametreValid(t)
  })
})

describe('oferta_disponibilitat · la lista de productos en una línea', () => {
  it('sin kilos, el nombre solo', () => {
    expect(llistaProductesPlantilla([{ producto: 'Ceba', kg_total: null }, { producto: 'Porro', kg_total: 40 }], 300))
      .toBe('Ceba · Porro 40 kg')
  })

  it('si no cabe, los primeros que caben y «i N més»', () => {
    const moltes = Array.from({ length: 30 }, (_, i) => ({ producto: `Producte llarg número ${i + 1}`, kg_total: 1000 + i }))
    const s = llistaProductesPlantilla(moltes, 300)
    expect(s.length).toBeLessThanOrEqual(300)
    expect(s).toMatch(/ i \d+ més$/)
    expect(s.startsWith('Producte llarg número 1 1000 kg · ')).toBe(true)
    const quants = s.split(' · ').length
    expect(s).toContain(` i ${30 - quants} més`)
  })

  it('un solo producto larguísimo se recorta y sigue cabiendo', () => {
    const s = llistaProductesPlantilla([{ producto: 'z'.repeat(500), kg_total: 1 }, { producto: 'Ceba', kg_total: 2 }], 300)
    expect(s.length).toBeLessThanOrEqual(300)
    expect(s).toMatch(/… i 1 més$/)
  })

  it('con muchos productos el cuerpo sigue sin pasar de 1024 y sin saltos de línea', () => {
    const moltes = Array.from({ length: 50 }, (_, i) => ({ producto: `Prod\n${i}\t`, kg_total: i + 1, horari_recollida: 'a\nb' }))
    const p = textosGrup({ ...GRUP, ofertes: moltes })
    for (const t of p) parametreValid(t)
    expect(cosAmbValors(OFERTA_DISPONIBILITAT, p).length).toBeLessThanOrEqual(1024)
  })
})
