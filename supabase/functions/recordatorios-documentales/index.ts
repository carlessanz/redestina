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

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { destinatariosPrueba, esEmailTest, modoTestActivo } from "../_shared/gate.ts";
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

/**
 * La pantalla del panel donde se resuelve cada cosa. Es lo que convierte el aviso en algo
 * accionable: el correo NO puede llevar el enlace original —de `enlaces_token` solo se
 * guarda el hash— pero sí puede llevar a quien lee al sitio exacto donde se revoca y se
 * reenvía (`enviar_convenio()` emite uno nuevo y revoca el anterior; `marcar_entregado()`
 * vuelve a crear los de confirmación). Sin esto, el recordatorio decía «hay algo
 * pendiente» y dejaba al equipo buscándolo a mano (deudas §12.57 y §12.74).
 */
function enlacePanel(objetoTipo: string, objetoId: string): string | null {
  if (objetoTipo === "convenio") return `${APP_URL}/equip/convenis/${objetoId}`;
  if (objetoTipo === "albaran") return `${APP_URL}/equip/albarans/${objetoId}`;
  return null;
}

/** Qué hay que hacer con cada tipo de enlace, dicho en una línea. */
const ACCION_TEXTO: Record<string, string> = {
  firma_convenio: "Reenviar (revoca l'anterior) o signatura assistida",
  confirmacion_albaran: "Reenviar o confirmar des del panell",
};

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
  | "error_email" // Resend no aceptó el resumen
  | "sense_enllac_factura" // la factura no tiene enlace del que contar los días
  | "sense_destinatari_donant" // `cierre_destinatario()` no puede decidir a quién escribir
  | "mode_prova_bloqueja"; // cierre de prueba y el destinatario no es es_test ni el equipo

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

/**
 * Cómo se llama el objeto que espera respuesta, para que el equipo sepa CUÁL es sin
 * abrirlo. Antes el resumen imprimía los ocho primeros caracteres del uuid, que no
 * identifica nada: un albarán se conoce por su número (`ENT-2026-00042`) y un convenio
 * pendiente de firma **todavía no tiene número** —se pide al firmar—, así que ahí lo que
 * identifica es el tipo y la organización.
 */
interface Identificacion {
  numero: string | null;
  etiqueta: string | null;
}

const CONVENIO_TEXTO: Record<string, string> = {
  don_gen: "Conveni de donació · generador",
  don_rec: "Conveni de donació · receptor",
  com: "Conveni comercial",
};

async function identificar(
  supabase: Cliente,
  vencidos: Vencido[],
): Promise<Map<string, Identificacion>> {
  const mapa = new Map<string, Identificacion>();
  const porTipo = (tipo: string) =>
    [...new Set(vencidos.filter((v) => v.fila.objeto_tipo === tipo).map((v) => v.fila.objeto_id))];

  const albaranes = porTipo("albaran");
  const convenios = porTipo("convenio");

  // Dos consultas como mucho por ejecución, y solo si hay algo que avisar.
  if (albaranes.length > 0) {
    // La lista de columnas, en UN literal (§7, deuda 46).
    const { data, error } = await supabase
      .from("albaranes")
      .select("id, tipo, numero_completo, estado")
      .in("id", albaranes);
    if (error) console.warn("recordatorios-documentales: albaranes:", error.message);
    for (const a of (data ?? []) as { id: string; tipo: string; numero_completo: string | null }[]) {
      mapa.set(a.id, { numero: a.numero_completo, etiqueta: `Albarà ${a.tipo}` });
    }
  }
  if (convenios.length > 0) {
    const { data, error } = await supabase
      .from("convenios")
      .select("id, tipo, numero_completo, estado")
      .in("id", convenios);
    if (error) console.warn("recordatorios-documentales: convenios:", error.message);
    for (const c of (data ?? []) as { id: string; tipo: string; numero_completo: string | null }[]) {
      mapa.set(c.id, { numero: c.numero_completo, etiqueta: CONVENIO_TEXTO[c.tipo] ?? "Conveni" });
    }
  }
  return mapa;
}

/**
 * El resumen que se manda al equipo. Todo lo que viene de la base va escapado.
 *
 * Cada fila lleva **el enlace a la pantalla donde se resuelve**, no el enlace de firma
 * —ese no se puede reconstruir— y **el número del documento**, no un trozo de uuid. Es
 * lo que hace que el aviso se pueda accionar sin buscar nada a mano.
 */
