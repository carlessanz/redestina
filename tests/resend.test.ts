// El interruptor de envío real del correo (§12.59, §12.73).
//
// `sendEmail()` no se prueba entera aquí: llama a `Deno.env` y a `fetch`, y lo que
// importa de ella no es la llamada HTTP sino LA DECISIÓN de hacerla o no. Esa decisión
// está en `esEnvioReal()`, que es pura y no toca el runtime — igual que `tocaAviso()` en
// los recordatorios documentales, y por el mismo motivo.
//
// Lo que se comprueba es el fail-safe: **solo `"true"` exacto manda correo de verdad**.
// El gemelo de WhatsApp (`WHATSAPP_ENVIO_REAL`) lleva desde julio con esa regla y nunca
// ha tenido quien la vigile; esta sí.

import { describe, expect, it } from 'vitest'
import { esEnvioReal } from '../supabase/functions/_shared/resend'

describe('esEnvioReal', () => {
  it('solo el literal "true" enciende el envío', () => {
    expect(esEnvioReal('true')).toBe(true)
  })

  it('el secreto sin configurar NO envía (seguro por omisión)', () => {
    expect(esEnvioReal(undefined)).toBe(false)
    expect(esEnvioReal(null)).toBe(false)
    expect(esEnvioReal('')).toBe(false)
  })

  it('no se deja convencer por variantes', () => {
    // Un interruptor permisivo acaba encendido sin que nadie lo haya encendido: el día
    // que alguien escriba `RESEND_ENVIO_REAL=1` pensando que es lo mismo, tiene que
    // NO enviar, no enviar a 452 fichas reales.
    for (const valor of ['TRUE', 'True', '1', 'yes', 'sí', ' true', 'true ', 'false']) {
      expect(esEnvioReal(valor), valor).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// La cabecera del correo: que el logo se LEA
// ---------------------------------------------------------------------------
// POR QUÉ EXISTE ESTO (15-09-2026). La plantilla no tenía ninguna prueba, y durante cinco
// días TODOS los correos de Redestina salieron con el logo invisible: la cabecera era verde
// `#4e6b45` porque un comentario afirmaba que `logo-email.png` era el negativo, y el fichero
// era el logo **en color** —«DESTINA» y la hoja van en ese mismo `#4e6b45`—. Del logo solo se
// leía «RE», en coral. No lo cazó nadie porque para verlo hay que abrir un correo, y el
// `alt` de respaldo sí funcionaba: con las imágenes bloqueadas se leía «Redestina» y con
// ellas cargadas, media palabra.
//
// Lo que se puede comprobar desde aquí es la mitad que es código: **que ningún texto de la
// cabecera vaya del color de su propio fondo**. La otra mitad —que el PNG servido sea la
// variante que le toca a ese fondo— no se puede ver en el HTML; lo que la sostiene es que el
// fondo sea claro (el logo principal va «sobre crema o blanco», `design/DESIGN.md §4`) y el
// comentario que ahora sí describe el fichero.
// ⚠️ `plantillaEmail()` compone la URL del logo con `appUrl()`, que lee `Deno.env`. En Node
// ese global no existe, así que se declara antes de importar —igual que en `whatsapp.test.ts`—
// y así la prueba ejercita el camino real (con su `APP_URL` por defecto) en vez de un doble.
;(globalThis as Record<string, unknown>).Deno = { env: { get: () => undefined } }
import { plantillaEmail } from '../supabase/functions/_shared/resend'

/** Luminancia relativa de un `#rrggbb`, según WCAG 2.1. */
function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** Ratio de contraste entre dos colores: 1 = idénticos, 21 = negro sobre blanco. */
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const HTML = plantillaEmail({
  titulo: 'Prova',
  cuerpoHtml: '<p>cos</p>',
  boton: { texto: 'Entra', url: 'https://exemple.cat' },
})

/** El `bgcolor` de la primera celda, que es la cabecera. */
function fondoCabecera(html: string): string {
  const m = html.match(/<tr><td align="center" bgcolor="(#[0-9a-fA-F]{6})"/)
  if (!m) throw new Error('no se encuentra la cabecera')
  return m[1]
}

describe('la cabecera del correo', () => {
  it('declara un fondo', () => {
    expect(fondoCabecera(HTML)).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  // El caso real: crema sobre crema, o crema sobre verde con el logo verde, dan 1:1 o cerca.
  it('ningún texto suyo va del color de su propio fondo', () => {
    const fondo = fondoCabecera(HTML)
    const cabecera = HTML.slice(HTML.indexOf(fondo), HTML.indexOf('<!-- Tarjeta'))
    const colores = [...cabecera.matchAll(/color:(#[0-9a-fA-F]{6})/g)].map((m) => m[1])
    expect(colores.length, 'la cabecera no declara ningún color de texto').toBeGreaterThan(1)
    for (const c of colores) {
      expect(contraste(c, fondo), `${c} sobre ${fondo} no se lee`).toBeGreaterThanOrEqual(4.5)
    }
  })

  // Si el fondo fuera oscuro habría que servir el logo NEGATIVO, y hoy se sirve el de color.
  // Mientras el fondo sea claro, el logo principal es el correcto.
  it('el fondo es claro, que es lo que hace correcto al logo principal', () => {
    expect(contraste(fondoCabecera(HTML), '#ffffff')).toBeLessThan(1.6)
  })

  it('sirve el logo por URL absoluta: los clientes de correo no resuelven rutas relativas', () => {
    expect(HTML).toMatch(/<img src="https?:\/\/[^"]+\/logo-email\.png"/)
  })

  it('y deja el alt estilado, para cuando Gmail bloquea las imágenes', () => {
    const img = HTML.slice(HTML.indexOf('<img'), HTML.indexOf('>', HTML.indexOf('<img')))
    expect(img).toContain('alt="Redestina"')
    expect(img).toMatch(/font-size:\d+px/)
  })
})

describe('todos los correos llevan el mismo marco', () => {
  it('cabecera, filete coral y pie, con el cuerpo dentro', () => {
    expect(HTML).toContain('logo-email.png')
    expect(HTML).toContain('Fundació Espigoladors')
    expect(HTML).toContain('<p>cos</p>')
    expect(HTML.indexOf('logo-email.png')).toBeLessThan(HTML.indexOf('<p>cos</p>'))
  })

  it('el preheader se escapa: lo compone quien llama y puede traer HTML', () => {
    const h = plantillaEmail({ titulo: 'x', cuerpoHtml: '', preheader: '<b>hola</b>' })
    expect(h).toContain('&lt;b&gt;hola&lt;/b&gt;')
  })

  it('sin botón no se pinta ninguno', () => {
    expect(plantillaEmail({ titulo: 'x', cuerpoHtml: '' })).not.toContain('border-radius:10px')
  })
})
