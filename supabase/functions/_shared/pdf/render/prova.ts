// Documento de PROVA del spike B.1.
//
// No es decorativo: es el banco de pruebas del maquetador y del criterio de salida
// del plan (6 páginas, Sora/Inter embebidas, tabla de 40 líneas con cabecera
// repetida, pie «pàg. n de N», marca de agua y un PNG estampado, por debajo de
// 800 ms de CPU en el runtime desplegado). Cada elemento que aparece aquí es uno que
// los documentos reales van a necesitar —albarán, certificado, resumen anual—, así
// que si algo se rompe al cambiar el maquetador, se rompe aquí primero.
//
// El renderizador NO lee ficheros ni habla con la base: recibe los activos ya leídos
// y los datos ya consultados. Así se puede ejecutar desde un script suelto en local
// (que es como se valida la maquetación) y desde la Edge Function sin cambiar nada.

import { PDFDocument } from "npm:pdf-lib@1";
import { type BytesActivos, embeberFuentes, embeberLogo } from "../fuentes.ts";
import { COLORES, Maquetador } from "../maquetador.ts";
import { interpolarCuerpo, pintarCuerpo } from "../plantilla.ts";

/** Una línea del detalle, tal como la trae `documentos.datos.linies` (contrato de `dades`). */
export interface LineaProva {
  ordre?: number;
  concepte?: string;
  unitats?: number;
  kg?: number;
}

export interface DatosProva {
  numero?: string;
  fecha?: string;
  organizacion?: string;
  titulo?: string;
  nota?: string;
  /** `prueba` añade marca de agua; `real` no la lleva. */
  modo?: "real" | "prueba";
  /**
   * Las líneas del detalle. Si no vienen, se inventan `lineas` (40 por defecto, que
   * es lo que pide el criterio de salida del spike).
   */
  lineas?: LineaProva[] | number;
  /** Páginas mínimas: si el contenido no llega, se añaden anexos hasta cubrirlas. */
  paginasMinimas?: number;
  sha256Datos?: string;
}

export interface Renderizado {
  bytes: Uint8Array;
  paginas: number;
}

const PRODUCTOS = [
  ["Tomàquet", "Cor de bou", "Calaix 20 kg"],
  ["Poma", "Golden", "Palot 300 kg"],
  ["Carbassó", "Verd", "Calaix 15 kg"],
  ["Enciam", "Trocadero", "Caixa 12 u."],
  ["Pera", "Conference", "Palot 280 kg"],
  ["Cogombre", "Llarg", "Calaix 18 kg"],
  ["Albergínia", "Negra", "Calaix 16 kg"],
  ["Préssec", "Groc", "Caixa 10 kg"],
];

const MUNICIPIOS = [
  "Gavà",
  "Viladecans",
  "El Prat de Llobregat",
  "Sant Boi de Llobregat",
  "Castelldefels",
  "Sant Vicenç dels Horts",
];

/** Cuerpo de plantilla con marcadores, igual que el que vivirá en la base (§B.1). */
const CUERPO_PLANTILLA = [
  {
    tipo: "h2" as const,
    text: "Condicions del document",
  },
  {
    tipo: "p" as const,
    text:
      "Aquest document ha estat generat automàticament per REDESTINA, el servei de canalització d'aliments fora del circuit de venda habitual de la Fundació Espigoladors, a nom de {{organitzacio}} amb data {{data}}. El número {{numero}} pertany a la sèrie documental corresponent i no es reutilitza mai, ni tan sols si el document s'anul·la.",
  },
  {
    tipo: "p" as const,
    text:
      "Les dades que conté provenen del registre de l'operació en el moment de l'emissió. El codi de verificació {{codi}} és l'empremta d'aquestes dades: si el contingut canviés, el codi deixaria de coincidir i el document quedaria invalidat.",
  },
  {
    tipo: "lista" as const,
    text: [
      "Els quilos oficials són els conciliats, no els previstos.",
      "Cap certificat s'emet abans de la conciliació de l'operació.",
      "Els documents en mode prova porten filigrana i sèrie amb prefix P-.",
      "L'original signat es conserva a l'expedient de l'organització {{organitzacio}}.",
    ],
  },
];

/**
 * Líneas inventadas cuando `datos` no trae ninguna. Los conceptos son largos a
 * propósito: así la tabla ejercita el corte de línea DENTRO de una casilla, que es
 * donde se rompen las tablas de verdad.
 */
function lineasInventadas(n: number): LineaProva[] {
  const lineas: LineaProva[] = [];
  for (let i = 1; i <= n; i++) {
    const [producto, variedad, envase] = PRODUCTOS[i % PRODUCTOS.length];
    lineas.push({
      ordre: i,
      concepte: `${producto} ${variedad} · ${MUNICIPIOS[i % MUNICIPIOS.length]} · ${envase}` +
        (i % 9 === 0 ? " (segona categoria, apte per a transformació)" : ""),
      unitats: 1 + (i % 12),
      kg: 40 + ((i * 37) % 460),
    });
  }
  return lineas;
}

function filasDeLineas(lineas: LineaProva[]): (string | number | null)[][] {
  return lineas.map((l, i) => [
    String(l.ordre ?? i + 1).padStart(3, "0"),
    l.concepte ?? "",
    l.unitats ?? null,
    typeof l.kg === "number" ? l.kg.toFixed(1) : null,
  ]);
}

