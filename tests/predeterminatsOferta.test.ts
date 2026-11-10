// La precarga de una oferta nueva desde la Operativa (Plan 2, A4, `20270521100000`).
//
// Dos mitades: lo que PROPONE el servidor (`_shared/predeterminatsOferta.ts`, que sirve
// `GET /crear-oferta/campos` y el intake de WhatsApp) y cómo lo APLICA el panel
// (`src/lib/predeterminatsOferta.ts`): solo a los huecos, marcado, y sin mandar lo propuesto
// que no aplica.

import { describe, expect, it } from 'vitest'
import {
  FORMAT_DE_ENVAS, ID_CANVIA_LLOC, confirmaLlocHabitual, llocHabitual, predeterminatsDe,
  preguntaLlocHabitual, principalPrimer, titolLlocLista,
} from '../supabase/functions/_shared/predeterminatsOferta.ts'
import { FORMATS_ENTREGA } from '../supabase/functions/_shared/camposOferta.ts'
import {
  aplicaPredeterminats, estatLlocHabitual, treuProposatsQueNoApliquen, ubicacioPerConfirmar,
} from '../src/lib/predeterminatsOferta'

describe('predeterminatsDe (servidor)', () => {
  it('propone el lugar principal y su primera franja válida', () => {
    const p = predeterminatsDe([
      { id: 'a', es_principal: false, franges: [{ inici: '07:00', fi: '09:00' }] },
      { id: 'b', es_principal: true, franges: [{ inici: '10:00', fi: '09:00' }, { inici: '08:00', fi: '12:30' }] },
    ], null)
    expect(p).toEqual({ ubicacio: 'b', horari: { inici: '08:00', fi: '12:30' }, format_entrega: null })
  })

  it('sin principal: el único lugar; con varios y ninguno principal, nada', () => {
    expect(predeterminatsDe([{ id: 'x' }], null).ubicacio).toBe('x')
    expect(predeterminatsDe([{ id: 'x' }, { id: 'y' }], null).ubicacio).toBeNull()
    expect(predeterminatsDe([], null)).toEqual({ ubicacio: null, horari: null, format_entrega: null })
  })

  it('franjas mal formadas no se proponen', () => {
    expect(predeterminatsDe([{ id: 'x', franges: 'de 9 a 12' }], null).horari).toBeNull()
    expect(predeterminatsDe([{ id: 'x', franges: [{ inici: '9:00', fi: '12:00' }] }], null).horari).toBeNull()
    expect(predeterminatsDe([{ id: 'x', franges: [null, { inici: '24:00', fi: '25:00' }] }], null).horari).toBeNull()
  })

  it('envase → formato solo cuando significa lo mismo, el primero que se traduce', () => {
    expect(predeterminatsDe([], ['caixes']).format_entrega).toBe('caixes')
    expect(predeterminatsDe([], ['granel', 'palets']).format_entrega).toBe('palet')
    expect(predeterminatsDe([], ['granel', 'sacs', 'altres']).format_entrega).toBeNull()
  })

  it('cada formato propuesto existe en FORMATS_ENTREGA', () => {
    const ids = new Set(FORMATS_ENTREGA.map((f) => f.id))
    for (const f of Object.values(FORMAT_DE_ENVAS)) expect(ids.has(f)).toBe(true)
  })

  it('principalPrimer conserva el orden del resto', () => {
    const l = principalPrimer([{ n: 1 }, { n: 2, es_principal: true }, { n: 3 }])
    expect(l.map((x) => x.n)).toEqual([2, 1, 3])
  })

  it('titolLlocLista: «(habitual)» siempre cabe en 24 caracteres', () => {
    expect(titolLlocLista('Magatzem', true)).toBe('Magatzem (habitual)')
    expect(titolLlocLista('Magatzem', false)).toBe('Magatzem')
    const llarg = titolLlocLista('Finca de la carretera vella', true)
    expect(llarg.length).toBeLessThanOrEqual(24)
    expect(llarg.endsWith(' (habitual)')).toBe(true)
    expect(titolLlocLista('Finca de la carretera vella', false).length).toBeLessThanOrEqual(24)
    expect(titolLlocLista('   ', false)).toBe('Ubicació')
  })
})