function cuerpoResumen(
  vencidos: Vencido[],
  ahoraMs: number,
  ids: Map<string, Identificacion>,
  limitados: number,
): string {
  const filas = vencidos.map((v) => {
    const destinatario = v.fila.destinatario_email
      ? escaparHtml(v.fila.destinatario_nombre ?? v.fila.destinatario_email)
      : `${escaparHtml(v.fila.destinatario_nombre ?? "—")} <em>(assistit)</em>`;
    const correo = v.fila.destinatario_email
      ? `<br><span style="color:#5f6b5a">${escaparHtml(v.fila.destinatario_email)}</span>`
      : "";
    const id = ids.get(v.fila.objeto_id);
    // El número si lo tiene; si no (un conveni en `pendent_firma` todavía no lo tiene:
    // se pide al firmar), el tipo. El uuid corto se queda como último recurso.
    const queEs = escaparHtml(
      id?.numero ?? id?.etiqueta ?? OBJETO_TEXTO[v.fila.objeto_tipo] ?? v.fila.objeto_tipo,
    );
    const url = enlacePanel(v.fila.objeto_tipo, v.fila.objeto_id);
    const accion = escaparHtml(ACCION_TEXTO[v.fila.proposito] ?? "Obre'l al panell");
    const boton = url
      ? `<a href="${url}" style="color:#4e6b45;font-weight:600;text-decoration:underline">Obre i reenvia</a>
         <br><span style="color:#5f6b5a;font-size:12px">${accion}</span>`
      : `<span style="color:#5f6b5a">${accion}</span>`;
    return `<tr style="border-top:1px solid #e0d9ca">
      <td style="padding:8px 10px;vertical-align:top">${destinatario}${correo}</td>
      <td style="padding:8px 10px;vertical-align:top">${
      escaparHtml(PROPOSITO_TEXTO[v.fila.proposito] ?? v.fila.proposito)
    }<br><span style="color:#5f6b5a">${queEs}</span></td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${v.dias} dies</td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${
      diasParaCaducar(v.fila.caduca_at, ahoraMs)
    } dies</td>
      <td style="padding:8px 10px;vertical-align:top">${boton}</td>
    </tr>`;
  }).join("\n");

  const n = vencidos.length;
  // El tope de la ejecución, DICHO (deuda §12.58). Antes solo se veía en `motivos`, o sea
  // en ningún sitio que alguien mire: quien lee el correo daba por hecho que la lista
  // estaba completa.
  const recorte = limitados > 0
    ? `<p style="margin:0 0 14px;padding:10px 12px;background:#fdf1f0;border-left:3px solid #ef7d77">
        <strong>La llista està retallada.</strong> Hi ha ${limitados} enllaç${
      limitados === 1 ? "" : "os"
    } més que també toquen avui i que s'han deixat per demà
        (el màxim per execució és ${MAX_POR_EJECUCION}).</p>`
    : "";

  return `${recorte}<p style="margin:0 0 14px">${
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
    <th style="padding:0 10px 6px">Resoldre</th>
  </tr>
  ${filas}
</table>`;
}

// ---------------------------------------------------------------------------
// Las facturas pendientes (fase 4)
// ---------------------------------------------------------------------------

// Sin tipos generados de la base: anotar el cliente con `ReturnType<typeof createClient>`
// resuelve el esquema a `never` (misma nota que en `generar-documento` y `_shared/gate.ts`).
// deno-lint-ignore no-explicit-any
type Cliente = any;

interface FilaCierreDonante {
  id: string;
  cierre_id: string;
  estado: string;
  kg_total: number | null;
  valor_total: number | null;
  resumen_numero: string | null;
  recordatorios: number;
  ultimo_recordatorio_at: string | null;
  requiere_llamada: boolean;
}

interface FacturaPendiente {
  cd: FilaCierreDonante;
  hito: number;
  dias: number;
  email: string;
  nombre: string;
  /** El destinatario NO es el donante: es el buzón del equipo (modo prueba). */
  forzado: boolean;
  motivoDestinatario: string;
  numero: string | null;
  importe: number | null;
  kg: number | null;
  ejercicio: number | null;
  modo: string;
  caducaAt: string | null;
}

