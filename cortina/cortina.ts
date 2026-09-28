// LA CORTINA: una contraseña delante de toda la web (28-09-2026, a petición del cliente).
//
// Mientras Redestina esté en pruebas, nadie que no la tenga puede ver ni una página ni un
// fichero. La comprueba el SERVIDOR (Vercel Routing Middleware, `middleware.ts`), no el
// navegador: una contraseña comprobada en JavaScript viaja dentro del propio bundle y la lee
// cualquiera. Y como la cortina va delante de todo, tampoco se sirve ese bundle —que con
// `VITE_ACCESSOS_TEST` lleva las contraseñas de las cuentas de prueba— a quien no la tenga.
//
// 🔴 LA CONTRASEÑA NO ESTÁ EN EL REPO. Solo `HASH_TOKEN`, la huella de la huella:
//      token = PBKDF2-SHA256(contraseña, sal fija, 100.000 vueltas)   → va en la cookie
//      HASH_TOKEN = SHA-256(token)                                     → va aquí
//    Con el repo en la mano no se puede fabricar la cookie (haría falta invertir SHA-256) y
//    probar contraseñas contra la huella cuesta 100.000 vueltas por intento. Para cambiar la
//    contraseña: `node scripts/cortina-hash.mjs 'nova'` y sustituir la constante.
//
// ⚠️ Módulo PURO (Web Crypto y nada más), para que lo puedan importar el middleware —que
//    corre en el runtime Edge— y las pruebas de Vitest, que corren en Node.

import { LOGO_NEGATIU } from './logo.ts'

/** SHA-256 del token de la contraseña vigente. */
export const HASH_TOKEN = 'df8d7e4a9627eaf3650b2b5de6eff139fb2813c8f29f2e2bd9276a4ba89201a3'

export const COOKIE = 'redestina_cortina'
/** Una semana: lo que pidió el cliente. */
export const DURADA_S = 7 * 24 * 60 * 60
/** Adonde envía el formulario. No existe como página: lo contesta el middleware. */
export const RUTA_ENTRADA = '/__cortina'

const SAL = 'redestina-cortina-v1'
const VOLTES = 100_000

/**
 * Lo que se sirve SIN cortina, y por qué cada uno:
 * · `/logo-email.png` — lo pintan los correos desde la bandeja de quien los recibe.
 * · `/segell-redestina*.svg` — el sello del certificado de recepción vive en webs de
 *   terceros; con cortina saldría roto allí.
 * · `/favicon.svg` — el icono de la pestaña de la propia cortina.
 * · `/sw.js` y `/workbox-*.js` — sin ellos, un móvil con el service worker viejo seguiría
 *   sirviendo la aplicación de su caché para siempre, saltándose la cortina.
 * Ninguno lleva datos: son imágenes y el script que se actualiza.
 */
export function esLliure(ruta: string): boolean {
  return ruta === '/logo-email.png'
    || /^\/segell-redestina(-mono)?\.svg$/.test(ruta)
    || ruta === '/favicon.svg'
    || ruta === '/sw.js'
    || /^\/workbox-[A-Za-z0-9_-]+\.js$/.test(ruta)
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** El token que va en la cookie, derivado de la contraseña escrita. */
export async function tokenDeContrasenya(contrasenya: string): Promise<string> {
  const enc = new TextEncoder()
  const clau = await crypto.subtle.importKey('raw', enc.encode(contrasenya), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(SAL), iterations: VOLTES, hash: 'SHA-256' },
    clau,
    256,
  )
  return hex(bits)
}

/** ¿Este token abre la cortina? Una sola SHA-256: se evalúa en cada petición. */
export async function esTokenValid(token: string | null | undefined): Promise<boolean> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false
  const h = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return h === HASH_TOKEN
}

/** El valor de una cookie en la cabecera `Cookie`, o null. */
export function llegeixCookie(capcalera: string | null, nom: string): string | null {
  if (!capcalera) return null
  for (const part of capcalera.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === nom) return decodeURIComponent(v.join('='))
  }
  return null
}

/**
 * A dónde volver después de entrar. Solo rutas de ESTA web: un `//otro.com` o una URL
 * absoluta convertirían la cortina en un redirector abierto.
 */
export function destiSegur(desti: string | null | undefined): string {
  if (!desti || !desti.startsWith('/') || desti.startsWith('//') || desti.startsWith('/\\')) return '/'
  if (desti.startsWith(RUTA_ENTRADA)) return '/'
  return desti
}

