// Enlace público: confirmar un albarán sin tener cuenta (§B y fase 3 del plan).
//
//   GET  /enlace-publico?t=<token>                    -> lo que hay que revisar
//   POST /enlace-publico  { t, accion: 'confirmar', … } -> lo que se responde
//
// Se despliega con `verify_jwt = false` porque quien la usa **no tiene ni tendrá cuenta
// en Redestina**: es la persona de la entidad receptora que abre un correo desde el móvil,
// mira los kilos que le hemos apuntado y dice sí, o dice que faltaban diez.
//
// LO QUE LA PROTEGE ES EL TOKEN, y nada más. 32 bytes aleatorios de los que en la base
// solo vive el sha256 (20260928100300): un volcado de `enlaces_token` no abre ninguno.
// Aquí se hashea lo que llega por la URL y se pregunta a `resolver_enlace()`, que es la
// única función que sabe casarlo, y que corre con `service_role` porque no hay sesión
// que ninguna política pueda mirar.
//
// LOS TRES ESTADOS QUE NO SON UN ERROR NUESTRO. Un enlace desconocido es **404**, uno ya
// usado **409** y uno caducado **410**. La distinción importa: quien recibe un 410 tiene
// que pedir otro enlace, quien recibe un 409 ya ha confirmado y no tiene que hacer nada.
// No hace falta traducirlos aquí en el POST: `registrar_confirmacion()` los levanta como
// SQLSTATE `PT404`/`PT409`/`PT410` y PostgREST los convierte en esos mismos códigos HTTP.
// En el GET sí se traducen, porque `resolver_enlace()` es una consulta y no levanta nada.
//
// LO QUE ESTA FUNCIÓN NO HACE: no crea enlaces (los crea la RPC que emite el documento),
// no revoca, no reenvía y no toca ningún dato del albarán por su cuenta. Todo lo que
// escribe pasa por `registrar_confirmacion()`, que valida el estado dentro de una
// transacción con la fila bloqueada. Aquí solo se comprueba el token, se registra la
// evidencia de apertura y se firma la URL del PDF.
//
// DOS PROPÓSITOS VIVOS, uno por fase: `confirmacion_albaran` (fase 3) y `subida_factura`
// (fase 4, el donante adjunta su factura contra el resumen anual). El de la fase 2,
// `firma_convenio`, sigue respondiendo 501: el propósito ya existe en `enlaces_token`, lo
// que falta es el cuerpo de su rama.
//
// ⚠️ La subida de factura acepta **multipart** además de JSON, así que el cuerpo del POST
//    ya no se puede leer con un `req.json()` incondicional: se mira antes el
//    `content-type`. Es la única acción que trae un fichero.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { corsPara } from "../_shared/cors.ts";
import { esEmailTest, modoTestActivo } from "../_shared/gate.ts";
import { escaparHtml, plantillaEmail, sendEmail } from "../_shared/resend.ts";

// Sin tipos generados de la base (misma nota que `registro/index.ts`).
// deno-lint-ignore no-explicit-any
type Cliente = any;

const BUCKET = "documentos";
const SEGUNDOS_FIRMA = 60;
const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Anti-abuso — copiado de `registro/index.ts`, con los topes de la fase 3
// ---------------------------------------------------------------------------
// Mismos tres frenos y las mismas limitaciones, que conviene no olvidar:
//   · honeypot `web`: si viene relleno se responde 200 falso y no se escribe nada
//   · límite por IP EN MEMORIA: best-effort de verdad — el isolate se recicla y hay
//     varios a la vez, así que ni es global ni sobrevive a un arranque en frío
//   · freno DURABLE sobre `evidencias`: ≥ 50 en la última hora corta en seco. Ese sí
//     vive en la base y no depende de qué isolate atienda la petición
//
// Lo que de verdad hace inviable enumerar enlaces no es ninguno de los tres: es que el
// token son 256 bits. Los frenos están para el ruido y para no pagar consultas.
const FINESTRA_MS = 10 * 60 * 1000;
const MAX_PER_IP = 10;
const MAX_EVIDENCIES_HORA = 50;

const intentsPerIp = new Map<string, number[]>();

