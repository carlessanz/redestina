// `firma_document` (05-11-2026): firmar con el dedo o el ratón un documento ya emitido —el
// certificado de donación (CD), el de recepción (CR) y los albaranes REC y ENT— desde el
// enlace `/signar-document/<token>`.
//
//   GET  /enlace-publico?t=<token>                               -> qué se firma
//   POST /enlace-publico  { t, accion: 'firmar_document', … }    -> la firma
//
// El molde es el convenio (`convenio.ts`), con tres diferencias que conviene tener a la vista:
//
//   1. **No hay texto que componer.** El documento ya existe, emitido e inmutable; lo que
//      se firma es ESE documento, y su huella es la que ya está impresa en el papel:
//      `documentos.sha256_datos` (el código de verificación). Por eso `sha256_texto` es
//      `sha256_datos` y no el hash de una redacción: si el cliente manda otra, el documento
//      cambió entre abrir y firmar (otra versión) y se responde `409 document_canviat`.
//      `text_acta` es solo la frase de conformidad que la página enseña junto al trazo.
//   2. **Sin segundo factor.** Los enlaces de documento solo se acuñan por correo
//      (`preparar_enviament_signatura`, 30 días) o desde el panel con sesión
//      (`acunar_enllac_propi`, 1 h): quien lo abre ya ha demostrado tener el correo o la
//      cuenta. No hay firma asistida de documentos.
//   3. **La firma NO es una edición**: `signar_document_per_enllac()` emite la versión n+1
//      (`subtipo = 'signat'`, el mismo `datos` y el mismo `sha256_datos`) y la deja en
//      `pendiente_fichero`; el trigger encola `generar-documento`, que pinta el trazo. Aquí
//      no se toca ningún PDF.
//
// EL TRAZO se sube ANTES de llamar a la RPC (la evidencia guarda su ruta y una evidencia
// que apunte a un fichero inexistente sería peor que no tener trazo) y se borra si la RPC
// falla. La carpeta la decide SQL (`ruta_documento(..., 'evidencies', ...)`), como en el
// convenio: `<org>/<ejercicio>/evidencies/<enlace>.png`.

import {
  BUCKET,
  type Cliente,
  decodificarBase64,
  type Enlace,
  estadoAHttp,
  type Responder,
  resolver,
  textNet,
  urlRutaFirmada,
  SEGUNDOS_FIRMA,
} from "./comun.ts";

const MAX_BYTES_TRAZO = 1024 * 1024;
/** Los mismos mínimos que el convenio y que `signar_document_per_enllac()`. */
const MIN_NOM = 2;
const MIN_CARREC = 2;
const MIN_DNI = 5;
const MAX_CAMP = 120;
const MAX_DNI = 40;

type Idioma = "ca" | "es";

interface DocumentFirmable {
  id: string;
  tipo: string;
  subtipo: string | null;
  objeto_tipo: string;
  objeto_id: string;
  numero_completo: string | null;
  version: number;
  modo: string;
  idioma: string | null;
  ejercicio: number | null;
  sha256_datos: string | null;
  ruta: string | null;
  estado: string;
  fichero_at: string | null;
  vigente: boolean;
}

interface PartSignant {
  part: string;
  tipo_org: string;
  org_id: string;
  admet_canvas: boolean;
}

/** El nombre del documento dentro de una frase («el certificat de donació núm. …»). */
const NOM_TIPUS: Record<Idioma, Record<string, string>> = {
  ca: {
    CD: "certificat de donació",
    CR: "certificat de recepció",
    REC: "albarà de recepció",
    ENT: "albarà d'entrega",
  },
  es: {
    CD: "certificado de donación",
    CR: "certificado de recepción",
    REC: "albarán de recepción",
    ENT: "albarán de entrega",
  },
};

/** Mismo formato que imprime el PDF (`codigoVerificacion`): 16 hex en grupos de cuatro. */
export function codiVerificacio(sha: string | null | undefined): string {
  if (!sha) return "—";
  const net = sha.replace(/[^0-9a-fA-F]/g, "").slice(0, 16).toUpperCase();
  return net.match(/.{1,4}/g)?.join("-") ?? net;
}

