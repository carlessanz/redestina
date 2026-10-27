// Alta ASISTIDA: el equipo da de alta una organización con su cuenta y su contraseña inicial
// desde el panel (27-10-2026). Hasta hoy el equipo solo podía crear fichas sin cuenta, y una
// cuenta solo nacía por `/registre` o por los scripts.
//
// ⚠️ FUNCIÓN PROPIA y no una rama de `registro`, por el mismo criterio que
//    `manifestar_interes_assistit`: una sola función con dos regímenes de autorización (una
//    puerta pública con anti-abuso y una puerta de equipo con sesión) es donde se esconde el
//    fallo. Lo que sí comparten es el ALTA ENTERA —`registro/alta.ts`: los mismos pasos, la
//    misma detección de duplicados, la misma compensación y los mismos consentimientos—, así
//    que una organización creada por aquí es indistinguible de una del registro salvo en lo
//    que debe distinguirse: la membresía nace APROBADA y los consentimientos dicen
//    `origen = 'alta_assistida'` y quién los registró.
//
// Exige `pot_aprovar()` (admin o super_admin): crear una cuenta ya aprobada es aprobar un alta.
//
// NO MANDA CORREO: el acceso lo manda la pantalla después con `enviar-acceso`, que es
// transaccional (§8) y sale aunque las notificaciones estén apagadas.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { exigirEquipo, rolesActivos } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { validar } from "../registro/validacio.ts";
import { executarAlta } from "../registro/alta.ts";

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const auth = await exigirEquipo(supabase, req);
  if ("rechazo" in auth) {
    const { error, code, status } = auth.rechazo;
    return responder({ error, code }, status);
  }
  if ((await rolesActivos(supabase)) && !auth.ctx.potAprovar) {
    return responder({ error: "Només admin o super_admin poden donar d'alta comptes", code: "forbidden" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const v = validar(body);
    if (!v.ok) return responder({ error: v.error, code: "dades_invalides", camp: v.camp }, 400);

    const r = await executarAlta(supabase, v.dades, {
      origen: "alta_assistida",
      aprovadaPer: auth.ctx.userId,
      esTest: body.es_test === true,
      ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
      userAgent: req.headers.get("user-agent"),
    });
    return responder({ ...r.body, user_id: r.userId ?? null }, r.status);
  } catch (err) {
    console.error("[alta-assistida] error:", err instanceof Error ? err.message : String(err));
    return responder({ error: "Error intern", code: "error_intern" }, 500);
  }
});
