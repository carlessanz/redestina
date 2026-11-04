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
// test y la lista blanca siguen mandando. Lo automático (el PDF al generarse, el correo de
// «Marcar entregat») no pasa por aquí.
//
// Los datos —documento vigente, destinatarios y enlaces nuevos— los prepara
// `preparar_enviament_albara()` (solo `service_role`), con la misma regla de destinatarios que
// `marcar_entregado()`. El token en claro solo existe en esta función, como allí en el cliente.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { exigirEquipo } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { composaCorreuAlbara } from "../_shared/correu-albara.ts";
import { encodeBase64, MAX_ADJUNT_BYTES } from "../_shared/envia-document.ts";
import { bustiaEquip, enLlistaCorreuTest } from "../_shared/gate.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { plantillaEmail, sendEmail } from "../_shared/resend.ts";

const BUCKET = "documentos";
const MIN_ENTRE_ENVIAMENTS_MS = 2 * 60 * 1000;
const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com").replace(/\/$/, "");
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Preparat {
  numero: string | null;
  tipo: string;
  estado: string;
  idioma: string | null;
  document: { id: string; ruta: string | null; estado: string; fichero_at: string | null; modo: string } | null;
  destinataris: { rol: string; email: string; nom: string | null; token: string | null }[];
}

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
  const p = data as Preparat;
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
  const adjunt = bytes.length <= MAX_ADJUNT_BYTES;
  const replyTo = await bustiaEquip(supabase);

  const resultats: { rol: string; destinatari: string; resultat: string; amb_enllac: boolean }[] = [];
  for (const d of p.destinataris) {
    const ambEnllac = d.token !== null;
    if (!(await enLlistaCorreuTest(supabase, d.email))) {
      resultats.push({ rol: d.rol, destinatari: d.email, resultat: "fora_llista_test", amb_enllac: ambEnllac });
      continue;
    }
    const c = composaCorreuAlbara({
      tipo: p.tipo, numero: p.numero, idioma: p.idioma, rol: d.rol, nom: d.nom,
      urlConfirmar: d.token ? `${APP_URL}/confirmar/${d.token}` : null,
      urlPanell: `${APP_URL}/login`,
    });
    const r = await sendEmail({
      to: d.email,
      subject: c.assumpte,
      html: plantillaEmail({
        titulo: c.titol, preheader: c.preheader, cuerpoHtml: c.cosHtml,
        boton: c.boto, nota: c.nota, idioma: c.idioma,
      }),
      replyTo,
      ...(adjunt ? { attachments: [{ filename: c.fitxer, content: encodeBase64(bytes) }] } : {}),
    }, {
      supabase, proposito: "albara", documentoId: p.document.id,
      objetoTipo: "albaran", objetoId: albaranId, funcion: "enviar-albara",
    }, { manual });
    const tall = (r.data as { code?: string } | null)?.code;
    const resultat = r.desactivado
      ? (tall === "no_test_user" ? "no_test_user" : "desactivat")
      : !r.ok ? "error" : r.simulado ? "simulat" : adjunt ? "enviat" : "enviat_sense_adjunt";
    resultats.push({ rol: d.rol, destinatari: d.email, resultat, amb_enllac: ambEnllac });
  }

  console.log(JSON.stringify({
    fn: "enviar-albara", albaran: albaranId, per: auth.ctx.userId, manual,
    resultats: resultats.map((r) => `${r.rol}:${r.resultat}`),
  }));
  return responder({ resultats }, 200);
});
