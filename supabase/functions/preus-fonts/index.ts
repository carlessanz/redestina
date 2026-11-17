// Las fuentes de los precios de referencia (punto 3, fase D1, 17-11-2026).
//
//   POST /preus-fonts  { accio: 'gencat' | 'mercabarna' }           (job o equipo)
//   POST /preus-fonts  { accio: 'fitxer', carrega_id }               (equipo: el fichero original)
//
// DOS PUERTAS, como pide el encargo:
//   · el JOB (`pg_cron` → `disparar_preus_fonts()` → `pg_net`), sin JWT y con el secreto de los
//     documentos en `x-documentos-secret` (el patrón de `recollides-programades`). Respeta el
//     interruptor `preus_fonts_estat.automatic` y FALLA CERRADO: sin fila, con error de lectura
//     o con `automatic = false`, no descarga.
//   · el EQUIPO con su sesión: «Actualitza ara» (admin o super_admin, `potAprovar`, siempre,
//     aunque `roles_activos` esté apagado: escribe en la base) y «Descarrega el fitxer»
//     (cualquiera del equipo).
//
// GENCAT: petición condicional (`If-None-Match`/`If-Modified-Since`); con 304 no descarga.
// Si la dirección da 404 (el nombre lleva el rango de años y cambiará en 2027) prueba el año
// actual y el siguiente; si ninguna existe, deja el error en `preus_fonts_estat` y la cola
// `preus` de `pendents_equip()` lo cuenta. Con fichero nuevo: lo guarda en el bucket privado
// `preus-fonts`, lo lee con SheetJS y registra la carga `pendent` con sus observaciones.
//
// MERCABARNA: POST del formulario (todas las familias, sector frutas y hortalizas) y se lee la
// TABLA HTML (el CSV de exportación está roto, ver `_shared/preusFonts.ts`). Una carga por día
// de la página: si ya está, no hace nada.
//
// Los interruptores de notificaciones (§8) no aplican: aquí no sale ningún mensaje.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { corsPara } from "../_shared/cors.ts";
import { exigirSecreto, preflight, respondedor } from "../_shared/http.ts";
import { contextoUsuario, exigirEquipo } from "../_shared/autorizacion.ts";
import { sha256Bytes } from "../_shared/pujada.ts";
import { urlPublica } from "../_shared/url-publica.ts";
import {
  candidatsUrlGencat, type FontPreus, llegeixGencat, llegeixMercabarna, observatsMercabarna,
} from "../_shared/preusFonts.ts";
import type { ClienteSupabase } from "../_shared/cliente.ts";

const BUCKET = "preus-fonts";
// Genérica a propósito: sin el nombre de nadie ni un correo (petición automatizada normal).
const USER_AGENT = "Mozilla/5.0 (compatible; preus-referencia/1.0)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Estat {
  font: FontPreus;
  url: string;
  automatic: boolean;
  etag: string | null;
  last_modified: string | null;
}

interface Resultat {
  ok: boolean;
  font: FontPreus;
  resultat?: "nou" | "sense_canvis" | "duplicat" | "desactivat";
  error?: string;
  carrega_id?: string | null;
  files?: number;
  data_font?: string | null;
  url_canviada?: boolean;
}

const avuiMadrid = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

