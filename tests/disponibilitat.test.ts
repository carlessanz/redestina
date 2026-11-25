// Ofertas MULTIPRODUCTO (proceso 3.3, fase 6, 25-11-2026), la parte pura del servidor:
//   · `agrupaProductes()` — cómo `crear-oferta` parte el cuerpo del alta en un producto o un grupo;
//   · `textDisponibilitat()` / `correuDisponibilitat()` — el mensaje ÚNICO de una disponibilidad;
//   · `uneixRankings()` — el ranking de una disponibilidad a partir del de cada oferta;
//   · el aviso `sollicitud_resolta` (fase 6b), a la entidad y al productor.
// La red (la RPC `crear_disponibilitat`, la RLS) la prueban el arnés y el E2E.

import { describe, expect, it } from 'vitest'
import { agrupaProductes, CLAUS_PER_PRODUCTE, MAX_PRODUCTES } from '../supabase/functions/_shared/disponibilitat.ts'
import {
  correuDisponibilitat, enllacDisponibilitat, llistaProductes, textDisponibilitat, textoOfertaDeDades,
} from '../supabase/functions/_shared/textOferta.ts'
import { filaDeDades } from '../supabase/functions/_shared/oferta.ts'
import { uneixRankings, type FilaRankingUnible } from '../supabase/functions/_shared/priorizacion.ts'
import { textAvis } from '../supabase/functions/_shared/textAvis.ts'

const COMUNS = {
  ubicacio: 'ubi-1', disponible_fins: '30/11/2026', dies_recollida: [1, 3], horari: { inici: '08:00', fi: '12:00' },
  modalitat: ['donacio', 'venda'], preu_minim: '0,5', causa: 'C4.2', format_entrega: 'caixes', caixes: 4,
  retorn: 'No', observacions: 'Truqueu abans',
}

describe('agrupaProductes: un producto o una disponibilidad', () => {
  it('sin `productes` devuelve EL MISMO objeto (el camino de siempre no cambia)', () => {
    const d = { producte: 'Pera', kg: 10, ...COMUNS }
    const g = agrupaProductes(d)
    expect(g.tipus).toBe('un')
    expect(g.tipus === 'un' && g.dades).toBe(d)
  })
  it('`productes: null` o `[]` también es un producto, sin la clave', () => {
    const d = { producte: 'Pera', kg: 10, productes: [] }
    const g = agrupaProductes(d)
    expect(g).toEqual({ tipus: 'un', dades: { producte: 'Pera', kg: 10 } })
    expect(agrupaProductes({ producte: 'Pera', productes: null }).tipus).toBe('un')
  })
  it('con UN producto, se funde con lo común y es un alta normal', () => {
    const g = agrupaProductes({ ...COMUNS, productes: [{ producte: 'Pera', kg: '12', varietat: 'Conference' }] })
    expect(g.tipus).toBe('un')
    if (g.tipus !== 'un') return
    expect(g.dades).toMatchObject({ producte: 'Pera', kg: '12', varietat: 'Conference', ubicacio: 'ubi-1' })
    expect('productes' in g.dades).toBe(false)
  })
  it('con dos o más, un grupo: lo del producto manda y lo que calla toma lo común', () => {
    const g = agrupaProductes({
      ...COMUNS, producte: 'Ignorat', kg: 999,
      productes: [
        { producte: 'Tomàquet', kg: 300, varietat: 'Cor de bou', caixes: 12 },
        { producte: 'Pebrot', kg: '120', preu_minim: '0,8', varietat: '' },
        { producte: ' Albergínia ', kg: 80, altra_cosa: 'fora', ubicacio: 'altre' },
      ],
    })
    expect(g.tipus).toBe('grup')
    if (g.tipus !== 'grup') return
    expect(g.dades).toHaveLength(3)
    expect(g.dades[0]).toMatchObject({ producte: 'Tomàquet', kg: 300, varietat: 'Cor de bou', caixes: 12, preu_minim: '0,5' })
    expect(g.dades[1]).toMatchObject({ producte: 'Pebrot', kg: '120', preu_minim: '0,8', caixes: 4 })
    // Lo vacío no pisa lo común; lo que no es de producto se descarta.
    expect(g.dades[1].varietat).toBeUndefined()
    expect(g.dades[2]).toMatchObject({ producte: 'Albergínia', ubicacio: 'ubi-1' })
    expect(g.dades[2]).not.toHaveProperty('altra_cosa')
    expect(g.comuns).not.toHaveProperty('productes')
    expect(g.linies[2]).toEqual({ producte: 'Albergínia', kg: 80 })
  })
  it('errores con el índice del producto', () => {
    expect(agrupaProductes({ productes: 'Pera' })).toEqual({ tipus: 'error', code: 'productes_invalid' })
    expect(agrupaProductes({ productes: [{ producte: 'Pera' }, 'x'] }))
      .toEqual({ tipus: 'error', code: 'productes_invalid', index: 1 })
    expect(agrupaProductes({ productes: [{ producte: 'Pera' }, { kg: 3 }] }))
      .toEqual({ tipus: 'error', code: 'falta_producte', index: 1 })
    expect(agrupaProductes({ productes: [{ producte: 'Pera', varietat: 'Blanquilla' }, { producte: 'pera', varietat: 'blanquilla' }] }))
      .toEqual({ tipus: 'error', code: 'producte_repetit', index: 1 })
    expect(agrupaProductes({ productes: Array.from({ length: MAX_PRODUCTES + 1 }, (_, i) => ({ producte: `P${i}` })) }))
      .toEqual({ tipus: 'error', code: 'massa_productes' })
  })
  it('el mismo producto en dos variedades sí se puede', () => {
    expect(agrupaProductes({ productes: [{ producte: 'Pera', varietat: 'A' }, { producte: 'Pera', varietat: 'B' }] }).tipus)
      .toBe('grup')
  })
  it('las claves de producto son las documentadas', () => {
    expect([...CLAUS_PER_PRODUCTE]).toEqual(['producte', 'varietat', 'kg', 'familia', 'caixes', 'preu_minim', 'cost_kg'])
  })
})

