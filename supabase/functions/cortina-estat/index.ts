// El estado de la cortina para el middleware de Vercel (09-11-2026).
//
//   GET  →  { activa: boolean, hash: <64 hex> | null }     (hash null = vale la huella de respaldo del repo)
//
// PÚBLICA a propósito (`verify_jwt = false`): el middleware corre antes de que nadie tenga sesión.
// Solo devuelve lo mínimo para decidir —si la cortina está puesta y con qué huella se abre—, nunca
// la contraseña. La huella es de la misma naturaleza que `HASH_TOKEN` en el repo: con ella no se
// fabrica la cookie (haría falta invertir SHA-256) y probar contraseñas cuesta 100.000 vueltas.
//
// FAIL-CLOSED por el otro lado: ante cualquier error responde 503 y el middleware deja la cortina
// puesta. Esta función NUNCA contesta «activa: false» si no lo ha leído de la fila.
// Sin CORS: la llama el servidor de Vercel, no un navegador.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { json } from "../_shared/http.ts";

const SIN_CACHE = { "Cache-Control": "no-store" };

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ error: "Method Not Allowed" }, 405, SIN_CACHE);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SECRET_KEY")!);
    const { data, error } = await supabase
      .from("cortina_config").select("activa, hash_token").eq("id", 1).maybeSingle();
    if (error || !data || typeof data.activa !== "boolean") {
      console.error("cortina-estat: lectura fallida", error?.message ?? "sin fila");
      return json({ error: "estat_no_disponible" }, 503, SIN_CACHE);
    }
    return json({ activa: data.activa, hash: data.hash_token ?? null }, 200, SIN_CACHE);
  } catch (e) {
    console.error("cortina-estat:", e instanceof Error ? e.message : String(e));
    return json({ error: "estat_no_disponible" }, 503, SIN_CACHE);
  }
});
