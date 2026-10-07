import { esEmailTest, modoTestActivo } from "../_shared/gate.ts";
import { escaparHtml, plantillaEmail, sendEmail } from "../_shared/resend.ts";
import { enmascararEmail } from "../_shared/enmascarar.ts";
// ⚠️ `_shared/pdf/convenio.ts` es PURO (solo importa `bloques.ts`): NO arrastra `pdf-lib`
//    a esta función, que es pública y cuyo arranque en frío se paga desde un móvil. Es
//    exactamente por eso que la parte de datos del convenio vive separada del
//    renderizador: el texto que se firma aquí y el que se imprime allí tienen que ser el
//    mismo, y la única forma de garantizarlo es que salgan del mismo módulo.
import {
  type DatosConvenio,
  diccionarioConvenio,
  idiomaConvenio,
  textoConvenioPla,
} from "../_shared/pdf/convenio.ts";
import {
  APP_URL,
  BUCKET,
  type Cliente,
  decodificarBase64,
  type Enlace,
  estadoAHttp,
  type Responder,
  resolver,
  sha256Hex,
  textNet,
} from "./comun.ts";

// ---------------------------------------------------------------------------
// FASE 2 — el enlace de firma del convenio
// ---------------------------------------------------------------------------
// Quien abre esto es la persona que **representa** a una organización: recibió un correo
// con `/signar/<token>` —o lo tiene delante en el móvil de un dinamizador, en la firma
// asistida— y va a obligar a su organización con un contrato. Es el acto más serio que
// esta función atiende, y de ahí las cuatro reglas que lo gobiernan:
//
//   1. **El texto que se firma lo compone el SERVIDOR**, con el mismo módulo que después
//      imprime el PDF (`_shared/pdf/convenio.ts`). La página está obligada a enseñarlo
//      literal. Si enseñara otra cosa, `evidencias.sha256_texto` describiría una
//      redacción y el archivo otra, y la firma dejaría de acreditar qué se firmó.
//   2. **La huella se recalcula aquí y nunca se acepta la del cliente.** Si la que manda
//      no coincide con la nuestra, el convenio o su plantilla cambiaron entre abrir y
//      firmar: 409 `document_canviat`, y a recargar. Aceptar su huella convertiría la
//      evidencia en una declaración suya, que es justo lo que no puede ser.
//   3. **Lo que la persona teclea sobre su organización NO entra en la huella.** Eso no
//      es texto aceptado, es información aportada: viaja en `evidencias.payload` y se
//      congela en `convenios.datos_org` (`firmar_convenio_por_enlace` solo rellena la
//      ficha donde estaba vacía). Si entrara, la huella cambiaría con cada tecla y el
//      guardia del punto 2 no podría distinguir un cambio real de la escritura del propio
//      formulario.
//   4. **Nada de esto lo decide la función.** El número, el estado, las evidencias y el
//      documento salen de `firmar_convenio_por_enlace()`, en una sola transacción. Aquí
//      solo se valida, se sube el PNG del trazo y se traduce el error.
//
// EL TRAZO DE LA FIRMA es un PNG en base64 que la página dibuja sobre un `<canvas>`. Se
// sube al bucket `documentos`, en la carpeta de la organización, **antes** de llamar a la
// RPC: la evidencia guarda su ruta y una evidencia que apunte a un fichero inexistente
// sería peor que no tener trazo. Si la RPC falla después, se borra.
//
// EL SEGUNDO FACTOR (`enviar_codi` / `validar_codi`) es solo de la **firma asistida**
// (§3.2.5): un código de 6 cifras por correo, 10 minutos, que separa «la persona estaba
// delante» de «alguien del equipo abrió el enlace». En un enlace enviado por correo no se
// ofrece —quien tiene el correo ya ha demostrado tener el correo— y pedirlo ahí solo
// serviría para dejar fuera a quien no lo reciba.

const MAX_BYTES_TRAZO = 1024 * 1024;
/** 10 minutos, los mismos que `iniciar_firma_asistida` (20270111100100). */
const MINUTOS_CODIGO = 10;

