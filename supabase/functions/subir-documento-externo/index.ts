// Subida de un documento que aporta otro (albarán del productor, factura, foto).
//
//   POST /subir-documento-externo   multipart/form-data   (JWT de la sesión)
//     fitxer       (File)   pdf, jpg o png, hasta 10 MB
//     objeto_tipo  'albaran' | 'cierre_donante'
//     objeto_id    uuid
//     tipo         'albaran_productor' | 'factura' | 'foto_incidencia' | 'altre'
//     numero?      número del documento AJENO, tal como viene impreso
//     fecha?       AAAA-MM-DD del documento ajeno
//   -> { id, ruta, sha256, bytes, mime, nombre }
//
// POR QUÉ ESTA FUNCIÓN Y NO UNA POLÍTICA DE STORAGE. `20260928100600` deja los dos
// buckets **sin una sola política sobre `storage.objects`**, y es deliberado: dejar que
// el navegador escriba en el bucket obliga a expresar en una política de Storage tres
// cosas que una política no sabe decir —qué MIME acepta, cuánto pesa como máximo y en
// qué carpeta puede escribir cada organización—. Aquí sí se pueden decir las tres, y
// además queda la fila de `documentos_externos`, que es lo que hace que el fichero
// signifique algo. Un objeto en el bucket sin su fila no lo ve nadie.
//
// LA RUTA LA DECIDE SQL. `ruta_documento()` sabe de quién es la carpeta —la de la
// organización que aporta el fichero (§B.3)— y esta función no compone ninguna: pide la
// carpeta y le pega el nombre del fichero. Es la misma regla que en `generar-documento`
// («se sube exactamente a `documentos.ruta`») y por el mismo motivo: quien decide en qué
// carpeta acaba un dato personal es la base, no un `+` de TypeScript.
//
// La función concreta es `ruta_documento_externo()` (20270304100000) y no `ruta_documento()`:
// esta última está pensada para un documento EMITIDO y termina siempre en `<numero>-v<n>.pdf`,
// que un externo no tiene —ni número de serie nuestro, ni versión, y puede ser un JPG—.
// Devuelve la ruta ENTERA, carpeta y nombre, así que aquí no se compone ni se recorta ninguna
// cadena: antes se pedía la ruta con un número FALSO y se le cambiaba la hoja a mano (§12.62).
//
// QUIÉN PUEDE SUBIR: el equipo, o el titular del objeto. Se pregunta con **una sola
// llamada**, `puc_pujar_document_extern(objeto_tipo, objeto_id, user)` (20261109100400),
// que responde sí/no y sabe de los dos tipos de objeto —y sabrá de `convenio` y `plan` sin
// que esta función se entere—. No se reimplementa la regla aquí: se consulta, y se consulta
// al mismo sitio del que sale lo que se puede leer, para que subir y ver no discrepen.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { contextoUsuario } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

const BUCKET = "documentos";
const MAX_BYTES = 10 * 1024 * 1024;

/** Los tres formatos del circuito (los mismos que acepta el bucket, 20260928100600). */
const MIMES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