function dataIso(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function llegeixEstat(supabase: ClienteSupabase, font: FontPreus): Promise<Estat | null> {
  const { data, error } = await supabase.from("preus_fonts_estat")
    .select("font, url, automatic, etag, last_modified").eq("font", font).maybeSingle();
  if (error) {
    console.error(`preus-fonts: no s'ha pogut llegir l'estat de ${font}:`, error.message);
    return null;
  }
  return (data as Estat | null) ?? null;
}

async function desaEstat(supabase: ClienteSupabase, font: FontPreus, canvis: Record<string, unknown>) {
  const { error } = await supabase.from("preus_fonts_estat")
    .update({ ...canvis, darrera_comprovacio_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("font", font);
  if (error) console.error(`preus-fonts: no s'ha pogut desar l'estat de ${font}:`, error.message);
}

async function falla(supabase: ClienteSupabase, font: FontPreus, codi: string, detall?: string): Promise<Resultat> {
  console.error(`preus-fonts ${font}: ${codi}${detall ? ` (${detall})` : ""}`);
  await desaEstat(supabase, font, { darrer_resultat: "error", darrer_error: detall ? `${codi}: ${detall}` : codi });
  return { ok: false, font, error: codi };
}

async function registra(
  supabase: ClienteSupabase, font: FontPreus, meta: Record<string, unknown>, observats: unknown[],
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await supabase.rpc("registrar_carrega_preus", {
    p_font: font, p_meta: meta, p_observats: observats,
  });
  if (error) return { id: null, error: error.message };
  return { id: (data as string | null) ?? null };
}

// ---------------------------------------------------------------------------
// Gencat
// ---------------------------------------------------------------------------
async function actualitzaGencat(supabase: ClienteSupabase, est: Estat, origen: "job" | "manual", usuari: string | null): Promise<Resultat> {
  const font: FontPreus = "gencat";
  let url = est.url;
  let urlCanviada = false;
  const condicional: Record<string, string> = { "User-Agent": USER_AGENT };
  if (est.etag) condicional["If-None-Match"] = est.etag;
  if (est.last_modified) condicional["If-Modified-Since"] = est.last_modified;

  let res: Response;
  try {
    res = await fetch(url, { headers: condicional });
    if (res.status === 404) {
      await res.body?.cancel();
      for (const candidat of candidatsUrlGencat(url, Number(avuiMadrid().slice(0, 4)))) {
        const r = await fetch(candidat, { headers: { "User-Agent": USER_AGENT } });
        if (r.ok) { res = r; url = candidat; urlCanviada = true; break; }
        await r.body?.cancel();
      }
    }
  } catch (e) {
    return await falla(supabase, font, "xarxa", e instanceof Error ? e.message : String(e));
  }

  if (res.status === 304) {
    await desaEstat(supabase, font, { darrer_resultat: "sense_canvis", darrer_error: null });
    return { ok: true, font, resultat: "sense_canvis" };
  }
  if (res.status === 404) return await falla(supabase, font, "url_no_trobada", url);
  if (!res.ok) {
    await res.body?.cancel();
    return await falla(supabase, font, `http_${res.status}`, url);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const sha = await sha256Bytes(bytes);
  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  const comuns: Record<string, unknown> = { etag, last_modified: lastModified, darrer_error: null };
  if (urlCanviada) comuns.url = url;

  const { data: dup } = await supabase.from("preus_carregues").select("id")
    .eq("font", font).eq("sha256", sha).maybeSingle();
  if (dup) {
    await desaEstat(supabase, font, { ...comuns, darrer_resultat: "duplicat" });
    return { ok: true, font, resultat: "duplicat", carrega_id: (dup as { id: string }).id, url_canviada: urlCanviada };
  }

  let llegit: ReturnType<typeof llegeixGencat>;
  try {
    const llibre = XLSX.read(bytes, { type: "array" });
    const fulls = llibre.SheetNames.map((nom) => ({
      nom,
      files: XLSX.utils.sheet_to_json(llibre.Sheets[nom], { header: 1, raw: true, defval: null }) as unknown[][],
    }));
    llegit = llegeixGencat(fulls);
  } catch (e) {
    return await falla(supabase, font, "format_desconegut", e instanceof Error ? e.message : String(e));
  }
  if (llegit.observats.length === 0) return await falla(supabase, font, "format_desconegut", "sense observacions");

  const dataFont = dataIso(lastModified) ?? avuiMadrid();
  const nom = `preus-percebuts-${dataFont}.xls`;
  const path = `gencat/${dataFont}-${sha.slice(0, 12)}.xls`;
  const { error: errPujada } = await supabase.storage.from(BUCKET)
    .upload(path, bytes, { contentType: "application/vnd.ms-excel", upsert: true });
  if (errPujada) return await falla(supabase, font, "no_desat", errPujada.message);

  const fins = llegit.fins ? `${llegit.fins.exercici}-${String(llegit.fins.mes).padStart(2, "0")}-01` : null;
  const reg = await registra(supabase, font, {
    url, fitxer_path: path, fitxer_nom: nom, mime: "application/vnd.ms-excel", mida_bytes: bytes.length,
    sha256: sha, etag, last_modified: lastModified, data_font: dataFont, periode_fins: fins,
    origen, creada_per: usuari,
  }, llegit.observats);
  if (reg.error) return await falla(supabase, font, "no_registrat", reg.error);

  await desaEstat(supabase, font, {
    ...comuns, darrer_resultat: reg.id ? "nou" : "duplicat",
    ...(reg.id ? { darrera_carrega_at: new Date().toISOString() } : {}),
  });
  return {
    ok: true, font, resultat: reg.id ? "nou" : "duplicat", carrega_id: reg.id,
    files: llegit.observats.length, data_font: dataFont, url_canviada: urlCanviada,
  };
}

// ---------------------------------------------------------------------------
// Mercabarna
// ---------------------------------------------------------------------------
async function actualitzaMercabarna(supabase: ClienteSupabase, est: Estat, origen: "job" | "manual", usuari: string | null): Promise<Resultat> {
  const font: FontPreus = "mercabarna";
  let html: string;
  try {
    const res = await fetch(est.url, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ familia: "0", exportField: "", sector: "3", generar: "Generar estadísticas" }),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return await falla(supabase, font, `http_${res.status}`, est.url);
    }
    html = await res.text();
  } catch (e) {
    return await falla(supabase, font, "xarxa", e instanceof Error ? e.message : String(e));
  }

  let llegit: ReturnType<typeof llegeixMercabarna>;
  try {
    llegit = llegeixMercabarna(html);
  } catch (e) {
    return await falla(supabase, font, e instanceof Error ? e.message : "format_desconegut");
  }

  const { data: dup } = await supabase.from("preus_carregues").select("id")
    .eq("font", font).eq("data_font", llegit.data).maybeSingle();
  if (dup) {
    await desaEstat(supabase, font, { darrer_resultat: "duplicat", darrer_error: null });
    return { ok: true, font, resultat: "duplicat", carrega_id: (dup as { id: string }).id, data_font: llegit.data };
  }

  const observats = observatsMercabarna(llegit);
  const bytes = new TextEncoder().encode(html);
  const sha = await sha256Bytes(bytes);
  const path = `mercabarna/${llegit.data}.html`;
  const { error: errPujada } = await supabase.storage.from(BUCKET)
    .upload(path, bytes, { contentType: "text/html", upsert: true });
  if (errPujada) return await falla(supabase, font, "no_desat", errPujada.message);

  const reg = await registra(supabase, font, {
    url: est.url, fitxer_path: path, fitxer_nom: `mercabarna-${llegit.data}.html`, mime: "text/html",
    mida_bytes: bytes.length, sha256: sha, data_font: llegit.data,
    periode_fins: `${llegit.data.slice(0, 7)}-01`, origen, creada_per: usuari,
  }, observats);
  if (reg.error) return await falla(supabase, font, "no_registrat", reg.error);

  await desaEstat(supabase, font, {
    darrer_resultat: reg.id ? "nou" : "duplicat", darrer_error: null,
    ...(reg.id ? { darrera_carrega_at: new Date().toISOString() } : {}),
  });
  return { ok: true, font, resultat: reg.id ? "nou" : "duplicat", carrega_id: reg.id, files: observats.length, data_font: llegit.data };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);
  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SECRET_KEY")!);
  const cos = (await req.json().catch(() => null)) as { accio?: unknown; carrega_id?: unknown } | null;
  const accio = typeof cos?.accio === "string" ? cos.accio : "";
  const esJob = req.headers.has("x-documentos-secret");

  // --- El fichero original de una carga (equipo) ---
  if (accio === "fitxer") {
    const e = await exigirEquipo(supabase, req);
    if ("rechazo" in e) return responder({ error: e.rechazo.error, code: e.rechazo.code }, e.rechazo.status);
    const id = typeof cos?.carrega_id === "string" ? cos.carrega_id : "";
    if (!UUID.test(id)) return responder({ error: "carrega_invalida", code: "carrega_invalida" }, 400);
    const { data } = await supabase.from("preus_carregues").select("fitxer_path, fitxer_nom").eq("id", id).maybeSingle();
    const fila = data as { fitxer_path: string | null; fitxer_nom: string | null } | null;
    if (!fila?.fitxer_path) return responder({ error: "sense_fitxer", code: "sense_fitxer" }, 404);
    const { data: firmada, error } = await supabase.storage.from(BUCKET)
      .createSignedUrl(fila.fitxer_path, 60, { download: fila.fitxer_nom ?? true });
    if (error || !firmada?.signedUrl) {
      console.error("preus-fonts fitxer:", error?.message ?? "sense url");
      return responder({ error: "sense_fitxer", code: "sense_fitxer" }, 404);
    }
    return responder({ url: urlPublica(firmada.signedUrl, Deno.env.get("URL_PUBLICA_STORAGE")), nom: fila.fitxer_nom });
  }

  if (accio !== "gencat" && accio !== "mercabarna") {
    return responder({ error: "accio_invalida", code: "accio_invalida" }, 400);
  }
  const font: FontPreus = accio;

  let origen: "job" | "manual" = "job";
  let usuari: string | null = null;
  if (esJob) {
    const rebuig = exigirSecreto(req, "x-documentos-secret", Deno.env.get("DOCUMENTOS_SECRET"));
    if (rebuig) return rebuig;
  } else {
    const ctx = await contextoUsuario(supabase, req);
    if (!ctx) return responder({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
    if (!ctx.potAprovar) return responder({ error: "Només admin o super_admin", code: "forbidden" }, 403);
    origen = "manual";
    usuari = ctx.userId;
  }

  const est = await llegeixEstat(supabase, font);
  // Falla cerrado: sin estado (o sin poder leerlo) no se descarga nada.
  if (!est) return responder({ ok: false, font, error: "sense_estat" } satisfies Resultat, 500);
  if (esJob && est.automatic !== true) {
    return responder({ ok: true, font, resultat: "desactivat" } satisfies Resultat);
  }

  const r = font === "gencat"
    ? await actualitzaGencat(supabase, est, origen, usuari)
    : await actualitzaMercabarna(supabase, est, origen, usuari);
  return responder(r);
});
