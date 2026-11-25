// «Registrar operació realitzada» (proceso 3.7): la lógica pura del diálogo.
//
// La autoridad es `registrar_operacio_realitzada()` (20270619100200); esto comprueba que la
// pantalla anticipa sus reglas —kg que cuadran, fecha del ejercicio en curso y no futura, precio
// en venta, espigolada solo donación— y que los argumentos salen como la RPC los espera.

import { describe, expect, it } from 'vitest'
import {
  CODIS_OPERACIO, FILA_DESTI_BUIDA, FILA_DESTINATARI_BUIDA, argumentsOperacio, entitatAdmet,
  errorOperacio, formInicial, horaMadrid, limitsData, resumKg, textOfertaOperacio,
} from '../src/lib/operacioRealitzada'
import type { FormOperacio } from '../src/lib/operacioRealitzada'
import { esClau, textError } from '../src/lib/textError'
import { DICTS } from '../src/lib/i18n'

const AVUI = '2026-11-25'
const E1 = '11111111-1111-1111-1111-111111111111'
const E2 = '22222222-2222-2222-2222-222222222222'

/** Un formulario válido: 100 kg de donación, 60 + 30 a dos entidades y 10 a un destino. */
function valid(canvis: Partial<FormOperacio> = {}): FormOperacio {
  return {
    ...formInicial(AVUI),
    productor: 'p1', producte: 'Tomàquet', varietat: 'Pera', ubicacio: 'u1', subcausa: 'C4.2',
    kg: '100', data: '2026-11-15', hora: '',
    destinataris: [
      { entitat: E1, kg: '60', preu: '', caixes: '' },
      { entitat: E2, kg: '30', preu: '', caixes: '3' },
    ],
    destins: [{ desti: 'compostatge', kg: '10', receptor: 'Compost SL' }],
    ...canvis,
  }
}

describe('formInicial y limitsData', () => {
  it('nace hoy, ya cosechado, en donación y con una fila de entidad vacía', () => {
    const f = formInicial(AVUI)
    expect(f.data).toBe(AVUI)
    expect(f.tipus).toBe('excedent')
    expect(f.modalitat).toBe('donacio')
    expect(f.destinataris).toEqual([FILA_DESTINATARI_BUIDA])
    expect(f.destins).toEqual([])
  })

  it('el calendario va del 1 de enero del ejercicio a hoy', () => {
    expect(limitsData(AVUI)).toEqual({ min: '2026-01-01', max: AVUI })
  })
})

describe('resumKg', () => {
  it('suma entidades y destinos con coma decimal y dice lo que queda', () => {
    expect(resumKg(valid({ kg: '100,5' }))).toEqual({ total: 100.5, destinataris: 90, destins: 10, queden: 0.5 })
  })
  it('negativo = asignado de más; las filas vacías no cuentan', () => {
    const r = resumKg(valid({ destins: [{ ...FILA_DESTI_BUIDA }, { desti: 'x', kg: '20', receptor: '' }] }))
    expect(r.queden).toBe(-10)
  })
  it('redondea cada línea a dos decimales, como la base', () => {
    const r = resumKg({ kg: '0.3', destinataris: [{ entitat: E1, kg: '0.1', preu: '', caixes: '' }, { entitat: E2, kg: '0.2', preu: '', caixes: '' }], destins: [] })
    expect(r.queden).toBe(0)
  })
})

