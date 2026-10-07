// Envío de mensajes de WhatsApp vía Cloud API de Meta.
// Formatos aceptados (POST JSON):
//   { "to": "34...", "type": "text", "body": "Hola" }
//   { "to": "34...", "type": "template", "template": "hello_world", "language": "en_US", "components": [] }
//
// Requiere una sesión de Supabase Auth: se despliega SIN --no-verify-jwt, así que
// la plataforma valida la firma del JWT, y además aquí se comprueba que
// corresponde a un usuario real.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { sendBotones, sendTemplate, sendText } from "../_shared/whatsapp.ts";
import { esTelefonoTest, modoTestActivo, whatsappActivo } from "../_shared/gate.ts";
import { exigirEquipo } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";

// Ventana de servicio de WhatsApp: 24 h desde el último mensaje del contacto.
const WINDOW_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const cors = corsPara(req);
  // Closure para no repetir las cabeceras CORS en cada return.
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);

  if (req.method !== "POST") {
    return responder({ error: "Method Not Allowed" }, 405);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  // La plataforma ya ha validado la firma del JWT (verify_jwt). Aquí se comprueba que
  // detrás hay un usuario de verdad Y que es del equipo interno: enviar WhatsApp no es
  // algo que pueda hacer un productor o un receptor desde su panel. RLS no cubre esto,
  // porque la función corre con service_role (BYPASSRLS).
  const auth = await exigirEquipo(supabase, req);
  if ("rechazo" in auth) {
    const { error, code, status } = auth.rechazo;
    return responder({ error, code }, status);
  }

  try {
    const input = await req.json();
    const { to, type } = input;

    if (!to || typeof to !== "string") {
      return responder({ error: "Falta 'to' (teléfono E.164 sin +, ej. 34612345678)" }, 400);
    }
    if (type !== "text" && type !== "template" && type !== "botones") {
      return responder({ error: "'type' debe ser 'text', 'botones' o 'template'" }, 400);
    }
    if ((type === "text" || type === "botones") && (!input.body || typeof input.body !== "string")) {
      return responder({ error: "Falta 'body' para un mensaje de texto" }, 400);
    }
    // `botones` es texto libre con respuestas rápidas: mismas reglas de ventana que `text`
    // (lo decide la condición de más abajo), pero con la pregunta ya hecha. Existe porque
    // mandar una oferta en texto plano obligaba a la entidad a ADIVINAR que había que
    // contestar «Sí»: si escribía cualquier otra cosa, el webhook no la clasificaba y el
    // mensaje caía al intake, que le ofrecía publicar una oferta suya (§5).
    if (type === "botones") {
      const bs = input.botones;
      if (!Array.isArray(bs) || bs.length === 0 || bs.length > 3) {
        return responder({ error: "'botones' debe ser una lista de 1 a 3" }, 400);
      }
      if (!bs.every((b: unknown) =>
        typeof b === "object" && b !== null &&
        typeof (b as { id?: unknown }).id === "string" &&
        typeof (b as { titulo?: unknown }).titulo === "string"
      )) {
        return responder({ error: "Cada botón necesita 'id' y 'titulo'" }, 400);
      }
    }
    if (type === "template" && (!input.template || typeof input.template !== "string")) {
      return responder({ error: "Falta 'template' para un mensaje de plantilla" }, 400);
    }

    // Interruptor global de WhatsApp (§8). Va antes que los gates de destinatario: con
    // WhatsApp apagado da igual quién sea el destinatario, y el motivo que tiene que
    // llegar al panel es este y no un `no_test_user` que despistaría.
    if (!(await whatsappActivo(supabase))) {
      return responder(
        {
          error: "WhatsApp està desactivat des de Configuració.",
          code: "whatsapp_desactivat",
        },
        503,
      );
    }

    // Gate "modo test" (§8): si el modo test global (app_settings.test_mode) está
    // activo —lo está por defecto—, solo se envía a un número de un productor o
    // entidad marcado es_test. Fuente de verdad de la app, independiente de Meta. La
    // UI ya desactiva el botón; esto lo corta en el servidor aunque la UI fallara.
    if ((await modoTestActivo(supabase)) && !(await esTelefonoTest(supabase, to))) {
      return responder(
        {
          error: `${to} no es un usuario de prueba (es_test). Solo se envía a las ` +
            `fichas marcadas como usuario de prueba.`,
          code: "no_test_user",
        },
        403,
      );
    }

    // Gate de la lista de test de Meta. En el entorno de test la Cloud API solo
    // entrega a los ≤5 números dados de alta en Meta; los guardamos en
    // `meta_test_recipients`. Si la tabla tiene alguna fila, solo se envía a quien
    // esté en ella; si está vacía, no restringe (paso a producción sin límite de
    // 5). Defensa en profundidad: la UI ya desactiva el botón, esto lo corta en el
    // servidor aunque la UI fallara. Es independiente del interruptor
    // WHATSAPP_ENVIO_REAL: uno limita a QUIÉN se podría enviar, el otro si sale algo.
    const { data: enLista, error: listaError } = await supabase
      .from("meta_test_recipients")
      .select("phone")
      .eq("phone", to)
      .maybeSingle();
    if (listaError) {
      console.error("meta_test_recipients select:", listaError.message);
      return responder({ error: "Error consultando la lista de test de Meta" }, 500);
    }
    if (!enLista) {
      const { count, error: countError } = await supabase
        .from("meta_test_recipients")
        .select("phone", { count: "exact", head: true });
      if (countError) {
        console.error("meta_test_recipients count:", countError.message);
        return responder({ error: "Error consultando la lista de test de Meta" }, 500);
      }
      if ((count ?? 0) > 0) {
        return responder(
          {
            error:
              `${to} no está en la lista de números de prueba de Meta. En el entorno ` +
              `de test solo se puede enviar a los números dados de alta en Meta.`,
            code: "no_test_recipient",
          },
          403,
        );
      }
    }

    const { data: contact, error: contactError } = await supabase
      .from("wa_contacts")
      .select("phone, opt_in, opt_in_at, opt_out_at, last_inbound_at")
      .eq("phone", to)
      .maybeSingle();

    if (contactError) {
      console.error("wa_contacts select:", contactError.message);
      return responder({ error: "Error consultando el contacto" }, 500);
    }
    if (!contact) {
      return responder(
        { error: `El contacto ${to} no existe en wa_contacts`, code: "unknown_contact" },
        404,
      );
    }

    // Quien escribió BAIXA no recibe NADA más, tampoco texto dentro de la ventana: escribir
    // BAIXA la abre, y sin esto la siguiente oferta con botones le habría llegado igual.
    // Vale hasta que vuelva a escribir ALTA (opt_in_at posterior a opt_out_at).
    if (
      contact.opt_out_at &&
      (!contact.opt_in_at || new Date(contact.opt_out_at) > new Date(contact.opt_in_at))
    ) {
      return responder(
        { error: `${to} s'ha donat de baixa dels missatges de WhatsApp`, code: "opt_out" },
        403,
      );
    }

    // Reglas de envío (decisión D1 del manual): el texto libre es una respuesta de
    // servicio y solo cabe con la ventana abierta; la plantilla la iniciamos nosotros
    // y por eso exige consentimiento.
    if (type === "text" || type === "botones") {
      const lastInbound = contact.last_inbound_at
        ? new Date(contact.last_inbound_at).getTime()
        : 0;
      if (Date.now() - lastInbound > WINDOW_MS) {
        return responder(
          {
            error:
              `La ventana de 24 h con ${to} está cerrada. Solo se puede escribir texto ` +
              `libre después de que el contacto haya escrito; inicia con una plantilla.`,
            code: "window_closed",
          },
          409,
        );
      }
    } else if (!contact.opt_in) {
      return responder(
        {
          error: `El contacto ${to} no tiene opt-in; no se le puede enviar una plantilla`,
          code: "no_opt_in",
        },
        403,
      );
    }

    // La llamada a Meta y el registro del saliente viven en _shared/whatsapp.ts,
    // compartidos con el webhook. Aquí solo quedan las reglas de negocio.
    const r = type === "text"
      ? await sendText(supabase, to, input.body)
      : type === "botones"
      ? await sendBotones(supabase, to, input.body, input.botones)
      : await sendTemplate(
        supabase,
        to,
        input.template,
        input.language ?? "en_US",
        input.components ?? [],
      );

    // Si Meta devuelve error, reenviarlo tal cual al cliente para depurar.
    if (!r.ok) return responder(r.data, r.status);

    return responder(r.data, 200);
  } catch (err) {
    console.error(
      "Error en whatsapp-send:",
      err instanceof Error ? err.message : String(err),
    );
    return responder({ error: "Error interno o JSON inválido" }, 500);
  }
});
