// CORS compartido por las funciones que llama el navegador.
//
// Estaba copiado LITERAL en `registro`, `recuperar-password` y `enviar-acceso`, y la
// fase 3 añade `enlace-publico`, que es la cuarta copia. Se extrae aquí antes de que
// sean cuatro sitios donde arreglar el mismo fallo.
//
// ⚠️ Dos cosas que este fichero NO puede resolver y hay que recordar (§10):
//
//  1. `ALLOWED_ORIGINS` es un `const` de módulo, evaluado al cargar el isolate. Cambiar
//     el secreto `ALLOWED_ORIGIN` no llega a un isolate caliente: hay que **redesplegar**
//     las funciones, y no dar por buena una prueba hecha diez segundos después.
//  2. Un origen NO permitido **no da error**: la función responde 204 igual, pero con el
//     `Access-Control-Allow-Origin` del primero de la lista, y es el navegador quien
//     bloquea después. Al verificar CORS hay que leer la cabecera, nunca el código de
//     estado (§10ter).
//
// El matcher de aquí NO es el de GoTrue: aquí `*` vale por un tramo de dominio y se
// comparan orígenes completos (sin `/**`); la allow-list de Auth es glob y sí necesita
// el `/**` final. No copiar el mismo literal a los dos sitios.

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/** ¿Está este origen en la allow-list? `*` cubre un tramo de dominio (previews de Vercel). */
export function originPermitido(origin: string): boolean {
  return ALLOWED_ORIGINS.some((patron) => {
    if (!patron.includes("*")) return patron === origin;
    const re = new RegExp(
      "^" + patron.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[A-Za-z0-9-]+") + "$",
    );
    return re.test(origin);
  });
}

/**
 * Cabeceras CORS para esta petición. Si el origen no está permitido devuelve el primero
 * de la lista, que es lo que hace que el navegador corte (ver aviso 2 de arriba).
 */
export function corsPara(
  req: Request,
  metodos = "POST, OPTIONS",
): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": originPermitido(origin) ? origin : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": metodos,
  };
}
