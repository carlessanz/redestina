// Certificado de donación (CD) — el modelo de la Fundació (05-11-2026).
//
// Replica `Certificat_Donacio_Tabaquet.pdf` (Drive › 1. Fuentes › Certificats donacio): el
// papel con membrete de la Fundació Espigoladors, una sola página A4 en prosa. Sirve para
// los TRES ámbitos —el anual (`cierres_donante`), el de un periodo y el de una oferta
// (`cierres_periodo`)—: el texto es el mismo y lo único que cambia es cómo se escribe el
// periodo, que resuelve `_shared/certificatDonacio.ts`.
//
// Qué lleva, en orden, y nada más:
//   · el logo de Espigoladors arriba a la derecha (no el de Redestina: es el papel de la
//     Fundació);
//   · el título en negrita a la izquierda;
//   · el cuerpo = la plantilla CONGELADA al emitir (`plantillas_documento`, tipo `CD`, sin
//     variante para el anual y `parcial` para el resto), interpolada con los marcadores de
//     `valorsCertificat()`. El importe va dentro del «Primer», en letras y en cifras, y las
//     dos formas salen del mismo número (`lletres.ts`), así que no pueden discrepar;
//   · el nombre de la apoderada y su cargo, y debajo la firma y el sello en PNG (sin PNG se
//     deja el hueco: un certificado sin firma se firma a mano, que es mejor que no emitirlo);
//   · un pie discreto con el número, el código de verificación y la página, que es lo que
//     permite saber qué versión es y si la ha sustituido otra.
//   · Si el snapshot lo pide (`annex`), una segunda página con el detalle por producto.
//
// 🔴 Sin plantilla congelada NO se imprime nada: se lanza un error. Hasta el 05-11-2026 este
//    fichero llevaba un texto provisional propio para cuando faltaba la plantilla, y eso
//    es justo lo que hizo que el CD anual se imprimiera con un borrador. Hoy la plantilla
//    está en la base (`20270509100300`) y la emisión la exige; si un día falta, el documento
//    queda en `error` en la bandeja, que es visible, en vez de salir con otro texto.
//
// ⚠️ La filigrana «PROVA · SENSE VALIDESA FISCAL» del modo prueba no es decorativa: un
//    ensayo tiene el mismo aspecto, los mismos kilos y el mismo importe que uno real.
//
// El DNI de la apoderada no está en `documentos.datos` (ese jsonb lo lee el donante): lo
// lee `generar-documento` con `service_role` y llega por parámetro.
//
// Contrato de siempre: este fichero no lee ficheros ni habla con la base.

import { PDFDocument } from "npm:pdf-lib@1";
import { type BytesActivos, embeberFuentes, embeberLogoEspigoladors } from "../fuentes.ts";
import { COLORES, type Columna, Maquetador } from "../maquetador.ts";
import { importEnLletres, importEnXifres } from "../lletres.ts";
import { type Bloque, esCuerpo, interpolarCuerpo } from "../plantilla.ts";
import {
  abastDe,
  type AbastCertificat,
  kgText,
  TITOL_CERTIFICAT,
  treureOpcionalsBuits,
  valorsCertificat,
} from "../../certificatDonacio.ts";
import {
  cerrarCierre,
  codigoVerificacion,
  type ContextoCierre,
  diccionarioCierre,
  embeberFirmaYSello,
  fechaLarga,
  type IdiomaCierre,
  MARCA_PRUEBA,
  type OpcionesCierre,
  type Renderizado,
} from "./cierre.ts";
import { pintarSignaturaDocument } from "./signatura.ts";
import { notaFontsCertificat, textMes, type ValorFont } from "../../fontValor.ts";

// ---------------------------------------------------------------------------
// Medidas del modelo (escaneo A4 a 935 px de ancho → 0,636 pt/px)
// ---------------------------------------------------------------------------
// Márgenes del texto, logo y cuerpo tal como se ven en el escaneo. El cuerpo del modelo es
// Arial 10; Inter es algo más ancha, así que va a 9,5 para que los párrafos corten parecido.
const MARGENES = { arriba: 50, abajo: 34, izquierda: 64, derecha: 60 };
const ANCHO_LOGO = 75;
const TAM_TITULO = 11.5;
const TAM_CUERPO = 9.5;
const INTERLINEADO = 1.42;
const ENTRE_PARRAFOS = 9.5;
const ALTO_FIRMA = 70;
const ALTO_SELLO = 120;