interface ConvenioPublico {
  id: string;
  tipo: string;
  tipo_org: string;
  productor_id: string | null;
  entidad_id: string | null;
  plantilla_id: string | null;
  idioma: string;
  numero_completo: string | null;
  ejercicio: number | null;
  estado: string;
  roles_com: string[] | null;
  datos_org: Record<string, unknown> | null;
  firmante: Record<string, unknown> | null;
}

interface PlantillaConvenio {
  id: string;
  titulo: string | null;
  cuerpo: unknown;
  version: number | null;
}

/** El año en curso **en Madrid**, que es el huso con el que numera la base. */
function ejercicioActual(): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric" })
      .format(new Date()),
  );
}

interface ConvenioCargado {
  conv: ConvenioPublico;
  plantilla: PlantillaConvenio | null;
  datos: DatosConvenio;
  texto: string;
}

/**
 * El convenio tal como hay que enseñarlo: la fila, su plantilla y el snapshot con la
 * MISMA forma que compone `convenio_emet_document()`, para que el texto que se enseña y
 * el que se imprime salgan del mismo mapeo de marcadores.
 *
 * La plantilla es la **congelada** en `convenios.plantilla_id`; solo si falta (un borrador
 * antiguo) se cae a la vigente del modelo y el idioma.
 */
async function cargarConvenio(
  supabase: Cliente,
  id: string,
): Promise<ConvenioCargado | null> {
  const { data, error } = await supabase
    .from("convenios")
    .select(
      "id, tipo, tipo_org, productor_id, entidad_id, plantilla_id, idioma, numero_completo, ejercicio, estado, roles_com, datos_org, firmante",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("enlace-publico: convenios:", error.message);
    throw new Error(error.message);
  }
  if (!data) return null;
  const conv = data as ConvenioPublico;

  let plantilla: PlantillaConvenio | null = null;
  if (conv.plantilla_id) {
    const { data: p } = await supabase
      .from("plantillas_documento")
      .select("id, tipo, variante, idioma, version, titulo, cuerpo, vigente")
      .eq("id", conv.plantilla_id)
      .maybeSingle();
    if (p) {
      plantilla = { id: p.id, titulo: p.titulo, cuerpo: p.cuerpo, version: p.version };
    }
  }
  if (!plantilla) {
    const { data: p } = await supabase
      .from("plantillas_documento")
      .select("id, tipo, variante, idioma, version, titulo, cuerpo, vigente")
      .eq("tipo", "CONV")
      .eq("variante", conv.tipo)
      .eq("idioma", conv.idioma)
      .eq("vigente", true)
      .maybeSingle();
    if (p) {
      plantilla = { id: p.id, titulo: p.titulo, cuerpo: p.cuerpo, version: p.version };
    }
  }

  const { data: par } = await supabase
    .from("parametros_documentales")
    .select(
      "id, razon_social, cif, domicilio, codigo_postal, poblacion, inscripcion, apoderada_nombre, apoderada_cargo, datos_provisionales",
    )
    .eq("id", 1)
    .maybeSingle();

  const datos: DatosConvenio = {
    tipus: conv.tipo,
    subtipus: "firmat",
    numero: conv.numero_completo,
    ejercici: conv.ejercicio,
    idioma: conv.idioma,
    roles_com: conv.roles_com ?? [],
    organitzacio: (conv.datos_org ?? {}) as DatosConvenio["organitzacio"],
    firmant: (conv.firmante ?? {}) as DatosConvenio["firmant"],
    firmat_at: null,
    fundacio: par
      ? {
        raso_social: par.razon_social,
        cif: par.cif,
        domicili: par.domicilio,
        codi_postal: par.codigo_postal,
        poblacio: par.poblacion,
        inscripcio: par.inscripcion,
        apoderada_nom: par.apoderada_nombre,
        apoderada_carrec: par.apoderada_cargo,
      }
      : null,
    dades_provisionals: par?.datos_provisionales ?? null,
    evidencies: [],
  };

  const lengua = idiomaConvenio(conv.idioma);
  const t = diccionarioConvenio(lengua);
  const texto = textoConvenioPla(datos, plantilla, t, lengua);
  return { conv, plantilla, datos, texto };
}

