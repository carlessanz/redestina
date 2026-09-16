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
  motiuEmail,
  type MotiuCoincidencia,
  motiuTelefon,
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
  /**
   * Los papeles que estrena esta organización. **Puede ser más de uno**: hasta el
   * 16-09-2026 el registro obligaba a elegir productor O receptora, y quien era las dos
   * cosas —que es el caso normal de media docena de organizaciones reales— tenía que
   * registrarse dos veces, con dos correos, y acababa con dos organizaciones distintas
   * que el equipo luego tenía que fusionar a mano con `enllacar_organitzacio()`. Ahora
   * las dos fichas nacen **bajo la misma `organizaciones`**, que es exactamente lo que
   * el índice único parcial de esa tabla permite: una ficha de cada tipo, no más.
   */
  rols: Rol[];
  nomOrganitzacio: string;
  nomPersona: string;
  email: string;
  password: string;
  /** Obligatorio desde el 16-09-2026: sin teléfono, WhatsApp no alcanza a la organización. */
  telefon: string;
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
  // `rols` es lo nuevo; `rol` se sigue aceptando porque el contrato es público y una
  // pantalla vieja servida desde una caché no tiene por qué romperse en el alta.
  const brut = Array.isArray(body.rols)
    ? body.rols
    : (textNet(body.rol) ? [body.rol] : []);
  const rols = [...new Set(brut.map((r) => textNet(r)))] as Rol[];
  if (rols.length === 0 || rols.some((r) => !ROLS.includes(r))) {
    return { ok: false, camp: "rol", error: "Cal triar si ets productor, receptor o totes dues coses" };
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

  // 🔴 EL TELÉFONO ES OBLIGATORIO desde el 16-09-2026. Era opcional, y eso dejaba entrar
  // organizaciones a las que **el canal principal del producto no puede alcanzar**: sin
  // móvil no hay intake, ni recordatorio, ni oferta por WhatsApp, y la ficha nace muda sin
  // que nada lo diga. Pedido por el cliente: «quitar opcional del registro, porque si no el
  // WhatsApp no va a funcionar».
  //
  // ⚠️ Se exige TENERLO, no que sea un móvil: `esMovil()` descarta los fijos españoles
  //    (§8bis), pero fuera de España el prefijo no lo dice, y rechazar aquí un número
  //    extranjero legítimo sería peor que aceptarlo y que lo decida la política de canal.
  const telBrut = textNet(body.telefon);
  const telNet = telBrut.replace(/\D/g, "");
  if (!telNet) {
    return { ok: false, camp: "telefon", error: "Cal un telefon de contacte" };
  }
  if (!/^[1-9]\d{6,14}$/.test(telNet)) {
    return { ok: false, camp: "telefon", error: "El telefon no es valid" };
  }
  const telefon: string = telNet;

  // La POBLACIÓN ya no se pide en el alta (16-09-2026): se rellena después, desde la ficha,
  // donde se elige de la lista real de municipios junto con el domicilio y el código postal.
  // Preguntarla en la puerta obligaba a teclearla a mano y sin validar, y luego había que
  // corregirla igualmente. **Se sigue ACEPTANDO** por si llega de una pantalla vieja servida
  // desde una caché: el contrato es público.
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
  if (rols.includes("receptor")) {
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
      rols, nomOrganitzacio, nomPersona, email, password, telefon, poblacio, tipoReceptor,
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
  let organitzacioId: string | null = null;
  // Antes era una ficha y una tabla; con el doble papel son hasta dos, y la compensación
  // tiene que poder deshacer las dos. Se van apilando a medida que se crean.
  const creades: { taula: "productores" | "entidades"; id: string }[] = [];
  const desferFitxes = async () => {
    for (const f of [...creades].reverse()) {  // copia: `reverse()` muta, y el array se sigue usando
      await supabase!.from(f.taula).delete().eq("id", f.id);
    }
  };

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
    // ⚠️ SE DECIDE UNA VEZ POR PAPEL, no una vez por alta, y el resultado se combina con
    //    la regla más estricta: si CUALQUIERA de los dos papeles ya está cubierto, el alta
    //    entera se deniega. No se puede partir —«te doy la ficha de productor y la de
    //    entidad no»— porque la persona ha pedido las dos y quedarse a medias sin decirlo
    //    sería peor que rechazar: acabaría con media organización y sin saber por qué.
    const tipusRols: TipusFitxa[] = d.rols.map((r) => r === "productor" ? "productor" : "entidad");
    const t0 = performance.now();
    const decisions = [];
    for (const tr of tipusRols) decisions.push(await decidirCoincidencia(supabase, d, tr));
    const decisio = decisions.find((x) => x.cas === "duplicat")
      ?? decisions.find((x) => x.cas === "paper_nou")
      ?? decisions[0];
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
      // Y por qué casaron, que es lo que separa un 409 de una revisión del equipo: sin
      // esto, un `paper_nou` que en realidad viene de una centralita compartida no se
      // distingue de uno que viene del correo. Son etiquetas, no datos de nadie.
      motius: decisio.cas === "paper_nou"
        ? [...new Set(decisio.fitxes.flatMap((f) => f.per))]
        : decisio.cas === "duplicat"
        ? decisio.fitxa.per
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
    // 2. La organización, SIEMPRE — también en el caso «papel nuevo».
    //
    //    ⚠️ Esto antes era `if (decisio.cas === "alta")`, con la idea de que una ficha que
    //    parece el papel nuevo de una organización que ya consta naciera SIN organización,
    //    para no fabricar una segunda identidad de la misma. **Esa idea ya no se puede
    //    cumplir**: desde `20270313100000` la columna es `not null` y el trigger
    //    `*_estrena_organizacion` le pone una en el BEFORE INSERT. O sea que la identidad
    //    provisional se crea igual; lo único que cambiaba era que la creaba el trigger, sin
    //    `creada_por` y sin que la compensación de más abajo supiera de ella — si fallaba la
    //    membresía, la ficha se borraba y esa organización quedaba huérfana.
    //
    //    Crearla aquí siempre no cambia el modelo: la ficha sigue teniendo identidad propia
    //    hasta que alguien la enlace, y el equipo lo hace con `enllacar_organitzacio()`
    //    desde Aprovacions, que fusiona las dos (§12.28). Lo que marca el caso es la nota.
    //    Nunca corta el alta: si falla, la ficha nace con la del trigger.
    // -----------------------------------------------------------------------
    {
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

    // Los convenios que se llegan a preparar, uno por papel. Se acumulan aquí porque el
    // bucle de abajo crea ficha, membresía y convenio de cada uno en la misma vuelta.
    const convenis: ConveniPreparat[] = [];

    for (const rol of d.rols) {
    const taula: "productores" | "entidades" = rol === "productor" ? "productores" : "entidades";
    const fila: Record<string, unknown> = rol === "productor"
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
      await desferFitxes();
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
    const fitxaId = fitxa.id as string;
    creades.push({ taula, id: fitxaId });

    // -----------------------------------------------------------------------
    // 4. Membresía PENDIENTE. Es la pieza que da (o no da) acceso.
    // -----------------------------------------------------------------------
    const { error: errMembresia } = await supabase.from("membresias").insert({
      user_id: userId,
      tipo: rol === "productor" ? "productor" : "entidad",
      productor_id: rol === "productor" ? fitxaId : null,
      entidad_id: rol === "receptor" ? fitxaId : null,
      // Quien registra la organización es su titular: es quien podrá editar la ficha
      // (soc_titular) cuando el equipo apruebe.
      rol_org: "titular",
      activo: false,
      aprovacio: "pendent",
    });

    if (errMembresia) {
      await desferFitxes();
      await esborrarOrganitzacio(supabase, organitzacioId);
      await esborrarUsuari(supabase, userId);
      console.error("[registro] insert membresia:", errMembresia.message);
      return responder({ error: "No s'ha pogut completar el registre", code: "error_intern" }, 500);
    }

    // Un convenio por papel: el generador firma `don_gen` y la receptora `don_rec`, que
    // es lo que dice `convenios_exigidos`. Fuera del camino de compensación, como antes.
    const c = await prepararConveni(supabase, d, rol, fitxaId);
    if (c) convenis.push(c);
    }

    // -----------------------------------------------------------------------
    // 5. El convenio en borrador y su enlace de firma (§3.2.4). Fuera del camino
    //    de compensación: si falla, el alta sigue siendo válida (ver cabecera).
    // -----------------------------------------------------------------------

    // `revisio_equip` solo dice que el alta necesita una mirada antes de activarse; NO
    // dice con qué organización ha coincidido ni qué papeles tiene. Que exista una ficha
    // con ese correo ya lo revela el 409 de arriba (enumeración aceptada a propósito,
    // §9); describir la otra ficha sería contar algo que quien registra no ha probado ser.
    return responder({
      ok: true,
      // `conveni` en singular se mantiene para quien ya lo leía; `convenis` es el que
      // dice la verdad cuando la organización estrena los dos papeles.
      conveni: convenis[0] ?? null,
      convenis,
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
    if (supabase) {
      for (const f of [...creades].reverse()) {
        const { error } = await supabase.from(f.taula).delete().eq("id", f.id);
        if (error) console.error("[registro] residuo ficha:", f.taula, f.id, error.message);
      }
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
// Una consulta por campo —el correo y CADA columna de teléfono, en las dos tablas—, todas
// en paralelo: son idas y vueltas que cuestan lo que la más lenta, y evitan tener que
// escapar valores dentro de un `or=(…)` de PostgREST. Un correo válido puede llevar comas
// y paréntesis, que son separadores de esa sintaxis; un `ilike` suelto no tiene ese
// problema. Un registro es una operación rara: no hay nada que ahorrar aquí.
//
// `limit(5)` en cada una: con más de cinco fichas casando por el mismo correo ya no hay
// ninguna decisión automática que tomar, y la nota se leería sola.
const MAX_COINCIDENCIES = 5;

// Y no hay UNA columna de teléfono por ficha, sino varias (deuda §12.91): la de entidades
// las trae del Excel SDA (`telefono2`, `telefono3` son el contacto de otra persona de la
// misma organización) y la de productores tiene `telefono_alt`, que es DONDE EL IMPORTADOR
// DEJÓ los números extra cuando venían tres en la misma celda (§6). Mirar solo la primera
// dejaba fuera precisamente los casos que el import apartó por venir mal.
//
// ⚠️ PERO LAS SECUNDARIAS NO VALEN LO MISMO, y mezclarlas habría salido caro. Una
// coincidencia en la columna principal deniega el alta (409 `dades_en_us`); una en una
// secundaria, jamás — como mucho manda la ficha a revisión del equipo. Medido contra
// producción antes de decidirlo: dentro de productores hay 2 números compartidos por dos
// fichas distintas y dentro de entidades 1 (`Càritas l'Aldea` y `Càritas Roquetes`), así
// que sin esta distinción cualquiera de esas organizaciones se habría quedado **sin poder
// registrarse**, con un 409 y un «contacta amb l'equip» por toda salida. Un fallo de la
// detección tiene que producir un duplicado que el equipo ve; nunca un alta denegada, y
// nunca una fusión. Lo impone `esForta()`, en `coincidencies.ts`.
const TEL_PRINCIPAL_PRODUCTOR = "phone";
const TEL_PRINCIPAL_ENTITAT = "telefono";
const TEL_SECUNDARIS_PRODUCTOR = ["telefono_alt"] as const;
const TEL_SECUNDARIS_ENTITAT = ["telefono2", "telefono3"] as const;
const CAMPS_TEL_PRODUCTOR = [TEL_PRINCIPAL_PRODUCTOR, ...TEL_SECUNDARIS_PRODUCTOR];
const CAMPS_TEL_ENTITAT = [TEL_PRINCIPAL_ENTITAT, ...TEL_SECUNDARIS_ENTITAT];

// Y con el CORREO pasa lo mismo desde el 15-09-2026 (deuda §12.102): `entidades.email2` era
// la última columna ciega. Se mira igual que las de teléfono y **con la misma regla**: una
// coincidencia ahí no puede denegar, porque ese campo guarda el correo de otra persona de la
// casa. `productores` no tiene ninguna secundaria —su `email` es UNIQUE—, así que la lista
// vacía no es un hueco por rellenar: es que no hay dónde mirar.
const EMAIL_PRINCIPAL = "email";
const EMAIL_SECUNDARIS_PRODUCTOR = [] as const;
const EMAIL_SECUNDARIS_ENTITAT = ["email2"] as const;

/**
 * Las filas que el prefiltro de teléfono trae de una tabla, buscando por cada una de sus
 * columnas y quitando las repetidas. Una consulta por columna, todas en paralelo: es lo
 * mismo que se hace con el correo y por el mismo motivo —un `or=(…)` de PostgREST habría
 * que escaparlo, y aquí el coste de una ida y vuelta más es el de la más lenta—.
 *
 * Un error NO aborta el alta: se registra y se sigue con lo que hayan traído las demás.
 * Quedarse sin ver una coincidencia produce un duplicado que el equipo resuelve; negar el
 * registro produce una persona que no puede darse de alta.
 */
async function filesPerColumnes(
  consulta: () => Cliente,
  camps: readonly string[],
  filtra: ((q: Cliente, camp: string) => Cliente) | null,
): Promise<Record<string, unknown>[]> {
  if (!filtra || camps.length === 0) return [];
  const resultats = await Promise.all(
    camps.map((c) => filtra(consulta(), c).limit(MAX_COINCIDENCIES)),
  );
  const files = new Map<string, Record<string, unknown>>();
  for (const [i, r] of resultats.entries()) {
    if (r.error) {
      console.error("[registro] coincidencies:", camps[i], r.error.code, r.error.message);
      continue;
    }
    for (const f of (r.data ?? []) as Record<string, unknown>[]) files.set(f.id as string, f);
  }
  return [...files.values()];
}

async function decidirCoincidencia(
  supabase: Cliente,
  d: Dades,
  tipusRol: TipusFitxa,
): Promise<Decisio> {
  const nou9 = ultimes9(d.telefon);
  const patro = nou9 ? patroTelefon(nou9) : null;

  const prod = () =>
    supabase.from("productores").select("id, organizacion_id, name, empresa, email, phone, telefono_alt");
  const ent = () =>
    supabase.from("entidades").select("id, organizacion_id, nombre, email, email2, telefono, telefono2, telefono3");

  // Cada columna, su consulta. Un `or=(…)` de PostgREST habría que escaparlo, y aquí el
  // coste de una ida y vuelta más es el de la más lenta: van todas en paralelo.
  const perTel = patro ? (q: Cliente, c: string) => q.filter(c, "match", patro) : null;
  const perEmail = (q: Cliente, c: string) => q.ilike(c, patroLike(d.email));

  const [pEmail, eEmail, eEmail2, pTel, eTel] = await Promise.all([
    prod().ilike(EMAIL_PRINCIPAL, patroLike(d.email)).limit(MAX_COINCIDENCIES),
    ent().ilike(EMAIL_PRINCIPAL, patroLike(d.email)).limit(MAX_COINCIDENCIES),
    filesPerColumnes(ent, EMAIL_SECUNDARIS_ENTITAT, perEmail),
    filesPerColumnes(prod, CAMPS_TEL_PRODUCTOR, perTel),
    filesPerColumnes(ent, CAMPS_TEL_ENTITAT, perTel),
  ]);

  // Se vuelve a comprobar en memoria lo que devolvió la consulta. El `ilike` con los
  // comodines escapados ya es igualdad, pero el `match` del teléfono es un filtro grueso
  // sobre texto libre —y desde que dejó de ir anclado al final del campo, más grueso
  // todavía—: lo que decide es `algunTelefonCoincideix`, con claves de 9 cifras, que es el
  // mismo criterio con el que la migración de la etapa 1 enganchó los cuatro pares. Sin
  // esta segunda vuelta, el prefiltro daría por la misma organización a dos que no lo son.
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

  // ⚠️ El teléfono se mira en TODAS las columnas de la fila, no solo en aquella por la que
  // la consulta la encontró: una ficha puede casar por `telefono3` y tener el mismo número
  // en `telefono`, y entonces la coincidencia es fuerte. `motiuTelefon` se queda con la más
  // fuerte de las dos, que es la única forma de que la columna por la que llegó la fila no
  // cambie la decisión.
  const tel = (f: Record<string, unknown>, principal: string, secundaris: readonly string[]) =>
    motiuTelefon(
      f[principal] as string | null,
      secundaris.map((c) => f[c] as string | null),
      d.telefon,
    );
  // El correo se mira en TODAS las columnas de la fila, no solo en aquella por la que la
  // consulta la encontró — mismo argumento que el teléfono de aquí al lado.
  const mail = (f: Record<string, unknown>, secundaris: readonly string[]) =>
    motiuEmail(
      f[EMAIL_PRINCIPAL] as string | null,
      secundaris.map((c) => f[c] as string | null),
      d.email,
    );

  for (const f of ((pEmail.data ?? []) as Record<string, unknown>[])) {
    const motiu = mail(f, EMAIL_SECUNDARIS_PRODUCTOR);
    if (motiu) afegir("productor", f, motiu);
  }
  for (const f of pTel) {
    const motiu = tel(f, TEL_PRINCIPAL_PRODUCTOR, TEL_SECUNDARIS_PRODUCTOR);
    if (motiu) afegir("productor", f, motiu);
  }
  for (const f of [...((eEmail.data ?? []) as Record<string, unknown>[]), ...eEmail2]) {
    const motiu = mail(f, EMAIL_SECUNDARIS_ENTITAT);
    if (motiu) afegir("entidad", f, motiu);
  }
  for (const f of eTel) {
    const motiu = tel(f, TEL_PRINCIPAL_ENTITAT, TEL_SECUNDARIS_ENTITAT);
    if (motiu) afegir("entidad", f, motiu);
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
  rol: Rol,
  fitxaId: string,
): Promise<ConveniPreparat | null> {
  try {
    const tipoOrg = rol === "productor" ? "productor" : "entidad";
    const tipo = rol === "productor" ? "don_gen" : "don_rec";

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
