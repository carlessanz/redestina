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
import type { DatosAlbaran, PlantillaLegal } from "../_shared/pdf/render/comu.ts";
import { renderEnt } from "../_shared/pdf/render/ent.ts";
import { renderOpe } from "../_shared/pdf/render/ope.ts";
import { type LineaProva, renderProva } from "../_shared/pdf/render/prova.ts";
import { renderRec } from "../_shared/pdf/render/rec.ts";
import type { DatosCierre } from "../_shared/pdf/render/cierre.ts";
import { renderRes } from "../_shared/pdf/render/res.ts";
import { renderCd } from "../_shared/pdf/render/cd.ts";

// Sin tipos generados de la base: anotar el cliente con `ReturnType<typeof createClient>`
// resuelve el esquema a `never` y las llamadas dejan de compilar (misma nota que en
// `registro/index.ts` y `_shared/gate.ts`).
// deno-lint-ignore no-explicit-any
type Cliente = any;

/** Los activos (TTF y logo) viven en la carpeta de ESTA función, no en `_shared/`. */
const ACTIVOS = new URL("./activos/", import.meta.url);

const BUCKET = "documentos";
/** Bucket privado con la firma y el sello de la apoderada (20260928100600). */
const BUCKET_ACTIVOS = "activos";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com").replace(/\/$/, "");

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
  plantilla_id: string | null;
  ruta: string | null;
  estado: string;
  fichero_at: string | null;
  /** Intención de envío que dejó la RPC de emisión: destinatario, asunto y —solo en el
   *  resumen— el token del enlace de subida de factura. Nunca se registra en el log. */
  envio: Record<string, unknown> | null;
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
      "id, tipo, subtipo, modo, idioma, numero_completo, version, serie, ejercicio, datos, sha256_datos, plantilla_id, ruta, estado, fichero_at, envio",
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
    const { bytes, paginas } = await renderizar(supabase, doc, activos);
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


// ---------------------------------------------------------------------------
// Lo que el certificado necesita y el snapshot NO lleva
// ---------------------------------------------------------------------------
// `cierre_datos_certificado()` deja fuera `apoderada_dni` a propósito: `documentos.datos`
// lo lee el propio donante desde su panel, y el DNI de una persona del equipo no tiene por
// qué llegarle. Está fuera incluso del GRANT de SELECT de `parametros_documentales`
// (20260928100400), así que solo se puede leer desde aquí, con `service_role`, y solo para
// estamparlo en el papel que lo exige.
//
// La firma y el sello son PNG del bucket privado `activos`. Los dos son opcionales: sin
// ellos el certificado se imprime con el espacio en blanco para firmar a mano, que es
// mejor que no poder emitirlo (§cd.ts).

interface ActivosFirma {
  apoderadaDni: string | null;
  firmaPng: Uint8Array | null;
  selloPng: Uint8Array | null;
  msDescarga: number;
}

async function activosFirma(supabase: Cliente): Promise<ActivosFirma> {
  const t0 = performance.now();
  const vacio: ActivosFirma = { apoderadaDni: null, firmaPng: null, selloPng: null, msDescarga: 0 };

  const { data, error } = await supabase
    .from("parametros_documentales")
    .select("id, apoderada_dni, firma_ruta, sello_ruta")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) {
    console.warn("generar-documento: parametros_documentales:", error?.message ?? "sin fila");
    return vacio;
  }

  const bajar = async (ruta: string | null): Promise<Uint8Array | null> => {
    if (!ruta) return null;
    const { data: fichero, error: err } = await supabase.storage
      .from(BUCKET_ACTIVOS)
      .download(ruta);
    if (err || !fichero) {
      console.warn("generar-documento: activo no descargado:", ruta, err?.message);
      return null;
    }
    return new Uint8Array(await fichero.arrayBuffer());
  };

  const [firmaPng, selloPng] = await Promise.all([
    bajar(data.firma_ruta as string | null),
    bajar(data.sello_ruta as string | null),
  ]);

  return {
    apoderadaDni: ((data.apoderada_dni as string | null) ?? "").trim() || null,
    firmaPng,
    selloPng,
    msDescarga: performance.now() - t0,
  };
}

/**
 * La URL con la que el donante sube su factura. El token vive en `documentos.envio`
 * —lo dejó ahí `emitir_resumen()`— y **no se registra en ningún log**: es una credencial
 * al portador con 60 días de vida. Sin token, el resumen se imprime sin enlace y lo dice.
 */
