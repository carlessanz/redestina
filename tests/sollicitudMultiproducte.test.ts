// Ofertas MULTIPRODUCTO (proceso 3.3, fase 6b-6c, 25-11-2026), la parte pura de las pantallas:
// qué línea falló (`error.details`), qué se puede pedir, los días y la franja comunes, la
// validación y lo que viaja en `p_linies` de cada RPC, y la agrupación por solicitud de la cola.

import { describe, expect, it } from 'vitest'
import {
  agrupaPerSollicitud, clauErrorMultiple, diesComuns, disponibleFinsComu, franjaComuna, idLiniaFallida,
  liniesPerEnviar, liniesRecollida, liniesResolucio, llegeixDetall, modalitatsDemanables, modalitatTriada,
  ofertesDemanables, validaLiniesSollicitud, validaRecollidaMultiple, validaResolucio, validaTotesCalMotiu,
  type LiniaRecollida, type LiniaResolucio, type LiniaSollicitud, type OfertaDelGrup,
} from '../src/lib/sollicitudMultiproducte'
import { DICTS } from '../src/lib/i18n'

function oferta(id: string, extra: Partial<OfertaDelGrup> = {}): OfertaDelGrup {
  return {
    excedente_id: id, estado: 'publicada', kg_total: 100, kg_lliures: 80,
    modalitat: 'donacio', modalitats: ['donacio'], modalitats_meves: ['donacio'],
    disponible_hasta: '2026-12-31', hora_recollida_inici: '08:00:00', hora_recollida_fi: '12:00:00',
    dies_recollida: null, ...extra,
  }
}

function linia(id: string, extra: Partial<LiniaSollicitud> = {}): LiniaSollicitud {
  return { excedente_id: id, triada: true, kg: '10', modalitats: ['donacio'], modalitat: '', kgMax: 100, preu: '', ...extra }
}

describe('qué línea falló', () => {
  it('lee el detalle JSON de las RPC', () => {
    expect(llegeixDetall('{"linia": 2, "excedente_id": "e2"}')).toEqual({ linia: 2, excedente_id: 'e2' })
    expect(llegeixDetall('{"linia": 1, "resposta_id": "r1"}')).toEqual({ linia: 1, resposta_id: 'r1' })
    expect(llegeixDetall('{"canalizacion_id": "c9"}')).toEqual({ linia: null, canalizacion_id: 'c9' })
  })
  it('lo que no es ese JSON no se inventa una línea', () => {
    expect(llegeixDetall(null)).toBeNull()
    expect(llegeixDetall('')).toBeNull()
    expect(llegeixDetall('Key (id)=(x) already exists.')).toBeNull()
    expect(llegeixDetall('{"otra": 1}')).toBeNull()
    expect(llegeixDetall('[1,2]')).toBeNull()
  })
  it('el id: el del detalle o, si no, el de esa posición de lo enviado', () => {
    expect(idLiniaFallida({ linia: 2, excedente_id: 'e2' }, ['e1', 'e9'])).toBe('e2')
    expect(idLiniaFallida({ linia: 2 }, ['e1', 'e9'])).toBe('e9')
    expect(idLiniaFallida({ linia: 5 }, ['e1'])).toBeNull()
    expect(idLiniaFallida(null, ['e1'])).toBeNull()
  })
  it('los códigos propios tienen su clave, y existen en los dos idiomas', () => {
    expect(clauErrorMultiple('sollicitud_pendent: ja hi ha…', '22023')).toBe('smp.err_sollicitud_pendent')
    expect(clauErrorMultiple('falten_linies: cal resoldre…', '22023')).toBe('smp.err_falten')
    expect(clauErrorMultiple('linia_ja_resolta', '22023')).toBe('smp.err_ja_resolta')
    expect(clauErrorMultiple('cal_recollida: tria…', '22023')).toBe('smp.err_cal_recollida')
    expect(clauErrorMultiple('cal_entitat: tria…', '22023')).toBe('smp.err_cal_entitat')
    // Los de la puerta de cada línea los traduce la función de siempre.
    expect(clauErrorMultiple('kg_maxim: com a maxim 50 kg', '22023')).toBeNull()
    expect(clauErrorMultiple('No pertanys a aquesta entitat', '42501')).toBe('smp.err_permis')
    for (const clau of ['smp.err_sollicitud_pendent', 'smp.err_falten', 'smp.err_ja_resolta', 'smp.err_linia',
      'smp.err_inexistent', 'smp.err_permis', 'smp.err_cap_linia', 'smp.err_cal_recollida', 'smp.err_cal_entitat']) {
      expect(DICTS.ca[clau], clau).toBeTruthy()
      expect(DICTS.es[clau], clau).toBeTruthy()
    }
  })
})

