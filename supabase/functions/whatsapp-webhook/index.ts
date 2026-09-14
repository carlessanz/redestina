// Webhook de WhatsApp Cloud API (Meta).
// GET: verificación del webhook. POST: recepción de mensajes y estados.
// Se despliega con --no-verify-jwt: Meta no envía JWT; la autenticidad
// se valida con la firma X-Hub-Signature-256.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { sendText } from "../_shared/whatsapp.ts";
import { leerRespuesta, procesarIntake } from "../_shared/intake.ts";
import { procesarRespuestaOferta } from "../_shared/respuestas.ts";
import { esTelefonoTest, modoTestActivo, whatsappActivo } from "../_shared/gate.ts";

const encoder = new TextEncoder();

// Valida X-Hub-Signature-256: HMAC-SHA256 del cuerpo CRUDO con WHATSAPP_APP_SECRET.
async function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!secret || !header?.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const received = header.slice("sha256=".length);

  // Comparación en tiempo constante
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Asegura que el contacto existe ANTES de guardar el mensaje. Devuelve si lo consiguió.
 *
 * ⚠️ POR QUÉ NO BASTA EL `upsert` SUELTO DE ANTES (deuda §12.11). Hasta hoy, si el upsert
 * del contacto fallaba se escribía un `console.error` y se seguía insertando el mensaje:
 * quedaba un `wa_messages` sin contacto, en silencio y sin que nada lo notara. Con la FK
 * `wa_messages.contact_phone → wa_contacts.phone` declarada, ese mismo caso deja de ser un
 * huérfano callado y pasa a ser un `23503` que **pierde el mensaje entrante de un
 * productor**, que es peor que la deuda que la FK viene a cerrar. De ahí esto.
 *
 * TRES COSAS, Y NINGUNA ES LA OBVIA:
 *
 *   1. **Se reintenta**, porque el fallo realista de un insert de una fila es transitorio
 *      (un corte de red, un pico de la base). Un solo reintento con una pausa corta se
 *      come casi todo ese caso, y el webhook tiene que responder deprisa.
 *
 *   2. **Se comprueba si el contacto ESTÁ, que es distinto de si el upsert fue bien.** Lo
 *      más probable cuando la escritura falla es que la fila ya estuviera —el contacto se
 *      crea una vez y escribe muchas—, y ahí el mensaje se puede guardar perfectamente.
 *      Sin esta lectura, un fallo de escritura inocuo nos haría dar por perdido un
 *      entrante que no corría ningún peligro.
 *
 *   3. **No se devuelve 500 para que Meta reintente**, que es la respuesta de manual y
 *      aquí está descartada por dos motivos: el webhook responde siempre 200 tras validar
 *      la firma (§5), y un reenvío de Meta repite EL LOTE ENTERO — los mensajes no se
 *      duplicarían (el upsert va por `wa_message_id`) pero `procesarIntake()` sí volvería
 *      a correr sobre los que ya se atendieron, que no es idempotente: contestaría dos
 *      veces y avanzaría el formulario sin que nadie haya respondido nada.
 *
 * Si aun así no se puede: quien llama lo grita en el log con el mensaje entero, que es el
 * único rastro que queda cuando no hay dónde guardarlo.
 */