/** GET del enlace de firma: el convenio entero, para leerlo antes de firmarlo. */
export async function getConvenio(
  req: Request,
  supabase: Cliente,
  responder: Responder,
  enlace: Enlace,
  ip: string,
  t0: number,
): Promise<Response> {
  if (enlace.objeto_tipo !== "convenio") {
    return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  }
  const cargado = await cargarConvenio(supabase, enlace.objeto_id);
  if (!cargado) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const { conv, plantilla, datos, texto } = cargado;

  // Un convenio que ya no admite firma (firmado, vigente, resuelto) con un enlace todavía
  // vivo: pasa cuando se firma por otra vía. Se dice, y no se enseña un formulario que
  // fallaría al enviarlo.
  if (!["pendent_firma", "retornat"].includes(conv.estado)) {
    return responder({
      error: "Aquest conveni ja no admet signatura.",
      code: "ja_firmat",
      estado: conv.estado,
    }, 409);
  }

  // La apertura se registra ANTES de responder: es la prueba de que el enlace llegó y se
  // abrió aunque después no se firme nada.
  await supabase.from("evidencias").insert({
    enlace_id: enlace.id,
    tipo: "apertura",
    nombre: enlace.destinatario_nombre,
    ip: ip || null,
    user_agent: req.headers.get("user-agent"),
    payload: { conveni: conv.id, tipus: conv.tipo, estat: conv.estado },
  });
  if (!enlace.abierto_at) {
    await supabase.from("enlaces_token").update({ abierto_at: new Date().toISOString() })
      .eq("id", enlace.id);
  }

  const org = (conv.datos_org ?? {}) as Record<string, unknown>;
  const lengua = idiomaConvenio(conv.idioma);
  const t = diccionarioConvenio(lengua);
  const asistida = enlace.canal === "asistido";

  const cuerpo = {
    proposito: enlace.proposito,
    estado_efectivo: enlace.estado_efectivo,
    estado: enlace.estado_efectivo,
    caduca_at: enlace.caduca_at,
    destinatari: enlace.destinatario_nombre,
    documento: {
      id: conv.id,
      tipo: "CONV",
      variant: conv.tipo,
      // Un convenio sin firmar todavía NO tiene número: se pide al firmar, para no quemar
      // un correlativo de una serie legal en un borrador que nadie firma.
      numero: conv.numero_completo,
      numero_completo: conv.numero_completo,
      estado: conv.estado,
      idioma: conv.idioma,
      exercici: conv.ejercicio,
      roles_com: conv.roles_com ?? [],
      model: t.modelo[conv.tipo === "don_rec" || conv.tipo === "com" ? conv.tipo : "don_gen"],
      titol: plantilla?.titulo ?? null,
      plantilla_versio: plantilla?.version ?? null,
      organitzacio: org,
      fundacio: datos.fundacio,
    },
    // La página tiene que enseñar este texto TAL CUAL: su huella es lo que queda como
    // evidencia de qué se aceptó, y lo que hay que devolver en `sha256_texto` al firmar.
    text_conveni: texto,
    // Alias: la pantalla pública comparte el campo con la confirmación de albarán.
    text_confirmacio: texto,
    sha256_texto: await sha256Hex(texto),
    declaracions: {
      representacio: t.declaracio_representacio,
      acceptacio: t.declaracio_acceptacio,
    },
    // Lo que el formulario tiene que pedir, dicho por el servidor para que la pantalla no
    // se invente ni los campos ni los límites.
    formulari: {
      accions: asistida ? ["enviar_codi", "validar_codi", "firmar"] : ["firmar"],
      camps: [
        "raso_social", "nom_comercial", "nif", "domicili", "codi_postal", "poblacio",
        "representant", "carrec", "documento_identidad", "email",
      ],
      obligatoris: ["nif", "domicili", "representant", "carrec", "documento_identidad"],
      max_bytes_signatura: MAX_BYTES_TRAZO,
      assistida: asistida,
      // `tiene_codigo` dice si el enlace ya lleva un código pendiente de validar.
      cal_codi: asistida && enlace.tiene_codigo === true,
      codi_caduca_at: enlace.codigo_caduca_at,
      pot_demanar_codi: asistida && !!enlace.destinatario_email,
    },
  };

  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "GET",
    proposit: "firma_convenio",
    enlace: enlace.id,
    conveni: conv.id,
    tipus: conv.tipo,
    assistida: asistida,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));
  return responder(cuerpo, 200);
}