describe('errorOperacio', () => {
  it('un formulario completo y cuadrado pasa', () => {
    expect(errorOperacio(valid(), AVUI)).toBeNull()
  })

  it('pide productora, producto y kg', () => {
    expect(errorOperacio(valid({ productor: '' }), AVUI)).toBe('opr.err_productor')
    expect(errorOperacio(valid({ producte: ' ' }), AVUI)).toBe('opr.err_producte')
    expect(errorOperacio(valid({ kg: '0' }), AVUI)).toBe('opr.err_kg')
    expect(errorOperacio(valid({ kg: 'molts' }), AVUI)).toBe('opr.err_kg')
  })

  it('la fecha: obligatoria, no futura y del ejercicio en curso', () => {
    expect(errorOperacio(valid({ data: '' }), AVUI)).toBe('opr.err_data')
    expect(errorOperacio(valid({ data: '2026-11-26' }), AVUI)).toBe('opr.err_data_futura')
    expect(errorOperacio(valid({ data: '2025-12-31' }), AVUI)).toBe('opr.err_fora_exercici')
    expect(errorOperacio(valid({ data: '2026-01-01' }), AVUI)).toBeNull()
    expect(errorOperacio(valid({ data: AVUI }), AVUI)).toBeNull()
  })

  it('la hora: opcional, válida y, si es hoy, ya pasada', () => {
    expect(errorOperacio(valid({ hora: '25:00' }), AVUI)).toBe('opr.err_hora')
    expect(errorOperacio(valid({ data: AVUI, hora: '18:00' }), AVUI, '10:30')).toBe('opr.err_hora_futura')
    expect(errorOperacio(valid({ data: AVUI, hora: '09:00' }), AVUI, '10:30')).toBeNull()
    // Otro día, cualquier hora.
    expect(errorOperacio(valid({ hora: '23:59' }), AVUI, '10:30')).toBeNull()
  })

  it('la modalidad, y la espigolada solo en donación', () => {
    expect(errorOperacio(valid({ modalitat: '' }), AVUI)).toBe('opr.err_modalitat')
    expect(errorOperacio(valid({ tipus: 'espigolada', modalitat: 'maquila' }), AVUI)).toBe('opr.err_espigolada')
    expect(errorOperacio(valid({ tipus: 'espigolada' }), AVUI)).toBeNull()
  })

  it('al menos una entidad, cada una con sus kg y una sola vez', () => {
    expect(errorOperacio(valid({ destinataris: [{ ...FILA_DESTINATARI_BUIDA }] }), AVUI)).toBe('opr.err_cal_destinatari')
    expect(errorOperacio(valid({ destinataris: [{ entitat: '', kg: '90', preu: '', caixes: '' }] }), AVUI)).toBe('opr.err_entitat')
    expect(errorOperacio(valid({ destinataris: [{ entitat: E1, kg: '', preu: '', caixes: '' }] }), AVUI)).toBe('opr.err_kg_entitat')
    expect(errorOperacio(valid({
      destinataris: [{ entitat: E1, kg: '45', preu: '', caixes: '' }, { entitat: E1, kg: '45', preu: '', caixes: '' }],
    }), AVUI)).toBe('opr.err_entitat_repetida')
    expect(errorOperacio(valid({ destinataris: [{ entitat: E1, kg: '90', preu: '', caixes: '1,5' }] }), AVUI)).toBe('opr.err_caixes')
  })

  it('en venta, el precio acordado de cada entidad (0 vale)', () => {
    expect(errorOperacio(valid({ modalitat: 'venda' }), AVUI)).toBe('opr.err_cal_preu')
    expect(errorOperacio(valid({
      modalitat: 'venda',
      destinataris: [{ entitat: E1, kg: '60', preu: '0,40', caixes: '' }, { entitat: E2, kg: '30', preu: '0', caixes: '' }],
    }), AVUI)).toBeNull()
  })

  it('cada destino con su tipo y sus kg', () => {
    expect(errorOperacio(valid({ destins: [{ desti: '', kg: '10', receptor: '' }] }), AVUI)).toBe('opr.err_desti')
    expect(errorOperacio(valid({ destins: [{ desti: 'compostatge', kg: '0', receptor: '' }] }), AVUI)).toBe('opr.err_kg_desti')
  })

  it('los kg tienen que cuadrar: ni faltan ni sobran', () => {
    expect(errorOperacio(valid({ destins: [] }), AVUI)).toBe('opr.err_queden')
    expect(errorOperacio(valid({ kg: '80' }), AVUI)).toBe('opr.err_sobren')
  })

  it('las observaciones, como mucho 1.000 caracteres', () => {
    expect(errorOperacio(valid({ observacions: 'x'.repeat(1001) }), AVUI)).toBe('opr.err_observacions')
  })

  it('todas las claves de error existen en los dos idiomas', () => {
    const casos: Partial<FormOperacio>[] = [
      { productor: '' }, { producte: '' }, { kg: '' }, { data: '' }, { data: '2026-12-01' }, { data: '2025-05-05' },
      { hora: 'x' }, { modalitat: '' }, { tipus: 'espigolada', modalitat: 'venda' }, { destinataris: [] },
      { destins: [] }, { kg: '10' }, { modalitat: 'venda' },
    ]
    for (const c of casos) {
      const e = errorOperacio(valid(c), AVUI)
      expect(e).not.toBeNull()
      expect(DICTS.ca[e!], e!).toBeTruthy()
      expect(DICTS.es[e!], e!).toBeTruthy()
    }
  })
})

