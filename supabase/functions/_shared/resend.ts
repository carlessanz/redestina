// Envío de correo vía Resend (https://resend.com), compartido por las Edge
// Functions que mandan email (ofertas, recuperación de contraseña y accesos).
//
// Nunca lanza: devuelve { ok, status, data }, como _shared/whatsapp.ts.
//
// Requiere los secrets RESEND_API_KEY y RESEND_FROM (remitente de un dominio
// VERIFICADO en Resend; sin dominio verificado Resend solo entrega al correo
// propietario de la cuenta). Ver AGENTS.md §10.
//
// Aquí vive TAMBIÉN la plantilla visual de los correos (`plantillaEmail`): en un
// solo sitio, porque un correo mal maquetado no lo detecta `tsc` ni ninguna
// prueba, solo la persona que lo recibe.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Por defecto, el remitente de pruebas de Resend (solo entrega al owner).
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Redestina <onboarding@resend.dev>";

// El logo tiene que ser una URL absoluta y pública: los clientes de correo no
// resuelven rutas relativas, no cargan `data:` (Gmail lo bloquea) y no saben
// pintar SVG. `public/logo-email.png` es el logo en negativo (para la cabecera verde)
// rasterizado a 410×120; se regenera desde `public/logo-redestina-negativo.svg`.
const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com")
  .replace(/\/+$/, "");
const LOGO_URL = `${APP_URL}/logo-email.png`;

export interface EmailPayload {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /**
   * Ficheros adjuntos. `content` es el PDF ya en base64 (sin el prefijo `data:`).
   *
   * Los documentos legales viajan adjuntos y NO como enlace: un enlace al bucket
   * caduca en 60 s y uno con token es una credencial al portador (§9). El adjunto es
   * el mismo fichero cuya huella está en `documentos.sha256_fichero`, así que lo que
   * recibe la persona se puede verificar contra la base.
   *
   * ⚠️ Resend limita el correo entero a 40 MB, y base64 infla un 33 %: un documento
   * de más de ~28 MB no cabe. Hoy ninguno se acerca (el de prueba, 6 páginas, pesa
   * 123 KB), pero un albarán con fotos de incidencias podría: por eso `generar-documento`
   * comprueba el tamaño antes de adjuntar y, si no cabe, manda el correo sin adjunto
   * diciendo dónde descargarlo.
   */
  attachments?: { filename: string; content: string }[];
}

export interface EmailResult {
  ok: boolean;
  status: number;
  data: unknown;
}

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  if (!RESEND_API_KEY) {
    console.error("[resend] Falta RESEND_API_KEY: no se envía email.");
    return { ok: false, status: 500, data: { error: "email_no_configurado" } };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: payload.to,
        subject: payload.subject,
        ...(payload.html ? { html: payload.html } : {}),
        ...(payload.text ? { text: payload.text } : {}),
        ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) console.error("[resend] error", res.status, JSON.stringify(data));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error("[resend] fetch falló:", err instanceof Error ? err.message : String(err));
    return { ok: false, status: 0, data: { error: String(err) } };
  }
}

// --- Plantilla visual -------------------------------------------------------

// Colores del sistema de diseño (design/tokens.json). Si cambian allí, cambian aquí.
const VERDE = "#4e6b45"; // primary
const CREMA = "#f5f1ea"; // background / primary-foreground
const CORAL = "#ef7d77"; // acento de marca
const FONDO = "#ebe6da"; // muted: fondo exterior del correo
const BORDE = "#e0d9ca"; // border
const TEXTO = "#1d1d1b"; // foreground
const SUAVE = "#5f6b5a"; // muted-foreground
const FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface Boton {
  texto: string;
  url: string;
}

export interface PlantillaOpciones {
  /** Encabezado de la tarjeta (h1). */
  titulo: string;
  /** HTML del cuerpo. **NO se escapa**: llega ya construido. */
  cuerpoHtml: string;
  /** Línea que la bandeja de entrada enseña junto al asunto. */
  preheader?: string;
  /** Botón principal, pintado con la técnica de tabla (Outlook ignora padding en <a>). */
  boton?: Boton;
  /** Nota final dentro de la tarjeta (letra pequeña). */
  nota?: string;
}

