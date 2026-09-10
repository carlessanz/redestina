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
// FASE 4 (cierre anual): aquí se añadirá el segundo bloque, las **facturas
// pendientes** de `cierres_donante` (mismos hitos de 7 y 14 días sobre sus propios
// `recordatorios` / `ultimo_recordatorio_at`, y a los 14 días marcar
// `requiere_llamada`). Está fuera a propósito: esa tabla todavía no existe. El sitio
// donde va está marcado más abajo.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { esEmailTest, modoTestActivo } from "../_shared/gate.ts";
import { escaparHtml, plantillaEmail, sendEmail } from "../_shared/resend.ts";

const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com")
  .replace(/\/$/, "");

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Los hitos, por posición: con `recordatorios = 0` toca a los 7 días; con 1, a los 14;
 * con 2 se acabó (a partir de ahí el enlace es material de llamada, no de correo, y
 * `recordatorios >= 2` es justo el filtro de la bandeja del equipo).
 */
const HITOS_DIAS = [7, 14] as const;

/**
 * Dos avisos del mismo enlace no pueden ir seguidos. El caso que esto evita no es el
 * cron diario —entre el hito 7 y el 14 pasa una semana— sino el de recuperación: si
 * el job no corre durante quince días, al volver un enlace cumple los dos hitos a la
 * vez y se avisaría dos veces en la misma mañana. Con esto, el segundo espera a
 * mañana. 20 h y no 24 para que el propio cron diario no se pise por unos segundos.
 */
const MIN_ENTRE_AVISOS_MS = 20 * 60 * 60 * 1000;

/** Candidatos que se traen de la base en una ejecución. */
const LIMITE_CONSULTA = 200;

/**
 * Tope de enlaces escalados por ejecución. El gate `esEmailTest()` son dos consultas
 * por destinatario distinto, y una acumulación grande (el job parado una temporada)
 * no debe convertir una ejecución en cientos de idas y venidas a la base. A ritmo
 * diario, 50 es muy superior a cualquier volumen real de Redestina; lo que sobra
 * espera a mañana, que para un recordatorio es intrascendente.
 */
const MAX_POR_EJECUCION = 50;

interface FilaEnlace {
  id: string;
  proposito: string;
  objeto_tipo: string;
  objeto_id: string;
  destinatario_email: string | null;
  destinatario_nombre: string | null;
  canal: string;
  caduca_at: string;
  recordatorios: number;
  ultimo_recordatorio_at: string | null;
  created_at: string;
}

type Motivo =
  | "hito_no_vencut" // todavía no le toca (o ya agotó los dos avisos)
  | "avis_massa_recent" // se avisó hace menos de MIN_ENTRE_AVISOS_MS
  | "sense_destinatari" // sin correo (canal 'asistido') y modo test activo
  | "no_test_user" // modo test activo y el destinatario no es es_test
  | "limit_execucio" // pasó del tope de esta ejecución
  | "sense_email_equip" // `parametros_documentales.email_equipo` está vacío
  | "error_email"; // Resend no aceptó el resumen

type Resultado =
  | { toca: true; hito: number; dias: number }
  | { toca: false; motivo: "hito_no_vencut" | "avis_massa_recent" };

/**
 * ¿Le toca aviso a este enlace? Función **pura**: no mira la red ni el reloj del
 * sistema (el instante entra por parámetro), así que se puede probar sola. Mismo
 * criterio que `priorizacion.ts` y `canal.ts`.
 */