const OBJETOS = ["albaran", "cierre_donante"];
const TIPOS = ["albaran_productor", "factura", "foto_incidencia", "altre"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function textNet(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copia = new Uint8Array(bytes.length);
  copia.set(bytes);
  const resumen = await crypto.subtle.digest("SHA-256", copia.buffer);
  return Array.from(new Uint8Array(resumen))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * La ruta entera, decidida en SQL. Si no se puede resolver el propietario del objeto,
 * `ruta_documento_externo()` levanta `0A000` y esta función lo convierte en un 409: no se
 * sube nada a una carpeta inventada. El `tipo` y la extensión los valida también SQL, que es
 * quien está componiendo un camino.
 */
async function rutaExterno(
  supabase: Cliente,
  objetoTipo: string,
  objetoId: string,
  tipo: string,
  ejercicio: number,
  extension: string,
  modo = "real",
): Promise<string> {
  const { data, error } = await supabase.rpc("ruta_documento_externo", {
    p_objeto_tipo: objetoTipo,
    p_objeto_id: objetoId,
    p_tipo: tipo,
    p_ejercicio: ejercicio,
    p_extension: extension,
    p_modo: modo,
  });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const ruta = String(data ?? "");
  if (!ruta) throw new Error("ruta_documento_externo() no ha devuelto ninguna ruta");
  return ruta;
}

Deno.serve(async (req) => {
  const t0 = performance.now();
  const cors = corsPara(req);
  const responder = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  // `service_role` ignora RLS (§4bis): la autorización propia es obligatoria, no un extra.
  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) {
    return responder({ error: "Necessites iniciar sessió", code: "unauthorized" }, 401);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return responder(
      { error: "S'esperava multipart/form-data", code: "cos_invalid" },
      400,
    );
  }

  const objetoTipo = textNet(form.get("objeto_tipo"));
  const objetoId = textNet(form.get("objeto_id"));
  const tipo = textNet(form.get("tipo"));
  const numero = textNet(form.get("numero")).slice(0, 80) || null;
  const fecha = textNet(form.get("fecha")) || null;

  if (!OBJETOS.includes(objetoTipo)) {
    return responder({ error: "Objecte no vàlid", code: "dades_invalides", camp: "objeto_tipo" }, 400);
  }
  if (!UUID.test(objetoId)) {
    return responder({ error: "Identificador no vàlid", code: "dades_invalides", camp: "objeto_id" }, 400);
  }
  if (!TIPOS.includes(tipo)) {
    return responder({ error: "Tipus no vàlid", code: "dades_invalides", camp: "tipo" }, 400);
  }
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return responder({ error: "La data no és vàlida", code: "dades_invalides", camp: "fecha" }, 400);
  }

  const fichero = form.get("fitxer") ?? form.get("fichero") ?? form.get("file");
  if (!(fichero instanceof File)) {
    return responder({ error: "Falta el fitxer", code: "falta_fitxer" }, 400);
  }
  // El tamaño se mira ANTES de leer los bytes: `arrayBuffer()` de un fichero de 200 MB
  // se los trae a memoria antes de que nadie pueda decir que no.
  if (fichero.size > MAX_BYTES) {
    return responder(
      { error: "El fitxer no pot passar de 10 MB", code: "massa_gran", bytes: fichero.size },
      413,
    );
  }
  if (fichero.size === 0) {
    return responder({ error: "El fitxer és buit", code: "fitxer_buit" }, 400);
  }
  const mime = (fichero.type || "").toLowerCase();
  const extension = MIMES[mime];
  if (!extension) {
    return responder(
      { error: "Només s'accepten PDF, JPG i PNG", code: "mime_no_acceptat", mime },
      415,
    );
  }

  // ---------------------------------------------------------------- permiso
  // Una pregunta, con la misma respuesta que daría un `select` desde el navegador. Se
  // hace también para el equipo: la función ya sabe que el equipo puede, y así no hay dos
  // caminos que un día puedan decir cosas distintas.
  {
    const { data, error } = await supabase.rpc("puc_pujar_document_extern", {
      p_objeto_tipo: objetoTipo,
      p_objeto_id: objetoId,
      p_user: ctx.userId,
    });
    if (error) {
      console.error("subir-documento-externo: puc_pujar_document_extern:", error.message);
      return responder({ error: "Error comprovant permisos", code: "error_bd" }, 500);
    }
    if (data !== true) {
      return responder(
        {
          error: objetoTipo === "albaran"
            ? "Aquest albarà no és teu"
            : "Aquest tancament no és teu",
          code: "forbidden",
        },
        403,
      );
    }
  }

  // El ejercicio decide la subcarpeta del año, y el MODO decide si cuelga de `proves/`.
  // Los dos se toman del acto documentado —no de hoy— y solo se cae al año actual si el
  // objeto todavía no lo tiene.
  //
  // ⚠️ El modo importa en el cierre y no en el albarán: una factura de un cierre de prueba
  //    tiene que archivarse bajo `proves/`, que es lo único que `reiniciar_cierre_prueba()`
  //    borra. Guardarla en la carpeta real dejaría un fichero de un ensayo mezclado con los
  //    documentos de verdad de esa organización, y ya no habría forma de distinguirlos.
  let ejercicio = new Date().getFullYear();
  let modo = "real";
  if (objetoTipo === "cierre_donante") {
    const { data: cd, error: errCd } = await supabase
      .from("cierres_donante")
      .select("id, cierre_id, estado")
      .eq("id", objetoId)
      .maybeSingle();
    if (errCd) {
      console.error("subir-documento-externo: cierres_donante:", errCd.message);
      return responder({ error: "Error consultant el tancament", code: "error_bd" }, 500);
    }
    if (!cd) return responder({ error: "Aquest tancament no existeix", code: "no_existeix" }, 404);
    const { data: ce } = await supabase
      .from("cierres_ejercicio")
      .select("id, ejercicio, modo, estado")
      .eq("id", cd.cierre_id)
      .maybeSingle();
    if (ce?.ejercicio) ejercicio = ce.ejercicio as number;
    if (ce?.modo === "prueba") modo = "prueba";
  }
  if (objetoTipo === "albaran") {
    const { data: alb, error: errAlb } = await supabase
      .from("albaranes")
      .select("id, ejercicio, numero_completo, estado")
      .eq("id", objetoId)
      .maybeSingle();
    if (errAlb) {
      console.error("subir-documento-externo: albaranes:", errAlb.message);
      return responder({ error: "Error consultant l'albarà", code: "error_bd" }, 500);
    }
    if (!alb) return responder({ error: "Aquest albarà no existeix", code: "no_existeix" }, 404);
    if (alb.ejercicio) ejercicio = alb.ejercicio as number;
  }

  // ------------------------------------------------------------------ subida
  const bytes = new Uint8Array(await fichero.arrayBuffer());
  // Doble comprobación del tamaño: `File.size` es lo que dice el cliente; esto es lo que
  // de verdad ha llegado.
  if (bytes.length > MAX_BYTES) {
    return responder(
      { error: "El fitxer no pot passar de 10 MB", code: "massa_gran", bytes: bytes.length },
      413,
    );
  }

  let ruta: string;
  try {
    ruta = await rutaExterno(supabase, objetoTipo, objetoId, tipo, ejercicio, extension, modo);
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e);
    console.error("subir-documento-externo: ruta_documento_externo:", texto);
    return responder(
      { error: "No s'ha pogut decidir on desar el fitxer", code: "sense_carpeta", detall: texto },
      409,
    );
  }

  const huella = await sha256(bytes);

  const { error: errSubida } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, bytes, { contentType: mime, upsert: false });
  if (errSubida) {
    console.error("subir-documento-externo: upload:", errSubida.message);
    return responder({ error: "No s'ha pogut desar el fitxer", code: "error_storage" }, 500);
  }

  const { data: fila, error: errFila } = await supabase
    .from("documentos_externos")
    .insert({
      objeto_tipo: objetoTipo,
      objeto_id: objetoId,
      tipo,
      numero,
      fecha,
      ruta,
      sha256: huella,
      mime,
      bytes: bytes.length,
      origen: "panel",
      subido_por: ctx.userId,
    })
    .select("id, ruta, sha256, mime, bytes, created_at")
    .single();

  if (errFila) {
    // Compensar: un objeto en el bucket sin su fila es un fichero que no ve nadie y que
    // nadie va a borrar nunca. Mismo criterio que la compensación de `registro`.
    console.error("subir-documento-externo: insert:", errFila.message);
    await supabase.storage.from(BUCKET).remove([ruta]);
    return responder({ error: "No s'ha pogut registrar el document", code: "error_bd" }, 500);
  }

  console.log(JSON.stringify({
    fn: "subir-documento-externo",
    objeto: `${objetoTipo}:${objetoId}`,
    tipo,
    mime,
    bytes: bytes.length,
    intern: ctx.esIntern,
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));

  return responder({
    id: fila.id,
    ruta: fila.ruta,
    sha256: fila.sha256,
    mime: fila.mime,
    bytes: fila.bytes,
    nombre: fichero.name,
  }, 201);
});
