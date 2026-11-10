// El PDF del DIAGNÒSTIC OPERATIU bajo demanda (Plan 2, A2): `renderDiagnostic()` con lo que
// devuelve `diagnostic_datos()` (A1 + la `operativa` de A4). Prueba de Deno, como
// expedient_test.ts. Con `PDF_SORTIDA=<carpeta>` deja los PDF para mirarlos.
//
//   deno test -A --config supabase/functions/generar-documento/deno.json tests/pdf/diagnostic_test.ts

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { cargarActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";
import * as INCRUSTATS from "../../supabase/functions/generar-documento/activos/incrustats.ts";
import type { Renderizado } from "../../supabase/functions/_shared/pdf/render/comu.ts";
import {
  avuiMadrid,
  type DatosDiagnostic,
  nomFitxerDiagnostic,
  renderDiagnostic,
} from "../../supabase/functions/_shared/pdf/render/diagnostic.ts";
import { enUnaLinia, textPerPagina } from "./textPdf.ts";

const activos = cargarActivos(INCRUSTATS);

async function text(nom: string, r: Renderizado): Promise<string> {
  const dir = Deno.env.get("PDF_SORTIDA");
  if (dir) await Deno.writeFile(`${dir}/diagnostic-${nom}.pdf`, r.bytes);
  return enUnaLinia((await textPerPagina(r.bytes, activos)).join("\n"));
}

const DATOS: DatosDiagnostic = {
  diagnostic_id: "00000000-0000-0000-0000-000000000001",
  organitzacio: { nom: "Mas de Prova", nif: "B00000000", municipi: "Gavà" },
  operativa: {
    activitat: ["produccio_agricola"],
    productes: ["Tomàquet", "Préssec"],
    principals: ["Tomàquet"],
    varietats: { "Tomàquet": ["Pera", "Cor de bou"] },
    volum: { "Tomàquet": 12000 },
    temporada: { "Tomàquet": [6, 7, 8] },
    envasos: ["caixes", "palets"],
    canals: ["venda_directa"],
    clients: ["consumidors_finals"],
    facturacio_eur: 250000,
    facturacio_rang: null,
    volum_comercialitzat_kg: 80000,
    suport: ["donacions"],
    llocs: [
      { alias: "Finca", municipi: "Gavà", principal: true, dies: [1, 3], franges: [{ inici: "08:00", fi: "12:00" }], horari: null },
      { alias: "Magatzem", municipi: "Viladecans", principal: false, dies: null, franges: null, horari: "Matins" },
    ],
  },
  questionari: { titol: { ca: "Diagnòstic", es: "Diagnóstico" }, versio: 3, provisional: true },
  respostes: [
    {
      id: "causes", tipus: "multi", seccio: "causes",
      pregunta: { ca: "Per què es genera l'excedent?", es: "¿Por qué se genera el excedente?" },
      valor: ["calibre"], etiquetes: [{ ca: "Calibre fora de norma", es: "Calibre fuera de norma" }],
    },
    {
      id: "excedent_kg", tipus: "producte_numero", seccio: "excedents",
      pregunta: { ca: "Quants kg d'excedent teniu per producte?", es: "¿Cuántos kg de excedente tenéis por producto?" },
      valor: { "Tomàquet": 3000 },
    },
    // Sin valor: no sale.
    {
      id: "previsio", tipus: "text", seccio: "previsio",
      pregunta: { ca: "Preveieu excedent l'any vinent?", es: "¿Prevéis excedente el año que viene?" },
      valor: null,
    },
  ],
  notes: "Visita feta a la finca.",
  complet: false,
  falten: ["sortides", "gestio_actual"],
  actualitzat_at: "2026-11-01T10:00:00+00:00",
  actualitzat_per_nom: "Persona de l'equip",
  provisional: true,
};

const ACTIVITATS: Record<string, string> = { produccio_agricola: "Producció agrícola" };

Deno.test("diagnóstico en catalán: cabecera, Operativa, respuestas por sección, notas y sin número", async () => {
  const r = await renderDiagnostic(activos, {
    datos: DATOS, generatEl: "2026-11-10", nomActivitat: (c) => ACTIVITATS[c] ?? c,
  }, "ca");
  assert(r.paginas >= 1);
  const t = await text("ca", r);
  assertStringIncludes(t, "Diagnòstic operatiu · Mas de Prova");
  assertStringIncludes(t, "B00000000");
  assertStringIncludes(t, "Incomplet");
  assertStringIncludes(t, "Generat el 10 de novembre de 2026.");
  assertStringIncludes(t, "Actualitzat l'1 de novembre de 2026 per Persona de l'equip.");
  assertStringIncludes(t, "Falten 2 preguntes per completar-lo.");
  // D2: informativo, sin número ni código de verificación; el provisional, en la misma caja.
  assertStringIncludes(t, "Document informatiu");
  assertStringIncludes(t, "no té número ni codi de verificació");
  assertStringIncludes(t, "encara no l’han validat la Fundació");
  assert(!t.includes("Codi de verificació"));
  // La Operativa, con las etiquetas de la ficha y los códigos traducidos.
  assertStringIncludes(t, "Operativa");
  assertStringIncludes(t, "Producció agrícola");
  assertStringIncludes(t, "Productes principals");
  assertStringIncludes(t, "Tomàquet: Pera, Cor de bou");
  assertStringIncludes(t, "Tomàquet: 12.000 kg/any");
  assertStringIncludes(t, "Tomàquet: jun, jul, ago");
  assertStringIncludes(t, "Caixes, Palets");
  assertStringIncludes(t, "Venda directa");
  assertStringIncludes(t, "Consumidors finals");
  assertStringIncludes(t, "250.000 €");
  assertStringIncludes(t, "80.000 kg");
  assertStringIncludes(t, "Canalitzar donacions");
  assertStringIncludes(t, "Finca · Gavà (Principal) — dl, dc · 08:00–12:00");
  assertStringIncludes(t, "Magatzem · Viladecans — Matins");
  assert(!t.includes("op.env_"), "ninguna clave sin traducir");
  // Las respuestas, en el orden del cuestionario (Excedents antes que Causes).
  assertStringIncludes(t, "Calibre fora de norma");
  assertStringIncludes(t, "Tomàquet: 3.000");
  assert(t.indexOf("Excedents") < t.indexOf("Causes"));
  assert(t.indexOf("Operativa") < t.indexOf("Excedents"), "la Operativa va antes que el cuestionario");
  assert(!t.includes("Preveieu excedent"), "una respuesta sin valor no se imprime");
  assertStringIncludes(t, "Visita feta a la finca.");
  assertStringIncludes(t, "Fundació Espigoladors · REDESTINA");
  assert(!t.includes("[object Object]"));
});

Deno.test("diagnóstico en castellano y no provisional", async () => {
  const t = await text("es", await renderDiagnostic(activos, {
    datos: { ...DATOS, complet: true, falten: [], provisional: false }, generatEl: "2026-11-10",
  }, "es"));
  assertStringIncludes(t, "Diagnóstico operativo · Mas de Prova");
  assertStringIncludes(t, "Contestado");
  assertStringIncludes(t, "Generado el 10 de noviembre de 2026.");
  assertStringIncludes(t, "Documento informativo");
  assert(!t.includes("todavía no lo han validado"), "sin provisional no hay aviso del cuestionario");
  assertStringIncludes(t, "Productos principales");
  assertStringIncludes(t, "Cajas, Palés");
  assertStringIncludes(t, "Tomàquet: 12.000 kg/año");
  assertStringIncludes(t, "Finca · Gavà (Principal) — lu, mi · 08:00–12:00");
  assertStringIncludes(t, "¿Por qué se genera el excedente?");
  assert(!t.includes("Faltan"));
});

Deno.test("sin diagnóstico ni Operativa: el aviso de vacío, sin lanzar", async () => {
  const r = await renderDiagnostic(activos, {
    datos: {
      diagnostic_id: null, organitzacio: { nom: "Hort Buit" }, operativa: null,
      respostes: [], complet: false, falten: [], actualitzat_at: null, provisional: true,
    },
    generatEl: "2026-11-10",
  }, "ca");
  assertEquals(r.paginas, 1);
  const t = await text("buit", r);
  assertStringIncludes(t, "Sense començar");
  assertStringIncludes(t, "Encara no hi ha cap resposta del diagnòstic.");
  assert(!t.includes("Actualitzat"));
  assert(!t.includes("Falten"));
});

Deno.test("nomFitxerDiagnostic y avuiMadrid", () => {
  assertEquals(nomFitxerDiagnostic("Mas de l'Àvia / Cal Pep"), "diagnostic-mas-de-l-avia-cal-pep.pdf");
  assertEquals(nomFitxerDiagnostic("  "), "diagnostic.pdf");
  assertEquals(nomFitxerDiagnostic(null), "diagnostic.pdf");
  assert(nomFitxerDiagnostic("x".repeat(200)).length <= "diagnostic-.pdf".length + 60);
  // 23:30 UTC del 31-12 ya es 1 de enero en Madrid.
  assertEquals(avuiMadrid(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
  assertEquals(avuiMadrid(new Date("2026-07-15T10:00:00Z")), "2026-07-15");
});
