// Vaciado de los datos operativos antes del piloto (fase 6 de los puntos 4-6, 20270611100000).
//
//   eval "$(bash scripts/local/entorno-local.sh)"           # el CLON (nunca source .env.local)
//   deno run -A scripts/reiniciar-dades.ts                   # DRY-RUN (por defecto): inventario, no escribe
//   deno run -A scripts/reiniciar-dades.ts --executar        # vacía el clon
//
//   # En PRODUCCIÓN, dentro de la sesión del token (§11) y solo tras ver el dry-run y con la
//   # aprobación expresa de Carles:
//   deno run -A scripts/reiniciar-dades.ts                          # dry-run contra producción
//   deno run -A scripts/reiniciar-dades.ts --executar --produccio   # el vaciado de verdad
//
// QUÉ HACE. Llama a la ÚNICA puerta, `reiniciar_dades_operatives(p_executar)` (security definer,
// solo `service_role`): en dry-run imprime lo que borraría —recuentos por tabla, las organizaciones
// con nombre/NIF/papeles, las cuentas externas que se quedan sin organización, los ficheros de
// Storage y los BLOQUEOS—; con `--executar`, la función borra todo lo operativo en una transacción,
// encola los ficheros en `fitxers_orfes` y reinicia las series, y este script **borra los ficheros
// de Storage** (lo único que SQL no puede hacer) vaciando esa cola, y comprueba que los dos buckets
// operativos (`documentos`, `fotos-ofertes`) quedan vacíos.
//
// NO BORRA NINGUNA CUENTA (`auth.users`). Las externas que se quedan sin organización salen en el
// inventario: lo que se haga con ellas lo decide Carles.
//
// GUARDA. Fuera de esta máquina (`SUPABASE_URL` que no sea 127.0.0.1/localhost) solo corre en
// dry-run, salvo `--executar --produccio` a la vez. El mismo patrón que `import-ara-2026.ts`.
//
// LOG. Todo lo que imprime va también a `scripts/data/reiniciar-dades-<clon|produccio>-<dryrun|executar>.log`
// (o `--log=<ruta>`). `scripts/data/` está fuera de git: el inventario lleva nombres y correos.
//
// Después del vaciado: `scripts/sembrar-entitats-ficticies.ts` (las organizaciones del piloto) y,
// SOLO en el clon, los fixtures (`crear-datos-documentales-prueba.ts` → `crear-respuestas-prueba.ts`).

import { createClient } from "npm:@supabase/supabase-js@2";

const args = Deno.args;
const EXECUTAR = args.includes("--executar");
const PRODUCCIO = args.includes("--produccio");

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY (para el clon: eval \"$(bash scripts/local/entorno-local.sh)\").");
  Deno.exit(1);
}
const host = new URL(url).hostname;
const esLocal = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
if (EXECUTAR && !esLocal && !PRODUCCIO) {
  console.error(`SUPABASE_URL apunta a ${host}, que no es el clon. Para vaciar producción hace falta --executar --produccio`);
  console.error("(y antes, el dry-run revisado y la aprobación expresa de Carles).");
  Deno.exit(1);
}
if (PRODUCCIO && esLocal) {
  console.error("--produccio contra el clon local no tiene sentido: quítalo.");
  Deno.exit(1);
}

const logArg = args.find((a) => a.startsWith("--log="))?.slice(6);
const rutaLog = logArg ??
  new URL(`./data/reiniciar-dades-${esLocal ? "clon" : "produccio"}-${EXECUTAR ? "executar" : "dryrun"}.log`, import.meta.url).pathname;

const linies: string[] = [];
function out(txt = "") {
  console.log(txt);
  linies.push(txt);
}
async function desaLog() {
  await Deno.writeTextFile(rutaLog, linies.join("\n") + "\n");
  console.log(`\nLog: ${rutaLog}`);
}

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

/** Los dos buckets operativos: todo lo que contienen cuelga de lo que se borra. */
const BUCKETS = ["documentos", "fotos-ofertes"] as const;

// ---------------------------------------------------------------------------
// Tipos del contrato de la función
// ---------------------------------------------------------------------------

