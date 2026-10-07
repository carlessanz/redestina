// Las utilidades HTTP compartidas por las Edge Functions (supabase/functions/_shared/http.ts).
//
// Sustituyen a copias que estaban en nueve, trece y cinco funciones. Lo que se prueba aquí
// es que hacen EXACTAMENTE lo que hacían las copias: mismo cuerpo, mismas cabeceras, mismo
// código, y que la guarda del secreto acepta y rechaza lo mismo que el `!==` de antes.

import { describe, expect, it } from 'vitest'
import {
  exigirSecreto, igualesTiempoConstante, json, preflight, respondedor,
} from '../supabase/functions/_shared/http.ts'

const CORS = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Vary': 'Origin',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** La forma que tenían las copias, para compararla con la nueva. */
function antiguo(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function igual(a: Response, b: Response) {
  expect(a.status).toBe(b.status)
  expect([...a.headers.entries()]).toEqual([...b.headers.entries()])
  expect(await a.text()).toBe(await b.text())
}

describe('http · json y respondedor', () => {
  it('json() sin cabeceras es la respuesta de las funciones que llama pg_net', async () => {
    await igual(json({ error: 'unauthorized' }, 401), antiguo({ error: 'unauthorized' }, 401))
    await igual(json({ ok: true }), antiguo({ ok: true }))
  })

  it('respondedor(cors) es el `responder` de las funciones con CORS', async () => {
    const r = respondedor(CORS)
    await igual(r({ error: 'Method Not Allowed' }, 405), antiguo({ error: 'Method Not Allowed' }, 405, CORS))
    await igual(r({ valid: false }, 404), antiguo({ valid: false }, 404, CORS))
    await igual(r([1, 2]), antiguo([1, 2], 200, CORS))
  })

  it('el preflight es un 204 sin cuerpo con las cabeceras CORS', async () => {
    const r = preflight(CORS)
    await igual(r, new Response(null, { status: 204, headers: CORS }))
    expect(await r.text()).toBe('')
  })
})

describe('http · igualesTiempoConstante', () => {
  const casos: [string, string][] = [
    ['', ''], ['a', ''], ['', 'a'], ['abc', 'abc'], ['abc', 'abd'], ['abc', 'abcd'],
    ['secret', 'Secret'], ['ñ€😀', 'ñ€😀'], ['ñ€😀', 'ñ€😁'], ['\u0000', ''],
  ]
  for (const [a, b] of casos) {
    it(`${JSON.stringify(a)} vs ${JSON.stringify(b)} da lo mismo que ===`, () => {
      expect(igualesTiempoConstante(a, b)).toBe(a === b)
    })
  }
})

describe('http · exigirSecreto', () => {
  const peticion = (valor?: string) =>
    new Request('http://x/fn', {
      method: 'POST',
      headers: valor === undefined ? {} : { 'x-documentos-secret': valor },
    })

  it('deja pasar el secreto bueno', () => {
    expect(exigirSecreto(peticion('s3cr3t'), 'x-documentos-secret', 's3cr3t')).toBeNull()
  })

  it('rechaza con el 401 de siempre: sin cabecera, con otra, o sin secreto configurado', async () => {
    for (const [valor, esperado] of [
      [undefined, 's3cr3t'], ['otro', 's3cr3t'], ['s3cr3', 's3cr3t'], ['s3cr3t', undefined],
      ['s3cr3t', ''], ['', ''],
    ] as [string | undefined, string | undefined][]) {
      const r = exigirSecreto(peticion(valor), 'x-documentos-secret', esperado)
      expect(r).not.toBeNull()
      await igual(r!, antiguo({ error: 'unauthorized' }, 401))
    }
  })
})
