// Cambiar la contraseña de la cortina desde Configuració › General (09-11-2026).
//
//   POST { contrasenya }  →  { ok: true }
//
// SOLO super_admin. Encender/apagar no pasa por aquí (es la RPC `cortina_activar`); esto existe
// porque la huella de la contraseña (PBKDF2, 100.000 vueltas) la tiene que calcular el servidor y
// Postgres no trae PBKDF2. El cliente nunca manda una huella: manda la contraseña y la huella se
// calcula aquí (`_shared/cortinaHash.ts`, el mismo código que el middleware).
//
// La contraseña no se escribe en ningún log. Cambiarla invalida todas las cookies de la cortina:
// el middleware lo nota en un máximo de 20 s (la caché de `cortina-estat`).
//
// Códigos: 401 sin sesión · 403 no super_admin · 400 `contrasenya_curta|llarga|invalida` · 500.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { contextoUsuario } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { huellaDeContrasenya, motiuContrasenyaInvalida } from "../_shared/cortinaHash.ts";

const CODIS = { tipus: "contrasenya_invalida", curta: "contrasenya_curta", llarga: "contrasenya_llarga" } as const;

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SECRET_KEY")!);

  // Aquí NO vale `exigirEquipo`: con `roles_activos` apagado dejaría pasar a cualquier cuenta con
  // sesión, y esto es solo del super_admin siempre.
  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) return responder({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
  if (ctx.rol !== "super_admin") return responder({ error: "Només super_admin", code: "forbidden" }, 403);

  const cos = await req.json().catch(() => null);
  const contrasenya = (cos as { contrasenya?: unknown } | null)?.contrasenya;
  const motiu = motiuContrasenyaInvalida(contrasenya);
  if (motiu) return responder({ error: CODIS[motiu], code: CODIS[motiu] }, 400);

  try {
    const hash = await huellaDeContrasenya(contrasenya as string);
    const { error } = await supabase.rpc("cortina_desar_contrasenya", {
      p_contrasenya: contrasenya, p_hash: hash, p_per: ctx.email ?? "servidor",
    });
    if (error) {
      console.error("cortina-config: no s'ha pogut desar:", error.code, error.message);
      return responder({ error: "no_desat", code: "no_desat" }, 500);
    }
    return responder({ ok: true });
  } catch (e) {
    console.error("cortina-config:", e instanceof Error ? e.message : String(e));
    return responder({ error: "no_desat", code: "no_desat" }, 500);
  }
});
