// Autorización por rol para las Edge Functions.
//
// Complementa —no sustituye— el `getUser(token)` que ya hacían: eso dice QUIÉN eres,
// no QUÉ puedes hacer. Hasta ahora las funciones solo autenticaban, así que cualquier
// cuenta con sesión podía enviar WhatsApp, mandar correo o priorizar entidades.
//
// Esto NO lo arregla la RLS: las funciones crean el cliente con SB_SECRET_KEY
// (service_role), que en Supabase tiene BYPASSRLS. La autorización del servidor es una
// capa aparte, y es esta.
//
// Mismo interruptor que la base (`app_settings.roles_activos`): mientras esté apagado,
// todo el mundo pasa, igual que hoy. Fail-open deliberado y simétrico con las
// políticas (ver 20260730092000_funciones_sesion_y_rol.sql) — pero SOLO ante un valor
// explícito o una fila ausente: un error de lectura falla cerrado (ver `rolesActivos`).

// deno-lint-ignore no-explicit-any
type Cliente = any;

export type RolPlataforma = "super_admin" | "admin" | "tecnic";

export interface Contexto {
  userId: string;
  email: string | null;
  /** Rol de plataforma, o null si es un usuario externo (productor/receptor). */
  rol: RolPlataforma | null;
  esIntern: boolean;
  potAprovar: boolean;
  /** Ids de las fichas de productor y entidad a las que pertenece. */
  productores: string[];
  entidades: string[];
}

/**
 * ¿Está encendido el modelo de roles?
 *
 * Mismo VALOR que `roles_activos()` en SQL: solo un `'true'` explícito lo enciende, y una
 * fila ausente o `'false'` es el modo permisivo documentado (§4bis, fail-open deliberado).
 *
 * ⚠️ Pero un ERROR de lectura NO es «apagado»: es no saberlo. Hasta el 07-10-2026 un fallo
 * de la consulta devolvía `false` y dejaba `exigirEquipo` abierto a cualquier cuenta con
 * sesión —enviar WhatsApp, correo, priorizar, reenviar documentos—. Ante el error se falla
 * CERRADO (como si estuviera encendido), con el mismo criterio que `modoTestActivo` (§8):
 * la duda corta. El equipo sigue pasando, porque su rol se lee aparte.
 */
export async function rolesActivos(supabase: Cliente): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("app_settings").select("value").eq("key", "roles_activos").maybeSingle();
    if (error) {
      console.error("rolesActivos: lectura fallida, se trata como encendido:", error.message);
      return true;
    }
    return data?.value === "true";
  } catch (e) {
    console.error(
      "rolesActivos: lectura fallida, se trata como encendido:",
      e instanceof Error ? e.message : String(e),
    );
    return true;
  }
}

/** Resuelve la sesión y su contexto de rol. `null` = sin sesión válida. */
export async function contextoUsuario(
  supabase: Cliente,
  req: Request,
): Promise<Contexto | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const [roles, membresias, perfil] = await Promise.all([
    supabase.from("usuario_roles").select("rol").eq("user_id", user.id),
    supabase.from("membresias")
      .select("productor_id, entidad_id").eq("user_id", user.id).eq("activo", true),
    supabase.from("perfiles").select("activo").eq("id", user.id).maybeSingle(),
  ]);

  // Una cuenta desactivada no es nadie, aunque su JWT siga vivo.
  if (perfil.data && perfil.data.activo === false) return null;

  const nombres: string[] = (roles.data ?? []).map((r: { rol: string }) => r.rol);
  const rol: RolPlataforma | null = nombres.includes("super_admin")
    ? "super_admin"
    : nombres.includes("admin")
    ? "admin"
    : nombres.includes("tecnic")
    ? "tecnic"
    : null;

  return {
    userId: user.id,
    email: user.email ?? null,
    rol,
    esIntern: rol !== null,
    potAprovar: rol === "super_admin" || rol === "admin",
    productores: (membresias.data ?? [])
      .map((m: { productor_id: string | null }) => m.productor_id).filter(Boolean),
    entidades: (membresias.data ?? [])
      .map((m: { entidad_id: string | null }) => m.entidad_id).filter(Boolean),
  };
}

export interface Rechazo {
  error: string;
  code: "unauthorized" | "forbidden";
  status: 401 | 403;
}

/**
 * Exige sesión y, si el modelo de roles está encendido, pertenencia al equipo interno.
 * Devuelve el contexto, o el rechazo listo para responder.
 */
export async function exigirEquipo(
  supabase: Cliente,
  req: Request,
): Promise<{ ctx: Contexto } | { rechazo: Rechazo }> {
  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) {
    return {
      rechazo: {
        error: "Necesitas iniciar sesión",
        code: "unauthorized",
        status: 401,
      },
    };
  }
  if ((await rolesActivos(supabase)) && !ctx.esIntern) {
    return {
      rechazo: {
        error: "Tu cuenta no pertenece al equipo interno",
        code: "forbidden",
        status: 403,
      },
    };
  }
  return { ctx };
}
