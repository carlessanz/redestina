// Reenviar por correo un documento ya emitido (28-09-2026).
//
//   POST /reenviar-documento  { documento_id }          (JWT de una cuenta del equipo)
//   -> 200 { resultat: 'enviat' | 'enviat_sense_adjunt' | 'simulat', destinatari }
//   -> 409 { code: 'no_s_envia' | 'bloquejat_prova' | 'bloquejat_mode_test' | 'fora_llista_test' }
//   -> 409 { code: 'sense_fitxer' }        el PDF todavía no se ha generado
//   -> 429 { code: 'enviat_fa_poc' }       ya salió hace menos de 2 minutos
//
// `generar-documento` manda el documento UNA vez, al generar el PDF. Si ese correo falla
// —o la persona lo borró, o el documento es anterior al envío automático— esto es la
// segunda oportunidad. Tres cosas que no cambian respecto del envío original, y a propósito:
//
// · **El destinatario es el de `documentos.envio`, no uno que llegue en la petición.** Un
//   campo libre convertiría el botón en «manda este certificado fiscal a cualquier correo».
//   Si la dirección está mal, se corrige la ficha y se emite de nuevo.
// · **Las barreras son las mismas** (modo prueba, modo test y lista blanca): el envío vive
//   en `_shared/envia-document.ts` y las dos funciones lo llaman.
// · **Se manda el PDF que hay en el bucket**, el mismo que se descarga, sin volver a
//   renderizarlo: un documento emitido es inmutable.
//
// Solo el equipo (`exigirEquipo`): el externo ya tiene el documento en su panel.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { exigirEquipo } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { type DocumentAEnviar, enviaDocument } from "../_shared/envia-document.ts";
import { preflight, respondedor } from "../_shared/http.ts";

const BUCKET = "documentos";
/** Un doble clic no manda dos correos: si salió hace menos que esto, se rechaza. */
const MIN_ENTRE_ENVIAMENTS_MS = 2 * 60 * 1000;

interface Fila extends DocumentAEnviar {
  ruta: string | null;
  estado: string;
  fichero_at: string | null;
}

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const auth = await exigirEquipo(supabase, req);
  if ("rechazo" in auth) {
    return responder({ error: auth.rechazo.error, code: auth.rechazo.code }, auth.rechazo.status);
  }

  let documentoId: string | null = null;
  try {
    const cuerpo = await req.json();
    documentoId = typeof cuerpo?.documento_id === "string" ? cuerpo.documento_id : null;
  } catch {
    return responder({ error: "Cuerpo JSON inválido", code: "cos_invalid" }, 400);
  }
  if (!documentoId) return responder({ error: "Falta 'documento_id'", code: "falta_id" }, 400);

  const { data, error } = await supabase
    .from("documentos")
    .select("id, tipo, subtipo, objeto_tipo, objeto_id, numero_completo, ejercicio, idioma, modo, envio, ruta, estado, fichero_at")
    .eq("id", documentoId)
    .maybeSingle();
  if (error) {
    console.error("reenviar-documento: select:", error.message);
    return responder({ error: "Error consultando el documento", code: "error_bd" }, 500);
  }
  const doc = data as Fila | null;
  if (!doc) return responder({ error: "Documento inexistente", code: "no_existeix" }, 404);
  if (doc.estado !== "emitido" || !doc.ruta || !doc.fichero_at) {
    return responder({ error: "El PDF encara no s'ha generat", code: "sense_fitxer" }, 409);
  }

  // Freno del doble clic. Cuenta solo lo que SALIÓ: un error reciente no impide reintentar.
  const desde = new Date(Date.now() - MIN_ENTRE_ENVIAMENTS_MS).toISOString();
  const { count } = await supabase
    .from("documento_envios")
    .select("id", { count: "exact", head: true })
    .eq("documento_id", doc.id)
    .in("estado", ["enviat", "simulat"])
    .gte("created_at", desde);
  if ((count ?? 0) > 0) {
    return responder({ error: "S'ha enviat fa menys de dos minuts", code: "enviat_fa_poc" }, 429);
  }

  const { data: fitxer, error: errFitxer } = await supabase.storage.from(BUCKET).download(doc.ruta);
  if (errFitxer || !fitxer) {
    console.error("reenviar-documento: download:", errFitxer?.message ?? "sin fichero");
    return responder({ error: "No s'ha pogut llegir el PDF", code: "error_storage" }, 500);
  }
  const bytes = new Uint8Array(await fitxer.arrayBuffer());

  const resultat = await enviaDocument(supabase, doc, bytes, "reenviar-documento");
  const destinatari = typeof doc.envio?.destinatario === "string" ? doc.envio.destinatario : null;
  console.log(JSON.stringify({ fn: "reenviar-documento", documento: doc.id, per: auth.ctx.userId, resultat }));

  if (resultat === "enviat" || resultat === "enviat_sense_adjunt" || resultat === "simulat") {
    return responder({ resultat, destinatari }, 200);
  }
  if (resultat === "error") {
    return responder({ error: "El correu no ha sortit", code: "error_envio" }, 502);
  }
  return responder({ error: "Aquest document no es pot enviar", code: resultat, destinatari }, 409);
});