function enlaceFactura(envio: Record<string, unknown> | null): string | null {
  const token = typeof envio?.token === "string" ? envio.token.trim() : "";
  if (!token) return null;
  return `${APP_URL}/factura/${encodeURIComponent(token)}`;
}

/**
 * La plantilla legal con la que se emitió ESTE documento, no la vigente de hoy.
 *
 * `documentos.plantilla_id` se congela al emitir (`albaran_emet_document`), así que
 * regenerar el PDF de un albarán de hace dos años vuelve a imprimir el texto de
 * entonces aunque desde entonces se hayan publicado tres versiones. Es la mitad de la
 * copia congelada: `datos` guarda los valores, esto guarda el texto que los rodea.
 *
 * Sin plantilla (todavía no hay texto validado para ese tipo e idioma, §fase 0) devuelve
 * `null` y el renderizador imprime su texto provisional, marcado como tal.
 */
async function plantillaDe(
  supabase: Cliente,
  plantillaId: string | null,
): Promise<PlantillaLegal | null> {
  if (!plantillaId) return null;
  const { data, error } = await supabase
    .from("plantillas_documento")
    .select("id, tipo, idioma, version, titulo, cuerpo")
    .eq("id", plantillaId)
    .maybeSingle();
  if (error) {
    // No es motivo para no generar el documento: se imprime el provisional y se avisa.
    console.warn("generar-documento: plantilla:", error.message);
    return null;
  }
  const fila = data as { titulo?: string | null; cuerpo?: unknown } | null;
  return fila ? { titulo: fila.titulo ?? null, cuerpo: fila.cuerpo } : null;
}

/** Elige el renderizador por `tipo`. Un tipo desconocido es un error, no un vacío. */
async function renderizar(
  supabase: Cliente,
  doc: FilaDocumento,
  activos: BytesActivos,
) {
  const datos = (doc.datos ?? {}) as Record<string, unknown>;

  // Los tres albaranes y sus rectificativos: mismo snapshot, mismo camino, renderizador
  // distinto. `R-REC` se pinta como un REC con el rótulo de rectificativo (y su ruta ya
  // lo archiva en la carpeta del original, `ruta_documento`).
  const tipoBase = doc.tipo.replace(/^R-/, "");
  if (tipoBase === "REC" || tipoBase === "ENT" || tipoBase === "OPE") {
    const op = {
      datos: datos as DatosAlbaran,
      sha256Datos: doc.sha256_datos,
      plantilla: await plantillaDe(supabase, doc.plantilla_id),
      modo: doc.modo === "prueba" ? ("prueba" as const) : ("real" as const),
      rectificativo: doc.tipo.startsWith("R-"),
      subtipo: doc.subtipo,
    };
    if (tipoBase === "REC") return await renderRec(activos, op);
    if (tipoBase === "ENT") return await renderEnt(activos, op);
    return await renderOpe(activos, op);
  }

  // El cierre anual: resumen y certificado. Comparten snapshot y esqueleto (`cierre.ts`)
  // y son los únicos, con el futuro CT, que imprimen euros.
  if (doc.tipo === "RES" || doc.tipo === "CD") {
    const base = {
      datos: datos as DatosCierre,
      sha256Datos: doc.sha256_datos,
      plantilla: await plantillaDe(supabase, doc.plantilla_id),
      modo: doc.modo === "prueba" ? ("prueba" as const) : ("real" as const),
      subtipo: doc.subtipo,
    };
    if (doc.tipo === "RES") {
      return await renderRes(activos, {
        ...base,
        enlaceFactura: enlaceFactura(doc.envio),
        enlaceDias: 60,
      }, doc.idioma);
    }
    const firma = await activosFirma(supabase);
    if (firma.msDescarga > 1) {
      console.log(JSON.stringify({
        fn: "generar-documento",
        activos_firma_ms: Number(firma.msDescarga.toFixed(1)),
        firma: firma.firmaPng !== null,
        segell: firma.selloPng !== null,
      }));
    }
    return await renderCd(activos, {
      ...base,
      apoderadaDni: firma.apoderadaDni,
      firmaPng: firma.firmaPng,
      selloPng: firma.selloPng,
      // ⚠️ Un certificado rectificado NO cambia de tipo (`documentos.tipo` no tiene
      // `R-CD`): `rectificar_certificado()` emite otra versión del mismo CD con el mismo
      // número y añade `motiu_rectificacio` al snapshot. Eso es lo que hay que mirar.
      rectificativo: typeof (datos as DatosCierre).motiu_rectificacio === "string" &&
        (datos as DatosCierre).motiu_rectificacio !== "",
    }, doc.idioma);
  }

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
