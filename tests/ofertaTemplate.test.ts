// Las 7 variables de la plantilla `oferta_excedent` de Meta.
//
// POR QUÉ IMPORTA, Y POR QUÉ EL ORDEN ES LO PRIMERO QUE SE COMPRUEBA: una plantilla de Meta
// no tiene nombres de variable, tiene posiciones — `{{1}}` … `{{7}}`. La plantilla dice
// «👩‍🌾 Productor: {{2}}» y aquí lo único que hace que en ese hueco salga el productor es que
// el elemento 2 del array vaya segundo. Intercambiar dos parámetros **no da ningún error**:
// el mensaje sale, se cobra y llega a la entidad receptora diciendo que el productor se llama
// «El Prat». Y si el número de parámetros no cuadra con la plantilla aprobada, Meta rechaza
// el envío entero (132000). Ninguna de las dos cosas la detecta `tsc`: es un array de objetos.
//
// Esta plantilla es además la ÚNICA vía de Meta para avisar a un receptor que no ha escrito
// en 24 h, o sea el mecanismo con el que se distribuye una oferta fuera de la ventana. Hoy
// está tras `PLANTILLA_OFERTA_APROVADA = false` y no se envía nunca — o sea que, igual que la
// selección por rol, es código que se estrenaría en producción sin haberse ejecutado jamás.
//
// El mapeo autoritativo está en `supabase/functions/_shared/plantillas-meta.md §1`:
//   1 producte · 2 productor · 3 municipi · 4 quantitat · 5 disponible · 6 horari · 7 responsable

import { describe, it, expect } from 'vitest'
import { construirComponentsOferta, type DatosOfertaPlantilla } from '../src/lib/ofertaTemplate'

const COMPLETA: DatosOfertaPlantilla = {
  producto: 'Tomàquet',
  variedad: 'Pera',
  productor: 'Cal Pere',
  municipi: 'El Prat',
  kg: 120,
  caixes: 8,
  disponible: 'fins 30/07',
  horari: 'matins',
  responsable: 'Marta',
}

/** Los textos de los 7 parámetros, en orden. */
function textos(d: DatosOfertaPlantilla): string[] {
  const comps = construirComponentsOferta(d) as { parameters: { text: string }[] }[]
  return comps[0].parameters.map((p) => p.text)
}

describe('forma del array `components`', () => {
  it('solo se manda el componente `body`', () => {
    // El header de la plantilla es texto fijo sin variable: mandar un `header` con
    // parámetros vacíos es una fuente clásica de rechazo.
    const comps = construirComponentsOferta(COMPLETA) as { type: string }[]
    expect(comps).toHaveLength(1)
    expect(comps[0].type).toBe('body')
  })

  it('SIEMPRE son 7 parámetros, pase lo que pase con los datos', () => {
    // El recuento es lo que Meta valida contra la plantilla aprobada. Se comprueba con los
    // datos completos y con todo a nulo, que es el caso en que un `filter` mal puesto
    // dejaría el array corto.
    const vacia: DatosOfertaPlantilla = {
      producto: null, variedad: null, productor: null, municipi: null,
      kg: null, caixes: null, disponible: null, horari: null,
    }
    expect(textos(COMPLETA)).toHaveLength(7)
    expect(textos(vacia)).toHaveLength(7)
  })

  it('cada parámetro es un `{ type: "text", text }`', () => {
    const comps = construirComponentsOferta(COMPLETA) as {
      parameters: { type: string; text: string }[]
    }[]
    for (const p of comps[0].parameters) {
      expect(p.type).toBe('text')
      expect(typeof p.text).toBe('string')
    }
  })
})

describe('el ORDEN del mapeo (plantillas-meta.md §1)', () => {
  it('produce exactamente el ejemplo documentado', () => {
    expect(textos({ ...COMPLETA, variedad: null, caixes: null, responsable: 'Equip Redestina' }))
      .toEqual(['Tomàquet', 'Cal Pere', 'El Prat', '120 kg', 'fins 30/07', 'matins', 'Equip Redestina'])
  })

  it.each([
    [0, 'producte'],
    [1, 'productor'],
    [2, 'municipi'],
    [3, 'quantitat'],
    [4, 'disponible'],
    [5, 'horari'],
    [6, 'responsable'],
  ])('la posición %i es el %s', (pos, _campo) => {
    // Cada campo lleva un valor inconfundible: si dos se cruzaran, el `toBe` lo dice, y
    // dice cuál ha ido a parar a qué hueco.
    const marcado = textos({
      producto: 'P1-producte', variedad: null, productor: 'P2-productor',
      municipi: 'P3-municipi', kg: null, caixes: null,
      disponible: 'P5-disponible', horari: 'P6-horari', responsable: 'P7-responsable',
    })
    const esperados = [
      'P1-producte', 'P2-productor', 'P3-municipi', 'a convenir',
      'P5-disponible', 'P6-horari', 'P7-responsable',
    ]
    expect(marcado[pos]).toBe(esperados[pos])
  })
})