/** Lo que el CD dice fuera de la plantilla: muy poco, a propósito. */
const TEXTOS: Record<IdiomaCierre, {
  rectificatiu: (motiu: string) => string;
  verificacio: string;
  annex: string;
  annex_text: (numero: string) => string;
  total: string;
  col: { producte: string; kg: string; valor: string; eur_kg: string; font: string };
}> = {
  ca: {
    rectificatiu: (motiu) => `Certificat rectificatiu${motiu ? ` · Motiu: ${motiu}` : ""}`,
    verificacio: "Codi de verificació",
    annex: "Annex · Detall per producte",
    annex_text: (numero) =>
      `Detall dels aliments donats que suma el certificat de donació${numero ? ` ${numero}` : ""}. Quilos nets conciliats i valor segons el cost per quilo de cada producte.`,
    total: "Total",
    col: { producte: "Producte", kg: "Quilos", valor: "Valor", eur_kg: "€/kg", font: "Font del valor" },
  },
  es: {
    rectificatiu: (motiu) => `Certificado rectificativo${motiu ? ` · Motivo: ${motiu}` : ""}`,
    verificacio: "Código de verificación",
    annex: "Anexo · Detalle por producto",
    annex_text: (numero) =>
      `Detalle de los alimentos donados que suma el certificado de donación${numero ? ` ${numero}` : ""}. Kilos netos conciliados y valor según el coste por kilo de cada producto.`,
    total: "Total",
    col: { producte: "Producto", kg: "Kilos", valor: "Valor", eur_kg: "€/kg", font: "Fuente del valor" },
  },
};

/** «Apoderada», con mayúscula, como firma el modelo. */
function carrecFirma(carrec: unknown): string {
  if (typeof carrec !== "string" || !carrec.trim()) return "";
  const c = carrec.trim();
  return c.charAt(0).toLocaleUpperCase("ca") + c.slice(1);
}

/**
 * El ámbito del certificado. Lo dice el snapshot (`abast`); lo emitido antes del
 * 05-11-2026 no lo trae, y entonces manda `documentos.objeto_tipo`.
 */
function abastDocumento(op: OpcionesCierre): AbastCertificat {
  const datos = op.datos as Record<string, unknown>;
  if (datos.abast === "exercici" || datos.abast === "periode" || datos.abast === "oferta") {
    return datos.abast;
  }
  if (op.objetoTipo === "cierre_periodo") return "periode";
  if (op.objetoTipo === "cierre_donante") return "exercici";
  return abastDe(datos);
}

/**
 * El cuerpo del certificado, interpolado y listo para pintar. Exportado para la prueba:
 * es exactamente el texto que se imprime.
 */
export function cuerpoCertificat(
  op: OpcionesCierre,
  idioma: IdiomaCierre,
): { bloques: Bloque[]; faltan: string[] } {
  const cuerpo = op.plantilla?.cuerpo;
  if (!esCuerpo(cuerpo)) {
    throw new Error(
      "renderCd: el certificat de donació no té plantilla congelada (plantillas_documento CD); no s'imprimeix cap text provisional",
    );
  }
  const datos = op.datos;
  const t = diccionarioCierre(idioma);
  const importe = typeof datos.import === "number" ? datos.import : Number(datos.import ?? 0);
  const valores = valorsCertificat({
    idioma,
    abast: abastDocumento(op),
    datos: datos as Record<string, unknown>,
    apoderadaDni: op.apoderadaDni,
    importLletres: importEnLletres(importe, idioma).texto,
    importXifres: importEnXifres(importe),
    dataExpedicioLlarga: fechaLarga(datos.data_expedicio ?? datos.data_generacio, t, idioma),
  });
  // Los marcadores opcionales vacíos (la factura) se quitan ANTES de interpolar: `bloques.ts`
  // deja impreso un marcador sin valor, que es lo correcto para todos los demás.
  const limpios = cuerpo.map((b): Bloque => {
    if (typeof b.text === "string") return { ...b, text: treureOpcionalsBuits(b.text, valores) };
    if (Array.isArray(b.text)) return { ...b, text: b.text.map((x) => treureOpcionalsBuits(x, valores)) };
    return b;
  });
  return interpolarCuerpo(limpios, valores);
}

/** Pinta los bloques en prosa, sin cajas: párrafos separados como en el modelo. */
function pintarProsa(m: Maquetador, bloques: Bloque[]): void {
  for (const b of bloques) {
    const texto = Array.isArray(b.text) ? b.text.join("\n") : (b.text ?? "");
    switch (b.tipo) {
      case "salt":
        m.saltoPagina();
        break;
      case "lista":
        m.lista(Array.isArray(b.text) ? b.text : [texto], {
          tamano: TAM_CUERPO,
          interlineado: INTERLINEADO,
          despues: ENTRE_PARRAFOS,
        });
        break;
      case "h1":
      case "h2":
      case "h3":
        m.parrafo(texto, {
          fuente: m.fuentes.cuerpoFuerte,
          tamano: TAM_CUERPO,
          interlineado: INTERLINEADO,
          despues: ENTRE_PARRAFOS,
        });
        break;
      case "p":
      default:
        m.parrafo(texto, { tamano: TAM_CUERPO, interlineado: INTERLINEADO, despues: ENTRE_PARRAFOS });
        break;
    }
  }
}

