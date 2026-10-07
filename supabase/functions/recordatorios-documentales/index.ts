// Recordatorios del circuito documental: enlaces que nadie ha usado (§B del plan).
//
//   POST /recordatorios-documentales  {}   cabecera: x-documentos-secret
//
// La llama pg_cron una vez al día a las 7:00 UTC vía pg_net
// (`disparar_recordatorios_documentales()`, 20260928100700). Por eso va con
// `verify_jwt = false` y un secreto compartido en cabecera, igual que
// `generar-documento` y que el precedente del proyecto, `intake-recordatorios` (§5).
//
// La base no decide nada aquí: solo despierta a la función. A los cuántos días toca
// recordar (7 y 14), quién puede recibir correo y qué se manda se decide en este
// fichero, porque ponerlo en SQL lo duplicaría y lo dejaría fuera del gate de envío.
//
// ───────────────────────────────────────────────────────────────────────────────
// EL PROBLEMA DEL TOKEN, Y POR QUÉ ESTE CORREO VA AL EQUIPO Y NO AL DESTINATARIO
// ───────────────────────────────────────────────────────────────────────────────
// El plan dice que «los recordatorios reenvían el MISMO token». Es la intención
// correcta —regenerarlo invalidaría el enlace que la persona quizá ya tiene abierto
// en el móvil—, pero **desde aquí no se puede hacer**: de `enlaces_token` solo existe
// `token_hash` (sha256 de 32 bytes aleatorios); el token en claro vive únicamente en
// el correo original (20260928100300). Un hash no se invierte, así que esta función
// no puede reconstruir ninguna URL.
//
// Las tres salidas posibles, y por qué se elige la tercera:
//
//   1. Emitir un token nuevo y mandarlo. Prohibido: revocar + crear es una acción
//      deliberada del equipo, y hacerlo en un job rompería en silencio el enlace que
//      la persona tiene en la bandeja, justo a quien todavía no ha respondido.
//   2. Escribir al destinatario un correo sin enlace («tens una firma pendent»). Es
//      un correo que no se puede accionar: obliga a rebuscar el original y, si lo ha
//      perdido, lo deja en un callejón. Un recordatorio que no lleva a ninguna parte
//      es peor que ningún recordatorio.
//   3. **Avisar al equipo** (`parametros_documentales.email_equipo`) de qué enlaces
//      llevan 7 o 14 días sin usarse, para que reenvíen desde el panel —que sí puede
//      revocar y emitir uno nuevo— o llamen. Es el modelo asistido del funcional
//      (§1bis) aplicado al recordatorio: decide una persona, no un cron.
//
// Y como el aviso lo tiene que resolver una persona, el correo la lleva HASTA EL SITIO:
// cada fila enlaza con la pantalla donde se revoca y se reenvía —`/equip/convenis/<id>`,
// que llama a `enviar_convenio()` (emite uno nuevo y revoca el anterior), o
// `/equip/albarans/<id>`, que llama a `marcar_entregado()`— y se identifica por el
// NÚMERO del documento, no por un trozo de uuid. Eso es lo que separa un aviso de un
// aviso accionable (deudas §12.57 y §12.74).
//
// Mejora sobre «un correo por enlace»: se manda **un solo resumen por ejecución**,
// con todos los enlaces vencidos en una tabla. El cron es diario, así que un correo
// al día con la lista se lee; N correos sueltos se archivan sin mirar. Además, un
// único `sendEmail` hace que el «se ha avisado» sea uno o ninguno, nunca a medias:
// los contadores solo se suben si ese correo salió.
//
// ⚠️ Los contadores (`recordatorios`, `ultimo_recordatorio_at`) NO se tocan si el
//    correo no se ha podido mandar. Subirlos igualmente consumiría el hito de 7 días
//    sin que nadie se haya enterado de nada, y ese enlace ya solo tendría una
//    oportunidad más.
//
// SEGUNDO BLOQUE (fase 4): las **facturas pendientes** del cierre anual. Mismos hitos
// de 7 y 14 días, pero sobre `cierres_donante.recordatorios` y con **destinatario
// distinto**: aquí sí se le escribe al donante, porque lo que se le pide no es que use
// un enlace que no podemos reenviar, sino que nos haga llegar su factura —y eso lo
// puede hacer desde su panel o pidiendo un enlace nuevo—. A los 14 días se marca
// `requiere_llamada`, que es el filtro de la bandeja del equipo (decisión D del plan:
// no hay módulo de tareas y no se crea uno).
//
// ⚠️ Los enlaces con propósito `subida_factura` quedan FUERA del primer bloque
//    (`.neq('proposito', …)`): los lleva este segundo con su propio contador. Sin esa
//    exclusión, el mismo enlace consumiría dos contadores distintos y el equipo
//    recibiría dos avisos de lo mismo la misma mañana.