const CAUSA = { causaCodigo: 'C4', subcausaCodigo: 'C4.2', causa: 'Preu', subcausa: 'Baix' }

function filesDelGrup() {
  const g = agrupaProductes({
    ...COMUNS,
    productes: [
      { producte: 'Tomàquet', kg: 300, varietat: 'Cor de bou', caixes: 12 },
      { producte: 'Pebrot', kg: '120,5', preu_minim: '0,8' },
      { producte: 'Albergínia', kg: 80 },
    ],
  })
  if (g.tipus !== 'grup') throw new Error('grup')
  return g.dades.map((d) => filaDeDades(d, null, CAUSA))
}

const CTX = {
  productor: 'Horta de Prova SL', municipi: 'Vic', mapsLloc: 'https://maps.app.goo.gl/lloc',
  causa: 'Preu', subcausa: 'Baix', disponibilitatId: 'd-1', appUrl: 'https://app.test/',
}

describe('textDisponibilitat: un mensaje por disponibilidad', () => {
  const files = filesDelGrup()
  const t = textDisponibilitat(files, CTX)

  it('cabecera, productos con sus kg, lo común una vez y UN enlace', () => {
    expect(t.startsWith('📢 *OFERTA DISPONIBLE · 3 PRODUCTES*')).toBe(true)
    expect(t).toContain('• Tomàquet (Cor de bou): 300 kg aprox (12 caixes) · 0,50 €/kg')
    expect(t).toContain('• Pebrot: 120,5 kg aprox (4 caixes) · 0,80 €/kg')
    expect(t).toContain('• Albergínia: 80 kg aprox (4 caixes) · 0,50 €/kg')
    expect(t).toContain('👩‍🌾 PRODUCTOR: Horta de Prova SL')
    expect(t).toContain('📍 MUNICIPI: Vic')
    expect(t).toContain('🗺️ PUNT DE RECOLLIDA:\nhttps://maps.app.goo.gl/lloc')
    expect(t).toContain('📅 DISPONIBLE FINS: 30/11/2026')
    expect(t).toContain('⏰ HORARI DE RECOLLIDA: dl, dc · de 8:00 a 12:00')
    expect(t).toContain('💰 MODALITAT: Donació o venda')
    expect(t).toContain('🔴 CAUSA: Preu — Baix')
    expect(t).toContain('♻️ ENVASOS: Caixes · no cal retornar-los')
    expect(t).toContain('📝 OBSERVACIONS: Truqueu abans')
    expect(t.endsWith('https://app.test/receptor/mercat?disponibilitat=d-1')).toBe(true)
    expect(t.match(/https:\/\/app\.test/g)).toHaveLength(1)
    // Sin el cierre del bot: el grupo no usa el diálogo de WhatsApp.
    expect(t).not.toContain("M'interessa")
    // Ni los códigos internos.
    expect(t).not.toMatch(/E-\d{6}|D-\d{6}/)
  })

  it('cada producto de un grupo es la misma oferta que se habría publicado sola', () => {
    const sola = textoOfertaDeDades(files[1], CTX)
    expect(sola).toContain('🌿 PRODUCTE: Pebrot')
    expect(sola).toContain('💶 PREU MÍNIM: 0,80 €/kg')
  })

  it('el Maps propio de la oferta manda sobre el del lugar', () => {
    const f = files.map((x) => ({ ...x, gmaps_url: 'https://maps.app.goo.gl/propi' }))
    expect(textDisponibilitat(f, CTX)).toContain('https://maps.app.goo.gl/propi')
    expect(textDisponibilitat(f, CTX)).not.toContain('/lloc')
  })

  it('con modalidades distintas por oferta, cada línea dice la suya y no hay línea común', () => {
    const f = [{ ...files[0], modalitats: ['donacio'] }, { ...files[1], modalitats: ['venda'], preu_minim: 0.8 }]
    const x = textDisponibilitat(f, CTX)
    expect(x).not.toContain('💰 MODALITAT')
    expect(x).toContain('• Tomàquet (Cor de bou): 300 kg aprox (12 caixes) · Donació')
    expect(x).toContain('• Pebrot: 120,5 kg aprox (4 caixes) · 0,80 €/kg · Venda')
  })

  it('ninguna línea con la etiqueta vacía', () => {
    const minim = textDisponibilitat(
      [{ producto: 'Pera', kg_total: 10 }, { producto: 'Poma', kg_total: 5 }],
      { productor: '', municipi: '', disponibilitatId: 'x', appUrl: 'https://a' },
    )
    expect(minim.split('\n').filter((l) => /:\s*$/.test(l) && !l.includes('PRODUCTES:') && !l.includes('recollida:')))
      .toEqual([])
    expect(minim).not.toMatch(/undefined|null|NaN/)
  })

  it('la espigolada lo dice en una línea', () => {
    const f = files.map((x) => ({ ...x, espigolada_demanada: true, producte_al_camp: true }))
    expect(textDisponibilitat(f, CTX)).toContain('🌱 ESPIGOLADA')
  })
})

