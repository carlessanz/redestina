// El listado de ofertas del equipo (puntos 4-6, fase 1, 19-11-2026): pestañas, paso del
// proceso por fila, kilos sin anuladas y lo que va al servidor en el Històric.

import { describe, expect, it } from 'vitest'
import {
  CLAUS_PAS_LLISTAT, ESTATS_ACTIUS, ESTATS_HISTORIC, ORDRE_PER_DEFECTE, filtreCercaHistoric, filtreModalitatHistoric,
  kgDeLaFila, kgPerOferta, limitsDies, llegeixOrdre,
  llegeixPestanya, nombrePagines, nomOfertant, ordenaPerData, pasDeLaFila, patroIlike, rangPagina, resumPerOferta, textPagina,
  tipusOperacioDe, vencudaSenseResoldre,
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

describe('columnas del listado (20-11-2026)', () => {
  it('nomOfertant: empresa, si no persona, si no «—»', () => {
    expect(nomOfertant({ name: 'Anna', empresa: 'Hort del Pla' })).toBe('Hort del Pla')
    expect(nomOfertant({ name: 'Anna', empresa: '  ' })).toBe('Anna')
    expect(nomOfertant({ name: null, empresa: null })).toBe('—')
    expect(nomOfertant(null)).toBe('—')
    expect(nomOfertant(undefined)).toBe('—')
  })

  it('kgDeLaFila: ofrecidos, con salida, pendientes y porcentaje acotado', () => {
    expect(kgDeLaFila(100, 40)).toEqual({ total: 100, canalitzats: 40, falten: 60, pct: 40 })
    expect(kgDeLaFila('250', 250)).toEqual({ total: 250, canalitzats: 250, falten: 0, pct: 100 })
    // Asignado de más: lo pendiente no es negativo y la barra no pasa del 100 %.
    expect(kgDeLaFila(100, 130)).toEqual({ total: 100, canalitzats: 130, falten: 0, pct: 100 })
    // Sin kilos ofrecidos (un esborrany vacío): sin porcentaje, sin división por cero.
    expect(kgDeLaFila(null, 0)).toEqual({ total: 0, canalitzats: 0, falten: 0, pct: 0 })
    expect(kgDeLaFila(100, -5).canalitzats).toBe(0)
  })

  it('kgDeLaFila cuadra con kgPerOferta: una canalización anulada no cuenta', () => {
    const k = kgPerOferta([canal({ kg_confirmados: 30 }), canal({ kg_confirmados: 50, estado: 'anulada' })])
    expect(kgDeLaFila(100, k.o1 ?? 0).falten).toBe(70)
  })

  it('ordenaPerData: sentido, huecos al final y desempate estable', () => {
    const f = [
      { id: 'b', d: '2026-11-10T10:00:00Z' },
      { id: 'x', d: null },
      { id: 'a', d: '2026-11-10T10:00:00Z' },
      { id: 'c', d: '2026-11-18T10:00:00Z' },
      { id: 'z', d: '2026-11-01T10:00:00Z' },
    ]
    const ids = (r: typeof f) => r.map((o) => o.id)
    expect(ids(ordenaPerData(f, (o) => o.d, 'recent', (o) => o.id))).toEqual(['c', 'b', 'a', 'z', 'x'])
    expect(ids(ordenaPerData(f, (o) => o.d, 'antiga', (o) => o.id))).toEqual(['z', 'a', 'b', 'c', 'x'])
    // A igual fecha el desempate sigue el sentido (orden exactamente inverso). No toca el original.
    expect(ids(f)).toEqual(['b', 'x', 'a', 'c', 'z'])
  })
})

describe('fase 4: orden por disponibilidad, tipus d\'operació y modalidad prevista', () => {
  it('el orden por defecto es la disponibilidad; lo desconocido, también', () => {
    expect(ORDRE_PER_DEFECTE).toBe('disponibilitat')
    expect(llegeixOrdre(null)).toBe('disponibilitat')
    expect(llegeixOrdre('xx')).toBe('disponibilitat')
    for (const o of ['disponibilitat', 'disponibilitat_desc', 'recent', 'antiga']) expect(llegeixOrdre(o)).toBe(o)
  })

  it('vencida sin resolver: pasada la fecha y con kilos sin salida', () => {
    expect(vencudaSenseResoldre({ disponible_hasta: '2026-11-01', kg_total: 100 }, 40, ara)).toBe(true)
    expect(vencudaSenseResoldre({ disponible_hasta: '2026-11-01', kg_total: 100 }, 100, ara)).toBe(false)
    expect(vencudaSenseResoldre({ disponible_hasta: '2026-12-01', kg_total: 100 }, 0, ara)).toBe(false)
    expect(vencudaSenseResoldre({ disponible_hasta: null, kg_total: 100 }, 0, ara)).toBe(false)
  })

  it('tipus d\'operació: la columna manda; sin ella, se deduce como la base', () => {
    expect(tipusOperacioDe({ tipus_operacio: 'espigolada' })).toBe('espigolada')
    expect(tipusOperacioDe({ tipus_operacio: 'excedent', espigolada_demanada: true })).toBe('excedent')
    expect(tipusOperacioDe({ espigolada_demanada: true })).toBe('espigolada')
    expect(tipusOperacioDe({ espigolada_id: 'j1' })).toBe('espigolada')
    expect(tipusOperacioDe({})).toBe('excedent')
  })

  it('la modalidad prevista del Històric: lista o la de siempre, y nada que no sea una modalidad', () => {
    expect(filtreModalitatHistoric('maquila')).toBe('modalitats.cs.{maquila},modalitat.eq.maquila')
    expect(filtreModalitatHistoric('espigolada')).toBeNull()
    expect(filtreModalitatHistoric('venda),estado.eq.(cerrada')).toBeNull()
    expect(filtreModalitatHistoric('')).toBeNull()
    expect(filtreModalitatHistoric(undefined)).toBeNull()
  })
})

describe('claves i18n de las columnas nuevas', () => {
  const claus = ['off.c_disponibilitat', 'off.c_ofertant', 'off.kg_oferts', 'off.kg_sortida', 'off.ordre_disp_asc',
    'off.ordre_disp_desc', 'off.disponible_fins', 'off.sense_disponibilitat', 'fl.o_antiga', 'fl.o_disponibilitat',
    'fl.o_disponibilitat_desc', 'fl.o_tancament_recent', 'fl.o_tancament_antic', 'fl.d_tipus_operacio',
    'fl.d_modalitat_prevista', 'fl.r_disponibilitat', 'tipop.excedent', 'tipop.espigolada']
  it.each(claus)('%s existe en ca y es', (c) => {
    expect(DICTS.ca[c]).toBeTruthy()
    expect(DICTS.es[c]).toBeTruthy()
  })
  it('las que llevan variables las llevan en los dos idiomas', () => {
    expect(DICTS.ca['off.kg_sortida']).toMatch(/\{a\}.*\{b\}/)
    expect(DICTS.es['off.kg_sortida']).toMatch(/\{a\}.*\{b\}/)
    expect(DICTS.ca['off.kg_oferts']).toContain('{n}')
    expect(DICTS.es['off.kg_oferts']).toContain('{n}')
  })
})
