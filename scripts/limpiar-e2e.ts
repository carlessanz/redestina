// Retira lo que dejan las pruebas E2E (transversal I2 del plan del 05-10-2026).
//
//   SUPABASE_URL=… SB_SECRET_KEY=… deno run -A scripts/limpiar-e2e.ts [--dry-run]
//
// Dos cosas, y en este orden:
//   1. Las ofertas con «[E2E]» al principio de las observaciones que sigan abiertas se
//      CANCELAN (no se borran: una oferta con canalizaciones o albaranes es evidencia).
//   2. Las fichas cuyo nombre empieza por «E2E-» se borran con `borrar_ficha_completa()`,
//      que es la única puerta (§7). Si la base se niega (`bloqueig_esborrat`), se LISTA el
//      motivo y se sigue: un albarán emitido no se borra nunca.

import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Calen SUPABASE_URL i SB_SECRET_KEY.");
  Deno.exit(1);
}
const dryRun = Deno.args.includes("--dry-run");
const sb = createClient(url, key);

const { data: ofertes, error: errOf } = await sb.from("excedentes")
  .select("id, id_excedente, estado")
  .like("observacions", "[E2E]%")
  .in("estado", ["borrador", "pendent_validacio", "publicada", "parcial", "bloqueada"]);
if (errOf) { console.error("excedentes:", errOf.message); Deno.exit(1); }
for (const o of ofertes ?? []) {
  console.log(`${dryRun ? "[dry-run] " : ""}cancel·la ${o.id_excedente} (${o.estado})`);
  if (!dryRun) {
    const { error } = await sb.from("excedentes")
      .update({ estado: "cancelada", motivo_no_colocada: "Prova E2E" }).eq("id", o.id);
    if (error) console.error(`  ✗ ${error.message}`);
  }
}

for (const tipus of ["productor", "entidad"] as const) {
  const taula = tipus === "productor" ? "productores" : "entidades";
  const camp = tipus === "productor" ? "name" : "nombre";
  const { data: fitxes } = await sb.from(taula).select(`id, ${camp}`).like(camp, "E2E-%");
  for (const f of (fitxes ?? []) as Record<string, string>[]) {
    console.log(`${dryRun ? "[dry-run] " : ""}esborra ${tipus} ${f[camp]}`);
    if (dryRun) continue;
    const { error } = await sb.rpc("borrar_ficha_completa", { p_tipo: tipus, p_ficha_id: f.id });
    if (error) console.error(`  ✗ no s'ha pogut esborrar: ${error.message}${error.details ? ` (${error.details})` : ""}`);
  }
}
console.log("Fet.");
