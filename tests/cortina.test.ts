// La cortina de contraseña (cortina/cortina.ts). Sin la contraseña en el repo, lo que se
// prueba aquí es todo lo demás: que lo libre sea libre y nada más, que una cookie falsa no
// abra, que el destino no pueda salir de la web y que una navegación vea la cortina.
//
// ⚠️ El camino bueno (contraseña correcta → cookie → pasa) solo se prueba si se da la
//    contraseña por entorno: `CORTINA_PROVA='…' npx vitest run tests/cortina.test.ts`.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { empaqueta } from '../scripts/construir-cortina.mjs'
import {
  COOKIE, RUTA_ENTRADA, destiSegur, esLliure, esTokenValid, gestiona, llegeixCookie,
  tokenDeContrasenya,
} from '../cortina/cortina.ts'

const BASE = 'https://redestina.carlessanz.com'

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
