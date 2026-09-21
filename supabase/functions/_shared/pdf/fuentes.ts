// Carga y registro de las fuentes del sistema documental (Redestina).
//
// Dos responsabilidades separadas a propósito:
//
//   · `cargarActivos(base)` LEE los ficheros (TTF y logo) de una carpeta `activos/`
//     que pertenece a la FUNCIÓN, no a `_shared/`. El maquetador vive en `_shared/pdf/`
//     y lo comparten varias funciones; los bytes no pueden vivir aquí, porque cada
//     cambio en `_shared/` obliga a redesplegar las nueve funciones existentes (§3).
//     Por eso la función pasa su propia base: `new URL('./activos/', import.meta.url)`.
//   · `embeberFuentes(doc, activos)` las mete en UN documento concreto. El embebido es
//     por documento (pdf-lib no comparte objetos entre PDFDocument), la lectura no.
//
// ⚠️ `Deno.readFileSync` está BLOQUEADO en el runtime de las Edge Functions
// (supabase/edge-runtime#30378). Todo se lee con `Deno.readFile` asíncrono, y los
// ficheros van declarados en `static_files` del bloque de la función en config.toml.
//
// ---------------------------------------------------------------------------
// PROCEDENCIA DE LAS TTF (medido en el spike B.1, 10-09-2026). No son las que
// sirve Google por defecto; están preparadas, y las tres decisiones importan:
//
//  1. ESTÁTICAS, no variables (Sora 600/700, Inter 400/600). Una variable embebida
//     sin instanciar se ve en el peso por defecto y algunos lectores la rechazan.
//     Se piden con un User-Agent antiguo, que es lo que hace que Google devuelva TTF:
//       curl -H 'User-Agent: Mozilla/4.0' \
//         'https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Inter:wght@400;600'
//  2. SUBCONJUNTO de caracteres pedido al propio subsetter de Google con el parámetro
//     `&text=` (ASCII imprimible + Latin-1 + Latin Extended-A + comillas, guiones,
//     el punto volado y el €). Inter entera pesa 325 KB; así pesa 30 KB.
//     ⚠️ Lo que quede fuera de ese conjunto (cirílico, griego, Latin Extended-B) se
//     dibuja como .notdef, o sea un hueco: no revienta, pero no se lee. Si algún día
//     hace falta más alfabeto, se vuelven a pedir con un `&text=` mayor.
//  3. SIN `GSUB`/`GPOS`/`GDEF`. fontkit aplica el shaping en CADA medida y en CADA
//     `drawText`, y eso era el 90 % del coste de CPU del maquetador: 2000 medidas
//     pasaron de 574 ms a 5 ms al quitar esas tablas, con anchos IDÉNTICOS. Para
//     catalán y castellano no hay nada que shapear (se pierden ligaduras estéticas
//     como «fi», nada más).
//
// Y por eso se embeben con `subset: false`: el subsetter de pdf-lib 1.17.1 **pierde
// glifos** con Inter —se comprobó: el texto sale con agujeros, faltan la mayoría de
// las minúsculas— mientras que con Sora funciona. Con las fuentes ya reducidas a
// 30 KB, no subsetear no cuesta casi nada y quita de en medio un bug ajeno.
// ---------------------------------------------------------------------------

import fontkit from "npm:@pdf-lib/fontkit@1";
import type { PDFDocument, PDFFont, PDFImage } from "npm:pdf-lib@1";

/**
 * Los ficheros de origen, en la carpeta `activos/` de la función. Ya no se leen en
 * ejecución —van incrustados, ver `cargarActivos`— pero siguen siendo la fuente de verdad
 * y son lo que lee `scripts/incrustar-activos.ts`.
 */
export const FICHEROS = {
  titulo: "Sora-SemiBold.ttf",
  tituloFuerte: "Sora-Bold.ttf",
  cuerpo: "Inter-Regular.ttf",
  cuerpoFuerte: "Inter-SemiBold.ttf",
  logo: "logo-redestina-pdf.png",
} as const;

