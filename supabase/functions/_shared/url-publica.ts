// La URL firmada de Storage, vista desde el navegador (07-10-2026).
//
// En el clon local (AGENTS.md §11) las Edge Functions corren dentro de Docker y ven
// `SUPABASE_URL = http://kong:8000`, una dirección que solo existe dentro de la red de
// Docker. `createSignedUrl()` construye la URL con ese origen, así que el navegador no
// podría abrirla. Con `URL_PUBLICA_STORAGE` puesta (solo en local), se cambia el origen
// por el público y se conserva todo lo demás: ruta, token y caducidad.
//
// En producción la variable no existe y la URL sale tal cual.
//
// Puro y sin `Deno`: quien llama pasa el valor de la variable, y así se prueba desde
// Vitest (tests/urlPublica.test.ts).

export function urlPublica(urlFirmada: string, basePublica: string | undefined): string {
  const base = basePublica?.trim();
  if (!base) return urlFirmada;
  let origen: URL;
  let firmada: URL;
  try {
    origen = new URL(base);
    firmada = new URL(urlFirmada);
  } catch {
    return urlFirmada;
  }
  // La base puede llevar ruta (p. ej. un proxy en /supabase): se antepone a la de la firma.
  const prefijo = origen.pathname.replace(/\/+$/, "");
  return `${origen.origin}${prefijo}${firmada.pathname}${firmada.search}${firmada.hash}`;
}
