// Descarga de un documento del bucket privado `documentos`.
//
//   POST /descargar-documento  { documento_id }          (JWT de la sesión)
//   -> { url, nombre, sha256_fichero, bytes, paginas, caduca_en }   url firmada, 60 s
//
//   POST /descargar-documento  { documento_extern_id }   (JWT de la sesión)
//   -> { url, nombre, sha256, bytes, mime, caduca_en }
//
//   POST /descargar-documento  { firma_document_id }     (JWT de la sesión, 05-11-2026)
//   -> { url, nombre, sha256, bytes, mime, caduca_en }
//   El fichero que alguien SUBIÓ firmado (`firmes_document.fitxer_ruta`, vías `pujat` y
//   `correu`), para revisarlo antes de cerrar la firma. Lo ve el equipo (`esIntern`) y la
//   persona titular de la organización que firma (`puc_signar_document`); una firma con
//   trazo no tiene fichero (`409 sense_fitxer`): su resultado es la versión `signat`.
//
// Una versión SUBIDA (la `signat` de las vías `pujat`/`correu`) puede ser un JPG o un PNG:
// el nombre y el `mime` de la respuesta salen de la extensión real de `ruta`, nunca se da
// por hecho `.pdf` (05-11-2026).
//
// Exactamente UNO de los tres. Son dos tablas distintas y dos autorizaciones distintas,
// pero el mismo bucket y la misma puerta: partirlo en dos funciones duplicaría el
// `contextoUsuario()`, el CORS y la firma de la URL, que es donde no conviene que dos
// copias se separen.
//
// ⚠️ UN EXTERNO NO ES UN DOCUMENTO EMITIDO, y por eso no comparte ni el tipo de fila ni
//    el nombre del fichero: no tiene `numero_completo` (su `numero` es el del documento
//    AJENO, tal como viene impreso), no tiene `version`, no tiene `fichero_at` —el fichero
//    llegó antes que la fila, no después— y **no siempre es un PDF**: puede ser un JPG o
//    un PNG. La extensión se deduce de su `mime`, nunca se da por hecha.
//
// El bucket es privado y **no tiene políticas para `authenticated`**: nadie llega a
// Storage por su cuenta. Esta es la única puerta, y hace dos comprobaciones que no
// son la misma:
//   1. `contextoUsuario()` — que haya sesión y que la cuenta siga activa. La función
//      corre con `service_role`, que ignora RLS (§4bis): sin esto, cualquiera con
//      sesión leería cualquier documento.
//   2. `puede_ver_documento(p_documento, p_user)` — que ESE usuario pueda ver ESE
//      documento. La regla vive en SQL, junto a la tabla, no aquí: la carpeta ordena,
//      la tabla autoriza. Se le pasa el `p_user` explícito porque con `service_role`
//      no hay `auth.uid()` que valga.
//
// La URL firmada dura 60 s: lo justo para que el navegador la siga. Un enlace que
// caduque en una hora es un enlace que se reenvía por WhatsApp.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { contextoUsuario } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { urlPublica } from "../_shared/url-publica.ts";
import { preflight, respondedor } from "../_shared/http.ts";

const BUCKET = "documentos";
const SEGUNDOS_FIRMA = 60;

interface FilaDocumento {
  id: string;
  tipo: string;
  numero_completo: string | null;
  version: number;
  ruta: string | null;
  sha256_fichero: string | null;
  bytes: number | null;
  paginas: number | null;
  estado: string;
  fichero_at: string | null;
}

interface FilaExterno {
  id: string;
  objeto_tipo: string;
  objeto_id: string;
  tipo: string;
  numero: string | null;
  fecha: string | null;
  ruta: string;
  sha256: string | null;
  mime: string | null;
  bytes: number | null;
}

/** Los tres formatos que acepta el bucket (20260928100600), del revés. */
const EXTENSION_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** Del revés: la extensión de la hoja de una ruta → su MIME. */
const MIME_POR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** La extensión real de una ruta (`…-signat-1a2b3c4d.jpg` → `jpg`); `pdf` si no se sabe. */
function extensionDe(ruta: string | null | undefined): string {
  const hoja = (ruta ?? "").split("/").pop() ?? "";
  const ext = hoja.includes(".") ? (hoja.split(".").pop() ?? "").toLowerCase() : "";
  if (ext === "jpeg") return "jpg";
  return ext in MIME_POR_EXTENSION ? ext : "pdf";
}

/** Nombre con el que se ofrece el fichero: el número del documento, no un uuid. */
function nombreFichero(doc: FilaDocumento): string {
  const ext = extensionDe(doc.ruta);
  if (doc.numero_completo) return `${doc.numero_completo}-v${doc.version}.${ext}`;
  const hoja = (doc.ruta ?? "").split("/").pop();
  return hoja && hoja.length > 0 ? hoja : `${doc.id}.${ext}`;
}

interface FilaFirma {
  id: string;
  documento_id: string;
  tipo_doc: string;
  via: string;
  estat: string;
  fitxer_ruta: string | null;
  fitxer_sha256: string | null;
  fitxer_mime: string | null;
  fitxer_bytes: number | null;
}

