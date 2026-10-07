// Copia los ficheros de Storage de PRODUCCIÓN al Supabase LOCAL (07-10-2026).
//
//   deno run -A --node-modules-dir=none scripts/local/copiar-storage.ts [--dry-run]
//
// (`--node-modules-dir=none`: sin él, Deno resuelve supabase-js contra el node_modules de
// npm del repo y falla; es el mismo motivo que en `npm run check:deno`.)
//
// De producción solo LEE (listar y descargar), con la clave secreta de `.secrets.env`
// (SB_SECRET_KEY). En local escribe con la clave secreta local, que saca de
// `supabase status`. Se niega a escribir si el destino no es esta máquina.
//
// Por qué se copian los ficheros y no las filas de `storage.objects`: esas filas son solo
// la ficha; sin el fichero en el volumen local, cada descarga daría 404. Al subirlos por la
// API se crea la ficha, y las políticas solo miran el nombre (no el propietario), así que
// todo sigue funcionando. Los PDF emitidos no se pueden regenerar (son inmutables): hay que
// copiarlos.
//
// Idempotente: lo que ya existe en local con el mismo tamaño se salta.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const ORIGEN_URL = "https://uxppvaldhptdomvdhsmn.supabase.co";
const dryRun = Deno.args.includes("--dry-run");

async function claveProduccion(): Promise<string> {
  const desdeEnv = Deno.env.get("ORIGEN_SECRET_KEY");
  if (desdeEnv) return desdeEnv;
  const txt = await Deno.readTextFile(new URL("../../.secrets.env", import.meta.url));
  const m = txt.match(/^SB_SECRET_KEY=(.+)$/m);
  if (!m) throw new Error("No hay SB_SECRET_KEY en .secrets.env");
  return m[1].trim().replace(/^"|"$/g, "");
}

async function estadoLocal(): Promise<{ url: string; key: string }> {
  const out = await new Deno.Command("supabase", { args: ["status", "-o", "env"], stderr: "null" }).output();
  if (!out.success) throw new Error("El Supabase local no responde: arráncalo antes.");
  const env = Object.fromEntries(
    new TextDecoder().decode(out.stdout).split("\n")
      .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  const url = env.API_URL ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
    throw new Error(`El destino no es local (${url}): no se copia nada.`);
  }
  return { url, key: env.SECRET_KEY };
}

// Lista recursiva: en Storage las «carpetas» vienen como entradas sin id.
async function listar(cli: SupabaseClient, bucket: string, prefijo = ""): Promise<{ ruta: string; bytes: number }[]> {
  const res: { ruta: string; bytes: number }[] = [];
  for (let offset = 0;; offset += 1000) {
    const { data, error } = await cli.storage.from(bucket).list(prefijo, { limit: 1000, offset });
    if (error) throw new Error(`listar ${bucket}/${prefijo}: ${error.message}`);
    for (const e of data ?? []) {
      const ruta = prefijo ? `${prefijo}/${e.name}` : e.name;
      if (e.id === null) res.push(...await listar(cli, bucket, ruta));
      else res.push({ ruta, bytes: Number((e.metadata as { size?: number } | null)?.size ?? -1) });
    }
    if (!data || data.length < 1000) break;
  }
  return res;
}

const origen = createClient(ORIGEN_URL, await claveProduccion(), { auth: { persistSession: false } });
const { url: destinoUrl, key: destinoKey } = await estadoLocal();
const destino = createClient(destinoUrl, destinoKey, { auth: { persistSession: false } });

const { data: buckets, error: errB } = await origen.storage.listBuckets();
if (errB) throw new Error(`listBuckets producción: ${errB.message}`);
const { data: bucketsLocals } = await destino.storage.listBuckets();
const existentes = new Set((bucketsLocals ?? []).map((b) => b.id));

let copiats = 0, saltats = 0, bytes = 0;
for (const b of buckets ?? []) {
  if (!existentes.has(b.id)) {
    // Un bucket creado a mano en producción, fuera de las migraciones: se replica igual.
    console.log(`  bucket nuevo en local: ${b.id}`);
    if (!dryRun) {
      const { error } = await destino.storage.createBucket(b.id, {
        public: b.public,
        fileSizeLimit: b.file_size_limit ?? undefined,
        allowedMimeTypes: b.allowed_mime_types ?? undefined,
      });
      if (error) throw new Error(`createBucket ${b.id}: ${error.message}`);
    }
  }
  const fitxers = await listar(origen, b.id);
  const locals = new Map((existentes.has(b.id) ? await listar(destino, b.id) : []).map((f) => [f.ruta, f.bytes]));
  console.log(`${b.id}: ${fitxers.length} fichero(s) en producción`);
  for (const f of fitxers) {
    if (locals.get(f.ruta) === f.bytes) { saltats++; continue; }
    if (dryRun) { console.log(`  copiaría ${f.ruta}`); continue; }
    const { data: blob, error: errD } = await origen.storage.from(b.id).download(f.ruta);
    if (errD || !blob) throw new Error(`descargar ${b.id}/${f.ruta}: ${errD?.message}`);
    const { error: errU } = await destino.storage.from(b.id).upload(f.ruta, blob, {
      upsert: true,
      contentType: blob.type || undefined,
    });
    if (errU) throw new Error(`subir ${b.id}/${f.ruta}: ${errU.message}`);
    copiats++;
    bytes += blob.size;
  }
}

console.log(`\n${dryRun ? "(dry-run) " : ""}Copiados: ${copiats} · ya estaban: ${saltats} · ${(bytes / 1024 / 1024).toFixed(1)} MB`);
