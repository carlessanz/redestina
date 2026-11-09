// La cortina de contraseña (cortina/cortina.ts). Sin la contraseña en el repo, lo que se
// prueba aquí es todo lo demás: que lo libre sea libre y nada más, que una cookie falsa no
// abra, que el destino no pueda salir de la web y que una navegación vea la cortina.
//
// ⚠️ El camino bueno (contraseña correcta → cookie → pasa) solo se prueba si se da la
//    contraseña por entorno: `CORTINA_PROVA='…' npx vitest run tests/cortina.test.ts`.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { empaqueta } from '../scripts/construir-cortina.mjs'
import {
  COOKIE, COOKIE_IDIOMA, ESTAT_DE_RESPALD, HASH_TOKEN, RUTA_ENTRADA, RUTA_SORTIDA, TTL_ESTAT_MS, creaLectorEstat, destiSegur,
  idiomaDe, esLliure, esTokenValid, gestiona as gestionaReal, llegeixCookie, llegeixEstat, tokenDeContrasenya,
} from '../cortina/cortina.ts'
import type { LectorEstat } from '../cortina/cortina.ts'
import { huellaDeContrasenya, huellaDeToken, motiuContrasenyaInvalida } from '../supabase/functions/_shared/cortinaHash.ts'

const BASE = 'https://redestina.carlessanz.com'

// Las pruebas de la petición NO salen a la red: el estado de la cortina (puesta, con la huella del
// repo) se inyecta. Sin lector, `gestiona` preguntaría a la Edge Function de producción.
const ACTIVA: LectorEstat = async () => ({ activa: true, hash: HASH_TOKEN })
const gestiona = (req: Request, estat: LectorEstat = ACTIVA) => gestionaReal(req, estat)

describe('lo que se sirve sin cortina', () => {
  it('las imágenes de terceros y el service worker, sí', () => {
    for (const r of ['/logo-email.png', '/segell-redestina.svg', '/segell-redestina-mono.svg',
      '/favicon.svg', '/sw.js', '/workbox-abeb32eb.js']) expect(esLliure(r)).toBe(true)
  })
  it('la aplicación, sus scripts y sus rutas, no', () => {
    for (const r of ['/', '/login', '/index.html', '/assets/index-abc.js', '/registre',
      '/verificar/ABCD', '/segell-redestina.svg.js', '/logo-redestina.svg']) expect(esLliure(r)).toBe(false)
  })
})

describe('el token', () => {
  it('una contraseña equivocada no abre', async () => {
    expect(await esTokenValid(await tokenDeContrasenya('no-es-aquesta'))).toBe(false)
  })
  it('un valor sin forma de token ni se compara', async () => {
    expect(await esTokenValid('')).toBe(false)
    expect(await esTokenValid('x'.repeat(64))).toBe(false)
    expect(await esTokenValid(null)).toBe(false)
  })
  it('lee la cookie entre otras', () => {
    expect(llegeixCookie(`a=1; ${COOKIE}=abc; b=2`, COOKIE)).toBe('abc')
    expect(llegeixCookie('a=1', COOKIE)).toBeNull()
  })
})

describe('el destino tras entrar', () => {
  it('solo rutas de esta web', () => {
    expect(destiSegur('/equip/tauler?x=1')).toBe('/equip/tauler?x=1')
    expect(destiSegur('//evil.example')).toBe('/')
    expect(destiSegur('/\\evil.example')).toBe('/')
    expect(destiSegur('https://evil.example')).toBe('/')
    expect(destiSegur(RUTA_ENTRADA)).toBe('/')
    expect(destiSegur(null)).toBe('/')
  })
})

