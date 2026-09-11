// Registro público self-service: alta de cuenta + ficha + membresía PENDIENTE.
//
// Se despliega con --no-verify-jwt: la llama alguien que todavía no tiene cuenta. Es la
// primera función pública que ESCRIBE (recuperar-password solo lee y manda un correo),
// así que todo lo que hay aquí gira alrededor de eso: validar antes de tocar nada,
// frenar el abuso, y no dejar residuos si algo falla a medias.
//
// Crea cuatro cosas, en este orden, porque es el único que permite compensar:
//   1. la cuenta de Auth (Admin API; el trigger on_auth_user_created crea el perfil)
//   2. la fila de `organizaciones` (identidad de la organización; solo si es un alta nueva)
//   3. la ficha de `productores` o `entidades`, apuntando a esa organización
//   4. la `membresias` con activo = false y aprovacio = 'pendent'
// Si falla el paso 3 se borran la organización y la cuenta; si falla el 4, la ficha, la
// organización y la cuenta. El peor residuo posible —una cuenta de Auth sin membresía— es
// inocuo: sin membresía activa no ve absolutamente nada (mis_productores/mis_entidades
// filtran por `activo`). El paso 2 es ADEMÁS best-effort: si no se puede crear la
// organización, la ficha nace sin ella —exactamente como las que se crean a mano— antes
// que perder un alta por una identidad que el equipo puede enlazar después.
//
// Y DESDE LA FASE 2, una quinta cosa que **no se compensa a propósito**: el convenio en
// `esborrany` y su enlace de firma (§3.2.4, «Dentro del registro»). Si ese paso falla, el
// alta se da por buena igualmente y el equipo prepara el convenio desde la campaña: negar
// un registro entero porque no se pudo preparar un contrato que todavía nadie ha leído
// sería tirar a la basura lo único que la persona vino a hacer.
//
// ⚠️ EL TOKEN DE FIRMA SOLO SE DEVUELVE SI FIRMA AHORA MISMO. Cuando la persona dice ser
//    la representante legal, la respuesta trae el token para que la propia pantalla siga
//    a `/signar/<token>`: no viaja por ningún sitio, es la misma sesión y la misma
//    persona. Cuando indica el correo de otra persona, el enlace se crea y se queda
//    esperando: esta función NO envía correo (ver abajo) y quien lo manda es el equipo
//    desde la bandeja de la campaña.
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
//
// ⚠️ DESDE LA ETAPA 2 DE LA ORGANIZACIÓN UNIFICADA (§1bis brecha 2, deuda §12.28) SÍ DETECTA
//    que la organización ya consta, que es cosa distinta de vincularla. Antes solo veía los
//    choques con `productores` —y los veía porque `email` y `phone` son UNIQUE allí—, así que
//    una entidad ya fichada se registraba otra vez sin que nada lo notara. Ahora se consultan
//    las fichas de las dos tablas y `v_organizaciones`, y salen tres caminos (el detalle del
//    criterio, en `coincidencies.ts`):
//      1. nada coincide → alta normal, y la ficha estrena su fila en `organizaciones`
//      2. coincide una organización que NO tiene ficha de este tipo → es la misma
//         organización estrenando papel: **se da el alta, SIN enlazar**, con una nota en el
//         comentario de la ficha para que lo decida el equipo (ver abajo)
//      3. coincide una organización que YA tiene ficha de este tipo → 409 `dades_en_us`
//
//    El caso 2 no se enlaza solo, y no es timidez: enlazar sería exactamente lo que el
//    párrafo de arriba prohíbe, solo que con un rodeo. Hoy el acceso lo da `membresias`, que
//    apunta a una ficha, así que enlazar no abriría nada todavía; pero la unificación existe
//    para que mañana los convenios, los albaranes y los certificados se resuelvan POR
//    ORGANIZACIÓN, y ese día el enlace se convierte, sin que nadie lo vuelva a mirar, en
//    acceso a los kilos y al certificado fiscal de la otra ficha — creado por un POST sin
//    sesión de quien solo sabía un correo. Aprobar un alta es un clic y nada en esa pantalla
//    diría que además se está confirmando una identidad. Así que se detecta, se avisa y se
//    deja la decisión donde tiene dueño.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  type Decisio,
  decidir,
  type FitxaCoincident,
  mateixEmail,
  type MotiuCoincidencia,
  mateixTelefon,
  notaPaperNou,
  type OrgCoincident,
  patroTelefon,
  type TipusFitxa,
  ultimes9,
} from "./coincidencies.ts";

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
  // --- fase 2: lo que el convenio necesita de la ficha, y quién lo firma
  nif: string | null;
  domicili: string | null;
  codiPostal: string | null;
  representant: string | null;
  carrec: string | null;
  /** `true` = la persona que registra dice ser la representante legal y firma ya. */
  firmarAra: boolean;
  /** Correo de quien firmará, si no es quien registra. */
  emailSignant: string | null;
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

  // -------------------------------------------------------------------------
  // Fase 2: los datos del convenio. TODOS opcionales, y no es una laxitud.
  // -------------------------------------------------------------------------
  // `preparar_convenio()` no exige ficha completa a propósito (§3.2.6, paso 2): lo que
  // falte se pide en la página de firma, y descubrir qué falta es justo lo que la campaña
  // quiere. Exigir el NIF aquí convertiría un formulario de alta en una gestoría y dejaría
  // fuera a quien no lo tenga a mano.
  const corto = (v: unknown, max: number) => textNet(v).slice(0, max) || null;
  const nif = corto(body.nif, 20);
  const domicili = corto(body.domicili ?? body.domicilio, 200);
  const codiPostal = corto(body.codi_postal ?? body.codigo_postal, 10);
  const representant = corto(body.representant ?? body.representante, 120);
  const carrec = corto(body.carrec ?? body.cargo, 120);

  const firmarAra = body.firmar_ara === true;
  let emailSignant: string | null = null;
  const signantBrut = textNet(body.email_signant).toLowerCase();
  if (signantBrut) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signantBrut) || signantBrut.length > 200) {
      return { ok: false, camp: "email_signant", error: "El correu de qui signa no es valid" };
    }
    emailSignant = signantBrut;
  }
  if (firmarAra && emailSignant && emailSignant !== email) {
    return {
      ok: false,
      camp: "email_signant",
      error: "O signes tu ara mateix o indiques el correu d'una altra persona, no les dues coses",
    };
  }

  return {
    ok: true,
    dades: {
      rol, nomOrganitzacio, nomPersona, email, password, telefon, poblacio, tipoReceptor,
      nif, domicili, codiPostal, representant, carrec, firmarAra, emailSignant,
    },
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
  let organitzacioId: string | null = null;
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

    // ¿Esta organización ya existe? (etapa 2). Sustituye al precheck que solo miraba
    // `productores` —y que solo existía porque allí `email` y `phone` son UNIQUE y el
    // insert habría reventado con 23505 con la cuenta de Auth ya creada—. El 23505 se
    // sigue capturando abajo por la carrera entre esta consulta y el insert.
    const tipusRol: TipusFitxa = d.rol === "productor" ? "productor" : "entidad";
    const t0 = performance.now();
    const decisio = await decidirCoincidencia(supabase, d, tipusRol);
    console.log(JSON.stringify({
      fn: "registro",
      pas: "coincidencies",
      cas: decisio.cas,
      // Los papeles con los que ha casado, no el correo ni el teléfono: esto es un log de
      // una función pública y lo que se busca aquí es entender una decisión, no reconstruir
      // los datos de quien la provocó.
      fitxes: decisio.cas === "paper_nou"
        ? decisio.fitxes.map((f) => f.tipus)
        : decisio.cas === "duplicat"
        ? [decisio.fitxa.tipus]
        : [],
      ms: Math.round((performance.now() - t0) * 10) / 10,
    }));

    if (decisio.cas === "duplicat") {
      return responder(
        {
          error: decisio.camp === "email"
            ? "Aquest correu ja consta en una fitxa. Contacta amb l'equip de Redestina."
            : "Aquest telefon ja consta en una fitxa. Contacta amb l'equip de Redestina.",
          code: "dades_en_us",
          camp: decisio.camp,
        },
        409,
      );
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
    // 2. La organización. Solo cuando no coincide nada: si el alta es el papel nuevo de
    //    una que ya consta, la ficha nace SIN organización a propósito —crearle una
    //    segunda identidad a la misma organización sería fabricar el duplicado que esto
    //    viene a detectar, y enlazarla con la existente es la decisión que se le deja al
    //    equipo—. Nunca corta el alta: si falla, se sigue con `organizacion_id` nulo.
    // -----------------------------------------------------------------------
    if (decisio.cas === "alta") {
      const { data: org, error: errOrg } = await supabase
        .from("organizaciones").insert({ creada_por: userId }).select("id").single();
      if (errOrg || !org) {
        console.warn("[registro] organizacion no creada:", errOrg?.code, errOrg?.message);
      } else {
        organitzacioId = org.id as string;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Ficha de la organización.
    // -----------------------------------------------------------------------
    // La nota del caso «papel nuevo» va en el comentario de la ficha: es lo que ve el
    // equipo cuando entra desde la cola de «Registres pendents» a completarla (§6quater).
    const nota = decisio.cas === "paper_nou"
      ? notaPaperNou(decisio.fitxes, new Date().toISOString())
      : null;

    taula = d.rol === "productor" ? "productores" : "entidades";
    const fila: Record<string, unknown> = d.rol === "productor"
      ? {
        name: d.nomPersona,
        empresa: d.nomOrganitzacio,
        email: d.email,
        phone: d.telefon,
        poblacion: d.poblacio,
        nif: d.nif,
        direccion: d.domicili,
        codigo_postal: d.codiPostal,
        organizacion_id: organitzacioId,
        comentario: nota,
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
        nif: d.nif,
        direccion: d.domicili,
        codigo_postal: d.codiPostal,
        tipo_receptor: d.tipoReceptor,
        organizacion_id: organitzacioId,
        comentarios: nota,
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
      await esborrarOrganitzacio(supabase, organitzacioId);
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
    // 4. Membresía PENDIENTE. Es la pieza que da (o no da) acceso.
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
      await esborrarOrganitzacio(supabase, organitzacioId);
      await esborrarUsuari(supabase, userId);
      console.error("[registro] insert membresia:", errMembresia.message);
      return responder({ error: "No s'ha pogut completar el registre", code: "error_intern" }, 500);
    }

    // -----------------------------------------------------------------------
    // 5. El convenio en borrador y su enlace de firma (§3.2.4). Fuera del camino
    //    de compensación: si falla, el alta sigue siendo válida (ver cabecera).
    // -----------------------------------------------------------------------
    const conveni = await prepararConveni(supabase, d, fitxaId);

    // `revisio_equip` solo dice que el alta necesita una mirada antes de activarse; NO
    // dice con qué organización ha coincidido ni qué papeles tiene. Que exista una ficha
    // con ese correo ya lo revela el 409 de arriba (enumeración aceptada a propósito,
    // §9); describir la otra ficha sería contar algo que quien registra no ha probado ser.
    return responder({
      ok: true,
      conveni,
      revisio_equip: decisio.cas === "paper_nou",
      ...(decisio.cas === "paper_nou"
        ? {
          missatge:
            "Ja tenim dades d'aquesta organitzacio. L'equip revisara la sol·licitud abans d'activar l'acces.",
        }
        : {}),
    }, 200);
  } catch (err) {
    // Cualquier cosa no prevista: se intenta dejar la base como estaba, en orden
    // inverso al de creación. Si la compensación también falla queda en el log con
    // todos los ids, que es lo que hace falta para limpiarlo a mano.
    console.error("[registro] error:", err instanceof Error ? err.message : String(err));
    if (supabase && fitxaId) {
      const { error } = await supabase.from(taula).delete().eq("id", fitxaId);
      if (error) console.error("[registro] residuo ficha:", taula, fitxaId, error.message);
    }
    if (supabase) await esborrarOrganitzacio(supabase, organitzacioId);
    if (supabase && userId) await esborrarUsuari(supabase, userId);
    return responder({ error: "Error intern", code: "error_intern" }, 500);
  }
});

/**
 * Compensación: borra la organización recién creada. Nunca lanza, y **solo puede borrar la
 * que acaba de crear esta petición**: si la ficha no llegó a existir, la fila de
 * `organizaciones` no la referencia nadie. No se llama nunca con la organización de una
 * coincidencia, porque en el caso «papel nuevo» esta función no crea ninguna.
 */
async function esborrarOrganitzacio(supabase: Cliente, id: string | null): Promise<void> {
  if (!id) return;
  const { error } = await supabase.from("organizaciones").delete().eq("id", id);
  if (error) console.error("[registro] residuo organizacion:", id, error.message);
}

/** Compensación: borra la cuenta de Auth recién creada. Nunca lanza. */
async function esborrarUsuari(supabase: Cliente, userId: string): Promise<void> {
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error("[registro] NO se pudo compensar el alta de auth:", userId, error.message);
  }
}


