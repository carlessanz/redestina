// El ALTA de una organización con su cuenta: el camino que comparten el registro público
// (`registro`) y el alta asistida del equipo (`alta-assistida`). Separado de `index.ts` el
// 27-10-2026 SIN cambiar la lógica: los pasos, su orden y su compensación son los que
// describe la cabecera de `index.ts`. Lo único que distingue los dos caminos es `opcions`:
//   · `registre`        — membresía PENDIENTE: el acceso lo concede el equipo al aprobar;
//   · `alta_assistida`  — membresía APROBADA en el mismo acto, con `aprovat_per`.
// Y en los dos se guardan los consentimientos RGPD (`consentiments`), con la huella del texto
// que el SERVIDOR compone. Nunca lanza: devuelve el estado HTTP y el cuerpo.

import { notaPaperNou, type TipusFitxa } from "./coincidencies.ts";
import type { Cliente } from "./cliente.ts";
import { type Dades, patroLike } from "./validacio.ts";
import { decidirCoincidencia } from "./deteccio.ts";
import { type ConveniPreparat, prepararConveni } from "./conveni.ts";
import { sha256Hex, textConsentiment, TIPUS_CONSENTIMENT, VERSIO_RGPD } from "../_shared/textosRgpd.ts";

export interface OpcionsAlta {
  origen: "registre" | "alta_assistida";
  /** La cuenta del equipo que valida el alta asistida. Obligatoria en ese camino. */
  aprovadaPer?: string | null;
  /** Solo el alta asistida: marcar la organización como de prueba desde el principio. */
  esTest?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RespostaAlta {
  status: number;
  body: Record<string, unknown>;
  /** La cuenta creada, cuando se crea: el alta asistida la necesita para mandar el acceso. */
  userId?: string | null;
}

function resposta(body: Record<string, unknown>, status: number): RespostaAlta {
  return { status, body };
}

export async function executarAlta(supabase: Cliente, d: Dades, opcions: OpcionsAlta): Promise<RespostaAlta> {
  const assistit = opcions.origen === "alta_assistida";
  let userId: string | null = null;
  let organitzacioId: string | null = null;
  // Antes era una ficha y una tabla; con el doble papel son hasta dos, y la compensación
  // tiene que poder deshacer las dos. Se van apilando a medida que se crean.
  const creades: { taula: "productores" | "entidades"; id: string }[] = [];
  const desferFitxes = async () => {
    for (const f of [...creades].reverse()) {  // copia: `reverse()` muta, y el array se sigue usando
      await supabase.from(f.taula).delete().eq("id", f.id);
    }
  };

  try {
    // -----------------------------------------------------------------------
    // Prechecks: fallar aquí es limpio; fallar después obliga a compensar.
    // -----------------------------------------------------------------------
    const { data: perfils } = await supabase
      .from("perfiles").select("id").ilike("email", patroLike(d.email)).limit(1);
    if ((perfils ?? []).length > 0) {
      return resposta(
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
      fn: opcions.origen === "registre" ? "registro" : "alta-assistida",
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
      return resposta(
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
        return resposta(
          { error: "Aquest correu ja te compte. Prova d'iniciar sessio.", code: "email_ja_registrat" },
          409,
        );
      }
      console.error("[registro] createUser:", missatge);
      return resposta({ error: "No s'ha pogut crear el compte", code: "error_intern" }, 500);
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
    // 2bis. Los consentimientos RGPD (27-10-2026). ANTES de las fichas, a propósito: si
    //       fallan, solo hay que deshacer la organización y la cuenta, y no quedan
    //       convenios ni enlaces colgando de una ficha que se borra.
    // -----------------------------------------------------------------------
    const errConsent = await registrarConsentiments(supabase, d, userId, organitzacioId, opcions);
    if (errConsent) {
      await esborrarOrganitzacio(supabase, organitzacioId);
      await esborrarUsuari(supabase, userId);
      console.error("[registro] consentiments:", errConsent);
      return resposta({ error: "No s'ha pogut completar el registre", code: "error_intern" }, 500);
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
        // mientras el modo test esté activo (§8). Lo marca el equipo si toca (en el alta
        // asistida, en el mismo formulario).
        es_test: opcions.esTest === true,
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
        es_test: opcions.esTest === true,
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
        return resposta(
          { error: "Aquestes dades ja consten en una fitxa. Contacta amb l'equip de Redestina.", code: "dades_en_us", camp },
          409,
        );
      }
      // El NIF lo valida y lo hace único por organización un trigger (fase 7 de la revisión
      // del 08-10-2026): sin esto, un NIF mal escrito o de otra organización salía «error intern».
      if (/nif_invalid/.test(errFitxa?.message ?? "")) {
        return resposta({ error: "El NIF no és vàlid. Revisa'l.", code: "nif_invalid", camp: "nif" }, 400);
      }
      if (/nif_en_us/.test(errFitxa?.message ?? "")) {
        return resposta(
          { error: "Aquest NIF ja consta en una altra organització. Contacta amb l'equip de Redestina.", code: "dades_en_us", camp: "nif" },
          409,
        );
      }
      console.error("[registro] insert ficha:", taula, errFitxa?.message);
      return resposta({ error: "No s'ha pogut crear la fitxa", code: "error_intern" }, 500);
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
      // En el alta asistida la valida el equipo en el mismo acto: nace aprobada.
      ...(assistit
        ? { activo: true, aprovacio: "aprovada", aprovat_at: new Date().toISOString(), aprovat_per: opcions.aprovadaPer }
        : { activo: false, aprovacio: "pendent" }),
    });

    if (errMembresia) {
      await desferFitxes();
      await esborrarOrganitzacio(supabase, organitzacioId);
      await esborrarUsuari(supabase, userId);
      console.error("[registro] insert membresia:", errMembresia.message);
      return resposta({ error: "No s'ha pogut completar el registre", code: "error_intern" }, 500);
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
    return { userId, ...resposta({
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
    }, 200) };
  } catch (err) {
    // Cualquier cosa no prevista: se intenta dejar la base como estaba, en orden
    // inverso al de creación. Si la compensación también falla queda en el log con
    // todos los ids, que es lo que hace falta para limpiarlo a mano.
    console.error("[registro] error:", err instanceof Error ? err.message : String(err));
    for (const f of [...creades].reverse()) {
      const { error } = await supabase.from(f.taula).delete().eq("id", f.id);
      if (error) console.error("[registro] residuo ficha:", f.taula, f.id, error.message);
    }
    await esborrarOrganitzacio(supabase, organitzacioId);
    if (userId) await esborrarUsuari(supabase, userId);
    return resposta({ error: "Error intern", code: "error_intern" }, 500);
  }
}


/**
 * Las tres filas de `consentiments`. El texto lo compone el servidor y la huella es la de
 * ese texto. Devuelve el mensaje de error, o null si se guardaron.
 */
async function registrarConsentiments(
  supabase: Cliente,
  d: Dades,
  userId: string,
  organitzacioId: string | null,
  opcions: OpcionsAlta,
): Promise<string | null> {
  const assistit = opcions.origen === "alta_assistida";
  const valors: Record<string, boolean> = {
    privacitat: d.acceptaPrivacitat,
    comunicacions_plataforma: d.comunicacionsPlataforma,
    comunicacions_espigoladors: d.comunicacionsEspigoladors,
  };
  const files = [];
  for (const tipus of TIPUS_CONSENTIMENT) {
    const text = textConsentiment(tipus, d.idioma, assistit);
    files.push({
      user_id: userId,
      organizacion_id: organitzacioId,
      tipus,
      valor: valors[tipus],
      versio_text: VERSIO_RGPD,
      sha256_text: await sha256Hex(text),
      idioma: d.idioma,
      origen: opcions.origen,
      registrat_per: assistit ? (opcions.aprovadaPer ?? null) : null,
      ip: opcions.ip || null,
      user_agent: (opcions.userAgent ?? "").slice(0, 400) || null,
    });
  }
  const { error } = await supabase.from("consentiments").insert(files);
  return error ? `${error.code}: ${error.message}` : null;
}

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