function massaIntentsIp(ip: string): boolean {
  if (!ip) return false;
  const ara = Date.now();
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
// Utilidades
// ---------------------------------------------------------------------------

async function sha256Hex(texto: string): Promise<string> {
  const resumen = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(resumen))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ipDe(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
}

function textNet(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function numeroOpcional(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

interface Enlace {
  id: string;
  proposito: string;
  objeto_tipo: string;
  objeto_id: string;
  destinatario_nombre: string | null;
  canal: string;
  caduca_at: string;
  abierto_at: string | null;
  usado_at: string | null;
  estado: string;
  estado_efectivo: string;
}

/** Hashea el token y pregunta a la base. `null` = ese token no existe. */
async function resolver(supabase: Cliente, token: string): Promise<Enlace | null> {
  const hash = await sha256Hex(token);
  const { data, error } = await supabase.rpc("resolver_enlace", { p_token_hash: hash });
  if (error) {
    console.error("enlace-publico: resolver_enlace:", error.message);
    throw new Error(error.message);
  }
  const filas = (data ?? []) as Enlace[];
  return filas.length > 0 ? filas[0] : null;
}

/** El estado efectivo, traducido al código HTTP que le corresponde. */
function estadoAHttp(estado: string): { status: number; code: string; error: string } | null {
  if (estado === "caducado") {
    return { status: 410, code: "caducat", error: "Aquest enllaç ha caducat." };
  }
  if (estado === "usado") {
    return { status: 409, code: "ja_usat", error: "Aquest enllaç ja s'ha fet servir." };
  }
  if (estado === "revocado") {
    return { status: 409, code: "revocat", error: "Aquest enllaç s'ha anul·lat." };
  }
  return null;
}

// ---------------------------------------------------------------------------
// El albarán que se enseña
// ---------------------------------------------------------------------------
// Se leen las tablas y NO el snapshot `documentos.datos`, por un motivo que no es
// estético: para confirmar hacen falta los **id de las líneas** (el POST manda
// `[{linea_id, kg}]`) y `albaran_datos()` no los incluye. Además, así lo que se enseña
// es el estado de ahora, no el del momento de emitir.
//
// ⚠️ NI UNA CIFRA EN EUROS, y aquí es literal: `albaran_lineas` no tiene ninguna columna
//    de importe, así que la lista de columnas de abajo no puede devolver ninguna aunque
//    alguien la ampliara sin pensar.

interface LineaPublica {
  id: string;
  orden: number | null;
  producto: string | null;
  variedad: string | null;
  num_cajas: number | null;
  tipo_caja: string | null;
  kg_previstos: number | null;
  kg_neto: number | null;
  kg_confirmados: number | null;
}

interface AlbaranPublico {
  id: string;
  tipo: string;
  numero_completo: string | null;
  estado: string;
  idioma: string;
  partes: Record<string, unknown> | null;
  recogida: Record<string, unknown> | null;
  retorn_envasos: string | null;
  observaciones: string | null;
  excedente_id: string | null;
  espigolada_id: string | null;
  canalizacion_id: string | null;
}

async function cargarAlbaran(
  supabase: Cliente,
  id: string,
): Promise<{ albaran: AlbaranPublico; lineas: LineaPublica[] } | null> {
  const { data, error } = await supabase
    .from("albaranes")
    .select(
      "id, tipo, numero_completo, estado, idioma, partes, recogida, retorn_envasos, observaciones, excedente_id, espigolada_id, canalizacion_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("enlace-publico: albaranes:", error.message);
    throw new Error(error.message);
  }
  if (!data) return null;

  const { data: filas, error: errLineas } = await supabase
    .from("albaran_lineas")
    .select("id, orden, producto, variedad, num_cajas, tipo_caja, kg_previstos, kg_neto, kg_confirmados")
    .eq("albaran_id", id)
    .order("orden");
  if (errLineas) {
    console.error("enlace-publico: albaran_lineas:", errLineas.message);
    throw new Error(errLineas.message);
  }
  return { albaran: data as AlbaranPublico, lineas: (filas ?? []) as LineaPublica[] };
}

/** El PDF vigente del objeto, firmado 60 s. `null` si todavía no se ha generado. */
async function urlPdf(
  supabase: Cliente,
  objetoId: string,
  objetoTipo = "albaran",
  // ⚠️ Un `cierre_donante` tiene DOS documentos vigentes a la vez (el RES y el CD), así
  //    que sin filtrar por tipo el `maybeSingle()` de abajo devolvería error en cuanto se
  //    emitiera el certificado. Un albarán solo tiene uno y no necesita el filtro.
  tipo?: string,
): Promise<string | null> {
  let consulta = supabase
    .from("documentos")
    .select("id, tipo, numero_completo, version, ruta, estado, fichero_at, vigente")
    .eq("objeto_tipo", objetoTipo)
    .eq("objeto_id", objetoId)
    .eq("vigente", true);
  if (tipo) consulta = consulta.eq("tipo", tipo);
  const { data, error } = await consulta.maybeSingle();
  if (error || !data?.ruta || !data?.fichero_at) return null;
  const { data: firma } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.ruta as string, SEGUNDOS_FIRMA);
  return firma?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// El texto que se acepta, y su huella
// ---------------------------------------------------------------------------
// `evidencias.sha256_texto` responde a la pregunta que hace que una firma propia valga
// algo: no «¿confirmó?», sino «¿QUÉ confirmó?». Para que responda de verdad, la huella
// tiene que ser de un texto concreto, reproducible y que la persona haya visto.
//
// LA DECISIÓN, en tres partes:
//
//   1. **El texto es un acta corta que compone el SERVIDOR**, no la página. Lleva la
//      declaración, el número del albarán, el código de verificación del PDF vigente y
//      una línea por producto con los kilos que se le proponen. Es lo que hay que poder
//      reconstruir dentro de dos años para decir «esto es lo que se le enseñó».
//   2. **El GET lo devuelve entero** (`text_confirmacio`) y la página está obligada a
//      mostrarlo tal cual. Si la página enseñara otra cosa, la huella dejaría de
//      describir lo aceptado, así que la única regla que la interfaz no puede saltarse
//      es esa: se muestra literal.
//   3. **El POST lo vuelve a componer aquí y hashea el suyo**, nunca el que manda el
//      cliente. Si el cliente manda `sha256_texto` y no coincide, se responde **409
//      `document_canviat`**: entre que abrió el enlace y pulsó el botón, el albarán
//      cambió, y confirmar entonces sería confirmar otra cosa. Aceptar la huella del
//      cliente convertiría la evidencia en una declaración suya, que es justo lo que no
//      puede ser.
//
// La huella NO incluye los kilos que la persona escribe: eso no es lo aceptado, es lo
// respondido, y va en `evidencias.payload` (que `registrar_confirmacion` guarda entero).

const DECLARACION: Record<string, string> = {
  ca:
    "Declaro que he rebut el producte que consta en aquest albarà i que les dades que hi ha a continuació són correctes. " +
    "Si els quilos rebuts no coincideixen amb els previstos, els corregeixo aquí i ho faig constar.",
  es:
    "Declaro que he recibido el producto que consta en este albarán y que los datos que figuran a continuación son correctos. " +
    "Si los kilos recibidos no coinciden con los previstos, los corrijo aquí y lo hago constar.",
};

function actaConfirmacion(
  albaran: AlbaranPublico,
  lineas: LineaPublica[],
  codigoVerificacion: string | null,
): string {
  const idioma = albaran.idioma === "es" ? "es" : "ca";
  const cabecera = idioma === "es"
    ? `Albarán ${albaran.numero_completo ?? albaran.id} · código de verificación ${codigoVerificacion ?? "—"}`
    : `Albarà ${albaran.numero_completo ?? albaran.id} · codi de verificació ${codigoVerificacion ?? "—"}`;
  const detalle = lineas.map((l) => {
    const kg = l.kg_neto ?? l.kg_previstos;
    return [
      `#${l.orden ?? ""}`,
      l.producto ?? "",
      l.variedad ?? "",
      l.num_cajas !== null ? `${l.num_cajas} ${idioma === "es" ? "cajas" : "caixes"}` : "",
      kg !== null && kg !== undefined ? `${kg} kg` : "",
    ].filter(Boolean).join(" · ");
  });
  return [cabecera, "", DECLARACION[idioma], "", ...detalle].join("\n");
}

/**
 * La recogida, con el ORIGEN TAPADO si el albarán es un ENT (D3).
 *
 * ⚠️ Esto no es una duplicación del renderizador de PDF: es el **mismo requisito en la
 *    otra salida**. El PDF de un ENT no lleva el nombre del generador ni el de su finca,
 *    pero esta función devuelve JSON a una página que abre exactamente esa entidad
 *    receptora, así que un `recogida` sin tapar filtraría por la API lo que el papel
 *    esconde. Los dos campos son `lugar` (la finca) y `responsable_origen` (la persona
 *    que estaba allí). Lo que sí se le da —y le basta para la trazabilidad— es el
 *    municipio, la comarca y el código de lote, en `partes.origen`.
 */
function recogidaPublica(albaran: AlbaranPublico): Record<string, unknown> | null {
  const r = albaran.recogida;
  if (!r || albaran.tipo !== "ENT") return r;
  const municipio = (albaran.partes as { origen?: { municipio?: string | null } } | null)
    ?.origen?.municipio ?? null;
  // Se quitan por LISTA NEGRA y no por lista blanca porque `recogida` es un jsonb libre
  // que escribe el panel: una lista blanca dejaría fuera cualquier campo nuevo y útil,
  // pero una negra deja pasar cualquier campo nuevo que revele el origen. El equilibrio
  // aquí es cubrir también las variantes en catalán (`lloc`, `responsable`), porque el
  // formulario del panel las puede escribir así y una privacidad que depende de acertar
  // el idioma de una clave no es una privacidad.
  const TAPADOS = ["lugar", "lloc", "responsable_origen", "responsable", "responsable_origen_tel"];
  const resto: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    if (!TAPADOS.includes(k)) resto[k] = v;
  }
  return { ...resto, lugar: municipio };
}

/** El código de verificación impreso en el PDF: 16 hex del sha256 del snapshot. */
function codigoDe(sha: string | null | undefined): string | null {
  if (!sha) return null;
  const limpio = sha.replace(/[^0-9a-fA-F]/g, "").slice(0, 16).toUpperCase();
  return limpio.match(/.{1,4}/g)?.join("-") ?? limpio;
}

async function shaDatosVigente(supabase: Cliente, albaranId: string): Promise<string | null> {
  const { data } = await supabase
    .from("documentos")
    .select("id, sha256_datos, vigente")
    .eq("objeto_tipo", "albaran")
    .eq("objeto_id", albaranId)
    .eq("vigente", true)
    .maybeSingle();
  return (data?.sha256_datos as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Aviso de rechazo
// ---------------------------------------------------------------------------
// Un rechazo parcial o total es la única respuesta que **alguien tiene que atender hoy**:
// hay producto que no ha llegado a su destino y todavía se puede recolocar. Por eso sale
// un correo en el momento, al donante y al equipo, y no se espera a que alguien mire la
// bandeja.
//
// Los gates de test se respetan igual que en cualquier otro envío (§8): con el modo test
// activo, al donante solo se le escribe si su ficha es de prueba. El buzón del equipo
// (`parametros_documentales.email_equipo`) sí recibe siempre, como en
// `recordatorios-documentales`: es el buzón que el super_admin ha configurado a mano y
// dejarlo sin el aviso convertiría el gate de pruebas en un silencio operativo.
//
// `sendEmail()` nunca lanza y esto tampoco: la confirmación ya está registrada cuando se
// llega aquí, y un fallo del correo no puede deshacerla ni convertirla en un error para
// quien acaba de confirmar.
async function avisarRechazo(
  supabase: Cliente,
  albaran: AlbaranPublico,
  lineas: LineaPublica[],
  payload: { rechazo: string; motivo_rechazo: string; incidencias: unknown },
  quien: string,
): Promise<{ enviados: string[]; saltados: string[] }> {
  const enviados: string[] = [];
  const saltados: string[] = [];
  try {
    // El donante: el productor del excedente o de la espigolada del que salió el REC.
    let productorId: string | null = null;
    if (albaran.excedente_id) {
      const { data } = await supabase
        .from("excedentes").select("id, productor_id").eq("id", albaran.excedente_id).maybeSingle();
      productorId = (data?.productor_id as string | null) ?? null;
    } else if (albaran.espigolada_id) {
      const { data } = await supabase
        .from("espigoladas").select("id, productor_id").eq("id", albaran.espigolada_id).maybeSingle();
      productorId = (data?.productor_id as string | null) ?? null;
    }

    let emailDonante: string | null = null;
    let nombreDonante = "";
    if (productorId) {
      const { data: prod } = await supabase
        .from("productores").select("id, name, empresa, email").eq("id", productorId).maybeSingle();
      if (prod) {
        emailDonante = (prod.email ?? "").trim() || null;
        nombreDonante = prod.empresa || prod.name || "";
      }
    }

    const { data: params } = await supabase
      .from("parametros_documentales")
      .select("id, email_equipo")
      .eq("id", 1)
      .maybeSingle();
    const emailEquipo = (params?.email_equipo ?? "").trim();

    const modoTest = await modoTestActivo(supabase);

    const destinos: string[] = [];
    if (emailDonante) {
      if (!modoTest || (await esEmailTest(supabase, emailDonante))) destinos.push(emailDonante);
      else saltados.push(emailDonante);
    }
    if (emailEquipo && !destinos.includes(emailEquipo)) destinos.push(emailEquipo);
    if (destinos.length === 0) return { enviados, saltados };

    const etiqueta = payload.rechazo === "total" ? "total" : "parcial";
    const filas = lineas.map((l) =>
      `<tr><td style="padding:4px 8px">${escaparHtml(l.producto ?? "")}</td>` +
      `<td style="padding:4px 8px;text-align:right">${l.kg_neto ?? l.kg_previstos ?? ""} kg</td>` +
      `<td style="padding:4px 8px;text-align:right">${
        l.kg_confirmados === null || l.kg_confirmados === undefined ? "—" : `${l.kg_confirmados} kg`
      }</td></tr>`
    ).join("");

    const cuerpo = `
      <p>Hi ha hagut un <strong>rebuig ${etiqueta}</strong> en l'albarà
      <strong>${escaparHtml(albaran.numero_completo ?? "")}</strong>${
      nombreDonante ? ` del producte de ${escaparHtml(nombreDonante)}` : ""
    }.</p>
      <p><strong>Motiu:</strong> ${escaparHtml(payload.motivo_rechazo)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr><th style="text-align:left;padding:4px 8px">Producte</th>
            <th style="text-align:right;padding:4px 8px">Entregat</th>
            <th style="text-align:right;padding:4px 8px">Confirmat</th></tr>
        ${filas}
      </table>
      <p>Ho ha fet constar ${escaparHtml(quien || "la persona que ha confirmat")}.</p>`;

    const html = plantillaEmail({
      titulo: `Rebuig ${etiqueta} · ${albaran.numero_completo ?? ""}`,
      preheader: `Motiu: ${payload.motivo_rechazo}`.slice(0, 120),
      cuerpoHtml: cuerpo,
      boton: { texto: "Obre Redestina", url: `${APP_URL}/equip/albarans` },
      nota: "Aquest avís s'envia automàticament quan qui rep un albarà hi fa constar un rebuig.",
    });

    for (const to of destinos) {
      const r = await sendEmail({
        to,
        subject: `Redestina · rebuig ${etiqueta} a l'albarà ${albaran.numero_completo ?? ""}`,
        html,
      });
      if (r.ok) enviados.push(to);
      else {
        saltados.push(to);
        console.error("enlace-publico: aviso de rechazo no enviado a", to, r.status, r.data);
      }
    }
  } catch (e) {
    console.error("enlace-publico: avisarRechazo:", e instanceof Error ? e.message : String(e));
  }
  return { enviados, saltados };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const t0 = performance.now();
  const cors = corsPara(req, "GET, POST, OPTIONS");
  const responder = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") {
    return responder({ error: "Method Not Allowed" }, 405);
  }

  const ip = ipDe(req);
  if (massaIntentsIp(ip)) {
    return responder(
      { error: "Has fet massa intents. Torna-ho a provar d'aquí una estona.", code: "massa_solicituds" },
      429,
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  try {
    return req.method === "GET"
      ? await manejarGet(req, supabase, responder, ip, t0)
      : await manejarPost(req, supabase, responder, ip, t0);
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e);
    console.error("enlace-publico:", texto);
    return responder({ error: "Hi ha hagut un problema. Torna-ho a provar.", code: "error_intern" }, 500);
  }
});

type Responder = (body: unknown, status?: number) => Response;

// ---------------------------------------------------------------------------
// GET: qué hay que revisar
// ---------------------------------------------------------------------------
async function manejarGet(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  ip: string,
  t0: number,
): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!token || token.length < 20 || token.length > 200) {
    return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  }

  const enlace = await resolver(supabase, token);
  // Un token que no existe y uno mal formado dan la misma respuesta a propósito: no hay
  // nada que un atacante pueda aprender de la diferencia.
  if (!enlace) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);

  const malestado = estadoAHttp(enlace.estado_efectivo);
  if (malestado) {
    return responder({
      error: malestado.error,
      code: malestado.code,
      proposito: enlace.proposito,
      estado_efectivo: enlace.estado_efectivo,
    }, malestado.status);
  }

  // Fase 4: el enlace del cierre anual tiene su propia pantalla —no hay nada que
  // confirmar, hay una factura que subir— y por eso tiene su propia rama.
  if (enlace.proposito === "subida_factura") {
    return await getFactura(req, supabase, responder, enlace, ip, t0);
  }

  // Fase 2 (`firma_convenio`): el enlace existe y es válido, pero esta versión no sabe
  // pintarlo. Se dice, en vez de enseñar una pantalla vacía.
  if (enlace.proposito !== "confirmacion_albaran") {
    return responder({
      error: "Aquest enllaç encara no es pot obrir des d'aquí.",
      code: "proposit_no_implementat",
      proposito: enlace.proposito,
      estado_efectivo: enlace.estado_efectivo,
    }, 501);
  }

  const cargado = await cargarAlbaran(supabase, enlace.objeto_id);
  if (!cargado) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const { albaran, lineas } = cargado;

  // Registrar la apertura ANTES de responder: si la persona cierra la pestaña sin
  // confirmar, esa apertura sigue siendo la prueba de que el enlace llegó y se abrió.
  // Solo se marca `abierto_at` la primera vez (es «cuándo se abrió», no «la última vez»).
  await supabase.from("evidencias").insert({
    enlace_id: enlace.id,
    tipo: "apertura",
    nombre: enlace.destinatario_nombre,
    ip: ip || null,
    user_agent: req.headers.get("user-agent"),
    payload: { albaran: albaran.numero_completo, estado: albaran.estado },
  });
  if (!enlace.abierto_at) {
    await supabase.from("enlaces_token").update({ abierto_at: new Date().toISOString() })
      .eq("id", enlace.id);
  }

  const sha = await shaDatosVigente(supabase, albaran.id);
  const codigo = codigoDe(sha);
  const texto = actaConfirmacion(albaran, lineas, codigo);

  const partes = (albaran.partes ?? {}) as {
    entrega?: { razon_social?: string | null } | null;
    recibe?: { razon_social?: string | null } | null;
    origen?: { municipio?: string | null } | null;
  };
  const recollida = recogidaPublica(albaran);

  const cuerpo = {
    proposito: enlace.proposito,
    estado_efectivo: enlace.estado_efectivo,
    // Alias de `estado_efectivo`. La pantalla pública (`src/lib/enllacPublic.ts`) se
    // escribió a la vez que esto y lee `estado`; el nombre bueno es el de arriba, este
    // se queda para que las dos mitades encajen sin que ninguna espere a la otra.
    estado: enlace.estado_efectivo,
    caduca_at: enlace.caduca_at,
    destinatari: enlace.destinatario_nombre,
    documento: {
      id: albaran.id,
      tipo: albaran.tipo,
      numero: albaran.numero_completo,
      // Mismo motivo que `estado`: el cliente lee `numero_completo`.
      numero_completo: albaran.numero_completo,
      estado: albaran.estado,
      idioma: albaran.idioma,
      codi_verificacio: codigo,
      partes: albaran.partes,
      // Las dos partes también en plano, que es lo que una pantalla necesita para pintar
      // «de X a Y» sin conocer la forma del jsonb.
      entrega: partes.entrega?.razon_social ?? null,
      recibe: partes.recibe?.razon_social ?? null,
      fecha: (recollida?.fecha_hora as string | null) ?? null,
      recollida,
      retorn_envasos: albaran.retorn_envasos,
      observacions: albaran.observaciones,
      observaciones: albaran.observaciones,
      // Sin ninguna columna de importe: `albaran_lineas` no tiene ninguna.
      linies: lineas,
    },
    // La página tiene que enseñar este texto TAL CUAL: su huella es lo que queda como
    // evidencia de qué se aceptó (ver la nota de `actaConfirmacion`), y lo que hay que
    // devolver en `sha256_texto` al confirmar.
    text_confirmacio: texto,
    sha256_texto: await sha256Hex(texto),
    pdf_url: await urlPdf(supabase, albaran.id),
    pdf_caduca_en: SEGUNDOS_FIRMA,
  };

  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "GET",
    enlace: enlace.id,
    albaran: albaran.numero_completo,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));
  return responder(cuerpo, 200);
}