/** La carpeta de evidencias de este convenio, decidida por SQL (nunca compuesta aquí). */
async function rutaTrazo(
  supabase: Cliente,
  conv: ConvenioPublico,
  enlaceId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("ruta_documento", {
    p_objeto_tipo: "convenio",
    p_objeto_id: conv.id,
    p_tipo: "evidencies",
    p_numero_completo: enlaceId,
    p_version: 1,
    p_modo: "real",
    p_ejercicio: conv.ejercicio ?? ejercicioActual(),
  });
  if (error) throw new Error(error.message);
  const completa = String(data ?? "");
  const carpeta = completa.slice(0, completa.lastIndexOf("/") + 1);
  if (!carpeta) throw new Error("ruta_documento() no ha devuelto ninguna carpeta");
  return `${carpeta}${enlaceId}.png`;
}

/** POST `accion: 'firmar'`. */
export async function firmarConvenio(
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
  if (enlace.proposito !== "firma_convenio" || enlace.objeto_tipo !== "convenio") {
    return responder(
      { error: "Aquest enllaç no serveix per signar un conveni.", code: "proposit_incorrecte" },
      409,
    );
  }

  const cargado = await cargarConvenio(supabase, enlace.objeto_id);
  if (!cargado) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const { conv, texto } = cargado;

  // ------------------------------------------------------------- validación
  // Se valida aquí ADEMÁS de en la RPC: un 400 con el campo señalado es accionable desde
  // el formulario; el 22023 de la base, no.
  const nombre = textNet(body.nombre) || textNet(body.representant);
  if (nombre.length < 2 || nombre.length > 120) {
    return responder(
      { error: "Cal el nom de qui signa.", code: "dades_invalides", camp: "nombre" },
      400,
    );
  }
  const cargo = textNet(body.cargo) || textNet(body.carrec);
  if (cargo.length < 2 || cargo.length > 120) {
    return responder(
      { error: "Cal el càrrec de qui signa.", code: "dades_invalides", camp: "carrec" },
      400,
    );
  }
  const documento = textNet(body.documento_identidad) || textNet(body.document_identitat);
  if (documento.length < 5 || documento.length > 40) {
    return responder(
      {
        error: "Cal el document d'identitat de qui signa.",
        code: "dades_invalides",
        camp: "documento_identidad",
      },
      400,
    );
  }
  if (body.declaracio_representacio !== true && body.declaracion_representacion !== true) {
    return responder(
      {
        error: "Cal declarar que tens poders per representar l'organització.",
        code: "falta_declaracio",
        camp: "declaracio_representacio",
      },
      400,
    );
  }
  if (body.acceptacio !== true && body.acceptacion !== true) {
    return responder(
      { error: "Cal acceptar el text del conveni.", code: "falta_acceptacio", camp: "acceptacio" },
      400,
    );
  }

  // El trazo: PNG en base64, obligatorio. Una firma electrónica simple sin el gesto que
  // la persona hizo se queda en un formulario enviado.
  const base64 = typeof body.signatura_base64 === "string" ? body.signatura_base64 : "";
  if (!base64) {
    return responder(
      { error: "Falta el traç de la signatura.", code: "falta_signatura", camp: "signatura_base64" },
      400,
    );
  }
  const { fichero: trazo, error: errTrazo } = decodificarBase64(base64, "image/png");
  if (!trazo || trazo.bytes.length === 0) {
    return responder({ error: "La signatura no s'ha pogut llegir.", code: errTrazo ?? "cos_invalid" }, 400);
  }
  if (trazo.bytes.length > MAX_BYTES_TRAZO) {
    return responder(
      { error: "El traç de la signatura és massa gran.", code: "massa_gran", bytes: trazo.bytes.length },
      413,
    );
  }
  // Firma del formato, no el `content-type` declarado: el bucket solo acepta PNG y un
  // JPEG con la etiqueta cambiada lo rechazaría Storage con un error que no diría nada.
  const esPng = trazo.bytes.length > 8 && trazo.bytes[0] === 0x89 && trazo.bytes[1] === 0x50 &&
    trazo.bytes[2] === 0x4e && trazo.bytes[3] === 0x47;
  if (!esPng) {
    return responder(
      { error: "La signatura ha de ser un PNG.", code: "mime_no_acceptat", mime: trazo.mime },
      415,
    );
  }

  // --------------------------------------------------- la huella de lo aceptado
  const shaTexto = await sha256Hex(texto);
  const shaCliente = textNet(body.sha256_texto);
  if (shaCliente && shaCliente !== shaTexto) {
    return responder(
      {
        error: "El conveni ha canviat des que vas obrir l'enllaç. Torna a carregar la pàgina.",
        code: "document_canviat",
      },
      409,
    );
  }

  // ------------------------------------------------------------- el trazo, al bucket
  let ruta: string;
  try {
    ruta = await rutaTrazo(supabase, conv, enlace.id);
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

  // ------------------------------------------------------------------ la firma
  // Quién conduce una firma asistida: la cuenta del equipo que creó el enlace. No puede
  // salir del cuerpo de la petición —quien firma no tiene sesión y podría escribir
  // cualquier uuid—, así que se lee de la fila.
  //
  // Con `canal = 'panel'` (20270318100000) la cuenta que acuñó el enlace es la de quien
  // firma, no la de un dinamizador, así que NO va en `asistido_por` —esa columna significa
  // «alguien del equipo condujo la firma» y decir eso de una firma propia sería falso—.
  // Va en `payload.panell`, dentro de la evidencia: `firmar_convenio_por_enlace()` compone
  // `datos_org` con claves explícitas, así que una clave de más en `p_datos` acaba solo en
  // `evidencias.payload` y no contamina el snapshot del documento.
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

  const datosOrg = {
    raso_social: textNet(body.raso_social) || null,
    nom_comercial: textNet(body.nom_comercial) || null,
    nif: textNet(body.nif) || null,
    domicili: textNet(body.domicili) || null,
    codi_postal: textNet(body.codi_postal) || null,
    poblacio: textNet(body.poblacio) || null,
    representant: nombre,
    carrec: cargo,
    email: textNet(body.email) || null,
    // Solo cuando se ha firmado desde el panel; ver la nota de arriba.
    ...(panell ? { panell } : {}),
  };

  const { data, error } = await supabase.rpc("firmar_convenio_por_enlace", {
    p_enlace: enlace.id,
    p_datos: datosOrg,
    p_evidencia: {
      nombre,
      cargo,
      documento_identidad: documento,
      declaracion_representacion: true,
      trazo_firma_ruta: ruta,
      ip: ip || null,
      user_agent: req.headers.get("user-agent"),
      // Del servidor, siempre (regla 2 de la cabecera de esta sección).
      sha256_texto: shaTexto,
      asistido_por: asistidoPor,
    },
  });

  if (error) {
    // El PNG subido no significa nada sin su evidencia: se retira.
    await supabase.storage.from(BUCKET).remove([ruta]);
    const codigo = String(error.code ?? "");
    if (codigo === "PT404") return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
    if (codigo === "PT409") {
      return responder(
        { error: "Aquest conveni ja s'ha signat o l'enllaç ja s'ha fet servir.", code: "ja_usat" },
        409,
      );
    }
    if (codigo === "PT410") {
      return responder({ error: "Aquest enllaç ha caducat.", code: "caducat" }, 410);
    }
    if (codigo === "PT403") {
      return responder(
        {
          error: "Cal validar el codi de 6 xifres abans de signar.",
          code: "cal_codi",
        },
        403,
      );
    }
    if (codigo === "22023") {
      return responder({ error: error.message, code: "dades_invalides" }, 400);
    }
    console.error("enlace-publico: firmar_convenio_por_enlace:", codigo, error.message);
    return responder({ error: "No s'ha pogut registrar la signatura.", code: "error_bd" }, 500);
  }

  const fila = (data ?? {}) as Record<string, unknown>;
  const avisos = await avisarFirma(
    supabase,
    conv,
    String(fila.numero_completo ?? ""),
    { nombre, cargo, email: datosOrg.email },
  );

  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "POST",
    accion: "firmar",
    enlace: enlace.id,
    conveni: conv.id,
    numero: fila.numero_completo ?? null,
    assistida: enlace.canal === "asistido",
    avisats: avisos.enviados.length,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));

  return responder({
    ok: true,
    conveni: {
      id: conv.id,
      numero: fila.numero_completo ?? null,
      estat: fila.estado ?? "firmat",
      firmat_at: fila.firmado_at ?? null,
    },
    // El PDF se genera de forma asíncrona (lo dispara el trigger de `documentos`), así
    // que aquí no hay URL que dar: se dice, en vez de enseñar un enlace roto.
    pdf_pendent: true,
  }, 200);
}