export async function renderCd(
  activos: BytesActivos,
  op: OpcionesCierre,
  idioma?: string | null,
): Promise<Renderizado> {
  const lengua: IdiomaCierre = idioma === "es" ? "es" : "ca";
  const datos = op.datos;
  const t = diccionarioCierre(lengua);
  const x = TEXTOS[lengua];

  // El texto primero: sin plantilla se lanza antes de abrir el PDF.
  const { bloques, faltan } = cuerpoCertificat(op, lengua);
  if (faltan.length) console.warn("renderCd: marcadores sin resolver:", faltan.join(", "));

  const titulo = (op.plantilla?.titulo ?? "").trim() || TITOL_CERTIFICAT[lengua];
  const numero = datos.numero ?? "";
  const codigo = codigoVerificacion(op.sha256Datos);

  const doc = await PDFDocument.create();
  doc.setTitle(`${numero} · ${titulo}`);
  doc.setProducer("Redestina");
  doc.setCreator("Redestina");
  const fuentes = await embeberFuentes(doc, activos);
  const logo = await embeberLogoEspigoladors(doc, activos);

  const m = new Maquetador(doc, {
    fuentes,
    logo,
    membrete: { anchoLogo: ANCHO_LOGO, separacion: 26 },
    margenes: MARGENES,
    pie: [numero, `${x.verificacio} ${codigo}`].filter(Boolean).join(" · "),
    pieSinFilete: true,
    marcaAgua: op.modo === "prueba" ? { texto: MARCA_PRUEBA[lengua] } : null,
    paginacion: t.pagina,
  });
  const ctx: ContextoCierre = { doc, m, t, idioma: lengua, datos, op, logo };

  // ------------------------------------------------------------------ título
  m.parrafo(titulo, { fuente: fuentes.cuerpoFuerte, tamano: TAM_TITULO, despues: 4 });
  if (op.rectificativo) {
    m.parrafo(x.rectificatiu((datos.motiu_rectificacio ?? "").trim()), {
      color: COLORES.verdeGris,
      tamano: 8,
    });
  }
  m.espacio(26);

  // ------------------------------------------------------------------ cuerpo
  pintarProsa(m, bloques);

  // ------------------------------------------------ quién firma, firma y sello
  m.espacio(6);
  const nom = (datos.apoderada?.nom ?? "").trim();
  const carrec = carrecFirma(datos.apoderada?.carrec);
  // El nombre, el cargo y la firma no se separan de página.
  m.asegurar(TAM_CUERPO * INTERLINEADO * 2 + ALTO_SELLO + 20);
  if (nom) m.parrafo(nom, { tamano: TAM_CUERPO, interlineado: INTERLINEADO });
  if (carrec) m.parrafo(carrec, { tamano: TAM_CUERPO, interlineado: INTERLINEADO });

  const { firma, sello } = await embeberFirmaYSello(doc, op);
  m.espacio(12);
  const y = m.y;
  // La firma, a la izquierda; el sello, a su derecha y algo más grande, como en el modelo.
  let xSello = m.x + 40;
  if (firma) {
    const ancho = Math.min((firma.width / firma.height) * ALTO_FIRMA, 190);
    const alto = (firma.height / firma.width) * ancho;
    m.paginaActual.drawImage(firma, { x: m.x + 30, y: y - 20 - alto, width: ancho, height: alto });
    xSello = m.x + 30 + ancho * 0.55;
  }
  if (sello) {
    const ancho = Math.min((sello.width / sello.height) * ALTO_SELLO, 200);
    const alto = (sello.height / sello.width) * ancho;
    m.paginaActual.drawImage(sello, { x: xSello, y: y - alto, width: ancho, height: alto });
  }
  m.espacio(ALTO_SELLO);

  // ------------------------------------------- la firma del donante (versión signat)
  // «Rebut i conforme, el donant», tras la firma de la apoderada y antes del anexo. Solo en
  // la versión firmada con trazo; sin ella, el certificado no cambia ni un punto.
  if (op.signatura) {
    await pintarSignaturaDocument(m, doc, op.signatura, lengua, { tamano: TAM_CUERPO });
  }

  // ------------------------------------------- de dónde salen los valores (D2)
  // Una línea discreta con las fuentes usadas; los certificados de antes de la D2 no traen
  // `fonts_valor` y no cambian ni un punto.
  const nota = notaFontsCertificat(fontsDe(datos), lengua);
  if (nota) {
    m.espacio(4);
    m.parrafo(nota, { tamano: 7.5, color: COLORES.verdeGris });
  }

  // ------------------------------------------------------------------ anexo
  if (datos.annex === true) pintarAnnex(ctx);

  return await cerrarCierre(ctx);
}