// ---------------------------------------------------------------------------
// POST: lo que se responde
// ---------------------------------------------------------------------------
async function manejarPost(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  ip: string,
  t0: number,
): Promise<Response> {
  // ⚠️ El cuerpo NO se puede leer siempre como JSON desde la fase 4: la subida de factura
  //    llega como `multipart/form-data`. Se mira el `content-type` primero y se normaliza
  //    todo a un objeto plano + (como mucho) un fichero, para que el resto de la función
  //    siga sin enterarse de cómo vino.
  const tipoContenido = (req.headers.get("content-type") ?? "").toLowerCase();
  let body: Record<string, unknown> = {};
  let fichero: FicheroSubido | null = null;

  if (tipoContenido.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return responder({ error: "Cos invàlid.", code: "cos_invalid" }, 400);
    }
    for (const [clave, valor] of form.entries()) {
      if (typeof valor === "string") {
        body[clave] = valor;
      } else if (valor instanceof File && !fichero) {
        fichero = {
          bytes: new Uint8Array(await valor.arrayBuffer()),
          mime: (valor.type || "").toLowerCase(),
          nombre: valor.name || "factura",
        };
      }
    }
    // Con fichero, la única acción posible es la de la factura: no hace falta que el
    // formulario la escriba.
    if (!body.accion && fichero) body.accion = "subir_factura";
  } else {
    body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const base64 = typeof body.fitxer_base64 === "string" ? body.fitxer_base64 : "";
    if (base64) {
      const { fichero: decodificado, error } = decodificarBase64(
        base64,
        textNet(body.mime),
      );
      if (!decodificado) {
        return responder({ error: "El fitxer no s'ha pogut llegir.", code: error ?? "cos_invalid" }, 400);
      }
      fichero = { ...decodificado, nombre: textNet(body.nom_fitxer) || decodificado.nombre };
    }
  }

  // Honeypot: 200 falso. Decirle a un bot que se le ha visto solo le enseña a esconderse.
  if (textNet(body.web)) {
    console.warn("[enlace-publico] honeypot relleno, descartado");
    return responder({ ok: true }, 200);
  }

  const token = textNet(body.t);
  if (!token) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);

  // Freno durable: no depende de qué isolate atienda la petición. Va ANTES de repartir
  // por acción porque todas las que escriben dejan una evidencia, y el tope es sobre
  // evidencias: si solo protegiera a `confirmar`, la subida de factura sería la puerta
  // abierta al lado del cerrojo.
  const { count } = await supabase
    .from("evidencias")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if ((count ?? 0) >= MAX_EVIDENCIES_HORA) {
    console.warn("[enlace-publico] freno global:", count, "evidencias en la ultima hora");
    return responder(
      { error: "Ara mateix no podem processar més peticions. Torna-ho a provar més tard.", code: "massa_solicituds" },
      429,
    );
  }

  const accion = textNet(body.accion) || "confirmar";
  // Marcadores de las fases siguientes. El enrutado está aquí para que añadirlas sea
  // escribir la rama, no repensar la función:
  //   · 'firmar'       (fase 2, convenios): datos, declaración, trazo PNG a
  //                    `evidencias/<enlace>.png`, y `firmar_convenio_por_enlace()`
  //   · 'enviar_codi' / 'validar_codi' (fase 2): el 2º factor de 6 cifras
  //   · 'subir_factura' (fase 4, cierre anual) ya está implementada, más abajo.
  if (accion === "firmar" || accion === "enviar_codi" || accion === "validar_codi") {
    return responder(
      { error: "La signatura de convenis encara no està disponible.", code: "no_implementat", accion },
      501,
    );
  }
  if (accion === "subir_factura") {
    return await subirFactura(req, supabase, responder, body, fichero, ip, t0);
  }
  if (accion !== "confirmar") {
    return responder({ error: "Acció desconeguda.", code: "accio_desconeguda", accion }, 400);
  }

  const enlace = await resolver(supabase, token);
  if (!enlace) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const malestado = estadoAHttp(enlace.estado_efectivo);
  if (malestado) {
    return responder({ error: malestado.error, code: malestado.code }, malestado.status);
  }
  if (enlace.proposito !== "confirmacion_albaran") {
    return responder({ error: "Aquest enllaç no serveix per confirmar.", code: "proposit_incorrecte" }, 409);
  }

  const cargado = await cargarAlbaran(supabase, enlace.objeto_id);
  if (!cargado) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const { albaran, lineas } = cargado;

  // ------------------------------------------------------------- validación
  const nombre = textNet(body.nombre);
  if (nombre.length < 2 || nombre.length > 120) {
    return responder(
      { error: "Cal el nom de qui confirma.", code: "dades_invalides", camp: "nombre" },
      400,
    );
  }
  const cargo = textNet(body.cargo).slice(0, 120) || null;

  const rechazo = textNet(body.rechazo) || "cap";
  if (!["cap", "parcial", "total"].includes(rechazo)) {
    return responder({ error: "Rebuig no vàlid.", code: "dades_invalides", camp: "rechazo" }, 400);
  }
  const motivoRechazo = textNet(body.motivo_rechazo);
  // Se comprueba aquí además de en la RPC: un 400 con el campo señalado es accionable
  // desde el formulario; el 22023 de la base, no.
  if (rechazo !== "cap" && !motivoRechazo) {
    return responder(
      { error: "Un rebuig necessita motiu.", code: "dades_invalides", camp: "motivo_rechazo" },
      400,
    );
  }

  // Los kilos, línea a línea. Solo se aceptan ids de ESTE albarán: sin este filtro, el
  // cuerpo podría escribir kilos en las líneas de otro (la RPC ya lo acota con
  // `albaran_id = a.id`, pero entonces el aviso sería un silencio en vez de un error).
  const idsValidos = new Set(lineas.map((l) => l.id));
  const kgConfirmados: { linea_id: string; kg: number }[] = [];
  const entrantes = Array.isArray(body.kg_confirmados) ? body.kg_confirmados : [];
  for (const bruto of entrantes) {
    if (!bruto || typeof bruto !== "object") continue;
    const fila = bruto as Record<string, unknown>;
    const lineaId = textNet(fila.linea_id);
    const kg = numeroOpcional(fila.kg);
    if (!idsValidos.has(lineaId)) {
      return responder(
        { error: "Alguna línia no pertany a aquest albarà.", code: "linia_desconeguda" },
        400,
      );
    }
    if (kg === null || kg < 0 || kg > 1_000_000) {
      return responder(
        { error: "Els quilos no són vàlids.", code: "dades_invalides", camp: "kg_confirmados" },
        400,
      );
    }
    kgConfirmados.push({ linea_id: lineaId, kg });
  }

  const caixesRetornades = numeroOpcional(body.caixes_retornades);

  // --------------------------------------------------- la huella de lo aceptado
  const sha = await shaDatosVigente(supabase, albaran.id);
  const texto = actaConfirmacion(albaran, lineas, codigoDe(sha));
  const shaTexto = await sha256Hex(texto);
  const shaCliente = textNet(body.sha256_texto);
  if (shaCliente && shaCliente !== shaTexto) {
    // El albarán ha cambiado entre abrir el enlace y confirmar. Confirmar ahora sería
    // confirmar otra cosa.
    return responder(
      {
        error: "L'albarà ha canviat des que vas obrir l'enllaç. Torna a carregar la pàgina.",
        code: "document_canviat",
      },
      409,
    );
  }

  // ------------------------------------------------------------- la escritura
  const payload = {
    kg_confirmados: kgConfirmados,
    caixes_retornades: caixesRetornades,
    incidencias: body.incidencias ?? null,
    rechazo,
    motivo_rechazo: motivoRechazo || null,
  };

  const { data, error } = await supabase.rpc("registrar_confirmacion", {
    p_enlace: enlace.id,
    p_payload: payload,
    p_evidencia: {
      nombre,
      cargo,
      ip: ip || null,
      user_agent: req.headers.get("user-agent"),
      // Del servidor, siempre. Ver la nota larga de `actaConfirmacion`.
      sha256_texto: shaTexto,
    },
  });

  if (error) {
    // `registrar_confirmacion` levanta PT404/PT409/PT410 y PostgREST los traduce; aquí
    // solo hay que reenviar el código con un texto en catalán.
    const codigo = String(error.code ?? "");
    if (codigo === "PT404") return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
    if (codigo === "PT409") {
      return responder({ error: "Aquest enllaç ja s'ha fet servir.", code: "ja_usat" }, 409);
    }
    if (codigo === "PT410") {
      return responder({ error: "Aquest enllaç ha caducat.", code: "caducat" }, 410);
    }
    if (codigo === "22023") {
      return responder({ error: error.message, code: "dades_invalides" }, 400);
    }
    console.error("enlace-publico: registrar_confirmacion:", error.code, error.message);
    return responder({ error: "No s'ha pogut registrar la confirmació.", code: "error_bd" }, 500);
  }

  // -------------------------------------------------------------- el aviso
  let aviso: { enviados: string[]; saltados: string[] } | null = null;
  if (rechazo !== "cap") {
    const { lineas: actualizadas } = (await cargarAlbaran(supabase, albaran.id)) ?? { lineas };
    aviso = await avisarRechazo(
      supabase,
      albaran,
      actualizadas,
      { rechazo, motivo_rechazo: motivoRechazo, incidencias: body.incidencias },
      nombre,
    );
  }

  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "POST",
    accion,
    enlace: enlace.id,
    albaran: albaran.numero_completo,
    linies: kgConfirmados.length,
    rebuig: rechazo,
    avisats: aviso?.enviados.length ?? 0,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));

  const fila = (data ?? {}) as Record<string, unknown>;
  return responder({
    ok: true,
    albara: {
      numero: fila.numero_completo ?? albaran.numero_completo,
      estado: fila.estado ?? "confirmado",
      confirmado_at: fila.confirmado_at ?? null,
    },
    avis_rebuig: aviso ? { enviats: aviso.enviados.length, saltats: aviso.saltados.length } : null,
  }, 200);
}

