// El nombre de la Fundació sale del PROPIO documento (09-11-2026). Prueba de Deno, como
// albara1p_test.ts: los textos con valor legal y el pie de página usan la razón social del
// snapshot (`documentos.datos`, congelado desde Configuració › Fundació al emitir), nunca
// «Fundació Espigoladors» escrita a mano; sin ella en el snapshot (documentos antiguos),
// «Fundació Espigoladors». Con `PDF_SORTIDA=<carpeta>` deja los PDF para mirarlos.
//
//   deno test -A --config supabase/functions/generar-documento/deno.json tests/pdf/fundacio_test.ts

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { cargarActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";
import * as INCRUSTATS from "../../supabase/functions/generar-documento/activos/incrustats.ts";
import {
  FUNDACIO_PER_DEFECTE,
  nomFundacio,
  peuFundacio,
} from "../../supabase/functions/_shared/pdf/fundacio.ts";
import type { Renderizado } from "../../supabase/functions/_shared/pdf/render/comu.ts";
import type { DatosAlbaran } from "../../supabase/functions/_shared/pdf/render/comu.ts";
import { renderRec } from "../../supabase/functions/_shared/pdf/render/rec.ts";
import { renderEnt } from "../../supabase/functions/_shared/pdf/render/ent.ts";
import { renderAlbara1p, type DatosAlbara1p } from "../../supabase/functions/_shared/pdf/render/albara1p.ts";
import { renderConv } from "../../supabase/functions/_shared/pdf/render/conv.ts";
import { renderRes } from "../../supabase/functions/_shared/pdf/render/res.ts";
import { renderCr } from "../../supabase/functions/_shared/pdf/render/cr.ts";
import { renderPla } from "../../supabase/functions/_shared/pdf/render/pla.ts";
import { renderExpedient } from "../../supabase/functions/_shared/pdf/render/expedient.ts";
import { enUnaLinia, textPerPagina } from "./textPdf.ts";

const activos = cargarActivos(INCRUSTATS);

const NOVA = "Fundació Nova de Prova";
// La que siembra `parametros_documentales` mientras no hay datos reales: larga y con guion largo.
const LLARGA = "PROVISIONAL — pendent de la raó social real de la Fundació";

async function text(nom: string, r: Renderizado): Promise<string> {
  const dir = Deno.env.get("PDF_SORTIDA");
  if (dir) await Deno.writeFile(`${dir}/fundacio-${nom}.pdf`, r.bytes);
  return enUnaLinia((await textPerPagina(r.bytes, activos)).join("\n"));
}

// ---------------------------------------------------------------------------
// La función pura: todas las variantes de clave del SQL
// ---------------------------------------------------------------------------

Deno.test("nomFundacio entiende las claves de cada snapshot", () => {
  // CD, CR, CT, RES, PLA, expediente
  assertEquals(nomFundacio({ fundacio: { "raó_social": NOVA, cif: "G1" } }), NOVA);
  // CONV
  assertEquals(nomFundacio({ fundacio: { raso_social: NOVA } }), NOVA);
  // albarán de una página
  assertEquals(nomFundacio({ tipus: "ENT", fundacio: { razon_social: NOVA } }), NOVA);
  // albaranes antiguos: la parte que es la Fundació
  assertEquals(nomFundacio({ tipus: "REC", partes: { entrega: { razon_social: "Mas" }, recibe: { razon_social: NOVA } } }), NOVA);
  assertEquals(nomFundacio({ tipus: "R-REC", partes: { recibe: { razon_social: NOVA } } }), NOVA);
  assertEquals(nomFundacio({ tipus: "ENT", partes: { entrega: { razon_social: NOVA }, recibe: { razon_social: "Banc" } } }), NOVA);
  // el `fundacio` del snapshot manda sobre la parte
  assertEquals(nomFundacio({ tipus: "REC", fundacio: { razon_social: NOVA }, partes: { recibe: { razon_social: "Altra" } } }), NOVA);
});

Deno.test("nomFundacio, sin razón social: «Fundació Espigoladors»", () => {
  assertEquals(FUNDACIO_PER_DEFECTE, "Fundació Espigoladors");
  for (const d of [
    null, undefined, "x", {}, { fundacio: null }, { fundacio: { "raó_social": "   " } },
    { fundacio: { cif: "G1" } },
    // En el OPE la Fundació no es parte: no se toma ninguna de las dos.
    { tipus: "OPE", partes: { entrega: { razon_social: "Mas" }, recibe: { razon_social: "Obrador" } } },
  ]) {
    assertEquals(nomFundacio(d), FUNDACIO_PER_DEFECTE);
  }
  assertEquals(peuFundacio({}), "Fundació Espigoladors · REDESTINA");
  assertEquals(peuFundacio({ fundacio: { raso_social: NOVA } }), `${NOVA} · REDESTINA`);
});

// ---------------------------------------------------------------------------
// Albaranes antiguos (REC y ENT): la cláusula legal y el pie
// ---------------------------------------------------------------------------

const MAS = { razon_social: "Mas de Prova SCP", nif: "B00000001", domicilio: "Carrer de Prova, 2" };
const BANC = { razon_social: "Banc de Prova", nif: "G12345678", domicilio: "Vic" };

function rec(fundacio: string | null): DatosAlbaran {
  return {
    tipus: "REC", numero: "REC-2026-00001", ejercici: 2026, idioma: "ca", emes_at: "2026-10-10T10:00:00Z",
    tipus_entrada: "donacio",
    partes: { entrega: MAS, recibe: { razon_social: fundacio, nif: "G66264953" } },
    linies: [{ ordre: 1, producte: "Cogombre", kg_net: 107, kg_previstos: 107 }],
  };
}

function ent(fundacio: string | null): DatosAlbaran {
  return {
    tipus: "ENT", numero: "ENT-2026-00001", ejercici: 2026, idioma: "ca", emes_at: "2026-10-10T10:00:00Z",
    partes: { entrega: { razon_social: fundacio, nif: "G66264953" }, recibe: BANC,
      origen: { municipio: "Mataró", comarca: "Maresme", codigo_lote: "L-1" } },
    linies: [{ ordre: 1, producte: "Cogombre", kg_previstos: 107, kg_confirmats: 100 }],
  };
}

Deno.test("REC antiguo: la cláusula y el pie llevan la razón social del snapshot", async () => {
  const t = await text("rec-nova", await renderRec(activos, { datos: rec(NOVA), modo: "real" }));
  assertStringIncludes(t, `El generador lliura a ${NOVA}, amb NIF G66264953`);
  assertStringIncludes(t, `${NOVA} · REDESTINA · REC-2026-00001`);
  assert(!t.includes("lliura a la Fundació Espigoladors"), "el nombre escrito a mano ya no sale");
  assert(!t.includes("Fundació Espigoladors · REDESTINA"));
});

Deno.test("REC antiguo en castellano", async () => {
  const t = await text("rec-nova-es", await renderRec(activos, { datos: { ...rec(NOVA), idioma: "es" }, modo: "real" }));
  assertStringIncludes(t, `El generador entrega a ${NOVA}, con NIF G66264953`);
});

Deno.test("REC antiguo sin razón social: «Fundació Espigoladors»", async () => {
  const t = await text("rec-sense", await renderRec(activos, { datos: rec(null), modo: "real" }));
  assertStringIncludes(t, "El generador lliura a Fundació Espigoladors, amb NIF G66264953");
  assertStringIncludes(t, "Fundació Espigoladors · REDESTINA · REC-2026-00001");
});

Deno.test("ENT antiguo: «<razón social> entrega gratuïtament» y el pie", async () => {
  const t = await text("ent-nova", await renderEnt(activos, { datos: ent(NOVA), modo: "real" }));
  assertStringIncludes(t, `${NOVA} entrega gratuïtament a l'entitat receptora`);
  assertStringIncludes(t, `${NOVA} · REDESTINA · ENT-2026-00001`);
  const es = await text("ent-nova-es", await renderEnt(activos, { datos: { ...ent(NOVA), idioma: "es" }, modo: "real" }));
  assertStringIncludes(es, `${NOVA} entrega gratuitamente a la entidad receptora`);
});

Deno.test("ENT antiguo sin razón social: «Fundació Espigoladors entrega»", async () => {
  const t = await text("ent-sense", await renderEnt(activos, { datos: ent(null), modo: "real" }));
  assertStringIncludes(t, "Fundació Espigoladors entrega gratuïtament a l'entitat receptora");
});

Deno.test("REC y ENT antiguos con la razón social provisional larga: salen y la cláusula la lleva", async () => {
  const r = await text("rec-llarga", await renderRec(activos, { datos: rec(LLARGA), modo: "prueba" }));
  assertStringIncludes(r, `El generador lliura a ${LLARGA}, amb NIF`);
  const e = await text("ent-llarga", await renderEnt(activos, { datos: ent(LLARGA), modo: "prueba" }));
  assertStringIncludes(e, `${LLARGA} entrega gratuïtament`);
});

// ---------------------------------------------------------------------------
// Albarán de una página: con la razón social larga sigue cabiendo en UNA
// ---------------------------------------------------------------------------

Deno.test("albarà d'una pàgina: con la razón social provisional larga, REC y ENT en una página", async () => {
  const fund = { razon_social: LLARGA, nif: "G00000000", domicilio: "PROVISIONAL — pendent del domicili real de la Fundació" };
  const base: DatosAlbara1p = {
    format: "albara-1p", idioma: "ca", ejercici: 2026, emes_at: "2026-10-10T10:00:00",
    data_elaboracio: "2026-10-10", fundacio: fund, recollida: { fecha_hora: "2026-10-10T08:00:00Z", lugar: "Mas" },
  };
  const datosRec: DatosAlbara1p = { ...base, tipus: "REC", numero: "REC-2026-00320", modalitat: "donacio", tipus_entrada: "donacio",
      partes: { entrega: MAS, recibe: fund },
    linies: [{ ordre: 1, producte: "Cogombre", kg_net: 107, kg_previstos: 107, valor_kg: 1.06 }] };
  const r = await renderAlbara1p(activos, { datos: datosRec, sha256Datos: "ab".repeat(32), modo: "prueba" });
  assertEquals(r.paginas, 1);
  const datosEnt: DatosAlbara1p = { ...base, tipus: "ENT", numero: "ENT-2026-00041", modalitat: "donacio",
    partes: { entrega: fund, recibe: BANC, origen: { municipio: "Mataró", codigo_lote: "L-1" } },
    linies: [{ ordre: 1, producte: "Cogombre", kg_previstos: 107, kg_confirmats: 100 }] };
  const e = await renderAlbara1p(activos, { datos: datosEnt, sha256Datos: "ab".repeat(32), modo: "prueba" });
  assertEquals(e.paginas, 1);
  assertStringIncludes(await text("a1p-ent-llarga", e), LLARGA);
});

// ---------------------------------------------------------------------------
// Convenio: «Per <razón social>», el aviso de contrafirma y el pie
// ---------------------------------------------------------------------------

function conv(fundacio: Record<string, unknown>) {
  return {
    tipus: "col_productor", numero: "CONV-COL-PRO-2026-0001", ejercici: 2026, idioma: "ca",
    organitzacio: { raso_social: "Mas de Prova SCP", nif: "B00000001", domicili: "Carrer de Prova, 2" },
    firmant: { nombre: "Na Prova", cargo: "Gerent" },
    firmat_at: "2026-10-27T10:00:00Z",
    fundacio,
    evidencies: [],
  };
}

Deno.test("convenio firmado: «Per <razón social>», «per part de <razón social>» y el pie", async () => {
  const t = await text("conv-nova", await renderConv(activos, { datos: conv({ raso_social: NOVA, cif: "G1" }), subtipo: "firmat" }, "ca"));
  assertStringIncludes(t, `Per ${NOVA}`);
  assertStringIncludes(t, `Pendent de contrasignatura per part de ${NOVA}.`);
  assertStringIncludes(t, `${NOVA} · REDESTINA · CONV-COL-PRO-2026-0001`);
  assert(!t.includes("Per la Fundació Espigoladors"));
  const es = await text("conv-nova-es", await renderConv(activos, { datos: conv({ raso_social: NOVA }), subtipo: "firmat" }, "es"));
  assertStringIncludes(es, `Por ${NOVA}`);
  assertStringIncludes(es, `Pendiente de contrafirma por parte de ${NOVA}.`);
});

Deno.test("convenio sin razón social: «Per Fundació Espigoladors»", async () => {
  const t = await text("conv-sense", await renderConv(activos, { datos: conv({}), subtipo: "firmat" }, "ca"));
  assertStringIncludes(t, "Per Fundació Espigoladors");
  assertStringIncludes(t, "Fundació Espigoladors · REDESTINA");
});

Deno.test("convenio con la razón social provisional larga: la firma la lleva entera, en dos líneas", async () => {
  const t = await text("conv-llarga", await renderConv(activos, {
    datos: { ...conv({ raso_social: LLARGA, apoderada_nom: "Persona de Prova", apoderada_carrec: "Apoderada" }),
      contrafirmat_at: "2026-10-27T10:30:00Z" },
    subtipo: "contrafirmat",
  }, "ca"));
  // Partida en dos líneas por el ancho de la columna: unidas por un espacio en el texto.
  assertStringIncludes(t, `Per ${LLARGA}`);
});

// ---------------------------------------------------------------------------
// Resumen anual (RES), CR, PLA y expediente
// ---------------------------------------------------------------------------

Deno.test("RES: subtítulo, «a nom de» y aviso de la factura con la razón social del snapshot", async () => {
  // deno-lint-ignore no-explicit-any
  const datos: any = {
    tipus: "RES", numero: "P-RES-2026-0001", exercici: 2026,
    fundacio: { "raó_social": NOVA, cif: "G00000000", domicili: "Carrer de Prova, 1" },
    donant: { "raó_social": "Mas de Prova SCP", nif: "B00000001" },
    detall: [{ producte: "Préssec", mes: 6, kg: 195, cost_kg: 0.5, valor: 97.5 }],
    kg_total: 195, valor_total: 97.5,
    factura: { import: 97.5, data_operacio: "2026-12-31", concepte: "Donació" },
  };
  const t = await text("res-nova", await renderRes(activos, { datos, sha256Datos: "ab".repeat(32), modo: "prueba" }, "ca"));
  assertStringIncludes(t, `lliurats a ${NOVA}`);
  assertStringIncludes(t, `factura teva a nom de ${NOVA} per l'import valorat`);
  assertStringIncludes(t, `${NOVA} · REDESTINA · P-RES-2026-0001`);
  assert(!t.includes("a nom de la Fundació Espigoladors"));
  // Sin razón social: el nombre por defecto.
  const sense = await text("res-sense", await renderRes(activos, { datos: { ...datos, fundacio: { cif: "G0" } }, modo: "prueba" }, "es"));
  assertStringIncludes(sense, "entregados a Fundació Espigoladors");
  assertStringIncludes(sense, "factura tuya a nombre de Fundació Espigoladors");
});

Deno.test("CR, PLA y expediente: el pie con la razón social del snapshot", async () => {
  // deno-lint-ignore no-explicit-any
  const cr: any = {
    numero: "P-CR-2026-0001", exercici: 2026, periode: { des_de: "2026-01-01", fins_a: "2026-12-31" },
    fundacio: { "raó_social": NOVA, cif: "G00000000", domicili: "Carrer de Prova, 1" },
    receptora: { "raó_social": "Banc de Prova", nif: "G12345678" },
    detall: [{ producte: "Préssec", kg: 195 }],
  };
  const tCr = await text("cr-nova", await renderCr(activos, { datos: cr, modo: "prueba" }, "ca"));
  assertStringIncludes(tCr, `Que ${NOVA}, amb CIF G00000000`);
  assertStringIncludes(tCr, `${NOVA} · REDESTINA`);

  const fundacio = { "raó_social": NOVA, cif: "G00000000" };
  const tPla = await text("pla-nova", await renderPla(activos, { datos: { numero: "PLA-2026-0001", exercici: 2026, fundacio } }, "ca"));
  assertStringIncludes(tPla, `${NOVA} · REDESTINA · PLA-2026-0001`);
  assertStringIncludes(tPla, `l'emet ${NOVA}`);

  const tExp = await text("exp-nova", await renderExpedient(activos, { datos: { format: "expedient", numero: "EXP-2026-0001", fundacio } }, "ca"));
  assertStringIncludes(tExp, `${NOVA} · REDESTINA · EXP-2026-0001`);

  const tSense = await text("pla-sense", await renderPla(activos, { datos: { numero: "PLA-2026-0002" } }, "ca"));
  assertStringIncludes(tSense, "Fundació Espigoladors · REDESTINA · PLA-2026-0002");
});