interface Bloqueig { codi: string; n: number; detall: string }
interface Org { id: string; nom: string; nif: string | null; papers: string[]; es_test: boolean; estat_crm: string | null; importada: boolean }
interface Compte { email: string; nom: string | null; membresies: number }
interface Inventari {
  executat: boolean;
  pot_executar: boolean;
  bloquejos: Bloqueig[];
  taules: Record<string, number>;
  conserva: Record<string, number>;
  fitxers: { documentos: number; "fotos-ofertes": number; font: string };
  organitzacions: Org[];
  comptes_externs_sense_organitzacio: Compte[];
  esborrat?: Record<string, number>;
  fitxers_a_la_cua?: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Todas las rutas de un bucket, recorriendo las carpetas (la API lista un nivel cada vez). */
async function rutesBucket(bucket: string, prefix = ""): Promise<string[]> {
  const rutes: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Storage ${bucket}/${prefix}: ${error.message}`);
    const entrades = data ?? [];
    for (const e of entrades) {
      const ruta = prefix ? `${prefix}/${e.name}` : e.name;
      // Una carpeta no tiene `id` (es un prefijo, no un objeto).
      if (e.id === null) rutes.push(...await rutesBucket(bucket, ruta));
      else rutes.push(ruta);
    }
    if (entrades.length < 1000) break;
  }
  return rutes;
}

/** La firma y el sello de la Fundació no se tocan nunca, vivan donde vivan. */
async function rutesProtegides(): Promise<Set<string>> {
  const { data } = await db.from("parametros_documentales").select("firma_ruta, sello_ruta").eq("id", 1).maybeSingle();
  return new Set([data?.firma_ruta, data?.sello_ruta].filter((r): r is string => !!r));
}

/** Vacía la cola `fitxers_orfes` entera (lo que haría el job diario, de una vez). */
async function buidaCua(): Promise<{ esborrats: number; pendents: number }> {
  let esborrats = 0;
  let pendents = 0;
  for (let volta = 0; volta < 200; volta++) {
    const { data, error } = await db.from("fitxers_orfes").select("id, bucket, ruta").order("id").limit(500);
    if (error) throw new Error(`fitxers_orfes: ${error.message}`);
    const files = (data ?? []) as { id: number; bucket: string; ruta: string }[];
    if (files.length === 0) break;
    const perBucket = new Map<string, typeof files>();
    for (const f of files) perBucket.set(f.bucket, [...(perBucket.get(f.bucket) ?? []), f]);
    let progres = 0;
    for (const [bucket, llista] of perBucket) {
      const { error: errRm } = await db.storage.from(bucket).remove(llista.map((f) => f.ruta));
      if (errRm) {
        out(`  ⚠ Storage no ha esborrat ${llista.length} fitxer(s) de ${bucket}: ${errRm.message}`);
        pendents += llista.length;
        continue;
      }
      const { error: errDel } = await db.from("fitxers_orfes").delete().in("id", llista.map((f) => f.id));
      if (errDel) throw new Error(`no s'ha pogut buidar la cua: ${errDel.message}`);
      esborrats += llista.length;
      progres += llista.length;
    }
    // Lo que Storage no deja borrar se queda en la cola para el job diario: sin progreso, se para.
    if (progres === 0) break;
  }
  return { esborrats, pendents };
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