// ---------------------------------------------------------------------------
// FASE 4 — el enlace del cierre anual: subir la factura
// ---------------------------------------------------------------------------
// Quien abre esto es el DONANTE: recibió el resumen anual con su importe y ahora tiene
// que hacernos llegar la factura por ese mismo importe (§3.5 del plan funcional). No
// tiene cuenta —o la tiene y no la usa nunca—, así que el enlace es todo lo que hay.
//
// TRES DIFERENCIAS CON LA CONFIRMACIÓN DE UN ALBARÁN, y las tres importan:
//
//   1. **Trae un fichero.** Se acepta `multipart/form-data` (lo natural desde un móvil) y
//      también JSON con el fichero en base64, porque el navegador integrado de WhatsApp
//      —donde se va a abrir la mitad de las veces— no siempre se porta igual con FormData.
//   2. **No hay acta ni huella de texto.** Aquí nadie declara nada: adjunta un documento
//      suyo. La evidencia es la subida (`evidencias.tipo = 'subida'`) con el número y la
//      fecha que ha tecleado, más el sha256 del fichero, que va en `documentos_externos`.
//   3. **La comparación la hace SQL.** `registrar_factura()` compara el importe con
//      `valor_total` a dos decimales y decide `coincident` o `discrepancia`; aquí no se
//      decide nada, se muestra lo que dijo la base. Sin importe queda `factura_rebuda`:
//      el PDF ha llegado pero nadie ha leído la cifra, y eso no es lo mismo que cuadrar.
//
// La ruta dentro del bucket la da SQL (`ruta_documento`), como en `subir-documento-externo`
// y por el mismo motivo: quién puede ver un fichero lo decide la carpeta, y la carpeta no
// se compone aquí con un `+`.

