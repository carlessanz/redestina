// Aplica UNA migración en el proyecto remoto por la API de gestión de Supabase, y la registra
// en `supabase_migrations.schema_migrations` con el número del fichero, en la misma
// transacción.
//
// POR QUÉ EXISTE (27-09-2026). `supabase db push` abre una conexión Postgres directa al
// pooler, que el sandbox de las sesiones de Claude Code no deja salir, y `apply_migration`
// del MCP registra la migración con la FECHA REAL en lugar del número del fichero (§7), lo
// que obliga a renombrar. La API de gestión va por HTTPS y deja escribir el registro a mano:
// el repo y el historial remoto quedan casados 1:1 sin tocar el nombre de nada.
//
// Uso (el token es uno personal de la cuenta de Redestina; en esta máquina vive en el
// llavero como «Supabase Redestina»):
//
//   SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase Redestina" -w) \
//     deno run -A scripts/aplicar-migracion.ts supabase/migrations/<fichero>.sql [--dry-run]
//
// ⚠️ Es producción: la única base del proyecto es la remota (§7). El `--dry-run` enseña qué
//    haría y si la versión ya está registrada, sin ejecutar nada.

const REF = "uxppvaldhptdomvdhsmn";
const token = Deno.env.get("SUPABASE_ACCESS_TOKEN");
const fichero = Deno.args.find((a) => !a.startsWith("--"));
const dryRun = Deno.args.includes("--dry-run");

if (!token) throw new Error("Falta SUPABASE_ACCESS_TOKEN");
if (!fichero) throw new Error("Uso: aplicar-migracion.ts <fichero.sql> [--dry-run]");

const nombre = fichero.split("/").pop()!;
const m = nombre.match(/^(\d{14})_(.+)\.sql$/);
if (!m) throw new Error(`El fichero no tiene el formato AAAAMMDDHHMMSS_nombre.sql: ${nombre}`);
const [, version, nom] = m;

async function consulta(sql: string): Promise<unknown> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const cos = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${cos}`);
  return JSON.parse(cos);
}

const ja = await consulta(
  `select 1 from supabase_migrations.schema_migrations where version = '${version}'`,
) as unknown[];
if (ja.length > 0) {
  console.log(`${version} ya está registrada en remoto: no se aplica otra vez.`);
  Deno.exit(0);
}

const sql = await Deno.readTextFile(fichero);
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const transaccio =
  `begin;\n${sql}\n;\n` +
  `insert into supabase_migrations.schema_migrations (version, name, statements) ` +
  `values (${literal(version)}, ${literal(nom)}, array[${literal(sql)}]);\ncommit;`;

if (dryRun) {
  console.log(`Aplicaría ${nombre} (${sql.length} caracteres) y la registraría como ${version}.`);
  Deno.exit(0);
}

const res = await consulta(transaccio);
console.log(`Aplicada y registrada: ${version} ${nom}`, JSON.stringify(res));