describe('qué se puede pedir', () => {
  it('vivas y con alguna modalidad de la entidad', () => {
    const os = [
      oferta('a'),
      oferta('b', { estado: 'cerrada' }),
      oferta('c', { modalitats: ['venda'], modalitats_meves: [] }),
      oferta('d', { estado: 'parcial' }),
    ]
    expect(ofertesDemanables(os).map((o) => o.excedente_id)).toEqual(['a', 'd'])
  })
  it('las modalidades: las de la entidad y, con el corte, solo con convenio', () => {
    const o = oferta('a', { modalitats: ['donacio', 'venda'], modalitats_meves: ['donacio', 'venda'] })
    expect(modalitatsDemanables(o)).toEqual(['donacio', 'venda'])
    expect(modalitatsDemanables(o, (m) => m === 'donacio')).toEqual(['donacio'])
    // El equipo (null): las de la oferta.
    expect(modalitatsDemanables({ ...o, modalitats_meves: null })).toEqual(['donacio', 'venda'])
  })
})

describe('los días, la franja y el último día comunes', () => {
  it('sin días en ninguna, cualquiera', () => {
    expect(diesComuns([oferta('a'), oferta('b')])).toEqual({ dies: [], motiu: 'cap' })
  })
  it('la intersección de las que limitan (las que no limitan no cuentan)', () => {
    expect(diesComuns([oferta('a', { dies_recollida: [1, 3, 5] }), oferta('b', { dies_recollida: [3, 5, 6] }), oferta('c')]))
      .toEqual({ dies: [3, 5], motiu: 'interseccio' })
  })
  it('sin días en común, los de la primera que limita', () => {
    expect(diesComuns([oferta('a'), oferta('b', { dies_recollida: [1] }), oferta('c', { dies_recollida: [2] })]))
      .toEqual({ dies: [1], motiu: 'primera' })
  })
  it('la franja más estrecha que cabe en todas; si no se solapan, la de la primera', () => {
    expect(franjaComuna([oferta('a'), oferta('b', { hora_recollida_inici: '10:00', hora_recollida_fi: '14:00' })]))
      .toEqual({ inici: '10:00', fi: '12:00', comuna: true })
    expect(franjaComuna([oferta('a'), oferta('b', { hora_recollida_inici: '15:00', hora_recollida_fi: '18:00' })]))
      .toEqual({ inici: '08:00', fi: '12:00', comuna: false })
    expect(franjaComuna([oferta('a', { hora_recollida_inici: null, hora_recollida_fi: null })]))
      .toEqual({ inici: null, fi: null, comuna: true })
  })
  it('el último día: el más temprano', () => {
    expect(disponibleFinsComu([oferta('a', { disponible_hasta: '2026-12-20' }), oferta('b', { disponible_hasta: '2026-12-05' }), oferta('c', { disponible_hasta: null })]))
      .toBe('2026-12-05')
    expect(disponibleFinsComu([oferta('a', { disponible_hasta: null })])).toBeNull()
  })
})

