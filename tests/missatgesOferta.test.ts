// El registro de mensajes de una oferta (`src/lib/missatgesOferta.ts`, 27-10-2026).
//
// Lo que se fija aquí es lo que hace útil el registro: que el WhatsApp de un aviso es,
// carácter a carácter, el que manda `enviar-avis`; que cada paso trae los mensajes que le
// tocan; y que un aviso al ofertante no lleva el código interno `E-…`.

import { describe, expect, it } from 'vitest'
import {
  FASE_AVIS, missatgeDAvis, missatgesDeLOferta, textRecollidaGrup,
} from '../src/lib/missatgesOferta'
import type { AvisMissatge, FetsMissatges } from '../src/lib/missatgesOferta'
import {
  formatTextAvisCorreu, formatWhatsappAvis, TIPUS_AVIS, textAvis,
} from '../supabase/functions/_shared/textAvis.ts'
import { textGracies, TEXT_REBUIG } from '../supabase/functions/_shared/textRespostes.ts'
import { DICTS } from '../src/lib/i18n'

const APP = 'https://redestina.example'
const t = (k: string, p?: Record<string, string | number>) => {
  let s = DICTS.ca[k] ?? k
  for (const [c, v] of Object.entries(p ?? {})) s = s.replaceAll(`{${c}}`, String(v))
  return s
}
const OPC = { idioma: 'ca' as const, appUrl: APP, t }

function avis(tipus: string, extra: Partial<AvisMissatge> = {}): AvisMissatge {
  return {
    id: `a-${tipus}`, tipus, params: { producte: 'Tomàquet', ref: 'E-261027-HOR-TOM-1', kg: 120 },
    objecte_id: 'obj-1', destinatari_tipo: 'productor', destinatari_id: 'prod-1',
    canal_enviat: null, enviat_at: null, error_envio: null, created_at: '2026-10-27T09:00:00Z',
    ...extra,
  }
}

const BASE: FetsMissatges = {
  oferta: {
    id: 'exc-1', producto: 'Tomàquet', id_excedente: 'E-261027-HOR-TOM-1', estado: 'parcial',
    texto_oferta: '📢 *OFERTA DISPONIBLE*\n\n🌿 PRODUCTE: Tomàquet', kg_total: 300, origen: 'intake',
    validada_at: '2026-10-27T08:00:00Z', created_at: '2026-10-27T07:00:00Z',
  },
  productor: { id: 'prod-1', nom: 'Horta de Prova SL' },
  entitats: { 'ent-1': 'Menjador Social de Prova' },
}

describe('el WhatsApp de un aviso es el que manda enviar-avis', () => {
  for (const tipus of TIPUS_AVIS) {
    for (const dest of ['productor', 'entidad'] as const) {
      it(`${tipus} → ${dest}`, () => {
        const a = avis(tipus, { destinatari_tipo: dest })
        const m = missatgeDAvis(a, OPC)!
        const txt = textAvis(tipus, a.params ?? {}, 'ca', a.objecte_id, dest)
        expect(m.whatsapp).toBe(formatWhatsappAvis(txt, APP))
        expect(m.correu).toEqual({ assumpte: txt.asunto, text: formatTextAvisCorreu(txt, APP) })
        expect(m.fase).toBe(FASE_AVIS[tipus])
      })
    }
  }

  it('un tipo desconocido no se inventa un texto', () => {
    expect(missatgeDAvis(avis('no_existeix'), OPC)).toBeNull()
  })

  it('el estado sale de canal_enviat', () => {
    expect(missatgeDAvis(avis('interes_aprovat', { canal_enviat: 'whatsapp', enviat_at: '2026-10-27T10:00:00Z' }), OPC))
      .toMatchObject({ estat: 'enviat', canalEnviat: 'whatsapp' })
    expect(missatgeDAvis(avis('interes_aprovat', { canal_enviat: 'email' }), OPC))
      .toMatchObject({ estat: 'enviat', canalEnviat: 'email' })
    expect(missatgeDAvis(avis('interes_aprovat', { canal_enviat: 'cap', error_envio: 'notificacions_desactivades' }), OPC))
      .toMatchObject({ estat: 'no_enviat', motiuNoEnviat: 'notificacions_desactivades' })
    expect(missatgeDAvis(avis('interes_aprovat'), OPC)).toMatchObject({ estat: 'pendent' })
  })

  it('ningún aviso al ofertante lleva el código interno E-…', () => {
    for (const tipus of TIPUS_AVIS) {
      const m = missatgeDAvis(avis(tipus), OPC)!
      expect(m.whatsapp).not.toMatch(/E-\d{6}-/)
      expect(m.correu?.text ?? '').not.toMatch(/E-\d{6}-/)
    }
  })
})