export function tocaAviso(
  fila: Pick<FilaEnlace, "recordatorios" | "created_at" | "ultimo_recordatorio_at">,
  ahoraMs: number,
): Resultado {
  const idx = fila.recordatorios;
  // Ya gastó los dos avisos (o llegó un valor imposible): no le toca nada más.
  if (idx < 0 || idx >= HITOS_DIAS.length) return { toca: false, motivo: "hito_no_vencut" };
  const hito = HITOS_DIAS[idx];

  const dias = (ahoraMs - Date.parse(fila.created_at)) / DIA_MS;
  if (!(dias >= hito)) return { toca: false, motivo: "hito_no_vencut" };

  if (fila.ultimo_recordatorio_at) {
    const desde = ahoraMs - Date.parse(fila.ultimo_recordatorio_at);
    if (desde < MIN_ENTRE_AVISOS_MS) return { toca: false, motivo: "avis_massa_recent" };
  }
  return { toca: true, hito, dias: Math.floor(dias) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PROPOSITO_TEXTO: Record<string, string> = {
  firma_convenio: "Signatura de conveni",
  confirmacion_albaran: "Confirmació d'albarà",
  subida_factura: "Pujada de factura",
};

const OBJETO_TEXTO: Record<string, string> = {
  albaran: "Albarà",
  convenio: "Conveni",
  cierre_donante: "Tancament de donant",
};

/** Días que le quedan de vida al enlace (nunca negativos: los vencidos ni se traen). */
function diasParaCaducar(caducaAt: string, ahoraMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(caducaAt) - ahoraMs) / DIA_MS));
}

interface Vencido {
  fila: FilaEnlace;
  hito: number;
  dias: number;
}

/** El resumen que se manda al equipo. Todo lo que viene de la base va escapado. */
function cuerpoResumen(vencidos: Vencido[], ahoraMs: number): string {
  const filas = vencidos.map((v) => {
    const destinatario = v.fila.destinatario_email
      ? escaparHtml(v.fila.destinatario_nombre ?? v.fila.destinatario_email)
      : `${escaparHtml(v.fila.destinatario_nombre ?? "—")} <em>(assistit)</em>`;
    const correo = v.fila.destinatario_email
      ? `<br><span style="color:#5f6b5a">${escaparHtml(v.fila.destinatario_email)}</span>`
      : "";
    return `<tr style="border-top:1px solid #e0d9ca">
      <td style="padding:8px 10px;vertical-align:top">${destinatario}${correo}</td>
      <td style="padding:8px 10px;vertical-align:top">${
      escaparHtml(PROPOSITO_TEXTO[v.fila.proposito] ?? v.fila.proposito)
    }<br><span style="color:#5f6b5a">${
      escaparHtml(OBJETO_TEXTO[v.fila.objeto_tipo] ?? v.fila.objeto_tipo)
    } · ${escaparHtml(v.fila.objeto_id.slice(0, 8))}</span></td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${v.dias} dies</td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${
      diasParaCaducar(v.fila.caduca_at, ahoraMs)
    } dies</td>
    </tr>`;
  }).join("\n");

  const n = vencidos.length;
  return `<p style="margin:0 0 14px">${
    n === 1
      ? "Hi ha <strong>1 enllaç</strong> que"
      : `Hi ha <strong>${n} enllaços</strong> que`
  } ${n === 1 ? "porta" : "porten"} 7 o 14 dies sense fer-se servir.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px">
  <tr style="text-align:left;color:#5f6b5a;font-size:12px;text-transform:uppercase;letter-spacing:.5px">
    <th style="padding:0 10px 6px">Destinatari</th>
    <th style="padding:0 10px 6px">Què espera</th>
    <th style="padding:0 10px 6px">Enviat fa</th>
    <th style="padding:0 10px 6px">Caduca en</th>
  </tr>
  ${filas}
</table>`;
}