/**
 * Aviso AL EQUIPO de que hay un convenio firmado: la contrafirma es un acto humano que
 * alguien tiene que hacer (§3.2.4, paso 6).
 *
 * ⚠️ Solo al equipo desde el 28-09-2026. A quien firma le llega su copia en PDF con
 * `generar-documento` (deuda §12.129), que ya le dice que falta la contrasignatura; un aviso
 * aquí además sería el mismo mensaje dos veces. Hasta ese día se le mandaba este correo, y
 * con un botón a `/equip/convenis`, que es una pantalla del equipo.
 *
 * El buzón del equipo recibe siempre, igual que en `avisarRechazo`: lo configuró a mano el
 * super_admin.
 */
async function avisarFirma(
  supabase: Cliente,
  conv: ConvenioPublico,
  numero: string,
  firmante: { nombre: string; cargo: string; email: string | null },
): Promise<{ enviados: string[]; saltados: string[] }> {
  const enviados: string[] = [];
  const saltados: string[] = [];
  try {
    const org = (conv.datos_org ?? {}) as Record<string, unknown>;
    const nombreOrg = String(org.raso_social ?? org.nom ?? "");

    const { data: params } = await supabase
      .from("parametros_documentales").select("id, email_equipo").eq("id", 1).maybeSingle();
    const emailEquipo = (params?.email_equipo ?? "").trim();
    if (!emailEquipo) return { enviados, saltados };

    const html = plantillaEmail({
      titulo: "Conveni signat",
      preheader: `${numero} · ${nombreOrg}`.slice(0, 120),
      cuerpoHtml: `
      <p>S'ha signat el conveni <strong>${escaparHtml(numero)}</strong> de
      <strong>${escaparHtml(nombreOrg)}</strong>.</p>
      <p>L'ha signat ${escaparHtml(firmante.nombre)}${
      firmante.cargo ? `, ${escaparHtml(firmante.cargo)}` : ""
    }.</p>
      <p>Queda <strong>pendent de contrasignatura</strong>: valida'l des de la cua d'aprovacions.</p>`,
      boton: { texto: "Contrasigna'l", url: `${APP_URL}/equip/aprovacions` },
      nota: "Aquest avís arriba a la bústia de l'equip de Redestina cada vegada que una organització signa un conveni.",
    });

    const r = await sendEmail({ to: emailEquipo, subject: `Redestina · conveni signat ${numero}`, html }, {
      supabase,
      proposito: "avis_firma",
      objetoTipo: "convenio",
      objetoId: conv.id,
      funcion: "enlace-publico",
    });
    if (r.ok) enviados.push(emailEquipo);
    else {
      saltados.push(emailEquipo);
      console.error("enlace-publico: aviso de firma no enviado a", enmascararEmail(emailEquipo), r.status, r.data);
    }
  } catch (e) {
    console.error("enlace-publico: avisarFirma:", e instanceof Error ? e.message : String(e));
  }
  return { enviados, saltados };
}

