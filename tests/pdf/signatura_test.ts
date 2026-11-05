// La firma de la contraparte sobre la versión `signat` (05-11-2026, circuito de firma
// unificado). Prueba de Deno, como cd_test.ts: el CD, el CR y el albarán de una página, con y
// sin `op.signatura`, y lo que de verdad queda impreso.
//   · con firma: «Rebut i conforme, …» (CD, CR) o «Signat per …» (albarán), el nombre, el
//     cargo, la vía y la fecha; el DNI en el CD y el CR, NUNCA en el albarán;
//   · sin firma: ni rastro, y el CD anual sigue en una página;
//   · un trazo ilegible no impide emitir.
// Con `PDF_SORTIDA=<carpeta>` deja los PDF para mirarlos.
//
//   deno test -A --config supabase/functions/generar-documento/deno.json tests/pdf/signatura_test.ts

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { cargarActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";
import * as INCRUSTATS from "../../supabase/functions/generar-documento/activos/incrustats.ts";
import { renderCd } from "../../supabase/functions/_shared/pdf/render/cd.ts";
import { renderCr } from "../../supabase/functions/_shared/pdf/render/cr.ts";
import { renderAlbara1p, type DatosAlbara1p } from "../../supabase/functions/_shared/pdf/render/albara1p.ts";
import type { DatosCierre } from "../../supabase/functions/_shared/pdf/render/cierre.ts";
import type { SignaturaDocument } from "../../supabase/functions/_shared/pdf/render/signatura.ts";
import { enUnaLinia, textPerPagina } from "./textPdf.ts";

const activos = cargarActivos(INCRUSTATS);

// ---------------------------------------------------------------------------
// Un PNG de verdad (un trazo en diagonal), sin dependencias: cabecera, IHDR, IDAT con zlib
// (`CompressionStream("deflate")` es zlib) e IEND, con su CRC.
// ---------------------------------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(tipus: string, dades: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + dades.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, dades.length);
  out.set(new TextEncoder().encode(tipus), 4);
  out.set(dades, 8);
  v.setUint32(8 + dades.length, crc32(out.subarray(4, 8 + dades.length)));
  return out;
}
async function pngTraç(w = 300, h = 100): Promise<Uint8Array> {
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filtro «None»
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 4) + 1 + x * 4;
      const sobre = Math.abs(y - (h / 2 + Math.sin(x / 18) * 30)) < 3;
      raw[o] = 20; raw[o + 1] = 30; raw[o + 2] = 27; raw[o + 3] = sobre ? 255 : 0;
    }
  }
  const comprimit = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer(),
  );
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", comprimit), chunk("IEND", new Uint8Array()),
  ];
  const total = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let i = 0;
  for (const p of parts) { total.set(p, i); i += p.length }
  return total;
}

const TRAÇ = await pngTraç();

function signatura(part: string, extra: Partial<SignaturaDocument> = {}): SignaturaDocument {
  return {
    part,
    nom: "Marta Puig Serra",
    carrec: "Gerent",
    dni: "12345678Z",
    data: "2026-11-05T09:30:00Z",
    trazoPng: TRAÇ,
    canal: "panel",
    ...extra,
  };
}

async function guarda(nom: string, bytes: Uint8Array) {
  const dir = Deno.env.get("PDF_SORTIDA");
  if (dir) await Deno.writeFile(`${dir}/${nom}.pdf`, bytes);
}
async function text(bytes: Uint8Array): Promise<{ pagines: string[]; tot: string }> {
  const pagines = await textPerPagina(bytes, activos);
  return { pagines, tot: enUnaLinia(pagines.join("\n")) };
}