export async function renderProva(
  activos: BytesActivos,
  datos: DatosProva = {},
): Promise<Renderizado> {
  const numero = datos.numero ?? "PROVA-2026-00001";
  const fecha = datos.fecha ?? new Date().toISOString().slice(0, 10);
  const organizacion = datos.organizacion ?? "Fundació Espigoladors";
  const modo = datos.modo ?? "prueba";
  const lineas = Array.isArray(datos.lineas)
    ? datos.lineas
    : lineasInventadas(typeof datos.lineas === "number" ? datos.lineas : 40);
  const paginasMinimas = datos.paginasMinimas ?? 6;

  const doc = await PDFDocument.create();
  doc.setTitle(`${numero} · Document de prova`);
  doc.setProducer("Redestina");
  doc.setCreator("Redestina");
  const fuentes = await embeberFuentes(doc, activos);
  const logo = await embeberLogo(doc, activos);

  const m = new Maquetador(doc, {
    fuentes,
    logo,
    cabecera: numero,
    subcabecera: `Emès el ${fecha}`,
    pie: "Fundació Espigoladors · REDESTINA · document generat automàticament",
    marcaAgua: modo === "prueba" ? { texto: "Prova" } : null,
  });

  // ---------------------------------------------------------------- portada
  m.titulo(datos.titulo ?? "Document de prova del sistema documental", 1);
  m.parrafo(
    "Aquest document existeix per verificar que el generador de PDF de REDESTINA produeix, dins dels límits del runtime, un document de diverses pàgines amb tipografia corporativa incrustada, taules paginades, filigrana i imatges.",
    { color: COLORES.verdeGris, despues: 10 },
  );

  m.campos([
    ["Número", numero],
    ["Data d'emissió", fecha],
    ["Organització", organizacion],
    ["Mode", modo === "prueba" ? "Prova (no té validesa)" : "Real"],
    ["Codi de verificació", datos.sha256Datos ?? "(sense dades)"],
  ], { despues: 6 });

  m.caja(
    datos.nota ??
      "Els documents en mode prova porten filigrana, sèrie amb prefix P- i mai s'envien a un destinatari real. Serveixen per assajar el tancament anual sense contaminar la sèrie oficial.",
    { titulo: "Què és el mode prova" },
  );

  // ------------------------------------------------------- cuerpo con marcadores
  const { bloques, faltan } = interpolarCuerpo(CUERPO_PLANTILLA, {
    organitzacio: organizacion,
    data: fecha,
    numero,
    codi: datos.sha256Datos ?? "—",
  });
  pintarCuerpo(m, bloques);
  if (faltan.length) console.warn("prova: marcadores sin resolver:", faltan.join(", "));

  // ------------------------------------------------------------------- tabla
  m.titulo("Detall de les operacions", 2);
  m.parrafo(
    `La taula següent té ${lineas.length} línies i travessa diverses pàgines. La capçalera es repeteix a cada salt: una taula partida sense capçalera obliga a tornar enrere per saber què és cada columna.`,
    { despues: 8 },
  );
  m.tabla({
    columnas: [
      { titulo: "#", ancho: 8, alinear: "derecha" },
      { titulo: "Concepte", ancho: 62 },
      { titulo: "Unitats", ancho: 14, alinear: "derecha" },
      { titulo: "Kg", ancho: 16, alinear: "derecha" },
    ],
    filas: filasDeLineas(lineas),
    cebra: true,
    padding: 5,
    despues: 14,
  });
  const totalKg = lineas.reduce((s, l) => s + (typeof l.kg === "number" ? l.kg : 0), 0);
  m.parrafo(`Total: ${totalKg.toFixed(1)} kg en ${lineas.length} línies.`, {
    fuente: fuentes.cuerpoFuerte,
    alinear: "derecha",
    despues: 6,
  });

  // ------------------------------------------------------------- anexos de relleno
  let anexo = 1;
  while (m.numPaginas < paginasMinimas) {
    m.titulo(`Annex ${anexo}. Notes tècniques`, 2);
    for (let i = 0; i < 6; i++) {
      m.parrafo(
        "El maquetador mesura cada línia amb la font real abans de dibuixar-la, de manera que el text mai no surt del marge encara que la font canviï. Quan una paraula no hi cap —una adreça, un NIF enganxat, una URL— es parteix per caràcters: val més un tall lleig que un desbordament. Els salts de pàgina són automàtics i el peu s'escriu al final, quan ja se sap quantes pàgines hi ha.",
        { despues: 6 },
      );
    }
    anexo++;
  }

  // ------------------------------------------------ firma con PNG estampado
  m.titulo("Signatura i segell", 2);
  m.parrafo(
    "El PNG següent s'estampa des dels actius de la funció. Als documents reals aquí hi va la signatura de l'apoderada i el segell de la Fundació, que viuen en un bucket privat i mai al bundle.",
    { despues: 10 },
  );
  if (logo) m.imagen(logo, { ancho: 150, despues: 6 });
  m.parrafo("Fundació Espigoladors", { fuente: fuentes.cuerpoFuerte, tamano: 10 });
  m.parrafo(`Signat digitalment el ${fecha}`, {
    color: COLORES.verdeGris,
    tamano: 9,
  });

  m.finalizar();
  const bytes = await doc.save();
  return { bytes, paginas: m.numPaginas };
}
