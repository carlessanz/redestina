import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({ supabase: {}, supabaseUrl: '' }))
import { rutaAvis } from '../src/lib/avisos'

// Fase 6 del plan DIC 26: el aviso único de una solicitud multiproducto resuelta.
describe('rutaAvis · sollicitud_resolta', () => {
  const base = { objecte_tipo: 'sollicitud_recollida' as const, objecte_id: 'sol-1', tipus: 'sollicitud_resolta' as const }

  it('la entidad va a sus intereses', () => {
    expect(rutaAvis({ ...base, destinatari_tipo: 'entidad' })).toBe('/receptor/interessos')
  })

  it('el productor va a la primera oferta asignada del grupo', () => {
    const params = { linies: [{ excedente_id: 'exc-1' }, { excedente_id: 'exc-2' }] }
    expect(rutaAvis({ ...base, destinatari_tipo: 'productor', params })).toBe('/productor/ofertes/exc-1')
  })

  it('el productor sin líneas legibles va a sus ofertas', () => {
    expect(rutaAvis({ ...base, destinatari_tipo: 'productor', params: {} })).toBe('/productor/ofertes')
  })

  it('los demás avisos no cambian', () => {
    expect(rutaAvis({ objecte_tipo: 'excedente', objecte_id: 'e1' })).toBe('/productor/ofertes/e1')
    expect(rutaAvis({ objecte_tipo: 'oferta_resposta', objecte_id: 'r1' })).toBe('/receptor/interessos')
  })
})
