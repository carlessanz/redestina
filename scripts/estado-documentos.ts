// Diagnóstico del sistema documental: ¿hay documentos, y su PDF está en el bucket?
//
//   SUPABASE_URL=... SB_SECRET_KEY=... deno run -A scripts/estado-documentos.ts
//
// PARA QUÉ. Cuando una pantalla de documentos sale vacía hay tres causas posibles y se
// parecen mucho: (1) no hay filas en `documentos`, (2) las hay pero son de OTRA
// organización y la RLS las filtra, o (3) las hay y el PDF nunca se generó porque el
// disparador es un **no-op silencioso** sin el secreto `documentos_secret` en `app_config`
// (20260928100700). Este script mira las tres con la service key, que ignora la RLS, así
// que lo que se ve aquí es lo que hay de verdad en la base.
//
// NO IMPRIME NINGÚN SECRETO. De `app_config` solo dice si la clave existe.

import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY.");
  console.error("  set -a; . ./.env.local; . ./.secrets.env; set +a");
  console.error('  export SUPABASE_URL="$VITE_SUPABASE_URL"');
  Deno.exit(1);
}
const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const BUCKET = "documentos";

function paso(t: string) {
  console.log(`\n── ${t}`);
}

// ---------------------------------------------------------------------------
// 1. ¿Está puesto el secreto que hace que el PDF se genere?
// ---------------------------------------------------------------------------

paso("Configuración del disparador");

const { data: config, error: errConfig } = await db
  .from("app_config").select("key").in("key", ["documentos_secret", "functions_base_url"]);

if (errConfig) {
  console.log(`  no se pudo leer app_config: ${errConfig.message}`);
} else {
  const claves = new Set((config ?? []).map((c) => c.key as string));
  console.log(`  documentos_secret en app_config: ${claves.has("documentos_secret") ? "SÍ" : "NO"}`);
  console.log(`  functions_base_url: ${claves.has("functions_base_url") ? "definida" : "por defecto (producción)"}`);
  if (!claves.has("documentos_secret")) {
    console.log("  ⚠️  Sin ese secreto, el trigger y el job son no-op: el documento nace y");
    console.log("     se queda sin PDF. Se pone con:");
    console.log("       deno run -A scripts/set-config.ts documentos_secret '<valor>'");
    console.log("       supabase secrets set DOCUMENTOS_SECRET='<el mismo valor>'");
  }
}

// ---------------------------------------------------------------------------
// 2. Qué filas hay en `documentos`
// ---------------------------------------------------------------------------

paso("Documentos en la base (la service key ignora la RLS)");

const { data: docs, error: errDocs } = await db
  .from("documentos")
  .select("id, tipo, numero_completo, modo, estado, intentos, ultimo_error, ruta, emitido_at, vigente")
  .order("emitido_at", { ascending: false })
  .limit(200);

if (errDocs) {
  console.error(`  no se pudieron leer: ${errDocs.message}`);
  Deno.exit(1);
}
const filas = docs ?? [];
if (filas.length === 0) {
  console.log("  NINGUNO. No es un problema de permisos ni de storage: no hay filas.");
  console.log("  Pasa los fixtures (crear-datos-documentales-prueba.ts y crear-respuestas-prueba.ts).");
  Deno.exit(0);
}

const porEstado = new Map<string, number>();
const porModo = new Map<string, number>();
for (const d of filas) {
  porEstado.set(d.estado as string, (porEstado.get(d.estado as string) ?? 0) + 1);
  porModo.set(d.modo as string, (porModo.get(d.modo as string) ?? 0) + 1);
}
console.log(`  ${filas.length} documentos (máximo 200 leídos)`);
console.log(`  por estado: ${[...porEstado].map(([k, n]) => `${k}=${n}`).join(", ")}`);
console.log(`  por modo:   ${[...porModo].map(([k, n]) => `${k}=${n}`).join(", ")}`);

console.log("\n  Los diez últimos:");
for (const d of filas.slice(0, 10)) {
  const err = d.ultimo_error ? `  · error: ${String(d.ultimo_error).slice(0, 60)}` : "";
  console.log(
    `   ${String(d.tipo).padEnd(6)} ${String(d.numero_completo ?? "(sense numero)").padEnd(20)}` +
    ` ${String(d.estado).padEnd(18)} intents=${d.intentos ?? 0}${err}`,
  );
}

// ---------------------------------------------------------------------------
// 3. ¿El fichero está de verdad en el bucket?
// ---------------------------------------------------------------------------
// Se pide una URL firmada de cada ruta. Si el objeto no existe, Storage responde con
// error y eso es exactamente lo que hay que saber: la fila dice que hay PDF y no lo hay.

paso(`Ficheros en el bucket privado «${BUCKET}»`);

const conRuta = filas.filter((d) => d.ruta);
console.log(`  documentos con ruta escrita: ${conRuta.length} de ${filas.length}`);

let ok = 0;
let falta = 0;
for (const d of conRuta.slice(0, 15)) {
  const { error } = await db.storage.from(BUCKET).createSignedUrl(d.ruta as string, 60);
  if (error) {
    falta++;
    console.log(`   FALTA  ${d.numero_completo ?? d.id}  (${d.ruta})  ${error.message}`);
  } else {
    ok++;
  }
}
console.log(`  comprobados ${Math.min(conRuta.length, 15)}: ${ok} en el bucket, ${falta} sin fichero`);

// ---------------------------------------------------------------------------
// 4. De quién son, para saber quién los ve
// ---------------------------------------------------------------------------
// La causa más frecuente de «no veo nada» no es el PDF: es mirar la pantalla equivocada.
// `/productor/documents` y `/receptor/documents` enseñan SOLO los de esa organización, y
// los del fixture son de las TEST-*. El panel del equipo, `/equip/documents`, los ve todos.

paso("Quién los ve");
console.log("  /equip/documents          → todos (cuenta del equipo)");
console.log("  /productor/documents      → solo los de la organización del productor");
console.log("  /receptor/documents       → solo los de la organización receptora");
console.log("  Los del fixture pertenecen a TEST-PROD-1, TEST-PROD-2 y las TEST-ENT-*,");
console.log("  así que desde una ficha real esas dos pantallas salen vacías con razón.");

const prova = porModo.get("prueba") ?? porModo.get("prova") ?? 0;
if (prova > 0) {
  console.log(`\n  Aviso: ${prova} documentos están en modo prueba. Una organización real`);
  console.log("  no los ve nunca, y una TEST-* solo si su ficha es es_test.");
}