// ---------------------------------------------------------------------------
// ¿Esta organización ya existe? (etapa 2 de la brecha 2, deuda §12.28)
// ---------------------------------------------------------------------------
// Lo que se consulta son LAS FICHAS, y después la vista. No al revés, y no es un detalle:
// `v_organizaciones` expone un solo correo y un solo teléfono por organización (el de la
// ficha de productor cuando hay las dos, por el `coalesce`), así que filtrar la vista por
// correo dejaría invisible el correo de la otra ficha — y ese es justo el caso que esto
// viene a cazar. Las fichas dicen QUIÉN casa; `v_organizaciones` dice QUÉ PAPELES tiene ya
// la organización de quien ha casado, que es lo que separa el caso 2 del caso 3.
//
// Cuatro consultas —correo y teléfono, en las dos tablas— en paralelo: son cuatro idas y
// vueltas que cuestan lo que la más lenta, y evitan tener que escapar valores dentro de un
// `or=(…)` de PostgREST. Un correo válido puede llevar comas y paréntesis, que son
// separadores de esa sintaxis; un `ilike` suelto no tiene ese problema.
//
// `limit(5)` en cada una: con más de cinco fichas casando por el mismo correo ya no hay
// ninguna decisión automática que tomar, y la nota se leería sola.
const MAX_COINCIDENCIES = 5;

