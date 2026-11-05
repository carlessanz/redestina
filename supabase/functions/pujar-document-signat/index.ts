// Subir un documento FIRMADO FUERA de Redestina (05-11-2026, circuito de firma unificado).
//
//   POST /pujar-document-signat   multipart/form-data   (JWT de la sesión)
//     fitxer          (File)   pdf, jpg o png, hasta 10 MB (formato por sus bytes)
//     documento_id    uuid     la versión de `documentos` que se firmó (la vigente)
//     signant_nom?    texto    quién firmó (≤ 120)
//     signant_carrec? texto    su cargo (≤ 120)
//     data_signatura? AAAA-MM-DD, no futura (por defecto, hoy)
//   -> 201 { firma: { id, estat, via, document_signat_id }, ruta, sha256, bytes, mime }
//   -> 400 { code: 'cos_invalid' | 'dades_invalides' (con `camp`) | 'falta_fitxer' | 'fitxer_buit' }
//   -> 401 { code: 'unauthorized' }
//   -> 403 { code: 'forbidden' }               ni equipo ni titular de la organización que firma
//   -> 409 { code: 'no_signable' | 'versio_substituida' | 'ja_signat' }
//   -> 413 { code: 'massa_gran' }   415 { code: 'mime_no_acceptat' }
//
// QUÉ PASA DESPUÉS lo decide `registrar_document_signat()`, no esta función:
//   · si sube el **super_admin** (vía `correu`: lo mandó por correo, se lo devolvieron
//     firmado y lo sube), la firma se cierra al momento: nace la versión n+1 `signat`
//     `emitido` cuyo fichero ES el subido (`ruta` = la de aquí), sin pasar por
//     `generar-documento`;
//   · si sube la **organización** (vía `pujat`), queda `signat` en la cola «Signatures per
//     tancar» hasta que el super_admin la revisa (`tancar_signatura` / `rebutjar_signatura`).
// El fichero se guarda TAL CUAL: lo firmado son esos bytes y no se estampa nada encima.
//
// Molde: `subir-documento-externo`. Lo común (formato por cabecera mágica, tope y huella)
// vive en `_shared/pujada.ts` y lo usan las dos.
//
// LA RUTA LA DECIDE SQL (`ruta_document_signat()`, solo `service_role`): la carpeta del
// propio documento y `<numero>-signat-<8hex>.<ext>`. Aquí no se compone ninguna cadena.
// Y se sube con `upsert: false`: el sufijo aleatorio hace imposible pisar nada, y si algún
// día no lo fuera, mejor un error que sobrescribir un documento firmado.
//
// QUIÉN PUEDE: `puc_signar_document(documento, user)` — el equipo (también en prueba) o la
// persona TITULAR activa de la organización que firma, y solo en documentos reales. Se
// pregunta ANTES de leer los bytes y antes de mirar si el documento existe (§4bis: el
// permiso antes que la existencia). Que se pueda firmar AHORA (vigente, estado del objeto,
// sin firma viva) lo comprueba la RPC dentro de su transacción.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { contextoUsuario } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { sha256Bytes, validaAbansDeLlegir, validaBytes } from "../_shared/pujada.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

const BUCKET = "documentos";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CAMP = 120;
/** Los códigos de negocio de `registrar_document_signat()` que son un «ahora no» (409). */
const CODIS_409 = ["no_signable", "versio_substituida", "ja_signat", "usa_firma_conveni"];

