// El buzón de pruebas del CLON LOCAL (plan 1, 1D).
//
// En el clon el correo se simula (`RESEND_ENVIO_REAL` no es "true") y el contenido se perdía: un
// E2E no tenía de dónde sacar el enlace que se acababa de mandar. El stack local de Supabase trae
// un Mailpit; esto le copia el correo SIMULADO con su API (`POST /api/v1/send`), y el E2E lo lee
// en `127.0.0.1:55324`.
//
// ⚠️ Solo actúa con `MAILPIT_URL`, que existe ÚNICAMENTE en `supabase/.env.funciones-local`
//    (`scripts/local/preparar-entorno.sh`). En producción no existe, y además allí el envío es
//    real: quien llama solo usa esto cuando `sendEmail()` ha devuelto `simulado: true`.
// Nunca lanza: un buzón de pruebas caído no puede cambiar el resultado de un envío.

export interface CorreuLocal {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export async function copiaBustiaLocal(c: CorreuLocal): Promise<void> {
  const base = Deno.env.get("MAILPIT_URL");
  if (!base) return;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: "no-reply@redestina.local", Name: "Redestina (clon)" },
        To: [{ Email: c.to }],
        Subject: c.subject,
        ...(c.html ? { HTML: c.html } : {}),
        ...(c.text ? { Text: c.text } : {}),
      }),
    });
    if (!res.ok) console.warn("[bustiaLocal] Mailpit ha respost", res.status);
    await res.body?.cancel();
  } catch (err) {
    console.warn("[bustiaLocal] sense Mailpit:", err instanceof Error ? err.message : String(err));
  }
}