const MAX_BYTES_FACTURA = 10 * 1024 * 1024;

/** Los tres formatos que acepta el bucket (20260928100600). */
const MIMES_FACTURA: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

interface CierreDonantePublico {
  id: string;
  cierre_id: string;
  estado: string;
  kg_total: number | null;
  valor_total: number | null;
  resumen_numero: string | null;
  factura_numero: string | null;
  datos_fiscales: Record<string, unknown> | null;
  bloqueos: { detall?: string | null; bloqueja?: boolean | null }[] | null;
}

interface CierrePublico {
  ejercicio: number | null;
  modo: string;
  estado: string;
}

async function cargarCierreDonante(
  supabase: Cliente,
  id: string,
): Promise<{ cd: CierreDonantePublico; cierre: CierrePublico } | null> {
  const { data, error } = await supabase
    .from("cierres_donante")
    .select(
      "id, cierre_id, estado, kg_total, valor_total, resumen_numero, factura_numero, datos_fiscales, bloqueos",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("enlace-publico: cierres_donante:", error.message);
    throw new Error(error.message);
  }
  if (!data) return null;

  const { data: ce, error: errCe } = await supabase
    .from("cierres_ejercicio")
    .select("id, ejercicio, modo, estado")
    .eq("id", (data as CierreDonantePublico).cierre_id)
    .maybeSingle();
  if (errCe) {
    console.error("enlace-publico: cierres_ejercicio:", errCe.message);
    throw new Error(errCe.message);
  }
  return {
    cd: data as CierreDonantePublico,
    cierre: (ce ?? { ejercicio: null, modo: "prueba", estado: "obert" }) as CierrePublico,
  };
}

