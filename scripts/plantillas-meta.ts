// Las plantillas de WhatsApp de la oferta en Meta: consultarlas y darlas de alta.
//
//   deno run -A scripts/plantillas-meta.ts listar
//   deno run -A scripts/plantillas-meta.ts crear oferta_excedent            # DRY-RUN: imprime el JSON
//   deno run -A scripts/plantillas-meta.ts crear oferta_disponibilitat --enviar
//
// Variables de entorno: WHATSAPP_TOKEN (obligatoria para `listar` y `--enviar`),
// WHATSAPP_API_VERSION (por defecto v23.0) y WHATSAPP_WABA_ID (opcional: si falta, se descubre
// como en `diagnostico-whatsapp.ts`, por `me/businesses` → `owned_whatsapp_business_accounts`).
//
// 🔴 `crear` es DRY-RUN por defecto: imprime el cuerpo de `POST /{WABA}/message_templates` y no
//    manda nada. Solo con `--enviar` lo presenta a Meta, que la revisa (minutos–24 h). En el
//    número de PRUEBAS no sirve de nada (solo `hello_world`): hace falta la WABA de producción
//    (checkpoint 2, AGENTS.md §12). Al aprobarse, encender el flag en `src/lib/plantillas.ts`.
//
// El texto vive en `supabase/functions/_shared/plantillasMeta.ts` (el mismo que rellena el panel
// al enviar y que comprueban los tests): aquí no se escribe ni una palabra de la plantilla.

import {
  definicioPerMeta, PLANTILLES_META, problemesDefinicio,
} from "../supabase/functions/_shared/plantillasMeta.ts";

const TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const VERSION = Deno.env.get("WHATSAPP_API_VERSION") ?? "v23.0";
const G = `https://graph.facebook.com/${VERSION}`;

const [accio, nom, ...resta] = Deno.args;
const ENVIAR = resta.includes("--enviar") || Deno.args.includes("--enviar");

function ajuda(codi = 1): never {
  console.error(`
Uso:
  deno run -A scripts/plantillas-meta.ts listar
  deno run -A scripts/plantillas-meta.ts crear <${Object.keys(PLANTILLES_META).join("|")}> [--enviar]

  crear sin --enviar = dry-run: imprime el JSON que se mandaría y no envía nada.
`);
  Deno.exit(codi);
}

function exigeixToken(): void {
  if (TOKEN) return;
  console.error("Falta WHATSAPP_TOKEN (el de la app de Meta; nunca se escribe en el repo).");
  Deno.exit(1);
}

/** El token va en la cabecera, no en la URL (no queda en ningún log de proxy). */
async function graph(
  ruta: string, init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(ruta.startsWith("http") ? ruta : `${G}/${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

/** La WABA: la del entorno o, si falta, la única que ve el token (como el diagnóstico). */
async function waba(): Promise<string> {
  const deEntorn = Deno.env.get("WHATSAPP_WABA_ID");
  if (deEntorn) return deEntorn;
  const negocis = await graph("me/businesses?fields=id,name");
  if (!negocis.ok) {
    console.error(`No se puede descubrir la WABA: ${negocis.data?.error?.message ?? negocis.status}`);
    console.error("Pásala con WHATSAPP_WABA_ID=…");
    Deno.exit(1);
  }
  const trobades: { id: string; name?: string }[] = [];
  for (const b of negocis.data?.data ?? []) {
    const w = await graph(`${b.id}/owned_whatsapp_business_accounts?fields=id,name`);
    for (const x of w.data?.data ?? []) trobades.push(x);
  }
  if (trobades.length !== 1) {
    console.error(`El token ve ${trobades.length} WABA: ${trobades.map((w) => `${w.name ?? ""} (${w.id})`).join(", ") || "ninguna"}.`);
    console.error("Indica cuál con WHATSAPP_WABA_ID=…");
    Deno.exit(1);
  }
  console.error(`WABA: ${trobades[0].name ?? ""} (${trobades[0].id})`);
  return trobades[0].id;
}

async function listar(): Promise<void> {
  exigeixToken();
  const id = await waba();
  let url: string | null = `${id}/message_templates?fields=name,language,status,category,rejected_reason,quality_score&limit=100`;
  const files: Record<string, unknown>[] = [];
  while (url) {
    const r = await graph(url);
    if (!r.ok) {
      console.error(`Meta: ${r.data?.error?.message ?? r.status}`);
      Deno.exit(1);
    }
    files.push(...(r.data?.data ?? []));
    url = r.data?.paging?.next ?? null;
  }
  const nostres = new Set(Object.keys(PLANTILLES_META));
  for (const f of files) {
    const marca = nostres.has(String(f.name)) ? "  ← de Redestina" : "";
    const motiu = f.rejected_reason && f.rejected_reason !== "NONE" ? ` · rechazada: ${f.rejected_reason}` : "";
    console.log(`${f.status}\t${f.category}\t${f.language}\t${f.name}${motiu}${marca}`);
  }
  for (const n of nostres) {
    if (!files.some((f) => f.name === n)) console.log(`—\t—\t—\t${n}  ← aún no dada de alta`);
  }
}

async function crear(): Promise<void> {
  if (!nom) ajuda();
  const def = PLANTILLES_META[nom];
  if (!def) {
    console.error(`No hay ninguna plantilla «${nom}». Opciones: ${Object.keys(PLANTILLES_META).join(", ")}`);
    Deno.exit(1);
  }
  const problemes = problemesDefinicio(def);
  if (problemes.length > 0) {
    console.error(`La definición de ${nom} no cumple las reglas de Meta:\n  · ${problemes.join("\n  · ")}`);
    Deno.exit(1);
  }
  const cos = definicioPerMeta(def);
  if (!ENVIAR) {
    console.log(JSON.stringify(cos, null, 2));
    console.error(`\n[DRY-RUN] No se ha enviado nada. Para presentarla a Meta: añade --enviar.`);
    return;
  }
  exigeixToken();
  const id = await waba();
  const r = await graph(`${id}/message_templates`, { method: "POST", body: JSON.stringify(cos) });
  if (!r.ok) {
    const e = r.data?.error ?? {};
    console.error(`Meta ha rechazado el alta (HTTP ${r.status}, code ${e.code ?? "?"}/${e.error_subcode ?? "—"}): ${e.error_user_msg ?? e.message ?? ""}`);
    Deno.exit(1);
  }
  console.log(`Presentada: ${JSON.stringify(r.data)}`);
  console.log("Meta la revisa (minutos–24 h). Compruébalo con `listar`; aprobada → flag a true en src/lib/plantillas.ts.");
}

if (accio === "listar") await listar();
else if (accio === "crear") await crear();
else ajuda(accio ? 1 : 0);
