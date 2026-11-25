// La caja «Per Espigoladors» del albarán de una página (fase 0, dic. 2026): la persona del
// equipo que validó o emitió el albarán, congelada en el snapshot (`signant_equip`), con su
// firma si la tenía guardada. Prueba de Deno, como albara1p_test.ts.
//
//   deno test -A --config supabase/functions/generar-documento/deno.json tests/pdf/albara1p_equip_test.ts
//
// Con `PDF_SORTIDA=<carpeta>` deja los PDF para mirarlos.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { PDFDocument } from "npm:pdf-lib@1";
import { cargarActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";
import * as INCRUSTATS from "../../supabase/functions/generar-documento/activos/incrustats.ts";
import {
  type DatosAlbara1p,
  renderAlbara1p,
  signantEquipDe,
} from "../../supabase/functions/_shared/pdf/render/albara1p.ts";
import { embeberImatgeFirma } from "../../supabase/functions/_shared/pdf/render/signatura.ts";
import { enUnaLinia, textPerPagina } from "./textPdf.ts";

const activos = cargarActivos(INCRUSTATS);

// Un PNG de 1×1 válido: basta para comprobar que se embebe y se pinta.
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

const FUNDACIO = { razon_social: "Fundació Espigoladors", nif: "G66264953", domicilio: "Carrer de Premià, 15, Barcelona" };
const REC: DatosAlbara1p = {
  format: "albara-1p", idioma: "ca", ejercici: 2026, emes_at: "2026-12-01T10:00:00",
  data_elaboracio: "2026-12-01", fundacio: FUNDACIO, tipus: "REC", numero: "REC-2026-00400",
  modalitat: "donacio", tipus_entrada: "donacio",
  recollida: { fecha_hora: "2026-12-01T08:00:00Z", lugar: "Mas Prats · Maresme" },
  partes: {
    entrega: { razon_social: "Emiliu Ribes", domicilio: "Carrer de Prova, 1, Sant Agustí de Lluçanès", nif: "J58114265" },
    recibe: FUNDACIO,
  },
  linies: [{ ordre: 1, producte: "Cogombre", kg_net: 107, kg_validats: 107, valor_kg: 1.06 }],
};
const SIGNANT = { nom: "Laia Dinamitzadora", rol: "admin", firma_ruta: "equip/00000000-0000-0000-0000-000000000001/firma-1.png" };

async function render(nom: string, datos: DatosAlbara1p, extra: Record<string, unknown> = {}) {
  const r = await renderAlbara1p(activos, { datos, sha256Datos: "cd".repeat(32), modo: "real", ...extra });
  const dir = Deno.env.get("PDF_SORTIDA");
  if (dir) await Deno.writeFile(`${dir}/${nom}.pdf`, r.bytes);
  const tot = enUnaLinia((await textPerPagina(r.bytes, activos)).join("\n"));
  return { ...r, tot };
}

/** Imágenes embebidas (el logo cuenta una). */
function imatges(bytes: Uint8Array): number {
  return (new TextDecoder("latin1").decode(bytes).match(/\/Subtype \/Image/g) ?? []).length;
}

Deno.test("signantEquipDe: sin snapshot o vacío, null; con nombre o ruta, el firmante", () => {
  assertEquals(signantEquipDe(REC), null);
  assertEquals(signantEquipDe({ ...REC, signant_equip: null }), null);
  assertEquals(signantEquipDe({ ...REC, signant_equip: { nom: "  ", firma_ruta: null } }), null);
  assertEquals(signantEquipDe({ ...REC, signant_equip: SIGNANT })?.nom, "Laia Dinamitzadora");
});

Deno.test("sin `signant_equip`, el pie de siempre («Atentament, Equip de Redestina»)", async () => {
  const r = await render("rec-sense-signant", REC);
  assertEquals(r.paginas, 1);
  assert(r.tot.includes("Atentament,"), r.tot);
  assert(r.tot.includes("Equip de Redestina"), r.tot);
  assert(!r.tot.includes("Per Espigoladors"), r.tot);
});

Deno.test("con `signant_equip` y su firma: caja «Per Espigoladors», nombre, Fundació e imagen", async () => {
  const sense = await render("rec-signant-sense-firma", { ...REC, signant_equip: { ...SIGNANT, firma_ruta: null } });
  const amb = await render("rec-signant-amb-firma", { ...REC, signant_equip: SIGNANT }, { firmaEquipBytes: PNG_1X1 });
  for (const r of [sense, amb]) {
    assertEquals(r.paginas, 1);
    assert(r.tot.includes("Per Espigoladors"), r.tot);
    assert(r.tot.includes("Laia Dinamitzadora"), r.tot);
    assert(r.tot.includes("NIF G66264953"), r.tot);
    assert(!r.tot.includes("Equip de Redestina"), r.tot);
    // El rol de plataforma es interno: no se imprime.
    assert(!r.tot.includes("admin"), r.tot);
  }
  // Un PNG con canal alfa son dos objetos imagen (la imagen y su `SMask`): basta con que haya más.
  assert(imatges(amb.bytes) > imatges(sense.bytes), `${imatges(amb.bytes)} vs ${imatges(sense.bytes)}`);
});

Deno.test("una firma ilegible no impide emitir: la caja sale sin imagen", async () => {
  const r = await render("rec-signant-firma-dolenta", { ...REC, signant_equip: SIGNANT }, {
    firmaEquipBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  });
  assertEquals(r.paginas, 1);
  assert(r.tot.includes("Per Espigoladors"), r.tot);
  const doc = await PDFDocument.create();
  assertEquals(await embeberImatgeFirma(doc, new Uint8Array([1, 2, 3, 4])), null);
  assertEquals(await embeberImatgeFirma(doc, null), null);
});

Deno.test("en castellano, «Por Espigoladors»; ENT con la firma de la contraparte y OPE, en una página", async () => {
  const es = await render("rec-signant-es", { ...REC, idioma: "es", signant_equip: SIGNANT }, { firmaEquipBytes: PNG_1X1 });
  assertEquals(es.paginas, 1);
  assert(es.tot.includes("Por Espigoladors"), es.tot);

  const ent = await render("ent-signant-signat", {
    ...REC, tipus: "ENT", numero: "ENT-2026-00090", signant_equip: SIGNANT,
    partes: { entrega: FUNDACIO, recibe: { razon_social: "Banc de Prova", nif: "G12345678", domicilio: "Vic" },
      origen: { municipio: "Mataró", comarca: "Maresme" } },
    linies: [{ ordre: 1, producte: "Cogombre", kg_previstos: 107, kg_validats: 100 }],
  }, {
    firmaEquipBytes: PNG_1X1,
    signatura: { part: "receptor", nom: "Marta Puig", carrec: "Gerent", dni: null, data: "2026-12-01T09:30:00Z", trazoPng: PNG_1X1, canal: "panel" },
  });
  assertEquals(ent.paginas, 1);
  assert(ent.tot.includes("Per Espigoladors"), ent.tot);
  assert(ent.tot.includes("Signat per Marta Puig"), ent.tot);

  const ope = await render("ope-signant", {
    ...REC, tipus: "OPE", numero: "OPE-2026-00009", modalitat: "venda", signant_equip: SIGNANT,
    partes: { entrega: REC.partes!.entrega, recibe: { razon_social: "Empresa Compradora SL", nif: "B12345678" } },
    linies: [{ ordre: 1, producte: "Tomàquet", kg_previstos: 300 }],
  }, { firmaEquipBytes: PNG_1X1 });
  assertEquals(ope.paginas, 1);
  assert(ope.tot.includes("Conformitat de qui lliura:"), ope.tot);
});
