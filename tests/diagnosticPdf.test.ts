// El cliente del PDF del diagnóstico bajo demanda (A2, `src/lib/diagnosticPdf.ts`): nunca lanza,
// traduce los códigos de `diagnostic-pdf` a las frases de `doc.err_*` y guarda el PDF con el
// nombre que da el servidor.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, descarregarBlob } = vi.hoisted(() => ({ getSession: vi.fn(), descarregarBlob: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession } }, supabaseUrl: 'http://x' }))
vi.mock('../src/lib/tancament', () => ({ descarregarBlob }))

import { codiDiagnosticPdf, descarregarDiagnosticPdf, nomDeDisposicio } from '../src/lib/diagnosticPdf'

describe('codiDiagnosticPdf', () => {
  it('el código del cuerpo manda; si no, el status', () => {
    expect(codiDiagnosticPdf(400, 'nomes_productors')).toBe('nomes_productors')
    expect(codiDiagnosticPdf(500, 'error_render')).toBe('error_servidor')
    expect(codiDiagnosticPdf(401, undefined)).toBe('unauthorized')
    expect(codiDiagnosticPdf(403, 'forbidden')).toBe('forbidden')
    expect(codiDiagnosticPdf(404, 'no_existeix')).toBe('no_existeix')
    expect(codiDiagnosticPdf(502, null)).toBe('error_servidor')
    expect(codiDiagnosticPdf(418, null)).toBe('desconegut')
  })
})

describe('nomDeDisposicio', () => {
  it('lee el filename y desconfía de lo raro', () => {
    expect(nomDeDisposicio('attachment; filename="diagnostic-mas-de-prova.pdf"')).toBe('diagnostic-mas-de-prova.pdf')
    expect(nomDeDisposicio(null)).toBe('diagnostic.pdf')
    expect(nomDeDisposicio('attachment; filename="../../x.exe"')).toBe('diagnostic.pdf')
  })
})

describe('descarregarDiagnosticPdf', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    descarregarBlob.mockReset()
  })

  it('sin sesión no llama al servidor', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } })
    expect(await descarregarDiagnosticPdf('p', 'ca')).toEqual({ ok: false, codi: 'unauthorized', motiuKey: 'doc.err_sessio' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('200 application/pdf: guarda el blob con el nombre del servidor', async () => {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="diagnostic-hort.pdf"' },
    }))
    const r = await descarregarDiagnosticPdf('p1', 'es')
    expect(r).toEqual({ ok: true, nom: 'diagnostic-hort.pdf', bytes: 4 })
    expect(descarregarBlob).toHaveBeenCalledWith('diagnostic-hort.pdf', expect.any(Blob))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://x/functions/v1/diagnostic-pdf')
    expect(JSON.parse(init.body)).toEqual({ tipo_org: 'productor', org: 'p1', idioma: 'es' })
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('403 JSON: el motivo, sin guardar nada', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    }))
    expect(await descarregarDiagnosticPdf('p', 'ca')).toEqual({ ok: false, codi: 'forbidden', motiuKey: 'doc.err_permis' })
    expect(descarregarBlob).not.toHaveBeenCalled()
  })

  it('la red caída no lanza', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await descarregarDiagnosticPdf('p', 'ca')).toEqual({ ok: false, codi: 'xarxa', motiuKey: 'doc.err_xarxa' })
  })
})
