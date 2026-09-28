// LA CORTINA: una contraseña delante de toda la web (28-09-2026, a petición del cliente).
//
// Mientras Redestina esté en pruebas, nadie que no la tenga puede ver ni una página ni un
// fichero. La comprueba el SERVIDOR (Vercel Routing Middleware, `middleware.js`), no el
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

export type Idioma = 'ca' | 'es'
/** La preferencia de idioma de la cortina. No es ningún secreto: no lleva `HttpOnly`. */
export const COOKIE_IDIOMA = 'redestina_idioma'

const TEXTOS: Record<Idioma, Record<string, string>> = {
  ca: {
    titol_pagina: 'Redestina · Accés restringit',
    titol: 'Accés restringit',
    intro: 'Redestina està en fase de proves. Introdueix la contrasenya per accedir-hi.',
    etiqueta: 'Contrasenya',
    mostra: 'Mostra',
    amaga: 'Amaga',
    boto: 'Entra',
    error: 'La contrasenya no és correcta. Torna-ho a provar.',
    recorda: 'No te la tornarem a demanar en aquest dispositiu durant una setmana.',
    peu: 'Una iniciativa de la Fundació Espigoladors',
    idioma: 'Idioma',
  },
  es: {
    titol_pagina: 'Redestina · Acceso restringido',
    titol: 'Acceso restringido',
    intro: 'Redestina está en fase de pruebas. Introduce la contraseña para acceder.',
    etiqueta: 'Contraseña',
    mostra: 'Mostrar',
    amaga: 'Ocultar',
    boto: 'Entrar',
    error: 'La contraseña no es correcta. Vuelve a intentarlo.',
    recorda: 'No te la volveremos a pedir en este dispositivo durante una semana.',
    peu: 'Una iniciativa de la Fundació Espigoladors',
    idioma: 'Idioma',
  },
}

/** El idioma de la cortina: el que se pide por `?idioma=`, el guardado o, si no, catalán. */
export function idiomaDe(url: URL, capcaleraCookie: string | null): Idioma {
  const demanat = url.searchParams.get('idioma')
  if (demanat === 'ca' || demanat === 'es') return demanat
  const desat = llegeixCookie(capcaleraCookie, COOKIE_IDIOMA)
  return desat === 'es' ? 'es' : 'ca'
}

/** La ruta sin el `?idioma=`, para que el cambio de idioma no se arrastre al destino. */
function senseIdioma(url: URL): string {
  const u = new URL(url)
  u.searchParams.delete('idioma')
  return u.pathname + u.search
}

/**
 * La página de la cortina. HTML autónomo: no puede pedir nada a la web, que está detrás.
 * Colores de `design/tokens.json` (primary, verde-oscuro, crema, card, border, input,
 * muted-foreground, error), escritos aquí porque esta página no pasa por Tailwind.
 * UN idioma cada vez (catalán por defecto), con el selector arriba: el cliente no quería los
 * dos juntos (28-09-2026).
 */