// Construye el correo completo. Maquetado con tablas y estilos en línea porque es
// lo único que renderizan igual Gmail, Outlook y Apple Mail; nada de flex/grid.
export function plantillaEmail(o: PlantillaOpciones): string {
  const preheader = o.preheader
    ? `<div style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${FONDO}">${
      escaparHtml(o.preheader)
    }${"&#847;&zwnj;&nbsp;".repeat(60)}</div>`
    : "";

  const boton = o.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0">
            <tr><td align="center" bgcolor="${VERDE}" style="border-radius:10px">
              <a href="${o.boton.url}" style="display:inline-block;padding:14px 28px;font-family:${FUENTE};font-size:16px;font-weight:700;color:${CREMA};text-decoration:none;border-radius:10px">${
      escaparHtml(o.boton.texto)
    }</a>
            </td></tr>
          </table>`
    : "";

  const nota = o.nota
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${BORDE};font-family:${FUENTE};font-size:13px;line-height:1.55;color:${SUAVE}">${o.nota}</p>`
    : "";

  return `<!doctype html>
<html lang="ca">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escaparHtml(o.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:${FONDO};-webkit-text-size-adjust:100%">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FONDO}">
  <tr><td align="center" style="padding:32px 16px">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate">

      <!-- Cabecera: el alt del logo va estilado, así que con las imágenes
           bloqueadas (Gmail lo hace por defecto) se sigue leyendo «Redestina». -->
      <tr><td align="center" bgcolor="${VERDE}" style="background:${VERDE};border-radius:16px 16px 0 0;padding:28px 24px 22px">
        <img src="${LOGO_URL}" width="150" height="44" alt="Redestina"
             style="display:block;border:0;outline:none;width:150px;height:44px;font-family:${FUENTE};font-size:26px;font-weight:700;color:${CREMA};letter-spacing:1px">
        <div style="font-family:${FUENTE};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${CREMA};opacity:.85;padding-top:10px">Fundació Espigoladors</div>
      </td></tr>

      <!-- Tarjeta -->
      <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:32px 32px 28px">
        <h1 style="margin:0 0 16px;font-family:${FUENTE};font-size:23px;line-height:1.3;font-weight:700;color:${TEXTO}">${
    escaparHtml(o.titulo)
  }</h1>
        <div style="font-family:${FUENTE};font-size:15px;line-height:1.6;color:${TEXTO}">${o.cuerpoHtml}</div>
        ${boton}
        ${nota}
      </td></tr>

      <!-- Filete coral: la identidad de Redestina sin depender de imágenes -->
      <tr><td bgcolor="${CORAL}" style="background:${CORAL};font-size:0;line-height:0;height:4px">&nbsp;</td></tr>

      <!-- Pie -->
      <tr><td bgcolor="${CREMA}" style="background:${CREMA};border-radius:0 0 16px 16px;padding:20px 32px">
        <p style="margin:0;font-family:${FUENTE};font-size:13px;line-height:1.6;color:${TEXTO}">
          <strong>Redestina</strong> · aprofitament d'excedents agrícoles<br>
          <a href="${APP_URL}" style="color:${TEXTO};text-decoration:underline">${
    APP_URL.replace(/^https?:\/\//, "")
  }</a>
        </p>
      </td></tr>

    </table>

    <p style="margin:16px 0 0;font-family:${FUENTE};font-size:11px;line-height:1.5;color:${SUAVE};max-width:600px">
      Has rebut aquest correu perquè formes part de la xarxa de Redestina, el servei de canalització d'excedents de la Fundació Espigoladors.
    </p>

  </td></tr>
</table>
</body>
</html>`;
}

// Envuelve un texto plano (el de la oferta, con emojis y saltos de línea) en la
// plantilla. ESCAPA el contenido: es texto, no HTML. Si lo que tienes ya es
// HTML, usa `plantillaEmail` directamente — pasarlo por aquí lo publicaría como
// markup literal, que es exactamente el fallo que se corrigió el 30-07-2026.
export function textoAHtml(titulo: string, cuerpo: string): string {
  return plantillaEmail({
    titulo,
    cuerpoHtml: bloquePreformateado(cuerpo),
  });
}

// Recuadro monoespaciado-pero-legible para textos que llegan ya compuestos (el
// `texto_oferta`, el albarán): conserva los saltos y no se los come el cliente.
export function bloquePreformateado(texto: string): string {
  return `<div style="white-space:pre-wrap;font-family:${FUENTE};font-size:15px;line-height:1.6;color:${TEXTO};background:#ffffff;border:1px solid ${BORDE};border-radius:12px;padding:18px 20px">${
    escaparHtml(texto)
  }</div>`;
}
