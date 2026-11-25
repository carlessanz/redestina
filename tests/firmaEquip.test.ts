// «La meva signatura» (proceso 0.1, 25-11-2026): la parte pura de `src/lib/firmaEquip.ts` y el
// texto de la firma institucional (`textErrorInstitucional`).
//
// Lo importante: lo que se manda a `firma-equip` es un data URI PNG/JPEG de ≤ 1 MB, y cada
// fallo de la función tiene su frase (400 `format_invalid`, 413 `massa_gran`, 401, 403).

import { describe, expect, it, vi } from 'vitest'
import { DICTS } from '../src/lib/i18n'
import {
  MAX_BYTES_FIRMA, MIMES_FIRMA, bytesDataUri, codiFirmaDeResposta, desaFirmaEquip, esDataUriImatge, validaImatgeFirma,
} from '../src/lib/firmaEquip'
import { textErrorInstitucional } from '../src/lib/textError'

// El cliente de Supabase no se crea: lo que se prueba no sale a la red.
vi.mock('../src/lib/supabase', () => ({ supabase: {}, supabaseUrl: '' }))

const t = (clau: string) => `T(${clau})`

describe('validaImatgeFirma', () => {
  it('PNG o JPEG de hasta 1 MB, sí', () => {
    expect(validaImatgeFirma({ type: 'image/png', size: 2_000 })).toBeNull()
    expect(validaImatgeFirma({ type: 'image/jpeg', size: MAX_BYTES_FIRMA })).toBeNull()
  })
  it('otro tipo, vacío o nada → formato; más de 1 MB → massa gran', () => {
    expect(validaImatgeFirma({ type: 'application/pdf', size: 10 })).toBe('fe.err_format')
    expect(validaImatgeFirma({ type: 'image/webp', size: 10 })).toBe('fe.err_format')
    expect(validaImatgeFirma({ type: 'image/png', size: 0 })).toBe('fe.err_format')
    expect(validaImatgeFirma(null)).toBe('fe.err_format')
    expect(validaImatgeFirma({ type: 'image/png', size: MAX_BYTES_FIRMA + 1 })).toBe('fe.err_massa_gran')
  })
  it('solo PNG y JPEG', () => {
    expect([...MIMES_FIRMA]).toEqual(['image/png', 'image/jpeg'])
  })
})

describe('data URI', () => {
  it('reconoce PNG y JPEG en base64, y nada más', () => {
    expect(esDataUriImatge('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(esDataUriImatge('data:image/jpeg;base64,/9j/4AAQ')).toBe(true)
    expect(esDataUriImatge('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(esDataUriImatge('data:image/png,sin-base64')).toBe(false)
    expect(esDataUriImatge('')).toBe(false)
    expect(esDataUriImatge(null)).toBe(false)
  })
  it('bytesDataUri: los bytes de verdad, sin el relleno', () => {
    expect(bytesDataUri('data:image/png;base64,QUJD')).toBe(3) // «ABC»
    expect(bytesDataUri('data:image/png;base64,QUI=')).toBe(2) // «AB»
    expect(bytesDataUri('data:image/png;base64,QQ==')).toBe(1) // «A»
  })
  it('desaFirmaEquip no llama a la red con algo que no es una imagen o que pasa de 1 MB', async () => {
    expect(await desaFirmaEquip('hola')).toMatchObject({ ok: false, codi: 'format_invalid' })
    const gran = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_BYTES_FIRMA + 10) * 4 / 3))}`
    expect(await desaFirmaEquip(gran)).toMatchObject({ ok: false, codi: 'massa_gran' })
  })
})

describe('codiFirmaDeResposta', () => {
  it('el `error` del cuerpo manda; si no, el estado', () => {
    expect(codiFirmaDeResposta(400, 'format_invalid')).toBe('format_invalid')
    expect(codiFirmaDeResposta(413, 'massa_gran')).toBe('massa_gran')
    expect(codiFirmaDeResposta(413, null)).toBe('massa_gran')
    expect(codiFirmaDeResposta(400, 'altra_cosa')).toBe('format_invalid')
    expect(codiFirmaDeResposta(401, 'unauthorized')).toBe('unauthorized')
    expect(codiFirmaDeResposta(403, 'forbidden')).toBe('forbidden')
    expect(codiFirmaDeResposta(500, undefined)).toBe('error')
  })
})

describe('las claves existen en los dos idiomas', () => {
  const CLAUS = [
    'fe.menu', 'fe.title', 'fe.desc', 'fe.actual', 'fe.cap', 'fe.actualitzada', 'fe.alt', 'fe.nova', 'fe.tab_dibuixa',
    'fe.tab_puja', 'fe.dibuixa_label', 'fe.puja_tria', 'fe.puja_canvia', 'fe.puja_hint', 'fe.previsualitzacio', 'fe.desa',
    'fe.esborra', 'fe.ok_desada', 'fe.ok_esborrada', 'fe.confirm_esborra_t', 'fe.confirm_esborra', 'fe.err_format',
    'fe.err_massa_gran', 'fe.err_permis', 'fe.err_sessio', 'fe.err_generic', 'fe.err_carrega',
    'eq.signatura_institucional', 'conv.pendent_institucional',
  ]
  for (const idioma of ['ca', 'es'] as const) {
    it(idioma, () => {
      for (const k of CLAUS) expect(DICTS[idioma][k], `${k} (${idioma})`).toBeTruthy()
    })
  }
  it('el texto de la firma propia dice dónde se estampa', () => {
    expect(DICTS.ca['fe.desc']).toBe('S’estamparà als albarans que validis o emetis.')
    expect(DICTS.ca['fe.cap']).toBe('Encara no has desat cap signatura.')
  })
})

describe('textErrorInstitucional', () => {
  it('un 42501 es la firma institucional del Superadmin', () => {
    expect(textErrorInstitucional(t, { missatge: 'permission denied', codi: '42501' })).toBe('T(eq.signatura_institucional)')
  })
  it('el resto, como textError', () => {
    expect(textErrorInstitucional(t, { missatge: 'lo que sea', codi: 'sense_conveni' })).toBe('T(od.conv_blocked)')
    expect(textErrorInstitucional(t, { missatge: '', codi: '22023' })).toBe('T(c.error)')
  })
})