describe('la solicitud del receptor', () => {
  it('sin ninguna elegida, no se envía', () => {
    expect(validaLiniesSollicitud([linia('a', { triada: false })]).general).toBe('smp.err_cap_linia')
  })
  it('cada línea elegida, su primer problema', () => {
    const v = validaLiniesSollicitud([
      linia('a', { kg: '' }),
      linia('b', { kg: '150', kgMax: 100 }),
      linia('c', { modalitats: ['donacio', 'venda'] }),
      linia('d', { triada: false, kg: '' }),
      linia('e'),
    ], { fmtKg: (n) => `${n}` })
    expect(v.general).toBeNull()
    expect(v.perLinia).toEqual({
      a: { clau: 'mk.need_kg' },
      b: { clau: 'mk.max_kg', vars: { n: '100' } },
      c: { clau: 'mk.need_mode' },
    })
  })
  it('nivel 1 en venta: precio acordado y aceptación obligatorios', () => {
    const venda = { modalitats: ['venda'] as const, modalitat: 'venda' as const }
    expect(validaLiniesSollicitud([linia('a', { ...venda, preu: '' })], { nivell1: true }).perLinia.a.clau).toBe('asg.err_cal_preu')
    expect(validaLiniesSollicitud([linia('a', { ...venda, preu: '0,5' })], { nivell1: true }).perLinia.a.clau).toBe('asg.err_cal_acceptat')
    expect(validaLiniesSollicitud([linia('a', { ...venda, preu: '0,5', preuAcceptat: true })], { nivell1: true }).perLinia).toEqual({})
    // La entidad, sin precio, puede pedir la venta (lo fija el equipo).
    expect(validaLiniesSollicitud([linia('a', { ...venda, preu: '' })]).perLinia).toEqual({})
  })
  it('lo que viaja: solo las elegidas, con su modalidad, y el precio solo en venta', () => {
    expect(liniesPerEnviar([
      linia('a', { kg: '12,5' }),
      linia('b', { triada: false }),
      linia('c', { modalitats: ['donacio', 'venda'], modalitat: 'venda', preu: '0,4' }),
      linia('d', { modalitats: ['donacio', 'venda'], modalitat: 'donacio', preu: '0,4' }),
    ])).toEqual([
      { excedente_id: 'a', kg: 12.5, modalitat: 'donacio' },
      { excedente_id: 'c', kg: 10, modalitat: 'venda', preu: 0.4 },
      { excedente_id: 'd', kg: 10, modalitat: 'donacio' },
    ])
    expect(liniesPerEnviar([linia('c', { modalitats: ['venda'], preu: '1', preuAcceptat: true })], { nivell1: true }))
      .toEqual([{ excedente_id: 'c', kg: 10, modalitat: 'venda', preu: 1, preu_acceptat: true }])
  })
  it('la modalidad elegida: la que se tocó, o la única', () => {
    expect(modalitatTriada({ modalitat: '', modalitats: ['maquila'] })).toBe('maquila')
    expect(modalitatTriada({ modalitat: '', modalitats: ['donacio', 'venda'] })).toBe('')
    expect(modalitatTriada({ modalitat: 'venda', modalitats: ['donacio'] })).toBe('donacio')
  })
})

describe('la cola de Aprovacions agrupa por solicitud', () => {
  it('una tarjeta por solicitud en el orden en que aparece, y las sueltas aparte', () => {
    const files = [
      { id: '1', sollicitud_id: 's1' }, { id: '2', sollicitud_id: null }, { id: '3', sollicitud_id: 's2' },
      { id: '4', sollicitud_id: 's1' }, { id: '5' },
    ]
    const g = agrupaPerSollicitud(files)
    expect(g.grups.map((x) => [x.sollicitudId, x.files.map((f) => f.id)])).toEqual([['s1', ['1', '4']], ['s2', ['3']]])
    expect(g.soltes.map((f) => f.id)).toEqual(['2', '5'])
  })
})

