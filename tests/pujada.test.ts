// Lo común de las subidas de ficheros (supabase/functions/_shared/pujada.ts, 05-11-2026):
// el formato lo dicen los bytes, no la etiqueta; 10 MB como máximo; la huella, en hex.

import { describe, it, expect } from 'vitest'
import {
  mimeReal, sha256Bytes, validaAbansDeLlegir, validaBytes, MAX_BYTES_PUJADA,
} from '../supabase/functions/_shared/pujada.ts'

const PDF = new TextEncoder().encode('%PDF-1.7\n%…')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])

describe('mimeReal', () => {
  it('reconoce los tres formatos por su cabecera', () => {
    expect(mimeReal(PDF)).toBe('application/pdf')
    expect(mimeReal(PNG)).toBe('image/png')
    expect(mimeReal(JPG)).toBe('image/jpeg')
  })
  it('un PDF con basura delante (hasta 1 KB) sigue siendo PDF', () => {
    const b = new Uint8Array(20 + PDF.length)
    b.set(PDF, 20)
    expect(mimeReal(b)).toBe('application/pdf')
  })
  it('lo demás, no', () => {
    expect(mimeReal(new TextEncoder().encode('<html>'))).toBeNull()
    expect(mimeReal(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull() // GIF
    expect(mimeReal(new Uint8Array())).toBeNull()
  })
})

describe('validaAbansDeLlegir', () => {
  it('sin fichero, vacío, demasiado grande o de otro tipo', () => {
    expect(validaAbansDeLlegir(null)?.code).toBe('falta_fitxer')
    expect(validaAbansDeLlegir({ size: 0, type: 'application/pdf' })?.code).toBe('fitxer_buit')
    expect(validaAbansDeLlegir({ size: MAX_BYTES_PUJADA + 1, type: 'application/pdf' })?.status).toBe(413)
    expect(validaAbansDeLlegir({ size: 10, type: 'image/gif' })?.status).toBe(415)
  })
  it('una etiqueta vacía o genérica pasa: deciden los bytes', () => {
    expect(validaAbansDeLlegir({ size: 10, type: '' })).toBeNull()
    expect(validaAbansDeLlegir({ size: 10, type: 'application/octet-stream' })).toBeNull()
    expect(validaAbansDeLlegir({ size: 10, type: 'image/jpg' })).toBeNull()
  })
})

describe('validaBytes', () => {
  it('manda el formato real, no la etiqueta', () => {
    expect(validaBytes(PNG, 'application/pdf')).toEqual({ mime: 'image/png', extensio: 'png' })
    expect(validaBytes(JPG, 'image/jpeg')).toEqual({ mime: 'image/jpeg', extensio: 'jpg' })
  })
  it('un «PDF» que no lo es se rechaza (415)', () => {
    const r = validaBytes(new TextEncoder().encode('no soc un pdf'), 'application/pdf')
    expect('error' in r && r.error.status).toBe(415)
  })
})

it('sha256Bytes da 64 hex en minúsculas', async () => {
  expect(await sha256Bytes(new TextEncoder().encode('abc')))
    .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
