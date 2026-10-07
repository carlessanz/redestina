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

// ⚠️ DESDE EL 07-10-2026 EL ALTA ESTÁ REPARTIDA, sin un cambio de lógica:
//      · `validacio.ts`     — qué se acepta del cuerpo (`validar`)
//      · `deteccio.ts`      — las consultas que deciden si la organización ya existe
//      · `coincidencies.ts` — la regla de esa decisión, pura y con pruebas
//      · `conveni.ts`       — el convenio que se prepara dentro del alta
//    Aquí quedan el anti-abuso, el orden de los pasos y su compensación.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { notaPaperNou, type TipusFitxa } from "./coincidencies.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import type { Cliente } from "./cliente.ts";
import { patroLike, textNet, validar } from "./validacio.ts";
import { decidirCoincidencia } from "./deteccio.ts";
import { type ConveniPreparat, prepararConveni } from "./conveni.ts";

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
Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
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