// ---------------------------------------------------------------------------
// CD — con la plantilla tal como la carga la migración
// ---------------------------------------------------------------------------
const SQL = await Deno.readTextFile(
  new URL("../../supabase/migrations/20270509100300_plantilla_certificat_donacio.sql", import.meta.url),
);
function plantillaCd(idioma: "ca" | "es") {
  const m = SQL.match(new RegExp(`v_${idioma} jsonb := \\$j\\$([\\s\\S]*?)\\]\\$j\\$`));
  if (!m) throw new Error(`no trobo la plantilla ${idioma} a la migració`);
  return { titulo: idioma === "es" ? "CERTIFICADO DE DONACIÓN" : "CERTIFICAT DE DONACIÓ", cuerpo: JSON.parse(`${m[1]}]`) };
}
const CD: DatosCierre = {
  tipus: "CD", abast: "exercici", mode: "prueba", exercici: 2025, numero: "P-CD-2025-0001",
  data_generacio: "2026-11-05T10:00:00Z", data_expedicio: "2025-12-31", annex: false, lloc: "Barcelona",
  fundacio: { "raó_social": "Fundació de Prova", cif: "G00000000", domicili: "Carrer de Prova, 1", codi_postal: "08000", poblacio: "Barcelona" },
  apoderada: { nom: "Persona de Prova", carrec: "Apoderada" },
  donant: { "raó_social": "Mas de Prova S.L.", nif: "B00000001", domicili: "Camí de Prova, 2", poblacio: "Gavà" },
  periode: { des_de: "2025-01-01", fins_a: "2025-12-31" },
  kg: 2969, import: 2543.06, factura: { numero: null, data: null, import: null },
  detall: [{ producte: "Préssec", kg: 2969, valor: 2543.06 }],
};
function opCd(extra: Record<string, unknown> = {}) {
  return { datos: CD, sha256Datos: "ab".repeat(32), plantilla: plantillaCd("ca"), modo: "prueba" as const, apoderadaDni: "00000000T", ...extra };
}

Deno.test("CD sin firma: ni «Rebut i conforme» ni DNI de nadie más, y en una página", async () => {
  const r = await renderCd(activos, opCd(), "ca");
  await guarda("cd-sense-signatura", r.bytes);
  const { tot } = await text(r.bytes);
  assertEquals(r.paginas, 1);
  assert(!tot.includes("Rebut i conforme"), "sin firma no hay bloque");
  assert(!tot.includes("12345678Z"));
});

Deno.test("CD signat: «Rebut i conforme, el donant», nombre · cargo · DNI y la vía", async () => {
  const r = await renderCd(activos, opCd({ signatura: signatura("donant") }), "ca");
  await guarda("cd-signat", r.bytes);
  const { tot } = await text(r.bytes);
  assertStringIncludes(tot, "Rebut i conforme, el donant");
  assertStringIncludes(tot, "Marta Puig Serra · Gerent · DNI 12345678Z");
  assertStringIncludes(tot, "Signat el 05/11/2026 des del panell");
  // El código de verificación no cambia: es el del documento que se firmó.
  assertStringIncludes(tot, "Codi de verificació ABAB-ABAB-ABAB-ABAB");
  assertEquals(r.paginas, 1, "el CD anual firmado sigue cabiendo en una página");
});

Deno.test("CD signat en castellano y por el enlace", async () => {
  const r = await renderCd(activos, { ...opCd({ signatura: signatura("donant", { canal: "email" }) }), plantilla: plantillaCd("es") }, "es");
  const { tot } = await text(r.bytes);
  assertStringIncludes(tot, "Recibido y conforme, el donante");
  assertStringIncludes(tot, "Firmado el 05/11/2026 desde el enlace");
});

Deno.test("CD signat con un trazo ilegible: sale igual, con el texto", async () => {
  const r = await renderCd(activos, opCd({ signatura: signatura("donant", { trazoPng: new Uint8Array([1, 2, 3]) }) }), "ca");
  const { tot } = await text(r.bytes);
  assertStringIncludes(tot, "Rebut i conforme, el donant");
});

// ---------------------------------------------------------------------------
// CR
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
const CR: any = {
  tipus: "CR", numero: "P-CR-2026-0001", exercici: 2026,
  periode: { des_de: "2026-01-01", fins_a: "2026-10-31" }, data_generacio: "2026-11-05", lloc: "Barcelona",
  kg: 120, kg_donacio: 100, kg_compra: 20,
  apoderada: { nom: "Persona de Prova", carrec: "Apoderada" },
  fundacio: { "raó_social": "Fundació de Prova", cif: "G00000000", domicili: "Carrer de Prova, 1" },
  receptora: { "raó_social": "Banc de Prova", nif: "G12345678", domicili: "Vic" },
  detall: [{ producte: "Cogombre", operacions: 2, kg_donacio: 100, kg_compra: 20, kg: 120 }],
  procedencies_donacio: [{ municipi: "Mataró", comarca: "Maresme", operacions: 1, kg: 100 }],
  procedencies_compra: [],
};

Deno.test("CR sin firma: sin bloque", async () => {
  const r = await renderCr(activos, { datos: CR, sha256Datos: "cd".repeat(32), modo: "prueba" }, "ca");
  const { tot } = await text(r.bytes);
  assert(!tot.includes("Rebut i conforme"));
});