describe('aplicaPredeterminats (panel)', () => {
  const pred = { ubicacio: 'u1', horari: { inici: '08:00', fi: '12:00' }, format_entrega: 'caixes' }

  it('rellena los huecos y dice qué ha propuesto', () => {
    const r = aplicaPredeterminats({}, pred)
    expect(r.datos).toEqual({ ubicacio: 'u1', horari: { inici: '08:00', fi: '12:00' }, format_entrega: 'caixes' })
    expect(r.proposats.sort()).toEqual(['format_entrega', 'horari', 'ubicacio'])
  })

  it('nunca pisa lo que ya hay', () => {
    const r = aplicaPredeterminats({ ubicacio: 'u2', format_entrega: '' }, pred)
    expect(r.datos.ubicacio).toBe('u2')
    expect(r.datos.format_entrega).toBe('caixes')
    expect(r.proposats).not.toContain('ubicacio')
  })

  it('sin predeterminados (servidor anterior) no cambia nada', () => {
    expect(aplicaPredeterminats({ a: 1 }, undefined)).toEqual({ datos: { a: 1 }, proposats: [] })
    expect(aplicaPredeterminats({}, { ubicacio: null, horari: null, format_entrega: null }).proposats).toEqual([])
  })

  it('al publicar quita lo propuesto que no aplica y respeta lo tocado', () => {
    const datos = { ubicacio: 'u1', horari: { inici: '08:00', fi: '12:00' }, transport: 'si' }
    const aplica = (c: string) => c !== 'ubicacio'
    expect(treuProposatsQueNoApliquen(datos, new Set(['ubicacio', 'horari']), aplica))
      .toEqual({ horari: { inici: '08:00', fi: '12:00' }, transport: 'si' })
    // Tocado = ya no está en `proposats`: se manda tal cual.
    expect(treuProposatsQueNoApliquen(datos, new Set(['horari']), aplica)).toEqual(datos)
  })
})

// P5 (decidido el 10-11-2026): con lugar principal, el intake pide confirmarlo o cambiarlo.
describe('P5 · confirma el lloc habitual o canvia’l', () => {
  it('llocHabitual: solo el marcado; uno solo sin marcar no se presupone', () => {
    expect(llocHabitual([{ id: 'a' }, { id: 'b', es_principal: true }])).toEqual({ id: 'b', es_principal: true })
    expect(llocHabitual([{ id: 'a', es_principal: false }])).toBeNull()
    expect(llocHabitual([])).toBeNull()
  })

  it('preguntaLlocHabitual: nombra el lugar y ofrece confirmar o cambiar', () => {
    const p = preguntaLlocHabitual({ id: 'u1', alias: 'Magatzem', municipio: 'Vilafranca del Penedès' })
    expect(p.cos).toContain('*Magatzem (Vilafranca del Penedès)*')
    expect(p.botons.map((b) => b.id)).toEqual(['ubicacio:u1', ID_CANVIA_LLOC])
    for (const b of p.botons) expect(b.titulo.length).toBeLessThanOrEqual(20)
    // Sin alias, el municipio; sin repetirlo.
    expect(preguntaLlocHabitual({ id: 'u2', alias: null, municipio: 'Sitges' }).cos).toContain('*Sitges*.')
    expect(preguntaLlocHabitual({ id: 'u3' }).cos).toContain('*Ubicació*')
  })

  it('confirmaLlocHabitual: «sí» escrito confirma; lo demás, no', () => {
    for (const t of ['Sí', 'si!', 'Sí, aquí', 'OK', "D'acord", 'vale']) expect(confirmaLlocHabitual(t)).toBe(true)
    for (const t of ['no', 'Canvia', 'https://maps.app.goo.gl/x', '', null]) expect(confirmaLlocHabitual(t)).toBe(false)
  })
})

// P5 en el panel (11-11-2026): el mismo «confirma o canvia» que en WhatsApp.
describe('P5 · panel: confirma el lloc habitual o canvia’l', () => {
  const ubis = [{ id: 'a' }, { id: 'p', es_principal: true }]

  it('con principal, lo propuesto o vacío pide confirmar', () => {
    expect(estatLlocHabitual('p', true, ubis, false)).toEqual({ tipus: 'confirmar', principalId: 'p' })
    expect(estatLlocHabitual('', false, ubis, false)).toEqual({ tipus: 'confirmar', principalId: 'p' })
  })

  it('confirmado (tocado) se ve como confirmado; otro lugar o «canvia», la lista', () => {
    expect(estatLlocHabitual('p', false, ubis, false)).toEqual({ tipus: 'confirmat', principalId: 'p' })
    expect(estatLlocHabitual('a', false, ubis, false)).toEqual({ tipus: 'llista' })
    expect(estatLlocHabitual('p', true, ubis, true)).toEqual({ tipus: 'llista' })
  })

  it('sin principal, la lista de siempre', () => {
    expect(estatLlocHabitual('', false, [{ id: 'a' }], false)).toEqual({ tipus: 'llista' })
    expect(estatLlocHabitual('', false, [], false)).toEqual({ tipus: 'llista' })
  })

  it('sin confirmar falta, solo si el campo aplica', () => {
    const per = estatLlocHabitual('p', true, ubis, false)
    expect(ubicacioPerConfirmar(per, true)).toBe(true)
    expect(ubicacioPerConfirmar(per, false)).toBe(false)
    expect(ubicacioPerConfirmar(estatLlocHabitual('p', false, ubis, false), true)).toBe(false)
    // Un único lugar sin marcar, propuesto en la lista: vale como antes.
    expect(ubicacioPerConfirmar(estatLlocHabitual('a', true, [{ id: 'a' }], false), true)).toBe(false)
  })
})