/**
 * La frase de conformidad que se enseña junto al trazo. La huella NO es la de esta frase
 * (es `sha256_datos`, la del documento): la frase solo dice en voz alta qué se firma.
 */
export function textActa(
  idioma: Idioma,
  tipo: string,
  numero: string,
  org: string,
  codi: string,
): string {
  const nom = NOM_TIPUS[idioma][tipo] ?? (idioma === "es" ? "documento" : "document");
  return idioma === "es"
    ? `Recibido y conforme. Firmo como representante de ${org} el ${nom} núm. ${numero}, con código de verificación ${codi}, y declaro que tengo poderes para hacerlo.`
    : `Rebut i conforme. Signo com a representant de ${org} el ${nom} núm. ${numero}, amb codi de verificació ${codi}, i declaro que tinc poders per fer-ho.`;
}

function idiomaDe(v: string | null | undefined): Idioma {
  return v === "es" ? "es" : "ca";
}

async function cargarDocumento(supabase: Cliente, id: string): Promise<DocumentFirmable | null> {
  const { data, error } = await supabase
    .from("documentos")
    .select(
      "id, tipo, subtipo, objeto_tipo, objeto_id, numero_completo, version, modo, idioma, ejercicio, sha256_datos, ruta, estado, fichero_at, vigente",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("enlace-publico: documentos:", error.message);
    throw new Error(error.message);
  }
  return (data as DocumentFirmable | null) ?? null;
}

/** ¿Ya hay una firma viva (recibida o cerrada) sobre esta versión? */
async function firmaViva(
  supabase: Cliente,
  documentoId: string,
): Promise<{ id: string; estat: string; via: string } | null> {
  const { data, error } = await supabase
    .from("firmes_document")
    .select("id, estat, via")
    .eq("documento_id", documentoId)
    .neq("estat", "rebutjat")
    .limit(1);
  if (error) {
    console.error("enlace-publico: firmes_document:", error.message);
    throw new Error(error.message);
  }
  const filas = (data ?? []) as { id: string; estat: string; via: string }[];
  return filas[0] ?? null;
}

async function partSignant(supabase: Cliente, documentoId: string): Promise<PartSignant | null> {
  const { data, error } = await supabase.rpc("document_part_signant", { p_documento: documentoId });
  if (error) {
    console.error("enlace-publico: document_part_signant:", error.message);
    throw new Error(error.message);
  }
  const filas = (data ?? []) as PartSignant[];
  return filas[0] ?? null;
}

/** El nombre legal de la organización que firma (razón social antes que el comercial). */
async function nomOrganitzacio(supabase: Cliente, p: PartSignant): Promise<string> {
  if (p.tipo_org === "productor") {
    const { data } = await supabase
      .from("productores").select("id, razon_social, empresa, name").eq("id", p.org_id).maybeSingle();
    return String(data?.razon_social || data?.empresa || data?.name || "").trim();
  }
  const { data } = await supabase
    .from("entidades").select("id, razon_social, nombre").eq("id", p.org_id).maybeSingle();
  return String(data?.razon_social || data?.nombre || "").trim();
}

/**
 * Quién firma, prellenado para no hacerlo teclear cada vez (se puede cambiar):
 *   1. la última firma con trazo de esa organización (nombre y cargo);
 *   2. si no, quien firmó su convenio (`convenios.firmante`);
 *   3. si no, el contacto de la ficha (solo el nombre).
 * Con un enlace de PANEL, el nombre es el de la cuenta que lo acuñó: quien firma es ella.
 * Nunca el DNI: no se guarda en ningún sitio que se pueda devolver aquí.
 */