/**
 * Nombre de un externo: qué es, con qué número venía y en qué formato está.
 *
 * El `numero` es texto libre copiado de un papel ajeno («FAC 2023/118»), así que todo lo
 * que no sea letra, cifra, guion o punto se sustituye: una barra ahí la lee el navegador
 * como una carpeta y guarda el fichero con otro nombre, o directamente falla.
 *
 * La extensión sale del `mime`; si esa fila no lo trae, de la hoja de la ruta —que la
 * compuso `ruta_documento_externo()` con la extensión real—. Nunca se supone `.pdf`.
 */
function nombreExterno(doc: FilaExterno): string {
  const deLaRuta = (doc.ruta.split(".").pop() ?? "").toLowerCase().slice(0, 4);
  const ext = EXTENSION_POR_MIME[(doc.mime ?? "").toLowerCase()] ?? (deLaRuta || "bin");
  const numero = (doc.numero ?? "").trim().replace(/[^\p{L}\p{N}.-]+/gu, "-").slice(0, 80);
  return numero ? `${doc.tipo}-${numero}.${ext}` : `${doc.tipo}.${ext}`;
}

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) {
    return responder({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
  }

  let documentoId: string | null = null;
  let externoId: string | null = null;
  let firmaId: string | null = null;
  try {
    const cuerpo = await req.json();
    documentoId = typeof cuerpo?.documento_id === "string" ? cuerpo.documento_id : null;
    externoId = typeof cuerpo?.documento_extern_id === "string"
      ? cuerpo.documento_extern_id
      : null;
    firmaId = typeof cuerpo?.firma_document_id === "string" ? cuerpo.firma_document_id : null;
  } catch {
    return responder({ error: "Cuerpo JSON inválido", code: "cos_invalid" }, 400);
  }
  // Uno, y solo uno: con dos puestos habría que elegir cuál manda, y esa elección la
  // acabaría descubriendo alguien al recibir el fichero equivocado.
  if ([documentoId, externoId, firmaId].filter(Boolean).length > 1) {
    return responder(
      { error: "Envia 'documento_id', 'documento_extern_id' o 'firma_document_id', només un", code: "id_ambigu" },
      400,
    );
  }
  if (!documentoId && !externoId && !firmaId) {
    return responder({ error: "Falta 'documento_id'", code: "falta_id" }, 400);
  }

  // --------------------------------------------- fichero subido de una firma
  if (firmaId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(firmaId)) {
      return responder({ error: "No pots veure aquest document", code: "forbidden" }, 403);
    }
    const { data: dataFirma, error: errFirmaFila } = await supabase
      .from("firmes_document")
      .select("id, documento_id, tipo_doc, via, estat, fitxer_ruta, fitxer_sha256, fitxer_mime, fitxer_bytes")
      .eq("id", firmaId)
      .maybeSingle();
    if (errFirmaFila) {
      console.error("descargar-documento: firmes_document:", errFirmaFila.message);
      return responder({ error: "Error consultando el documento", code: "error_bd" }, 500);
    }
    const fila = dataFirma as FilaFirma | null;
    // Permiso: el equipo, o la titular de la organización que firma. Una firma que no
    // existe responde lo MISMO que una ajena (403): el permiso no filtra la existencia.
    let permitidoFirma = ctx.esIntern;
    if (!permitidoFirma && fila) {
      const { data: puc, error: errPuc } = await supabase.rpc("puc_signar_document", {
        p_documento: fila.documento_id,
        p_user: ctx.userId,
      });
      if (errPuc) {
        console.error("descargar-documento: puc_signar_document:", errPuc.message);
        return responder({ error: "Error comprobando permisos", code: "error_bd" }, 500);
      }
      permitidoFirma = puc === true;
    }
    if (!permitidoFirma) {
      return responder({ error: "No pots veure aquest document", code: "forbidden" }, 403);
    }
    if (!fila) return responder({ error: "Documento inexistente", code: "no_existeix" }, 404);
    if (!fila.fitxer_ruta) {
      // Firma con trazo: no hay fichero subido; lo firmado es la versión `signat`.
      return responder({ error: "Aquesta signatura no té cap fitxer pujat", code: "sense_fitxer" }, 409);
    }
    const { data: urlFirma, error: errUrl } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(fila.fitxer_ruta, SEGUNDOS_FIRMA);
    if (errUrl || !urlFirma?.signedUrl) {
      console.error("descargar-documento: createSignedUrl firma:", errUrl?.message ?? "sin url");
      return responder({ error: "No s'ha pogut preparar la descàrrega", code: "error_storage" }, 500);
    }
    const ext = EXTENSION_POR_MIME[(fila.fitxer_mime ?? "").toLowerCase()] ?? extensionDe(fila.fitxer_ruta);
    return responder({
      url: urlPublica(urlFirma.signedUrl, Deno.env.get("URL_PUBLICA_STORAGE")),
      nombre: `${(fila.fitxer_ruta.split("/").pop() ?? "").replace(/\.[^.]*$/, "") || fila.tipo_doc}.${ext}`,
      sha256: fila.fitxer_sha256,
      bytes: fila.fitxer_bytes,
      mime: fila.fitxer_mime ?? MIME_POR_EXTENSION[ext],
      via: fila.via,
      estat: fila.estat,
      caduca_en: SEGUNDOS_FIRMA,
    }, 200);
  }

  // ------------------------------------------------------- documento externo
  // Se resuelve entero aquí y se sale: de la fila de abajo no comparte ni una columna.
  if (externoId) {
    // Permiso ANTES de leer la fila, igual que con `documentos`: así un 403 no filtra ni
    // la existencia. La regla vive en SQL (`puc_veure_document_extern`, 20270329100000),
    // que es el mismo sitio del que sale lo que se puede listar.
    const { data: permitidoExt, error: errPermisoExt } = await supabase.rpc(
      "puc_veure_document_extern",
      { p_id: externoId, p_user: ctx.userId },
    );
    if (errPermisoExt) {
      console.error("descargar-documento: puc_veure_document_extern:", errPermisoExt.message);
      return responder({ error: "Error comprobando permisos", code: "error_bd" }, 500);
    }
    if (permitidoExt !== true) {
      return responder({ error: "No pots veure aquest document", code: "forbidden" }, 403);
    }

    const { data: dataExt, error: errExt } = await supabase
      .from("documentos_externos")
      .select("id, objeto_tipo, objeto_id, tipo, numero, fecha, ruta, sha256, mime, bytes")
      .eq("id", externoId)
      .maybeSingle();

    if (errExt) {
      console.error("descargar-documento: select extern:", errExt.message);
      return responder({ error: "Error consultando el documento", code: "error_bd" }, 500);
    }
    const ext = dataExt as FilaExterno | null;
    // Solo se llega aquí con permiso concedido, así que esto es una carrera (lo han
    // borrado entremedias), no un intento de leer lo ajeno.
    if (!ext) return responder({ error: "Documento inexistente", code: "no_existeix" }, 404);

    const { data: firmaExt, error: errFirmaExt } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(ext.ruta, SEGUNDOS_FIRMA);

    if (errFirmaExt || !firmaExt?.signedUrl) {
      console.error(
        "descargar-documento: createSignedUrl extern:",
        errFirmaExt?.message ?? "sin url",
      );
      return responder({ error: "No s'ha pogut preparar la descàrrega", code: "error_storage" }, 500);
    }

    return responder({
      url: urlPublica(firmaExt.signedUrl, Deno.env.get("URL_PUBLICA_STORAGE")),
      nombre: nombreExterno(ext),
      sha256: ext.sha256,
      bytes: ext.bytes,
      mime: ext.mime,
      caduca_en: SEGUNDOS_FIRMA,
    }, 200);
  }

  // Permiso ANTES de leer nada del documento: así un 403 no filtra ni la existencia.
  const { data: permitido, error: errPermiso } = await supabase.rpc("puede_ver_documento", {
    p_documento: documentoId,
    p_user: ctx.userId,
  });
  if (errPermiso) {
    console.error("descargar-documento: puede_ver_documento:", errPermiso.message);
    return responder({ error: "Error comprobando permisos", code: "error_bd" }, 500);
  }
  if (permitido !== true) {
    return responder({ error: "No pots veure aquest document", code: "forbidden" }, 403);
  }

  const { data, error } = await supabase
    .from("documentos")
    .select("id, tipo, numero_completo, version, ruta, sha256_fichero, bytes, paginas, estado, fichero_at")
    .eq("id", documentoId)
    .maybeSingle();

  if (error) {
    console.error("descargar-documento: select:", error.message);
    return responder({ error: "Error consultando el documento", code: "error_bd" }, 500);
  }
  const doc = data as FilaDocumento | null;
  if (!doc) return responder({ error: "Documento inexistente", code: "no_existeix" }, 404);

  // Emitido pero sin fichero todavía: no es un error del que pide, es un «espera».
  if (!doc.fichero_at || !doc.ruta) {
    return responder({
      error: "El document encara s'està generant",
      code: "sense_fitxer",
      estado: doc.estado,
    }, 409);
  }

  const { data: firma, error: errFirma } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.ruta, SEGUNDOS_FIRMA);

  if (errFirma || !firma?.signedUrl) {
    console.error("descargar-documento: createSignedUrl:", errFirma?.message ?? "sin url");
    return responder({ error: "No s'ha pogut preparar la descàrrega", code: "error_storage" }, 500);
  }

  return responder({
    url: urlPublica(firma.signedUrl, Deno.env.get("URL_PUBLICA_STORAGE")),
    nombre: nombreFichero(doc),
    // La extensión real: una versión `signat` subida puede ser un JPG o un PNG.
    mime: MIME_POR_EXTENSION[extensionDe(doc.ruta)],
    sha256_fichero: doc.sha256_fichero,
    bytes: doc.bytes,
    paginas: doc.paginas,
    caduca_en: SEGUNDOS_FIRMA,
  }, 200);
});
