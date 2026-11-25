// Fixture de las ofertas multiproducto (fase 6, proceso 3.3; 20270620100000–100600).
//
//   eval "$(bash scripts/local/entorno-local.sh)"
//   deno run -A scripts/crear-multiproducte-prova.ts [--dry-run]
//
// QUÉ CREA. Lo mínimo para que las lecturas «permitir» del arnés (`scripts/comprobar-rls.ts`,
// bloques `MULTIPRODUCTE_*`) signifiquen algo —con RLS, 0 filas es indistinguible de «la política
// me bloquea»—:
//   · una DISPONIBILIDAD de `TEST-PROD-1` con dos ofertas publicadas (`E-991231-TST-MUL-1/2`:
//     Carbassa en donació; Ceba en donació y venda), por `crear_disponibilitat()` igual que
//     `crear-oferta`;
//   · una SOLICITUD PENDIENTE de `TEST-ENT-SOCIAL` sobre la primera (asistida, por
//     `manifestar_interes_multiple_assistit()`), con la recogida dentro de 30 días.
// Así el productor ve su disponibilidad, la entidad social su solicitud, la comercial la
// disponibilidad (por la oferta de venta) y el equipo las dos tablas.
//
// TODO LO QUE TOCA ES `TEST-*` y `es_test`: si alguna de las dos fichas no lo es, se niega.
// No crea avisos ni manda nada (un interés asistido no avisa; la oferta nace `publicada` con
// `origen = 'asistido'`, sin pasar por validación).
//
// IDEMPOTENTE: la clave es el `id_excedente` `E-991231-TST-MUL-1`. Si ya existe, no crea nada.
// Para volver a empezar, en el clon, se borran a mano (no tienen albaranes ni números fiscales).

import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY en el entorno.");
  Deno.exit(1);
}
const dryRun = Deno.args.includes("--dry-run");

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const CLAU = "E-991231-TST-MUL-1";

async function fitxa(tabla: "productores" | "entidades", codigo: string): Promise<string> {
  const { data, error } = await db.from(tabla).select("id, codigo, es_test").eq("codigo", codigo).maybeSingle();
  if (error) throw new Error(`${tabla}/${codigo}: ${error.message}`);
  if (!data) {
    console.error(`No existe ${tabla} con codigo ${codigo}. Ejecuta antes scripts/crear-usuarios-prueba.ts`);
    Deno.exit(1);
  }
  if (!data.es_test) {
    console.error(`${tabla}/${codigo} no es es_test: no se toca.`);
    Deno.exit(1);
  }
  return data.id as string;
}

/** Fecha de Madrid (AAAA-MM-DD) dentro de `dies` días. */
function dataMadrid(dies: number): string {
  const d = new Date(Date.now() + dies * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(d);
}

const { data: existent } = await db.from("excedentes")
  .select("id, disponibilitat_id").eq("id_excedente", CLAU).maybeSingle();
if (existent) {
  console.log(`Ja existeix ${CLAU} (disponibilitat ${existent.disponibilitat_id ?? "—"}): no es crea res.`);
  Deno.exit(0);
}

const productor = await fitxa("productores", "TEST-PROD-1");
const social = await fitxa("entidades", "TEST-ENT-SOCIAL");

const disponibleFins = dataMadrid(60);
const fila = (n: number, producto: string, kg: number, modalitats: string[]) => ({
  id_excedente: `E-991231-TST-MUL-${n}`,
  producto,
  kg_total: kg,
  modalitat: modalitats[0],
  modalitats,
  preu_minim: modalitats.includes("venda") ? 0.3 : null,
  disponible_hasta: disponibleFins,
  texto_oferta: `TEST multiproducte — ${producto} (${kg} kg)`,
  origen: "asistido",
});
const ofertes = [fila(1, "Carbassa", 50, ["donacio"]), fila(2, "Ceba", 40, ["donacio", "venda"])];

console.log(`Disponibilitat de TEST-PROD-1 amb ${ofertes.length} ofertes (fins al ${disponibleFins}).`);
console.log(`Sol·licitud pendent de TEST-ENT-SOCIAL sobre ${ofertes[0].producto}.`);
if (dryRun) {
  console.log("--dry-run: no s'escriu res.");
  Deno.exit(0);
}

const { data: disp, error: e1 } = await db.rpc("crear_disponibilitat", {
  p_productor: productor,
  p_ofertes: ofertes,
});
if (e1) {
  console.error("crear_disponibilitat:", e1.code, e1.message);
  Deno.exit(1);
}
const d = disp as { disponibilitat_id: string; codi: string; ofertes: { id: string; producto: string }[] };
console.log(`  ✓ ${d.codi} (${d.disponibilitat_id})`);

const recollida = new Date(`${dataMadrid(30)}T10:00:00+01:00`).toISOString();
const { data: sol, error: e2 } = await db.rpc("manifestar_interes_multiple_assistit", {
  p_disponibilitat: d.disponibilitat_id,
  p_entidad: social,
  p_linies: [{ excedente_id: d.ofertes[0].id, kg: 10 }],
  p_recollida_at: recollida,
});
if (e2) {
  // Sin convenio vigente de la entidad (p. ej. en producción) la solicitud no se puede crear: la
  // disponibilidad queda igual y las lecturas de `sollicituds_recollida` salen SALTADAS.
  console.error("manifestar_interes_multiple_assistit:", e2.code, e2.message);
  Deno.exit(1);
}
console.log(`  ✓ sol·licitud ${(sol as { sollicitud_id: string }).sollicitud_id} (pendent)`);
