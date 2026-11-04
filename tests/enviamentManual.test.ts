// Notificaciones apagadas = solo lo automático (04-11-2026, §8). Unos pocos botones del
// equipo pueden mandar igualmente si quien pulsa lo acepta: la lista cerrada del servidor, el
// diálogo del cliente y el correo del albarán (el único envío manual con función propia nueva).

import { describe, expect, it, vi } from 'vitest'
import { esEnviamentManual, PROPOSITS_MANUALS } from '../supabase/functions/_shared/enviamentManual'
import { composaCorreuAlbara } from '../supabase/functions/_shared/correu-albara'
import { acceptaEnviament } from '../src/lib/enviamentManual'

const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}${JSON.stringify(p)}` : k)

describe('PROPOSITS_MANUALS (enviar-email)', () => {
  it('solo el consentimiento y el convenio a firmar', () => {
    expect([...PROPOSITS_MANUALS].sort()).toEqual(['consentiment_rgpd', 'firma_conveni'])
  })
  it('lo masivo y lo libre no se pueden mandar a mano con las notificaciones apagadas', () => {
    for (const p of ['oferta', 'correu', 'campanya', 'recordatori', 'confirmacio_albara']) {
      expect(esEnviamentManual(p, true)).toBe(false)
    }
  })
  it('hace falta que el cliente lo pida con un true exacto', () => {
    expect(esEnviamentManual('firma_conveni', true)).toBe(true)
    expect(esEnviamentManual('firma_conveni', 'true')).toBe(false)
    expect(esEnviamentManual('firma_conveni', undefined)).toBe(false)
  })
})

describe('acceptaEnviament', () => {
  it('con el correo encendido y sin confirmación propia, no pregunta y no es manual', async () => {
    const confirma = vi.fn()
    expect(await acceptaEnviament(confirma, t, null)).toEqual({ manual: false })
    expect(confirma).not.toHaveBeenCalled()
  })
  it('con el correo encendido, la confirmación propia del botón decide', async () => {
    const base = { titol: 'T', descripcio: 'D' }
    expect(await acceptaEnviament(vi.fn().mockResolvedValue(true), t, null, base)).toEqual({ manual: false })
    expect(await acceptaEnviament(vi.fn().mockResolvedValue(false), t, null, base)).toBeNull()
  })
  it('con el correo apagado siempre pregunta, avisa y, si se acepta, es manual', async () => {
    const confirma = vi.fn().mockResolvedValue(true)
    expect(await acceptaEnviament(confirma, t, 'canal.motiu_email', { titol: 'T', descripcio: 'D' })).toEqual({ manual: true })
    const o = confirma.mock.calls[0][0]
    expect(o.titol).toBe('T')
    expect(o.descripcio).toBe('D\n\nman.avis{"motiu":"canal.motiu_email"}')
    expect(await acceptaEnviament(vi.fn().mockResolvedValue(false), t, 'canal.motiu_email')).toBeNull()
  })
})

describe('composaCorreuAlbara', () => {
  const base = { tipo: 'ENT', numero: 'ENT-2026-00010', idioma: 'ca', rol: 'recibe', nom: 'Banc <Bo>', urlPanell: 'https://x/login' }
  it('sin nada que confirmar: el PDF y el botón al panel', () => {
    const c = composaCorreuAlbara({ ...base, urlConfirmar: null })
    expect(c.assumpte).toBe('Albarà ENT-2026-00010 · Redestina')
    expect(c.boto.url).toBe('https://x/login')
    expect(c.cosHtml).toContain('Hola Banc &lt;Bo&gt;,')
    expect(c.cosHtml).toContain('l’albarà d’entrega')
    expect(c.fitxer).toBe('ENT-2026-00010.pdf')
  })
  it('con la confirmación pendiente: el botón es el enlace y en castellano si toca', () => {
    const c = composaCorreuAlbara({ ...base, tipo: 'REC', idioma: 'es', urlConfirmar: 'https://x/confirmar/tok' })
    expect(c.idioma).toBe('es')
    expect(c.boto).toEqual({ texto: 'Confirma los kilos', url: 'https://x/confirmar/tok' })
    expect(c.cosHtml).toContain('el albarán de recogida')
  })
})
