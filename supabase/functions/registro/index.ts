// Registro público self-service: alta de cuenta + ficha + membresía PENDIENTE.
//
// Se despliega con --no-verify-jwt: la llama alguien que todavía no tiene cuenta. Es la
// primera función pública que ESCRIBE (recuperar-password solo lee y manda un correo),
// así que todo lo que hay aquí gira alrededor de eso: validar antes de tocar nada,
// frenar el abuso, y no dejar residuos si algo falla a medias.
//
// Crea tres cosas, en este orden, porque es el único que permite compensar:
//   1. la cuenta de Auth (Admin API; el trigger on_auth_user_created crea el perfil)
//   2. la ficha de `productores` o `entidades`
//   3. la `membresias` con activo = false y aprovacio = 'pendent'
// Si falla el paso 2 se borra la cuenta; si falla el 3, la ficha y la cuenta. El peor
// residuo posible —una cuenta de Auth sin membresía— es inocuo: sin membresía activa
// no ve absolutamente nada (mis_productores/mis_entidades filtran por `activo`).
//
// NO ENVÍA NINGÚN CORREO, y es deliberado. Con el modo test activo (§8) la cuenta recién
// creada no pasaría `esCuentaPermitida` —su organización nace con es_test = false—, así
// que el correo se descartaría en silencio y el alta quedaría a medias: una persona
// esperando un mensaje que nunca llega. La validación la hace el equipo desde el panel,
// y es ahí donde se decide cómo se le avisa. Por eso esta función no importa
// `_shared/resend.ts` ni `_shared/gate.ts`.
//
// TAMPOCO VINCULA con una ficha existente aunque el correo coincida: eso convertiría
// «conozco el email de esta organización» en «soy esta organización». Un duplicado lo
// resuelve el equipo al aprobar; una suplantación, no.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

// Sin tipos generados de la base, como en `_shared/gate.ts`: anotar el cliente con
// `ReturnType<typeof createClient>` resuelve el esquema a `never` y todo insert deja
// de compilar. Con el alias suelto, el tipado útil lo pone la validación de arriba.
// deno-lint-ignore no-explicit-any
type Cliente = any;

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

// ---------------------------------------------------------------------------
// Anti-abuso
// ---------------------------------------------------------------------------
// Sin captcha todavía (queda anotado como deuda). Tres frenos de coste creciente:
//   · honeypot: un campo que ningún humano ve; si viene relleno, 200 y a la basura
//   · límite por IP EN MEMORIA: best-effort de verdad. El isolate se recicla y hay
//     varios a la vez, así que el contador se pierde y no es global. Frena el script
//     tonto, no una campaña repartida; para eso está el freno de abajo
//   · freno global DURABLE: si ya hay 20 registros pendientes de la última hora, se
//     corta. Ese sí vive en la base y no depende de qué isolate atienda la petición
const FINESTRA_MS = 10 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_PENDENTS_HORA = 20;

const intentsPerIp = new Map<string, number[]>();

function massaIntentsIp(ip: string): boolean {
  if (!ip) return false;
  const ara = Date.now();

  // Poda perezosa: sin esto el Map crece hasta que el isolate muere.
  if (intentsPerIp.size > 500) {
    for (const [clau, marques] of intentsPerIp) {
      if (marques.every((t) => ara - t >= FINESTRA_MS)) intentsPerIp.delete(clau);
    }
  }

  const recents = (intentsPerIp.get(ip) ?? []).filter((t) => ara - t < FINESTRA_MS);
  recents.push(ara);
  intentsPerIp.set(ip, recents);
  return recents.length > MAX_PER_IP;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------
const ROLS = ["productor", "receptor"] as const;
const TIPUS_RECEPTOR = ["social", "animal", "transformador", "comercial"] as const;

type Rol = typeof ROLS[number];

interface Dades {
  rol: Rol;
  nomOrganitzacio: string;
  nomPersona: string;
  email: string;
  password: string;
  telefon: string | null;
  poblacio: string | null;
  tipoReceptor: string | null;
}

type Validacio = { ok: true; dades: Dades } | { ok: false; camp: string; error: string };

function textNet(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Escapa los comodines de LIKE antes de usar el valor como patrón de `ilike`.
 * No es cosmético: el '_' es corriente en un correo (`joan_puig@…`) y sin escapar
 * casaría con cualquier carácter, dando por duplicado un alta que no lo es.
 */
function patroLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (c) => "\\" + c);
}

