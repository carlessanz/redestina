import { describe, expect, it } from 'vitest'
import {
  idsBotonsConfirmacio, llegirIdConfirmacio, llegirKg, textDemanaKg, textPreguntaConfirmacio,
} from '../supabase/functions/_shared/confirmacions.ts'

const ID = '0f8e2a5c-1b2d-4c3e-9f00-123456789abc'

describe('confirmar un albarà per WhatsApp', () => {
  it('llegeix només els ids dels seus botons', () => {
    const b = idsBotonsConfirmacio(ID)
    expect(llegirIdConfirmacio(b.ok)).toEqual({ enlace: ID, accio: 'ok' })
    expect(llegirIdConfirmacio(b.dif)).toEqual({ enlace: ID, accio: 'dif' })
    // Els de la resposta a una oferta o de l'intake no són seus.
    expect(llegirIdConfirmacio('accept:si')).toBeNull()
    expect(llegirIdConfirmacio(`conf:${ID}:potser`)).toBeNull()
    expect(llegirIdConfirmacio('conf:no-es-uuid:ok')).toBeNull()
    expect(llegirIdConfirmacio(null)).toBeNull()
  })

  it('el títol dels botons cap en els 20 caràcters de Meta', () => {
    expect('Tot correcte'.length).toBeLessThanOrEqual(20)
    expect('Hi ha diferències'.length).toBeLessThanOrEqual(20)
  })

  it('treu els quilos d’un missatge, i només si n’hi ha un', () => {
    expect(llegirKg('95')).toBe(95)
    expect(llegirKg('95,5 kg')).toBe(95.5)
    expect(llegirKg('uns 120 kg')).toBe(120)
    expect(llegirKg('1.200')).toBe(1200)
    expect(llegirKg('0')).toBe(0)
    expect(llegirKg('de 90 a 95')).toBeNull()
    expect(llegirKg('cap')).toBeNull()
    expect(llegirKg('')).toBeNull()
    expect(llegirKg('200000')).toBeNull()
  })

  it('la pregunta i la demanda de quilos parlen de qui lliura o de qui rep', () => {
    expect(textPreguntaConfirmacio({ numero: 'REC-2026-00003', rol: 'entrega', producte: 'Cogombre', kg: 100 }))
      .toContain("s'ha lliurat")
    expect(textPreguntaConfirmacio({ numero: 'ENT-2026-00006', rol: 'recibe' })).toContain("s'ha rebut")
    expect(textDemanaKg('entrega')).toContain('lliurat')
    expect(textDemanaKg('recibe')).toContain('rebut')
  })
})