describe('composición del producte y la quantitat', () => {
  it('la varietat se une al producte con un punto volado', () => {
    expect(textos(COMPLETA)[0]).toBe('Tomàquet · Pera')
  })

  it('sin varietat va el producte solo, sin separador colgando', () => {
    expect(textos({ ...COMPLETA, variedad: null })[0]).toBe('Tomàquet')
    expect(textos({ ...COMPLETA, variedad: '' })[0]).toBe('Tomàquet')
  })

  it('la quantitat junta kg y caixes', () => {
    expect(textos(COMPLETA)[3]).toBe('120 kg · 8 caixes')
  })

  it('sin caixes, solo los kg', () => {
    expect(textos({ ...COMPLETA, caixes: null })[3]).toBe('120 kg')
    expect(textos({ ...COMPLETA, caixes: 0 })[3]).toBe('120 kg')
  })

  it('sin kg, «a convenir» (y las caixes no se mandan solas)', () => {
    // Una oferta con «0 kg · 8 caixes» sería peor que no decir nada: el receptor la
    // descartaría por vacía.
    expect(textos({ ...COMPLETA, kg: null })[3]).toBe('a convenir')
    expect(textos({ ...COMPLETA, kg: 0 })[3]).toBe('a convenir')
  })
})

describe('los fallbacks: Meta rechaza un parámetro vacío', () => {
  it('cada hueco tiene su valor de reserva', () => {
    const vacia: DatosOfertaPlantilla = {
      producto: null, variedad: null, productor: null, municipi: null,
      kg: null, caixes: null, disponible: null, horari: null,
    }
    expect(textos(vacia)).toEqual(['—', '—', '—', 'a convenir', 'consultar', 'a convenir', 'Equip Redestina'])
  })

  it('ningún parámetro sale vacío ni solo con espacios', () => {
    // La invariante que de verdad importa: un `{"text": ""}` hace fallar el envío entero.
    const casos: DatosOfertaPlantilla[] = [
      COMPLETA,
      { ...COMPLETA, producto: '', variedad: '', productor: '  ', municipi: '\t' },
      { ...COMPLETA, disponible: '   ', horari: '', responsable: '' },
      { producto: null, variedad: null, productor: null, municipi: null, kg: null, caixes: null, disponible: null, horari: null },
    ]
    for (const caso of casos) {
      for (const t of textos(caso)) {
        expect(t.trim()).not.toBe('')
      }
    }
  })

  it('un valor que solo tiene espacios cuenta como ausente', () => {
    expect(textos({ ...COMPLETA, productor: '   ' })[1]).toBe('—')
  })

  it('el responsable por defecto es el equipo, no un hueco', () => {
    expect(textos({ ...COMPLETA, responsable: undefined })[6]).toBe('Equip Redestina')
    expect(textos({ ...COMPLETA, responsable: null })[6]).toBe('Equip Redestina')
  })

  it('los textos se recortan por los bordes', () => {
    expect(textos({ ...COMPLETA, municipi: '  El Prat  ' })[2]).toBe('El Prat')
  })
})

// ⚠️ DEFECTO LATENTE ENCONTRADO — no se ablanda la aserción, se deja marcado.
//
// `producte` se compone como `d.variedad ? `${d.producto} · ${d.variedad}` : d.producto`, y esa
// interpolación NO comprueba `producto`: con `producto: null` y `variedad: 'Pera'` el
// parámetro 1 sale como la cadena literal **«null · Pera»**, que se enviaría tal cual a la
// entidad receptora. El fallback `orDefault` no lo salva porque la cadena ya no está vacía.
//
// Es poco probable (el intake no deja poner varietat sin producte) y no se toca aquí porque
// el arreglo es una línea de producción. Queda como `todo` para que no se pierda.
// Este caso nació como `it.todo` describiendo un defecto: con `producto` nulo y variedad
// puesta, el parámetro 1 salía como la cadena literal «null · Pera» y eso es lo que habría
// leído la entidad receptora en su WhatsApp. Ya está arreglado, así que la prueba pasa a ser
// de verdad — y se queda como red, porque el tipo sigue admitiendo ese estado.
describe('un producto nulo no se interpola', () => {
  it('con variedad y sin producto, se usa la variedad sola', () => {
    const p = textos({ ...COMPLETA, producto: null, variedad: 'Pera' })
    expect(p[0]).toBe('Pera')
    expect(p[0]).not.toContain('null')
  })

  it('sin producto ni variedad, el guion', () => {
    const p = textos({ ...COMPLETA, producto: null, variedad: null })
    expect(p[0]).toBe('—')
  })

  it('ningún parámetro contiene «null» o «undefined» literales', () => {
    const p = textos({
      producto: null, variedad: null, productor: null, municipi: null,
      kg: null, caixes: null, disponible: null, horari: null, responsable: null,
    })
    for (const texto of p) {
      expect(texto).not.toMatch(/\b(null|undefined)\b/)
    }
  })
})