function validar(body: Record<string, unknown>): Validacio {
  const rol = textNet(body.rol) as Rol;
  if (!ROLS.includes(rol)) {
    return { ok: false, camp: "rol", error: "Cal triar si ets productor o receptor" };
  }

  const nomOrganitzacio = textNet(body.nom_organitzacio);
  if (nomOrganitzacio.length < 2 || nomOrganitzacio.length > 120) {
    return { ok: false, camp: "nom_organitzacio", error: "El nom de l'organitzacio ha de tenir entre 2 i 120 caracters" };
  }

  const nomPersona = textNet(body.nom_persona);
  if (nomPersona.length < 2 || nomPersona.length > 120) {
    return { ok: false, camp: "nom_persona", error: "El nom de la persona ha de tenir entre 2 i 120 caracters" };
  }

  const email = textNet(body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return { ok: false, camp: "email", error: "El correu no es valid" };
  }

  const password = typeof body.password === "string" ? body.password : "";
  // 6 es el mínimo que acepta GoTrue (auth.minimum_password_length en config.toml):
  // pedir menos aquí solo serviría para que el error lo diera la Admin API.
  if (password.length < 6) {
    return { ok: false, camp: "password", error: "La contrasenya ha de tenir com a minim 6 caracters" };
  }

  // Teléfono E.164 sin '+', solo dígitos (§7). Lo que quede vacío tras normalizar es
  // que no había teléfono: es opcional, no un error.
  let telefon: string | null = null;
  const telBrut = textNet(body.telefon);
  if (telBrut) {
    const net = telBrut.replace(/\D/g, "");
    if (!net) {
      telefon = null;
    } else if (!/^[1-9]\d{6,14}$/.test(net)) {
      return { ok: false, camp: "telefon", error: "El telefon no es valid" };
    } else {
      telefon = net;
    }
  }

  const poblacioBruta = textNet(body.poblacio);
  if (poblacioBruta.length > 120) {
    return { ok: false, camp: "poblacio", error: "La poblacio es massa llarga" };
  }
  const poblacio = poblacioBruta || null;

  // `tipo_receptor` decide qué ofertas verá (matriz modalitat_receptor_compat), así
  // que es obligatorio para un receptor; en un productor no significa nada y se
  // rechaza en vez de ignorarse, para que un formulario mal cableado se note.
  const tipoBrut = textNet(body.tipo_receptor);
  let tipoReceptor: string | null = null;
  if (rol === "receptor") {
    if (!(TIPUS_RECEPTOR as readonly string[]).includes(tipoBrut)) {
      return { ok: false, camp: "tipo_receptor", error: "Cal triar quin tipus de receptor ets" };
    }
    tipoReceptor = tipoBrut;
  } else if (tipoBrut) {
    return { ok: false, camp: "tipo_receptor", error: "Un productor no te tipus de receptor" };
  }

  return {
    ok: true,
    dades: { rol, nomOrganitzacio, nomPersona, email, password, telefon, poblacio, tipoReceptor },
  };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  // Fuera del try: la compensación del catch necesita saber qué se llegó a crear.
  let supabase: Cliente = null;
  let userId: string | null = null;
  let fitxaId: string | null = null;
  let taula: "productores" | "entidades" = "productores";

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // Honeypot: se responde 200 como si hubiera ido bien. Decirle a un bot que lo
    // hemos detectado solo sirve para que ajuste el siguiente intento.
    if (textNet(body.web)) {
      console.warn("[registro] honeypot relleno, descartado");
      return responder({ ok: true }, 200);
    }

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    if (massaIntentsIp(ip)) {
      return responder(
        { error: "Has fet massa intents. Torna-ho a provar d'aqui una estona.", code: "massa_solicituds" },
        429,
      );
    }

    const v = validar(body);
    if (!v.ok) return responder({ error: v.error, code: "dades_invalides", camp: v.camp }, 400);
    const d = v.dades;

    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SB_SECRET_KEY")!,
    );

    // Freno global durable: si la cola ya está desbordada, lo que llegue detrás es
    // ruido para el equipo. Se corta aquí, antes de crear nada.
    const { count } = await supabase
      .from("membresias")
      .select("id", { count: "exact", head: true })
      .eq("aprovacio", "pendent")
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if ((count ?? 0) >= MAX_PENDENTS_HORA) {
      console.warn("[registro] freno global:", count, "pendientes en la ultima hora");
      return responder(
        { error: "Ara mateix no podem processar mes sol·licituds. Torna-ho a provar mes tard.", code: "massa_solicituds" },
        429,
      );
    }

    // -----------------------------------------------------------------------
    // Prechecks: fallar aquí es limpio; fallar después obliga a compensar.
    // -----------------------------------------------------------------------
    const { data: perfils } = await supabase
      .from("perfiles").select("id").ilike("email", patroLike(d.email)).limit(1);
    if ((perfils ?? []).length > 0) {
      return responder(
        { error: "Aquest correu ja te compte. Prova d'iniciar sessio.", code: "email_ja_registrat" },
        409,
      );
    }

    // `productores.email` y `productores.phone` son UNIQUE: sin este precheck el
    // insert reventaría con 23505 después de haber creado ya la cuenta de Auth.
    // `entidades` no tiene ninguna restricción de unicidad, así que no aplica: un
    // receptor duplicado lo detecta el equipo en la cola.
    if (d.rol === "productor") {
      const { data: xocEmail } = await supabase
        .from("productores").select("id").ilike("email", patroLike(d.email)).limit(1);
      if ((xocEmail ?? []).length > 0) {
        return responder(
          { error: "Aquest correu ja consta en una fitxa. Contacta amb l'equip de Redestina.", code: "dades_en_us", camp: "email" },
          409,
        );
      }
      if (d.telefon) {
        const { data: xocTel } = await supabase
          .from("productores").select("id").eq("phone", d.telefon).limit(1);
        if ((xocTel ?? []).length > 0) {
          return responder(
            { error: "Aquest telefon ja consta en una fitxa. Contacta amb l'equip de Redestina.", code: "dades_en_us", camp: "telefon" },
            409,
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // 1. Cuenta de Auth. `email_confirm: true` porque el mailer nativo está apagado
    //    (§9) y sin esto la cuenta quedaría sin poder iniciar sesión nunca.
    // -----------------------------------------------------------------------
    const { data: creada, error: errCrear } = await supabase.auth.admin.createUser({
      email: d.email,
      password: d.password,
      email_confirm: true,
      user_metadata: { nombre: d.nomPersona },
    });
    if (errCrear || !creada?.user) {
      const codi = (errCrear as unknown as { code?: string } | null)?.code ?? "";
      const missatge = errCrear?.message ?? "";
      // Carrera con el precheck de arriba, o cuenta creada por otra vía.
      if (codi === "email_exists" || /already been registered|already exists/i.test(missatge)) {
        return responder(
          { error: "Aquest correu ja te compte. Prova d'iniciar sessio.", code: "email_ja_registrat" },
          409,
        );
      }
      console.error("[registro] createUser:", missatge);
      return responder({ error: "No s'ha pogut crear el compte", code: "error_intern" }, 500);
    }
    userId = creada.user.id as string;

    // -----------------------------------------------------------------------
    // 2. Ficha de la organización.
    // -----------------------------------------------------------------------
    taula = d.rol === "productor" ? "productores" : "entidades";
    const fila: Record<string, unknown> = d.rol === "productor"
      ? {
        name: d.nomPersona,
        empresa: d.nomOrganitzacio,
        email: d.email,
        phone: d.telefon,
        poblacion: d.poblacio,
        // es_test = false: una organización que se registra sola NO recibe envíos
        // mientras el modo test esté activo (§8). Lo marca el equipo si toca.
        es_test: false,
      }
      : {
        nombre: d.nomOrganitzacio,
        contacto: d.nomPersona,
        email: d.email,
        telefono: d.telefon,
        poblacion: d.poblacio,
        tipo_receptor: d.tipoReceptor,
        // opt_in = false: el consentimiento de WhatsApp se recoge aparte (§12.3).
        opt_in: false,
        es_test: false,
        // `estat` se deja NULL a propósito: la priorización excluye a las entidades
        // sin estado (_shared/priorizacion.ts), así que una ficha recién registrada
        // no puede colarse en un ranking hasta que el equipo la revise.
      };

    const { data: fitxa, error: errFitxa } = await supabase
      .from(taula).insert(fila).select("id").single();

    if (errFitxa || !fitxa) {
      await esborrarUsuari(supabase, userId);
      if (errFitxa?.code === "23505") {
        const camp = /phone/i.test(errFitxa.message ?? "") ? "telefon" : "email";
        return responder(
          { error: "Aquestes dades ja consten en una fitxa. Contacta amb l'equip de Redestina.", code: "dades_en_us", camp },
          409,
        );
      }
      console.error("[registro] insert ficha:", taula, errFitxa?.message);
      return responder({ error: "No s'ha pogut crear la fitxa", code: "error_intern" }, 500);
    }
    fitxaId = fitxa.id as string;

    // -----------------------------------------------------------------------
    // 3. Membresía PENDIENTE. Es la pieza que da (o no da) acceso.
    // -----------------------------------------------------------------------
    const { error: errMembresia } = await supabase.from("membresias").insert({
      user_id: userId,
      tipo: d.rol === "productor" ? "productor" : "entidad",
      productor_id: d.rol === "productor" ? fitxaId : null,
      entidad_id: d.rol === "receptor" ? fitxaId : null,
      // Quien registra la organización es su titular: es quien podrá editar la ficha
      // (soc_titular) cuando el equipo apruebe.
      rol_org: "titular",
      activo: false,
      aprovacio: "pendent",
    });

    if (errMembresia) {
      await supabase.from(taula).delete().eq("id", fitxaId);
      await esborrarUsuari(supabase, userId);
      console.error("[registro] insert membresia:", errMembresia.message);
      return responder({ error: "No s'ha pogut completar el registre", code: "error_intern" }, 500);
    }

    return responder({ ok: true }, 200);
  } catch (err) {
    // Cualquier cosa no prevista: se intenta dejar la base como estaba, en orden
    // inverso al de creación. Si la compensación también falla queda en el log con
    // todos los ids, que es lo que hace falta para limpiarlo a mano.
    console.error("[registro] error:", err instanceof Error ? err.message : String(err));
    if (supabase && fitxaId) {
      const { error } = await supabase.from(taula).delete().eq("id", fitxaId);
      if (error) console.error("[registro] residuo ficha:", taula, fitxaId, error.message);
    }
    if (supabase && userId) await esborrarUsuari(supabase, userId);
    return responder({ error: "Error intern", code: "error_intern" }, 500);
  }
});

/** Compensación: borra la cuenta de Auth recién creada. Nunca lanza. */
async function esborrarUsuari(supabase: Cliente, userId: string): Promise<void> {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error("[registro] NO se pudo compensar el alta de auth:", userId, error.message);
  }
}
