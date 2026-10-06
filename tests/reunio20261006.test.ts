// Lo acordado en la reunión con la Fundació del 06-10-2026 que se puede probar sin red:
// la modalidad múltiple, la franja de recogida, el aviso de la variedad y el estado nuevo.

import { describe, it, expect } from 'vitest'
import {
  aplica, CAMPOS, faltantes, modalitatsDe, parseFranja,
} from '../supabase/functions/_shared/camposOferta.ts'
import { aplicaCamp, partFranja, respostaBuida, semblaQuantitat } from '../src/lib/ofertaPura'
import type { CampoOferta as CampoClient } from '../src/lib/ofertes'
import { estatSimpleOferta, etiquetaEstatOferta, puntOferta } from '../src/lib/procesOferta'
import { DICTS } from '../src/lib/i18n'

const campo = (c: string) => CAMPOS.find((x) => x.clave === c)!

describe('modalidad múltiple', () => {
  it('la modalidad se puede marcar varias veces en el panel', () => {
    expect(campo('modalitat').multiple).toBe(true)
  })

  it('con venda entre varias, el preu mínim se pregunta (servidor y cliente)', () => {
    const d = { modalitat: ['donacio', 'venda'] }
    expect(aplica(campo('preu_minim'), d)).toBe(true)
    expect(aplicaCamp(campo('preu_minim') as unknown as CampoClient, d)).toBe(true)
  })

  it('con donació entre varias, el coste por kilo también', () => {
    expect(aplica(campo('cost_kg'), { modalitat: ['venda', 'donacio'] })).toBe(true)
    expect(aplica(campo('cost_kg'), { modalitat: ['venda'] })).toBe(false)
  })

  it('una lista vacía cuenta como modalidad que falta', () => {
    expect(faltantes({ modalitat: [] })).toContain('modalitat')
    expect(respostaBuida([])).toBe(true)
    expect(respostaBuida(['venda'])).toBe(false)
  })

  it('modalitatsDe normaliza una o varias y descarta lo desconocido', () => {
    expect(modalitatsDe('donacio')).toEqual(['donacio'])
    expect(modalitatsDe(['venda', 'venda', 'patata', 'maquila'])).toEqual(['venda', 'maquila'])
    expect(modalitatsDe(null)).toEqual([])
  })
})

describe('franja de recogida', () => {
  it('es obligatoria y se pinta como franja', () => {
    expect(campo('horari').obligatorio).toBe(true)
    expect(campo('horari').widget).toBe('franja')
  })

  it('lee lo que manda el panel y lo que se escribe por WhatsApp', () => {
    expect(parseFranja('09:00-13:30')).toEqual({ desde: '09:00', fins: '13:30' })
    expect(parseFranja('de 9 a 13')).toEqual({ desde: '09:00', fins: '13:00' })
    expect(parseFranja('8h30 - 12h')).toEqual({ desde: '08:30', fins: '12:00' })
  })

  it('una franja al revés o sin horas no es una franja', () => {
    expect(parseFranja('13:00-09:00')).toBeNull()
    expect(parseFranja('matí')).toBeNull()
    expect(partFranja('9-13')).toBeNull()
    expect(partFranja('09:00-13:00')).toEqual(['09:00', '13:00'])
  })
})

describe('la variedad no son kilos', () => {
  it('reconoce una cantidad escrita donde va la variedad', () => {
    expect(semblaQuantitat('200')).toBe(true)
    expect(semblaQuantitat('200 kg')).toBe(true)
    expect(semblaQuantitat('12,5')).toBe(true)
  })
  it('un nombre de variedad pasa', () => {
    expect(semblaQuantitat('Conference')).toBe(false)
    expect(semblaQuantitat('Golden 2')).toBe(false)
    expect(semblaQuantitat('')).toBe(false)
  })
})

describe('pendent de validació', () => {
  it('la oferta pendiente está en la primera etapa, con su variante', () => {
    const p = puntOferta({ estado: 'pendent_validacio', kgTotal: 100, kgCanalitzats: 0 }, 'productor')
    expect(p.etapa).toBe('publicada')
    expect(p.variant).toBe('validacio')
    expect(p.emToca).toBe(false)
    const e = puntOferta({ estado: 'pendent_validacio', kgTotal: 100, kgCanalitzats: 0 }, 'equip')
    expect(e.emToca).toBe(true)
  })

  it('el estado simple del productor la llama «Pendent de validació»', () => {
    const p = puntOferta({ estado: 'pendent_validacio', kgTotal: 100, kgCanalitzats: 0 }, 'productor')
    expect(estatSimpleOferta(p).estat).toBe('validacio')
    expect(etiquetaEstatOferta('pendent_validacio').key).toBe('off.st_pending_validation')
  })

  for (const idioma of ['ca', 'es'] as const) {
    it(`las claves nuevas existen en ${idioma}`, () => {
      const dict = DICTS[idioma] as Record<string, string>
      for (const clau of [
        'val.button', 'val.err_cal_modalitat', 'edit.button', 'edit.err_kg_sota_canalitzat',
        'bloq.albara_pendent', 'bloq.banner_productor', 'bloq.banner_receptor_1',
        'mk.need_quan', 'int.kg_parcial', 'po.varietat_sembla_kg', 'po.franja_err',
        'pe.ofertes_per_validar', 'pe.ofertes_per_validar_cta',
      ]) expect(dict[clau], `${clau} (${idioma})`).toBeTruthy()
    })
  }
})
