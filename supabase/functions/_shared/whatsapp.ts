// Envío de mensajes por la Cloud API de Meta, compartido entre las Edge Functions.
//
// Aquí solo vive la llamada a la Graph API y el registro del saliente. Las reglas
// de negocio (ventana de 24 h, opt-in) son de quien llama: `whatsapp-send` las
// aplica antes, y el intake del webhook trabaja siempre dentro de la ventana
// porque responde a un mensaje que acaba de llegar.

// Los dos secretos se leen DENTRO de una funcion, no en el cuerpo del modulo.
//
// Escrito como `const API_VERSION = Deno.env.get(...)` a nivel de modulo, cualquier `import`
// desde Node moria con `ReferenceError: Deno is not defined` **antes de ejecutar nada**. Y eso
// no era teorico: arrastraba consigo a `oferta.ts`, `intake.ts` y `respuestas.ts`, que importan
// este fichero, y con ellos a `parseDisponibleFins` (deuda 4) y a la heuristica si/no
// (deuda 14) -- justo los dos sitios que el propio documento senala como fragiles y que no se
// podian probar. Leyendolos dentro, el modulo se importa desde Vitest y esas funciones entran
// en el arnes de pruebas.
//
// No cambia el comportamiento en Deno: el entorno del isolate no cambia durante su vida, asi
// que da igual cuando se pregunte.
function apiVersion(): string {
  return Deno.env.get("WHATSAPP_API_VERSION") ?? "v23.0";
}

// Modo prueba de concepto: mientras esto no sea exactamente "true", NO se envía
// nada por WhatsApp. Es seguro por omisión: si el secreto no está configurado,
// no sale ningún mensaje. Los salientes se registran igualmente en wa_messages
// con status='simulat' para verlos en la consola. Se activa el envío real
// poniendo WHATSAPP_ENVIO_REAL=true en los secretos, sin tocar código.
function envioReal(): boolean {
  return Deno.env.get("WHATSAPP_ENVIO_REAL") === "true";
}

// WhatsApp acepta como máximo 3 botones y 10 filas por lista interactiva.
export const MAX_BOTONES = 3;
export const MAX_FILAS_LISTA = 10;

export interface Boton {
  id: string;
  titulo: string;
}

export interface FilaLista {
  id: string;
  titulo: string;
  descripcion?: string;
}

export interface RespuestaMeta {
  ok: boolean;
  /** Código HTTP de Meta, para poder reenviarlo tal cual al cliente. */
  status: number;
  waMessageId: string | null;
  data: unknown;
  /** true si no se contactó con Meta (modo prueba de concepto). */
  simulado?: boolean;
}