function escapa(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/**
 * La página de la cortina. HTML autónomo: no puede pedir nada a la web, que está detrás.
 * Colores de `design/tokens.json` (verde de marca, crema, coral suave), escritos aquí porque
 * esta página no pasa por Tailwind.
 */
export function paginaCortina({ desti, error }: { desti: string; error: boolean }): string {
  return `<!doctype html>
<html lang="ca">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#4e6b45">
<title>Redestina · Accés</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%;background:#4e6b45;color:#fff;font-family:Inter,system-ui,sans-serif}
  main{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left));gap:32px}
  .logo{width:220px;max-width:70vw;height:auto}
  form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:12px}
  h1{font-family:Sora,Inter,sans-serif;font-weight:600;font-size:1.125rem;margin:0;text-align:center}
  p{margin:0;text-align:center;font-size:.875rem;line-height:1.4;color:#e6ede3}
  label{font-size:.875rem;font-weight:500}
  input[type=password]{width:100%;height:48px;border-radius:10px;border:1px solid #d9e2d4;padding:0 14px;
    font-size:16px;font-family:inherit;color:#1d1d1b;background:#fff}
  input[type=password]:focus{outline:3px solid #f5f1ea;outline-offset:2px}
  button{height:48px;border:0;border-radius:10px;background:#f5f1ea;color:#3e5139;font-weight:600;
    font-size:1rem;font-family:inherit;cursor:pointer}
  button:hover{background:#fff}
  button:focus-visible{outline:3px solid #ef7d77;outline-offset:2px}
  .error{background:#fbe4e0;color:#b3261e;border-radius:8px;padding:10px 12px;font-size:.875rem;text-align:left}
  .peu{font-size:.75rem;color:#cfdbc9}
</style>
</head>
<body>
<main>
  ${LOGO_NEGATIU}
  <form method="post" action="${RUTA_ENTRADA}" autocomplete="on">
    <h1>Accés restringit · Acceso restringido</h1>
    <p>Redestina està en proves. Escriu la contrasenya per entrar.<br>Redestina está en pruebas. Escribe la contraseña para entrar.</p>
    ${error ? '<div class="error" role="alert">La contrasenya no és correcta. · La contraseña no es correcta.</div>' : ''}
    <input type="text" name="username" value="redestina" autocomplete="username" hidden>
    <input type="hidden" name="desti" value="${escapa(desti)}">
    <label for="contrasenya">Contrasenya · Contraseña</label>
    <input id="contrasenya" name="contrasenya" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Entra · Entrar</button>
  </form>
  <p class="peu">Fundació Espigoladors</p>
</main>
</body>
</html>`
}

function htmlCortina(desti: string, error: boolean): Response {
  return new Response(paginaCortina({ desti, error }), {
    // 401 y no 200: que ningún buscador la indexe como si fuera la portada, y que ninguna
    // comprobación automática la confunda con la web de verdad.
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}

/** Deja pasar la petición a Vercel (lo mismo que hace `next()` de `@vercel/functions`). */
function continua(): Response {
  return new Response(null, { headers: { 'x-middleware-next': '1' } })
}

/**
 * Toda la lógica, en una función que las pruebas pueden llamar con una `Request` a mano.
 * Devuelve siempre una `Response`: o la cortina, o la redirección tras entrar, o `continua()`.
 */
export async function gestiona(req: Request): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === RUTA_ENTRADA) {
    if (req.method !== 'POST') return Response.redirect(new URL('/', url), 303)
    const form = await req.formData().catch(() => null)
    const contrasenya = String(form?.get('contrasenya') ?? '')
    const desti = destiSegur(String(form?.get('desti') ?? '/'))
    const token = contrasenya ? await tokenDeContrasenya(contrasenya) : ''
    if (!(await esTokenValid(token))) return htmlCortina(desti, true)
    return new Response(null, {
      status: 303,
      headers: {
        location: desti,
        'cache-control': 'no-store',
        'set-cookie': `${COOKIE}=${token}; Path=/; Max-Age=${DURADA_S}; HttpOnly; Secure; SameSite=Lax`,
      },
    })
  }

  if (esLliure(url.pathname)) return continua()
  if (await esTokenValid(llegeixCookie(req.headers.get('cookie'), COOKIE))) return continua()

  // Una navegación ve la cortina; cualquier otra cosa (un script, una imagen, el manifest)
  // recibe un 401 seco, sin el HTML de la cortina dentro de un `<script>`.
  const navegacio = req.method === 'GET'
    && (req.headers.get('sec-fetch-mode') === 'navigate'
      || (req.headers.get('accept') ?? '').includes('text/html'))
  if (!navegacio) {
    return new Response('Accés restringit', { status: 401, headers: { 'cache-control': 'no-store' } })
  }
  return htmlCortina(destiSegur(url.pathname + url.search), false)
}