async function signantPrevist(
  supabase: Cliente,
  p: PartSignant,
  enlace: Enlace,
): Promise<{ nom: string | null; carrec: string | null }> {
  let nom: string | null = null;
  let carrec: string | null = null;

  const { data: previa } = await supabase
    .from("firmes_document")
    .select("id, signant_nom, signant_carrec, signat_at")
    .eq("tipo_org", p.tipo_org)
    .eq("org_id", p.org_id)
    .eq("via", "canvas")
    .order("signat_at", { ascending: false })
    .limit(1);
  const f = ((previa ?? []) as { signant_nom: string | null; signant_carrec: string | null }[])[0];
  if (f) {
    nom = f.signant_nom?.trim() || null;
    carrec = f.signant_carrec?.trim() || null;
  }

  if (!nom || !carrec) {
    const columna = p.tipo_org === "productor" ? "productor_id" : "entidad_id";
    const { data: convs } = await supabase
      .from("convenios")
      .select("id, firmante, firmado_at")
      .eq(columna, p.org_id)
      .not("firmante", "is", null)
      .order("firmado_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const firmant = (((convs ?? []) as { firmante: Record<string, unknown> | null }[])[0]?.firmante) ?? null;
    if (firmant) {
      nom = nom ?? (textNet(firmant.nombre) || textNet(firmant.representant) || null);
      carrec = carrec ?? (textNet(firmant.cargo) || textNet(firmant.carrec) || null);
    }
  }

  if (!nom) {
    if (p.tipo_org === "productor") {
      const { data } = await supabase.from("productores").select("id, name").eq("id", p.org_id).maybeSingle();
      nom = textNet(data?.name) || null;
    } else {
      const { data } = await supabase.from("entidades").select("id, contacto").eq("id", p.org_id).maybeSingle();
      nom = textNet(data?.contacto) || null;
    }
  }

  if (enlace.canal === "panel") {
    const { data: fila } = await supabase
      .from("enlaces_token").select("id, creado_por").eq("id", enlace.id).maybeSingle();
    if (fila?.creado_por) {
      const { data: perfil } = await supabase
        .from("perfiles").select("id, nombre").eq("id", fila.creado_por).maybeSingle();
      const propi = textNet(perfil?.nombre);
      if (propi) nom = propi;
    }
  }
  return { nom, carrec };
}

/**
 * Lo que comparten el GET y el POST: el enlace es de un documento, el documento existe, no
 * está firmado, es la versión vigente y se puede firmar con trazo. Devuelve la respuesta de
 * error lista, o lo cargado.
 */
async function comprovar(
  supabase: Cliente,
  responder: Responder,
  enlace: Enlace,
): Promise<{ resposta: Response } | { doc: DocumentFirmable; part: PartSignant }> {
  if (enlace.objeto_tipo !== "documento") {
    return { resposta: responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404) };
  }
  const doc = await cargarDocumento(supabase, enlace.objeto_id);
  if (!doc) return { resposta: responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404) };

  if (doc.tipo === "CONV") {
    return {
      resposta: responder({
        error: "El conveni es signa des del seu propi enllaç.",
        code: "usa_firma_conveni",
      }, 409),
    };
  }
  // «Ya firmado» va ANTES que «versión sustituida»: al cerrarse una firma, la versión
  // firmada deja de ser vigente (la sustituye la `signat`), y decir «hi ha una versió més
  // nova» a quien acaba de firmar sería falso.
  const viva = await firmaViva(supabase, doc.id);
  if (viva || doc.subtipo === "signat") {
    return {
      resposta: responder({
        error: "Aquest document ja està signat.",
        code: "ja_signat",
        estat: viva?.estat ?? "tancat",
        via: viva?.via ?? null,
      }, 409),
    };
  }
  if (!doc.vigente) {
    return {
      resposta: responder({
        error: "Hi ha una versió més nova d'aquest document: demana un enllaç nou.",
        code: "versio_substituida",
      }, 409),
    };
  }
  const part = await partSignant(supabase, doc.id);
  if (!part || !part.admet_canvas) {
    return {
      resposta: responder({
        error: "Aquest document ara mateix no es pot signar.",
        code: "no_signable",
      }, 409),
    };
  }
  return { doc, part };
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function getDocument(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  enlace: Enlace,
  ip: string,
  t0: number,
): Promise<Response> {
  const r = await comprovar(supabase, responder, enlace);
  if ("resposta" in r) return r.resposta;
  const { doc, part } = r;

  // La apertura, ANTES de responder: prueba de que el enlace llegó y se abrió aunque no se
  // firme. La IP y el user-agent se guardan aquí, no en el papel.
  await supabase.from("evidencias").insert({
    enlace_id: enlace.id,
    tipo: "apertura",
    nombre: enlace.destinatario_nombre,
    ip: ip || null,
    user_agent: req.headers.get("user-agent"),
    payload: { documento: doc.id, tipus: doc.tipo, numero: doc.numero_completo, versio: doc.version },
  });
  if (!enlace.abierto_at) {
    await supabase.from("enlaces_token").update({ abierto_at: new Date().toISOString() })
      .eq("id", enlace.id);
  }

  const idioma = idiomaDe(doc.idioma);
  const codi = codiVerificacio(doc.sha256_datos);
  const [org, signant, pdfUrl] = await Promise.all([
    nomOrganitzacio(supabase, part),
    signantPrevist(supabase, part, enlace),
    doc.fichero_at ? urlRutaFirmada(supabase, doc.ruta) : Promise.resolve(null),
  ]);
  const numero = doc.numero_completo ?? "";

  const cuerpo = {
    proposito: enlace.proposito,
    estado_efectivo: enlace.estado_efectivo,
    estado: enlace.estado_efectivo,
    caduca_at: enlace.caduca_at,
    canal: enlace.canal,
    destinatari: enlace.destinatario_nombre,
    tipus: doc.tipo,
    numero,
    part: part.part,
    idioma,
    modo: doc.modo,
    organitzacio: { nom: org },
    codi_verificacio: codi,
    // Lo que hay que devolver al firmar: la huella del documento que se está leyendo.
    sha256_texto: doc.sha256_datos,
    text_acta: textActa(idioma, doc.tipo, numero, org, codi),
    pdf_url: pdfUrl,
    pdf_caduca_en: SEGUNDOS_FIRMA,
    assistida: enlace.canal === "asistido",
    signant,
    documento: {
      id: doc.id,
      tipo: doc.tipo,
      numero,
      numero_completo: numero,
      version: doc.version,
      idioma,
      modo: doc.modo,
    },
    formulari: {
      accions: ["firmar_document"],
      camps: ["nombre", "cargo", "documento_identidad", "declaracio_representacio", "signatura_base64"],
      minims: { nombre: MIN_NOM, cargo: MIN_CARREC, documento_identidad: MIN_DNI },
      max_bytes_signatura: MAX_BYTES_TRAZO,
    },
  };

  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "GET",
    proposit: "firma_document",
    enlace: enlace.id,
    documento: doc.id,
    tipus: doc.tipo,
    canal: enlace.canal,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));
  return responder(cuerpo, 200);
}

