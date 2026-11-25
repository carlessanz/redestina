// La firma propia de una cuenta del EQUIPO (fase 0 del plan de diciembre de 2026).
//
// Cada persona del equipo (Superadmin o Dinamitzador) guarda UNA firma en su perfil; se
// estampa en los albaranes REC/ENT que esa cuenta valida o emite (la ruta se congela en el
// snapshot, `datos.signant_equip.firma_ruta`, y la pinta `generar-documento`).
//
//   GET    /firma-equip                     (JWT de la sesión)
//     -> 200 { ruta, url, actualitzada_at }   todo null si no hay firma; `url` = URL firmada
//                                              de 10 min del fichero en el bucket `activos`
//   POST   /firma-equip  { imatge: "data:image/png;base64,…" }   (también image/jpeg)
//     -> 200 { ruta, url, actualitzada_at }   la nueva
//     -> 400 { error: 'format_invalid' }      no es JSON, falta `imatge`, no es base64, o sus
//                                              BYTES no son PNG ni JPG (el prefijo no manda)
//     -> 413 { error: 'massa_gran' }          más de 1 MB
//   DELETE /firma-equip
//     -> 200 { ruta: null, url: null, actualitzada_at: null }
//   Comunes:
//     -> 401 { error: 'unauthorized' }   sin sesión válida (o cuenta desactivada)
//     -> 403 { error: 'forbidden' }      la cuenta no es del equipo
//     -> 405 { error: 'metode_no_permes' }
//     -> 500 { error: 'error_intern' }   sin detalles (van al log)
//
// QUIÉN: solo el equipo, y cada uno SOLO la suya (el uid sale del JWT, nunca del cuerpo).
// `exigirEquipo()` deja pasar a cualquiera con el interruptor `roles_activos` apagado
// (fail-open de §4bis); aquí además se exige `esIntern`, siempre: una firma de equipo no
// tiene sentido en una cuenta externa, y `fixar_firma_equip()` la rechazaría igual.
//
// DÓNDE: bucket privado `activos`, `equip/<uid>/firma-<timestamp>.<ext>`, con service role y
// `upsert: false`. La ruta la compone esta función (no hay fila de `documentos` detrás que
// la decida en SQL); el registro en el perfil lo hace `fixar_firma_equip(p_user, p_ruta)`,
// que devuelve la ruta ANTERIOR.
//
// 🔴 EL FICHERO ANTERIOR SOLO SE BORRA SI NINGÚN DOCUMENTO LO HA CONGELADO. Un albarán ya
//    emitido guarda en su snapshot la ruta de la firma de entonces, y su PDF se puede volver
//    a generar (la versión `signat` cuando firma la contraparte, un reintento del job): si el
//    fichero ya no estuviera, ese papel saldría sin la firma con la que se emitió. Se mira
//    `documentos.datos->signant_equip->>firma_ruta`; ante la duda (error al consultar), se
//    conserva. Una firma sustituida que nadie usó sí se borra.
//
// No envía nada por ningún canal.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { exigirEquipo } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { validaBytes } from "../_shared/pujada.ts";
import { urlPublica } from "../_shared/url-publica.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

const BUCKET = "activos";
const MAX_BYTES = 1024 * 1024;
/** El cuerpo JSON de una imagen de 1 MB en base64, con holgura para el prefijo y la clave. */
const MAX_COS = Math.ceil((MAX_BYTES * 4) / 3) + 1024;
const SEGUNDOS_URL = 600;

interface Estat {
  ruta: string | null;
  url: string | null;
  actualitzada_at: string | null;
}

const BUIT: Estat = { ruta: null, url: null, actualitzada_at: null };

/** Un error esperado, con su código y estado HTTP. Lo demás es `error_intern`. */
class ErrorPeticio extends Error {
  constructor(public codi: string, public status: number) {
    super(codi);
  }
}

