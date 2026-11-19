// A dónde volver después de entrar (fase 4 de los puntos 4-6, Excel 4.4).
//
// POR QUÉ EXISTE. `RequireSessio` ya pasaba la URL pedida en `state.from` al mandar al acceso,
// pero ese `state` vive en la entrada del historial: se pierde al recargar, al seguir el enlace
// de primer acceso (que abre la recuperación de contraseña) y al pasar por `/restablir`. Un
// enlace directo de un mensaje —«obre l’enllaç i indica els kg»— acababa en el panel genérico.
// Aquí se guarda también en `sessionStorage` (de esta pestaña) y la entrada lo consume una vez.
//
// 🔴 SOLO RUTAS INTERNAS. Lo que se guarda acaba en un `navigate()`: una URL externa
//    (`https://…`, `//host`, `/\host`, `javascript:`) sería una redirección abierta tras el
//    login. Se aceptan solo rutas que empiezan por UNA barra, sin barras invertidas ni
//    caracteres de control, que al resolverse no salen del origen; lo demás se descarta.
//
// Puro salvo el acceso a `sessionStorage`, que se puede inyectar: lo prueba
// `tests/destiLogin.test.ts`.

/** La clave en `sessionStorage`. */
export const CLAU_DESTI = 'redestina-desti'

/** Un destino guardado caduca: un enlace abandonado no debe secuestrar el siguiente acceso. */
export const CADUCITAT_DESTI_MS = 60 * 60 * 1000

/**
 * Las puertas de entrada y la raíz por rol: volver a ellas no es un destino, y alguna
 * (`/login`, `/panell`) daría una vuelta inútil o un bucle.
 */
const RUTES_ENTRADA = new Set(['/', '/login', '/admin', '/restablir', '/panell', '/sense-acces', '/registre'])

/** Lo que usa este módulo de `Storage`, para poder probarlo sin navegador. */
export interface Magatzem {
  getItem(clau: string): string | null
  setItem(clau: string, valor: string): void
  removeItem(clau: string): void
}

/**
 * La ruta, si es un destino interno válido (`/receptor/mercat?oferta=…`); si no, `null`.
 * Se devuelve tal cual (sin normalizar), recortada.
 */
export function destiValid(ruta: unknown): string | null {
  if (typeof ruta !== 'string') return null
  const r = ruta.trim()
  if (r.length === 0 || r.length > 2000) return null
  // Una sola barra al principio: `//host` es una URL de otro origen sin esquema.
  if (!r.startsWith('/') || r.startsWith('//')) return null
  // `/\host` lo leen algunos navegadores como `//host`; ninguna ruta propia lleva `\`.
  if (r.includes('\\')) return null
  // Ni saltos de línea ni tabuladores: el navegador los quita y `/\n/host` pasaría a `//host`.
  if (/[\u0000-\u001f\u007f]/.test(r)) return null
  // Y la prueba definitiva: resuelta contra un origen cualquiera, no puede salir de él.
  try {
    const base = 'https://redestina.invalid'
    if (new URL(r, base).origin !== base) return null
  } catch {
    return null
  }
  const cami = r.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/'
  if (RUTES_ENTRADA.has(cami)) return null
  return r
}

/** `sessionStorage`, o `null` si el navegador no lo deja usar (modo privado estricto). */
function magatzemPerDefecte(): Magatzem | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

/** Guarda el destino si es válido; si no, no toca lo que hubiera. Nunca lanza. */
export function guardaDesti(
  ruta: string,
  magatzem: Magatzem | null = magatzemPerDefecte(),
  ara: number = Date.now(),
): void {
  const r = destiValid(ruta)
  if (!r || !magatzem) return
  try {
    magatzem.setItem(CLAU_DESTI, JSON.stringify({ ruta: r, at: ara }))
  } catch { /* sin almacenamiento: queda `state.from`, como antes */ }
}

/**
 * El destino guardado, si sigue siendo válido y no ha caducado; no lo borra. Se vuelve a
 * validar al leer: lo que hay en el almacenamiento lo puede haber escrito cualquiera.
 */
export function llegeixDesti(
  magatzem: Magatzem | null = magatzemPerDefecte(),
  ara: number = Date.now(),
): string | null {
  if (!magatzem) return null
  try {
    const cru = magatzem.getItem(CLAU_DESTI)
    if (!cru) return null
    const v = JSON.parse(cru) as { ruta?: unknown; at?: unknown }
    if (typeof v?.at !== 'number' || ara - v.at > CADUCITAT_DESTI_MS || v.at - ara > 60_000) return null
    return destiValid(v.ruta)
  } catch {
    return null
  }
}

/** Borra el destino guardado. Nunca lanza. */
export function esborraDesti(magatzem: Magatzem | null = magatzemPerDefecte()): void {
  try { magatzem?.removeItem(CLAU_DESTI) } catch { /* nada que borrar */ }
}

/** Lee el destino y lo borra: se usa UNA vez, al entrar. */
export function consumeixDesti(
  magatzem: Magatzem | null = magatzemPerDefecte(),
  ara: number = Date.now(),
): string | null {
  const r = llegeixDesti(magatzem, ara)
  esborraDesti(magatzem)
  return r
}
