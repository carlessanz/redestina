import { type Cliente, type Enlace, type Responder, resolver, sha256Hex, textNet } from "./comun.ts";
import {
  type IdiomaRgpd,
  textConsentiment,
  TIPUS_CONSENTIMENT,
  VERSIO_RGPD,
} from "../_shared/textosRgpd.ts";

// ---------------------------------------------------------------------------
// El consentimiento RGPD pedido por correo (`consentiment_rgpd`, 20270506100000)
// ---------------------------------------------------------------------------
// Quien abre esto es la persona de contacto de una organización que el equipo dio de alta
// sin cuenta. Lee la política de privacidad y marca lo que quiere: la privacidad es
// obligatoria, las dos comunicaciones no. Hasta que no responde no consta NADA: el equipo
// ya no puede declararlo por ella.
//
// ⚠️ LOS TEXTOS LOS COMPONE EL SERVIDOR (`_shared/textosRgpd.ts`) y la huella también: el
//    navegador solo dice sí o no a cada tipo. Mismo criterio que el registro público.

interface OrgPublica {
  nom_comercial: string | null;
  razon_social: string | null;
  nombre: string | null;
}

/** GET: a quién se le pide y qué textos tiene que leer. */
export async function getConsentiment(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  enlace: Enlace,
  ip: string,
  t0: number,
): Promise<Response> {
  if (enlace.objeto_tipo !== "organizacion") {
    return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  }
  const { data: org, error } = await supabase
    .from("v_organizaciones")
    .select("nom_comercial, razon_social, nombre")
    .eq("id", enlace.objeto_id)
    .maybeSingle();
  if (error) {
    console.error("enlace-publico: v_organizaciones:", error.message);
    throw new Error(error.message);
  }

  await supabase.from("evidencias").insert({
    enlace_id: enlace.id,
    tipo: "apertura",
    nombre: enlace.destinatario_nombre,
    ip: ip || null,
    user_agent: req.headers.get("user-agent"),
    payload: { proposito: enlace.proposito },
  });
  if (!enlace.abierto_at) {
    await supabase.from("enlaces_token").update({ abierto_at: new Date().toISOString() })
      .eq("id", enlace.id);
  }

  const o = (org ?? null) as OrgPublica | null;
  const textos = Object.fromEntries((["ca", "es"] as IdiomaRgpd[]).map((idioma) => [
    idioma,
    Object.fromEntries(TIPUS_CONSENTIMENT.map((tipus) => [tipus, textConsentiment(tipus, idioma)])),
  ]));

  console.log(`[enlace-publico] consentiment obert en ${Math.round(performance.now() - t0)} ms`);
  return responder({
    proposito: enlace.proposito,
    estado_efectivo: enlace.estado_efectivo,
    caduca_at: enlace.caduca_at,
    entitat: o?.nom_comercial ?? o?.razon_social ?? o?.nombre ?? enlace.destinatario_nombre,
    versio: VERSIO_RGPD,
    textos,
  }, 200);
}

/** POST `accion: 'consentir'`: las tres respuestas de la persona. */
export async function registrarConsentiment(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  body: Record<string, unknown>,
  ip: string,
  t0: number,
): Promise<Response> {
  const token = textNet(body.t);
  const enlace = await resolver(supabase, token);
  if (!enlace) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  if (enlace.proposito !== "consentiment_rgpd") {
    return responder({ error: "Aquest enllaç no és per a això.", code: "proposit_incorrecte" }, 400);
  }

  const idioma: IdiomaRgpd = textNet(body.idioma) === "es" ? "es" : "ca";
  if (body.privacitat !== true) {
    return responder(
      { error: "Cal acceptar la política de privacitat.", code: "falta_acceptacio" },
      400,
    );
  }
  const respostes = await Promise.all(TIPUS_CONSENTIMENT.map(async (tipus) => ({
    tipus,
    valor: body[tipus] === true,
    sha256: await sha256Hex(textConsentiment(tipus, idioma)),
  })));

  const { error } = await supabase.rpc("registrar_consentiment_enllac", {
    p_token_hash: await sha256Hex(token),
    p_respostes: respostes,
    p_versio: VERSIO_RGPD,
    p_idioma: idioma,
    p_ip: ip || null,
    p_user_agent: req.headers.get("user-agent"),
  });
  if (error) {
    // La RPC dice el motivo en el mensaje y el estado en el SQLSTATE (PT404/409/410).
    const codi = (error.message ?? "").trim();
    const status = error.code === "PT404" ? 404 : error.code === "PT409" ? 409 : error.code === "PT410" ? 410 : 400;
    if (status === 400 && !["falta_acceptacio", "dades_invalides", "proposit_incorrecte"].includes(codi)) {
      console.error("enlace-publico: registrar_consentiment_enllac:", error.message);
      return responder({ error: "No s'ha pogut desar.", code: "error_bd" }, 500);
    }
    return responder({ error: codi, code: codi }, status);
  }

  console.log(`[enlace-publico] consentiment desat en ${Math.round(performance.now() - t0)} ms`);
  return responder({ ok: true }, 200);
}
