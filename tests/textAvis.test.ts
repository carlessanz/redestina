// Los textos de los avisos (05-10-2026, rebanada 2). El correo y el WhatsApp los compone
// `_shared/textAvis.ts`; el panel, sus claves `avis.t_<tipus>`. Aquí se comprueba que cada
// tipo dice algo en los dos idiomas, que no queda ningún marcador sin rellenar y que el
// caso que motivó todo esto —«pediste 1.000, te aprobamos 500»— se dice.

import { describe, expect, it } from 'vitest'
import { TIPUS_AVIS, textAvis, textConfirmacioRecollida } from '../supabase/functions/_shared/textAvis.ts'
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

describe('textConfirmacioRecollida (rebanada 3)', () => {
  for (const idioma of ['ca', 'es'] as const) {
    it(`primer envío y reenvío · ${idioma}`, () => {
      const a = textConfirmacioRecollida('ENT-2026-00001', idioma, false)
      const b = textConfirmacioRecollida('ENT-2026-00001', idioma, true)
      expect(a.asunto).toContain('ENT-2026-00001')
      expect(a.cuerpo).toContain('48')
      // El reenvío avisa de que el enlace anterior ya no vale, y el primero no.
      expect(b.cuerpo.split('\n').length).toBe(a.cuerpo.split('\n').length + 1)
      expect(b.asunto).not.toBe(a.asunto)
    })
  }
})

describe('el ofertante no ve el código interno de la oferta', () => {
  it('ningún aviso imprime el id_excedente (revisión del 08-10-2026, §3.5)', () => {
    for (const tipus of TIPUS_AVIS) {
      for (const idioma of ['ca', 'es'] as const) {
        const tx = textAvis(tipus, PARAMS, idioma, 'x')
        expect(`${tx.asunto} ${tx.titulo} ${tx.cuerpo}`).not.toContain('E-261005')
      }
    }
  })
})

describe('los avisos que reciben las dos partes llevan a la pantalla de cada una (fase 2)', () => {
  const amb = { ...PARAMS, excedente_id: 'exc-1', recollida_at: '2026-10-10T08:00:00Z', kg_abans: 150 }
  for (const tipus of ['recollida_canviada', 'kg_assignats_canviats', 'oferta_modificada'] as const) {
    it(tipus, () => {
      expect(textAvis(tipus, amb, 'ca', 'resp-1', 'entidad').ruta).toBe('/receptor/interessos')
      expect(textAvis(tipus, amb, 'ca', 'exc-1', 'productor').ruta).toBe('/productor/ofertes/exc-1')
    })
  }
  it('la hora de la recogida se dice en hora de Madrid', () => {
    expect(textAvis('recollida_canviada', amb, 'ca', 'x', 'entidad').cuerpo).toContain('10/10 · 10:00')
  })
})

describe('recollida_confirmada: los kg que registra el receptor (17-10-2026)', () => {
  const BASE = { producte: 'Carbassó', entitat: 'Menjador Social', kg: 180 }
  it('con diferencia dice lo recogido, lo asignado y que lo revisa el equipo (ca)', () => {
    const t = textAvis('recollida_confirmada', { ...BASE, kg_assignats: 200, diferencia: true }, 'ca', 'x')
    expect(t.cuerpo).toContain('Menjador Social ha registrat que ha recollit 180 kg de Carbassó, respecte als 200 kg assignats.')
    expect(t.cuerpo).toContain('L’equip de Redestina revisa la diferència.')
    expect(t.asunto).toContain('amb diferència')
    expect(t.titulo).toBe('Recollida amb diferència')
  })
  it('con diferencia dice lo recogido, lo asignado y que lo revisa el equipo (es)', () => {
    const t = textAvis('recollida_confirmada', { ...BASE, kg_assignats: 12000, diferencia: true }, 'es', 'x')
    expect(t.cuerpo).toContain('Menjador Social ha registrado que ha recogido 180 kg de Carbassó, frente a los 12.000 kg asignados.')
    expect(t.cuerpo).toContain('El equipo de Redestina revisa la diferencia.')
    expect(t.asunto).toContain('con diferencia')
    expect(t.titulo).toBe('Recogida con diferencia')
  })
  it('sin diferencia, el texto de siempre aunque lleve kg_assignats', () => {
    for (const idioma of ['ca', 'es'] as const) {
      const t = textAvis('recollida_confirmada', { ...BASE, kg: 200, kg_assignats: 200, diferencia: false }, idioma, 'x')
      expect(t.cuerpo).not.toMatch(/diferència|diferencia|assignats|asignados/)
      expect(t.titulo).toBe(idioma === 'es' ? 'Salida confirmada' : 'Sortida confirmada')
    }
  })
  it('params antiguos (sin kg_assignats ni diferencia): el texto de siempre', () => {
    expect(textAvis('recollida_confirmada', BASE, 'ca', 'x').cuerpo)
      .toBe('Menjador Social ha confirmat que ha rebut 180 kg de Carbassó.')
    expect(textAvis('recollida_confirmada', BASE, 'es', 'x').cuerpo)
      .toBe('Menjador Social ha confirmado que ha recibido 180 kg de Carbassó.')
  })
  it('diferencia sin kg_assignats no inventa la cifra', () => {
    const t = textAvis('recollida_confirmada', { ...BASE, diferencia: true }, 'ca', 'x')
    expect(t.cuerpo).toBe('Menjador Social ha confirmat que ha rebut 180 kg de Carbassó.')
  })
  it('con la hora de recogida, sin marcadores sueltos', () => {
    for (const idioma of ['ca', 'es'] as const) {
      const t = textAvis('recollida_confirmada',
        { ...BASE, kg_assignats: 200, diferencia: true, recollida_at: '2026-10-10T08:00:00Z' }, idioma, 'x')
      expect(t.cuerpo).toContain('(10/10 · 10:00).')
      for (const v of [t.asunto, t.titulo, t.cuerpo]) expect(v).not.toMatch(/\{[a-z_]+\}|undefined|null|NaN|—/)
    }
  })
})