/** Los bytes de un `data:<mime>;base64,<dades>`. El mime declarado no decide nada. */
function bytesDeDataUrl(valor: unknown): { bytes: Uint8Array; declarat: string } {
  if (typeof valor !== "string") throw new ErrorPeticio("format_invalid", 400);
  const m = /^data:([^;,]*)((?:;[^;,]*)*);base64,([\s\S]*)$/i.exec(valor.trim());
  if (!m) throw new ErrorPeticio("format_invalid", 400);
  const b64 = m[3].replace(/\s+/g, "");
  if (b64.length === 0) throw new ErrorPeticio("format_invalid", 400);
  // Antes de decodificar: 4 caracteres son 3 bytes.
  if (Math.floor((b64.length * 3) / 4) - 2 > MAX_BYTES) throw new ErrorPeticio("massa_gran", 413);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ErrorPeticio("format_invalid", 400);
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, declarat: m[1] };
}

/** La URL firmada (10 min) del fichero, vista desde el navegador. */
async function urlDe(supabase: Cliente, ruta: string | null): Promise<string | null> {
  if (!ruta) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, SEGUNDOS_URL);
  if (error || !data?.signedUrl) {
    console.warn("firma-equip: createSignedUrl:", error?.message ?? "sin url");
    return null;
  }
  return urlPublica(data.signedUrl, Deno.env.get("URL_PUBLICA_STORAGE"));
}

