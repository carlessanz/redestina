// El albarán de una página (fase 3 de la revisión del 08-10-2026). Prueba de Deno —no de
// Vitest—, porque el renderizador importa `npm:pdf-lib` y las fuentes incrustadas:
//
//   deno test -A --config supabase/functions/generar-documento/deno.json tests/pdf/albara1p.test.ts
//
// Con `PDF_SORTIDA=<carpeta>` deja además los tres PDF para mirarlos.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { cargarActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";
import * as INCRUSTATS from "../../supabase/functions/generar-documento/activos/incrustats.ts";
import { importDeLinea, kgDeLinea, renderAlbara1p } from "../../supabase/functions/_shared/pdf/render/albara1p.ts";
import type { DatosAlbara1p } from "../../supabase/functions/_shared/pdf/render/albara1p.ts";

const activos = cargarActivos(INCRUSTATS);

const FUNDACIO = { razon_social: "Fundació Espigoladors", nif: "G66264953", domicilio: "Carrer de Premià, 15, Barcelona" };
const BASE: DatosAlbara1p = {
  format: "albara-1p", idioma: "ca", ejercici: 2026, emes_at: "2026-10-10T10:00:00",
  data_elaboracio: "2026-10-10", fundacio: FUNDACIO,
  recollida: { fecha_hora: "2026-10-10T08:00:00Z", lugar: "Mas Prats · Maresme" },
};

const REC: DatosAlbara1p = {
  ...BASE, tipus: "REC", numero: "REC-2026-00320", modalitat: "donacio", tipus_entrada: "donacio",
  partes: {
    entrega: { razon_social: "Emiliu Ribes", domicilio: "Carrer de Prova, 1, 08850, Sant Agustí de Lluçanès", nif: "J58114265" },
    recibe: FUNDACIO,
  },
  linies: [{ ordre: 1, producte: "Cogombre", kg_net: 107, kg_previstos: 107, valor_kg: 1.06 }],
};

Deno.test("kilos e importe de una línea (los del modelo: 107 kg × 1,06 = 113,42 €)", () => {
  assertEquals(kgDeLinea({ kg_validats: 100, kg_net: 107 }), 100);
  assertEquals(importDeLinea({ kg_net: 107, valor_kg: 1.06 }), 113.42);
  assertEquals(importDeLinea({ kg_net: 107 }), null);
});

async function render(nom: string, datos: DatosAlbara1p, extra: Record<string, unknown> = {}) {
  const r = await renderAlbara1p(activos, { datos, sha256Datos: "ab".repeat(32), modo: "real", ...extra });
  const dir = Deno.env.get("PDF_SORTIDA");
  if (dir) await Deno.writeFile(`${dir}/${nom}.pdf`, r.bytes);
  return r;
}

Deno.test("el REC de donación cabe en UNA página y lleva euros", async () => {
  const r = await render("rec-donacio", REC, {
    confirmaciones: [{ nombre: "Emiliu Ribes", at: "2026-10-10T10:30:00Z", canal: "email", rol: "entrega", referencia: "1a2b3c4d" }],
  });
  assertEquals(r.paginas, 1);
  assert(r.bytes.length < 200_000);
});

Deno.test("el ENT y la venta (OPE) caben en una página, sin euros", async () => {
  const ent = await render("ent", {
    ...BASE, tipus: "ENT", numero: "ENT-2026-00041", modalitat: "donacio",
    partes: { entrega: FUNDACIO, recibe: { razon_social: "Banc de Prova", nif: "G12345678", domicilio: "Vic" },
      origen: { municipio: "Mataró", comarca: "Maresme", codigo_lote: "L-2026-0041" } },
    linies: [{ ordre: 1, producte: "Cogombre", kg_previstos: 107, kg_confirmats: 100 }],
  });
  assertEquals(ent.paginas, 1);
  const ope = await render("ope-venda", {
    ...BASE, tipus: "OPE", numero: "OPE-2026-00007", modalitat: "venda",
    partes: { entrega: REC.partes!.entrega, recibe: { razon_social: "Empresa Compradora SL", nif: "B12345678" } },
    linies: [{ ordre: 1, producte: "Tomàquet", varietat: "Pera", kg_previstos: 300 }],
  }, { modo: "prueba" });
  assertEquals(ope.paginas, 1);
});

Deno.test("con muchas líneas (una espigolada grande) sigue saliendo, en más páginas", async () => {
  const linies = Array.from({ length: 40 }, (_, i) => ({ ordre: i + 1, producte: `Producte ${i + 1}`, kg_net: 10, valor_kg: 0.5 }));
  const r = await render("rec-llarg", { ...REC, linies });
  assert(r.paginas >= 2);
});
