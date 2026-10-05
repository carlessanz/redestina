// Los textos de los avisos (05-10-2026, rebanada 2). El correo y el WhatsApp los compone
// `_shared/textAvis.ts`; el panel, sus claves `avis.t_<tipus>`. Aquí se comprueba que cada
// tipo dice algo en los dos idiomas, que no queda ningún marcador sin rellenar y que el
// caso que motivó todo esto —«pediste 1.000, te aprobamos 500»— se dice.

import { describe, expect, it } from 'vitest'
import { TIPUS_AVIS, textAvis } from '../supabase/functions/_shared/textAvis.ts'
import { DICTS } from '../src/lib/i18n'

const PARAMS = {
  producte: 'Carbassó', ref: 'E-261005-MAS-CAR-1', kg: 500, kg_sol: 1000, kg_apr: 500,
  entitat: 'Menjador Social', productor: 'Mas de Prova', municipi: 'Vic', motiu: 'Duplicada',
}

describe('textAvis', () => {
  for (const tipus of TIPUS_AVIS) {
    for (const idioma of ['ca', 'es'] as const) {
      it(`${tipus} · ${idioma}`, () => {
        const t = textAvis(tipus, PARAMS, idioma, 'id-1')
        for (const v of [t.asunto, t.titulo, t.cuerpo, t.boton, t.ruta]) {
          expect(v.length).toBeGreaterThan(0)
          expect(v).not.toMatch(/\{[a-z_]+\}|undefined|null|NaN/)
        }
        expect(t.ruta.startsWith('/')).toBe(true)
      })
    }
  }
  it('aprobación parcial: dice lo pedido y lo aprobado, y quién lo ofrece (D1)', () => {
    const t = textAvis('interes_aprovat', PARAMS, 'ca', 'x')
    expect(t.cuerpo).toContain('1.000')
    expect(t.cuerpo).toContain('500')
    expect(t.cuerpo).toContain('Mas de Prova (Vic)')
    expect(t.titulo).toContain('en part')
  })
  it('aprobación completa: no habla de diferencia', () => {
    const t = textAvis('interes_aprovat', { ...PARAMS, kg_sol: 500 }, 'es', 'x')
    expect(t.cuerpo).not.toContain('Habías pedido')
  })
  it('la salida encontrada nombra a la entidad', () => {
    expect(textAvis('sortida_trobada', PARAMS, 'ca', 'x').cuerpo).toContain('Menjador Social')
  })
  it('el rechazo lleva el motivo', () => {
    expect(textAvis('oferta_rebutjada', PARAMS, 'es', 'x').cuerpo).toContain('Duplicada')
  })
  it('el panel tiene la clave de cada tipo en ca y es', () => {
    for (const tipus of TIPUS_AVIS) {
      for (const idioma of ['ca', 'es'] as const) {
        expect((DICTS[idioma] as Record<string, string>)[`avis.t_${tipus}`], `avis.t_${tipus} ${idioma}`).toBeTruthy()
      }
    }
  })
})