/** `850` → `850,00 €`, sin `Intl` (misma razón que en `_shared/pdf/lletres.ts`). */
function eur(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !isFinite(valor)) return "—";
  const [entera, decimal] = Math.abs(valor).toFixed(2).split(".");
  const conMillares = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${valor < 0 ? "-" : ""}${conMillares},${decimal} €`;
}

/**
 * Los donantes a los que hoy les toca aviso porque su factura sigue sin llegar.
 *
 * Tres cosas que decide esta función y conviene tener juntas:
 *
 *   · **De dónde se cuentan los días.** No de `cierres_donante` —que no guarda cuándo se
 *     mandó el resumen— sino del `enlaces_token` de propósito `subida_factura`, que crea
 *     `emitir_resumen()` en la misma transacción. Sin enlace no hay reloj y se salta:
 *     avisar de una factura que nunca se pidió sería avisar de nada.
 *   · **A quién se escribe.** Lo dice `cierre_destinatario()`, la MISMA función que usó la
 *     emisión, y no un `productores.email` leído aquí: en modo prueba nunca devuelve el
 *     correo de un donante real. Si no puede decidir (donante sin correo en un cierre
 *     real), se salta y el equipo lo verá en la bandeja.
 *   · **Qué gates se aplican.** Los dos: el modo test global (§8) y, si el cierre es de
 *     prueba, `destinatariosPrueba()` —que no mira `test_mode` a propósito—. Un ensayo del
 *     cierre no puede escribirle a un donante de verdad ni el día que Redestina esté en
 *     producción con el modo test apagado.
 */
async function facturasPendientes(
  supabase: Cliente,
  ahoraMs: number,
  modoTest: boolean,
  salta: (m: Motivo) => void,
): Promise<{ pendientes: FacturaPendiente[]; revisadas: number; limitadas: number }> {
  // La lista de columnas, en UN literal (§7, deuda 46).
  const { data, error } = await supabase
    .from("cierres_donante")
    .select(
      "id, cierre_id, estado, kg_total, valor_total, resumen_numero, recordatorios, ultimo_recordatorio_at, requiere_llamada",
    )
    .eq("estado", "factura_pendent")
    .lt("recordatorios", HITOS_DIAS.length)
    .order("id", { ascending: true })
    .limit(LIMITE_CONSULTA);

  if (error) {
    console.error("recordatorios-documentales: select cierres_donante:", error.message);
    return { pendientes: [], revisadas: 0, limitadas: 0 };
  }
  const candidatas = (data ?? []) as FilaCierreDonante[];
  if (candidatas.length === 0) return { pendientes: [], revisadas: 0, limitadas: 0 };

  // El reloj: el enlace de subida vivo de cada donante.
  const { data: enlaces } = await supabase
    .from("enlaces_token")
    .select("id, proposito, objeto_tipo, objeto_id, estado, created_at, caduca_at, usado_at")
    .eq("proposito", "subida_factura")
    .eq("objeto_tipo", "cierre_donante")
    .eq("estado", "activo")
    .in("objeto_id", candidatas.map((c) => c.id));
  const reloj = new Map<string, { created_at: string; caduca_at: string }>();
  for (const e of (enlaces ?? []) as { objeto_id: string; created_at: string; caduca_at: string }[]) {
    reloj.set(e.objeto_id, { created_at: e.created_at, caduca_at: e.caduca_at });
  }

  // El ejercicio y el modo, por cierre.
  const { data: cierres } = await supabase
    .from("cierres_ejercicio")
    .select("id, ejercicio, modo, estado")
    .in("id", [...new Set(candidatas.map((c) => c.cierre_id))]);
  const porCierre = new Map<string, { ejercicio: number | null; modo: string }>();
  for (const c of (cierres ?? []) as { id: string; ejercicio: number | null; modo: string }[]) {
    porCierre.set(c.id, { ejercicio: c.ejercicio, modo: c.modo });
  }

  const pendientes: FacturaPendiente[] = [];
  let limitadas = 0;
  for (const cd of candidatas) {
    const enlace = reloj.get(cd.id);
    if (!enlace) {
      salta("sense_enllac_factura");
      continue;
    }
    const r = tocaAviso(
      {
        recordatorios: cd.recordatorios,
        created_at: enlace.created_at,
        ultimo_recordatorio_at: cd.ultimo_recordatorio_at,
      },
      ahoraMs,
    );
    if (!r.toca) {
      salta(r.motivo);
      continue;
    }
    if (pendientes.length >= MAX_POR_EJECUCION) {
      limitadas++;
      salta("limit_execucio");
      continue;
    }

    const cierre = porCierre.get(cd.cierre_id) ?? { ejercicio: null, modo: "prueba" };

    // A quién: lo decide SQL, como en la emisión.
    const { data: dest, error: errDest } = await supabase
      .rpc("cierre_destinatario", { p_cd: cd.id });
    const destino = (dest ?? {}) as Record<string, unknown>;
    const email = String(destino.email ?? "").trim();
    if (errDest || !email) {
      if (errDest) console.warn("recordatorios-documentales: cierre_destinatario:", errDest.message);
      salta("sense_destinatari_donant");
      continue;
    }

    // Barrera del cierre de prueba: independiente de `test_mode` (§8, `gate.ts`).
    const barrera = await destinatariosPrueba(
      supabase,
      { modo: cierre.modo, tipo: "RES", numero_completo: cd.resumen_numero, envio: { destinatario: email } },
      [email],
    );
    if (barrera.permitidos.length === 0) {
      salta("mode_prova_bloqueja");
      continue;
    }

    // Y el gate de test global, salvo que el destinatario sea el propio buzón del equipo
    // (mismo criterio que en el resto del circuito: ese buzón recibe siempre).
    if (modoTest && !destino.forcat && !(await esEmailTest(supabase, email))) {
      salta("no_test_user");
      continue;
    }

    pendientes.push({
      cd,
      hito: r.hito,
      dias: r.dias,
      email,
      nombre: String(destino.nom ?? ""),
      forzado: destino.forcat === true,
      motivoDestinatario: String(destino.motiu ?? ""),
      numero: cd.resumen_numero,
      importe: cd.valor_total,
      kg: cd.kg_total,
      ejercicio: cierre.ejercicio,
      modo: cierre.modo,
      caducaAt: enlace.caduca_at,
    });
  }

  return { pendientes, revisadas: candidatas.length, limitadas };
}

/** El correo al donante. Todo lo que viene de la base va escapado. */
function cuerpoFactura(f: FacturaPendiente): string {
  const prova = f.modo === "prueba"
    ? `<p style="margin:0 0 14px;color:#5f6b5a"><strong>Aquest és un tancament de prova</strong> (${
      escaparHtml(f.motivoDestinatario)
    }): no cal fer res.</p>`
    : "";
  return `${prova}<p style="margin:0 0 14px">Fa <strong>${f.dias} dies</strong> que et vam enviar el resum anual