async function decidirCoincidencia(
  supabase: Cliente,
  d: Dades,
  tipusRol: TipusFitxa,
): Promise<Decisio> {
  const nou9 = ultimes9(d.telefon);
  const patro = nou9 ? patroTelefon(nou9) : null;
  const buit = { data: [] as Record<string, unknown>[] };

  const prod = () =>
    supabase.from("productores").select("id, organizacion_id, name, empresa, email, phone");
  const ent = () =>
    supabase.from("entidades").select("id, organizacion_id, nombre, email, telefono");

  const [pEmail, pTel, eEmail, eTel] = await Promise.all([
    prod().ilike("email", patroLike(d.email)).limit(MAX_COINCIDENCIES),
    patro ? prod().filter("phone", "match", patro).limit(MAX_COINCIDENCIES) : buit,
    ent().ilike("email", patroLike(d.email)).limit(MAX_COINCIDENCIES),
    patro ? ent().filter("telefono", "match", patro).limit(MAX_COINCIDENCIES) : buit,
  ]);

  // Se vuelve a comprobar en memoria lo que devolvió la consulta. El `ilike` con los
  // comodines escapados ya es igualdad, pero el `match` del teléfono es un filtro grueso
  // sobre texto libre: lo que decide es `mateixTelefon`, con las últimas 9 cifras, que es
  // el mismo criterio con el que la migración de la etapa 1 enganchó los cuatro pares.
  const fitxes = new Map<string, FitxaCoincident>();
  const afegir = (
    tipus: TipusFitxa,
    fila: Record<string, unknown>,
    per: MotiuCoincidencia,
  ) => {
    const id = fila.id as string;
    const clau = `${tipus}:${id}`;
    const previa = fitxes.get(clau);
    if (previa) {
      if (!previa.per.includes(per)) previa.per.push(per);
      return;
    }
    const nom = tipus === "productor"
      ? ((fila.empresa as string | null) || (fila.name as string | null))
      : (fila.nombre as string | null);
    fitxes.set(clau, {
      tipus,
      id,
      organitzacio: (fila.organizacion_id as string | null) ?? null,
      nom: nom ?? null,
      per: [per],
    });
  };

  for (const f of (pEmail.data ?? [])) {
    if (mateixEmail(f.email as string, d.email)) afegir("productor", f, "email");
  }
  for (const f of (pTel.data ?? [])) {
    if (mateixTelefon(f.phone as string, d.telefon)) afegir("productor", f, "telefon");
  }
  for (const f of (eEmail.data ?? [])) {
    if (mateixEmail(f.email as string, d.email)) afegir("entidad", f, "email");
  }
  for (const f of (eTel.data ?? [])) {
    if (mateixTelefon(f.telefono as string, d.telefon)) afegir("entidad", f, "telefon");
  }

  const llista = [...fitxes.values()];
  if (llista.length === 0) return decidir(tipusRol, [], []);

  const ids = [...new Set(llista.map((f) => f.organitzacio).filter((x): x is string => !!x))];
  let orgs: OrgCoincident[] = [];
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("v_organizaciones")
      .select("id, nombre, es_generadora, es_receptora")
      .in("id", ids);
    if (error) {
      // Sin la vista no se puede afirmar que el papel esté libre. Fail-safe hacia el lado
      // que NO crea nada nuevo: se trata como duplicado y lo mira una persona. Lo caro
      // aquí no es rechazar un alta legítima —el equipo la recupera— sino dar por nueva
      // una organización que ya está.
      console.error("[registro] v_organizaciones:", error.code, error.message);
      const fitxa = llista[0];
      return { cas: "duplicat", camp: fitxa.per.includes("email") ? "email" : "telefon", fitxa };
    }
    orgs = (data ?? []) as OrgCoincident[];
  }

  return decidir(tipusRol, llista, orgs);
}

