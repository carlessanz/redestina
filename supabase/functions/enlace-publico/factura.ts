import {
  BUCKET,
  type Cliente,
  type Enlace,
  estadoAHttp,
  type FicheroSubido,
  numeroOpcional,
  type Responder,
  resolver,
  SEGUNDOS_FIRMA,
  textNet,
  urlPdf,
} from "./comun.ts";

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
export async function getFactura(
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
    // Mismo motivo que en el albarán: el formulario lo dice antes de que se suba nada.
    assistida: enlace.canal === "asistido",
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

/**
 * POST `accion: 'subir_factura'`. Devuelve el estado que ha decidido `registrar_factura()`,
 * que es lo único que la pantalla tiene que enseñar: cuadra, no cuadra, o falta la cifra.
 */
export async function subirFactura(
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
  // `ruta_documento_externo()` devuelve la ruta ENTERA (20270304100000). Antes aquí se pedía
  // la de un documento emitido con un número inventado y se le cambiaba la hoja a mano —el
  // mismo apaño que en `subir-documento-externo`, y este segundo sitio no estaba anotado en
  // la deuda §12.62—.
  let ruta: string;
  try {
    const { data, error } = await supabase.rpc("ruta_documento_externo", {
      p_objeto_tipo: "cierre_donante",
      p_objeto_id: cd.id,
      p_tipo: "factura",
      p_ejercicio: cierre.ejercicio ?? new Date().getFullYear(),
      p_extension: extension,
      p_modo: cierre.modo,
    });
    if (error) throw new Error(error.message);
    ruta = String(data ?? "");
    if (!ruta) throw new Error("ruta_documento_externo() no ha devuelto ninguna ruta");
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e);
    console.error("enlace-publico: ruta_documento_externo:", texto);
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

  // ⚠️ Esta evidencia se inserta DIRECTAMENTE, sin pasar por ninguna RPC, así que aquí
  //    `asistido_por` lo compone esta función y no SQL —al revés que en la confirmación
  //    del albarán—. La regla es la misma y no se puede relajar: solo con `canal =
  //    'asistido'`, y leyendo la cuenta de la fila del enlace, nunca del cuerpo de la
  //    petición. Quien sube la factura no tiene sesión y podría mandar cualquier uuid.
  let asistidoPor: string | null = null;
  if (enlace.canal === "asistido") {
    const { data: fila } = await supabase
      .from("enlaces_token").select("id, creado_por").eq("id", enlace.id).maybeSingle();
    asistidoPor = (fila?.creado_por as string | null) ?? null;
  }

  // La evidencia de la subida. Va DESPUÉS del registro a propósito: lo que se prueba es
  // que la factura entró, y si el registro falla no ha entrado nada.
  await supabase.from("evidencias").insert({
    enlace_id: enlace.id,
    tipo: "subida",
    nombre: textNet(body.nombre).slice(0, 120) || enlace.destinatario_nombre,
    ip: ip || null,
    user_agent: req.headers.get("user-agent"),
    asistido_por: asistidoPor,
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