describe('recollida_per_registrar y recollida_retornada: el equipo valida el registro (17-10-2026)', () => {
  const BASE = { producte: 'Carbassó', kg: 200, kg_declarats: 180, motiu: 'Falta la foto del pes', excedente_id: 'exc-1' }
  it('recollida_per_registrar no promete que registrar genera los albaranes', () => {
    const ca = textAvis('recollida_per_registrar', BASE, 'ca', 'x', 'entidad')
    const es = textAvis('recollida_per_registrar', BASE, 'es', 'x', 'entidad')
    expect(ca.cuerpo).not.toContain('amb això es generen')
    expect(es.cuerpo).not.toContain('con eso se generan')
    expect(ca.cuerpo).toContain('L’equip de Redestina ho revisarà i, llavors, es generaran els albarans.')
    expect(es.cuerpo).toContain('El equipo de Redestina lo revisará y, entonces, se generarán los albaranes.')
  })
  it('recollida_retornada en catalán: producto, kg declarados, motivo y qué hacer', () => {
    const t = textAvis('recollida_retornada', BASE, 'ca', 'resp-1', 'entidad')
    expect(t.asunto).toBe('Torna a registrar la recollida de Carbassó')
    expect(t.titulo).toBe('Recollida per tornar a registrar')
    expect(t.cuerpo).toBe(
      'L’equip de Redestina ha revisat el registre de la recollida de Carbassó (180 kg declarats) i necessita que el tornis a registrar.\n'
      + 'Motiu: Falta la foto del pes\n'
      + 'Entra a la fitxa de l’operació i registra de nou els quilos que t’has endut.')
    expect(t.boton).toBe('Registrar la recollida')
    expect(t.ruta).toBe('/receptor/interessos')
  })
  it('recollida_retornada en castellano', () => {
    const t = textAvis('recollida_retornada', BASE, 'es', 'resp-1', 'entidad')
    expect(t.asunto).toBe('Vuelve a registrar la recogida de Carbassó')
    expect(t.titulo).toBe('Recogida por volver a registrar')
    expect(t.cuerpo).toBe(
      'El equipo de Redestina ha revisado el registro de la recogida de Carbassó (180 kg declarados) y necesita que lo vuelvas a registrar.\n'
      + 'Motivo: Falta la foto del pes\n'
      + 'Entra en la ficha de la operación y registra de nuevo los kilos que te has llevado.')
    expect(t.boton).toBe('Registrar la recogida')
    expect(t.ruta).toBe('/receptor/interessos')
  })
  it('recollida_retornada sin motivo ni kg declarados no deja huecos ni marcadores', () => {
    for (const idioma of ['ca', 'es'] as const) {
      const t = textAvis('recollida_retornada', { producte: 'Carbassó' }, idioma, 'x', 'entidad')
      expect(t.cuerpo).not.toMatch(/Motiu|Motivo|declarats|declarados/)
      for (const v of [t.asunto, t.titulo, t.cuerpo, t.boton]) {
        expect(v).not.toMatch(/\{[a-z_]+\}|undefined|null|NaN|—|\(\s*\)/)
      }
    }
  })
})
