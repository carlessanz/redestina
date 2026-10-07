// Enlace público: confirmar un albarán sin tener cuenta (§B y fase 3 del plan).
//
//   GET  /enlace-publico?t=<token>                    -> lo que hay que revisar
//   POST /enlace-publico  { t, accion: 'confirmar', … } -> lo que se responde
//
// Se despliega con `verify_jwt = false` porque quien la usa **no tiene ni tendrá cuenta
// en Redestina**: es la persona de la entidad receptora que abre un correo desde el móvil,
// mira los kilos que le hemos apuntado y dice sí, o dice que faltaban diez.
//
// LO QUE LA PROTEGE ES EL TOKEN, y nada más. 32 bytes aleatorios de los que en la base
// solo vive el sha256 (20260928100300): un volcado de `enlaces_token` no abre ninguno.
// Aquí se hashea lo que llega por la URL y se pregunta a `resolver_enlace()`, que es la
// única función que sabe casarlo, y que corre con `service_role` porque no hay sesión
// que ninguna política pueda mirar.
//
// LOS TRES ESTADOS QUE NO SON UN ERROR NUESTRO. Un enlace desconocido es **404**, uno ya
// usado **409** y uno caducado **410**. La distinción importa: quien recibe un 410 tiene
// que pedir otro enlace, quien recibe un 409 ya ha confirmado y no tiene que hacer nada.
// No hace falta traducirlos aquí en el POST: `registrar_confirmacion()` los levanta como
// SQLSTATE `PT404`/`PT409`/`PT410` y PostgREST los convierte en esos mismos códigos HTTP.
// En el GET sí se traducen, porque `resolver_enlace()` es una consulta y no levanta nada.
//
// LO QUE ESTA FUNCIÓN NO HACE: no crea enlaces (los crea la RPC que emite el documento),
// no revoca, no reenvía y no toca ningún dato del albarán por su cuenta. Todo lo que
// escribe pasa por `registrar_confirmacion()`, que valida el estado dentro de una
// transacción con la fila bloqueada. Aquí solo se comprueba el token, se registra la
// evidencia de apertura y se firma la URL del PDF.
//
// TRES PROPÓSITOS VIVOS, uno por fase: `confirmacion_albaran` (fase 3), `subida_factura`
// (fase 4, el donante adjunta su factura contra el resumen anual) y `firma_convenio`
// (fase 2, la organización firma su convenio con el dedo). El tercero añade dos acciones
// más —`enviar_codi` y `validar_codi`— que son el segundo factor de la firma asistida.
//
// ⚠️ La subida de factura acepta **multipart** además de JSON, así que el cuerpo del POST
//    ya no se puede leer con un `req.json()` incondicional: se mira antes el
//    `content-type`. Es la única acción que trae un fichero.