async function asegurarContacto(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  phone: string,
): Promise<boolean> {
  for (let intento = 1; intento <= 2; intento++) {
    const { error } = await supabase
      .from("wa_contacts")
      .upsert(
        { phone, name: null, opt_in: false },
        { onConflict: "phone", ignoreDuplicates: true },
      );
    if (!error) return true;
    console.error(
      `[webhook] wa_contacts upsert (intento ${intento}):`,
      error.code ?? "",
      error.message,
    );

    // ¿Está igualmente? Entonces el mensaje tiene dónde anclarse y no hay nada que hacer.
    const { data, error: errLectura } = await supabase
      .from("wa_contacts")
      .select("phone")
      .eq("phone", phone)
      .maybeSingle();
    if (!errLectura && data) return true;

    if (intento === 1) await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

Deno.serve(async (req) => {
  // GET: verificación del webhook por parte de Meta
  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    const mode = params.get("hub.mode");
    const token = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");

    if (mode === "subscribe" && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
      return new Response(challenge ?? "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // POST: la firma se calcula sobre el cuerpo CRUDO, leerlo antes de parsear
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";

  if (!(await verifySignature(rawBody, signature, appSecret))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // A partir de aquí responder siempre 200 para que Meta no reintente
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SB_SECRET_KEY")!,
    );

    const payload = JSON.parse(rawBody);

    // Una lectura por petición, no por mensaje: un lote de Meta puede traer varios.
    const waActivo = await whatsappActivo(supabase);

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};

        // El número POR EL QUE Meta nos entrega el mensaje. Es el mismo `phone_id`
        // con el que enviamos, así que si difiere del secreto WHATSAPP_PHONE_ID,
        // ese desajuste explica por sí solo que se reciba pero no se pueda enviar.
        // Se guarda en `raw._metadata` porque el 31-07-2026 se descartaba y hubo
        // que ir a preguntárselo a la Graph API para descartar esa hipótesis.
        const metadata = value.metadata ?? null;
        const phoneIdEntrega: string | null = metadata?.phone_number_id ?? null;
        const phoneIdPropio = Deno.env.get("WHATSAPP_PHONE_ID");
        if (phoneIdEntrega && phoneIdPropio && phoneIdEntrega !== phoneIdPropio) {
          console.error(
            `[webhook] phone_number_id distinto: Meta entrega por ${phoneIdEntrega} ` +
              `pero enviamos por ${phoneIdPropio}. Actualiza el secreto WHATSAPP_PHONE_ID.`,
          );
        }

        // Mensajes entrantes
        for (const message of value.messages ?? []) {
          const from: string = message.from;
          // El cuerpo legible: el texto, o el título de la opción pulsada si la
          // respuesta es interactiva (botón o lista del intake).
          const { texto: cuerpo } = leerRespuesta(message);

          // Crear el contacto si no existe (sin tocar los existentes). Va delante porque
          // es el ANCLA del mensaje: `wa_messages.contact_phone` apunta aquí, y sin esta
          // fila el entrante no se puede guardar. El detalle, en `asegurarContacto`.
          const contactoOk = await asegurarContacto(supabase, from);

          // Upsert, no insert: Meta reintenta las entregas y el mismo wa_message_id
          // puede llegar más de una vez (índice único en wa_message_id).
          const { error: messageError } = await supabase.from("wa_messages").upsert(
            {
              wa_message_id: message.id,
              contact_phone: from,
              direction: "inbound",
              type: message.type ?? null,
              body: cuerpo,
              status: "received",
              // `_metadata` con guion bajo para no confundirlo con los campos que
              // Meta pone dentro del propio `message`.
              raw: metadata ? { ...message, _metadata: metadata } : message,
            },
            { onConflict: "wa_message_id", ignoreDuplicates: true },
          );
          if (messageError) {
            // AQUÍ es donde se perdería un entrante, así que aquí se grita. Un
            // `console.error` con el mensaje de PostgREST no permitía recuperar nada: sin
            // el cuerpo, un aviso de que «algo llegó» no sirve para atender a nadie.
            //
            // ⚠️ Sí, esto escribe el teléfono y el texto del mensaje en el log, y es la
            // única vez que esta función lo hace. Es proporcionado por una razón concreta:
            // **el destino natural de ese contenido era `wa_messages`**, que lee cualquier
            // miembro del equipo desde Mensajería, así que esto no amplía quién lo puede
            // ver — solo dónde queda cuando el insert falla. Y hay una diferencia a favor:
            // los logs caducan con el resto de los logs, mientras que `wa_messages` se
            // guarda para siempre. Del cuerpo van los primeros 200 caracteres: basta para
            // reconocer el mensaje y volver a pedirlo, que es para lo que sirve.
            const CUERPO_MAX = 200;
            console.error(JSON.stringify({
              fn: "whatsapp-webhook",
              alerta: "entrante_no_guardado",
              contacto_ok: contactoOk,
              codigo: messageError.code ?? null,
              detalle: messageError.message,
              wa_message_id: message.id,
              from,
              type: message.type ?? null,
              cuerpo: cuerpo ? cuerpo.slice(0, CUERPO_MAX) : null,
              truncado: (cuerpo?.length ?? 0) > CUERPO_MAX,
            }));
          } else if (!contactoOk) {
            // El mensaje sí se guardó pero su contacto no existe: es el huérfano de la
            // deuda §12.11, y mientras la FK no esté declarada sigue siendo posible.
            console.error(JSON.stringify({
              fn: "whatsapp-webhook",
              alerta: "entrante_sin_contacto",
              wa_message_id: message.id,
              from,
            }));
          }

          // Abre/renueva la ventana de servicio de 24 h para este contacto.
          const { error: windowError } = await supabase
            .from("wa_contacts")
            .update({ last_inbound_at: new Date().toISOString() })
            .eq("phone", from);
          if (windowError) console.error("last_inbound_at update:", windowError.message);

          // Interruptor global de WhatsApp (§8). Va DESPUÉS de registrar el mensaje y de
          // abrir la ventana de 24 h —el entrante existió y queda en la consola para que
          // una persona lo atienda por correo— y ANTES de cualquier respuesta: apagado no
          // se contesta nada, ni ALTA/BAJA, ni el diálogo de oferta, ni el intake.
          if (!waActivo) continue;

          // Gate "modo test" (§8): si el modo test global (app_settings.test_mode)
          // está activo —lo está por defecto—, el mensaje entrante queda registrado y
          // abre la ventana, pero NO respondemos (ALTA/BAJA, respuesta a oferta ni
          // intake) salvo que el número sea de un productor/entidad marcado es_test.
          // Con el modo test apagado se responde a todos. El mensaje se queda igual en
          // la consola para que lo atienda una persona.
          if ((await modoTestActivo(supabase)) && !(await esTelefonoTest(supabase, from))) continue;

          // Palabras clave de opt-in / opt-out. Ambas se confirman por mensaje:
          // estamos dentro de la ventana de servicio, así que es gratis y no
          // requiere plantilla.
          const keyword = cuerpo?.trim().toUpperCase();
          if (keyword === "BAJA") {
            const { error } = await supabase
              .from("wa_contacts")
              .update({ opt_in: false, opt_out_at: new Date().toISOString() })
              .eq("phone", from);
            if (error) console.error("opt-out update:", error.message);
            await sendText(
              supabase,
              from,
              "Has estat donat de baixa de les notificacions. " +
                "Escriu ALTA si vols tornar a rebre-les.",
            );
            continue;
          }
          if (keyword === "ALTA") {
            const { error } = await supabase
              .from("wa_contacts")
              .update({ opt_in: true, opt_in_at: new Date().toISOString() })
              .eq("phone", from);
            if (error) console.error("opt-in update:", error.message);
            await sendText(
              supabase,
              from,
              "Alta confirmada. Escriu BAJA per deixar de rebre notificacions.",
            );
            continue;
          }

          // Respuesta de una entidad a una oferta (sí/no). Tiene PRIORIDAD sobre
          // el intake: si el número tiene una oferta pendiente y contesta, se
          // atiende aquí. Así se resuelve el doble rol (un productor que también
          // es entidad y responde a una oferta no cae en el formulario de intake).
          try {
            if (await procesarRespuestaOferta(supabase, from, message)) continue;
          } catch (err) {
            console.error(
              "respuesta-oferta:",
              err instanceof Error ? err.message : String(err),
            );
          }

          // Intake conversacional: solo responde si el teléfono es de un
          // productor registrado. Con cualquier otro contacto no hace nada y el
          // mensaje se queda en la consola para que lo atienda una persona.
          try {
            await procesarIntake(supabase, from, message);
          } catch (err) {
            console.error(
              "intake:",
              err instanceof Error ? err.message : String(err),
            );
          }
        }

        // Estados de mensajes salientes (sent/delivered/read/failed)
        for (const status of value.statuses ?? []) {
          const { error } = await supabase
            .from("wa_messages")
            .update({ status: status.status })
            .eq("wa_message_id", status.id);
          if (error) console.error("status update:", error.message);
        }
      }
    }
  } catch (err) {
    console.error(
      "Error procesando webhook:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return new Response("OK", { status: 200 });
});
