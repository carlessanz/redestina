// El PDF del DIAGNÒSTIC OPERATIU bajo demanda (Plan 2, A2): `renderDiagnostic()` con lo que
// devuelve `diagnostic_datos()` (A1 + la `operativa` de A4 + los `excedents` de A3). Prueba de Deno, como
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

Deno.test("diagnóstico en catalán sin excedentes: cabecera, Operativa, respuestas v3 (legado), notas y sin número", async () => {
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
  assertStringIncludes(t, "Falten 2 dades per completar-lo.");
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
  // Sin bloques de excedentes (A3): las respuestas del v3, bajo su título, en el orden del
  // cuestionario (Excedents antes que Causes).
  assertStringIncludes(t, "Respostes del qüestionari anterior");
  assert(t.indexOf("Respostes del qüestionari anterior") < t.indexOf("Calibre fora de norma"));
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

// ------------------------------------------------------------------ A3: excedentes
// Tal como los devuelve `diagnostic_excedents_json()`: principales en su orden, los
// conservados («ja no és principal») al final; causas por código; acciones por destino.
const EXCEDENTS = [
  {
    producte: "Tomàquet", principal: true, ordre: 1, sense_excedent: false,
    observacions: "El calibre petit es repeteix cada estiu.",
    causes: [
      {
        id: "c1", causa: "CE", causa_nom: { ca: "Criteris Estètics", es: "Criterios estéticos" },
        frequencia: "setmanal", volum_kg: 1250.5, gestio_actual: ["donacio", "residu"],
        destins: ["donacio", "maquila"], detall: "Calibre petit",
        accions: [
          { id: "a1", desti: "donacio", descripcio: "Acord amb el banc d'aliments", estat: "en_curs",
            notes: "Primera recollida el dijous", feta_at: null, actualitzat_at: "2026-11-05T10:00:00+00:00" },
          { id: "a2", desti: "maquila", descripcio: "Provar salsa amb l'obrador", estat: "pendent",
            notes: null, feta_at: null, actualitzat_at: null },
        ],
      },
      {
        id: "c2", causa: "EX", causa_nom: { ca: "Excedent", es: "Excedente" },
        frequencia: "varies_setmana", volum_kg: 500, gestio_actual: ["venda_alternativa", "altres"],
        destins: ["venda"], detall: null,
        accions: [
          { id: "a3", desti: "venda", descripcio: "Venda a menjadors escolars", estat: "feta",
            notes: null, feta_at: "2026-11-02T10:00:00+00:00", actualitzat_at: "2026-11-02T10:00:00+00:00" },
        ],
      },
    ],
  },
  {
    producte: "Pebrot", principal: true, ordre: 2, sense_excedent: true,
    observacions: null, causes: [],
  },
  {
    producte: "Carxofa", principal: false, ordre: null, sense_excedent: false, observacions: null,
    causes: [
      {
        id: "c3", causa: "CL", causa_nom: { ca: "Clima", es: "Clima" },
        frequencia: "estacional", volum_kg: 300, gestio_actual: ["transformacio"], destins: ["donacio"],
        detall: null,
        accions: [
          { id: "a4", desti: "donacio", descripcio: "Avisar abans de la gelada", estat: "descartada",
            notes: "No hi ha hagut gelades", feta_at: null, actualitzat_at: null },
        ],
      },
    ],
  },
];

const DATOS_A3: DatosDiagnostic = { ...DATOS, excedents: EXCEDENTS, complet: true, falten: [], provisional: false };

Deno.test("A3 en catalán: Excedents por producto, causas, acciones, sense excedent y conservado; sin el v3", async () => {
  const t = await text("a3-ca", await renderDiagnostic(activos, {
    datos: DATOS_A3, generatEl: "2026-11-10", nomActivitat: (c) => ACTIVITATS[c] ?? c,
  }, "ca"));
  assertStringIncludes(t, "Excedents");
  assert(t.indexOf("Operativa") < t.indexOf("Excedents"), "los excedentes, tras la Operativa");
  assertStringIncludes(t, "Volum aproximat, cada vegada que es produeix l’excedent.");
  // Las cabeceras de las tablas.
  for (const x of ["Causa", "Freqüència", "Volum (kg)", "Gestió actual", "Destins d’interès", "Accions", "Acció", "Destí", "Estat"]) {
    assertStringIncludes(t, x);
  }
  // Tomàquet: las dos causas con sus datos traducidos y el detalle junto a la causa.
  assertStringIncludes(t, "Criteris Estètics");
  assertStringIncludes(t, "Detall: Calibre petit");
  assertStringIncludes(t, "Setmanal");
  assertStringIncludes(t, "1.250,5");
  assertStringIncludes(t, "Donació, Residu");
  assertStringIncludes(t, "Donació, Maquila");
  assertStringIncludes(t, "Excedent");
  assertStringIncludes(t, "Diverses vegades per setmana");
  assertStringIncludes(t, "500");
  assertStringIncludes(t, "Venda alternativa, Altres");
  // Las acciones: texto, destino, estado y la nota de seguimiento en la misma celda.
  assertStringIncludes(t, "Acord amb el banc d'aliments — Seguiment: Primera recollida el dijous");
  assertStringIncludes(t, "En curs");
  assertStringIncludes(t, "Provar salsa amb l'obrador");
  assertStringIncludes(t, "Pendent");
  assertStringIncludes(t, "Venda a menjadors escolars");
  assertStringIncludes(t, "Feta");
  assertStringIncludes(t, "Observacions: El calibre petit es repeteix cada estiu.");
  // Pebrot: «Sense excedent». Carxofa: al final, marcada, con sus acciones.
  assertStringIncludes(t, "Pebrot");
  assertStringIncludes(t, "Sense excedent");
  assertStringIncludes(t, "Carxofa · ja no és principal");
  assertStringIncludes(t, "Avisar abans de la gelada — Seguiment: No hi ha hagut gelades");
  assertStringIncludes(t, "Descartada");
  assert(t.indexOf("Tomàquet ") < t.indexOf("Pebrot"));
  assert(t.indexOf("Pebrot") < t.indexOf("Carxofa · ja no és principal"));
  // Con bloques, el cuestionario v3 no se imprime (ni su título).
  assert(!t.includes("Respostes del qüestionari anterior"));
  assert(!t.includes("Calibre fora de norma"));
  assert(!t.includes("Encara no hi ha cap resposta"));
  // Ninguna clave sin traducir.
  assert(!/\b(dexc|od)\.[a-z_]+/.test(t), "ninguna clave dexc./od. sin traducir");
  assert(!t.includes("[object Object]"));
  assertStringIncludes(t, "Contestat");
});

Deno.test("A3 en castellano: los mismos bloques con las etiquetas en castellano", async () => {
  const t = await text("a3-es", await renderDiagnostic(activos, { datos: DATOS_A3, generatEl: "2026-11-10" }, "es"));
  assertStringIncludes(t, "Excedentes");
  assertStringIncludes(t, "Volumen aproximado, cada vez que se produce el excedente.");
  for (const x of ["Frecuencia", "Volumen (kg)", "Gestión actual", "Destinos de interés", "Acciones", "Acción", "Destino", "Estado"]) {
    assertStringIncludes(t, x);
  }
  assertStringIncludes(t, "Criterios estéticos");
  assertStringIncludes(t, "Detalle: Calibre petit");
  assertStringIncludes(t, "Semanal");
  assertStringIncludes(t, "Varias veces por semana");
  assertStringIncludes(t, "Donación, Residuo");
  assertStringIncludes(t, "Venta alternativa, Otros");
  assertStringIncludes(t, "Excedente");
  assertStringIncludes(t, "— Seguimiento: Primera recollida el dijous");
  assertStringIncludes(t, "En curso");
  assertStringIncludes(t, "Pendiente");
  assertStringIncludes(t, "Hecha");
  assertStringIncludes(t, "Sin excedente");
  assertStringIncludes(t, "Carxofa · ya no es principal");
  assertStringIncludes(t, "Observaciones: El calibre petit es repeteix cada estiu.");
  assert(!t.includes("Respuestas del cuestionario anterior"));
  assert(!/\b(dexc|od)\.[a-z_]+/.test(t));
  assert(!t.includes("[object Object]"));
});

Deno.test("A3: un código desconocido sale como código, nunca como clave; basura descartada sin lanzar", async () => {
  const t = await text("a3-raros", await renderDiagnostic(activos, {
    datos: {
      ...DATOS, provisional: false,
      excedents: [
        null, "x", { producte: "" },
        {
          producte: "Ceba", principal: true, ordre: 1, sense_excedent: false, observacions: null,
          causes: [{ id: "c", causa: "ZZ", causa_nom: null, frequencia: "cada_lluna", volum_kg: null,
            gestio_actual: null, destins: ["teletransport"], detall: null, accions: [{ id: "a", desti: "venda", descripcio: "" }] }],
        },
      ],
    },
    generatEl: "2026-11-10",
  }, "ca"));
  assertStringIncludes(t, "Ceba");
  assertStringIncludes(t, "ZZ");
  assertStringIncludes(t, "cada_lluna");
  assertStringIncludes(t, "teletransport");
  assert(!t.includes("dexc."));
  assert(!t.includes("Accions"), "una acción sin texto no cuenta");
  assert(!t.includes("Respostes del qüestionari anterior"));
});