describe('la petición', () => {
  it('una navegación sin cookie ve la cortina, con 401', async () => {
    const r = await gestiona(new Request(`${BASE}/equip/tauler`, { headers: { 'sec-fetch-mode': 'navigate' } }))
    expect(r.status).toBe(401)
    const html = await r.text()
    expect(html).toContain('name="contrasenya"')
    expect(html).toContain('value="/equip/tauler"')
  })
  it('un script sin cookie recibe un 401 seco, sin HTML', async () => {
    const r = await gestiona(new Request(`${BASE}/assets/index-abc.js`))
    expect(r.status).toBe(401)
    expect(await r.text()).not.toContain('<html')
  })
  it('una cookie falsa no abre', async () => {
    const r = await gestiona(new Request(`${BASE}/`, {
      headers: { cookie: `${COOKIE}=${'a'.repeat(64)}`, 'sec-fetch-mode': 'navigate' },
    }))
    expect(r.status).toBe(401)
  })
  it('lo libre pasa sin cookie', async () => {
    const r = await gestiona(new Request(`${BASE}/logo-email.png`))
    expect(r.headers.get('x-middleware-next')).toBe('1')
  })
  it('una contraseña equivocada vuelve a la cortina con el error', async () => {
    const cos = new URLSearchParams({ contrasenya: 'dolenta', desti: '/login' })
    const r = await gestiona(new Request(`${BASE}${RUTA_ENTRADA}`, { method: 'POST', body: cos }))
    expect(r.status).toBe(401)
    expect(await r.text()).toContain('role="alert"')
  })

  const bona = process.env.CORTINA_PROVA
  it.skipIf(!bona)('con la contraseña buena: cookie de una semana y pasa', async () => {
    const cos = new URLSearchParams({ contrasenya: bona as string, desti: '/login' })
    const r = await gestiona(new Request(`${BASE}${RUTA_ENTRADA}`, { method: 'POST', body: cos }))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/login')
    const cookie = r.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('Max-Age=604800')
    expect(cookie).toContain('HttpOnly')
    const token = cookie.split(';')[0].split('=')[1]
    const r2 = await gestiona(new Request(`${BASE}/`, { headers: { cookie: `${COOKIE}=${token}` } }))
    expect(r2.headers.get('x-middleware-next')).toBe('1')
  })
})

describe('middleware.js', () => {
  // Es un fichero GENERADO (Vercel no compilaba el .ts): si alguien toca cortina/*.ts y no lo
  // regenera, producción seguiría con la cortina vieja sin que nada lo dijera.
  it('está al día con cortina/cortina.ts', async () => {
    const actual = readFileSync(new URL('../middleware.js', import.meta.url), 'utf8')
    expect(actual, 'Executa: node scripts/construir-cortina.mjs').toBe(await empaqueta())
  })
})

describe('el idioma de la cortina', () => {
  it('catalán por defecto, castellano si se pide o si está guardado', () => {
    expect(idiomaDe(new URL(`${BASE}/`), null)).toBe('ca')
    expect(idiomaDe(new URL(`${BASE}/?idioma=es`), null)).toBe('es')
    expect(idiomaDe(new URL(`${BASE}/`), `${COOKIE_IDIOMA}=es`)).toBe('es')
    expect(idiomaDe(new URL(`${BASE}/?idioma=ca`), `${COOKIE_IDIOMA}=es`)).toBe('ca')
    expect(idiomaDe(new URL(`${BASE}/?idioma=fr`), null)).toBe('ca')
  })
  it('un solo idioma en la página, y el cambio no se arrastra al destino', async () => {
    const r = await gestiona(new Request(`${BASE}/login?idioma=es`, { headers: { 'sec-fetch-mode': 'navigate' } }))
    const html = await r.text()
    expect(html).toContain('<html lang="es">')
    expect(html).toContain('Acceso restringido')
    expect(html).not.toContain('Accés restringit')
    expect(html).toContain('value="/login"')
    expect(r.headers.get('set-cookie')).toContain(`${COOKIE_IDIOMA}=es`)
  })
})

