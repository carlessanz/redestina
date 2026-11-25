// La disponibilidad multiproducto vista desde el panel (plan DIC 26, fase 6a): el distintivo del
// listado, el mensaje único (el mismo módulo que el servidor) y por dónde sale a cada entidad.

import { describe, expect, it } from 'vitest'
import {
  canalsGrup, contextText, filesDelText, filesPerEntitat, midaGrupDeFila, midesGrups, missatgeEntitat, ordenaGrup,
  productesEsborrany, textDelGrup, type OfertaGrup,
} from '../src/lib/disponibilitat'

function oferta(p: Partial<OfertaGrup>): OfertaGrup {
  return {
    id: 'o', id_excedente: 'E-1', estado: 'publicada', producto: 'Tomàquet', variedad: null, kg_total: 100,
    num_caixes: null, format_entrega: 'caixes', retorn_envasos: 'No', retorn_envasos_detall: null,
    retorn_envasos_quantitat: null, modalitat: 'donacio', modalitats: ['donacio'], preu_minim: null,
    producte_al_camp: false, espigolada_demanada: false, gmaps_url: null, disponible_hasta: '2027-12-31',
    dies_recollida: [1, 3], horari_recollida: 'de 08:00 a 12:00', causa: 'Qualitat i requisits comercials',
    subcausa_codigo: 'C4.2', observacions: null, ubicacion_id: 'u1', productor_id: 'p1',
    created_at: '2026-11-25T10:00:00Z',
    ...p,
  }
}

const A = oferta({ id: 'a', id_excedente: 'E-261125-AAA-TOM-1', producto: 'Tomàquet', kg_total: 300 })
const B = oferta({ id: 'b', id_excedente: 'E-261125-AAA-PEB-1', producto: 'Pebrot', kg_total: 120 })
const C = oferta({ id: 'c', id_excedente: 'E-261125-AAA-CEB-1', producto: 'Ceba', kg_total: 50 })

const ctx = contextText(A, {
  productor: { name: 'Persona', empresa: 'Finca Prova', poblacion: 'Vic' },
  lloc: { municipio: 'Manlleu', gmaps_url: 'https://maps.app.goo.gl/x' },
  subcausa: 'Qualitat o especificacions no acceptades pel comprador',
}, 'd1', 'https://app.example')

describe('el distintivo del listado', () => {
  it('midesGrups cuenta por disponibilidad', () => {
    expect(midesGrups([{ disponibilitat_id: 'd1' }, { disponibilitat_id: 'd1' }, { disponibilitat_id: null }, {}]))
      .toEqual({ d1: 2 })
  })

  it('midaGrupDeFila: la del grupo, o la del esborrany con productes[]', () => {
    expect(midaGrupDeFila({ disponibilitat_id: 'd1', estado: 'publicada' }, { d1: 3 })).toBe(3)
    expect(midaGrupDeFila({ disponibilitat_id: null, estado: 'publicada' }, {})).toBe(0)
    expect(midaGrupDeFila({ estado: 'esborrany', dades_esborrany: { productes: [{}, {}, {}] } }, {})).toBe(3)
    expect(midaGrupDeFila({ estado: 'esborrany', dades_esborrany: { productes: [{}] } }, {})).toBe(0)
    expect(productesEsborrany(null)).toBe(0)
  })
})

describe('el mensaje único', () => {
  it('ordena como el servidor: alta y luego el E-…', () => {
    expect(ordenaGrup([A, B, C]).map((o) => o.id)).toEqual(['c', 'b', 'a'])
  })

  it('solo con las que circulan, y con dos como mínimo', () => {
    expect(filesDelText([A, oferta({ ...B, estado: 'pendent_validacio' })])).toEqual([])
    expect(filesDelText([A, B, oferta({ ...C, estado: 'cerrada' })]).map((o) => o.id)).toEqual(['b', 'a'])
    expect(textDelGrup([A], ctx)).toBeNull()
  })

  it('el texto: los productos, lo común y UN enlace al Mercat del grupo', () => {
    const t = textDelGrup([A, B], ctx)!
    expect(t).toContain('OFERTA DISPONIBLE · 2 PRODUCTES')
    expect(t).toContain('• Tomàquet: 300 kg aprox')
    expect(t).toContain('• Pebrot: 120 kg aprox')
    expect(t).toContain('👩‍🌾 PRODUCTOR: Finca Prova')
    expect(t).toContain('📍 MUNICIPI: Manlleu')
    expect(t).toContain('https://app.example/receptor/mercat?disponibilitat=d1')
    expect(t).not.toContain('E-261125')
    expect(t.match(/https:\/\/app\.example/g)).toHaveLength(1)
  })

  it('a cada entidad, lo que le encaja; si solo encaja en una, el grupo entero que circula', () => {
    expect(filesPerEntitat([A, B, C], ['a', 'b']).map((o) => o.id)).toEqual(['b', 'a'])
    expect(filesPerEntitat([A, B, C], ['a']).map((o) => o.id)).toEqual(['c', 'b', 'a'])
    const m = missatgeEntitat([A, B, C], ['a', 'c'], ctx)!
    expect(m.files.map((o) => o.id)).toEqual(['c', 'a'])
    expect(m.text).not.toContain('Pebrot')
    expect(m.correu.boto.url).toBe('https://app.example/receptor/mercat?disponibilitat=d1')
    expect(m.correu.cos).not.toContain('receptor/mercat')
    expect(missatgeEntitat([A], ['a'], ctx)).toBeNull()
  })
})

describe('por dónde sale', () => {
  const ent = { canal: 'whatsapp', telefono: '34600000000', email: 'e@x.cat', email_possible: true }
  it('WhatsApp con el correo de respaldo (ventana cerrada → correo)', () => {
    expect(canalsGrup(ent, { email: true, whatsapp: true })).toEqual({ primer: 'whatsapp', alternativa: 'email' })
  })
  it('con WhatsApp apagado, correo', () => {
    expect(canalsGrup(ent, { email: true, whatsapp: false })).toEqual({ primer: 'email', alternativa: null })
  })
  it('con el correo apagado, solo WhatsApp (o nada)', () => {
    expect(canalsGrup(ent, { email: false, whatsapp: true })).toEqual({ primer: 'whatsapp', alternativa: null })
    expect(canalsGrup({ ...ent, canal: 'email' }, { email: false, whatsapp: true })).toEqual({ primer: null, alternativa: null })
  })
  it('sin teléfono ni correo, nada', () => {
    expect(canalsGrup({ canal: 'cap', telefono: null, email: null, email_possible: false }, { email: true, whatsapp: true }))
      .toEqual({ primer: null, alternativa: null })
  })
})
