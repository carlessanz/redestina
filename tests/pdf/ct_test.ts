// El certificado de aprofitament alimentari (CT). Prueba de Deno, como albara1p_test.ts:
// comprueba que el título —más largo que el anterior «Certificat de transacció»— cabe y
// que el PDF sale en los dos idiomas. Con `PDF_SORTIDA=<carpeta>` deja los PDF para mirarlos.
//
//   deno test -A --config supabase/functions/generar-documento/deno.json tests/pdf/ct_test.ts

import { assert } from "jsr:@std/assert@1";
import { cargarActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";
import * as INCRUSTATS from "../../supabase/functions/generar-documento/activos/incrustats.ts";
import { renderCt } from "../../supabase/functions/_shared/pdf/render/ct.ts";

const activos = cargarActivos(INCRUSTATS);

// deno-lint-ignore no-explicit-any
const DATOS: any = {
  numero: "P-CT-2026-0001",
  exercici: 2026,
  periode: { des_de: "2026-01-01", fins_a: "2026-12-31" },
  data_generacio: "2026-10-12",
  kg: 195,
  apoderada: { nom: "Persona de Prova", carrec: "Apoderada" },
  fundacio: { "raó_social": "Fundació Espigoladors", cif: "G00000000", domicili: "Carrer de Prova, 1" },
  generador: { "raó_social": "Mas de Prova SCP", nif: "B00000001", domicili: "Carrer de Prova, 2" },
  detall: [{ producte: "Préssec", operacions: 1, kg: 195 }],
  destinacions: [{ entitat: "Obrador de Prova" }],
};

for (const idioma of ["ca", "es"] as const) {
  Deno.test(`el CT en ${idioma} sale y lleva el título nuevo`, async () => {
    const r = await renderCt(activos, { datos: DATOS, sha256Datos: "ab".repeat(32), modo: "prueba" }, idioma);
    assert(r.bytes.length > 2000);
    const dir = Deno.env.get("PDF_SORTIDA");
    if (dir) await Deno.writeFile(`${dir}/ct-${idioma}.pdf`, r.bytes);
  });
}