describe('argumentsOperacio', () => {
  it('construye los argumentos de la RPC sin filas vacías y con números', () => {
    const a = argumentsOperacio(valid({
      kg: '100,004', hora: '09:30', observacions: '  Collit dilluns  ',
      destinataris: [
        { entitat: E1, kg: '60', preu: '', caixes: '' },
        { ...FILA_DESTINATARI_BUIDA },
        { entitat: E2, kg: '30', preu: '', caixes: '3' },
      ],
      destins: [{ desti: 'compostatge', kg: '10', receptor: ' Compost SL ' }, { ...FILA_DESTI_BUIDA }],
    }), 'TEXT')
    expect(a).toEqual({
      p_productor: 'p1', p_producto: 'Tomàquet', p_kg: 100, p_data: '2026-11-15', p_modalitat: 'donacio',
      p_destinataris: [{ entidad_id: E1, kg: 60 }, { entidad_id: E2, kg: 30, caixes: 3 }],
      p_destins: [{ desti: 'compostatge', kg: 10, receptor: 'Compost SL' }],
      p_variedad: 'Pera', p_ubicacion: 'u1', p_espigolada: false, p_subcausa: 'C4.2', p_hora: '09:30',
      p_observacions: 'Collit dilluns', p_texto_oferta: 'TEXT',
    })
  })

  it('el precio solo en venta; lo opcional vacío, a null', () => {
    const a = argumentsOperacio(valid({
      modalitat: 'venda', varietat: '', ubicacio: '', subcausa: '',
      destinataris: [{ entitat: E1, kg: '90', preu: '0,45', caixes: '' }],
    }))
    expect(a.p_destinataris).toEqual([{ entidad_id: E1, kg: 90, preu_kg: 0.45 }])
    expect(a.p_variedad).toBeNull()
    expect(a.p_ubicacion).toBeNull()
    expect(a.p_subcausa).toBeNull()
    expect(a.p_hora).toBeNull()
    expect(a.p_texto_oferta).toBeNull()
  })

  it('la espigolada va marcada', () => {
    expect(argumentsOperacio(valid({ tipus: 'espigolada' })).p_espigolada).toBe(true)
  })
})

describe('textOfertaOperacio', () => {
  const cataleg = [{
    codigo: 'C4', nombre: 'Mercat', nombre_es: 'Mercado', activa: true,
    subcausas: [{ codigo: 'C4.2', nombre: 'Preu baix', nombre_es: 'Precio bajo' }],
  }]
  const ctx = { productor: 'Hort del Pla', municipi: 'Vic', mapsLloc: 'https://maps.app.goo.gl/x', cataleg }

  it('el mismo texto que el alta: producto, ofertante, lugar, kg, fecha y causa', () => {
    const tx = textOfertaOperacio(valid(), ctx)
    expect(tx).toContain('PRODUCTE: Tomàquet (Pera)')
    expect(tx).toContain('PRODUCTOR: Hort del Pla')
    expect(tx).toContain('MUNICIPI: Vic')
    expect(tx).toContain('https://maps.app.goo.gl/x')
    expect(tx).toContain('QUANTITAT: 100 kg')
    expect(tx).toContain('DISPONIBLE FINS: 15/11/2026')
    expect(tx).toContain('CAUSA: Mercat — Preu baix')
    expect(tx).not.toContain('ESPIGOLADA')
    expect(tx).not.toContain('PREU MÍNIM')
  })

  it('una espigolada lo dice', () => {
    expect(textOfertaOperacio(valid({ tipus: 'espigolada' }), ctx)).toContain('ESPIGOLADA')
  })
})

describe('entitatAdmet', () => {
  const matriu = [
    { modalitat: 'donacio', tipo_receptor: 'social' },
    { modalitat: 'venda', tipo_receptor: 'comercial' },
    { modalitat: 'maquila', tipo_receptor: 'transformador' },
  ]
  const regla = [
    { modalitat: 'venda', naturalesa: 'empresa' }, { modalitat: 'maquila', naturalesa: 'empresa' },
    { modalitat: 'donacio', naturalesa: 'entitat_social' },
  ]
  const social = { tipo_receptor: 'social', organizaciones: null }

  it('por el tipo de receptor', () => {
    expect(entitatAdmet(social, 'donacio', matriu, regla)).toBe(true)
    expect(entitatAdmet(social, 'venda', matriu, regla)).toBe(false)
  })

  it('P8: una empresa con la naturalesa CONFIRMADA no recibe donación; sugerida, como antes', () => {
    const empresa = (origen: string) => ({
      tipo_receptor: 'social', organizaciones: { naturalesa: 'empresa', naturalesa_origen: origen },
    })
    expect(entitatAdmet(empresa('confirmada'), 'donacio', matriu, regla)).toBe(false)
    expect(entitatAdmet(empresa('suggerida'), 'donacio', matriu, regla)).toBe(true)
  })

  it('una regla que no se pudo leer no filtra', () => {
    expect(entitatAdmet(social, 'venda', null, null)).toBe(true)
  })
})

describe('horaMadrid', () => {
  it('HH:MM en la hora de Madrid', () => {
    // 2026-07-01 08:05 UTC = 10:05 en Madrid (horario de verano).
    expect(horaMadrid(new Date('2026-07-01T08:05:00Z'))).toBe('10:05')
    expect(horaMadrid(new Date('2026-01-15T23:30:00Z'))).toBe('00:30')
  })
})

describe('los códigos de la RPC tienen texto', () => {
  const t = (clau: string) => clau
  it.each(CODIS_OPERACIO)('%s', (codi) => {
    const r = textError(t, { missatge: `${codi}: detall de la base`, codi: '22023' })
    expect(esClau(r), `${codi} → ${r}`).toBe(true)
  })

  it('el más largo gana: `espigolada_nomes_donacio` no es `espigolada_no_donacio`', () => {
    expect(textError(t, { missatge: 'espigolada_nomes_donacio: una espigolada nomes pot ser donacio', codi: '22023' }))
      .toBe('opr.err_espigolada')
  })
})