/** «Annex · Detall per producte»: la tabla producto/kg/valor, en su propia página. */
function pintarAnnex(ctx: ContextoCierre): void {
  const { m, datos, idioma } = ctx;
  const x = TEXTOS[idioma];
  const detalle = (Array.isArray(datos.detall) ? datos.detall : []).filter((l) => l && l.producte);

  m.saltoPagina();
  m.parrafo(x.annex, { fuente: m.fuentes.cuerpoFuerte, tamano: TAM_TITULO, despues: 6 });
  m.parrafo(x.annex_text(datos.numero ?? ""), {
    tamano: TAM_CUERPO,
    interlineado: INTERLINEADO,
    despues: 12,
  });

  const kgTotal = typeof datos.kg === "number" ? datos.kg : Number(datos.kg ?? 0);
  const importe = typeof datos.import === "number" ? datos.import : Number(datos.import ?? 0);

  // Con la D2, una fila por producto, fuente y mes, con su €/kg y de dónde sale.
  const perFont = detallFontsDe(datos);
  if (perFont.length > 0) {
    m.tabla({
      columnas: [
        { titulo: x.col.producte, ancho: 26 },
        { titulo: x.col.kg, ancho: 15, alinear: "derecha" },
        { titulo: x.col.eur_kg, ancho: 11, alinear: "derecha" },
        { titulo: x.col.font, ancho: 32 },
        { titulo: x.col.valor, ancho: 16, alinear: "derecha" },
      ],
      filas: [
        ...perFont.map((l) => [
          l.producte ?? "",
          `${kgText(l.kg)} kg`,
          eurKgText(l.eur_kg),
          textFontLinia(l, idioma),
          importEnXifres(Number(l.valor ?? 0)),
        ]),
        [x.total, `${kgText(kgTotal)} kg`, "", "", importEnXifres(importe)],
      ],
      tamano: 8.5,
      despues: 6,
    });
    return;
  }

  const columnas: Columna[] = [
    { titulo: x.col.producte, ancho: 50 },
    { titulo: x.col.kg, ancho: 25, alinear: "derecha" },
    { titulo: x.col.valor, ancho: 25, alinear: "derecha" },
  ];
  m.tabla({
    columnas,
    filas: [
      ...detalle.map((l) => [
        l.producte ?? "",
        `${kgText(l.kg)} kg`,
        importEnXifres(Number(l.valor ?? 0)),
      ]),
      [x.total, `${kgText(kgTotal)} kg`, importEnXifres(importe)],
    ],
    tamano: 9,
    despues: 6,
  });
}

/** Una fila del anexo por producto, fuente y mes (snapshot `detall_fonts`, desde la D2). */
interface LiniaFont extends ValorFont {
  producte?: string | null;
  kg?: number | string | null;
  eur_kg?: number | string | null;
  valor?: number | string | null;
}

function fontsDe(datos: unknown): ValorFont[] {
  const f = (datos as { fonts_valor?: unknown }).fonts_valor;
  return Array.isArray(f) ? (f as ValorFont[]) : [];
}

function detallFontsDe(datos: unknown): LiniaFont[] {
  const f = (datos as { detall_fonts?: unknown }).detall_fonts;
  return Array.isArray(f) ? (f as LiniaFont[]).filter((l) => l && l.producte) : [];
}

/** «Gencat, setembre 2026» / «Mercabarna (18 dies), novembre 2026» / «Declarat pel donant». */
export function textFontLinia(l: ValorFont, idioma: IdiomaCierre): string {
  const ca = idioma === "ca";
  const mes = textMes(l.mes_font, idioma);
  switch (l.font) {
    case "gencat": return mes ? `Gencat, ${mes}` : "Gencat";
    case "mercabarna": {
      const dies = l.dies ? ` (${l.dies} ${ca ? "dies" : "días"})` : "";
      return `Mercabarna${dies}${mes ? `, ${mes}` : ""}`;
    }
    case "manual": case "fixat": return ca ? "Fixat per la Fundació" : "Fijado por la Fundació";
    case "declarat": return ca ? "Declarat pel donant" : "Declarado por el donante";
    case "historic": return ca ? "Referència del producte" : "Referencia del producto";
    default: return "—";
  }
}

/** El valor por kilo con 2 a 4 decimales y coma: «0,80», «0,8235». */
export function eurKgText(v: number | string | null | undefined): string {
  const n = Number(v);
  if (v == null || !isFinite(n)) return "—";
  return n.toFixed(4).replace(/0{1,2}$/, "").replace(".", ",");
}
