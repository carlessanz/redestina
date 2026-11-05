// El certificado de donación según el modelo de la Fundació (05-11-2026). Prueba de Deno,
// como ct_test.ts: genera un CD anual y uno de oferta con anexo, con la plantilla TAL COMO
// la carga la migración (`20270509100300_plantilla_certificat_donacio.sql`, leída del
// fichero), y comprueba el texto que de verdad queda impreso en el PDF.
// Con `PDF_SORTIDA=<carpeta>` deja los PDF para mirarlos.
//
//   deno test -A --config supabase/functions/generar-documento/deno.json tests/pdf/cd_test.ts

import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { cargarActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";
import * as INCRUSTATS from "../../supabase/functions/generar-documento/activos/incrustats.ts";
import { renderCd } from "../../supabase/functions/_shared/pdf/render/cd.ts";
import type { DatosCierre } from "../../supabase/functions/_shared/pdf/render/cierre.ts";
import { enUnaLinia, textPerPagina } from "./textPdf.ts";

const activos = cargarActivos(INCRUSTATS);

/** Las plantillas `CD` de la migración, sin copiarlas: se leen del propio SQL. */
const SQL = await Deno.readTextFile(
  new URL("../../supabase/migrations/20270509100300_plantilla_certificat_donacio.sql", import.meta.url),
);
function plantillaDe(idioma: "ca" | "es") {
  const m = SQL.match(new RegExp(`v_${idioma} jsonb := \\$j\\$([\\s\\S]*?)\\]\\$j\\$`));
  if (!m) throw new Error(`no trobo la plantilla ${idioma} a la migració`);
  return {
    titulo: idioma === "es" ? "CERTIFICADO DE DONACIÓN" : "CERTIFICAT DE DONACIÓ",
    cuerpo: JSON.parse(`${m[1]}]`),
  };
}

const FUNDACIO = {
  "raó_social": "Fundació de Prova",
  cif: "G00000000",
  domicili: "Carrer de Prova, 1",
  codi_postal: "08000",
  poblacio: "Barcelona",
  inscripcio: null,
};

const ANUAL: DatosCierre = {
  tipus: "CD",
  abast: "exercici",
  mode: "prueba",
  exercici: 2025,
  numero: "P-CD-2025-0001",
  data_generacio: "2026-11-05T10:00:00Z",
  data_expedicio: "2025-12-31",
  annex: false,
  lloc: "Barcelona",
  fundacio: FUNDACIO,
  apoderada: { nom: "Persona de Prova", carrec: "Apoderada" },
  donant: { "raó_social": "Mas de Prova S.L.", nif: "B00000001", domicili: "Camí de Prova, 2", poblacio: "Gavà" },
  periode: { des_de: "2025-01-01", fins_a: "2025-12-31" },
  kg: 2969,
  import: 2543.06,
  factura: { numero: null, data: null, import: null },
  detall: [
    { producte: "Préssec", kg: 1969, valor: 1543.06 },
    { producte: "Carbassó", kg: 1000, valor: 1000 },
  ],
};

const OFERTA: DatosCierre = {
  ...ANUAL,
  abast: "oferta",
  exercici: 2026,
  numero: "P-CDP-2026-0001",
  data_expedicio: "2026-11-05",
  annex: true,
  periode: { des_de: "2026-10-14", fins_a: "2026-10-14" },
  kg: 107,
  import: 113.42,
  detall: [{ producte: "Cogombre", kg: 107, valor: 113.42 }],
};

async function render(nom: string, datos: DatosCierre, idioma: "ca" | "es" = "ca") {
  const r = await renderCd(activos, {
    datos,
    sha256Datos: "ab".repeat(32),
    plantilla: plantillaDe(idioma),
    modo: "prueba",
    apoderadaDni: "00000000T",
  }, idioma);
  const dir = Deno.env.get("PDF_SORTIDA");
  if (dir) await Deno.writeFile(`${dir}/${nom}.pdf`, r.bytes);
  const pagines = await textPerPagina(r.bytes, activos);
  return { ...r, pagines, text: enUnaLinia(pagines.join("\n")) };
}

function senseRestes(text: string) {
  assert(!text.includes("182"), "no menciona el model 182");
  assert(!text.toLowerCase().includes("provisional"), "no imprimeix cap text provisional");
  assert(!text.toLowerCase().includes("factura"), "sense factura, la frase no hi és");
  assert(!text.includes("{{"), "no queda cap marcador sense resoldre");
}

Deno.test("el CD anual: el texto del modelo, en una página y sin restos del diseño anterior", async () => {
  const r = await render("cd-anual", ANUAL);
  assertEquals(r.paginas, 1);
  assertStringIncludes(r.text, "CERTIFICAT DE DONACIÓ");
  assertStringIncludes(r.text, "Primer.- Que, durant l'exercici 01/01/2025 a 31/12/2025, la persona jurídica donant MAS DE PROVA S.L., amb NIF B00000001");
  assertStringIncludes(r.text, "2.969 kg de productes alimentaris.");
  assertStringIncludes(r.text, "DOS MIL CINC-CENTS QUARANTA-TRES EUROS AMB SIS CÈNTIMS (2.543,06 €)");
  assertStringIncludes(r.text, "Quart.-");
  assertStringIncludes(r.text, "article 16 de la Llei 49/2002");
  assertStringIncludes(r.text, "expedeixo el present certificat a Barcelona, 31 de desembre de 2025.");
  assertStringIncludes(r.text, "Persona de Prova Apoderada");
  assertStringIncludes(r.text, "Codi de verificació ABAB-ABAB-ABAB-ABAB");
  senseRestes(r.text);
});

Deno.test("el CD de una oferta con anexo: «el dia …» y la segunda página con el detalle", async () => {
  const r = await render("cd-oferta-annex", OFERTA);
  assertEquals(r.paginas, 2);
  assertStringIncludes(r.pagines[0], "CERTIFICAT DE DONACIÓ");
  assertStringIncludes(r.text, "durant el dia 14/10/2026");
  assertStringIncludes(r.text, "CENT TRETZE EUROS AMB QUARANTA-DOS CÈNTIMS (113,42 €)");
  assertStringIncludes(r.text, "expedeixo el present certificat a Barcelona, 5 de novembre de 2026.");
  assertStringIncludes(enUnaLinia(r.pagines[1]), "Annex · Detall per producte");
  assertStringIncludes(enUnaLinia(r.pagines[1]), "Cogombre");
  senseRestes(r.text);
});

Deno.test("con factura registrada, el Primer la cita", async () => {
  const r = await render("cd-factura", { ...ANUAL, factura: { numero: "F-12", data: "2025-12-31" } });
  assertStringIncludes(r.text, "productes alimentaris, segons la factura núm. F-12, amb data 31/12/2025.");
});

Deno.test("en castellano", async () => {
  const r = await render("cd-es", { ...ANUAL, abast: "periode", periode: { des_de: "2026-03-01", fins_a: "2026-03-15" } }, "es");
  assertStringIncludes(r.text, "CERTIFICADO DE DONACIÓN");
  assertStringIncludes(r.text, "durante el periodo 01/03/2026 a 15/03/2026");
  assertStringIncludes(r.text, "DOS MIL QUINIENTOS CUARENTA Y TRES EUROS CON SEIS CÉNTIMOS");
  assertStringIncludes(r.text, "expido el presente certificado en Barcelona, a 31 de diciembre de 2025.");
  assertEquals(r.paginas, 1);
});

Deno.test("sin plantilla congelada no imprime nada", async () => {
  await assertRejects(
    () => renderCd(activos, { datos: ANUAL, sha256Datos: "ab".repeat(32), modo: "prueba" }, "ca"),
    Error,
    "plantilla",
  );
});

Deno.test("tiempo de CPU: un CD con anexo, muy por debajo de los 2 s del runtime", async () => {
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) {
    await renderCd(activos, {
      datos: OFERTA, sha256Datos: "ab".repeat(32), plantilla: plantillaDe("ca"), modo: "prueba", apoderadaDni: "00000000T",
    }, "ca");
  }
  const ms = (performance.now() - t0) / 5;
  console.log(`renderCd: ${ms.toFixed(1)} ms de media`);
  assert(ms < 1000, `renderCd tarda ${ms.toFixed(0)} ms`);
});