// ---------------------------------------------------------------------------
// El convenio dentro del alta (fase 2, §3.2.4 «Dentro del registro»)
// ---------------------------------------------------------------------------
// Dos RPC y ninguna decisión propia:
//   · `preparar_convenio()` compone el borrador con la plantilla vigente del modelo que
//     le toca a la organización —un productor firma `don_gen`; una entidad, `don_rec`—.
//     El de compraventa no se prepara aquí: se prepara cuando la organización opera en
//     venta o maquila, y en el alta todavía no sabemos si lo hará.
//   · `enviar_convenio()` crea el enlace de firma (token de 256 bits, del que en la base
//     solo queda el sha256) y devuelve el token EN CLARO, que es la única vez que existe.
//
// NUNCA LANZA. Lo peor que puede pasar es que el registro responda sin convenio y el
// equipo lo prepare desde la campaña, que es exactamente el camino de las 452 fichas que
// ya existen. Un alta perdida, en cambio, no se recupera.
//
// ⚠️ Aquí NO se manda ningún correo, igual que en el resto de esta función y por el mismo
//    motivo (§8): la organización nace con `es_test = false` y, con el modo test activo,
//    el correo se descartaría en silencio. Si firma quien registra, el token vuelve en la
//    respuesta y la pantalla sigue sola; si firma otra persona, el enlace queda creado y
//    lo envía el equipo.