async function enviar(payload: Record<string, unknown>): Promise<RespuestaMeta> {
  if (!envioReal()) {
    // Modo PoC: no se contacta con Meta. Se devuelve una respuesta simulada para
    // que el flujo (intake, panel) continúe con normalidad.
    // deno-lint-ignore no-explicit-any
    const to = (payload as any)?.to ?? "?";
    console.log(`[SIMULADO] no se envía a ${to} (WHATSAPP_ENVIO_REAL != true)`);
    return {
      ok: true,
      status: 200,
      waMessageId: `sim-${crypto.randomUUID()}`,
      data: { simulado: true },
      simulado: true,
    };
  }
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  const res = await fetch(
    `https://graph.facebook.com/${apiVersion()}/${phoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("Graph API:", JSON.stringify(data));
    return { ok: false, status: res.status, waMessageId: null, data };
  }
  return {
    ok: true,
    status: res.status,
    // deno-lint-ignore no-explicit-any
    waMessageId: (data as any)?.messages?.[0]?.id ?? null,
    data,
  };
}

/** Deja constancia del saliente para que aparezca en la conversación de la consola. */
export async function registrarSaliente(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  tipo: string,
  body: string | null,
  waMessageId: string | null,
  raw?: unknown,
): Promise<void> {
  // Los mensajes simulados llevan un id "sim-…" (los reales, el wamid de Meta):
  // se distinguen en la consola con status 'simulat'.
  const simulado = waMessageId?.startsWith("sim-") ?? false;
  const { error } = await supabase.from("wa_messages").upsert(
    {
      wa_message_id: waMessageId,
      contact_phone: to,
      direction: "outbound",
      type: tipo,
      body,
      status: simulado ? "simulat" : "sent",
      ...(raw === undefined ? {} : { raw }),
    },
    { onConflict: "wa_message_id", ignoreDuplicates: true },
  );
  if (error) console.error("registrarSaliente:", error.message);
}

/**
 * Deja constancia de un envío que Meta RECHAZÓ.
 *
 * Hasta el 31-07-2026 un fallo de Meta no dejaba ningún rastro: los `sendX` solo
 * registraban `if (r.ok)`. El día que Meta empezó a rechazar los envíos, en la
 * consola no se veía nada — ni un mensaje, ni un aviso—, así que desde el panel
 * era indistinguible de "no ha pasado nada", y el equipo no tenía forma de saber
 * que había un problema ni cuál. Ahora la fila aparece en el hilo con
 * `status='error'` y el motivo de Meta en `raw`.
 *
 * El `wa_message_id` es sintético (`err-…`) porque Meta no devuelve wamid cuando
 * rechaza, y la columna es UNIQUE: sin un valor propio, dos fallos chocarían.
 */
export async function registrarFallo(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  tipo: string,
  body: string | null,
  r: RespuestaMeta,
): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const err = (r.data as any)?.error ?? {};
  const motivo = err.message ?? `HTTP ${r.status}`;
  const { error } = await supabase.from("wa_messages").insert({
    wa_message_id: `err-${crypto.randomUUID()}`,
    contact_phone: to,
    direction: "outbound",
    type: tipo,
    body,
    status: "error",
    raw: { error: err, http_status: r.status, motivo },
  });
  if (error) console.error("registrarFallo:", error.message);
}

export async function sendText(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  body: string,
  /**
   * Qué se guarda en la consola en lugar del cuerpo real. Se usa para los códigos de
   * acceso: `wa_messages` lo lee cualquier miembro del equipo desde Mensajería, así que
   * un código enviado tal cual quedaría publicado ahí.
   */
  opciones?: { bodyConsola?: string },
): Promise<RespuestaMeta> {
  const r = await enviar({ to, type: "text", text: { body, preview_url: false } });
  const cuerpo = opciones?.bodyConsola ?? body;
  if (r.ok) await registrarSaliente(supabase, to, "text", cuerpo, r.waMessageId, r.data);
  else await registrarFallo(supabase, to, "text", cuerpo, r);
  return r;
}

// Texto legible de las plantillas para la CONSOLA (el destinatario recibe el
// contenido real que renderiza Meta; aquí solo dejamos algo entendible en el hilo,
// no el nombre "crudo" de la plantilla).
const TEXTO_PLANTILLA: Record<string, string> = {
  hello_world: "Hello world! (plantilla de Meta, només en anglès al número de prova)",
};

export async function sendTemplate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  nombre: string,
  idioma: string,
  components: unknown[] = [],
): Promise<RespuestaMeta> {
  const r = await enviar({
    to,
    type: "template",
    template: { name: nombre, language: { code: idioma }, components },
  });
  const bodyConsola = TEXTO_PLANTILLA[nombre] ?? `[plantilla: ${nombre}]`;
  if (r.ok) await registrarSaliente(supabase, to, "template", bodyConsola, r.waMessageId, r.data);
  else await registrarFallo(supabase, to, "template", bodyConsola, r);
  return r;
}

/** Pregunta con hasta 3 botones. */
export async function sendBotones(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  texto: string,
  botones: Boton[],
): Promise<RespuestaMeta> {
  const r = await enviar({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: texto },
      action: {
        buttons: botones.slice(0, MAX_BOTONES).map((b) => ({
          type: "reply",
          // Meta limita el título del botón a 20 caracteres.
          reply: { id: b.id, title: b.titulo.slice(0, 20) },
        })),
      },
    },
  });
  if (r.ok) await registrarSaliente(supabase, to, "interactive", texto, r.waMessageId);
  else await registrarFallo(supabase, to, "interactive", texto, r);
  return r;
}

/** Pregunta con lista desplegable, hasta 10 filas. */
export async function sendLista(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  to: string,
  texto: string,
  etiquetaBoton: string,
  filas: FilaLista[],
): Promise<RespuestaMeta> {
  const r = await enviar({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: texto },
      action: {
        // El botón que abre la lista admite 20 caracteres.
        button: etiquetaBoton.slice(0, 20),
        sections: [{
          rows: filas.slice(0, MAX_FILAS_LISTA).map((f) => ({
            id: f.id,
            // Meta limita el título de fila a 24 caracteres y la descripción a 72.
            title: f.titulo.slice(0, 24),
            ...(f.descripcion ? { description: f.descripcion.slice(0, 72) } : {}),
          })),
        }],
      },
    },
  });
  if (r.ok) await registrarSaliente(supabase, to, "interactive", texto, r.waMessageId);
  else await registrarFallo(supabase, to, "interactive", texto, r);
  return r;
}
