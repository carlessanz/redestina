// El historial de migraciones de PRODUCCIÓN frente a los ficheros del repo (07-10-2026).
//
// Dos modos, los dos por la API de gestión (HTTPS), como aplicar-migracion.ts:
//
//   deno run -A scripts/historial-migraciones.ts comparar
//     Solo lectura. Lista las versiones registradas en producción que no tienen fichero en
//     el repo, y los ficheros del repo que producción no tiene registrados. Lo correcto es
//     «0 y 0» (o, como mucho, migraciones nuevas del repo pendientes de aplicar).
//
//   deno run -A scripts/historial-migraciones.ts renumerar [--aplicar]
//     Cambia la VERSIÓN registrada de las 22 migraciones que llevaban la fecha real del
//     21/22-09-2026 a la que tienen ahora en el repo (20270328100100…102200). Es metadata
//     del historial: el esquema y los datos no se tocan. Sin --aplicar solo enseña qué
//     haría. Con --aplicar va en UNA transacción y antes comprueba que las 22 viejas
//     existen y que ninguna nueva está ocupada; si algo no cuadra, no cambia nada.
//
// POR QUÉ (deuda 125, AGENTS.md §12). Aquellas 22 se renombraron a su fecha real al
// aplicarlas por MCP, y eso las puso por delante de tablas que usan: el repo no podía
// reconstruir producción desde cero. En producción se aplicaron justo después de
// 20270328100000 y antes de 20270329100000 (lo dice git), así que ese hueco es su sitio.
//
// Uso: dentro de la sesión temporal (AGENTS.md §11), que exporta SUPABASE_ACCESS_TOKEN.

const REF = "uxppvaldhptdomvdhsmn";
const token = Deno.env.get("SUPABASE_ACCESS_TOKEN");
const modo = Deno.args[0];
const aplicar = Deno.args.includes("--aplicar");

if (!token) throw new Error("Falta SUPABASE_ACCESS_TOKEN: abre antes bash scripts/sesion-supabase-temporal.sh");
if (modo !== "comparar" && modo !== "renumerar") {
  throw new Error("Uso: historial-migraciones.ts comparar | renumerar [--aplicar]");
}

// [versión vieja, versión nueva, nombre]. El orden es el real de aplicación.
const RENUMERACION: [string, string, string][] = [
  ["20260921153439", "20270328100100", "borrar_ficha_completa"],
  ["20260921160536", "20270328100200", "confirmacio_assistida"],
  ["20260921160749", "20270328100300", "interes_assistit"],
  ["20260921160920", "20270328100400", "canalitzacio_assistida_lectura"],
  ["20260921161008", "20270328100500", "firma_assistida_sense_codi"],
  ["20260921171041", "20270328100600", "canalitzacions_actives_ambigua"],
  ["20260921211329", "20270328100700", "certificat_sense_factura"],
  ["20260921211356", "20270328100800", "emitir_certificados_cierre"],
  ["20260921214526", "20270328100900", "provisionals_nomes_en_real"],
  ["20260921221806", "20270328101000", "producte_al_camp"],
  ["20260921223245", "20270328101100", "certificat_recepcio"],
  ["20260921223246", "20270328101200", "rpc_certificat_recepcio"],
  ["20260921231946", "20270328101300", "questionaris_diagnostic"],
  ["20260921231947", "20270328101400", "mesures_i_regles"],
  ["20260921231948", "20270328101500", "planes_mesures"],
  ["20260921231949", "20270328101600", "diagnostic_provisional_seed"],
  ["20260921231950", "20270328101700", "rpc_diagnostic"],
  ["20260922014315", "20270328101800", "organitzacions_candidates_nif_i_nom"],
  ["20260922014517", "20270328101900", "organitzacions_candidates_similitud_nomes_si_conta"],
  ["20260922025820", "20270328102000", "borrar_fitxa_purga_whitelist"],
  ["20260922025838", "20270328102100", "limpiar_periodes_borrador"],
  ["20260922124240", "20270328102200", "rls_excedentes_de_les_meves_canalitzacions"],
];

async function consulta<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const cos = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${cos}`);
  return JSON.parse(cos) as T[];
}

const remotas = (await consulta<{ version: string; name: string | null }>(
  "select version, name from supabase_migrations.schema_migrations order by version",
));
const versionsRemotas = new Map(remotas.map((r) => [r.version, r.name ?? ""]));

if (modo === "comparar") {
  const locals = new Map<string, string>();
  for await (const e of Deno.readDir(new URL("../supabase/migrations/", import.meta.url))) {
    const m = e.name.match(/^(\d{14})_(.+)\.sql$/);
    if (m) locals.set(m[1], m[2]);
  }
  const nomesRemot = [...versionsRemotas.keys()].filter((v) => !locals.has(v)).sort();
  const nomesLocal = [...locals.keys()].filter((v) => !versionsRemotas.has(v)).sort();
  console.log(`Producción: ${versionsRemotas.size} registradas · repo: ${locals.size} ficheros`);
  console.log(`\nRegistradas en producción SIN fichero en el repo (${nomesRemot.length}):`);
  for (const v of nomesRemot) console.log(`  ${v} ${versionsRemotas.get(v)}`);
  console.log(`\nFicheros del repo SIN registrar en producción (${nomesLocal.length}):`);
  for (const v of nomesLocal) console.log(`  ${v} ${locals.get(v)}`);
  Deno.exit(0);
}

// renumerar
const faltan = RENUMERACION.filter(([vella]) => !versionsRemotas.has(vella));
const ocupades = RENUMERACION.filter(([, nova]) => versionsRemotas.has(nova));
const jaFetes = RENUMERACION.filter(([vella, nova]) => !versionsRemotas.has(vella) && versionsRemotas.has(nova));

if (jaFetes.length === RENUMERACION.length) {
  console.log("Las 22 ya están renumeradas en producción. No hay nada que hacer.");
  Deno.exit(0);
}
if (faltan.length > 0 || ocupades.length > 0) {
  console.error("⛔ El historial no está como se esperaba. No se cambia nada.");
  for (const [v, , n] of faltan) console.error(`  falta la versión vieja ${v} (${n})`);
  for (const [, v, n] of ocupades) console.error(`  la versión nueva ${v} ya existe (${n})`);
  Deno.exit(1);
}

for (const [vella, nova, nom] of RENUMERACION) console.log(`  ${vella} → ${nova}  ${nom}`);

if (!aplicar) {
  console.log("\nSin --aplicar: no se ha cambiado nada. Repite con --aplicar para hacerlo.");
  Deno.exit(0);
}

const updates = RENUMERACION.map(([vella, nova]) =>
  `update supabase_migrations.schema_migrations set version = '${nova}' where version = '${vella}';`
).join("\n");
// La comprobación final dentro de la transacción: si no quedan exactamente las 22 nuevas,
// la excepción deshace todo.
const nuevas = RENUMERACION.map(([, n]) => `'${n}'`).join(",");
await consulta(
  `begin;\n${updates}\n` +
    `do $$ begin if (select count(*) from supabase_migrations.schema_migrations where version in (${nuevas})) <> ${RENUMERACION.length} ` +
    `then raise exception 'renumeració incompleta'; end if; end $$;\ncommit;`,
);
console.log(`\nHecho: ${RENUMERACION.length} versiones renumeradas en producción.`);
