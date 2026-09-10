// Priorización de entidades para un excedente.
// POST { excedente_id } -> ranking de entidades candidatas con puntuación y motivos.
//
// No envía nada. Requiere sesión de Supabase Auth (mismo esquema que whatsapp-send:
// se despliega SIN --no-verify-jwt y además se comprueba getUser).

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { priorizar } from "../_shared/priorizacion.ts";
import type { EntidadPriorizable, ExcedenteContexto } from "../_shared/priorizacion.ts";
import { exigirEquipo } from "../_shared/autorizacion.ts";
import { decidirCanal } from "../_shared/canal.ts";
import { modoTestActivo } from "../_shared/gate.ts";

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  // Sesión + equipo interno: el ranking devuelve nombre, población y teléfono de las
  // entidades candidatas, así que es información del equipo. La función corre con
  // service_role (BYPASSRLS): sin esta comprobación, cualquier cuenta lo obtendría.
  const auth = await exigirEquipo(supabase, req);
  if ("rechazo" in auth) {
    const { error, code, status } = auth.rechazo;
    return json({ error, code }, status);
  }

  try {
    const { excedente_id } = await req.json();
    if (!excedente_id || typeof excedente_id !== "string") {
      return json({ error: "Falta 'excedente_id'" }, 400);
    }

    const { data: excedente, error: exError } = await supabase
      .from("excedentes")
      .select("familia, producto, kg_total, ubicacion_id, productor_id")
      .eq("id", excedente_id)
      .maybeSingle();
    if (exError) {
      console.error("excedentes select:", exError.message);
      return json({ error: "Error consultando el excedente" }, 500);
    }
    if (!excedente) return json({ error: "Excedente no encontrado" }, 404);

    // El área/población de referencia salen de la ubicación del excedente y, si no,
    // de la ficha del productor.
    let area: string | null = null;
    let poblacion: string | null = null;
    if (excedente.ubicacion_id) {
      const { data: u } = await supabase
        .from("productor_ubicaciones").select("municipio").eq("id", excedente.ubicacion_id).maybeSingle();
      poblacion = u?.municipio ?? null;
    }
    if (excedente.productor_id) {
      const { data: p } = await supabase
        .from("productores").select("area_geografica, poblacion").eq("id", excedente.productor_id).maybeSingle();
      area = p?.area_geografica ?? null;
      poblacion = poblacion ?? p?.poblacion ?? null;
    }

    const { data: entidades, error: entError } = await supabase
      .from("entidades")
      // ⚠️ La lista de columnas va en UN literal, sin concatenar: supabase-js deduce el
      // tipo de la fila analizando ese literal, y ante una expresión (dos cadenas con
      // `+`) se rinde y devuelve GenericStringError, que rompe todo uso posterior de
      // `entidades`. Es la diferencia entre `deno check` en verde y tres errores.
      .select("id, nombre, poblacion, telefono, email, es_test, opt_in, area_geografica, estat, prioritat, productes_frescos, transport_plataforma, descarrega_toro");
    if (entError) {
      console.error("entidades select:", entError.message);
      return json({ error: "Error consultando las entidades" }, 500);
    }

    const contexto: ExcedenteContexto = {
      familia: excedente.familia,
      area_geografica: area,
      poblacion,
      kg_total: excedente.kg_total,
    };
    const ranking = priorizar(
      (entidades ?? []) as unknown as EntidadPriorizable[],
      contexto,
    );

    // Canal recomendado por entidad (`canal.ts`): el correo es el canal por defecto y
    // WhatsApp solo cuando de verdad se puede. Se decide AQUÍ, no en el panel, para
    // que la política viva en un solo sitio; el panel solo la pinta y la obedece.
    // La ventana de 24 h y el opt-in salen de `wa_contacts`, que el ranking no mira.
    const telefonos = (entidades ?? [])
      .map((e: { telefono: string | null }) => e.telefono).filter(Boolean) as string[];
    const { data: contactos } = telefonos.length
      ? await supabase.from("wa_contacts").select("phone, opt_in, last_inbound_at").in("phone", telefonos)
      : { data: [] };
    const porTelefono = new Map<string, { opt_in: boolean | null; last_inbound_at: string | null }>();
    for (const c of contactos ?? []) porTelefono.set(c.phone, c);

    const porId = new Map<string, { telefono: string | null; email: string | null; es_test: boolean | null }>();
    for (const e of entidades ?? []) porId.set(e.id, e);

    // `es_test` decide si PUEDE recibir (§8); el canal, POR DÓNDE. Son cosas
    // distintas y el panel necesita las dos para explicar por qué un botón está gris.
    const modoTest = await modoTestActivo(supabase);

    const rankingConCanal = ranking.map((e) => {
      const ficha = porId.get(e.id);
      const contacto = ficha?.telefono ? porTelefono.get(ficha.telefono) : undefined;
      const d = decidirCanal({
        telefono: ficha?.telefono,
        email: ficha?.email,
        opt_in: contacto?.opt_in,
        last_inbound_at: contacto?.last_inbound_at,
      });
      return {
        ...e,
        email: ficha?.email ?? null,
        es_test: ficha?.es_test === true,
        canal: d.canal,
        motiu_canal: d.motivo,
        whatsapp_possible: d.whatsappPosible,
        email_possible: d.emailPosible,
      };
    });

    return json({ excedente_id, contexto, modo_test: modoTest, ranking: rankingConCanal });
  } catch (err) {
    console.error("priorizar-entidades:", err instanceof Error ? err.message : String(err));
    return json({ error: "Error interno o JSON inválido" }, 500);
  }
});
