// Alta de una oferta desde el panel del productor.
//
//   GET  /crear-oferta/campos?productor=<uuid>  -> descriptor de los 14 pasos + catálogos
//   POST /crear-oferta  { productor_id, datos } -> crea el excedente
//
// Por qué una Edge Function y no un insert desde el navegador:
//   · `id_excedente` es un correlativo por productor, producto y día, y `texto_oferta`
//     es el mensaje que se publica. Los dos se generan en `_shared/oferta.ts`, que es
//     código de Deno compartido con el intake. Duplicarlo en TypeScript garantizaría
//     que las dos versiones divergen.
//   · `authenticated` no tiene GRANT de INSERT sobre `excedentes` a propósito (§4bis):
//     así el correlativo no se puede falsificar desde el navegador.
//
// El descriptor se SIRVE en vez de escribirlo en el frontend, para que el formulario
// del panel y las preguntas del bot no puedan separarse.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { crearExcedente } from "../_shared/oferta.ts";
import { CAMPOS, faltantes } from "../_shared/camposOferta.ts";
import { contextoUsuario } from "../_shared/autorizacion.ts";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);

function originPermitido(origin: string): boolean {
  return ALLOWED_ORIGINS.some((patron) => {
    if (!patron.includes("*")) return patron === origin;
    const re = new RegExp(
      "^" + patron.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[A-Za-z0-9-]+") + "$",
    );
    return re.test(origin);
  });
}

function corsPara(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": originPermitido(origin) ? origin : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) {
    return responder({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
  }

  /** ¿Puede este usuario ofertar en nombre de esta ficha de productor? */
  const puedeOfertar = (productorId: string) =>
    ctx.esIntern || ctx.productores.includes(productorId);

  // -------------------------------------------------------------------------
  // GET /campos — descriptor + catálogos
  // -------------------------------------------------------------------------
  if (req.method === "GET") {
    const url = new URL(req.url);
    const productorId = url.searchParams.get("productor");

    const [productos, causas, ubicaciones] = await Promise.all([
      supabase.from("productos").select("nombre, familia").order("nombre"),
      supabase.from("causas").select("codigo, nombre").order("nombre"),
      productorId && puedeOfertar(productorId)
        ? supabase.from("productor_ubicaciones")
          .select("id, alias, municipio").eq("productor_id", productorId)
        : Promise.resolve({ data: [] }),
    ]);

    const familias = [
      ...new Set((productos.data ?? [])
        .map((p: { familia: string | null }) => p.familia)
        .filter(Boolean)),
    ].sort();

    return responder({
      campos: CAMPOS,
      catalogos: {
        familias,
        productos: productos.data ?? [],
        causas: causas.data ?? [],
        ubicaciones: ubicaciones.data ?? [],
      },
    });
  }

  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  // -------------------------------------------------------------------------
  // POST — crear la oferta
  // -------------------------------------------------------------------------
  try {
    const { productor_id: productorId, datos } = await req.json();

    if (!productorId || typeof productorId !== "string") {
      return responder({ error: "Falta 'productor_id'" }, 400);
    }
    if (!datos || typeof datos !== "object") {
      return responder({ error: "Falta 'datos'" }, 400);
    }
    if (!puedeOfertar(productorId)) {
      return responder(
        { error: "No pots publicar ofertes en nom d'aquest productor", code: "forbidden" },
        403,
      );
    }

    const faltan = faltantes(datos as Record<string, unknown>);
    if (faltan.length > 0) {
      return responder({ error: "Falten camps obligatoris", code: "campos_faltantes", faltan }, 400);
    }

    const { data: productor } = await supabase
      .from("productores").select("id, name").eq("id", productorId).maybeSingle();
    if (!productor) return responder({ error: "Productor no trobat" }, 404);

    // `panel` cuando la publica el propio productor; `asistido` cuando la introduce el
    // equipo en su nombre, que es el modelo de operación del servicio (§1bis) y a la
    // hora de leer los datos no es lo mismo que si la hubiera publicado él.
    const r = await crearExcedente(
      supabase,
      datos as Record<string, unknown>,
      productor,
      ctx.esIntern ? "asistido" : "panel",
    );
    if (!r.ok) return responder({ error: r.error ?? "No s'ha pogut crear l'oferta" }, 500);

    return responder({ ok: true, id: r.excedenteId, id_excedente: r.idExcedente }, 200);
  } catch (err) {
    console.error("crear-oferta:", err instanceof Error ? err.message : String(err));
    return responder({ error: "Error interno o JSON inválido" }, 500);
  }
});
