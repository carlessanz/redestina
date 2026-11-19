// «Envia per correu» del albarán (04-11-2026): el PDF a cada parte y, si a esa parte todavía
// le falta confirmar, el enlace para confirmar los kilos.
//
//   POST /enviar-albara  { albaran_id, manual? }          (JWT de una cuenta del equipo)
//   -> 200 { resultats: [{ rol, destinatari, resultat, amb_enllac }] }
//          resultat: enviat · enviat_sense_adjunt · simulat · desactivat · no_test_user ·
//                    fora_llista_test · error
//   -> 409 { code: 'albara_no_emes' | 'sense_fitxer' | 'sense_destinatari' }
//   -> 429 { code: 'enviat_fa_poc' }       ya salió hace menos de 2 minutos
//
// Es un envío MANUAL (§8, `_shared/enviamentManual.ts`): con las notificaciones apagadas sale
// si el botón manda `manual: true`, que es lo que hace cuando quien pulsa lo acepta. El modo
// test y la lista blanca siguen mandando; desde el 19-11-2026, también la barrera de los
// documentos de PRUEBA (`destinatariosPrueba()`: un albarán `modo='prueba'` solo va a fichas
// `es_test` o al buzón del equipo, aunque el modo test esté apagado; sale como `no_test_user`).
// Lo automático no pasa por aquí: el correo tras validar una recogida declarada por la entidad
// lo manda `generar-documento` con el mismo bucle (`_shared/envia-albara.ts`).
//
// Los datos —documento vigente, destinatarios y enlaces nuevos— los prepara
// `preparar_enviament_albara()` (solo `service_role`), con la misma regla de destinatarios que
// `marcar_entregado()`. El token en claro solo existe en esta función, como allí en el cliente.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { exigirEquipo } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { type AlbaraPreparat, enviaAlbaraAParts } from "../_shared/envia-albara.ts";
import { preflight, respondedor } from "../_shared/http.ts";

const BUCKET = "documentos";
const MIN_ENTRE_ENVIAMENTS_MS = 2 * 60 * 1000;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SECRET_KEY")!);

  const auth = await exigirEquipo(supabase, req);
  if ("rechazo" in auth) {
    return responder({ error: auth.rechazo.error, code: auth.rechazo.code }, auth.rechazo.status);
  }

  let albaranId = "";
  let manual = false;
  try {
    const cos = await req.json();
    albaranId = typeof cos?.albaran_id === "string" ? cos.albaran_id : "";
    manual = cos?.manual === true;
  } catch {
    return responder({ error: "Cuerpo JSON inválido", code: "cos_invalid" }, 400);
  }
  if (!RE_UUID.test(albaranId)) return responder({ error: "Falta 'albaran_id'", code: "falta_id" }, 400);

  // Freno del doble clic ANTES de acuñar enlaces: un segundo clic no revoca los del primero.
  const desde = new Date(Date.now() - MIN_ENTRE_ENVIAMENTS_MS).toISOString();
  const { count } = await supabase
    .from("documento_envios")
    .select("id", { count: "exact", head: true })
    .eq("objeto_tipo", "albaran").eq("objeto_id", albaranId).eq("proposito", "albara")
    .in("estado", ["enviat", "simulat"])
    .gte("created_at", desde);
  if ((count ?? 0) > 0) {
    return responder({ error: "S'ha enviat fa menys de dos minuts", code: "enviat_fa_poc" }, 429);
  }

  // Antes de acuñar: sin PDF no hay nada que mandar (lectura sin efectos).
  const { data: docVig } = await supabase
    .from("documentos").select("estado, ruta, fichero_at")
    .eq("objeto_tipo", "albaran").eq("objeto_id", albaranId).eq("vigente", true).maybeSingle();
  if (!docVig || docVig.estado !== "emitido" || !docVig.ruta || !docVig.fichero_at) {
    return responder({ error: "El PDF encara no s'ha generat", code: "sense_fitxer" }, 409);
  }

  const { data, error } = await supabase.rpc("preparar_enviament_albara", {
    p_albaran: albaranId, p_per: auth.ctx.userId,
  });
  if (error) {
    const missatge = (error.message ?? "").trim();
    if (missatge === "albara_no_emes") return responder({ error: missatge, code: missatge }, 409);
    if (missatge === "albara_desconegut") return responder({ error: missatge, code: "no_existeix" }, 404);
    console.error("enviar-albara: rpc:", missatge);
    return responder({ error: "Error preparant l'enviament", code: "error_bd" }, 500);
  }
  const p = data as AlbaraPreparat;
  if (!p.document?.ruta) return responder({ error: "El PDF encara no s'ha generat", code: "sense_fitxer" }, 409);
  if (p.destinataris.length === 0) {
    return responder({ error: "Cap part té correu", code: "sense_destinatari" }, 409);
  }

  const { data: fitxer, error: errFitxer } = await supabase.storage.from(BUCKET).download(p.document.ruta);
  if (errFitxer || !fitxer) {
    console.error("enviar-albara: download:", errFitxer?.message ?? "sin fichero");
    return responder({ error: "No s'ha pogut llegir el PDF", code: "error_storage" }, 500);
  }
  const bytes = new Uint8Array(await fitxer.arrayBuffer());

  // El bucle de envío vive en `_shared/envia-albara.ts` (19-11-2026): lo comparte con el envío
  // automático de `generar-documento`, para que los dos pasen por las mismas barreras.
  const resultats = await enviaAlbaraAParts(supabase, {
    albaranId, preparat: p, bytes, documentoId: p.document.id, modo: p.document.modo,
    funcion: "enviar-albara", manual,
  });

  console.log(JSON.stringify({
    fn: "enviar-albara", albaran: albaranId, per: auth.ctx.userId, manual,
    resultats: resultats.map((r) => `${r.rol}:${r.resultat}`),
  }));
  return responder({ resultats }, 200);
});