/** GET del enlace de factura: qué se debe, por qué y con qué documento. */
async function getFactura(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  enlace: Enlace,
  ip: string,
  t0: number,
): Promise<Response> {
  if (enlace.objeto_tipo !== "cierre_donante") {
    return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  }
  const cargado = await cargarCierreDonante(supabase, enlace.objeto_id);
  if (!cargado) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const { cd, cierre } = cargado;

  // La apertura se registra ANTES de responder, igual que en la confirmación: es la
  // prueba de que el enlace llegó y se abrió aunque después no se suba nada.
  await supabase.from("evidencias").insert({
    enlace_id: enlace.id,
    tipo: "apertura",
    nombre: enlace.destinatario_nombre,
    ip: ip || null,
    user_agent: req.headers.get("user-agent"),
    payload: { resum: cd.resumen_numero, estat: cd.estado },
  });
  if (!enlace.abierto_at) {
    await supabase.from("enlaces_token").update({ abierto_at: new Date().toISOString() })
      .eq("id", enlace.id);
  }

  const fiscales = (cd.datos_fiscales ?? {}) as Record<string, unknown>;
  const cuerpo = {
    proposito: enlace.proposito,
    estado_efectivo: enlace.estado_efectivo,
    estado: enlace.estado_efectivo,
    caduca_at: enlace.caduca_at,
    destinatari: enlace.destinatario_nombre,
    documento: {
      id: cd.id,
      tipo: "RES",
      numero: cd.resumen_numero,
      numero_completo: cd.resumen_numero,
      estado: cd.estado,
      exercici: cierre.ejercicio,
      // El modo se dice: quien abre un ensayo tiene que saber que lo es, igual que la
      // filigrana lo dice en el PDF.
      mode: cierre.modo,
      donant: fiscales["raó_social"] ?? null,
      nif: fiscales.nif ?? null,
      kg_total: cd.kg_total,
      valor_total: cd.valor_total,
      factura_numero: cd.factura_numero,
      bloquejos: (cd.bloqueos ?? []).map((b) => b?.detall).filter(Boolean),
    },
    // Lo que la pantalla tiene que pedir. Se manda desde el servidor para que el
    // formulario no invente ni el máximo ni los formatos.
    formulari: {
      accions: ["subir_factura"],
      mimes: Object.keys(MIMES_FACTURA),
      max_bytes: MAX_BYTES_FACTURA,
      camps: ["numero", "fecha", "importe", "fitxer"],
      import_esperat: cd.valor_total,
    },
    pdf_url: await urlPdf(supabase, cd.id, "cierre_donante", "RES"),
    pdf_caduca_en: SEGUNDOS_FIRMA,
  };

  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "GET",
    proposit: "subida_factura",
    enlace: enlace.id,
    resum: cd.resumen_numero,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));
  return responder(cuerpo, 200);
}

