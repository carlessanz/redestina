// El listado de ofertas del equipo (puntos 4-6, fase 1, 19-11-2026): pestañas, paso del
// proceso por fila, kilos sin anuladas y lo que va al servidor en el Històric.

import { describe, expect, it } from 'vitest'
import {
  CLAUS_PAS_LLISTAT, ESTATS_ACTIUS, ESTATS_HISTORIC, filtreCercaHistoric, kgPerOferta, limitsDies,
  llegeixPestanya, nombrePagines, pasDeLaFila, patroIlike, rangPagina, resumPerOferta, textPagina,
  type CanalLlistat, type OfertaLlistat,
} from '../src/lib/llistatOfertes'
import { DICTS } from '../src/lib/i18n'

const ara = new Date('2026-11-19T10:00:00Z')

function oferta(p: Partial<OfertaLlistat> = {}): OfertaLlistat {
  return {
    id: 'o1', estado: 'publicada', kg_total: 100, disponible_hasta: '2026-12-31',
    motivo_no_colocada: null, producte_al_camp: false, espigolada_id: null, desti_reclamat_at: null,
    ...p,
  }
}

function canal(p: Partial<CanalLlistat> = {}): CanalLlistat {
  return {
    excedente_id: 'o1', estado: 'confirmada', kg_confirmados: 40,
    recollida_registrada_at: null, recollida_validada_at: null, recollida_retornada_at: null,
    ...p,
  }
}

describe('llegeixPestanya', () => {
  it('lee las cuatro y acepta «tancades» como Històric', () => {
    expect(llegeixPestanya('validar')).toBe('validar')
    expect(llegeixPestanya('actives')).toBe('actives')
    expect(llegeixPestanya('esborranys')).toBe('esborranys')
    expect(llegeixPestanya('historic')).toBe('historic')
    expect(llegeixPestanya('tancades')).toBe('historic')
  })
  it('lo desconocido o ausente, a Actives («totes» ya no existe)', () => {
    expect(llegeixPestanya(null)).toBe('actives')
    expect(llegeixPestanya('totes')).toBe('actives')
    expect(llegeixPestanya('')).toBe('actives')
  })
})

describe('estados de cada pestaña', () => {
  it('no_colocada es activa; el Històric es cerrada y cancelada', () => {
    expect(ESTATS_ACTIUS).toContain('no_colocada')
    expect([...ESTATS_HISTORIC].sort()).toEqual(['cancelada', 'cerrada'])
    expect(ESTATS_ACTIUS.some((e) => ESTATS_HISTORIC.includes(e))).toBe(false)
    expect(ESTATS_ACTIUS).not.toContain('esborrany')
  })
})

describe('kilos canalizados', () => {
  it('no suman las canalizaciones anuladas', () => {
    const canals = [canal({ kg_confirmados: 40 }), canal({ kg_confirmados: '25' }), canal({ estado: 'anulada', kg_confirmados: 100 })]
    expect(kgPerOferta(canals)).toEqual({ o1: 65 })
    expect(resumPerOferta(canals, [], [])['o1'].kgCanalitzats).toBe(65)
  })
  it('ignora filas sin oferta', () => {
    expect(kgPerOferta([canal({ excedente_id: null })])).toEqual({})
  })
})

