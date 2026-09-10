// Descarga de un documento del bucket privado `documentos`.
//
//   POST /descargar-documento  { documento_id }   (JWT de la sesión)
//   -> { url, nombre, sha256_fichero, bytes, paginas }   url firmada, 60 s
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

const BUCKET = "documentos";
const SEGUNDOS_FIRMA = 60;

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);

function originPermitido(origin: string): boolean {
  return ALLOWED_ORIGINS.some((patron) => {
    if (!patron.includes("*")) return patron === origin;
    const re = new RegExp(
      "^" + patron.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[A-Za-z0-9-]+") + "$",
    );
    return re.test(origin);
  });
}

function corsPara(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": originPermitido(origin) ? origin : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

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

/** Nombre con el que se ofrece el fichero: el número del documento, no un uuid. */
function nombreFichero(doc: FilaDocumento): string {
  if (doc.numero_completo) return `${doc.numero_completo}-v${doc.version}.pdf`;
  const hoja = (doc.ruta ?? "").split("/").pop();
  return hoja && hoja.length > 0 ? hoja : `${doc.id}.pdf`;
}

Deno.serve(async (req) => {
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

  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) {
    return responder({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
  }

  let documentoId: string | null = null;
  try {
    const cuerpo = await req.json();
    documentoId = typeof cuerpo?.documento_id === "string" ? cuerpo.documento_id : null;
  } catch {
    return responder({ error: "Cuerpo JSON inválido", code: "cos_invalid" }, 400);
  }
  if (!documentoId) {
    return responder({ error: "Falta 'documento_id'", code: "falta_id" }, 400);
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
    url: firma.signedUrl,
    nombre: nombreFichero(doc),
    sha256_fichero: doc.sha256_fichero,
    bytes: doc.bytes,
    paginas: doc.paginas,
    caduca_en: SEGUNDOS_FIRMA,
  }, 200);
});