/** La carpeta de evidencias del objeto del documento, decidida por SQL. */
async function rutaTrazo(supabase: Cliente, doc: DocumentFirmable, enlaceId: string): Promise<string> {
  const { data, error } = await supabase.rpc("ruta_documento", {
    p_objeto_tipo: doc.objeto_tipo,
    p_objeto_id: doc.objeto_id,
    p_tipo: "evidencies",
    p_numero_completo: enlaceId,
    p_version: 1,
    p_modo: doc.modo === "prueba" ? "prueba" : "real",
    p_ejercicio: doc.ejercicio ?? new Date().getFullYear(),
  });
  if (error) throw new Error(error.message);
  const completa = String(data ?? "");
  const carpeta = completa.slice(0, completa.lastIndexOf("/") + 1);
  if (!carpeta) throw new Error("ruta_documento() no ha devuelto ninguna carpeta");
  return `${carpeta}${enlaceId}.png`;
}

/** El código de negocio que SQL pone delante del mensaje (`ja_signat: …`). */
function prefixError(missatge: string): string {
  const m = (missatge ?? "").match(/^([a-z_]+):/);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// POST `accion: 'firmar_document'`
// ---------------------------------------------------------------------------
export async function firmarDocument(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  body: Record<string, unknown>,
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
  if (enlace.proposito !== "firma_document") {
    return responder(
      { error: "Aquest enllaç no serveix per signar un document.", code: "proposit_incorrecte" },
      409,
    );
  }

  // ------------------------------------------------------------- validación
  // Aquí ADEMÁS de en la RPC: un 400 con el campo señalado es accionable desde el
  // formulario; el 22023 de la base, no.
  const nombre = textNet(body.nombre) || textNet(body.nom);
  if (nombre.length < MIN_NOM || nombre.length > MAX_CAMP) {
    return responder({ error: "Cal el nom de qui signa.", code: "dades_invalides", camp: "nombre" }, 400);
  }
  const cargo = textNet(body.cargo) || textNet(body.carrec);
  if (cargo.length < MIN_CARREC || cargo.length > MAX_CAMP) {
    return responder({ error: "Cal el càrrec de qui signa.", code: "dades_invalides", camp: "cargo" }, 400);
  }
  const dni = textNet(body.documento_identidad) || textNet(body.document_identitat);
  if (dni.length < MIN_DNI || dni.length > MAX_DNI) {
    return responder(
      { error: "Cal el document d'identitat de qui signa.", code: "dades_invalides", camp: "documento_identidad" },
      400,
    );
  }
  if (body.declaracio_representacio !== true && body.declaracion_representacion !== true) {
    return responder(
      {
        error: "Cal declarar que tens poders per signar en nom de l'organització.",
        code: "dades_invalides",
        camp: "declaracio_representacio",
      },
      400,
    );
  }
  const shaCliente = textNet(body.sha256_texto).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(shaCliente)) {
    return responder(
      { error: "Torna a carregar la pàgina abans de signar.", code: "dades_invalides", camp: "sha256_texto" },
      400,
    );
  }

  const base64 = typeof body.signatura_base64 === "string" ? body.signatura_base64 : "";
  if (!base64) {
    return responder(
      { error: "Falta el traç de la signatura.", code: "dades_invalides", camp: "signatura_base64" },
      400,
    );
  }
  const { fichero: trazo, error: errTrazo } = decodificarBase64(base64, "image/png");
  if (!trazo || trazo.bytes.length === 0) {
    return responder(
      { error: "La signatura no s'ha pogut llegir.", code: errTrazo ?? "dades_invalides", camp: "signatura_base64" },
      400,
    );
  }
  if (trazo.bytes.length > MAX_BYTES_TRAZO) {
    return responder(
      { error: "El traç de la signatura és massa gran.", code: "massa_gran", bytes: trazo.bytes.length },
      413,
    );
  }
  const esPng = trazo.bytes.length > 8 && trazo.bytes[0] === 0x89 && trazo.bytes[1] === 0x50 &&
    trazo.bytes[2] === 0x4e && trazo.bytes[3] === 0x47;
  if (!esPng) {
    return responder({ error: "La signatura ha de ser un PNG.", code: "mime_no_acceptat" }, 415);
  }

  // ------------------------------------------------------ el documento, firmable
  const r = await comprovar(supabase, responder, enlace);
  if ("resposta" in r) return r.resposta;
  const { doc } = r;

  // La huella de lo leído contra la del documento del enlace (la impresa).
  if (shaCliente !== (doc.sha256_datos ?? "").toLowerCase()) {
    return responder(
      {
        error: "El document ha canviat des que vas obrir l'enllaç. Torna a carregar la pàgina.",
        code: "document_canviat",
      },
      409,
    );
  }

  // ------------------------------------------------------------- el trazo, al bucket
  let ruta: string;
  try {
    ruta = await rutaTrazo(supabase, doc, enlace.id);
  } catch (e) {
    console.error("enlace-publico: ruta_documento (traç):", e instanceof Error ? e.message : String(e));
    return responder({ error: "No s'ha pogut desar la signatura.", code: "sense_carpeta" }, 409);
  }
  const { error: errSubida } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, trazo.bytes, { contentType: "image/png", upsert: true });
  if (errSubida) {
    console.error("enlace-publico: upload traç:", errSubida.message);
    return responder({ error: "No s'ha pogut desar la signatura.", code: "error_storage" }, 500);
  }

  // Quién acuñó el enlace: con `canal = 'panel'` es la propia persona que firma y va en
  // `payload.panell` (no en `asistido_por`, que significa «lo condujo el equipo»), igual
  // que en el convenio. Se lee de la fila, nunca del cuerpo.
  let asistidoPor: string | null = null;
  let panell: { user_id: string | null; email: string | null } | null = null;
  if (enlace.canal === "asistido" || enlace.canal === "panel") {
    const { data: fila } = await supabase
      .from("enlaces_token").select("id, canal, creado_por, destinatario_email").eq("id", enlace.id).maybeSingle();
    if (enlace.canal === "asistido") {
      asistidoPor = (fila?.creado_por as string | null) ?? null;
    } else {
      panell = {
        user_id: (fila?.creado_por as string | null) ?? null,
        email: (fila?.destinatario_email as string | null) ?? null,
      };
    }
  }

  const { data, error } = await supabase.rpc("signar_document_per_enllac", {
    p_enlace: enlace.id,
    p_evidencia: {
      nombre,
      cargo,
      documento_identidad: dni,
      declaracion_representacion: true,
      // La del documento (comprobada arriba contra la del cliente), no la del cliente.
      sha256_texto: doc.sha256_datos,
      trazo_firma_ruta: ruta,
      ip: ip || null,
      user_agent: req.headers.get("user-agent"),
      asistido_por: asistidoPor,
      payload: {
        documento: doc.id,
        tipus: doc.tipo,
        numero: doc.numero_completo,
        versio: doc.version,
        ...(panell ? { panell } : {}),
      },
    },
  });

  if (error) {
    // El PNG no significa nada sin su evidencia: se retira.
    await supabase.storage.from(BUCKET).remove([ruta]);
    const codigo = String(error.code ?? "");
    const missatge = String(error.message ?? "");
    if (codigo === "PT404") return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
    if (codigo === "PT409") {
      return responder({ error: "Aquest enllaç ja s'ha fet servir.", code: "ja_usat" }, 409);
    }
    if (codigo === "PT410") return responder({ error: "Aquest enllaç ha caducat.", code: "caducat" }, 410);
    if (codigo === "42501") {
      return responder({ error: "Aquest document no es pot signar des d'aquest enllaç.", code: "forbidden" }, 403);
    }
    if (codigo === "22023") {
      const pref = prefixError(missatge);
      if (["usa_firma_conveni", "no_signable", "versio_substituida", "ja_signat", "document_canviat"].includes(pref)) {
        return responder({ error: missatge, code: pref }, 409);
      }
      return responder({ error: missatge, code: "dades_invalides" }, 400);
    }
    console.error("enlace-publico: signar_document_per_enllac:", codigo, missatge);
    return responder({ error: "No s'ha pogut registrar la signatura.", code: "error_bd" }, 500);
  }

  const fila = (data ?? {}) as Record<string, unknown>;
  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "POST",
    accion: "firmar_document",
    enlace: enlace.id,
    documento: doc.id,
    document_signat: fila.document_signat_id ?? null,
    tipus: doc.tipo,
    canal: enlace.canal,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));

  return responder({
    ok: true,
    firma: { id: fila.firma_id ?? null, estat: fila.estat ?? "tancat" },
    document: {
      id: fila.document_signat_id ?? null,
      numero: fila.numero ?? doc.numero_completo,
      tipus: doc.tipo,
      version: fila.version ?? doc.version + 1,
    },
    // El PDF con el trazo lo genera `generar-documento` por el trigger: aquí no hay URL.
    pdf_pendent: true,
  }, 200);
}