describe('la aprobación conjunta', () => {
  const base: LiniaResolucio = {
    resposta_id: 'r1', accio: 'aprova', kg: '30', modalitats: ['donacio'], modalitat: '', preu: '', preuAcceptat: false, motiu: '',
  }
  it('valida solo lo que se aprueba; un rechazo sin motivo vale', () => {
    expect(validaResolucio([base, { ...base, resposta_id: 'r2', accio: 'rebutja', kg: '' }])).toEqual({})
    expect(validaResolucio([{ ...base, kg: '0' }])).toEqual({ r1: { clau: 'appr.need_kg' } })
    expect(validaResolucio([{ ...base, modalitats: ['donacio', 'venda'] }])).toEqual({ r1: { clau: 'appr.cal_modalitat' } })
    expect(validaResolucio([{ ...base, modalitats: ['venda'], preuAcceptat: true }])).toEqual({ r1: { clau: 'asg.err_cal_preu' } })
  })
  it('lo que viaja a resoldre_sollicitud', () => {
    expect(liniesResolucio([
      base,
      { ...base, resposta_id: 'r2', accio: 'rebutja', motiu: '  no hi ha furgoneta ' },
      { ...base, resposta_id: 'r3', accio: 'rebutja' },
      { ...base, resposta_id: 'r4', modalitats: ['venda'], preu: '0,3', preuAcceptat: true },
    ])).toEqual([
      { resposta_id: 'r1', accio: 'aprova', kg: 30, modalitat: 'donacio' },
      { resposta_id: 'r2', accio: 'rebutja', motiu: 'no hi ha furgoneta' },
      { resposta_id: 'r3', accio: 'rebutja' },
      { resposta_id: 'r4', accio: 'aprova', kg: 30, modalitat: 'venda', preu: 0.3, preu_acceptat: true },
    ])
  })
})

describe('la recogida real conjunta', () => {
  const ara = new Date('2026-11-25T12:00:00Z')
  const l = (id: string, extra: Partial<LiniaRecollida> = {}): LiniaRecollida => ({
    canalizacion_id: id, resultat: 'coincideix', kg: '30', kgAssignats: 30, motiu: '', ...extra,
  })
  it('sin ninguna marcada, no se envía', () => {
    expect(validaRecollidaMultiple([l('c1', { resultat: '' })], null, ara).general).toBe('smp.err_cap_resultat')
  })
  it('con diferencia, kg coherentes y motivo; sin recoger, el motivo es opcional', () => {
    const v = validaRecollidaMultiple([
      l('c1'),
      l('c2', { resultat: 'inferior', kg: '25' }),
      l('c3', { resultat: 'inferior', kg: '35', motiu: 'x' }),
      l('c4', { resultat: 'superior', kg: '32', motiu: 'sobrava' }),
      l('c5', { resultat: 'no_recollit' }),
      l('c6', { resultat: '' }),
    ], null, ara)
    expect(v.general).toBeNull()
    expect(v.perLinia).toEqual({ c2: 'rrec.err_motiu', c3: 'rrec.err_no_menys' })
  })
  it('una fecha futura no vale', () => {
    expect(validaRecollidaMultiple([l('c1')], '2026-11-26T12:00:00Z', ara).perLinia).toEqual({ c1: 'rrec.err_data_futura' })
  })
  it('lo que viaja a registrar_recollida_multiple: solo las marcadas', () => {
    expect(liniesRecollida([
      l('c1', { motiu: 'tot bé' }),
      l('c2', { resultat: 'inferior', kg: '25,5', motiu: 'caixes trencades' }),
      l('c3', { resultat: 'no_recollit', motiu: 'no hi havia ningú' }),
      l('c4', { resultat: 'no_recollit' }),
      l('c5', { resultat: '' }),
    ])).toEqual([
      { canalizacion_id: 'c1', resultat: 'coincideix', observacions: 'tot bé' },
      { canalizacion_id: 'c2', resultat: 'inferior', kg_reals: 25.5, observacions: 'caixes trencades', motiu: 'caixes trencades' },
      { canalizacion_id: 'c3', resultat: 'no_recollit', motiu: 'no hi havia ningú' },
      { canalizacion_id: 'c4', resultat: 'no_recollit' },
    ])
  })
  it('«Valida totes» pide motivo si alguna difiere', () => {
    expect(validaTotesCalMotiu([{ kgAssignats: 30, kgDeclarats: 30 }])).toBe(false)
    expect(validaTotesCalMotiu([{ kgAssignats: 30, kgDeclarats: 30 }, { kgAssignats: 20, kgDeclarats: 18 }])).toBe(true)
    expect(validaTotesCalMotiu([{ kgAssignats: 30, kgDeclarats: null }])).toBe(false)
  })
})
