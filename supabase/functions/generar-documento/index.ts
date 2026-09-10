// Generación del PDF de un documento ya emitido (sistema documental, §B.1 del plan).
//
//   POST /generar-documento  { documento_id }   cabecera: x-documentos-secret
//
// La llama un trigger `after insert on documentos` por pg_net y, en los reintentos,
// el job `documentos-pendientes` (mismo patrón que `disparar_recordatorios_intake`,
// §5). Por eso va con `verify_jwt = false` y un secreto compartido en cabecera:
// quien la invoca es la base, no una persona.
//
// Reparto de responsabilidades, que es lo que hace que esto sea seguro:
//   · El NÚMERO y la RUTA los calcula SQL al emitir, dentro de la transacción que
//     crea la fila. Aquí no se compone ninguna ruta ni se pide ningún correlativo:
//     se sube exactamente a `documentos.ruta`.
//   · `sha256_datos` (el código de verificación que se imprime) lo calcula SQL sobre
//     el snapshot; aquí solo se calcula `sha256_fichero`, la huella de los bytes, y
//     se calcula ANTES de subirlos: es la huella de lo que se sube, no de lo que se
//     leyó después.
//   · El estado lo mueven las RPC `marcar_documento_generado` / `marcar_documento_error`,
//     nunca un update suelto: la tabla es inmutable salvo por esas transiciones.
//
// Es IDEMPOTENTE: si la fila ya tiene `fichero_at`, responde 200 sin hacer nada.
// pg_net reintenta, el job reintenta, y un PDF ya generado no se regenera (regenerarlo
// cambiaría `sha256_fichero` de un documento que quizá ya se ha enviado).

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { type BytesActivos, cargarActivos } from "../_shared/pdf/fuentes.ts";
import { type LineaProva, renderProva } from "../_shared/pdf/render/prova.ts";

/** Los activos (TTF y logo) viven en la carpeta de ESTA función, no en `_shared/`. */
const ACTIVOS = new URL("./activos/", import.meta.url);

const BUCKET = "documentos";