/** Lo que hay ahora en el perfil, con su URL. */
async function estatActual(supabase: Cliente, userId: string): Promise<Estat> {
  const { data, error } = await supabase
    .from("perfiles")
    .select("firma_ruta, firma_actualitzada_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`perfiles: ${error.message}`);
  const ruta = (data?.firma_ruta as string | null) ?? null;
  if (!ruta) return BUIT;
  return {
    ruta,
    url: await urlDe(supabase, ruta),
    actualitzada_at: (data?.firma_actualitzada_at as string | null) ?? null,
  };
}

/** Registra la ruta (o null) en el perfil; devuelve la ANTERIOR. */
async function fixar(supabase: Cliente, userId: string, ruta: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc("fixar_firma_equip", { p_user: userId, p_ruta: ruta });
  if (error) {
    const missatge = String(error.message ?? "");
    if (String(error.code ?? "") === "22023" && missatge.includes("no_es_de_lequip")) {
      throw new ErrorPeticio("forbidden", 403);
    }
    throw new Error(`fixar_firma_equip: ${error.code} ${missatge}`);
  }
  return typeof data === "string" && data ? data : null;
}

/**
 * Borra el fichero anterior si es de esta cuenta y ningún documento lo ha congelado (ver
 * cabecera). Nunca lanza: un fichero que sobra es un coste, no un error para quien llama.
 */
async function esborraAnterior(supabase: Cliente, userId: string, ruta: string | null): Promise<string> {
  if (!ruta) return "cap";
  if (!ruta.startsWith(`equip/${userId}/`)) return "aliena";
  try {
    const { data, error } = await supabase
      .from("documentos")
      .select("id")
      .eq("datos->signant_equip->>firma_ruta", ruta)
      .limit(1);
    if (error) {
      console.warn("firma-equip: no s'ha pogut comprovar si la firma anterior és en ús:", error.message);
      return "conservada_dubte";
    }
    if ((data ?? []).length > 0) return "conservada_en_us";
    const { error: errBorra } = await supabase.storage.from(BUCKET).remove([ruta]);
    if (errBorra) {
      console.warn("firma-equip: remove anterior:", errBorra.message);
      return "error_esborrant";
    }
    return "esborrada";
  } catch (e) {
    console.warn("firma-equip: esborraAnterior:", e instanceof Error ? e.message : String(e));
    return "error_esborrant";
  }
}

Deno.serve(async (req) => {
  const t0 = performance.now();
  const cors = corsPara(req, "GET, POST, DELETE, OPTIONS");
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    return responder({ error: "metode_no_permes" }, 405);
  }

  const supabase: Cliente = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  let traza: Record<string, unknown> = {};
  try {
    // `service_role` ignora RLS (§4bis): la autorización propia es obligatoria.
    const auth = await exigirEquipo(supabase, req);
    if ("rechazo" in auth) return responder({ error: auth.rechazo.code }, auth.rechazo.status);
    const { ctx } = auth;
    if (!ctx.esIntern) return responder({ error: "forbidden" }, 403);

    if (req.method === "GET") {
      const estat = await estatActual(supabase, ctx.userId);
      traza = { accio: "get", te_firma: estat.ruta !== null };
      return responder(estat, 200);
    }

    if (req.method === "DELETE") {
      const anterior = await fixar(supabase, ctx.userId, null);
      const fitxer = await esborraAnterior(supabase, ctx.userId, anterior);
      traza = { accio: "delete", anterior: anterior !== null, fitxer_anterior: fitxer };
      return responder(BUIT, 200);
    }

    // ------------------------------------------------------------------ POST
    const llargada = Number(req.headers.get("content-length") ?? "0");
    if (llargada > MAX_COS) return responder({ error: "massa_gran" }, 413);
    const text = await req.text();
    if (text.length > MAX_COS) return responder({ error: "massa_gran" }, 413);
    let cos: unknown;
    try {
      cos = JSON.parse(text);
    } catch {
      return responder({ error: "format_invalid" }, 400);
    }
    const { bytes, declarat } = bytesDeDataUrl((cos as { imatge?: unknown } | null)?.imatge);

    // El formato lo dicen los BYTES (`_shared/pujada.ts`), y aquí solo valen PNG y JPG.
    const comprovat = validaBytes(bytes, declarat, MAX_BYTES);
    if ("error" in comprovat) {
      if (comprovat.error.status === 413) return responder({ error: "massa_gran" }, 413);
      return responder({ error: "format_invalid" }, 400);
    }
    if (comprovat.mime !== "image/png" && comprovat.mime !== "image/jpeg") {
      return responder({ error: "format_invalid" }, 400);
    }

    const ruta = `equip/${ctx.userId}/firma-${Date.now()}.${comprovat.extensio}`;
    const tSubida = performance.now();
    const { error: errSubida } = await supabase.storage
      .from(BUCKET)
      .upload(ruta, bytes, { contentType: comprovat.mime, upsert: false });
    const msSubida = performance.now() - tSubida;
    if (errSubida) throw new Error(`upload: ${errSubida.message}`);

    let anterior: string | null;
    try {
      anterior = await fixar(supabase, ctx.userId, ruta);
    } catch (e) {
      // Compensar: un fichero en el bucket que no apunta ningún perfil no lo borra nadie.
      await supabase.storage.from(BUCKET).remove([ruta]);
      throw e;
    }
    const fitxer = anterior && anterior !== ruta
      ? await esborraAnterior(supabase, ctx.userId, anterior)
      : "cap";

    const estat = await estatActual(supabase, ctx.userId);
    traza = {
      accio: "post",
      mime: comprovat.mime,
      bytes: bytes.length,
      anterior: anterior !== null,
      fitxer_anterior: fitxer,
      ms_subida: Number(msSubida.toFixed(1)),
    };
    return responder(estat, 200);
  } catch (e) {
    if (e instanceof ErrorPeticio) {
      traza = { ...traza, error: e.codi };
      return responder({ error: e.codi }, e.status);
    }
    console.error("firma-equip:", e instanceof Error ? e.message : String(e));
    traza = { ...traza, error: "error_intern" };
    return responder({ error: "error_intern" }, 500);
  } finally {
    console.log(JSON.stringify({
      fn: "firma-equip",
      metode: req.method,
      ...traza,
      ms_total: Number((performance.now() - t0).toFixed(1)),
    }));
  }
});