export interface BytesActivos {
  titulo: Uint8Array;
  tituloFuerte: Uint8Array;
  cuerpo: Uint8Array;
  cuerpoFuerte: Uint8Array;
  /** Logo positivo sobre blanco, con su propio activo. */
  logo: Uint8Array | null;
}

export interface Fuentes {
  /** Inter 400 — cuerpo de texto. */
  cuerpo: PDFFont;
  /** Inter 600 — énfasis, cabeceras de tabla, etiquetas. */
  cuerpoFuerte: PDFFont;
  /** Sora 600 — títulos (h2, h3). */
  titulo: PDFFont;
  /** Sora 700 — título principal, cabecera. */
  tituloFuerte: PDFFont;
}

/**
 * Lee los activos una sola vez por isolate. Un arranque en frío paga la lectura;
 * las peticiones siguientes reutilizan los mismos bytes (son inmutables: nadie los
 * escribe, solo se pasan a `embedFont`, que copia).
 */
/** Los cinco activos de un PDF, en base64. Los sirve el módulo generado de la función. */
export interface ActivosBase64 {
  titulo: string;
  tituloFuerte: string;
  cuerpo: string;
  cuerpoFuerte: string;
  logo: string;
}

/**
 * Decodifica una vez por isolate. Son inmutables —nadie los escribe, solo se pasan a
 * `embedFont`, que copia—, así que la caché de módulo es segura.
 */
let cache: BytesActivos | null = null;

function deBase64(b64: string): Uint8Array {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/**
 * 🔴 **Los activos van DENTRO del bundle, no en el disco, y eso se aprendió rompiéndolo**
 * (21-09-2026). Hasta ese día se leían con `Deno.readFile` de la carpeta `activos/`, que
 * `static_files` de `config.toml` sube. Un redespliegue con el CLI nuevo cambió el modo de
 * empaquetado y esos ficheros **dejaron de llegar al isolate**: `generar-documento` empezó
 * a responder `path not found` en TODOS los documentos, y como el trigger encola y el job
 * reintenta, el síntoma era una bandeja llena de `error` sin que nada más avisara. Medido
 * en producción: en ese runtime no existe ni el directorio del propio módulo.
 *
 * Un módulo importado viaja siempre con el bundle, se despliegue como se despliegue. Los
 * .ttf y el .png siguen en la carpeta y son la fuente de verdad; `incrustats.ts` es su
 * copia empaquetada y se regenera con `deno run -A scripts/incrustar-activos.ts`.
 */
export function cargarActivos(b64: ActivosBase64): BytesActivos {
  if (cache) return cache;
  cache = {
    titulo: deBase64(b64.titulo),
    tituloFuerte: deBase64(b64.tituloFuerte),
    cuerpo: deBase64(b64.cuerpo),
    cuerpoFuerte: deBase64(b64.cuerpoFuerte),
    // El logo es opcional: un documento sin logo es feo, uno que no se genera es un fallo.
    logo: b64.logo ? deBase64(b64.logo) : null,
  };
  return cache;
}

/** Registra fontkit y embebe las cuatro fuentes en este documento. */
export async function embeberFuentes(
  doc: PDFDocument,
  activos: BytesActivos,
): Promise<Fuentes> {
  doc.registerFontkit(fontkit);
  // `subset: false` A PROPÓSITO (ver la nota de procedencia arriba): las TTF ya vienen
  // reducidas y el subsetter de pdf-lib pierde glifos con Inter.
  const [cuerpo, cuerpoFuerte, titulo, tituloFuerte] = await Promise.all([
    doc.embedFont(activos.cuerpo, { subset: false }),
    doc.embedFont(activos.cuerpoFuerte, { subset: false }),
    doc.embedFont(activos.titulo, { subset: false }),
    doc.embedFont(activos.tituloFuerte, { subset: false }),
  ]);
  return { cuerpo, cuerpoFuerte, titulo, tituloFuerte };
}

/** Embebe el logo, si lo hay. Devuelve `null` cuando no está disponible. */
export async function embeberLogo(
  doc: PDFDocument,
  activos: BytesActivos,
): Promise<PDFImage | null> {
  if (!activos.logo) return null;
  return await doc.embedPng(activos.logo);
}