/**
 * POST `accion: 'enviar_codi'` — el segundo factor de la firma asistida.
 *
 * ⚠️ GENERA UN CÓDIGO NUEVO, no reenvía el anterior. El que creó `iniciar_firma_asistida`
 *    solo existió una vez, en la respuesta de esa RPC: en la base vive su sha256, igual
 *    que el token. Así que «reenviar» es necesariamente «emitir otro», y el anterior deja
 *    de valer en el mismo instante.
 *
 * ⚠️ SOLO EN ENLACES ASISTIDOS. En uno enviado por correo, poner un código haría falta
 *    validarlo para poder firmar (`firmar_convenio_por_enlace` lo exige en cuanto existe
 *    `codigo_hash`), o sea que una petición desde el navegador podría dejar bloqueado a
 *    quien iba a firmar. Se responde 409 y no se toca nada.
 */
export async function enviarCodi(
  supabase: Cliente,
  responder: Responder,
  body: Record<string, unknown>,
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
  if (enlace.proposito !== "firma_convenio" || enlace.objeto_tipo !== "convenio") {
    return responder({ error: "Aquest enllaç no demana cap codi.", code: "proposit_incorrecte" }, 409);
  }
  if (enlace.canal !== "asistido") {
    return responder(
      { error: "Aquest enllaç no necessita codi.", code: "no_cal_codi" },
      409,
    );
  }
  const destinatario = (enlace.destinatario_email ?? "").trim();
  if (!destinatario) {
    // §3.2.5: sin correo no hay segundo factor, y no se finge. La firma asistida sigue
    // siendo posible; lo que queda como evidencia es `asistido_por` y nada más.
    return responder(
      {
        error: "Aquesta organització no té correu: la signatura assistida es fa sense codi.",
        code: "sense_correu",
      },
      409,
    );
  }

  // Gate de test (§8): con el modo test activo, solo a organizaciones de prueba.
  if (await modoTestActivo(supabase)) {
    if (!(await esEmailTest(supabase, destinatario))) {
      return responder(
        { error: "En mode de proves no es pot enviar el codi a aquesta adreça.", code: "no_test_user" },
        403,
      );
    }
  }

  // 6 cifras con el generador criptográfico del runtime; en la base, solo su sha256.
  const codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const caduca = new Date(Date.now() + MINUTOS_CODIGO * 60 * 1000).toISOString();

  // ⚠️ SE MANDA ANTES DE ESCRIBIR EL HASH, y el orden importa. En cuanto `codigo_hash`
  //    tiene valor, `firmar_convenio_por_enlace()` exige validarlo para poder firmar. Si
  //    se escribiera primero y el correo fallara, el enlace quedaría pidiendo un código
  //    que nadie tiene: alguien delante del móvil, sin poder firmar y sin poder arreglarlo.
  //    Al revés, el peor caso es un código que llega y no valida —y se pide otro—, que es
  //    un contratiempo y no un bloqueo.
  const envio = await sendEmail({
    to: destinatario,
    subject: `Redestina · codi per signar el conveni: ${codigo}`,
    html: plantillaEmail({
      titulo: "El teu codi per signar",
      preheader: `Codi ${codigo} · caduca en ${MINUTOS_CODIGO} minuts.`,
      cuerpoHtml: `
        <p>Aquest és el codi per confirmar la signatura del conveni:</p>
        <p style="font-size:30px;letter-spacing:6px;font-weight:700;margin:18px 0">${escaparHtml(codigo)}</p>
        <p>Caduca en ${MINUTOS_CODIGO} minuts i només es pot fer servir un cop.</p>`,
      nota:
        "Si no has demanat aquest codi, no facis res: sense ell la signatura no es pot completar.",
    }),
  }, {
    supabase,
    proposito: "codi_firma",
    objetoTipo: enlace.objeto_tipo,
    objetoId: enlace.objeto_id,
    funcion: "enlace-publico",
  });
  if (!envio.ok) {
    console.error("enlace-publico: codi no enviat:", envio.status, envio.data);
    return responder({ error: "No s'ha pogut enviar el codi.", code: "error_email" }, 502);
  }

  const { error: errUpdate } = await supabase
    .from("enlaces_token")
    .update({ codigo_hash: await sha256Hex(codigo), codigo_caduca_at: caduca })
    .eq("id", enlace.id);
  if (errUpdate) {
    // El correo ya ha salido: se dice que se reintente, que es lo que deja el enlace
    // utilizable (el código anterior, si lo había, sigue siendo el bueno).
    console.error("enlace-publico: update codigo:", errUpdate.message);
    return responder(
      { error: "El codi s'ha enviat però no s'ha pogut desar. Demana'n un altre.", code: "error_bd" },
      500,
    );
  }

  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "POST",
    accion: "enviar_codi",
    enlace: enlace.id,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));
  // El correo NO se devuelve entero: quien tiene el token no tiene por qué saber a qué
  // dirección va. Basta con el dominio para que la persona sepa dónde mirar.
  const dominio = destinatario.slice(destinatario.indexOf("@"));
  return responder({ ok: true, enviat: true, destinatari: `···${dominio}`, caduca_at: caduca }, 200);
}