${escaparHtml(f.numero ?? "")} de l'exercici ${f.ejercicio ?? ""} i encara no ens ha arribat la teva factura.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px;margin:0 0 14px">
  <tr><td style="padding:4px 0;color:#5f6b5a">Import</td><td style="padding:4px 0;text-align:right"><strong>${
    eur(f.importe)
  }</strong></td></tr>
  <tr><td style="padding:4px 0;color:#5f6b5a">Quilos</td><td style="padding:4px 0;text-align:right">${
    f.kg === null ? "—" : `${f.kg} kg`
  }</td></tr>
</table>
<p style="margin:0 0 14px">Pots pujar-la des de l'enllaç que t'enviàvem amb el resum —encara és vàlid— o
des de <strong>Els meus documents</strong> al teu panell, amb el botó d'aquest correu.
Si has perdut l'enllaç, respon a aquest correu i te'n fem arribar un de nou.</p>`;
}

/** La segunda tabla del resumen del equipo. */
function cuerpoFacturas(facturas: FacturaPendiente[], limitadas: number): string {
  const filas = facturas.map((f) =>
    `<tr style="border-top:1px solid #e0d9ca">
      <td style="padding:8px 10px;vertical-align:top">${escaparHtml(f.nombre || "—")}<br>
        <span style="color:#5f6b5a">${escaparHtml(f.email)}</span></td>
      <td style="padding:8px 10px;vertical-align:top">${escaparHtml(f.numero ?? "—")}<br>
        <span style="color:#5f6b5a">exercici ${f.ejercicio ?? ""}${
      f.modo === "prueba" ? " · prova" : ""
    }</span></td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap;text-align:right">${eur(f.importe)}</td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${f.dias} dies</td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${
      f.hito >= HITOS_DIAS[HITOS_DIAS.length - 1] ? "Cal trucar" : "Avisat"
    }</td>
      <td style="padding:8px 10px;vertical-align:top"><a href="${APP_URL}/equip/tancament/${
      encodeURIComponent(f.cd.cierre_id)
    }" style="color:#4e6b45;font-weight:600;text-decoration:underline">Obre el tancament</a></td>
    </tr>`
  ).join("\n");

  const n = facturas.length;
  const recorte = limitadas > 0
    ? `<p style="margin:18px 0 0;padding:10px 12px;background:#fdf1f0;border-left:3px solid #ef7d77">
        <strong>La llista de factures està retallada</strong>: ${limitadas} més toquen avui i s'han deixat per demà
        (el màxim per execució és ${MAX_POR_EJECUCION}).</p>`
    : "";
  return `${recorte}<p style="margin:18px 0 14px">${
    n === 1 ? "Hi ha <strong>1 factura</strong> pendent" : `Hi ha <strong>${n} factures</strong> pendents`
  } del tancament anual. Al donant ja se li ha escrit.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px">
  <tr style="text-align:left;color:#5f6b5a;font-size:12px;text-transform:uppercase;letter-spacing:.5px">
    <th style="padding:0 10px 6px">Donant</th>
    <th style="padding:0 10px 6px">Resum</th>
    <th style="padding:0 10px 6px;text-align:right">Import</th>
    <th style="padding:0 10px 6px">Enviat fa</th>
    <th style="padding:0 10px 6px">Estat</th>
    <th style="padding:0 10px 6px">Resoldre</th>
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
  const facturas = await facturasPendientes(supabase, ahoraMs, modoTest, salta);

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
