// El XLS real de Gencat («Preus percebuts pel pagès», el del 12-11-2026, datos públicos) leído
// como lo lee la Edge Function `preus-fonts`: SheetJS → filas → `llegeixGencat()`. Prueba de
// Deno porque el lector es `npm:xlsx` (Vitest no resuelve `npm:`).
//
//   deno test -A --config supabase/functions/preus-fonts/deno.json tests/preus/

import { assert, assertEquals } from "jsr:@std/assert@1";
import * as XLSX from "xlsx";
import { llegeixGencat } from "../../supabase/functions/_shared/preusFonts.ts";

const bytes = await Deno.readFile(new URL("../fixtures/preus/gencat-preus-percebuts-2026-11-12.xls", import.meta.url));
const llibre = XLSX.read(bytes, { type: "array" });
const fulls = llibre.SheetNames.map((nom) => ({
  nom,
  files: XLSX.utils.sheet_to_json(llibre.Sheets[nom], { header: 1, raw: true, defval: null }) as unknown[][],
}));
const r = llegeixGencat(fulls);

Deno.test("el libro tiene 15 hojas y la primera es la nota metodológica", () => {
  assertEquals(llibre.SheetNames.length, 15);
  assertEquals(llibre.SheetNames[0], "NOTA METODOLÒGICA");
});

Deno.test("solo guarda filas de peso, convertidas a €/kg", () => {
  assert(r.observats.length > 1500, `observacions: ${r.observats.length}`);
  assert(r.observats.every((o) => o.eur_kg !== null && o.eur_kg > 0));
  assert(r.observats.every((o) => o.unitat === "€/100 kg" || o.unitat === "€/kg"));
  // Vino (€/100 litres), flores y ganado (€/100kg viu) quedan fuera.
  assert(r.ignorats.some((i) => i.unitat === "€/100 Litres"));
  assert(r.ignorats.some((i) => i.unitat === "€/100kg viu"));
  assert(!r.observats.some((o) => o.unitat === "€/100kg viu"));
});

Deno.test("Poma, septiembre de 2026: 68,58 €/100 kg → 0,6858 €/kg", () => {
  const o = r.observats.find((x) => x.codi_font === "052111" && x.exercici === 2026 && x.mes === 9);
  assert(o);
  assertEquals(o.nom_font, "Poma consum en fresc");
  assertEquals(o.eur_kg, 0.6858);
  // Octubre todavía no está publicado (el fichero va con retraso).
  assert(!r.observats.some((x) => x.codi_font === "052111" && x.exercici === 2026 && x.mes === 10));
});

Deno.test("los meses sin mercado («-») no se guardan", () => {
  // Arròs: solo octubre y noviembre en 2020.
  const arros = r.observats.filter((x) => x.codi_font === "002000" && x.exercici === 2020);
  assertEquals(arros.map((x) => x.mes), [10, 11]);
});

Deno.test("el último mes con datos es septiembre de 2026", () => {
  assertEquals(r.fins, { exercici: 2026, mes: 9 });
});

Deno.test("cubre los productos de fruta y hortaliza que siembran las equivalencias", () => {
  const codis = new Set(r.observats.map((o) => o.codi_font));
  for (
    const c of ["002000", "051115", "051200", "052111", "052211", "052311", "052410", "052499", "052500", "052600",
      "052701", "052900", "053100", "053200", "054010", "054015", "054020", "054030", "054049", "054061", "054070",
      "054085", "054105", "054135", "054150", "054165", "054170", "054190", "054210"]
  ) assert(codis.has(c), `falta ${c}`);
});