describe('correuDisponibilitat y ayudas', () => {
  it('asunto con los productos, botón con el enlace y cuerpo sin el cierre', () => {
    const c = correuDisponibilitat(filesDelGrup(), CTX)
    expect(c.assumpte).toBe('Oferta disponible: Tomàquet, Pebrot i Albergínia')
    expect(c.boto).toEqual({ texto: 'Tria els productes', url: 'https://app.test/receptor/mercat?disponibilitat=d-1' })
    expect(c.cos).not.toContain('https://app.test')
    expect(c.text).toContain(c.cos)
    expect(c.preheader).toBe('3 productes de Horta de Prova SL')
  })
  it('llistaProductes y enllacDisponibilitat', () => {
    expect(llistaProductes(['A'])).toBe('A')
    expect(llistaProductes(['A', 'B'])).toBe('A i B')
    expect(llistaProductes(['A', ' ', 'B', 'C'])).toBe('A, B i C')
    expect(enllacDisponibilitat('https://x.cat//', 'a b')).toBe('https://x.cat/receptor/mercat?disponibilitat=a%20b')
  })
})

type Fila = FilaRankingUnible & { motivos: string[]; canal: string }
function fila(id: string, p: Partial<Fila> = {}): Fila {
  return {
    id, puntuacion: 1, pendiente: false, sense_conveni: false, modalitats_possibles: ['donacio'],
    interessa_producte: null, motivos: [`m-${id}`], canal: 'email', ...p,
  }
}
const OF = (id: string, modalitats = ['donacio', 'venda']) =>
  ({ excedente_id: id, id_excedente: `E-${id}`, producto: `P${id}`, modalitats })

