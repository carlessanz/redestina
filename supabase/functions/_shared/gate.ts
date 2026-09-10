// Gate "solo usuarios de prueba" (es_test): fuente de verdad de la app para
// permitir el envío, INDEPENDIENTE de la fase de Meta (AGENTS.md §8). Solo se envía
// a un teléfono/correo que pertenezca a un productor o entidad con es_test = true.
// Lo usan el webhook (respuestas + intake), whatsapp-send (ofertas) y enviar-email.

// deno-lint-ignore no-explicit-any
type Cliente = any;

/** ¿El teléfono es de un productor o entidad marcado es_test? */
export async function esTelefonoTest(supabase: Cliente, to: string): Promise<boolean> {
  const [prod, ent] = await Promise.all([
    supabase.from("productores").select("id").eq("phone", to).eq("es_test", true).limit(1),
    supabase.from("entidades").select("id").eq("telefono", to).eq("es_test", true).limit(1),
  ]);
  return (prod.data ?? []).length > 0 || (ent.data ?? []).length > 0;
}

/**
 * ¿El correo es de un productor o entidad marcado es_test? (email no es único)
 *
 * Mira LAS DOS tablas desde el 30-07-2026: antes solo miraba `entidades`, y con el
 * correo como canal por defecto (`canal.ts`) eso dejaba sin poder recibir nada a un
 * productor de prueba sin WhatsApp — justo el caso que el canal por defecto viene a
 * resolver.
 */
export async function esEmailTest(supabase: Cliente, email: string): Promise<boolean> {
  const [ent, prod] = await Promise.all([
    supabase.from("entidades").select("id").ilike("email", email).eq("es_test", true).limit(1),
    supabase.from("productores").select("id").ilike("email", email).eq("es_test", true).limit(1),
  ]);
  return (ent.data ?? []).length > 0 || (prod.data ?? []).length > 0;
}

/**
 * Gate para los correos DE CUENTA (acceso y recuperación de contraseña), que no van
 * a un productor o receptor sino a alguien con credenciales de la plataforma.
 *
 * Con el modo test activo solo pasa quien sea **equipo interno** (tiene fila en
 * `usuario_roles`) o esté vinculado por `membresias` a una organización `es_test`.
 *
 * El equipo interno pasa siempre, a propósito: son quienes administran el sistema y
 * dejarlos sin poder recuperar su contraseña los bloquearía fuera de la aplicación
 * que gestionan. No es una fuga: para recibir algo hay que tener ya una cuenta con
 * un rol de plataforma concedido a mano.
 */
export async function esCuentaPermitida(supabase: Cliente, email: string): Promise<boolean> {
  const { data: perfil } = await supabase
    .from("perfiles").select("id").ilike("email", email).maybeSingle();
  if (!perfil) return false;

  const { data: roles } = await supabase
    .from("usuario_roles").select("rol").eq("user_id", perfil.id).limit(1);
  if ((roles ?? []).length > 0) return true;

  const { data: ms } = await supabase
    .from("membresias").select("productor_id, entidad_id")
    .eq("user_id", perfil.id).eq("activo", true);
  const productores = (ms ?? []).map((m: { productor_id: string | null }) => m.productor_id).filter(Boolean);
  const entidades = (ms ?? []).map((m: { entidad_id: string | null }) => m.entidad_id).filter(Boolean);

  const [p, e] = await Promise.all([
    productores.length
      ? supabase.from("productores").select("id").in("id", productores).eq("es_test", true).limit(1)
      : Promise.resolve({ data: [] }),
    entidades.length
      ? supabase.from("entidades").select("id").in("id", entidades).eq("es_test", true).limit(1)
      : Promise.resolve({ data: [] }),
  ]);
  return (p.data ?? []).length > 0 || (e.data ?? []).length > 0;
}

