// Recuento de producción y del clon local, y su comparación (07-10-2026).
//
//   deno run -A scripts/local/recompte.ts produccio   (sesión del token; solo lee)
//   deno run -A scripts/local/recompte.ts local        (contra el contenedor local)
//   deno run -A scripts/local/recompte.ts comparar     (los dos JSON de supabase/.local-dump/)
//
// Qué mide: filas de cada tabla de `public`, cuentas de `auth`, ficheros por bucket,
// buckets, extensiones (y en qué esquema), jobs de pg_cron, políticas de Storage y número
// de migraciones registradas. Es la prueba de que el clon es una copia y no algo parecido.

const DIR = new URL("../../supabase/.local-dump/", import.meta.url);
const REF = "uxppvaldhptdomvdhsmn";
const modo = Deno.args[0];

const SQL = `
select jsonb_build_object(
  'taules', (
    select jsonb_object_agg(table_name,
      (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint)
    from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'),
  'auth_users', (select count(*) from auth.users),
  'auth_identities', (select count(*) from auth.identities),
  'fitxers_per_bucket', (select coalesce(jsonb_object_agg(bucket_id, n), '{}'::jsonb)
                         from (select bucket_id, count(*) n from storage.objects group by 1) s),
  'buckets', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from storage.buckets),
  'extensions', (select jsonb_object_agg(extname, n.nspname) from pg_extension e
                 join pg_namespace n on n.oid = e.extnamespace),
  'cron', (select coalesce(jsonb_agg(jobname || ' · ' || schedule order by jobname), '[]'::jsonb) from cron.job),
  'politiques_storage', (select coalesce(jsonb_agg(policyname order by policyname), '[]'::jsonb)
                         from pg_policies where schemaname = 'storage'),
  'migracions', (select count(*) from supabase_migrations.schema_migrations)
) as recompte`;

type Recompte = {
  taules: Record<string, number>;
  auth_users: number;
  auth_identities: number;
  fitxers_per_bucket: Record<string, number>;
  buckets: string[];
  extensions: Record<string, string>;
  cron: string[];
  politiques_storage: string[];
  migracions: number;
};

async function desar(nom: string, r: Recompte) {
  await Deno.mkdir(DIR, { recursive: true });
  await Deno.writeTextFile(new URL(nom, DIR), JSON.stringify(r, null, 2) + "\n");
  console.log(`Guardado supabase/.local-dump/${nom}`);
}

if (modo === "produccio") {
  const token = Deno.env.get("SUPABASE_ACCESS_TOKEN");
  if (!token) throw new Error("Falta SUPABASE_ACCESS_TOKEN (sesión temporal).");
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: SQL }),
  });
  const cos = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${cos}`);
  await desar("recompte-produccion.json", (JSON.parse(cos) as { recompte: Recompte }[])[0].recompte);
} else if (modo === "local") {
  const out = await new Deno.Command("docker", {
    args: ["exec", "-i", "supabase_db_Redestina", "psql", "-U", "postgres", "-At", "-c", SQL],
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  await desar("recompte-local.json", JSON.parse(new TextDecoder().decode(out.stdout)));
} else if (modo === "comparar") {
  const llegir = async (n: string) => JSON.parse(await Deno.readTextFile(new URL(n, DIR))) as Recompte;
  const p = await llegir("recompte-produccion.json");
  const l = await llegir("recompte-local.json");
  // `app_config` no se copia a propósito: son los secretos de producción.
  const EXCLOSES = new Set(["app_config"]);
  const difs: string[] = [];
  const noms = new Set([...Object.keys(p.taules), ...Object.keys(l.taules)]);
  for (const t of [...noms].sort()) {
    if (EXCLOSES.has(t)) continue;
    if (p.taules[t] !== l.taules[t]) difs.push(`tabla ${t}: producción ${p.taules[t] ?? "—"} · local ${l.taules[t] ?? "—"}`);
  }
  const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (p.auth_users !== l.auth_users) difs.push(`auth.users: ${p.auth_users} · ${l.auth_users}`);
  if (p.auth_identities !== l.auth_identities) difs.push(`auth.identities: ${p.auth_identities} · ${l.auth_identities}`);
  if (!igual(p.fitxers_per_bucket, l.fitxers_per_bucket)) {
    difs.push(`ficheros por bucket: ${JSON.stringify(p.fitxers_per_bucket)} · ${JSON.stringify(l.fitxers_per_bucket)}`);
  }
  if (!igual(p.buckets, l.buckets)) difs.push(`buckets: ${p.buckets} · ${l.buckets}`);
  if (!igual(p.cron, l.cron)) difs.push(`cron: ${JSON.stringify(p.cron)} · ${JSON.stringify(l.cron)}`);
  if (!igual(p.politiques_storage, l.politiques_storage)) {
    difs.push(`políticas de storage: ${p.politiques_storage} · ${l.politiques_storage}`);
  }
  if (p.migracions !== l.migracions) difs.push(`migraciones: ${p.migracions} · ${l.migracions}`);
  for (const [ext, esq] of Object.entries(p.extensions)) {
    if (l.extensions[ext] !== esq) difs.push(`extensión ${ext}: producción ${esq} · local ${l.extensions[ext] ?? "—"}`);
  }
  console.log(`Tablas comparadas: ${noms.size - EXCLOSES.size} (sin ${[...EXCLOSES].join(", ")})`);
  if (difs.length === 0) console.log("✅ Ninguna diferencia.");
  else {
    console.log(`⚠️ ${difs.length} diferencia(s):`);
    for (const d of difs) console.log("  " + d);
    Deno.exit(1);
  }
} else {
  throw new Error("Uso: recompte.ts produccio | local | comparar");
}