interface ConveniPreparat {
  id: string;
  tipo: string;
  estado: string;
  /** Solo cuando firma quien registra, y en la misma respuesta HTTP. */
  token: string | null;
  /** A quién apunta el enlace, para poder decirlo en pantalla. */
  destinatari: string | null;
  /** `true` = el enlace existe pero todavía no se ha enviado a nadie. */
  pendent_enviament: boolean;
}

async function prepararConveni(
  supabase: Cliente,
  d: Dades,
  fitxaId: string,
): Promise<ConveniPreparat | null> {
  try {
    const tipoOrg = d.rol === "productor" ? "productor" : "entidad";
    const tipo = d.rol === "productor" ? "don_gen" : "don_rec";

    const { data: conv, error: errPrep } = await supabase.rpc("preparar_convenio", {
      p_tipo_org: tipoOrg,
      p_org: fitxaId,
      p_tipo: tipo,
      p_idioma: null,
      p_roles_com: null,
    });
    if (errPrep || !conv) {
      // El caso esperable es `22023`: todavía no hay plantilla vigente de ese modelo.
      console.warn("[registro] preparar_convenio:", errPrep?.code, errPrep?.message);
      return null;
    }
    const fila = conv as { id: string; tipo: string; estado: string };

    // Quién firma. Sin ninguno de los dos, el borrador se queda como está y el equipo
    // decide a quién se lo manda: es una organización más de la campaña.
    const destinatari = d.firmarAra ? d.email : d.emailSignant;
    if (!destinatari) {
      return {
        id: fila.id,
        tipo: fila.tipo,
        estado: fila.estado,
        token: null,
        destinatari: null,
        pendent_enviament: false,
      };
    }

    const { data: env, error: errEnv } = await supabase.rpc("enviar_convenio", {
      p_id: fila.id,
      p_email: destinatari,
    });
    if (errEnv || !env) {
      console.warn("[registro] enviar_convenio:", errEnv?.code, errEnv?.message);
      return {
        id: fila.id,
        tipo: fila.tipo,
        estado: fila.estado,
        token: null,
        destinatari: null,
        pendent_enviament: false,
      };
    }
    const salida = env as { enllac?: { token?: string; destinatari?: string } };

    return {
      id: fila.id,
      tipo: fila.tipo,
      estado: "pendent_firma",
      // El token SOLO si firma quien está delante. Devolverlo cuando firma otra persona
      // sería poner una credencial al portador en manos de quien no la tiene que usar.
      token: d.firmarAra ? (salida.enllac?.token ?? null) : null,
      destinatari: salida.enllac?.destinatari ?? destinatari,
      pendent_enviament: !d.firmarAra,
    };
  } catch (e) {
    console.warn("[registro] conveni no preparat:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