interface FilaDocumento {
  id: string;
  tipo: string;
  subtipo: string | null;
  modo: string;
  idioma: string | null;
  numero_completo: string | null;
  version: number;
  serie: string | null;
  ejercicio: number | null;
  datos: Record<string, unknown> | null;
  sha256_datos: string | null;
  ruta: string | null;
  estado: string;
  fichero_at: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Huella de los bytes que se van a subir. Hex en minúsculas, como `pgcrypto`. */
async function sha256(bytes: Uint8Array): Promise<string> {
  const copia = new Uint8Array(bytes.length);
  copia.set(bytes);
  const resumen = await crypto.subtle.digest("SHA-256", copia.buffer);
  return Array.from(new Uint8Array(resumen))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

Deno.serve(async (req) => {
  const t0 = performance.now();
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  // Secreto compartido: lo guarda `app_config.documentos_secret` (lo lee el job) y
  // el secreto DOCUMENTOS_SECRET (lo valida esto). Nunca en git.
  const esperado = Deno.env.get("DOCUMENTOS_SECRET");
  const recibido = req.headers.get("x-documentos-secret");
  if (!esperado || recibido !== esperado) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  let documentoId: string | null = null;
  try {
    const cuerpo = await req.json();
    documentoId = typeof cuerpo?.documento_id === "string" ? cuerpo.documento_id : null;
  } catch {
    return json({ error: "Cuerpo JSON inválido", code: "cos_invalid" }, 400);
  }
  if (!documentoId) {
    return json({ error: "Falta 'documento_id'", code: "falta_id" }, 400);
  }

  // La lista de columnas va en UN literal: supabase-js deduce el tipo de la fila
  // analizándolo, y ante una expresión se rinde (§7 y deuda 46).
  const { data, error } = await supabase
    .from("documentos")
    .select(
      "id, tipo, subtipo, modo, idioma, numero_completo, version, serie, ejercicio, datos, sha256_datos, ruta, estado, fichero_at",
    )
    .eq("id", documentoId)
    .maybeSingle();

  if (error) {
    console.error("generar-documento: select:", error.message);
    return json({ error: "Error consultando el documento", code: "error_bd" }, 500);
  }
  const doc = data as FilaDocumento | null;
  if (!doc) return json({ error: "Documento inexistente", code: "no_existeix" }, 404);

  // Idempotencia: el fichero ya está. No se regenera (cambiaría su huella).
  if (doc.fichero_at) {
    return json({ ok: true, ya_generado: true, documento_id: doc.id, ruta: doc.ruta }, 200);
  }
  if (!doc.ruta) {
    const err = "La fila no tiene `ruta`: la calcula SQL al emitir";
    await supabase.rpc("marcar_documento_error", { p_id: doc.id, p_error: err });
    return json({ error: err, code: "sense_ruta" }, 409);
  }

  try {
    const tActivos = performance.now();
    const activos = await cargarActivos(ACTIVOS);
    const msActivos = performance.now() - tActivos;

    const tRender = performance.now();
    const { bytes, paginas } = await renderizar(doc, activos);
    const msRender = performance.now() - tRender;

    const huella = await sha256(bytes);

    const tSubida = performance.now();
    // `upsert` porque un reintento (fallo entre el upload y el `marcar`) tiene que
    // poder volver a escribir el mismo objeto.
    const { error: errSubida } = await supabase.storage
      .from(BUCKET)
      .upload(doc.ruta, bytes, { contentType: "application/pdf", upsert: true });
    const msSubida = performance.now() - tSubida;
    if (errSubida) throw new Error(`storage: ${errSubida.message}`);

    const { error: errMarca } = await supabase.rpc("marcar_documento_generado", {
      p_id: doc.id,
      p_sha: huella,
      p_bytes: bytes.length,
      p_paginas: paginas,
    });
    if (errMarca) throw new Error(`marcar_documento_generado: ${errMarca.message}`);

    // Desglose de CPU: el límite del runtime es 2 s por petición y el criterio de
    // salida del spike, 800 ms. Sin este log no hay forma de saber dónde se va.
    console.log(JSON.stringify({
      fn: "generar-documento",
      documento: doc.id,
      tipo: doc.tipo,
      modo: doc.modo,
      paginas,
      bytes: bytes.length,
      ms_activos: Number(msActivos.toFixed(1)),
      ms_render: Number(msRender.toFixed(1)),
      ms_subida: Number(msSubida.toFixed(1)),
      ms_total: Number((performance.now() - t0).toFixed(1)),
      activos_en_frio: msActivos > 1,
    }));

    return json({
      ok: true,
      documento_id: doc.id,
      ruta: doc.ruta,
      sha256_fichero: huella,
      bytes: bytes.length,
      paginas,
    }, 200);
  } catch (e) {
    const texto = mensaje(e);
    console.error("generar-documento:", doc.id, texto);
    // El error se anota en la fila: el documento existe (el número ya está gastado y
    // no puede haber huecos), lo que falta es el fichero, y el job lo reintentará.
    const { error: errAnota } = await supabase.rpc("marcar_documento_error", {
      p_id: doc.id,
      p_error: texto.slice(0, 500),
    });
    if (errAnota) console.error("marcar_documento_error:", errAnota.message);
    return json({ error: texto, code: "error_generacio" }, 500);
  }
});

/** Elige el renderizador por `tipo`. Un tipo desconocido es un error, no un vacío. */
async function renderizar(doc: FilaDocumento, activos: BytesActivos) {
  const datos = (doc.datos ?? {}) as Record<string, unknown>;
  switch (doc.tipo) {
    case "PROVA": {
      // El `datos` del documento de prueba lo compone `emitir_documento_prova()`:
      // { titol, nota, numero, emes_at, ejercici, linies: [{ordre, concepte, unitats, kg}] }.
      const emes = typeof datos.emes_at === "string" ? datos.emes_at.slice(0, 10) : undefined;
      return await renderProva(activos, {
        numero: doc.numero_completo ?? undefined,
        fecha: emes,
        organizacion: typeof datos.organitzacio === "string" ? datos.organitzacio : undefined,
        titulo: typeof datos.titol === "string" ? datos.titol : undefined,
        nota: typeof datos.nota === "string" ? datos.nota : undefined,
        modo: doc.modo === "real" ? "real" : "prueba",
        lineas: Array.isArray(datos.linies)
          ? (datos.linies as LineaProva[])
          : (typeof datos.linies === "number" ? datos.linies : undefined),
        sha256Datos: doc.sha256_datos ?? undefined,
      });
    }
    default:
      throw new Error(`Tipo de documento sin renderizador: ${doc.tipo}`);
  }
}