Deno.test("CR signat: «Rebut i conforme, l'entitat receptora»", async () => {
  const r = await renderCr(activos, {
    datos: CR, sha256Datos: "cd".repeat(32), modo: "prueba", signatura: signatura("receptor", { canal: "email" }),
  }, "ca");
  await guarda("cr-signat", r.bytes);
  const { tot } = await text(r.bytes);
  assertStringIncludes(tot, "Rebut i conforme, l'entitat receptora");
  assertStringIncludes(tot, "Marta Puig Serra · Gerent · DNI 12345678Z");
  assertStringIncludes(tot, "Signat el 05/11/2026 des de l'enllaç");
});

// ---------------------------------------------------------------------------
// Albarán de una página: el trazo dentro de la caja, sin DNI
// ---------------------------------------------------------------------------
const FUNDACIO = { razon_social: "Fundació Espigoladors", nif: "G66264953", domicilio: "Carrer de Premià, 15, Barcelona" };
const REC: DatosAlbara1p = {
  format: "albara-1p", idioma: "ca", ejercici: 2026, emes_at: "2026-10-10T10:00:00",
  data_elaboracio: "2026-10-10", fundacio: FUNDACIO,
  recollida: { fecha_hora: "2026-10-10T08:00:00Z", lugar: "Mas Prats · Maresme" },
  tipus: "REC", numero: "REC-2026-00320", modalitat: "donacio", tipus_entrada: "donacio",
  partes: { entrega: { razon_social: "Emiliu Ribes", domicilio: "Carrer de Prova, 1", nif: "J58114265" }, recibe: FUNDACIO },
  linies: [{ ordre: 1, producte: "Cogombre", kg_net: 107, kg_previstos: 107, valor_kg: 1.06 }],
};
const CONF = [{ nombre: "Emiliu Ribes", at: "2026-10-10T10:30:00Z", canal: "email", rol: "entrega" as const, referencia: "1a2b3c4d" }];

Deno.test("REC sin firma: la caja como siempre", async () => {
  const r = await renderAlbara1p(activos, { datos: REC, sha256Datos: "ab".repeat(32), modo: "real", confirmaciones: CONF });
  const { tot } = await text(r.bytes);
  assertEquals(r.paginas, 1);
  assertStringIncludes(tot, "Firma del donant:");
  assert(!tot.includes("Signat per"));
});

Deno.test("REC signat: «Signat per» dentro de la caja, sin DNI, y en una página", async () => {
  const r = await renderAlbara1p(activos, {
    datos: REC, sha256Datos: "ab".repeat(32), modo: "real", confirmaciones: CONF, signatura: signatura("donant"),
  });
  await guarda("rec-signat", r.bytes);
  const { tot } = await text(r.bytes);
  assertEquals(r.paginas, 1);
  assertStringIncludes(tot, "Firma del donant:");
  assertStringIncludes(tot, "Signat per Marta Puig Serra · Gerent");
  assertStringIncludes(tot, "05/11/2026 · des del panell");
  assertStringIncludes(tot, "Confirmat per Emiliu Ribes");
  assert(!tot.includes("12345678Z"), "el albarán no imprime el DNI de quien firma");
});

Deno.test("ENT signat: en la caja «Conformitat de qui rep»", async () => {
  const ent: DatosAlbara1p = {
    ...REC, tipus: "ENT", numero: "ENT-2026-00041",
    partes: { entrega: FUNDACIO, recibe: { razon_social: "Banc de Prova", nif: "G12345678", domicilio: "Vic" } },
    linies: [{ ordre: 1, producte: "Cogombre", kg_previstos: 107, kg_confirmats: 100 }],
  };
  const r = await renderAlbara1p(activos, {
    datos: ent, sha256Datos: "ab".repeat(32), modo: "real", signatura: signatura("receptor", { canal: "email" }),
  });
  await guarda("ent-signat", r.bytes);
  const { tot } = await text(r.bytes);
  assertEquals(r.paginas, 1);
  assertStringIncludes(tot, "Conformitat de qui rep:");
  assertStringIncludes(tot, "Signat per Marta Puig Serra · Gerent");
  assertStringIncludes(tot, "des de l'enllaç");
});

Deno.test("tiempo: un CD firmado, muy por debajo de los 2 s del runtime", async () => {
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) await renderCd(activos, opCd({ signatura: signatura("donant") }), "ca");
  const ms = (performance.now() - t0) / 5;
  console.log(`renderCd firmado: ${ms.toFixed(1)} ms de media`);
  assert(ms < 1000);
});