/**
 * ¿Está activo el "modo test" global? (`app_settings.test_mode`, gestionado desde
 * Configuración). Si lo está, la app SOLO envía a los usuarios `es_test`.
 * **Fail-safe**: si falta la fila o hay error de lectura, devuelve `true` (se
 * comporta como activo: NO se envía a no-test). Solo un `'false'` explícito lo apaga.
 */
export async function modoTestActivo(supabase: Cliente): Promise<boolean> {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "test_mode").maybeSingle();
  return data?.value !== "false";
}

/**
 * Barrera del MODO PRUEBA de un documento: a quién se le puede mandar.
 *
 * ⚠️ ES INDEPENDIENTE DE `test_mode`, Y ESE ES TODO EL PUNTO. El modo test global (§8) es
 *    un interruptor que el super_admin apaga el día que Redestina sale a producción; los
 *    cierres de prueba, en cambio, se siguen ensayando **después** de ese día —cada
 *    diciembre, sobre el ejercicio en curso— y un resumen o un certificado de ensayo no
 *    puede llegar nunca a un donante real, con `test_mode` encendido o apagado. Por eso
 *    esta comprobación no lo mira: solo mira `documentos.modo`.
 *
 * La regla, en una línea: con `modo = 'prueba'` solo pasan las direcciones de una
 * organización `es_test` y el buzón del equipo (`parametros_documentales.email_equipo`).
 *
 * Es la SEGUNDA barrera, no la única: `cierre_destinatario()` (20261109100100) ya elige
 * en SQL a quién se escribe y en prueba nunca devuelve el correo de un donante real. Esto
 * está aquí porque quien envía es esta capa, y la capa que envía tiene que poder negarse
 * sin depender de que la de arriba haya elegido bien —incluido el caso de un destinatario
 * escrito a mano desde el panel—.
 *
 * Fail-safe como el resto del gate: si no se puede leer `parametros_documentales`, el
 * buzón del equipo se trata como desconocido y esa dirección se bloquea. La duda corta.
 */
export interface DocumentoParaEnviar {
  id?: string | null;
  modo?: string | null;
  tipo?: string | null;
  numero_completo?: string | null;
  /** `documentos.envio`: de aquí sale el destinatario por defecto. */
  envio?: { destinatario?: string | null; [k: string]: unknown } | null;
}

export interface ResultadoDestinatarios {
  /** Direcciones a las que SÍ se puede escribir. */
  permitidos: string[];
  /** Las que no, con el motivo (para el log y para el panel). */
  bloqueados: { email: string; motivo: "no_test_user" | "sense_bustia_equip" }[];
  /** `true` si el documento es de prueba y, por tanto, se ha aplicado la barrera. */
  modoPrueba: boolean;
}

export async function destinatariosPrueba(
  supabase: Cliente,
  documento: DocumentoParaEnviar,
  destinos?: string[],
): Promise<ResultadoDestinatarios> {
  const lista = (destinos && destinos.length > 0
    ? destinos
    : [documento.envio?.destinatario ?? ""])
    .map((e) => (e ?? "").trim())
    .filter((e) => e !== "");

  // Un documento real no pasa por aquí: lo filtran los gates de siempre (§8).
  if (documento.modo !== "prueba") {
    return { permitidos: [...new Set(lista)], bloqueados: [], modoPrueba: false };
  }

  const { data: params } = await supabase
    .from("parametros_documentales").select("id, email_equipo").eq("id", 1).maybeSingle();
  const equipo = (params?.email_equipo ?? "").trim().toLowerCase();

  const permitidos: string[] = [];
  const bloqueados: { email: string; motivo: "no_test_user" | "sense_bustia_equip" }[] = [];
  for (const email of [...new Set(lista)]) {
    if (equipo && email.toLowerCase() === equipo) {
      permitidos.push(email);
      continue;
    }
    if (await esEmailTest(supabase, email)) {
      permitidos.push(email);
      continue;
    }
    bloqueados.push({ email, motivo: equipo ? "no_test_user" : "sense_bustia_equip" });
  }
  return { permitidos, bloqueados, modoPrueba: true };
}