describe('uneixRankings: el ranking de una disponibilidad', () => {
  it('una entidad entra si encaja en alguna; su fila es la de la oferta donde mejor encaja', () => {
    const r = uneixRankings([
      { oferta: OF('1'), ranking: [fila('a', { puntuacion: 3 }), fila('b', { puntuacion: 9, modalitats_possibles: [] })] },
      { oferta: OF('2'), ranking: [fila('a', { puntuacion: 5, motivos: ['millor'] }), fila('b', { puntuacion: 2 })] },
    ])
    expect(r.map((x) => x.id)).toEqual(['a', 'b'])
    expect(r[0]).toMatchObject({ puntuacion: 5, motivos: ['millor'] })
    expect(r[0].ofertes_encaixen.map((e) => e.excedente_id)).toEqual(['1', '2'])
    // `b` no puede recibir ninguna modalidad de la oferta 1: solo encaja en la 2.
    expect(r[1].ofertes_encaixen.map((e) => e.excedente_id)).toEqual(['2'])
    expect(r[1].puntuacion).toBe(2)
  })
  it('quien no encaja en ninguna, fuera', () => {
    const r = uneixRankings([{ oferta: OF('1'), ranking: [fila('a', { modalitats_possibles: [] })] }])
    expect(r).toEqual([])
  })
  it('una oferta sin modalidades no descarta a nadie', () => {
    const r = uneixRankings([{ oferta: OF('1', []), ranking: [fila('a', { modalitats_possibles: [] })] }])
    expect(r).toHaveLength(1)
  })
  it('sin convenio solo si le falta en TODAS; con convenio gana aunque puntúe menos', () => {
    const r = uneixRankings([
      { oferta: OF('1'), ranking: [fila('a', { puntuacion: 9, pendiente: true, sense_conveni: true })] },
      { oferta: OF('2'), ranking: [fila('a', { puntuacion: 1 })] },
    ])
    expect(r[0]).toMatchObject({ pendiente: false, sense_conveni: false, puntuacion: 1 })
    const r2 = uneixRankings([
      { oferta: OF('1'), ranking: [fila('a', { pendiente: true, sense_conveni: true })] },
    ])
    expect(r2[0]).toMatchObject({ pendiente: true, sense_conveni: true })
  })
  it('modalidades unidas en orden canónico e interés por producto agregado', () => {
    const r = uneixRankings([
      { oferta: OF('1'), ranking: [fila('a', { modalitats_possibles: ['venda'], interessa_producte: false })] },
      { oferta: OF('2'), ranking: [fila('a', { modalitats_possibles: ['donacio'], interessa_producte: true })] },
    ])
    expect(r[0].modalitats_possibles).toEqual(['donacio', 'venda'])
    expect(r[0].interessa_producte).toBe(true)
  })
  it('orden final: con convenio primero, por puntuación', () => {
    const r = uneixRankings([
      { oferta: OF('1'), ranking: [fila('a', { puntuacion: 1 }), fila('b', { puntuacion: 7, pendiente: true, sense_conveni: true }), fila('c', { puntuacion: 4 })] },
    ])
    expect(r.map((x) => x.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('aviso sollicitud_resolta (fase 6b)', () => {
  const ENTITAT = {
    sollicitud_id: 's-1', disponibilitat_id: 'd-1', codi: 'D-261125-HOR-1', productor: 'Horta de Prova SL',
    municipi: 'Vic', recollida_at: '2026-11-27T09:00:00Z', n_aprovades: 2, n_rebutjades: 1,
    linies: [
      { resposta_id: 'r1', excedente_id: 'e1', producte: 'Tomàquet', kg_sol: 200, kg_apr: 150, modalitat: 'donacio', estat: 'aprovada', motiu: null },
      { resposta_id: 'r2', excedente_id: 'e2', producte: 'Pebrot', kg_sol: 50, kg_apr: 50, modalitat: 'venda', estat: 'aprovada', motiu: null },
      { resposta_id: 'r3', excedente_id: 'e3', producte: 'Albergínia', kg_sol: 30, kg_apr: null, modalitat: 'donacio', estat: 'rebutjada', motiu: 'Ja no en queda' },
    ],
  }
  const PRODUCTOR = {
    sollicitud_id: 's-1', disponibilitat_id: 'd-1', codi: 'D-261125-HOR-1', entitat: 'Menjador Social',
    recollida_at: '2026-11-27T09:00:00Z', n_aprovades: 2,
    linies: [
      { excedente_id: 'e1', ref: 'E-261125-HOR-TOM-1', producte: 'Tomàquet', kg: 150, modalitat: 'donacio' },
      { excedente_id: 'e2', ref: 'E-261125-HOR-PEB-1', producte: 'Pebrot', kg: 50, modalitat: 'venda' },
    ],
  }

  it('a la entidad: lo asignado, lo que no y por qué, la recogida y quién lo ofrece', () => {
    const t = textAvis('sollicitud_resolta', ENTITAT, 'ca', 's-1', 'entidad')
    expect(t.titulo).toBe('Sol·licitud aprovada en part')
    expect(t.asunto).toBe('Sol·licitud resolta: 2 de 3 productes assignats')
    expect(t.cuerpo).toContain('T’hem assignat:')
    expect(t.cuerpo).toContain('• Tomàquet: 150 kg (donació) (n’havies demanat 200 kg)')
    expect(t.cuerpo).toContain('• Pebrot: 50 kg (venda)')
    expect(t.cuerpo).not.toContain('Pebrot: 50 kg (venda) (')
    expect(t.cuerpo).toContain('No t’hem pogut assignar:\n• Albergínia — Ja no en queda')
    expect(t.cuerpo).toContain('Recollida: 27/11 · 10:00.')
    expect(t.cuerpo).toContain('L’ofereix: Horta de Prova SL (Vic).')
    expect(t.ruta).toBe('/receptor/interessos')
    expect(`${t.asunto}${t.cuerpo}`).not.toMatch(/D-\d{6}|E-\d{6}|undefined|null|NaN/)
  })
  it('a la entidad, en castellano y todo aprobado / todo rechazado', () => {
    const totes = { ...ENTITAT, linies: ENTITAT.linies.slice(0, 2) }
    expect(textAvis('sollicitud_resolta', totes, 'es', 's-1', 'entidad').titulo).toBe('Solicitud aprobada')
    const cap = { ...ENTITAT, linies: [ENTITAT.linies[2]] }
    const t = textAvis('sollicitud_resolta', cap, 'es', 's-1', 'entidad')
    expect(t.titulo).toBe('Solicitud no aprobada')
    expect(t.cuerpo).not.toContain('Recogida')
  })
  it('al productor: lo asignado, a quién y cuándo; lleva a la primera oferta', () => {
    const t = textAvis('sollicitud_resolta', PRODUCTOR, 'ca', 's-1', 'productor')
    expect(t.asunto).toBe('Hem trobat sortida per a 2 productes')
    expect(t.cuerpo).toContain('S’han assignat a Menjador Social:')
    expect(t.cuerpo).toContain('• Tomàquet: 150 kg (donació)')
    expect(t.cuerpo).toContain('• Pebrot: 50 kg (venda)')
    expect(t.cuerpo).toContain('Recollida: 27/11 · 10:00.')
    expect(t.ruta).toBe('/productor/ofertes/e1')
    expect(t.cuerpo).not.toMatch(/E-\d{6}/)
    expect(textAvis('sollicitud_resolta', PRODUCTOR, 'es', 's-1', 'productor').cuerpo).toContain('Se han asignado a Menjador Social:')
  })
})
