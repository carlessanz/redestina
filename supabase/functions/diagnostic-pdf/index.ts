// El PDF del diagnóstico operativo de un productor, BAJO DEMANDA (Plan 2, A2, 10-11-2026).
//
//   POST /diagnostic-pdf  { tipo_org: "productor", org: <uuid>, idioma?: "ca" | "es" }   (JWT)
//   -> 200 application/pdf (los bytes), Content-Disposition: attachment; filename="diagnostic-<org>.pdf"
//   -> 400 cos_invalid · falta_org · nomes_productors   401 unauthorized   403 forbidden
//      404 no_existeix   500 error_bd · error_render   (JSON { error, code })
//
// 🔴 Es la PRIMERA función del proyecto que devuelve los BYTES de un PDF al navegador. Las
//    demás o generan y suben al bucket (`generar-documento`) o dan una URL firmada de 60 s
//    (`descargar-documento`). Aquí no hay nada que guardar (D2 del Plan 2): **sin fila en
//    `documentos`, sin número, sin serie, sin código de verificación, sin fichero en el
//    bucket**. Se renderiza con el estado de AHORA y se devuelve; pedirlo otra vez da el PDF
//    de ese momento.
//
// Autorización, en este orden (como `descargar-documento`):
//   1. `contextoUsuario()` — sesión y cuenta activa (401). La función corre con
//      `service_role`, que ignora RLS: sin esto cualquiera con sesión leería cualquier cosa.
//   2. `diagnostic_datos(p_tipo_org, p_org, p_user)` — la MISMA regla que la pantalla
//      (`puc_gestionar_pla`: el equipo, o una membresía aprobada y activa de ESA ficha), con
//      el `p_user` explícito porque con `service_role` no hay `auth.uid()`. Comprueba el
//      permiso ANTES que la existencia: un uuid inventado da 403, no 404.
//
// Activos (P4 del plan): las fuentes y los logos se importan del módulo generado de
// `generar-documento` (`activos/incrustats.ts`, base64), así viajan DENTRO del bundle de esta
// función. Nunca `Deno.readFile` ni `static_files`: el 21-09-2026 un redespliegue dejó a
// `generar-documento` sin ellos (`path not found`, AGENTS §11).

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { contextoUsuario } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { cargarActivos } from "../_shared/pdf/fuentes.ts";
import {
  type DatosDiagnostic,
  nomFitxerDiagnostic,
  renderDiagnostic,
} from "../_shared/pdf/render/diagnostic.ts";
// Generado por `scripts/incrustar-activos.ts`: las fuentes y los logos en base64 (P4).
import * as INCRUSTATS from "../generar-documento/activos/incrustats.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) {
    return responder({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
  }

  let tipoOrg = "";
  let org = "";
  let idioma: "ca" | "es" = "ca";
  try {
    const cuerpo = await req.json();
    tipoOrg = typeof cuerpo?.tipo_org === "string" ? cuerpo.tipo_org : "";
    org = typeof cuerpo?.org === "string" ? cuerpo.org.trim() : "";
    idioma = cuerpo?.idioma === "es" ? "es" : "ca";
  } catch {
    return responder({ error: "Cuerpo JSON inválido", code: "cos_invalid" }, 400);
  }
  if (!org) return responder({ error: "Falta 'org'", code: "falta_org" }, 400);
  // Un id que no es un uuid no puede ser de nadie: misma respuesta que lo ajeno.
  if (!UUID.test(org)) {
    return responder({ error: "No pots veure aquest diagnòstic", code: "forbidden" }, 403);
  }

  const t0 = performance.now();
  const { data, error } = await supabase.rpc("diagnostic_datos", {
    p_tipo_org: tipoOrg || "productor",
    p_org: org,
    p_user: ctx.userId,
  });
  if (error) {
    if (error.code === "42501") {
      return responder({ error: "No pots veure aquest diagnòstic", code: "forbidden" }, 403);
    }
    if (error.code === "22023" && /nomes_productors/.test(error.message)) {
      return responder({ error: error.message, code: "nomes_productors" }, 400);
    }
    if (error.code === "22023" && /fitxa_inexistent/.test(error.message)) {
      return responder({ error: "La fitxa no existeix", code: "no_existeix" }, 404);
    }
    console.error("diagnostic-pdf: diagnostic_datos:", error.code, error.message);
    return responder({ error: "Error consultant el diagnòstic", code: "error_bd" }, 500);
  }
  const datos = (data ?? {}) as DatosDiagnostic;

  // Los nombres de la actividad salen del catálogo, como en la pantalla. Si falla, el PDF
  // sale con el código: no vale la pena tumbar la descarga por una etiqueta.
  const noms = new Map<string, string>();
  const { data: cataleg, error: errCat } = await supabase
    .from("tipus_activitat")
    .select("codi, nom_ca, nom_es");
  if (errCat) console.error("diagnostic-pdf: tipus_activitat:", errCat.message);
  for (const a of (cataleg ?? []) as { codi: string; nom_ca: string | null; nom_es: string | null }[]) {
    const nom = idioma === "es" ? a.nom_es : a.nom_ca;
    if (nom) noms.set(a.codi, nom);
  }
  const msDatos = performance.now() - t0;

  let bytes: Uint8Array;
  let paginas = 0;
  const t1 = performance.now();
  try {
    const r = await renderDiagnostic(cargarActivos(INCRUSTATS), {
      datos,
      nomActivitat: (c) => noms.get(c) ?? c,
    }, idioma);
    bytes = r.bytes;
    paginas = r.paginas;
  } catch (e) {
    console.error("diagnostic-pdf: render:", e instanceof Error ? e.message : String(e));
    return responder({ error: "No s'ha pogut generar el PDF", code: "error_render" }, 500);
  }
  const nombre = nomFitxerDiagnostic(datos.organitzacio?.nom);
  console.log(JSON.stringify({
    funcio: "diagnostic-pdf",
    paginas,
    bytes: bytes.length,
    ms_datos: Number(msDatos.toFixed(1)),
    ms_render: Number((performance.now() - t1).toFixed(1)),
  }));

  // Copia a un `ArrayBuffer` propio: `Response` no acepta el `ArrayBufferLike` que tipa pdf-lib.
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      // El nombre lo lee el panel: sin esto, el navegador esconde la cabecera en CORS.
      "Access-Control-Expose-Headers": "Content-Disposition",
      // Es el estado de AHORA: nadie debe guardarlo en caché.
      "Cache-Control": "no-store",
    },
  });
});
