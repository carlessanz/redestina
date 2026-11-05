// La firma de la CONTRAPARTE sobre un documento ya emitido (05-11-2026, circuito de firma
// unificado): el donante en el CD y el REC, la entidad receptora en el CR y el ENT.
//
// Firmar no edita el documento (es inmutable): emite la versión n+1 con `subtipo = 'signat'`,
// el MISMO snapshot y el MISMO código de verificación, y `generar-documento` la pinta con
// esto encima. Lo que se pinta NO sale del snapshot —el snapshot es el del documento que se
// firmó, y la firma llegó después—: sale de `firmes_document` y `evidencias`, leídas con
// `service_role` en el momento de generar (igual que las confirmaciones del albarán y el
// trazo del convenio), y llega aquí ya resuelto en `op.signatura`.
//
// Dos maneras de pintarla, una por familia de papel:
//   · CD y CR (y los albaranes antiguos, de flujo): un bloque al pie «Rebut i conforme, …»
//     con el trazo, «Nom · Càrrec · DNI» y la vía (`pintarSignaturaDocument`);
//   · el albarán de una página (`albara1p.ts`): el trazo DENTRO de la caja de firma que ya
//     existe, con «Signat per …» (sin DNI: el albarán lo lee también la otra parte).
//
// Un trazo que no se puede embeber no impide emitir: se avisa y queda el texto (mismo
// criterio que `embeberFirmaYSello`). Sin `op.signatura`, nada de esto existe y el papel
// sale exactamente como antes.
//
// Contrato de siempre: no lee ficheros ni habla con la base.

import type { PDFDocument, PDFImage } from "npm:pdf-lib@1";
import { COLORES, type Maquetador } from "../maquetador.ts";

export interface SignaturaDocument {
  /** `firmes_document.part`: `donant` · `receptor` · `organitzacio`. */
  part: string;
  /** `evidencias.nombre`. */
  nom: string | null;
  /** `evidencias.cargo`. */
  carrec: string | null;
  /** `evidencias.documento_identidad` (fuera del GRANT de SELECT: solo `service_role`). */
  dni: string | null;
  /** `evidencias.created_at`: el instante de la firma. */
  data: string | null;
  /** El PNG del trazo (bucket `documentos`), o null si no se pudo bajar. */
  trazoPng: Uint8Array | null;
  /** `enlaces_token.canal` del enlace con el que se firmó: `panel` · `email` · `asistido`. */
  canal: string | null;
}

export type IdiomaSignatura = "ca" | "es";

const TXT: Record<IdiomaSignatura, {
  titol: Record<string, string>;
  signat_el: string;
  signat: string;
  signat_per: string;
  via: { panel: string; email: string; asistido: string };
  dni: string;
}> = {
  ca: {
    titol: {
      donant: "Rebut i conforme, el donant",
      receptor: "Rebut i conforme, l'entitat receptora",
      organitzacio: "Rebut i conforme, l'organització",
    },
    signat_el: "Signat el",
    signat: "Signat",
    signat_per: "Signat per",
    via: { panel: "des del panell", email: "des de l'enllaç", asistido: "amb acompanyament" },
    dni: "DNI",
  },
  es: {
    titol: {
      donant: "Recibido y conforme, el donante",
      receptor: "Recibido y conforme, la entidad receptora",
      organitzacio: "Recibido y conforme, la organización",
    },
    signat_el: "Firmado el",
    signat: "Firmado",
    signat_per: "Firmado por",
    via: { panel: "desde el panel", email: "desde el enlace", asistido: "con acompañamiento" },
    dni: "DNI",
  },
};

export function textosSignatura(idioma: IdiomaSignatura) {
  return TXT[idioma];
}

/** dd/mm/aaaa en la hora de Madrid (la firma es un instante; el papel dice el día). */
export function dataSignatura(valor: string | null | undefined): string {
  if (!valor) return "";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ca-ES", {
    timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
}

/** La vía, en palabras: «des del panell», «des de l'enllaç», «amb acompanyament». */
export function viaSignatura(idioma: IdiomaSignatura, canal: string | null | undefined): string {
  const v = TXT[idioma].via;
  return canal === "panel" ? v.panel : canal === "asistido" ? v.asistido : v.email;
}

/** El título del bloque según quién firma. */
export function titolSignatura(idioma: IdiomaSignatura, part: string): string {
  return TXT[idioma].titol[part] ?? TXT[idioma].titol.organitzacio;
}

/** El trazo embebido en este PDF, o null (un PNG ilegible no impide emitir). */
export async function embeberTrazo(doc: PDFDocument, s: SignaturaDocument): Promise<PDFImage | null> {
  if (!s.trazoPng || s.trazoPng.length === 0) return null;
  try {
    return await doc.embedPng(s.trazoPng);
  } catch (e) {
    console.warn("signatura: traç no embebible:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

const ALTO_TRAZO = 50;
const ANCHO_MAX_TRAZO = 200;

/**
 * El bloque «Rebut i conforme» al pie de un documento de flujo (CD, CR, albaranes antiguos).
 * Título, trazo (alto 50), una línea «Nom · Càrrec · DNI …» y otra «Signat el dd/mm/aaaa des
 * del panell». No se parte entre páginas.
 */
export async function pintarSignaturaDocument(
  m: Maquetador,
  doc: PDFDocument,
  s: SignaturaDocument,
  idioma: IdiomaSignatura,
  op: { tamano?: number; ambDni?: boolean } = {},
): Promise<void> {
  const t = TXT[idioma];
  const tamano = op.tamano ?? 9.5;
  const trazo = await embeberTrazo(doc, s);

  m.espacio(6);
  m.asegurar(tamano * 1.4 * 3 + ALTO_TRAZO + 12);
  m.parrafo(titolSignatura(idioma, s.part), {
    fuente: m.fuentes.cuerpoFuerte,
    tamano,
    interlineado: 1.4,
    despues: 4,
  });
  if (trazo) {
    const ancho = Math.min((trazo.width / trazo.height) * ALTO_TRAZO, ANCHO_MAX_TRAZO);
    const alto = (trazo.height / trazo.width) * ancho;
    m.paginaActual.drawImage(trazo, { x: m.x, y: m.y - alto, width: ancho, height: alto });
    m.espacio(ALTO_TRAZO + 2);
  } else {
    // Sin trazo, el hueco con su línea: queda claro dónde estaba la firma.
    m.espacio(ALTO_TRAZO - 10);
  }
  m.paginaActual.drawLine({
    start: { x: m.x, y: m.y },
    end: { x: m.x + ANCHO_MAX_TRAZO, y: m.y },
    thickness: 0.5,
    color: COLORES.crema300,
  });
  m.espacio(4);
  const quien = [
    s.nom,
    s.carrec,
    op.ambDni !== false && s.dni ? `${t.dni} ${s.dni}` : null,
  ].map((v) => (v ?? "").trim()).filter(Boolean).join(" · ");
  if (quien) m.parrafo(quien, { tamano, interlineado: 1.4 });
  const dia = dataSignatura(s.data);
  const quan = `${dia ? `${t.signat_el} ${dia}` : t.signat} ${viaSignatura(idioma, s.canal)}`;
  m.parrafo(quan, { tamano: tamano - 1, interlineado: 1.4, color: COLORES.verdeGris });
}
