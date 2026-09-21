// La mitad PURA de la verificación pública: el código impreso y la URL que lleva a él.
//
// Vive aparte de `verificacio.ts` por lo mismo que `campsFundacio.ts` vive aparte de
// `parametresFundacio.ts`: aquel módulo importa el cliente de Supabase, que lanza al
// cargarse si faltan las variables de entorno, así que **no se puede importar desde
// Vitest**. Y esto es justo lo que más falta hace comprobar.

/**
 * El código de verificación impreso, a partir de `documentos.sha256_datos`.
 *
 * 🔴 TIENE QUE DAR EXACTAMENTE LO MISMO QUE `codigoVerificacion()` de
 * `supabase/functions/_shared/pdf/render/comu.ts`: los 16 primeros dígitos hexadecimales,
 * en mayúsculas y en grupos de cuatro. No es una preferencia de formato: si las dos
 * divergieran, el sello de una web enlazaría a un código que no es el del papel y la
 * página de verificación diría «no consta» de un certificado perfectamente válido — el
 * peor fallo posible aquí, porque a quien lo enseña lo hace parecer un falsificador.
 *
 * No se importa aquella función: es código de Deno, vive en el servidor y arrastra el
 * motor de PDF. Lo que sostiene la equivalencia es `tests/verificacio.test.ts`.
 *
 * Devuelve `null` —y no «—»— cuando no hay huella: quien llama tiene que poder decidir si
 * eso significa esconder el sello, y un guion no se puede meter en una URL.
 */
export function codiVerificacio(sha: string | null | undefined): string | null {
  if (!sha) return null
  const net = sha.replace(/[^0-9a-fA-F]/g, '').slice(0, 16).toUpperCase()
  if (net === '') return null
  return net.match(/.{1,4}/g)?.join('-') ?? net
}

/**
 * La URL pública de verificación de un código.
 *
 * Absoluta, y por un motivo concreto: su destino es el `href` de un sello **pegado en otra
 * web**, donde un `/verificar/…` apuntaría al dominio de esa web.
 */
export function urlVerificacio(origen: string, codi: string): string {
  return `${origen.replace(/\/+$/, '')}/verificar/${encodeURIComponent(codi)}`
}
