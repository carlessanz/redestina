// Respuestas HTTP y guarda de secreto compartido, en un solo sitio.
//
// POR QUÉ EXISTE. El mismo `json()` estaba copiado en nueve funciones, el `responder`
// con CORS en otras nueve, el 204 del preflight en trece y la guarda del secreto
// compartido (`x-documentos-secret` / `x-recordatorios-secret`) en cinco. Las copias
// eran idénticas; lo que no lo era es dónde habría que arreglar un fallo el día que
// apareciera. Aquí no hay ninguna decisión nueva: es exactamente lo que hacían.
//
// ⚠️ LA POLÍTICA DE CORS NO VIVE AQUÍ. Las cabeceras las sigue componiendo cada función
//    con `corsPara()` (`cors.ts`), con sus métodos; estas utilidades solo las reciben.
//    Así una función sin CORS (las que llama `pg_net`) sigue sin mandar ninguna cabecera
//    `Access-Control-*`, igual que antes.
//
// ⚠️ ESTE MÓDULO NO LEE `Deno.env`: quien llama pasa el valor esperado. Así se puede
//    importar desde Vitest sin el global `Deno` (mismo criterio que `whatsapp.ts`).

export type Cabeceras = Record<string, string>;

/** Respuesta JSON. Las cabeceras de `extra` van primero y `Content-Type` al final. */
export function json(body: unknown, status = 200, extra: Cabeceras = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...extra, "Content-Type": "application/json" },
  });
}

/** `json()` con las cabeceras CORS de la petición ya puestas. */
export function respondedor(cors: Cabeceras): (body: unknown, status?: number) => Response {
  return (body: unknown, status = 200) => json(body, status, cors);
}

/** La respuesta al preflight `OPTIONS`: 204 sin cuerpo y con las cabeceras CORS. */
export function preflight(cors: Cabeceras): Response {
  return new Response(null, { status: 204, headers: cors });
}

/**
 * Compara dos cadenas sin cortar en el primer carácter distinto, para que el tiempo de
 * respuesta no diga cuántos caracteres del secreto se han acertado.
 *
 * Compara unidades UTF-16 (`charCodeAt`), no bytes: así el resultado es EXACTAMENTE el de
 * `a === b` para cualquier cadena, sin depender de cómo se codifique. La longitud sí se
 * filtra —el bucle recorre la mayor de las dos—, que es lo habitual y no da ventaja: el
 * secreto tiene longitud fija y conocida.
 */
export function igualesTiempoConstante(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

/**
 * Guarda de las funciones que llama la base (`pg_net`/`pg_cron`) con un secreto compartido
 * en cabecera. Devuelve `null` si pasa, o la respuesta de rechazo —`401
 * {"error":"unauthorized"}` sin CORS, la misma que daban las cinco copias— si no.
 *
 * Sin secreto configurado (`esperado` vacío o ausente) rechaza siempre: una función pública
 * sin su secreto no puede quedar abierta por un despliegue a medias.
 */
export function exigirSecreto(
  req: Request,
  cabecera: string,
  esperado: string | null | undefined,
): Response | null {
  const recibido = req.headers.get(cabecera);
  if (!esperado || recibido === null || !igualesTiempoConstante(recibido, esperado)) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}