function informe(inv: Inventari, storageApi: Record<string, number> | null) {
  out(`\n${"═".repeat(78)}`);
  out(`${inv.executat ? "VACIADO EJECUTADO" : "DRY-RUN (no se ha escrito nada)"} contra ${host}${esLocal ? " (clon local)" : " (PRODUCCIÓN)"}`);
  out(`${new Date().toISOString()}`);
  out("═".repeat(78));

  out("\nBLOQUEOS");
  if (inv.bloquejos.length === 0) out("  cap: es pot buidar");
  for (const b of inv.bloquejos) out(`  ✗ ${b.codi} (${b.n}): ${b.detall}`);

  const taules = Object.entries(inv.taules).sort(([a], [b]) => a.localeCompare(b));
  const total = taules.reduce((a, [, n]) => a + Number(n), 0);
  out(`\nFILES QUE ${inv.executat ? "S'HAN ESBORRAT (inventari previ)" : "S'ESBORRARIEN"} — ${total} en total`);
  for (const [t, n] of taules) if (Number(n) > 0) out(`  ${String(n).padStart(7)}  ${t}`);
  const buides = taules.filter(([, n]) => Number(n) === 0).map(([t]) => t);
  if (buides.length) out(`  (ja buides: ${buides.join(", ")})`);

  if (inv.esborrat) {
    out("\nESBORRAT DE VERITAT (row_count de cada delete)");
    for (const [t, n] of Object.entries(inv.esborrat).sort(([a], [b]) => a.localeCompare(b))) {
      if (Number(n) > 0) out(`  ${String(n).padStart(7)}  ${t}`);
    }
  }

  out("\nES CONSERVA");
  for (const [t, n] of Object.entries(inv.conserva)) out(`  ${String(n).padStart(7)}  ${t}`);

  out("\nFITXERS DE STORAGE");
  out(`  documentos: ${inv.fitxers.documentos} · fotos-ofertes: ${inv.fitxers["fotos-ofertes"]} (font: ${inv.fitxers.font})`);
  if (storageApi) {
    out(`  segons l'API de Storage: ${Object.entries(storageApi).map(([b, n]) => `${b} ${n}`).join(" · ")}`);
  }
  if (inv.fitxers_a_la_cua !== undefined) out(`  encuats a fitxers_orfes per la funció (abans de buidar-los): ${inv.fitxers_a_la_cua}`);

  const orgs = inv.organitzacions;
  const test = orgs.filter((o) => o.es_test).length;
  const importades = orgs.filter((o) => o.importada).length;
  out(`\nORGANITZACIONS (${orgs.length}: ${test} es_test, ${importades} importades, ${orgs.length - test - importades} altres)`);
  for (const o of orgs) {
    const marques = [o.es_test ? "test" : null, o.importada ? "importada" : null, o.estat_crm].filter(Boolean).join(", ");
    out(`  · ${o.nom} · ${o.nif ?? "sense NIF"} · ${o.papers.join("+") || "sense fitxa"} · ${marques}`);
  }

  const comptes = inv.comptes_externs_sense_organitzacio;
  out(`\nCOMPTES EXTERNS QUE ES QUEDEN SENSE ORGANITZACIÓ (${comptes.length}; no se n'esborra cap)`);
  for (const c of comptes) {
    out(`  · ${c.email} · ${c.nom ?? "(sense nom)"}${c.membresies ? ` · tenia ${c.membresies} membresia(es)` : " · ja no en tenia"}`);
  }
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

out(`reiniciar-dades.ts ${EXECUTAR ? "--executar" : "(dry-run)"}${PRODUCCIO ? " --produccio" : ""}`);

const { data: previ, error: errPrevi } = await db.rpc("reiniciar_dades_operatives", { p_executar: false });
if (errPrevi) {
  out(`✗ reiniciar_dades_operatives(false): ${errPrevi.message} (${errPrevi.code ?? "?"})`);
  await desaLog();
  Deno.exit(1);
}
const inventari = previ as Inventari;

// Lo que dice la API de Storage, para comparar con lo que ve la base (y por si la base no puede
// leer `storage.objects`).
const protegides = await rutesProtegides();
const rutesApi: Record<string, string[]> = {};
for (const b of BUCKETS) rutesApi[b] = (await rutesBucket(b)).filter((r) => !protegides.has(r));
const comptesApi = Object.fromEntries(BUCKETS.map((b) => [b, rutesApi[b].length]));

if (!EXECUTAR) {
  informe(inventari, comptesApi);
  out(inventari.pot_executar
    ? "\nEs pot executar: torna-ho a llançar amb --executar" + (esLocal ? "." : " --produccio (amb l'aprovació de Carles).")
    : "\nNO es pot executar mentre hi hagi bloquejos.");
  await desaLog();
  Deno.exit(0);
}

if (!inventari.pot_executar) {
  informe(inventari, comptesApi);
  out("\n✗ Hi ha bloquejos: no s'ha esborrat res.");
  await desaLog();
  Deno.exit(1);
}

const { data: fet, error: errFet } = await db.rpc("reiniciar_dades_operatives", { p_executar: true });
if (errFet) {
  out(`✗ reiniciar_dades_operatives(true): ${errFet.message} (${errFet.code ?? "?"})`);
  if (errFet.details) out(`  ${errFet.details}`);
  out("  La transacció s'ha desfet: no s'ha esborrat res.");
  await desaLog();
  Deno.exit(1);
}
const resultat = fet as Inventari;

out("\nFitxers de Storage: buidant la cua fitxers_orfes…");
const cua = await buidaCua();
out(`  esborrats ${cua.esborrats}, pendents ${cua.pendents}`);

// Lo que quede en los dos buckets (p. ej. si la base no podía leer `storage.objects`) también es
// de lo borrado: no queda ninguna fila a la que pueda pertenecer.
let restes = 0;
for (const b of BUCKETS) {
  const queden = (await rutesBucket(b)).filter((r) => !protegides.has(r));
  for (let i = 0; i < queden.length; i += 500) {
    const tros = queden.slice(i, i + 500);
    const { error } = await db.storage.from(b).remove(tros);
    if (error) out(`  ⚠ ${b}: no s'han pogut esborrar ${tros.length} restes: ${error.message}`);
    else restes += tros.length;
  }
}
if (restes) out(`  restes esborrades directament dels buckets: ${restes}`);
const finals = Object.fromEntries(await Promise.all(BUCKETS.map(async (b) => [b, (await rutesBucket(b)).filter((r) => !protegides.has(r)).length])));

informe(resultat, comptesApi);
out(`\nStorage després: ${Object.entries(finals).map(([b, n]) => `${b} ${n}`).join(" · ")}`);
out("\nFet. Ara: deno run -A scripts/sembrar-entitats-ficticies.ts" + (esLocal ? " i, al clon, els fixtures (crear-datos-documentales-prueba.ts → crear-respuestas-prueba.ts)." : " (a producció, SENSE fixtures)."));
await desaLog();
