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

/** Nombres de fichero esperados dentro de la carpeta `activos/` de la función. */
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
  /** Logo positivo sobre blanco. `logo-email.png` es el NEGATIVO y no sirve aquí. */
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
const cache = new Map<string, Promise<BytesActivos>>();

export function cargarActivos(base: URL): Promise<BytesActivos> {
  const clave = base.href;
  const guardado = cache.get(clave);
  if (guardado) return guardado;

  const leer = async (nombre: string) => await Deno.readFile(new URL(nombre, base));
  const promesa = (async (): Promise<BytesActivos> => {
    const [titulo, tituloFuerte, cuerpo, cuerpoFuerte] = await Promise.all([
      leer(FICHEROS.titulo),
      leer(FICHEROS.tituloFuerte),
      leer(FICHEROS.cuerpo),
      leer(FICHEROS.cuerpoFuerte),
    ]);
    // El logo es opcional: un documento sin logo es feo, uno que no se genera es un
    // fallo. Si falta el fichero, se sigue adelante sin él.
    let logo: Uint8Array | null = null;
    try {
      logo = await leer(FICHEROS.logo);
    } catch (e) {
      console.warn("pdf: sin logo:", e instanceof Error ? e.message : String(e));
    }
    return { titulo, tituloFuerte, cuerpo, cuerpoFuerte, logo };
  })();

  // Si la lectura falla no se cachea el fallo: el siguiente intento vuelve a probar.
  promesa.catch(() => cache.delete(clave));
  cache.set(clave, promesa);
  return promesa;
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