describe('salir de la cortina', () => {
  it('borra la cookie y vuelve a la portada, que pedirá la contraseña', async () => {
    const r = await gestiona(new Request(`${BASE}${RUTA_SORTIDA}`))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/')
    expect(r.headers.get('set-cookie')).toContain(`${COOKIE}=; Path=/; Max-Age=0`)
  })
  it('un POST con el campo vacío NO da cookie', async () => {
    const r = await gestiona(new Request(`${BASE}${RUTA_ENTRADA}`, {
      method: 'POST', body: new URLSearchParams({ contrasenya: '', desti: '/' }),
    }))
    expect(r.status).toBe(401)
    expect(r.headers.get('set-cookie') ?? '').not.toContain(`${COOKIE}=`)
  })
})

// ── La cortina que se enciende y se apaga (09-11-2026) ───────────────────────────────────────────

describe('apagada desde Configuració', () => {
  const APAGADA: LectorEstat = async () => ({ activa: false, hash: HASH_TOKEN })
  it('una navegación y un script pasan sin cookie', async () => {
    const nav = await gestiona(new Request(`${BASE}/equip/tauler`, { headers: { 'sec-fetch-mode': 'navigate' } }), APAGADA)
    expect(nav.headers.get('x-middleware-next')).toBe('1')
    const js = await gestiona(new Request(`${BASE}/assets/index-abc.js`), APAGADA)
    expect(js.headers.get('x-middleware-next')).toBe('1')
  })
  it('el formulario ya no tiene a quién entregar nada: vuelve a la portada, sin cookie', async () => {
    const r = await gestiona(new Request(`${BASE}${RUTA_ENTRADA}`, {
      method: 'POST', body: new URLSearchParams({ contrasenya: 'x'.repeat(10), desti: '/login' }),
    }), APAGADA)
    expect(r.status).toBe(303)
    expect(new URL(r.headers.get('location') ?? '', BASE).pathname).toBe('/')
    expect(r.headers.get('set-cookie') ?? '').not.toContain(`${COOKIE}=`)
  })
  it('salir de la cortina sigue borrando la cookie', async () => {
    const r = await gestiona(new Request(`${BASE}${RUTA_SORTIDA}`), APAGADA)
    expect(r.headers.get('set-cookie')).toContain(`${COOKIE}=; Path=/; Max-Age=0`)
  })
})

describe('con la huella de la base', () => {
  it('la contraseña nueva abre y la otra no', async () => {
    const hash = await huellaDeContrasenya('prova-cortina-A')
    const estat: LectorEstat = async () => ({ activa: true, hash })
    const dolenta = await gestiona(new Request(`${BASE}${RUTA_ENTRADA}`, {
      method: 'POST', body: new URLSearchParams({ contrasenya: 'prova-cortina-B', desti: '/' }),
    }), estat)
    expect(dolenta.status).toBe(401)
    const bona = await gestiona(new Request(`${BASE}${RUTA_ENTRADA}`, {
      method: 'POST', body: new URLSearchParams({ contrasenya: 'prova-cortina-A', desti: '/login' }),
    }), estat)
    expect(bona.status).toBe(303)
    const token = (bona.headers.get('set-cookie') ?? '').split(';')[0].split('=')[1]
    const dins = await gestiona(new Request(`${BASE}/`, { headers: { cookie: `${COOKIE}=${token}` } }), estat)
    expect(dins.headers.get('x-middleware-next')).toBe('1')
    // Cambiada la contraseña, la cookie de la anterior deja de valer.
    const canviat: LectorEstat = async () => ({ activa: true, hash: await huellaDeContrasenya('prova-cortina-C') })
    const fora = await gestiona(new Request(`${BASE}/`, {
      headers: { cookie: `${COOKIE}=${token}`, 'sec-fetch-mode': 'navigate' },
    }), canviat)
    expect(fora.status).toBe(401)
  })
  it('esTokenValid compara con la huella que se le da, y por defecto con la del repo', async () => {
    const token = await tokenDeContrasenya('prova-cortina-A')
    expect(await esTokenValid(token, await huellaDeToken(token))).toBe(true)
    expect(await esTokenValid(token)).toBe(false)
  })
  it('la huella coincide con la de scripts/cortina-hash.mjs (mismo algoritmo, dos sitios)', async () => {
    const r = spawnSync('node', ['scripts/cortina-hash.mjs', 'prova-cortina-A'], { encoding: 'utf8' })
    expect(r.stdout.trim()).toBe(await huellaDeContrasenya('prova-cortina-A'))
  })
})

