// Extrae el texto de un PDF generado por el maquetador, para las pruebas de Deno.
//
// No es un lector de PDF general: entiende exactamente lo que escribe `pdf-lib` con las
// fuentes del sistema documental, y nada más. Por eso no necesita ninguna dependencia nueva:
//   · cada página tiene uno o varios content streams comprimidos con Flate;
//   · el texto se pinta con `/<Fuente>-NNNN <tam> Tf` y `<hex> Tj`, donde el hex son los
//     identificadores de glifo de la fuente (Identity-H, 4 cifras por glifo);
//   · las fuentes se embeben enteras (`subset: false`, `fuentes.ts`), así que el glifo del
//     PDF es el glifo de la TTF y se traduce con la propia TTF y fontkit.
// Cada `Tj` es una línea del maquetador: se devuelven unidas por salto de línea.

import fontkit from "npm:@pdf-lib/fontkit@1";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  type PDFRef,
} from "npm:pdf-lib@1";
import type { BytesActivos } from "../../supabase/functions/_shared/pdf/fuentes.ts";

type Mapa = Map<number, string>;

function mapaDe(bytes: Uint8Array): Mapa {
  // deno-lint-ignore no-explicit-any
  const font: any = fontkit.create(bytes);
  const mapa: Mapa = new Map();
  for (const cp of font.characterSet as number[]) {
    const g = font.glyphForCodePoint(cp);
    if (g && !mapa.has(g.id)) mapa.set(g.id, String.fromCodePoint(cp));
  }
  return mapa;
}

/** Texto de cada página del PDF. */
export async function textPerPagina(bytes: Uint8Array, activos: BytesActivos): Promise<string[]> {
  const mapas: Record<string, Mapa> = {
    "Inter-Regular": mapaDe(activos.cuerpo),
    "Inter-SemiBold": mapaDe(activos.cuerpoFuerte),
    "Sora-SemiBold": mapaDe(activos.titulo),
    "Sora-Bold": mapaDe(activos.tituloFuerte),
  };
  const doc = await PDFDocument.load(bytes);
  const salida: string[] = [];
  for (const pagina of doc.getPages()) {
    const contents = pagina.node.Contents();
    const streams: PDFRawStream[] = [];
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const s = doc.context.lookup(contents.get(i) as PDFRef);
        if (s instanceof PDFRawStream) streams.push(s);
      }
    } else if (contents instanceof PDFRawStream) {
      streams.push(contents);
    }
    const lineas: string[] = [];
    for (const s of streams) {
      const ops = new TextDecoder("latin1").decode(decodePDFRawStream(s).decode());
      let mapa: Mapa = mapas["Inter-Regular"];
      for (const m of ops.matchAll(/\/([A-Za-z-]+?)-\d+ [\d.]+ Tf|<([0-9A-Fa-f]*)> Tj/g)) {
        if (m[1]) {
          mapa = mapas[m[1]] ?? mapa;
          continue;
        }
        const hex = m[2] ?? "";
        let linea = "";
        for (let i = 0; i + 4 <= hex.length; i += 4) {
          linea += mapa.get(parseInt(hex.slice(i, i + 4), 16)) ?? "�";
        }
        lineas.push(linea);
      }
    }
    salida.push(lineas.join("\n"));
  }
  return salida;
}

/** El texto de todas las páginas, con los cortes de línea convertidos en espacios. */
export function enUnaLinia(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