// ⚠️ ESTE FICHERO SOLO ENRUTA (07-10-2026). Cada propósito vive en su módulo, sin un
//    cambio de lógica respecto a cuando todo estaba aquí:
//      · `comun.ts`    — token, estado del enlace, anti-abuso, URL firmada, base64
//      · `albaran.ts`  — `confirmacion_albaran`: acta, huella, confirmación y aviso
//      · `factura.ts`  — `subida_factura`
//      · `convenio.ts` — `firma_convenio`, con su segundo factor

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import {
  type Cliente,
  decodificarBase64,
  estadoAHttp,
  type FicheroSubido,
  ipDe,
  MAX_EVIDENCIES_HORA,
  massaIntentsIp,
  type Responder,
  resolver,
  textNet,
} from "./comun.ts";
import { confirmarAlbaran, getAlbaran } from "./albaran.ts";
import { getFactura, subirFactura } from "./factura.ts";
import { enviarCodi, firmarConvenio, getConvenio, validarCodi } from "./convenio.ts";

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const t0 = performance.now();
  const cors = corsPara(req, "GET, POST, OPTIONS");
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "GET" && req.method !== "POST") {
    return responder({ error: "Method Not Allowed" }, 405);
  }

  const ip = ipDe(req);
  if (massaIntentsIp(ip)) {
    return responder(
      { error: "Has fet massa intents. Torna-ho a provar d'aquí una estona.", code: "massa_solicituds" },
      429,
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  try {
    return req.method === "GET"
      ? await manejarGet(req, supabase, responder, ip, t0)
      : await manejarPost(req, supabase, responder, ip, t0);
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e);
    console.error("enlace-publico:", texto);
    return responder({ error: "Hi ha hagut un problema. Torna-ho a provar.", code: "error_intern" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET: qué hay que revisar
// ---------------------------------------------------------------------------
async function manejarGet(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  ip: string,
  t0: number,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!token || token.length < 20 || token.length > 200) {
    return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  }

  const enlace = await resolver(supabase, token);
  // Un token que no existe y uno mal formado dan la misma respuesta a propósito: no hay
  // nada que un atacante pueda aprender de la diferencia.
  if (!enlace) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);

  const malestado = estadoAHttp(enlace.estado_efectivo);
  if (malestado) {
    return responder({
      error: malestado.error,
      code: malestado.code,
      proposito: enlace.proposito,
      estado_efectivo: enlace.estado_efectivo,
    }, malestado.status);
  }

  // Fase 4: el enlace del cierre anual tiene su propia pantalla —no hay nada que
  // confirmar, hay una factura que subir— y por eso tiene su propia rama.
  if (enlace.proposito === "subida_factura") {
    return await getFactura(req, supabase, responder, enlace, ip, t0);
  }

  // Fase 2: la página de firma del convenio, que enseña el texto completo antes de firmar.
  if (enlace.proposito === "firma_convenio") {
    return await getConvenio(req, supabase, responder, enlace, ip, t0);
  }

  // Cualquier propósito que se añada a `enlaces_token` y todavía no tenga rama: se dice,
  // en vez de enseñar una pantalla vacía.
  if (enlace.proposito !== "confirmacion_albaran") {
    return responder({
      error: "Aquest enllaç encara no es pot obrir des d'aquí.",
      code: "proposit_no_implementat",
      proposito: enlace.proposito,
      estado_efectivo: enlace.estado_efectivo,
    }, 501);
  }

  return await getAlbaran(req, supabase, responder, enlace, ip, t0);
}

// ---------------------------------------------------------------------------
// POST: lo que se responde
// ---------------------------------------------------------------------------
async function manejarPost(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  ip: string,
  t0: number,
): Promise<Response> {
  // ⚠️ El cuerpo NO se puede leer siempre como JSON desde la fase 4: la subida de factura
  //    llega como `multipart/form-data`. Se mira el `content-type` primero y se normaliza
  //    todo a un objeto plano + (como mucho) un fichero, para que el resto de la función
  //    siga sin enterarse de cómo vino.
  const tipoContenido = (req.headers.get("content-type") ?? "").toLowerCase();
  let body: Record<string, unknown> = {};
  let fichero: FicheroSubido | null = null;

  if (tipoContenido.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return responder({ error: "Cos invàlid.", code: "cos_invalid" }, 400);
    }
    for (const [clave, valor] of form.entries()) {
      if (typeof valor === "string") {
        body[clave] = valor;
      } else if (valor instanceof File && !fichero) {
        fichero = {
          bytes: new Uint8Array(await valor.arrayBuffer()),
          mime: (valor.type || "").toLowerCase(),
          nombre: valor.name || "factura",
        };
      }
    }
    // Con fichero, la única acción posible es la de la factura: no hace falta que el
    // formulario la escriba.
    if (!body.accion && fichero) body.accion = "subir_factura";
  } else {
    body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const base64 = typeof body.fitxer_base64 === "string" ? body.fitxer_base64 : "";
    if (base64) {
      const { fichero: decodificado, error } = decodificarBase64(
        base64,
        textNet(body.mime),
      );
      if (!decodificado) {
        return responder({ error: "El fitxer no s'ha pogut llegir.", code: error ?? "cos_invalid" }, 400);
      }
      fichero = { ...decodificado, nombre: textNet(body.nom_fitxer) || decodificado.nombre };
    }
  }

  // Honeypot: 200 falso. Decirle a un bot que se le ha visto solo le enseña a esconderse.
  if (textNet(body.web)) {
    console.warn("[enlace-publico] honeypot relleno, descartado");
    return responder({ ok: true }, 200);
  }

  const token = textNet(body.t);
  if (!token) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);

  // Freno durable: no depende de qué isolate atienda la petición. Va ANTES de repartir
  // por acción porque todas las que escriben dejan una evidencia, y el tope es sobre
  // evidencias: si solo protegiera a `confirmar`, la subida de factura sería la puerta
  // abierta al lado del cerrojo.
  const { count } = await supabase
    .from("evidencias")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if ((count ?? 0) >= MAX_EVIDENCIES_HORA) {
    console.warn("[enlace-publico] freno global:", count, "evidencias en la ultima hora");
    return responder(
      { error: "Ara mateix no podem processar més peticions. Torna-ho a provar més tard.", code: "massa_solicituds" },
      429,
    );
  }

  const accion = textNet(body.accion) || "confirmar";
  // Las tres acciones de la fase 2 (convenios). `firmar` es la que escribe; las otras dos
  // son el segundo factor de la firma asistida (§3.2.5).
  if (accion === "firmar") {
    return await firmarConvenio(req, supabase, responder, body, ip, t0);
  }
  if (accion === "enviar_codi") {
    return await enviarCodi(supabase, responder, body, t0);
  }
  if (accion === "validar_codi") {
    return await validarCodi(supabase, responder, body, t0);
  }
  if (accion === "subir_factura") {
    return await subirFactura(req, supabase, responder, body, fichero, ip, t0);
  }
  if (accion !== "confirmar") {
    return responder({ error: "Acció desconeguda.", code: "accio_desconeguda", accion }, 400);
  }

  return await confirmarAlbaran(req, supabase, responder, body, token, ip, t0);
}
