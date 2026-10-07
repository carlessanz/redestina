// `confirmacion_albaran` (fase 3): la entidad que recibe confirma los kilos de un albarán
// sin tener cuenta. El GET enseña el acta y su huella; el POST la recompone, registra la
// confirmación con `registrar_confirmacion()` y, si hay rechazo, avisa. Separado de
// `index.ts` el 07-10-2026 sin cambios de lógica (ver la cabecera de `index.ts`).

import { esEmailTest, modoTestActivo } from "../_shared/gate.ts";
import { escaparHtml, plantillaEmail, sendEmail } from "../_shared/resend.ts";
import { enmascararEmail } from "../_shared/enmascarar.ts";
import {
  APP_URL,
  type Cliente,
  type Enlace,
  estadoAHttp,
  numeroOpcional,
  type Responder,
  resolver,
  SEGUNDOS_FIRMA,
  sha256Hex,
  textNet,
  urlPdf,
} from "./comun.ts";

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
      }, {
        supabase,
        proposito: "avis_rebuig",
        objetoTipo: "albaran",
        objetoId: albaran.id,
        funcion: "enlace-publico",
      });
      if (r.ok) enviados.push(to);
      else {
        saltados.push(to);
        console.error("enlace-publico: aviso de rechazo no enviado a", enmascararEmail(to), r.status, r.data);
      }
    }
  } catch (e) {
    console.error("enlace-publico: avisarRechazo:", e instanceof Error ? e.message : String(e));
  }
  return { enviados, saltados };
}

// ---------------------------------------------------------------------------
// GET: el albarán que hay que revisar
// ---------------------------------------------------------------------------
export async function getAlbaran(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  enlace: Enlace,
  ip: string,
  t0: number,
): Promise<Response> {
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
    // El formulario tiene que poder decir «aquesta confirmació quedarà registrada com a
    // assistida»: quien la conduce es el equipo, y la persona que la firma merece saber
    // con qué etiqueta va a quedar en la evidencia y en el PDF. Igual que en el convenio.
    assistida: enlace.canal === "asistido",
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
// POST `accion: 'confirmar'`: lo que se responde
// ---------------------------------------------------------------------------
export async function confirmarAlbaran(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  body: Record<string, unknown>,
  token: string,
  ip: string,
  t0: number,
): Promise<Response> {
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

  // La nota de la confirmación ASISTIDA (05-10-2026, rebanada 3): quien la conduce deja
  // escrito con quién habló y cómo («per telèfon amb la Maria, ha dit que…»). Obligatoria en
  // ese canal: sin ella, «confirmat per l'equip» no dice en nombre de quién.
  const notaAssistida = enlace.canal === "asistido" ? textNet(body.nota).slice(0, 400) : "";
  if (enlace.canal === "asistido" && !notaAssistida) {
    return responder(
      { error: "Cal una nota: amb qui has parlat i com t'ho ha confirmat.", code: "dades_invalides", camp: "nota" },
      400,
    );
  }

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
  // Tres canales, y cada uno deja una huella distinta:
  //
  //   · `email`    — el enlace que Redestina envió. No añade nada.
  //   · `panel`    — quien confirma lo hace desde su panel con sesión (20270318100000).
  //                  La cuenta va en `payload.panell`, NUNCA en `asistido_por`: esa
  //                  columna significa «alguien del equipo condujo el acto», y decir eso
  //                  de una confirmación propia sería falso en un documento legal.
  //   · `asistido` — el dinamizador la conduce con la persona delante (20270328100200).
  //                  Aquí NO se compone nada: `registrar_confirmacion()` escribe
  //                  `asistido_por` leyéndolo de `enlaces_token.creado_por` dentro de
  //                  SQL, y solo cuando el canal es ese. Que lo imponga la base y no
  //                  esta función es lo que impide que un llamador futuro se lo salte.
  //
  // En los dos casos la cuenta sale de la fila del enlace, nunca del cuerpo de la
  // petición — quien confirma no tiene sesión y podría escribir cualquier uuid.
  let panell: { user_id: string | null; email: string | null } | null = null;
  if (enlace.canal === "panel") {
    const { data: fila } = await supabase
      .from("enlaces_token").select("id, creado_por, destinatario_email").eq("id", enlace.id).maybeSingle();
    panell = {
      user_id: (fila?.creado_por as string | null) ?? null,
      email: (fila?.destinatario_email as string | null) ?? null,
    };
  }

  // `p_payload` es LO RESPONDIDO por la persona; `p_evidencia.payload`, lo que el
  // servidor constata sobre el acto. `registrar_confirmacion()` los funde con el segundo
  // encima (20270328100200), igual que `firmar_convenio_por_enlace` (20270320100200).
  // `panell` cambia de sitio por eso: no es una respuesta, es una constatación.
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
      ...(panell ? { payload: { panell } } : {}),
      ...(notaAssistida ? { payload: { nota_assistida: notaAssistida } } : {}),
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
    accion: "confirmar",
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