describe('lo que contesta cortina-estat', () => {
  const H = 'a'.repeat(64)
  it('solo se acepta { activa: boolean, hash: 64 hex | null }', () => {
    expect(llegeixEstat({ activa: false, hash: H })).toEqual({ activa: false, hash: H })
    expect(llegeixEstat({ activa: true, hash: null })).toEqual({ activa: true, hash: HASH_TOKEN })
    expect(llegeixEstat({ activa: true })).toEqual({ activa: true, hash: HASH_TOKEN })
  })
  it('cualquier otra cosa se rechaza: una respuesta rara NUNCA abre', () => {
    for (const x of [null, undefined, 'false', 0, [], {}, { activa: 'false', hash: H }, { activa: 0, hash: H },
      { activa: null }, { activa: false, hash: 'zz' }, { activa: false, hash: 'A'.repeat(64) }, { activa: false, hash: 5 }]) {
      expect(llegeixEstat(x)).toBeNull()
    }
  })
})

describe('el lector de estado (caché y fail-closed)', () => {
  const resposta = (cos: unknown, status = 200) => new Response(JSON.stringify(cos), { status })
  const H = 'b'.repeat(64)

  it('pregunta una vez y reutiliza la respuesta hasta que caduca', async () => {
    let t = 0
    const f = vi.fn(async () => resposta({ activa: false, hash: H }))
    const lector = creaLectorEstat('http://x/estat', { fetchFn: f as unknown as typeof fetch, ara: () => t })
    expect(await lector()).toEqual({ activa: false, hash: H })
    t += TTL_ESTAT_MS - 1
    await lector()
    expect(f).toHaveBeenCalledTimes(1)
    t += 2
    await lector()
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('peticiones a la vez comparten una sola consulta', async () => {
    const f = vi.fn(async () => resposta({ activa: true, hash: H }))
    const lector = creaLectorEstat('http://x/estat', { fetchFn: f as unknown as typeof fetch })
    await Promise.all([lector(), lector(), lector()])
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('sin respuesta y sin estado anterior: la cortina PUESTA, con la huella del repo', async () => {
    for (const f of [
      async () => { throw new Error('red') },
      async () => resposta({ error: 'x' }, 503),
      async () => resposta({ activa: 'false' }),
      async () => new Response('no es json', { status: 200 }),
    ]) {
      const lector = creaLectorEstat('http://x/estat', { fetchFn: f as unknown as typeof fetch })
      expect(await lector()).toEqual(ESTAT_DE_RESPALD)
    }
    expect(ESTAT_DE_RESPALD).toEqual({ activa: true, hash: HASH_TOKEN })
  })
  it('si la base deja de contestar, se mantiene el último estado bueno', async () => {
    let t = 0
    let cae = false
    const f = vi.fn(async () => { if (cae) throw new Error('red'); return resposta({ activa: false, hash: H }) })
    const lector = creaLectorEstat('http://x/estat', { fetchFn: f as unknown as typeof fetch, ara: () => t })
    expect(await lector()).toEqual({ activa: false, hash: H })
    cae = true
    t += TTL_ESTAT_MS + 1
    expect(await lector()).toEqual({ activa: false, hash: H })
  })
})

describe('la contraseña que se puede poner', () => {
  it('de 8 a 100 caracteres', () => {
    expect(motiuContrasenyaInvalida('1234567')).toBe('curta')
    expect(motiuContrasenyaInvalida('12345678')).toBeNull()
    expect(motiuContrasenyaInvalida('x'.repeat(100))).toBeNull()
    expect(motiuContrasenyaInvalida('x'.repeat(101))).toBe('llarga')
    expect(motiuContrasenyaInvalida(12345678)).toBe('tipus')
    expect(motiuContrasenyaInvalida(null)).toBe('tipus')
  })
})