Deno.serve(async (req) => {
  const t0 = performance.now();
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  // Secreto compartido: lo guarda `app_config.documentos_secret` (lo lee el job) y el
  // secret DOCUMENTOS_SECRET (lo valida esto). Quien invoca es la base, no una persona.
  const esperado = Deno.env.get("DOCUMENTOS_SECRET");
  const recibido = req.headers.get("x-documentos-secret");
  if (!esperado || recibido !== esperado) return json({ error: "unauthorized" }, 401);

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
  for (const fila of candidatos) {
    const r = tocaAviso(fila, ahoraMs);
    if (!r.toca) {
      salta(r.motivo);
      continue;
    }
    if (vencidos.length >= MAX_POR_EJECUCION) {
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

  const resumen = (ok: boolean, avisados: number) => {
    const saltados = candidatos.length - avisados;
    console.log(JSON.stringify({
      fn: "recordatorios-documentales",
      ok,
      revisados: candidatos.length,
      avisados,
      saltados,
      motivos,
      modo_test: modoTest,
      ms_total: Number((performance.now() - t0).toFixed(1)),
    }));
    return json({ ok, revisados: candidatos.length, avisados, saltados, motivos }, 200);
  };

  if (vencidos.length === 0) return resumen(true, 0);

  if (!emailEquipo) {
    // Sin buzón no hay a quién avisar. No se tocan los contadores: cuando el equipo
    // rellene `email_equipo` desde Configuració, estos enlaces siguen pendientes y el
    // aviso sale en la ejecución siguiente.
    for (const _ of vencidos) salta("sense_email_equip");
    console.warn(
      `recordatorios-documentales: ${vencidos.length} enllaç(os) per avisar i parametros_documentales.email_equipo és buit; no s'envia res.`,
    );
    return resumen(true, 0);
  }

  const n = vencidos.length;
  const envio = await sendEmail({
    to: emailEquipo,
    subject: `Redestina · ${n} enllaç${n === 1 ? "" : "os"} sense resposta`,
    html: plantillaEmail({
      titulo: "Enllaços pendents de resposta",
      preheader: `${n} enllaç${n === 1 ? "" : "os"} sense fer servir a 7 o 14 dies.`,
      cuerpoHtml: cuerpoResumen(vencidos, ahoraMs),
      boton: { texto: "Obre Redestina", url: APP_URL },
      // El porqué, dicho al equipo con las mismas palabras que la cabecera de este
      // fichero: quien recibe esto tiene que entender por qué le toca a él y no al bot.
      nota:
        "Aquest avís va a l'equip i no a les persones destinatàries perquè el sistema <strong>no pot reenviar l'enllaç</strong>: " +
        "de cada token només se'n desa l'empremta, i el text original només existeix al correu que es va enviar. " +
        "Per tornar a provar-ho cal revocar l'enllaç i emetre'n un de nou des del panell, o bé trucar. " +
        "Un enllaç que ja porta dos avisos no en rebrà cap més.",
    }),
  });

  if (!envio.ok) {
    // No se suben los contadores: el hito sigue pendiente y se reintenta mañana.
    console.error(
      "recordatorios-documentales: Resend no acceptó el resumen:",
      envio.status,
      JSON.stringify(envio.data),
    );
    for (const _ of vencidos) salta("error_email");
    return resumen(false, 0);
  }

  // Contadores. Se agrupa por el valor previo (0→1, 1→2) para hacer dos UPDATE en vez
  // de uno por fila; el `.eq('recordatorios', previo)` es el cinturón: si algo hubiera
  // movido la fila entre el select y esto (un reenvío desde el panel), no se pisa.
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

  // ---------------------------------------------------------------------------
  // FASE 4 — facturas pendientes de `cierres_donante`
  // ---------------------------------------------------------------------------
  // Mismo esquema que lo de arriba sobre `cierres_donante.recordatorios` /
  // `ultimo_recordatorio_at`, con dos diferencias: el destinatario es el donante (que
  // sí puede recibir su propio aviso, porque el enlace de subida de factura se puede
  // reemitir sin romper nada que esté firmado) y, al segundo aviso, hay que marcar
  // `requiere_llamada = true`. Va en esta misma función y en esta misma ejecución: el
  // resumen del equipo debe ser uno, no dos correos a la misma hora.
  // No se implementa aquí porque `cierres_donante` no existe todavía.

  return resumen(true, avisados);
});
