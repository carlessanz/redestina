// El certificado de donación en la interfaz (`src/lib/certificatsDonacio.ts`): el ámbito, la
// fecha de expedición con el mismo rango que la base y el motivo de cada exclusión.

import { describe, expect, it } from 'vitest'
import {
  ABAST_PER_DEFECTE, ABASTS_DIALEG, abastPeriode, clauAbast, clauTipus, dataExpedicioPerDefecte,
  dataExpedicioValida, kgExclosos, motiuExclusio, rangDataExpedicio, rangPossible, textExercici,
  textPeriodeUi,
} from '../src/lib/certificatsDonacio'
import { DICTS } from '../src/lib/i18n'

describe('el ámbito', () => {
  it('los tres, y el de por defecto es uno de ellos', () => {
    expect([...ABASTS_DIALEG].sort()).toEqual(['exercici', 'oferta', 'periode'])
    expect(ABASTS_DIALEG).toContain(ABAST_PER_DEFECTE)
  })
  it('cada ámbito tiene su nombre en los dos idiomas', () => {
    for (const a of ABASTS_DIALEG) {
      expect(DICTS.ca[clauAbast(a)]).toBeDefined()
      expect(DICTS.es[clauAbast(a)]).toBeDefined()
    }
  })
  it('una fila de cierres_periodo antigua (sin abast) es de periodo', () => {
    expect(abastPeriode({})).toBe('periode')
    expect(abastPeriode({ abast: 'periode', excedente_id: null })).toBe('periode')
    expect(abastPeriode({ abast: 'oferta', excedente_id: 'x' })).toBe('oferta')
    expect(abastPeriode({ excedente_id: 'x' })).toBe('oferta')
  })
})

describe('el motivo de una exclusión', () => {
  it('cada motivo de cierre_exclosos_periodo() tiene su clave', () => {
    expect(motiuExclusio('venda')).toEqual({ clau: 'cdon.mot_venda', tipus: null })
    expect(motiuExclusio('maquila')).toEqual({ clau: 'cdon.mot_maquila', tipus: null })
    expect(motiuExclusio('sense_entitat')).toEqual({ clau: 'cdon.mot_sense_entitat', tipus: null })
    expect(motiuExclusio('sense_valoritzacio')).toEqual({ clau: 'cdon.mot_sense_valoritzacio', tipus: null })
    expect(motiuExclusio('conciliacio_retroactiva')).toEqual({ clau: 'cdon.mot_retroactiva', tipus: null })
  })
  it('una entidad no social lleva su tipo; uno desconocido o vacío se dice «desconegut»', () => {
    expect(motiuExclusio('entitat_no_social:transformador')).toEqual({ clau: 'cdon.mot_no_social', tipus: 'transformador' })
    expect(motiuExclusio('entitat_no_social:animal').tipus).toBe('animal')
    expect(motiuExclusio('entitat_no_social:desconegut').tipus).toBe('desconegut')
    expect(motiuExclusio('entitat_no_social:').tipus).toBe('desconegut')
    expect(motiuExclusio('entitat_no_social:marciana').tipus).toBe('desconegut')
  })
  it('un motivo nuevo en la base no se inventa', () => {
    expect(motiuExclusio('un_motiu_nou').clau).toBe('cdon.mot_altre')
    expect(motiuExclusio(null).clau).toBe('cdon.mot_altre')
  })
  it('todas las claves que puede devolver existen en ca y es', () => {
    const motius = ['venda', 'maquila', 'sense_entitat', 'sense_valoritzacio', 'conciliacio_retroactiva',
      'entitat_no_social:social', 'entitat_no_social:animal', 'entitat_no_social:transformador',
      'entitat_no_social:comercial', 'entitat_no_social:desconegut', 'altre']
    for (const m of motius) {
      const e = motiuExclusio(m)
      expect(DICTS.ca[e.clau], e.clau).toBeDefined()
      expect(DICTS.es[e.clau], e.clau).toBeDefined()
      if (e.tipus) {
        expect(DICTS.ca[clauTipus(e.tipus)], clauTipus(e.tipus)).toBeDefined()
        expect(DICTS.es[clauTipus(e.tipus)], clauTipus(e.tipus)).toBeDefined()
      }
    }
  })
  it('suma los kilos excluidos', () => {
    expect(kgExclosos([{ kg: 250 }, { kg: null }, { kg: 10.5 }])).toBe(260.5)
  })
})

describe('la fecha de expedición', () => {
  const avui = '2026-11-05'

  it('oferta e intervalo: por defecto hoy, entre el fin del periodo y hoy', () => {
    expect(dataExpedicioPerDefecte('oferta', { avui })).toBe(avui)
    expect(dataExpedicioPerDefecte('periode', { avui, periodeFins: '2026-10-08' })).toBe(avui)
    const r = rangDataExpedicio('oferta', { avui, periodeFins: '2026-10-08' })
    expect(r).toEqual({ min: '2026-10-08', max: avui })
    expect(dataExpedicioValida('2026-10-08', r)).toBe(true)
    expect(dataExpedicioValida('2026-10-07', r)).toBe(false)
    expect(dataExpedicioValida('2026-11-06', r)).toBe(false)
  })
  it('sin calcular todavía no hay mínimo: solo cuenta el máximo', () => {
    const r = rangDataExpedicio('periode', { avui })
    expect(r.min).toBeNull()
    expect(dataExpedicioValida('2020-01-01', r)).toBe(true)
    expect(dataExpedicioValida('2026-12-01', r)).toBe(false)
  })
  it('anual real: el 31-12 del ejercicio, y no antes', () => {
    const c = { avui, exercici: 2025, mode: 'real' as const }
    expect(dataExpedicioPerDefecte('exercici', c)).toBe('2025-12-31')
    const r = rangDataExpedicio('exercici', c)
    expect(r).toEqual({ min: '2025-12-31', max: avui })
    expect(dataExpedicioValida('2025-12-30', r)).toBe(false)
    expect(dataExpedicioValida('2026-01-15', r)).toBe(true)
  })
  it('anual real del ejercicio en curso: no hay fecha posible', () => {
    const r = rangDataExpedicio('exercici', { avui, exercici: 2026, mode: 'real' })
    expect(rangPossible(r)).toBe(false)
  })
  it('anual de prueba del ejercicio en curso: hoy (como `least(31-12, hoy)` de la base)', () => {
    const c = { avui, exercici: 2026, mode: 'prueba' as const }
    expect(dataExpedicioPerDefecte('exercici', c)).toBe(avui)
    expect(rangPossible(rangDataExpedicio('exercici', c))).toBe(true)
  })
  it('una fecha que no es ISO no vale', () => {
    expect(dataExpedicioValida('', { min: null, max: avui })).toBe(false)
    expect(dataExpedicioValida('05/11/2026', { min: null, max: avui })).toBe(false)
  })
})

describe('el periodo en texto, como en el PDF', () => {
  it('con mayúscula inicial', () => {
    expect(textPeriodeUi('periode', '2026-10-01', '2026-10-31', 'ca')).toBe('El període 01/10/2026 a 31/10/2026')
    expect(textPeriodeUi('oferta', '2026-10-08', '2026-10-08', 'ca')).toBe('El dia 08/10/2026')
    expect(textPeriodeUi('oferta', '2026-10-08', '2026-10-08', 'es')).toBe('El día 08/10/2026')
    expect(textExercici(2025, 'ca')).toBe('L\'exercici 01/01/2025 a 31/12/2025')
    expect(textExercici(2025, 'es')).toBe('El ejercicio 01/01/2025 a 31/12/2025')
  })
})
