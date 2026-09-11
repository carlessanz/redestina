// Envío de correo vía Resend (https://resend.com), compartido por las Edge
// Functions que mandan email (ofertas, recuperación de contraseña y accesos).
//
// Nunca lanza: devuelve { ok, status, data }, como _shared/whatsapp.ts.
//
// Requiere los secrets RESEND_API_KEY y RESEND_FROM (remitente de un dominio
// VERIFICADO en Resend; sin dominio verificado Resend solo entrega al correo
// propietario de la cuenta) y **RESEND_ENVIO_REAL**, el interruptor de envío real:
// mientras no valga exactamente "true", no sale ni un correo (§8, gemelo de
// WHATSAPP_ENVIO_REAL). Ver AGENTS.md §10.
//
// Aquí vive TAMBIÉN la plantilla visual de los correos (`plantillaEmail`): en un
// solo sitio, porque un correo mal maquetado no lo detecta `tsc` ni ninguna
// prueba, solo la persona que lo recibe.

// Los secretos se leen DENTRO de las funciones, no en el cuerpo del módulo. Mismo motivo
// que en `_shared/whatsapp.ts`: escrito como `const X = Deno.env.get(...)` a nivel de
// módulo, cualquier `import` desde Node moría con `ReferenceError: Deno is not defined`
// **antes de ejecutar nada**, y eso dejaba fuera del arnés de pruebas todo este fichero
// —incluida la plantilla de correo, que es el único sitio donde se maqueta un correo—.
// En Deno no cambia nada: el entorno del isolate no varía durante su vida.
function apiKey(): string {
  return Deno.env.get("RESEND_API_KEY") ?? "";
}

/** Por defecto, el remitente de pruebas de Resend (solo entrega al owner de la cuenta). */
function remitente(): string {
  return Deno.env.get("RESEND_FROM") ?? "Redestina <onboarding@resend.dev>";
}

/**
 * Interruptor de envío real, gemelo de `WHATSAPP_ENVIO_REAL` (§8).
 *
 * Mientras `RESEND_ENVIO_REAL` no valga exactamente `"true"`, **no sale ni un correo**:
 * se devuelve una respuesta simulada (`ok: true`, `simulado: true`) y el flujo de quien
 * llama continúa con normalidad. Es seguro por omisión —si el secreto no está, no se
 * escribe a nadie— y es lo que permite ensayar en local el camino feliz completo: los
 * recordatorios documentales solo mueven sus contadores «si el correo salió», y hasta
 * ahora en local nunca salía, así que esa mitad del código no se podía recorrer sin
 * interceptar `fetch` (deudas §12.59 y §12.73).
 *
 * ⚠️ AL DESPLEGAR: en remoto hay que crear el secreto ANTES de redesplegar las funciones
 *    que mandan correo, o dejarán de mandarlo en silencio (bueno para la bandeja de
 *    nadie, malo para el reset de contraseña). `supabase secrets set RESEND_ENVIO_REAL=true`.
 */
function envioReal(): boolean {
  return esEnvioReal(Deno.env.get("RESEND_ENVIO_REAL"));
}

/**
 * La decisión, aparte del runtime y sin `Deno`, para que se pueda probar tal cual desde
 * Node (mismo criterio que `tocaAviso()` en `recordatorios-documentales`). Es una sola
 * comparación, y es justo la que decide si sale un correo: `"true"` exacto y nada más
 * —ni `"TRUE"`, ni `"1"`, ni `" true"`—. Un interruptor que se deja convencer por
 * variantes es un interruptor que un día está encendido sin que nadie lo haya encendido.
 */
export function esEnvioReal(valor: string | undefined | null): boolean {
  return valor === "true";
}

// El logo tiene que ser una URL absoluta y pública: los clientes de correo no
// resuelven rutas relativas, no cargan `data:` (Gmail lo bloquea) y no saben
// pintar SVG. `public/logo-email.png` es el logo en negativo (para la cabecera verde)
// rasterizado a 410×120; se regenera desde `public/logo-redestina-negativo.svg`.
function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com").replace(/\/+$/, "");
}

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
  /** `true` si no se contactó con Resend (`RESEND_ENVIO_REAL` apagado). */
  simulado?: boolean;
}

// deno-lint-ignore no-explicit-any
type Cliente = any;

/**
 * Con qué se registra el envío en la base. Es OPCIONAL: sin esto, `sendEmail()` se
 * comporta exactamente como antes y no escribe nada.
 *
 * ⚠️ **No se guarda el asunto, y no es un olvido.** Dos correos del circuito llevan una
 *    credencial en el propio asunto —el código de 6 cifras de la firma asistida
 *    (`enlace-publico`, `accion: 'enviar_codi'`) y cualquier otro que se sume mañana—, y
 *    `documento_envios` la lee todo el equipo interno. Es el mismo motivo por el que
 *    `sendText()` tiene `bodyConsola` (§9): lo que se registra para diagnosticar no es lo
 *    que se manda. Con destinatario, propósito, estado y error ya se puede contestar la
 *    única pregunta que la deuda §12.25 plantea —«¿este correo salió o no?»— sin publicar
 *    nada más.
 */