/**
 * POST `accion: 'validar_codi'`. La comparación la hace `validar_codi_firma()` DENTRO de
 * la base: el hash no sale de ahí. Un intento fallido también deja evidencia, a propósito
 * —borrarlo dejaría la firma peor documentada, no mejor—.
 *
 * Fuerza bruta: 6 cifras son un millón de combinaciones, pero cada intento escribe una
 * evidencia y el freno durable de esta función corta a las 50 de la última hora. Con eso,
 * agotar el espacio pide dos mil años.
 */
export async function validarCodi(
  supabase: Cliente,
  responder: Responder,
  body: Record<string, unknown>,
  t0: number,
): Promise<Response> {
  const token = textNet(body.t);
  if (!token) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const codigo = textNet(body.codi) || textNet(body.codigo);
  if (!/^\d{6}$/.test(codigo)) {
    return responder(
      { error: "El codi ha de tenir 6 xifres.", code: "dades_invalides", camp: "codi" },
      400,
    );
  }

  const enlace = await resolver(supabase, token);
  if (!enlace) return responder({ error: "Enllaç desconegut.", code: "desconegut" }, 404);
  const malestado = estadoAHttp(enlace.estado_efectivo);
  if (malestado) {
    return responder({ error: malestado.error, code: malestado.code }, malestado.status);
  }
  if (enlace.proposito !== "firma_convenio") {
    return responder({ error: "Aquest enllaç no demana cap codi.", code: "proposit_incorrecte" }, 409);
  }

  const { data, error } = await supabase.rpc("validar_codi_firma", {
    p_enlace: enlace.id,
    p_codi: codigo,
  });
  if (error) {
    const cod = String(error.code ?? "");
    if (cod === "PT404") {
      return responder({ error: "Aquest enllaç no té cap codi.", code: "sense_codi" }, 404);
    }
    if (cod === "PT410") {
      return responder(
        { error: "El codi ha caducat: demana'n un de nou.", code: "codi_caducat" },
        410,
      );
    }
    console.error("enlace-publico: validar_codi_firma:", cod, error.message);
    return responder({ error: "No s'ha pogut validar el codi.", code: "error_bd" }, 500);
  }

  const valido = data === true;
  console.log(JSON.stringify({
    fn: "enlace-publico",
    metodo: "POST",
    accion: "validar_codi",
    enlace: enlace.id,
    valid: valido,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));
  return responder(
    valido
      ? { ok: true, valid: true }
      : { ok: true, valid: false, code: "codi_incorrecte", error: "El codi no és correcte." },
    200,
  );
}