function textNet(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Hoy en Madrid (AAAA-MM-DD), que es el huso con el que valida la base. */
function avuiMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** El código de negocio que SQL pone delante del mensaje (`ja_signat: …`). */
function prefixError(missatge: string): string {
  const m = (missatge ?? "").match(/^([a-z_]+):/);
  return m ? m[1] : "";
}

Deno.serve(async (req) => {
  const t0 = performance.now();
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase: Cliente = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  // `service_role` ignora RLS (§4bis): la autorización propia es obligatoria.
  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) return responder({ error: "Necessites iniciar sessió", code: "unauthorized" }, 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return responder({ error: "S'esperava multipart/form-data", code: "cos_invalid" }, 400);
  }

  // ------------------------------------------------------------- los campos
  const documentoId = textNet(form.get("documento_id"));
  if (!UUID.test(documentoId)) {
    return responder({ error: "Identificador no vàlid", code: "dades_invalides", camp: "documento_id" }, 400);
  }
  const nom = textNet(form.get("signant_nom"));
  if (nom.length > MAX_CAMP) {
    return responder({ error: "El nom és massa llarg", code: "dades_invalides", camp: "signant_nom" }, 400);
  }
  const carrec = textNet(form.get("signant_carrec"));
  if (carrec.length > MAX_CAMP) {
    return responder({ error: "El càrrec és massa llarg", code: "dades_invalides", camp: "signant_carrec" }, 400);
  }
  const dataSignatura = textNet(form.get("data_signatura"));
  if (dataSignatura) {
    const valida = /^\d{4}-\d{2}-\d{2}$/.test(dataSignatura) &&
      !Number.isNaN(Date.parse(`${dataSignatura}T00:00:00Z`));
    if (!valida || dataSignatura > avuiMadrid()) {
      return responder(
        { error: "La data de signatura no és vàlida", code: "dades_invalides", camp: "data_signatura" },
        400,
      );
    }
  }

  // El tamaño y la etiqueta, ANTES de leer los bytes (`_shared/pujada.ts`).
  const fichero = form.get("fitxer") ?? form.get("fichero") ?? form.get("file");
  {
    const previ = validaAbansDeLlegir(fichero instanceof File ? fichero : null);
    if (previ) {
      const { status, ...cos } = previ;
      return responder(cos, status);
    }
  }
  const fitxer = fichero as File;

  // ---------------------------------------------------------------- permiso
  {
    const { data, error } = await supabase.rpc("puc_signar_document", {
      p_documento: documentoId,
      p_user: ctx.userId,
    });
    if (error) {
      console.error("pujar-document-signat: puc_signar_document:", error.message);
      return responder({ error: "Error comprovant permisos", code: "error_bd" }, 500);
    }
    if (data !== true) {
      return responder(
        { error: "Només la persona titular de l'organització pot pujar aquest document signat", code: "forbidden" },
        403,
      );
    }
  }

  // ------------------------------------------------------------- los bytes
  const bytes = new Uint8Array(await fitxer.arrayBuffer());
  const comprovat = validaBytes(bytes, fitxer.type);
  if ("error" in comprovat) {
    const { status, ...cos } = comprovat.error;
    return responder(cos, status);
  }
  const { mime, extensio } = comprovat;

  // ------------------------------------------------------------ la ruta (SQL)
  let ruta: string;
  {
    const { data, error } = await supabase.rpc("ruta_document_signat", {
      p_documento: documentoId,
      p_ext: extensio,
    });
    if (error) {
      const pref = prefixError(String(error.message ?? ""));
      if (CODIS_409.includes(pref)) return responder({ error: error.message, code: pref }, 409);
      console.error("pujar-document-signat: ruta_document_signat:", error.code, error.message);
      return responder({ error: "No s'ha pogut decidir on desar el fitxer", code: "sense_carpeta" }, 409);
    }
    ruta = String(data ?? "");
    if (!ruta) return responder({ error: "No s'ha pogut decidir on desar el fitxer", code: "sense_carpeta" }, 409);
  }

  const huella = await sha256Bytes(bytes);

  const tSubida = performance.now();
  const { error: errSubida } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, bytes, { contentType: mime, upsert: false });
  const msSubida = performance.now() - tSubida;
  if (errSubida) {
    console.error("pujar-document-signat: upload:", errSubida.message);
    return responder({ error: "No s'ha pogut desar el fitxer", code: "error_storage" }, 500);
  }

  // ------------------------------------------------------------- el registro
  const { data, error } = await supabase.rpc("registrar_document_signat", {
    p_documento: documentoId,
    p_user: ctx.userId,
    p_fitxer: { ruta, sha256: huella, mime, bytes: bytes.length },
    p_signant: {
      nom: nom || null,
      carrec: carrec || null,
      data_signatura: dataSignatura || null,
    },
  });

  if (error) {
    // Compensar: un fichero en el bucket sin su firma no lo ve nadie ni lo borra nadie.
    await supabase.storage.from(BUCKET).remove([ruta]);
    const codigo = String(error.code ?? "");
    const missatge = String(error.message ?? "");
    if (codigo === "42501") {
      return responder({ error: "No pots signar aquest document", code: "forbidden" }, 403);
    }
    if (codigo === "22023") {
      const pref = prefixError(missatge);
      if (CODIS_409.includes(pref)) return responder({ error: missatge, code: pref }, 409);
      return responder({ error: missatge, code: "dades_invalides" }, 400);
    }
    console.error("pujar-document-signat: registrar_document_signat:", codigo, missatge);
    return responder({ error: "No s'ha pogut registrar el document signat", code: "error_bd" }, 500);
  }

  const fila = (data ?? {}) as Record<string, unknown>;
  console.log(JSON.stringify({
    fn: "pujar-document-signat",
    documento: documentoId,
    firma: fila.firma_id ?? null,
    via: fila.via ?? null,
    estat: fila.estat ?? null,
    mime,
    bytes: bytes.length,
    intern: ctx.esIntern,
    ms_subida: Number(msSubida.toFixed(1)),
    ms_total: Number((performance.now() - t0).toFixed(1)),
  }));

  return responder({
    firma: {
      id: fila.firma_id ?? null,
      estat: fila.estat ?? null,
      via: fila.via ?? null,
      document_signat_id: fila.document_signat_id ?? null,
    },
    ruta,
    sha256: huella,
    bytes: bytes.length,
    mime,
  }, 201);
});