describe('el paso del proceso de cada fila', () => {
  it('recién publicada y sin enviar: le toca al equipo', () => {
    const p = pasDeLaFila(oferta(), undefined, ara)
    expect(p).toEqual({ clau: 'off.pas_sense_enviar', vars: {}, emToca: true })
  })

  it('enviada sin interés: espera, neutro', () => {
    const r = resumPerOferta([], [{ excedente_id: 'o1', estado: 'pendent', aprovacio: 'pendent' }], [])
    expect(pasDeLaFila(oferta(), r['o1'], ara)?.clau).toBe('off.pas_esperant_interes')
    expect(pasDeLaFila(oferta(), r['o1'], ara)?.emToca).toBe(false)
  })

  it('intereses por aprobar, con singular', () => {
    const una = resumPerOferta([], [{ excedente_id: 'o1', estado: 'acceptada', aprovacio: 'pendent' }], [])
    expect(pasDeLaFila(oferta(), una['o1'], ara)).toEqual({ clau: 'off.pas_per_aprovar', vars: { n: 1 }, emToca: true })
    const dues = resumPerOferta([], [
      { excedente_id: 'o1', estado: 'acceptada', aprovacio: 'pendent' },
      { excedente_id: 'o1', estado: 'acceptada', aprovacio: 'pendent' },
    ], [])
    expect(pasDeLaFila(oferta(), dues['o1'], ara)?.clau).toBe('off.pas_per_aprovar')
  })

  it('coberta con canalizaciones sin registro: «Esperant recollida»', () => {
    const r = resumPerOferta([canal({ kg_confirmados: 100 })], [], [])
    expect(pasDeLaFila(oferta({ estado: 'bloqueada' }), r['o1'], ara))
      .toEqual({ clau: 'off.pas_esperant_recollida', vars: { n: 1 }, emToca: false })
  })

  it('parcial con una esperando: manda la recogida', () => {
    const r = resumPerOferta([canal(), canal()], [], [])
    expect(pasDeLaFila(oferta({ estado: 'parcial' }), r['o1'], ara)?.clau).toBe('off.pas_esperant_recollida')
  })

  it('parcial sin nada pendiente: buscar salida para el resto', () => {
    const r = resumPerOferta([canal({ estado: 'conciliada' })], [], [])
    expect(pasDeLaFila(oferta({ estado: 'parcial' }), r['o1'], ara)?.clau).toBe('off.pas_busca_resta')
  })

  it('registrada por el receptor: «Recollida per validar», le toca al equipo', () => {
    const r = resumPerOferta([canal({ recollida_registrada_at: '2026-11-18T10:00:00Z' })], [], [])
    expect(pasDeLaFila(oferta({ estado: 'bloqueada' }), r['o1'], ara))
      .toEqual({ clau: 'proc.e_recollida_validacio_t', vars: {}, emToca: true })
  })

  it('devuelta al receptor: lo dice, neutro', () => {
    const r = resumPerOferta([canal({
      recollida_registrada_at: '2026-11-17T10:00:00Z', recollida_retornada_at: '2026-11-18T10:00:00Z',
    })], [], [])
    expect(pasDeLaFila(oferta({ estado: 'bloqueada' }), r['o1'], ara)?.clau).toBe('off.pas_recollida_retornada')
  })

  it('una canalización anulada no hace esperar ninguna recogida', () => {
    const r = resumPerOferta([canal({ estado: 'anulada' })], [], [])
    expect(pasDeLaFila(oferta(), r['o1'], ara)?.clau).toBe('off.pas_sense_enviar')
  })

  it('el REC manda: emitido, entregado, confirmado', () => {
    const rec = (estado: string) => resumPerOferta([canal({ kg_confirmados: 100, recollida_validada_at: '2026-11-18T10:00:00Z' })], [],
      [{ excedente_id: 'o1', estado, numero_completo: 'REC-2026-00001', entregado_at: '2026-11-15T10:00:00Z' }])['o1']
    const o = oferta({ estado: 'bloqueada' })
    expect(pasDeLaFila(o, rec('emitido'), ara)?.clau).toBe('proc.e_recollida_emes_t')
    expect(pasDeLaFila(o, rec('entregado'), ara)?.clau).toBe('proc.e_recollida_entregat_t')
    expect(pasDeLaFila(o, rec('confirmado'), ara)).toEqual({ clau: 'off.pas_per_conciliar', vars: {}, emToca: true })
    // Un REC anulado o en borrador no cuenta.
    expect(pasDeLaFila(o, rec('anulado'), ara)).toBeNull()
    expect(pasDeLaFila(o, rec('borrador'), ara)).toBeNull()
  })

  it('vencida con kilos sin cubrir', () => {
    expect(pasDeLaFila(oferta({ disponible_hasta: '2026-11-01' }), undefined, ara)?.clau).toBe('proc.e_vencuda_t')
  })

  it('no colocada: falta el destino', () => {
    expect(pasDeLaFila(oferta({ estado: 'no_colocada' }), undefined, ara)?.clau).toBe('proc.e_sense_desti_t')
  })

  it('sin línea: por validar, en espigolada y las del Històric', () => {
    expect(pasDeLaFila(oferta({ estado: 'pendent_validacio' }), undefined, ara)).toBeNull()
    expect(pasDeLaFila(oferta({ estado: 'borrador' }), undefined, ara)).toBeNull()
    expect(pasDeLaFila(oferta({ estado: 'cerrada' }), undefined, ara)).toBeNull()
    expect(pasDeLaFila(oferta({ estado: 'cancelada' }), undefined, ara)).toBeNull()
  })

  it('toda clave que puede salir existe en ca y en es', () => {
    for (const clau of CLAUS_PAS_LLISTAT) {
      expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
      expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
    }
  })
})

describe('paginación del Històric', () => {
  it('rango inclusivo de 25', () => {
    expect(rangPagina(0)).toEqual({ des: 0, fins: 24 })
    expect(rangPagina(2)).toEqual({ des: 50, fins: 74 })
    expect(rangPagina(-1)).toEqual({ des: 0, fins: 24 })
  })
  it('páginas y «n–m de total»', () => {
    expect(nombrePagines(0)).toBe(1)
    expect(nombrePagines(25)).toBe(1)
    expect(nombrePagines(26)).toBe(2)
    expect(textPagina(0, 25, 59)).toEqual({ a: 1, b: 25, total: 59 })
    expect(textPagina(2, 9, 59)).toEqual({ a: 51, b: 59, total: 59 })
    expect(textPagina(0, 0, 0)).toEqual({ a: 0, b: 0, total: 0 })
  })
})

describe('el buscador del Històric', () => {
  it('sin texto, nada', () => {
    expect(patroIlike('   ')).toBeNull()
    expect(patroIlike('**')).toBeNull()
    expect(filtreCercaHistoric('')).toBeNull()
  })
  it('entre comillas: comas y paréntesis no parten el filtro', () => {
    expect(patroIlike('a,b(c)')).toBe('"*a,b(c)*"')
  })
  it('los comodines de LIKE se buscan tal cual y las comillas se escapan', () => {
    expect(patroIlike('50%')).toBe('"*50\\\\%*"')
    expect(patroIlike('a_b')).toBe('"*a\\\\_b*"')
    expect(patroIlike('x"y')).toBe('"*x\\"y*"')
    expect(patroIlike('a*b')).toBe('"*ab*"')
  })
  it('busca en referencia, producto y variedad', () => {
    expect(filtreCercaHistoric(' Poma ')).toBe(
      'id_excedente.ilike."*Poma*",producto.ilike."*Poma*",variedad.ilike."*Poma*"')
  })
})

describe('límites del rango de fechas de cierre', () => {
  it('desde el principio del primer día hasta antes del día siguiente al último (hora local)', () => {
    const l = limitsDies('2026-11-01', '2026-11-30')
    expect(l.gte).toBe(new Date(2026, 10, 1).toISOString())
    expect(l.lt).toBe(new Date(2026, 11, 1).toISOString())
  })
  it('sin fechas o con una mal escrita, sin límite', () => {
    expect(limitsDies('', '')).toEqual({ gte: null, lt: null })
    expect(limitsDies('ahir', '2026-13-45')).toEqual({ gte: null, lt: null })
  })
})