export function paginaCortina({ desti, error, idioma = 'ca' }: { desti: string; error: boolean; idioma?: Idioma }): string {
  const t = TEXTOS[idioma]
  const enllac = (l: Idioma) => `${escapa(desti.split('?')[0] || '/')}?idioma=${l}`
  const opcio = (l: Idioma, nom: string) => l === idioma
    ? `<span class="idioma actiu" aria-current="true" lang="${l}">${nom}</span>`
    : `<a class="idioma" href="${enllac(l)}" lang="${l}" hreflang="${l}">${nom}</a>`
  return `<!doctype html>
<html lang="${idioma}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#4e6b45">
<title>${t.titol_pagina}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%}
  body{font-family:Inter,system-ui,sans-serif;color:#1d1d1b;
    background:radial-gradient(120% 80% at 50% 0%,#5d7a54 0%,#4e6b45 55%,#3e5139 100%) fixed #4e6b45}
  .pagina{min-height:100dvh;display:flex;flex-direction:column;
    padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}
  header{display:flex;justify-content:flex-end}
  .idiomes{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.12);
    border:1px solid rgba(255,255,255,.22)}
  .idioma{min-width:44px;height:32px;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;
    border-radius:999px;font-size:.8125rem;font-weight:600;letter-spacing:.02em;color:#fff;text-decoration:none}
  a.idioma:hover{background:rgba(255,255,255,.14)}
  a.idioma:focus-visible{outline:2px solid #f5f1ea;outline-offset:2px}
  .idioma.actiu{background:#f5f1ea;color:#3e5139}
  main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:24px 0}
  .logo{width:200px;max-width:62vw;height:auto}
  .targeta{width:100%;max-width:380px;background:#fff;border-radius:18px;padding:28px 24px 24px;
    box-shadow:0 18px 40px -12px rgba(20,30,18,.45),0 2px 6px rgba(20,30,18,.12)}
  .cadenat{width:44px;height:44px;border-radius:12px;background:#e4eadf;color:#4e6b45;
    display:flex;align-items:center;justify-content:center;margin-bottom:16px}
  h1{font-family:Sora,Inter,sans-serif;font-weight:700;font-size:1.25rem;line-height:1.3;color:#3e5139;margin:0 0 6px}
  .intro{margin:0 0 20px;font-size:.9375rem;line-height:1.5;color:#5f6b5a}
  form{display:flex;flex-direction:column;gap:8px}
  label{font-size:.875rem;font-weight:600;color:#1d1d1b}
  .camp{position:relative}
  input[type=password],input[type=text]{width:100%;height:48px;border-radius:10px;border:1px solid #cfc6b3;
    padding:0 84px 0 14px;font-size:16px;font-family:inherit;color:#1d1d1b;background:#fff}
  input:focus{outline:none;border-color:#4e6b45;box-shadow:0 0 0 3px rgba(78,107,69,.25)}
  .mostra{position:absolute;right:6px;top:6px;height:36px;padding:0 12px;border:0;border-radius:8px;
    background:transparent;color:#4e6b45;font:600 .8125rem Inter,system-ui,sans-serif;cursor:pointer}
  .mostra:hover{background:#e4eadf}
  .mostra:focus-visible{outline:2px solid #4e6b45;outline-offset:1px}
  .entra{margin-top:12px;height:48px;border:0;border-radius:10px;background:#4e6b45;color:#fff;
    font:600 1rem Inter,system-ui,sans-serif;cursor:pointer}
  .entra:hover{background:#3e5139}
  .entra:focus-visible{outline:3px solid #ef7d77;outline-offset:2px}
  .error{display:flex;gap:8px;align-items:flex-start;background:#fbe4e0;color:#b3261e;border-radius:10px;
    padding:10px 12px;font-size:.875rem;line-height:1.4;margin:0 0 12px}
  .recorda{margin:14px 0 0;font-size:.8125rem;line-height:1.4;color:#5f6b5a}
  footer{text-align:center;font-size:.8125rem;color:#d7e1d2;padding-bottom:4px}
</style>
</head>
<body>
<div class="pagina">
  <header>
    <nav class="idiomes" aria-label="${t.idioma}">${opcio('ca', 'CA')}${opcio('es', 'ES')}</nav>
  </header>
  <main>
    ${LOGO_NEGATIU}
    <section class="targeta">
      <div class="cadenat" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      </div>
      <h1>${t.titol}</h1>
      <p class="intro">${t.intro}</p>
      ${error ? `<p class="error" role="alert">${t.error}</p>` : ''}
      <form method="post" action="${RUTA_ENTRADA}" autocomplete="on">
        <input type="text" name="username" value="redestina" autocomplete="username" hidden>
        <input type="hidden" name="desti" value="${escapa(desti)}">
        <input type="hidden" name="idioma" value="${idioma}">
        <label for="contrasenya">${t.etiqueta}</label>
        <div class="camp">
          <input id="contrasenya" name="contrasenya" type="password" autocomplete="current-password" required autofocus${error ? ' aria-invalid="true"' : ''}>
          <button type="button" class="mostra" aria-controls="contrasenya" aria-pressed="false" data-mostra="${t.mostra}" data-amaga="${t.amaga}">${t.mostra}</button>
        </div>
        <button type="submit" class="entra">${t.boto}</button>
      </form>
      <p class="recorda">${t.recorda}</p>
    </section>
  </main>
  <footer>${t.peu}</footer>
</div>
<script>
  // Mostrar/ocultar la contraseña, y que la aplicación abra en el idioma elegido aquí
  // (la aplicación guarda el suyo en localStorage, clave 'redestina-lang').
  (function () {
    var b = document.querySelector('.mostra'), i = document.getElementById('contrasenya');
    b.addEventListener('click', function () {
      var visible = i.type === 'text';
      i.type = visible ? 'password' : 'text';
      b.textContent = visible ? b.dataset.mostra : b.dataset.amaga;
      b.setAttribute('aria-pressed', String(!visible));
      i.focus();
    });
    try { localStorage.setItem('redestina-lang', '${idioma}'); } catch (e) {}
  })();
</script>
</body>
</html>`
}

function htmlCortina(desti: string, error: boolean, idioma: Idioma): Response {
  return new Response(paginaCortina({ desti, error, idioma }), {
    // 401 y no 200: que ningún buscador la indexe como si fuera la portada, y que ninguna
    // comprobación automática la confunda con la web de verdad.
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      // Recordar el idioma elegido: la próxima vez que salga la cortina, ya en ese idioma.
      'set-cookie': `${COOKIE_IDIOMA}=${idioma}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`,
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
    const idioma: Idioma = form?.get('idioma') === 'es' ? 'es' : 'ca'
    const token = contrasenya ? await tokenDeContrasenya(contrasenya) : ''
    if (!(await esTokenValid(token))) return htmlCortina(desti, true, idioma)
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
  return htmlCortina(destiSegur(senseIdioma(url)), false, idiomaDe(url, req.headers.get('cookie')))
}
