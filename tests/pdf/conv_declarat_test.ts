// El convenio DECLARADO (20270430100000): vigente sin firma ni escaneado. Prueba de Deno, como
// ct_test.ts: el PDF sale en los dos idiomas, y el texto de la página de evidencias dice que
// no hubo firma y quién del equipo lo declaró. Con `PDF_SORTIDA=<carpeta>` deja los PDF.
//
//   deno test -A --config supabase/functions/generar-documento/deno.json tests/pdf/conv_declarat_test.ts

import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import { cargarActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";
import * as INCRUSTATS from "../../supabase/functions/generar-documento/activos/incrustats.ts";
import { diccionarioConvenio } from "../../supabase/functions/_shared/pdf/convenio.ts";
import { renderConv } from "../../supabase/functions/_shared/pdf/render/conv.ts";

const activos = cargarActivos(INCRUSTATS);

// deno-lint-ignore no-explicit-any
const DATOS: any = {
  tipus: "col_receptor",
  subtipus: "contrafirmat",
  numero: "CONV-COL-REC-2026-0001",
  ejercici: 2026,
  idioma: "ca",
  organitzacio: { raso_social: "Menjador Social de Prova", nif: "B00000008", domicili: "Carrer de Prova, 9" },
  firmant: { nombre: "Na Prova", cargo: "Presidenta", declarat: true, referencia: "REF-1" },
  firmat_at: "2026-10-27T10:00:00Z",
  contrafirmat_at: "2026-10-27T10:30:00Z",
  fundacio: { raso_social: "Fundació Espigoladors", apoderada_nom: "Persona de Prova", apoderada_carrec: "Apoderada" },
  evidencies: [],
  origen: "declarat",
  declaracio: {
    per: "Super Admin Redestina", data: "2026-10-27T10:30:00Z",
    signant: "Na Prova", carrec: "Presidenta", referencia: "REF-1",
  },
};

Deno.test("el texto de la declaración dice que no hay firma, quién y en nombre de quién", () => {
  const d = { per: "Super Admin", data: "27/10/2026", organitzacio: "Menjador", signant: "Na Prova", carrec: "Presidenta", referencia: "REF-1" };
  const ca = diccionarioConvenio("ca").declarat_text(d);
  assertStringIncludes(ca, "no porta signatura electrònica ni escanejat");
  assertStringIncludes(ca, "Super Admin");
  assertStringIncludes(ca, "en nom de Menjador");
  assertStringIncludes(ca, "Referència: REF-1");
  const es = diccionarioConvenio("es").declarat_text({ ...d, referencia: "", carrec: "" });
  assertStringIncludes(es, "no lleva firma electrónica ni escaneado");
  assert(!es.includes("Referencia"), "sin referencia no se imprime la etiqueta");
  assert(!es.includes("()"), "sin cargo no quedan paréntesis vacíos");
});

for (const idioma of ["ca", "es"] as const) {
  Deno.test(`el convenio declarado en ${idioma} sale con su página de declaración`, async () => {
    const r = await renderConv(activos, { datos: DATOS, sha256Datos: "ab".repeat(32), subtipo: "contrafirmat" }, idioma);
    assert(r.bytes.length > 2000);
    const dir = Deno.env.get("PDF_SORTIDA");
    if (dir) await Deno.writeFile(`${dir}/conv-declarat-${idioma}.pdf`, r.bytes);
  });
}