/** El fichero que llega, venga por multipart o en base64. */
interface FicheroSubido {
  bytes: Uint8Array;
  mime: string;
  nombre: string;
}

function decodificarBase64(
  valor: string,
  mimeDeclarado: string,
): { fichero: FicheroSubido | null; error?: string } {
  // Se admite tal cual o como data URI (`data:application/pdf;base64,…`), que es lo que
  // devuelve un `FileReader` en el navegador.
  let datos = valor;
  let mime = mimeDeclarado;
  const dataUri = valor.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (dataUri) {
    mime = mime || dataUri[1];
    datos = dataUri[3];
  }
  try {
    const binario = atob(datos.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return { fichero: { bytes, mime: (mime || "").toLowerCase(), nombre: "factura" } };
  } catch {
    return { fichero: null, error: "base64_invalid" };
  }
}

/**
 * POST `accion: 'subir_factura'`. Devuelve el estado que ha decidido `registrar_factura()`,
 * que es lo único que la pantalla tiene que enseñar: cuadra, no cuadra, o falta la cifra.
 */
async function subirFactura(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  body: Record<string, unknown>,
  fichero: FicheroSubido | null,
  ip: string,
  t0: number,
): Promise<Response> {
  const token = textNet(body.t);
  if (!token) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);

  const enlace = await resolver(supabase, token);
  if (!enlace) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const malestado = estadoAHttp(enlace.estado_efectivo);
  if (malestado) {
    return responder({ error: malestado.error, code: malestado.code }, malestado.status);
  }
  if (enlace.proposito !== "subida_factura" || enlace.objeto_tipo !== "cierre_donante") {
    return responder(
      { error: "Aquest enllaç no serveix per pujar una factura.", code: "proposit_incorrecte" },
      409,
    );
  }

  const cargado = await cargarCierreDonante(supabase, enlace.objeto_id);
  if (!cargado) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const { cd, cierre } = cargado;

  // ------------------------------------------------------------- validación
  const numero = textNet(body.numero).slice(0, 80);
  if (numero.length < 1) {
    return responder(
      { error: "Cal el número de la factura.", code: "dades_invalides", camp: "numero" },
      400,
    );
  }
  const fecha = textNet(body.fecha) || null;
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return responder({ error: "La data no és vàlida.", code: "dades_invalides", camp: "fecha" }, 400);
  }
  const importe = numeroOpcional(body.importe);
  if (importe !== null && (importe < 0 || importe > 100_000_000)) {
    return responder(
      { error: "L'import no és vàlid.", code: "dades_invalides", camp: "importe" },
      400,
    );
  }

  if (!fichero || fichero.bytes.length === 0) {
    return responder({ error: "Falta el fitxer de la factura.", code: "falta_fitxer" }, 400);
  }
  if (fichero.bytes.length > MAX_BYTES_FACTURA) {
    return responder(
      { error: "El fitxer no pot passar de 10 MB.", code: "massa_gran", bytes: fichero.bytes.length },
      413,
    );
  }
  const extension = MIMES_FACTURA[fichero.mime];
  if (!extension) {
    return responder(
      { error: "Només s'accepten PDF, JPG i PNG.", code: "mime_no_acceptat", mime: fichero.mime },
      415,
    );
  }

  // ---------------------------------------------------------------- la ruta
  // La decide SQL. El modo del cierre entra tal cual: una factura de un cierre de prueba
  // se archiva bajo `proves/`, que es lo que después borra `reiniciar_cierre_prueba`.
  const idExterno = crypto.randomUUID();
  let ruta: string;
  try {
    const { data, error } = await supabase.rpc("ruta_documento", {
      p_objeto_tipo: "cierre_donante",
      p_objeto_id: cd.id,
      p_tipo: "externs",
      p_numero_completo: idExterno,
      p_version: 1,
      p_modo: cierre.modo,
      p_ejercicio: cierre.ejercicio ?? new Date().getFullYear(),
    });
    if (error) throw new Error(error.message);
    const completa = String(data ?? "");
    const carpeta = completa.slice(0, completa.lastIndexOf("/") + 1);
    if (!carpeta) throw new Error("ruta_documento() no ha devuelto ninguna carpeta");
    ruta = `${carpeta}${idExterno}-factura.${extension}`;
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e);
    console.error("enlace-publico: ruta_documento:", texto);
    return responder(
      { error: "No s'ha pogut desar el fitxer.", code: "sense_carpeta" },
      409,
    );
  }

  // --------------------------------------------------------------- la subida
  // La huella es de los BYTES (no de un texto), y se calcula sobre una copia: el
  // `Uint8Array` que llega puede ser una vista de un buffer mayor.
  const resumen = await crypto.subtle.digest("SHA-256", fichero.bytes.slice().buffer);
  const shaFichero = Array.from(new Uint8Array(resumen))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error: errSubida } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, fichero.bytes, { contentType: fichero.mime, upsert: false });
  if (errSubida) {
    console.error("enlace-publico: upload factura:", errSubida.message);
    return responder({ error: "No s'ha pogut desar el fitxer.", code: "error_storage" }, 500);
  }

  const { data: externo, error: errExterno } = await supabase
    .from("documentos_externos")
    .insert({
      objeto_tipo: "cierre_donante",
      objeto_id: cd.id,
      tipo: "factura",
      numero,
      fecha,
      ruta,
      sha256: shaFichero,
      mime: fichero.mime,
      bytes: fichero.bytes.length,
      // `enlace`: lo aporta alguien sin cuenta, desde su correo (20261012100400).
      origen: "enlace",
    })
    .select("id, ruta, sha256, bytes, mime")
    .single();

  if (errExterno) {
    // Compensación: un objeto en el bucket sin su fila es un fichero que no ve nadie.
    console.error("enlace-publico: insert documentos_externos:", errExterno.message);
    await supabase.storage.from(BUCKET).remove([ruta]);
    return responder({ error: "No s'ha pogut registrar la factura.", code: "error_bd" }, 500);
  }

  // ------------------------------------------------------------- el registro
  // `registrar_factura` corre con `service_role` (esta función no tiene sesión) y es
  // quien decide `coincident` / `discrepancia` / `factura_rebuda`.
  const { data: fila, error: errRegistro } = await supabase.rpc("registrar_factura", {
    p_cd: cd.id,
    p_numero: numero,
    p_fecha: fecha,
    p_importe: importe,
    p_doc_externo: externo.id,
  });

  if (errRegistro) {
    // Se deshace todo: sin registro, el fichero subido no significa nada y quedaría
    // colgando en la carpeta del donante.
    await supabase.from("documentos_externos").delete().eq("id", externo.id);
    await supabase.storage.from(BUCKET).remove([ruta]);
    const codigo = String(errRegistro.code ?? "");
    if (codigo === "22023") {
      return responder({ error: errRegistro.message, code: "dades_invalides" }, 400);
    }
    console.error("enlace-publico: registrar_factura:", codigo, errRegistro.message);
    return responder({ error: "No s'ha pogut registrar la factura.", code: "error_bd" }, 500);
  }

  const resultado = (fila ?? {}) as Record<string, unknown>;
  const estado = String(resultado.estado ?? "");

  // La evidencia de la subida. Va DESPUÉS del registro a propósito: lo que se prueba es
  // que la factura entró, y si el registro falla no ha entrado nada.
  await supabase.from("evidencias").insert({
    enlace_id: enlace.id,
    tipo: "subida",
    nombre: textNet(body.nombre).slice(0, 120) || enlace.destinatario_nombre,
    ip: ip || null,
    user_agent: req.headers.get("user-agent"),
    payload: {
      numero,
      fecha,
      importe,
      documento_externo: externo.id,
      sha256: shaFichero,
      bytes: fichero.bytes.length,
      mime: fichero.mime,
      estat_resultant: estado,
    },
  });

  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "POST",
    accion: "subir_factura",
    enlace: enlace.id,
    resum: cd.resumen_numero,
    estat: estado,
    bytes: fichero.bytes.length,
    mime: fichero.mime,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));

  return responder({
    ok: true,
    factura: {
      numero,
      fecha,
      importe,
      // Lo que el donante necesita saber ahora mismo: si cuadra con lo que le pedimos.
      import_esperat: cd.valor_total,
      coincideix: estado === "coincident",
      estat: estado,
      document_extern: externo.id,
    },
  }, 200);
}
