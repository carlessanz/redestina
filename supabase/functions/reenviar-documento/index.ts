// Reenviar por correo un documento ya emitido (28-09-2026).
//
//   POST /reenviar-documento  { documento_id, manual?, amb_enllac_signatura? }  (JWT del equipo)
//
// `manual: true` (04-11-2026): el botón lo manda aunque las notificaciones estén apagadas,
// porque quien pulsa lo ha aceptado (§8, `_shared/enviamentManual.ts`). Sin él, como siempre.
//
// `amb_enllac_signatura: true` (05-11-2026, circuito de firma): si el documento se puede
// firmar (CD, CR, REC, ENT vigente y sin firma viva), acuña el enlace de firma por correo
// (`preparar_enviament_signatura`, 30 días; revoca el anterior de correo) y el correo invita
// a firmarlo en línea, con el botón a `/signar-document/<token>`. Con REC y ENT —que sin
// enlace no se mandan— el destinatario es el correo de la ficha que firma, el que devuelve
// la RPC. Si no se puede firmar (`ja_signat`, `no_signable`, `versio_substituida`,
// `usa_firma_conveni`, `sense_correu`), se manda SIN enlace (si el tipo se manda sin él) y
// la respuesta lo dice: `enllac_signatura: null` + `motiu_sense_enllac`.
//   -> 200 { resultat: 'enviat' | 'enviat_sense_adjunt' | 'simulat', destinatari,
//            enllac_signatura: { caduca_at } | null, motiu_sense_enllac? }
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
const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com").replace(/\/$/, "");
/** Los motivos de negocio por los que no se acuña el enlace (`preparar_enviament_signatura`). */
const MOTIUS_SENSE_ENLLAC = ["ja_signat", "no_signable", "versio_substituida", "usa_firma_conveni", "sense_correu"];
/** Un doble clic no manda dos correos: si salió hace menos que esto, se rechaza. */
const MIN_ENTRE_ENVIAMENTS_MS = 2 * 60 * 1000;

interface Fila extends DocumentAEnviar {
  /** El snapshot: el asunto del CD dice su ámbito y su periodo (`correu-document.ts`). */
  datos: Record<string, unknown> | null;
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
  let manual = false;
  let ambEnllac = false;
  try {
    const cuerpo = await req.json();
    documentoId = typeof cuerpo?.documento_id === "string" ? cuerpo.documento_id : null;
    manual = cuerpo?.manual === true;
    ambEnllac = cuerpo?.amb_enllac_signatura === true;
  } catch {
    return responder({ error: "Cuerpo JSON inválido", code: "cos_invalid" }, 400);
  }
  if (!documentoId) return responder({ error: "Falta 'documento_id'", code: "falta_id" }, 400);

  const { data, error } = await supabase
    .from("documentos")
    .select("id, tipo, subtipo, objeto_tipo, objeto_id, numero_completo, ejercicio, idioma, modo, envio, datos, ruta, estado, fichero_at")
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

  // Una versión `signat` (05-11-2026) nace sin `envio`: la firma no es un envío. Para poder
  // reenviarla, el destinatario es el de la versión que sustituyó (la que se firmó), que es
  // el mismo documento —mismo número y mismo código— ya firmado. Nunca uno de la petición.
  if (!doc.envio && doc.subtipo === "signat") {
    const { data: anterior } = await supabase
      .from("documentos")
      .select("id, envio")
      .eq("sustituido_por", doc.id)
      .maybeSingle();
    if (anterior?.envio) doc.envio = anterior.envio as Record<string, unknown>;
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

  // ------------------------------------------------- el enlace de firma (opcional)
  // DESPUÉS del freno y de tener el PDF: acuñar revoca el enlace de correo anterior, y
  // revocarlo para no mandar nada dejaría a la persona con un enlace muerto.
  let urlSignar: string | null = null;
  let enllac: { caduca_at: string | null } | null = null;
  let motiuSenseEnllac: string | null = null;
  let destinatariSignatura: { email: string; nom: string | null } | null = null;
  if (ambEnllac) {
    const envioDest = typeof doc.envio?.destinatario === "string" ? doc.envio.destinatario.trim() : "";
    const { data: prep, error: errPrep } = await supabase.rpc("preparar_enviament_signatura", {
      p_documento: doc.id,
      // El mismo correo al que va el documento; sin él (el albarán), el de la ficha.
      p_email: envioDest || null,
      p_per: auth.ctx.userId,
    });
    if (errPrep) {
      const m = String(errPrep.message ?? "").match(/^([a-z_]+):/);
      const pref = m ? m[1] : "";
      if (String(errPrep.code) === "22023" && MOTIUS_SENSE_ENLLAC.includes(pref)) {
        motiuSenseEnllac = pref;
      } else {
        console.error("reenviar-documento: preparar_enviament_signatura:", errPrep.code, errPrep.message);
        return responder({ error: "No s'ha pogut preparar l'enllaç de signatura", code: "error_bd" }, 500);
      }
    } else {
      const p = (prep ?? {}) as { token?: string; email?: string; nom?: string | null; caduca_at?: string };
      if (p.token) {
        // ⚠️ El token solo vive aquí y en el correo: nunca en el log ni en la respuesta.
        urlSignar = `${APP_URL}/signar-document/${encodeURIComponent(p.token)}`;
        enllac = { caduca_at: p.caduca_at ?? null };
        if (!envioDest && p.email) destinatariSignatura = { email: p.email, nom: p.nom ?? null };
      }
    }
  }

  const resultat = await enviaDocument(supabase, doc, bytes, "reenviar-documento", {
    manual,
    urlSignar,
    destinatari: destinatariSignatura,
  });
  const destinatari = destinatariSignatura?.email ??
    (typeof doc.envio?.destinatario === "string" ? doc.envio.destinatario : null);
  console.log(JSON.stringify({
    fn: "reenviar-documento",
    documento: doc.id,
    per: auth.ctx.userId,
    resultat,
    amb_enllac_signatura: urlSignar !== null,
    motiu_sense_enllac: motiuSenseEnllac,
  }));

  const extra = ambEnllac
    ? { enllac_signatura: enllac, ...(motiuSenseEnllac ? { motiu_sense_enllac: motiuSenseEnllac } : {}) }
    : {};
  if (resultat === "enviat" || resultat === "enviat_sense_adjunt" || resultat === "simulat") {
    return responder({ resultat, destinatari, ...extra }, 200);
  }
  if (resultat === "error") {
    return responder({ error: "El correu no ha sortit", code: "error_envio" }, 502);
  }
  return responder({ error: "Aquest document no es pot enviar", code: resultat, destinatari, ...extra }, 409);
});