export interface TrazaEnvio {
  /** Cliente con `service_role`: la tabla no tiene GRANT de escritura para nadie más. */
  supabase: Cliente;
  /** Para qué se escribió: `oferta`, `acces`, `recuperacio`, `document`, `recordatori`… */
  proposito: string;
  /** `documentos.id`, cuando el correo va por un documento emitido. */
  documentoId?: string | null;
  /** Objeto del dominio al que se refiere (`albaran`, `convenio`, `cierre_donante`…). */
  objetoTipo?: string | null;
  objetoId?: string | null;
  /** Qué Edge Function lo mandó, para poder filtrar por origen. */
  funcion?: string | null;
}

/**
 * Se apaga solo. La generalización de `documento_envios` (columnas `proposito`,
 * `objeto_tipo`, `objeto_id`, `funcion` y el estado `simulat`) viaja en una migración
 * aparte: mientras no esté aplicada, el primer intento falla con `42703`/`PGRST204`, se
 * avisa UNA vez por isolate y se deja de intentar. Así esto se puede desplegar antes o
 * después que la migración, en cualquier orden, sin llenar el log.
 */
let registroDisponible = true;

async function registrarEnvio(
  traza: TrazaEnvio,
  destinatario: string,
  r: EmailResult,
): Promise<void> {
  if (!registroDisponible) return;
  // deno-lint-ignore no-explicit-any
  const datos = r.data as any;
  const estado = !r.ok ? "error" : r.simulado ? "simulat" : "enviat";
  try {
    const { error } = await traza.supabase.from("documento_envios").insert({
      documento_id: traza.documentoId ?? null,
      objeto_tipo: traza.objetoTipo ?? null,
      objeto_id: traza.objetoId ?? null,
      proposito: traza.proposito,
      funcion: traza.funcion ?? null,
      destinatario,
      canal: "email",
      estado,
      proveedor_id: typeof datos?.id === "string" ? datos.id : null,
      error: r.ok ? null : String(datos?.error?.message ?? datos?.message ?? `HTTP ${r.status}`)
        .slice(0, 500),
      enviado_at: estado === "enviat" ? new Date().toISOString() : null,
    });
    if (!error) return;
    // `42P01` tabla, `42703` columna, `PGRST204` columna desconocida para PostgREST.
    if (["42P01", "42703", "PGRST204"].includes(String(error.code))) {
      registroDisponible = false;
      console.warn(
        "[resend] documento_envios todavía no admite el registro genérico de correos " +
          `(${error.code}): falta la migración. No se volverá a intentar en este isolate.`,
      );
      return;
    }
    console.warn("[resend] documento_envios insert:", error.message);
  } catch (err) {
    console.warn("[resend] registrarEnvio:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Manda un correo. **Nunca lanza.**
 *
 * `traza` es opcional: cuando viene, el resultado —salió, se simuló o falló— queda en
 * `documento_envios`, que es lo que hace que un fallo de correo deje de ser
 * indistinguible de un acierto desde el panel (deuda §12.25). El registro nunca cambia
 * el resultado: si la fila no se puede escribir, el correo ya se ha mandado igual.
 */
export async function sendEmail(payload: EmailPayload, traza?: TrazaEnvio): Promise<EmailResult> {
  const r = await enviarResend(payload);
  if (traza) await registrarEnvio(traza, payload.to, r);
  return r;
}

async function enviarResend(payload: EmailPayload): Promise<EmailResult> {
  if (!envioReal()) {
    // Modo simulado: no se contacta con Resend. El flujo de quien llama continúa como si
    // el correo hubiera salido —es lo que permite recorrer en local el camino feliz—, y
    // el `simulado: true` es lo que distingue una prueba de un envío de verdad.
    console.log(`[SIMULADO] no se envía correo a ${payload.to} (RESEND_ENVIO_REAL != true)`);
    return {
      ok: true,
      status: 200,
      data: { simulado: true, id: `sim-${crypto.randomUUID()}` },
      simulado: true,
    };
  }
  const clave = apiKey();
  if (!clave) {
    console.error("[resend] Falta RESEND_API_KEY: no se envía email.");
    return { ok: false, status: 500, data: { error: "email_no_configurado" } };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clave}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: remitente(),
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
  const APP_URL = appUrl();
  const LOGO_URL = `${APP_URL}/logo-email.png`;
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
