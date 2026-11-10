// El PDF del EXPEDIENTE de prevención con el diagnóstico único del productor (A1). Prueba de
// Deno, como fundacio_test.ts: `expedient_datos().diagnostic` pinta la sección «Diagnòstic
// operatiu» (pregunta → respuesta por sección); sin él, nada. Y las medidas del plan básico
// con `titol` bilingüe no imprimen `[object Object]`. Con `PDF_SORTIDA=<carpeta>` deja los PDF.
//
//   deno test -A --config supabase/functions/generar-documento/deno.json tests/pdf/expedient_test.ts

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { cargarActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";
import * as INCRUSTATS from "../../supabase/functions/generar-documento/activos/incrustats.ts";
import type { Renderizado } from "../../supabase/functions/_shared/pdf/render/comu.ts";
import { respostesLlegibles } from "../../supabase/functions/_shared/pdf/render/pla.ts";
import {
  type DatosExpedient,
  renderExpedient,
} from "../../supabase/functions/_shared/pdf/render/expedient.ts";
import { enUnaLinia, textPerPagina } from "./textPdf.ts";

const activos = cargarActivos(INCRUSTATS);

async function text(nom: string, r: Renderizado): Promise<string> {
  const dir = Deno.env.get("PDF_SORTIDA");
  if (dir) await Deno.writeFile(`${dir}/expedient-${nom}.pdf`, r.bytes);
  return enUnaLinia((await textPerPagina(r.bytes, activos)).join("\n"));
}

// Las respuestas tal como las deja `compondre_respostes()` en `diagnostics.sobre`.
const RESPOSTES = [
  {
    id: "excedent_kg", tipus: "producte_numero", seccio: "excedents",
    pregunta: { ca: "Quants kg d'excedent teniu per producte?", es: "¿Cuántos kg de excedente tenéis por producto?" },
    valor: { Tomàquet: 12000 },
  },
  {
    id: "causes", tipus: "multi", seccio: "causes",
    pregunta: { ca: "Per què es genera l'excedent?", es: "¿Por qué se genera el excedente?" },
    valor: ["calibre", "preu"],
    etiquetes: [{ ca: "Calibre fora de norma", es: "Calibre fuera de norma" }, { ca: "Preu de mercat baix", es: "Precio de mercado bajo" }],
  },
  {
    id: "productes", tipus: "text", seccio: "productes",
    pregunta: { ca: "Quins productes conreeu?", es: "¿Qué productos cultiváis?" },
    valor: "Tomàquet i préssec",
  },
  {
    id: "transport", tipus: "boolea", seccio: "logistica",
    pregunta: { ca: "Teniu transport propi?", es: "¿Tenéis transporte propio?" },
    valor: true, etiqueta: { ca: "Sí, propi", es: "Sí, propio" },
  },
  // Sin valor: no sale.
  {
    id: "previsio", tipus: "text", seccio: "previsio",
    pregunta: { ca: "Preveieu excedent l'any vinent?", es: "¿Prevéis excedente el año que viene?" },
    valor: null,
  },
];

const BASE: DatosExpedient = {
  format: "expedient",
  numero: "P-PLA-2026-0001",
  exercici: 2026,
  fundacio: { "raó_social": "Fundació de Prova", cif: "G00000000" },
  organitzacio: { nom: "Mas de Prova" },
  mesures_pla_basic: [],
};

Deno.test("respostesLlegibles: orden del cuestionario, etiquetas, valor por producto y sin las vacías", () => {
  const ca = respostesLlegibles(RESPOSTES, "ca");
  assertEquals(ca, [
    { seccio: "Productes", pregunta: "Quins productes conreeu?", resposta: "Tomàquet i préssec" },
    { seccio: "Excedents", pregunta: "Quants kg d'excedent teniu per producte?", resposta: "Tomàquet: 12.000" },
    { seccio: "Causes", pregunta: "Per què es genera l'excedent?", resposta: "Calibre fora de norma, Preu de mercat baix" },
    { seccio: "Logística", pregunta: "Teniu transport propi?", resposta: "Sí, propi" },
  ]);
  const es = respostesLlegibles(RESPOSTES, "es");
  assertEquals(es[2], { seccio: "Causas", pregunta: "¿Por qué se genera el excedente?", resposta: "Calibre fuera de norma, Precio de mercado bajo" });
  // Lo que no es una lista de respuestas, vacío y sin lanzar.
  assertEquals(respostesLlegibles(null, "ca"), []);
  assertEquals(respostesLlegibles({ a: 1 }, "ca"), []);
  assertEquals(respostesLlegibles([null, "x", { id: "sense", valor: [] }], "ca"), []);
});

Deno.test("expediente con diagnóstico: la sección, la fecha, el aviso provisional y las respuestas", async () => {
  const datos: DatosExpedient = {
    ...BASE,
    diagnostic: { respostes: RESPOSTES, actualitzat_at: "2026-11-01T10:00:00+00:00", provisional: true },
  };
  const t = await text("diagnostic-ca", await renderExpedient(activos, { datos, modo: "prueba" }, "ca"));
  assertStringIncludes(t, "Diagnòstic operatiu");
  assertStringIncludes(t, "Actualitzat l'1 de novembre de 2026.");
  assertStringIncludes(t, "Qüestionari provisional");
  assertStringIncludes(t, "Per què es genera l'excedent?");
  assertStringIncludes(t, "Calibre fora de norma, Preu de mercat baix");
  assertStringIncludes(t, "Tomàquet: 12.000");
  assert(!t.includes("Preveieu excedent"), "una respuesta sin valor no se imprime");
  assert(!t.includes("[object Object]"));
  // La sección va antes de las visitas.
  assert(t.indexOf("Diagnòstic operatiu") < t.indexOf("Visites tècniques"));

  const es = await text("diagnostic-es", await renderExpedient(activos, {
    datos: { ...datos, diagnostic: { ...datos.diagnostic, provisional: false } },
  }, "es"));
  assertStringIncludes(es, "Diagnóstico operativo");
  assertStringIncludes(es, "Actualizado el 1 de noviembre de 2026.");
  assertStringIncludes(es, "¿Por qué se genera el excedente?");
  assert(!es.includes("Cuestionario provisional"));
});

Deno.test("expediente sin diagnóstico (o sin respuestas con valor): no hay sección", async () => {
  const t = await text("sense-diagnostic", await renderExpedient(activos, { datos: BASE }, "ca"));
  assert(!t.includes("Diagnòstic operatiu"));
  const buit = await text("diagnostic-buit", await renderExpedient(activos, {
    datos: { ...BASE, diagnostic: { respostes: [RESPOSTES[4]], actualitzat_at: null, provisional: true } },
  }, "ca"));
  assert(!buit.includes("Diagnòstic operatiu"));
  assert(!buit.includes("Qüestionari provisional"));
  // Sin plan, `mesures_pla_basic` llega `[]`: ni el título.
  assert(!t.includes("Mesures del pla bàsic"));
});

Deno.test("expediente: las medidas del plan básico con título bilingüe no imprimen [object Object]", async () => {
  const datos: DatosExpedient = {
    ...BASE,
    mesures_pla_basic: [
      { titol: { ca: "Registrar l'excedent cada mes", es: "Registrar el excedente cada mes" }, obligatoria: true },
      { titol: "Revisar el calendari de collita", obligatoria: false },
      { titol: { ca: "", es: "" } },
    ],
  };
  const ca = await text("mesures-ca", await renderExpedient(activos, { datos }, "ca"));
  assertStringIncludes(ca, "Mesures del pla bàsic");
  assertStringIncludes(ca, "Registrar l'excedent cada mes (obligatòria)");
  assertStringIncludes(ca, "Revisar el calendari de collita (recomanada)");
  assert(!ca.includes("[object Object]"));
  const es = await text("mesures-es", await renderExpedient(activos, { datos }, "es"));
  assertStringIncludes(es, "Registrar el excedente cada mes (obligatoria)");
  assert(!es.includes("[object Object]"));
});
