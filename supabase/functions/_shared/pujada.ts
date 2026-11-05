// Lo que comparten las dos funciones que reciben un fichero del navegador y lo guardan en
// el bucket `documentos` (05-11-2026): `subir-documento-externo` (albarán del productor,
// factura, foto, archivo previo) y `pujar-document-signat` (el documento firmado fuera de
// Redestina y vuelto a subir).
//
// Tres decisiones, las mismas para las dos:
//   · **Tres formatos y nada más**: PDF, JPG y PNG (los que acepta el bucket,
//     20260928100600).
//   · **El formato lo dicen los BYTES, no la etiqueta.** El `content-type` que manda el
//     navegador sale de la extensión del nombre: un `.pdf` que es un JPEG renombrado se
//     guardaría con un MIME falso, y quien lo descargue no lo podría abrir. Aquí se mira la
//     cabecera mágica y es esa la que manda; si no es ninguno de los tres, se rechaza
//     aunque la etiqueta diga `application/pdf`.
//   · **10 MB como máximo**, mirado dos veces: `File.size` antes de leer (lo que dice el
//     cliente; corta antes de traer 200 MB a memoria) y la longitud real después.
//
// ⚠️ Módulo HOJA: sin `Deno`, sin red y sin importar nada que no sea hoja, para que se pueda
//    probar desde Vitest. La huella usa `crypto.subtle`, que existe igual en Deno, en Node
//    y en el navegador.

export const MAX_BYTES_PUJADA = 10 * 1024 * 1024;

export type MimeAcceptat = "application/pdf" | "image/jpeg" | "image/png";

/** Del MIME a la extensión con la que se guarda (la que espera `ruta_*` en SQL). */
export const EXTENSIO_PER_MIME: Record<MimeAcceptat, "pdf" | "jpg" | "png"> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * El formato real de unos bytes, por su cabecera mágica. `null` = ninguno de los tres.
 *   · PDF: `%PDF-` (puede ir precedido de basura en ficheros mal generados; se tolera hasta
 *     1 KB, que es lo que admiten los lectores de PDF).
 *   · JPEG: `FF D8 FF`.
 *   · PNG: `89 50 4E 47 0D 0A 1A 0A`.
 */
export function mimeReal(bytes: Uint8Array): MimeAcceptat | null {
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) {
      return "application/pdf";
    }
  }
  return null;
}

/** ¿La etiqueta que manda el navegador es una de las tres (o no dice nada)? */
export function mimeDeclaratAcceptable(mime: string): boolean {
  const m = (mime || "").toLowerCase().trim();
  return m === "" || m === "application/octet-stream" || m === "image/jpg" ||
    m in EXTENSIO_PER_MIME;
}

export type ErrorPujada =
  | { status: 400; code: "falta_fitxer" | "fitxer_buit"; error: string }
  | { status: 413; code: "massa_gran"; error: string; bytes: number }
  | { status: 415; code: "mime_no_acceptat"; error: string; mime: string };

/**
 * Lo que se puede decir de un fichero ANTES de leer sus bytes: que existe, que no está
 * vacío, que no pasa del tope y que su etiqueta no es de otra cosa.
 */
export function validaAbansDeLlegir(
  fitxer: { size: number; type: string } | null | undefined,
  max = MAX_BYTES_PUJADA,
): ErrorPujada | null {
  if (!fitxer) return { status: 400, code: "falta_fitxer", error: "Falta el fitxer" };
  if (fitxer.size > max) {
    return { status: 413, code: "massa_gran", error: "El fitxer no pot passar de 10 MB", bytes: fitxer.size };
  }
  if (fitxer.size === 0) return { status: 400, code: "fitxer_buit", error: "El fitxer és buit" };
  if (!mimeDeclaratAcceptable(fitxer.type)) {
    return {
      status: 415,
      code: "mime_no_acceptat",
      error: "Només s'accepten PDF, JPG i PNG",
      mime: (fitxer.type || "").toLowerCase(),
    };
  }
  return null;
}

/**
 * Lo que se decide con los bytes en la mano: el tamaño de verdad y el formato de verdad.
 * Devuelve el MIME y la extensión con que se guarda, o el error.
 */
export function validaBytes(
  bytes: Uint8Array,
  mimeDeclarat: string,
  max = MAX_BYTES_PUJADA,
): { mime: MimeAcceptat; extensio: "pdf" | "jpg" | "png" } | { error: ErrorPujada } {
  if (bytes.length === 0) return { error: { status: 400, code: "fitxer_buit", error: "El fitxer és buit" } };
  if (bytes.length > max) {
    return { error: { status: 413, code: "massa_gran", error: "El fitxer no pot passar de 10 MB", bytes: bytes.length } };
  }
  const mime = mimeReal(bytes);
  if (!mime) {
    return {
      error: {
        status: 415,
        code: "mime_no_acceptat",
        error: "Només s'accepten PDF, JPG i PNG",
        mime: (mimeDeclarat || "").toLowerCase(),
      },
    };
  }
  return { mime, extensio: EXTENSIO_PER_MIME[mime] };
}

/** Huella de los bytes, hex en minúsculas (como `pgcrypto`). */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copia = new Uint8Array(bytes.length);
  copia.set(bytes);
  const resumen = await crypto.subtle.digest("SHA-256", copia.buffer);
  return Array.from(new Uint8Array(resumen))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