describe('los mensajes de una oferta', () => {
  it('oferta asignada: alta, oferta, respuesta del bot, avisos y RECOLLIDA CONFIRMADA, por fases', () => {
    const ms = missatgesDeLOferta({
      ...BASE,
      respostes: [
        { id: 'r1', entidad_id: 'ent-1', canal: 'asistido', estado: 'acceptada', kg_solicitados: 120, respondido_at: '2026-10-27T09:30:00Z' },
        { id: 'r2', entidad_id: 'ent-1', canal: 'panel', estado: 'acceptada', kg_solicitados: 50 },
      ],
      canalitzacions: [
        { id: 'c1', entidad_id: 'ent-1', kg_confirmados: 120, data_hora_recollida: '2026-10-28T08:00:00Z', estado: 'pendent', comentarios: 'Porta caixes' },
      ],
      avisos: [
        avis('sortida_trobada', { created_at: '2026-10-27T10:00:00Z' }),
        avis('interes_aprovat', { destinatari_tipo: 'entidad', destinatari_id: 'ent-1', created_at: '2026-10-27T10:00:00Z' }),
        avis('oferta_validada', { created_at: '2026-10-27T08:00:00Z' }),
      ],
    }, OPC)
    expect(ms.map((m) => m.clau)).toEqual([
      'oferta_registrada', 'oferta_validada', 'oferta', 'resposta_gracies',
      'sortida_trobada', 'interes_aprovat', 'recollida_grup',
    ])
    expect(ms.find((m) => m.clau === 'resposta_gracies')!.whatsapp).toBe(textGracies(120))
    // La entidad del aviso lleva su nombre; el ofertante, el suyo.
    expect(ms.find((m) => m.clau === 'interes_aprovat')!.destinatariNom).toBe('Menjador Social de Prova')
    expect(ms.find((m) => m.clau === 'sortida_trobada')!.destinatariNom).toBe('Horta de Prova SL')
    // El interés hecho en el panel por la entidad no genera respuesta del bot.
    expect(ms.filter((m) => m.clau === 'resposta_gracies')).toHaveLength(1)
    const grup = ms.find((m) => m.clau === 'recollida_grup')!
    expect(grup.whatsapp).toContain('Menjador Social de Prova')
    expect(grup.whatsapp).toContain('KG RECOLLITS: 120')
    expect(grup.whatsapp).toContain('KG FALTEN RECOLLIR: 180')
    expect(grup.whatsapp).toContain('Porta caixes')
    expect(grup.whatsapp).toMatch(/DATA i HORA: 28\/10 · 09:00/)
  })

  it('el agradecimiento dice «la revisarà» si la oferta pasó por validación', () => {
    const [m] = missatgesDeLOferta(BASE, OPC)
    expect(m.clau).toBe('oferta_registrada')
    expect(m.whatsapp).toContain('la revisarà')
    const sense = missatgesDeLOferta({ ...BASE, oferta: { ...BASE.oferta, validada_at: null, estado: 'publicada' } }, OPC)
    expect(sense[0].whatsapp).not.toContain('la revisarà')
  })

  it('una espigolada no tiene mensaje de alta, y un rechazo da el texto del bot', () => {
    const ms = missatgesDeLOferta({
      ...BASE,
      oferta: { ...BASE.oferta, origen: 'espigolament' },
      respostes: [{ id: 'r', entidad_id: 'ent-1', canal: 'whatsapp', estado: 'rebutjada', kg_solicitados: null }],
    }, OPC)
    expect(ms.map((m) => m.clau)).toEqual(['oferta', 'resposta_rebuig'])
    expect(ms[1].whatsapp).toBe(TEXT_REBUIG)
  })

  it('las entregas anuladas no cuentan en RECOLLIDA CONFIRMADA', () => {
    const txt = textRecollidaGrup([
      { id: 'a', entidad_id: 'e1', kg_confirmados: 100, data_hora_recollida: null, estado: 'pendent' },
      { id: 'b', entidad_id: 'e2', kg_confirmados: 50, data_hora_recollida: null, estado: 'anulada' },
    ], 300, (id) => (id === 'e1' ? 'Uno' : 'Dos'), 'ca')
    expect(txt).toContain('SDA / ENTITAT: Uno')
    expect(txt).not.toContain('Dos')
    expect(txt).toContain('KG FALTEN RECOLLIR: 200')
  })
})

describe('las claves compuestas de los mensajes existen en los dos idiomas', () => {
  for (const dest of ['productor', 'entidad', 'grup']) {
    it(`msg.dest_${dest}`, () => {
      expect(DICTS.ca[`msg.dest_${dest}`]).toBeTruthy()
      expect(DICTS.es[`msg.dest_${dest}`]).toBeTruthy()
    })
  }
})