// ⚠️ DESDE EL 07-10-2026 la lógica de cada bloque vive en su módulo, sin cambios:
//      · `enllacos.ts` — enlaces sin usar a 7 y 14 días: `tocaAviso`, identificar, resumen
//      · `factures.ts` — facturas pendientes del cierre anual
//    Aquí queda el orden de la ejecución: secreto, consultas, gates, envío y contadores.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { esEmailTest, modoTestActivo } from "../_shared/gate.ts";
import { plantillaEmail, sendEmail } from "../_shared/resend.ts";
import { exigirSecreto, json } from "../_shared/http.ts";
import {
  APP_URL,
  cuerpoResumen,
  DIA_MS,
  type FilaEnlace,
  HITOS_DIAS,
  identificar,
  LIMITE_CONSULTA,
  MAX_POR_EJECUCION,
  type Motivo,
  RECORDA_FACTURES,
  tocaAviso,
  type Vencido,
} from "./enllacos.ts";
import { cuerpoFactura, cuerpoFacturas, eur, type FacturaPendiente, facturasPendientes } from "./factures.ts";

Deno.serve(async (req) => {
  const t0 = performance.now();
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  // Secreto compartido: lo guarda `app_config.documentos_secret` (lo lee el job) y el
  // secret DOCUMENTOS_SECRET (lo valida esto). Quien invoca es la base, no una persona.
  const rechazo = exigirSecreto(req, "x-documentos-secret", Deno.env.get("DOCUMENTOS_SECRET"));
  if (rechazo) return rechazo;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const ahoraMs = Date.now();
  const ahoraIso = new Date(ahoraMs).toISOString();
  const hastaIso = new Date(ahoraMs - HITOS_DIAS[0] * DIA_MS).toISOString();

  const motivos: Record<string, number> = {};
  const salta = (m: Motivo) => {
    motivos[m] = (motivos[m] ?? 0) + 1;
  };

  // ⚠️ Se filtra por FECHA, no por estado: un enlace vencido sigue con
  // `estado = 'activo'` y `caduca_at` en el pasado (la caducidad se calcula, no se
  // guarda; 20260928100300). Sin el `gt('caduca_at')` se recordarían enlaces muertos.
  //
  // Estas cuatro condiciones son las del índice parcial `enlaces_token_vius_idx`.
  // La lista de columnas va en UN literal (§7, deuda 46) y nunca es `*`: `token_hash`
  // y `codigo_hash` están fuera del GRANT, y aquí tampoco hacen ninguna falta.
  const { data, error } = await supabase
    .from("enlaces_token")
    .select(
      "id, proposito, objeto_tipo, objeto_id, destinatario_email, destinatario_nombre, canal, caduca_at, recordatorios, ultimo_recordatorio_at, created_at",
    )
    .eq("estado", "activo")
    .is("usado_at", null)
    // Los de factura los lleva el segundo bloque, con su propio contador (ver cabecera).
    .neq("proposito", "subida_factura")
    .gt("caduca_at", ahoraIso)
    .lt("recordatorios", HITOS_DIAS.length)
    .lt("created_at", hastaIso)
    .order("created_at", { ascending: true })
    .limit(LIMITE_CONSULTA);

  if (error) {
    console.error("recordatorios-documentales: select enlaces_token:", error.message);
    return json({ error: "Error consultando los enlaces", code: "error_bd" }, 500);
  }

  const candidatos = (data ?? []) as FilaEnlace[];

  // El buzón del equipo. Puede ser NULL: los datos de la Fundación son provisionales
  // (20260928100400) y ninguna migración pone en git el correo de una persona real.
  // No es motivo para fallar: se registra, se cuenta y se sigue.
  const { data: params, error: errParams } = await supabase
    .from("parametros_documentales")
    .select("email_equipo")
    .eq("id", 1)
    .maybeSingle();
  if (errParams) console.error("recordatorios-documentales: parametros:", errParams.message);
  const emailEquipo = (params?.email_equipo ?? "").trim();

  // Modo test global (§8). Fail-safe: si no se puede leer, se comporta como activo.
  const modoTest = await modoTestActivo(supabase);

  // El gate se evalúa por destinatario, no por enlace: dos enlaces del mismo correo
  // no son dos consultas.
  const cacheGate = new Map<string, boolean>();
  async function pasaGate(email: string): Promise<boolean> {
    const clave = email.toLowerCase();
    const visto = cacheGate.get(clave);
    if (visto !== undefined) return visto;
    const ok = await esEmailTest(supabase, email);
    cacheGate.set(clave, ok);
    return ok;
  }

  const vencidos: Vencido[] = [];
  let limitados = 0;
  for (const fila of candidatos) {
    const r = tocaAviso(fila, ahoraMs);
    if (!r.toca) {
      salta(r.motivo);
      continue;
    }
    if (vencidos.length >= MAX_POR_EJECUCION) {
      limitados++;
      salta("limit_execucio");
      continue;
    }
    // Gate de test (§8). Este correo va al equipo, no al destinatario, pero lo que
    // desencadena es que alguien reenvíe un enlace a esa persona: con el modo test
    // activo, un enlace de una organización que no es `es_test` no se remueve. Y si
    // no hay correo con el que comprobarlo (canal 'asistido'), tampoco: la duda,
    // como en todo el gate, corta.
    if (modoTest) {
      if (!fila.destinatario_email) {
        salta("sense_destinatari");
        continue;
      }
      if (!(await pasaGate(fila.destinatario_email))) {
        salta("no_test_user");
        continue;
      }
    }
    vencidos.push({ fila, hito: r.hito, dias: r.dias });
  }

  // ---------------------------------------------------------------------------
  // SEGUNDO BLOQUE — facturas pendientes del cierre anual (fase 4)
  // ---------------------------------------------------------------------------
  // Se calcula ANTES de mandar nada: el correo del equipo tiene que ser uno solo, con
  // las dos listas dentro, y para eso hay que tener las dos antes de escribirlo.
  // 🔴 APAGADO desde el 28-09-2026. La factura ya no condiciona el certificado (21-09-2026),
  //    el panel del productor dejó de ofrecer su subida (27-09-2026) y el resumen anual NO
  //    se le envía a nadie por correo (deuda §12.129): este aviso reclamaba la factura de un
  //    resumen que el donante nunca había recibido y le mandaba a subirla a un sitio donde
  //    ya no se puede. Se deja el código, no la llamada: volver a encenderlo es decidir
  //    antes qué pasa con la factura (deuda §12.127).
  const facturas = RECORDA_FACTURES
    ? await facturasPendientes(supabase, ahoraMs, modoTest, salta)
    : { pendientes: [] as FacturaPendiente[], revisadas: 0, limitadas: 0 };

  // El tope de la ejecución sale como CAMPO PROPIO, no enterrado en `motivos` (deuda
  // §12.58). `limit_execucio` seguía ahí, pero en un diccionario de motivos junto a otros
  // nueve: quien lee la respuesta —o el log— no tenía forma de ver de un vistazo que la
  // lista venía recortada, y una lista recortada que no lo dice se lee como completa.
  const limit = {
    tope: MAX_POR_EJECUCION,
    enllacos: limitados,
    factures: facturas.limitadas,
    retallat: limitados + facturas.limitadas > 0,
  };

  const resumen = (ok: boolean, avisados: number, avisadasFacturas = 0) => {
    const saltados = candidatos.length - avisados;
    console.log(JSON.stringify({
      fn: "recordatorios-documentales",
      ok,
      revisados: candidatos.length,
      avisados,
      saltados,
      factures_revisades: facturas.revisadas,
      factures_avisades: avisadasFacturas,
      limit,
      motivos,
      modo_test: modoTest,
      ms_total: Number((performance.now() - t0).toFixed(1)),
    }));
    if (limit.retallat) {
      console.warn(JSON.stringify({
        fn: "recordatorios-documentales",
        avis: "limit_execucio",
        ...limit,
      }));
    }
    return json({
      ok,
      revisados: candidatos.length,
      avisados,
      saltados,
      factures: { revisades: facturas.revisadas, avisades: avisadasFacturas },
      limit,
      motivos,
    }, 200);
  };

  if (vencidos.length === 0 && facturas.pendientes.length === 0) return resumen(true, 0);

  // ------------------------------------------------- avisos a cada donante
  // Van uno a uno y ANTES del resumen del equipo: cada uno es un correo distinto a una
  // persona distinta, y su contador solo se mueve si el suyo salió.
  let avisadasFacturas = 0;
  for (const f of facturas.pendientes) {
    const envioDonante = await sendEmail({
      to: f.email,
      subject: `Redestina · falta la teva factura del resum ${f.numero ?? ""}`.trim(),
      html: plantillaEmail({
        titulo: "Ens falta la teva factura",
        preheader: `${f.numero ?? "El resum anual"} · ${eur(f.importe)} · fa ${f.dias} dies.`,
        cuerpoHtml: cuerpoFactura(f),
        // Al sitio donde se sube, no a la portada (deuda §12.74). El token de subida no
        // se puede reenviar —de `enlaces_token` solo se guarda el hash— pero el panel
        // del donante sí tiene el formulario, y resuelve `puc_pujar_document_extern()`
        // por su cuenta. Sin sesión aterriza en el login, que sigue siendo el camino.
        boton: { texto: "Puja la factura", url: `${APP_URL}/productor/documents` },
        nota: f.hito >= HITOS_DIAS[HITOS_DIAS.length - 1]
          ? "Aquest és el segon i darrer avís automàtic. A partir d'ara et trucarà algú de l'equip."
          : "Si ja ens l'has enviada, no cal que facis res: aquest avís s'atura tot sol quan la registrem.",
      }),
    }, {
      supabase,
      proposito: "recordatori_factura",
      objetoTipo: "cierre_donante",
      objetoId: f.cd.id,
      funcion: "recordatorios-documentales",
    });
    if (!envioDonante.ok) {
      console.error(
        "recordatorios-documentales: factura no avisada:",
        f.numero,
        envioDonante.status,
        JSON.stringify(envioDonante.data),
      );
      salta("error_email");
      continue;
    }

    // Contador y —al segundo aviso— la bandera de llamada. `.eq('recordatorios', previo)`
    // por el mismo motivo que en los enlaces: si algo movió la fila por debajo, no se pisa.
    const previo = f.cd.recordatorios;
    const { data: tocada, error: errCd } = await supabase
      .from("cierres_donante")
      .update({
        recordatorios: previo + 1,
        ultimo_recordatorio_at: ahoraIso,
        // A los 14 días deja de ser un correo y pasa a ser una llamada (decisión D).
        requiere_llamada: previo + 1 >= HITOS_DIAS.length ? true : f.cd.requiere_llamada,
      })
      .eq("id", f.cd.id)
      .eq("recordatorios", previo)
      .select("id");
    if (errCd) {
      console.error("recordatorios-documentales: update cierres_donante:", errCd.message);
      motivos["error_contador"] = (motivos["error_contador"] ?? 0) + 1;
      continue;
    }
    avisadasFacturas += (tocada ?? []).length;
  }

  // ------------------------------------------------------- resumen al equipo
  if (!emailEquipo) {
    // Sin buzón no hay a quién avisar. No se tocan los contadores de los enlaces: cuando
    // el equipo rellene `email_equipo` desde Configuració, siguen pendientes y el aviso
    // sale en la ejecución siguiente.
    for (const _ of vencidos) salta("sense_email_equip");
    console.warn(
      `recordatorios-documentales: ${vencidos.length} enllaç(os) per avisar i parametros_documentales.email_equipo és buit; no s'envia el resum.`,
    );
    return resumen(true, 0, avisadasFacturas);
  }

  // Los números de los objetos que esperan respuesta. Dos consultas como mucho, y solo
  // aquí: si no hay resumen que mandar, no se preguntan.
  const identificaciones = await identificar(supabase, vencidos);

  const n = vencidos.length;
  const nf = facturas.pendientes.length;
  const partes: string[] = [];
  if (n > 0) partes.push(`${n} enllaç${n === 1 ? "" : "os"} sense resposta`);
  if (nf > 0) partes.push(`${nf} factura${nf === 1 ? "" : "es"} pendent${nf === 1 ? "" : "s"}`);

  const envio = await sendEmail({
    to: emailEquipo,
    subject: `Redestina · ${partes.join(" · ")}`,
    html: plantillaEmail({
      titulo: "Pendents de resposta",
      preheader: `${partes.join(" i ")} a 7 o 14 dies.`,
      cuerpoHtml: [
        n > 0 ? cuerpoResumen(vencidos, ahoraMs, identificaciones, limitados) : "",
        nf > 0 ? cuerpoFacturas(facturas.pendientes, facturas.limitadas) : "",
      ].filter(Boolean).join("\n"),
      boton: { texto: "Obre Redestina", url: APP_URL },
      // El porqué, dicho al equipo con las mismas palabras que la cabecera de este
      // fichero: quien recibe esto tiene que entender por qué le toca a él y no al bot.
      nota:
        "Els <strong>enllaços</strong> els avisem a l'equip i no a les persones destinatàries perquè el sistema <strong>no pot reenviar-los</strong>: " +
        "de cada token només se'n desa l'empremta, i el text original només existeix al correu que es va enviar. " +
        "Per això cada fila porta un enllaç <strong>al panell</strong>, a la pantalla on es revoca i se n'emet un de nou (o es truca). " +
        "Mira la columna <strong>Què espera</strong>: una <strong>signatura de conveni</strong> no es resol com una " +
        "<strong>confirmació d'albarà</strong> —l'albarà el pot confirmar l'equip pel panell passat el termini, i el conveni no: " +
        "o es torna a enviar, o es fa una <strong>signatura assistida</strong> a la propera visita—. " +
        "Les <strong>factures</strong>, en canvi, sí que s'avisen al donant; a partir del segon avís queden marcades per trucar.",
    }),
  }, { supabase, proposito: "recordatori_equip", funcion: "recordatorios-documentales" });

  if (!envio.ok) {
    // No se suben los contadores de los enlaces: el hito sigue pendiente y se reintenta
    // mañana. Los de las facturas ya se movieron, y con razón: su correo sí salió.
    console.error(
      "recordatorios-documentales: Resend no acceptó el resumen:",
      envio.status,
      JSON.stringify(envio.data),
    );
    for (const _ of vencidos) salta("error_email");
    return resumen(false, 0, avisadasFacturas);
  }

  // Contadores de los enlaces. Se agrupa por el valor previo (0→1, 1→2) para hacer dos
  // UPDATE en vez de uno por fila; el `.eq('recordatorios', previo)` es el cinturón: si
  // algo hubiera movido la fila entre el select y esto (un reenvío desde el panel), no se
  // pisa.
  let avisados = 0;
  for (let previo = 0; previo < HITOS_DIAS.length; previo++) {
    const ids = vencidos
      .filter((v) => v.fila.recordatorios === previo)
      .map((v) => v.fila.id);
    if (ids.length === 0) continue;

    const { data: tocadas, error: errUp } = await supabase
      .from("enlaces_token")
      .update({ recordatorios: previo + 1, ultimo_recordatorio_at: ahoraIso })
      .in("id", ids)
      .eq("recordatorios", previo)
      .select("id");
    if (errUp) {
      console.error("recordatorios-documentales: update contadors:", errUp.message);
      continue;
    }
    avisados += (tocadas ?? []).length;
  }

  // El correo salió pero algún contador no se movió (error de escritura, o la fila
  // cambió por debajo). Se anota para que `motivos` siga sumando `saltados`: ese
  // enlace volverá a salir mañana, o sea que el equipo lo verá dos veces. Es el lado
  // correcto por el que equivocarse.
  if (avisados < vencidos.length) motivos["error_contador"] = vencidos.length - avisados;

  return resumen(true, avisados, avisadasFacturas);
});
