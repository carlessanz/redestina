// El albarán de UNA PÁGINA (fase 3 de la revisión del cliente del 08-10-2026).
//
// Reproduce el «albarà de recepció» que ya usa Espigoladors (imagen del cliente en
// `3. Claude Code/capturas/2026-10-08-albara-recepcio-espigoladors.png`): dos cajas de
// cabecera (título y logo), la frase de trazabilidad de las donaciones, la caja de la parte,
// la fecha de elaboración, el rótulo de la modalidad, una tabla de ocho filas fijas con
// número, fecha, producto, kilos, valor de referencia por unidad e importe, la nota legal,
// el pie de la Fundació y la caja de la firma. «Que en pocos segundos se entienda: qui
// entrega → qui rep → què → quants kg → quan → on → modalitat.»
//
// Lo usan los documentos con `datos.format = 'albara-1p'` (el snapshot de
// `20270418100000`). Los ya emitidos no lo llevan y se siguen pintando con `rec.ts`,
// `ent.ts` y `ope.ts`: `documentos` es inmutable y un papel de ayer no cambia de cara.
//
// 🔴 EUROS SOLO EN EL REC DE DONACIÓN. El snapshot solo trae `valor_kg` ahí (D3: en el ENT lo
//    vería la entidad; en venta y maquila el cliente no quiere «menciones de donación»). Aquí
//    se respeta lo que traiga: sin `valor_kg` en ninguna línea, la tabla no tiene columnas de
//    euros. El IMPORTE se calcula al pintar, no se guarda.
//
// Dibuja a mano con pdf-lib sobre las piezas del motor (fuentes, logo, colores del sistema
// de diseño); el `Maquetador` es de flujo de párrafos y aquí hacen falta cajas fijas.

import { PDFDocument, type PDFFont, type PDFPage, degrees, rgb } from "npm:pdf-lib@1";
import { type BytesActivos, embeberFuentes, embeberLogo } from "../fuentes.ts";
import { A4, COLORES, sanear } from "../maquetador.ts";
import {
  codigoVerificacion, type ConfirmacionAlbaran, type DatosAlbaran, fecha, type LineaAlbaran,
  lineasDe, num, type OpcionesAlbaran, type ParteAlbaran, type Renderizado, textoIncidencias,
} from "./comu.ts";

type Idioma = "ca" | "es";

/** Lo que el snapshot `albara-1p` añade sobre el de siempre. */
export interface DatosAlbara1p extends DatosAlbaran {
  format?: string | null;
  data_elaboracio?: string | null;
  modalitat?: string | null;
  fundacio?: { razon_social?: string | null; nif?: string | null; domicilio?: string | null } | null;
  linies?: (LineaAlbaran & { valor_kg?: number | null })[] | null;
}

const TXT = {
  ca: {
    rec: "ALBARÀ DE RECEPCIÓ", ent: "ALBARÀ D'ENTREGA", ope_venda: "ALBARÀ DE VENDA",
    ope_maquila: "ALBARÀ DE MAQUILA", rectificatiu: "RECTIFICATIU",
    legal_rec: "Aquest document té la consideració d'albarà de recepció a efectes de traçabilitat de les donacions en espècie.",
    legal_ent: "Aquest document té la consideració d'albarà d'entrega a efectes de traçabilitat de les donacions en espècie.",
    data_elaboracio: "Data d'elaboració",
    donacio: "DONACIÓ", venda: "VENDA", maquila: "MAQUILA", espigolament: "DONACIÓ · ESPIGOLAMENT",
    c_numero: "Número albarà", c_data: "Data", c_producte: "Producte", c_kg: "Quilos",
    c_valor: "Valor de referència per unitat", c_import: "Import total", c_varietat: "Varietat",
    total: "Total",
    nota_valor: "El valor assignat als productes és orientatiu i s'ha establert a partir dels albarans de recepció i de preus de referència oficials (Observatori Agrari {any}), sense superar en cap cas el valor normal de mercat en el moment de la seva transmissió, d'acord amb l'article 18 de la Llei 49/2002.",
    provisional: "Text provisional, pendent de validar per l'assessoria.",
    gracies: "Gràcies per confiar en nosaltres,", atentament: "Atentament,", equip: "Equip de Redestina",
    firma_rec: "Firma del donant:", firma_ent: "Conformitat de qui rep:", firma_entrega: "Conformitat de qui lliura:",
    firma_recibe: "Conformitat de qui rep:",
    confirmat: "Confirmat per", via_enllac: "des de l'enllaç", via_assistit: "amb acompanyament de l'equip",
    via_panell: "des del panell", via_whatsapp: "per WhatsApp", ref: "ref.",
    pendent: "Pendent de confirmar",
    recollida: "Recollida", origen: "Origen", lot: "Lot", incidencies: "Incidències", observacions: "Observacions",
    ofertant: "Ofertant", receptor: "Receptor",
    verificacio: "Codi de verificació", pagina: (n: number, t: number) => `pàg. ${n} de ${t}`, prova: "PROVA",
  },
  es: {
    rec: "ALBARÁN DE RECEPCIÓN", ent: "ALBARÁN DE ENTREGA", ope_venda: "ALBARÁN DE VENTA",
    ope_maquila: "ALBARÁN DE MAQUILA", rectificatiu: "RECTIFICATIVO",
    legal_rec: "Este documento tiene la consideración de albarán de recepción a efectos de trazabilidad de las donaciones en especie.",
    legal_ent: "Este documento tiene la consideración de albarán de entrega a efectos de trazabilidad de las donaciones en especie.",
    data_elaboracio: "Fecha de elaboración",
    donacio: "DONACIÓN", venda: "VENTA", maquila: "MAQUILA", espigolament: "DONACIÓN · ESPIGUEO",
    c_numero: "Número albarán", c_data: "Fecha", c_producte: "Producto", c_kg: "Kilos",
    c_valor: "Valor de referencia por unidad", c_import: "Importe total", c_varietat: "Variedad",
    total: "Total",
    nota_valor: "El valor asignado a los productos es orientativo y se ha establecido a partir de los albaranes de recepción y de precios de referencia oficiales (Observatori Agrari {any}), sin superar en ningún caso el valor normal de mercado en el momento de su transmisión, de acuerdo con el artículo 18 de la Ley 49/2002.",
    provisional: "Texto provisional, pendiente de validar por la asesoría.",
    gracies: "Gracias por confiar en nosotros,", atentament: "Atentamente,", equip: "Equipo de Redestina",
    firma_rec: "Firma del donante:", firma_ent: "Conformidad de quien recibe:", firma_entrega: "Conformidad de quien entrega:",
    firma_recibe: "Conformidad de quien recibe:",
    confirmat: "Confirmado por", via_enllac: "desde el enlace", via_assistit: "con acompañamiento del equipo",
    via_panell: "desde el panel", via_whatsapp: "por WhatsApp", ref: "ref.",
    pendent: "Pendiente de confirmar",
    recollida: "Recogida", origen: "Origen", lot: "Lote", incidencies: "Incidencias", observacions: "Observaciones",
    ofertant: "Ofertante", receptor: "Receptor",
    verificacio: "Código de verificación", pagina: (n: number, t: number) => `pág. ${n} de ${t}`, prova: "PRUEBA",
  },
} as const;

const MARGEN = 40;
const ANCHO = A4.ancho - 2 * MARGEN;
const FILAS_FIJAS = 8;
const ALTO_FILA = 17;
const LIMITE = 90; // por debajo empieza el pie de la página

/** Los kilos que cuentan en el papel: validados, si no confirmados, si no netos o previstos. */
export function kgDeLinea(l: LineaAlbaran): number | null {
  const v = l.kg_validats ?? l.kg_confirmats ?? l.kg_net ?? l.kg_previstos;
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** Importe de una línea, redondeado al céntimo. Null si falta el valor o los kilos. */
export function importDeLinea(l: LineaAlbaran & { valor_kg?: number | null }): number | null {
  const kg = kgDeLinea(l);
  if (kg == null || l.valor_kg == null || !isFinite(l.valor_kg)) return null;
  return Math.round(kg * l.valor_kg * 100) / 100;
}

export async function renderAlbara1p(activos: BytesActivos, op: OpcionesAlbaran): Promise<Renderizado> {
  const datos = op.datos as DatosAlbara1p;
  const idioma: Idioma = datos.idioma === "es" ? "es" : "ca";
  const t = TXT[idioma];
  const tipo = (datos.tipus ?? "REC").replace(/^R-/, "");
  const modalitat = datos.modalitat ?? (tipo === "OPE" ? "venda" : "donacio");
  const donacio = modalitat === "donacio";
  const lineas = lineasDe(datos) as (LineaAlbaran & { valor_kg?: number | null })[];
  const ambEuros = lineas.some((l) => l.valor_kg != null);

  const doc = await PDFDocument.create();
  const numero = datos.numero ?? "";
  doc.setTitle(`${numero} · ${tipo}`);
  doc.setProducer("Redestina");
  doc.setCreator("Redestina");
  const f = await embeberFuentes(doc, activos);
  const logo = await embeberLogo(doc, activos);

  const pagines: PDFPage[] = [];
  let p = doc.addPage([A4.ancho, A4.alto]);
  pagines.push(p);
  let y = A4.alto - MARGEN;

  // ------------------------------------------------------------------ helpers
  const ample = (s: string, font: PDFFont, size: number) => font.widthOfTextAtSize(s, size);
  const text = (s: unknown, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; max?: number; dreta?: boolean; centre?: boolean } = {}) => {
    const font = o.font ?? f.cuerpo;
    const size = o.size ?? 9;
    let s2 = sanear(s).replace(/\n/g, " ");
    if (o.max) while (s2.length > 1 && ample(s2, font, size) > o.max) s2 = s2.slice(0, -2) + "…";
    const w = ample(s2, font, size);
    const xx = o.dreta ? x - w : o.centre ? x - w / 2 : x;
    p.drawText(s2, { x: xx, y: yy, size, font, color: o.color ?? COLORES.negro });
  };
  /** Párrafo con corte de línea; devuelve la nueva y. */
  const parrafo = (s: string, x: number, yy: number, w: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; centre?: boolean } = {}) => {
    const font = o.font ?? f.cuerpo;
    const size = o.size ?? 8;
    const paraules = sanear(s).split(/\s+/).filter(Boolean);
    let linia = "";
    let yy2 = yy;
    const pinta = (l: string) => {
      text(l, o.centre ? x + w / 2 : x, yy2, { font, size, color: o.color, centre: o.centre });
      yy2 -= size + 3;
    };
    for (const pa of paraules) {
      const prova = linia ? `${linia} ${pa}` : pa;
      if (ample(prova, font, size) > w && linia) { pinta(linia); linia = pa } else linia = prova;
    }
    if (linia) pinta(linia);
    return yy2;
  };
  const caixa = (x: number, yTop: number, w: number, h: number, fons?: ReturnType<typeof rgb>) => {
    p.drawRectangle({ x, y: yTop - h, width: w, height: h, color: fons, borderColor: COLORES.negro, borderWidth: 0.6 });
  };

  // ------------------------------------------------------------- cabecera
  const titol = tipo === "REC" ? t.rec : tipo === "ENT" ? t.ent : modalitat === "maquila" ? t.ope_maquila : t.ope_venda;
  const hCap = 64;
  const wTitol = ANCHO * 0.48;
  caixa(MARGEN, y, wTitol, hCap, COLORES.verdeSuave);
  caixa(MARGEN + wTitol, y, ANCHO - wTitol, hCap, COLORES.crema100);
  // Dos líneas: el tipo arriba y el número debajo. En una sola, «ALBARÀ DE
  // RECEPCIÓ REC-2026-00042» no cabe en la caja y el número salía cortado.
  const ambNumero = Boolean(numero);
  text(titol, MARGEN + wTitol / 2, y - hCap / 2 + (ambNumero ? 3 : -4),
    { font: f.tituloFuerte, size: 11.5, centre: true, max: wTitol - 16 });
  if (ambNumero) {
    text(numero, MARGEN + wTitol / 2, y - hCap / 2 - 12, { font: f.tituloFuerte, size: 11.5, centre: true, max: wTitol - 16 });
  }
  if (op.rectificativo) {
    text(t.rectificatiu, MARGEN + wTitol / 2, y - hCap + 8, { font: f.cuerpoFuerte, size: 8, centre: true, color: COLORES.verdeGris });
  }
  if (logo) {
    const h = 34;
    const w = logo.width * (h / logo.height);
    p.drawImage(logo, { x: MARGEN + wTitol + (ANCHO - wTitol - w) / 2, y: y - hCap / 2 - h / 2, width: w, height: h });
  }
  y -= hCap + 14;

  // La frase de trazabilidad de las donaciones (solo donación).
  if (donacio && (tipo === "REC" || tipo === "ENT")) {
    y = parrafo(tipo === "REC" ? t.legal_rec : t.legal_ent, MARGEN + wTitol, y, ANCHO - wTitol, { size: 9, centre: true }) - 6;
  }

  // ------------------------------------------------- la parte y la fecha
  const linesParte = (pt?: ParteAlbaran | null): string[] => {
    if (!pt) return [];
    const o = pt as Record<string, unknown>;
    return [o.razon_social, o.domicilio, o.nif ? `NIF ${o.nif}` : null]
      .map((v) => (v == null ? "" : String(v).trim())).filter(Boolean);
  };
  const partes = datos.partes ?? {};
  const blocs: { titol?: string; linies: string[] }[] = tipo === "REC"
    ? [{ linies: linesParte(partes.entrega) }]
    : tipo === "ENT"
    ? [{ linies: linesParte(partes.recibe) }]
    : [
      { titol: t.ofertant, linies: linesParte(partes.entrega) },
      { titol: t.receptor, linies: linesParte(partes.recibe) },
    ];
  const wParte = ANCHO * 0.46;
  const yParte = y;
  // Una dirección larga parte en líneas en vez de cortarse con puntos suspensivos.
  const parteix = (l: string): string[] => {
    const out: string[] = [];
    let act = "";
    for (const pa of l.split(" ")) {
      const prova = act ? `${act} ${pa}` : pa;
      if (act && ample(prova, f.cuerpo, 10) > wParte - 10) { out.push(act); act = pa } else act = prova;
    }
    if (act) out.push(act);
    return out;
  };
  for (const b of blocs) b.linies = b.linies.flatMap(parteix);
  for (const b of blocs) {
    const h = 12 + (b.linies.length + (b.titol ? 1 : 0)) * 12;
    caixa(MARGEN, y, wParte, h);
    let yy = y - 13;
    if (b.titol) { text(b.titol, MARGEN + 5, yy, { font: f.cuerpoFuerte, size: 8, color: COLORES.verdeGris }); yy -= 12 }
    for (const l of b.linies) { text(l, MARGEN + 5, yy, { size: 10, max: wParte - 10 }); yy -= 12 }
    y -= h + 6;
  }
  const dataElab = fecha(datos.data_elaboracio ?? datos.emes_at, false);
  text(t.data_elaboracio, MARGEN + wParte + 40, yParte - 30, { size: 10 });
  text(dataElab, MARGEN + ANCHO, yParte - 30, { size: 10, dreta: true });
  y -= 10;

  // ------------------------------------------------------------ modalidad
  const rotulModalitat = datos.tipus_entrada === "espigolament" ? t.espigolament
    : modalitat === "venda" ? t.venda : modalitat === "maquila" ? t.maquila : t.donacio;
  text(rotulModalitat, MARGEN, y, { font: f.cuerpoFuerte, size: 11 });
  y -= 16;

  // --------------------------------------------------------------- tabla
  const cols = ambEuros
    ? [
      { titol: t.c_numero, w: 0.17 }, { titol: t.c_data, w: 0.14 }, { titol: t.c_producte, w: 0.2, },
      { titol: t.c_kg, w: 0.1, dreta: true }, { titol: t.c_valor, w: 0.24, dreta: true }, { titol: t.c_import, w: 0.15, dreta: true },
    ]
    : [
      { titol: t.c_numero, w: 0.2 }, { titol: t.c_data, w: 0.16 }, { titol: t.c_producte, w: 0.26 },
      { titol: t.c_varietat, w: 0.24 }, { titol: t.c_kg, w: 0.14, dreta: true },
    ];
  const xs: number[] = [];
  let acc = MARGEN;
  for (const c of cols) { xs.push(acc); acc += c.w * ANCHO }
  const dataLinia = fecha(datos.recollida?.fecha_hora ?? datos.emes_at, false);

  const filaGraella = (valors: string[], o: { negreta?: boolean } = {}) => {
    if (y - ALTO_FILA < LIMITE) {
      p = doc.addPage([A4.ancho, A4.alto]);
      pagines.push(p);
      y = A4.alto - MARGEN;
      capçalera();
    }
    cols.forEach((c, i) => {
      p.drawRectangle({ x: xs[i], y: y - ALTO_FILA, width: c.w * ANCHO, height: ALTO_FILA, borderColor: COLORES.negro, borderWidth: 0.5 });
      const v = valors[i] ?? "";
      const font = o.negreta ? f.cuerpoFuerte : f.cuerpo;
      const maxw = c.w * ANCHO - 6;
      if ("dreta" in c && c.dreta) text(v, xs[i] + c.w * ANCHO - 3, y - 12, { font, size: 9, dreta: true, max: maxw });
      else text(v, xs[i] + 3, y - 12, { font, size: 9, max: maxw });
    });
    y -= ALTO_FILA;
  };
  // La cabecera parte en dos líneas lo que no cabe («Valor de referència per
  // unitat»): recortarlo con puntos suspensivos dejaba la columna sin nombre.
  const capçalera = () => {
    const linies = cols.map((c) => {
      const maxw = c.w * ANCHO - 6;
      if (ample(c.titol, f.cuerpoFuerte, 9) <= maxw) return [c.titol];
      const paraules = c.titol.split(" ");
      let a = "";
      let i = 0;
      while (i < paraules.length && ample(a ? `${a} ${paraules[i]}` : paraules[i], f.cuerpoFuerte, 9) <= maxw) {
        a = a ? `${a} ${paraules[i]}` : paraules[i];
        i++;
      }
      return [a || paraules[0], paraules.slice(a ? i : 1).join(" ")];
    });
    const dues = linies.some((l) => l.length > 1);
    const h = dues ? ALTO_FILA + 10 : ALTO_FILA;
    if (y - h < LIMITE) {
      p = doc.addPage([A4.ancho, A4.alto]);
      pagines.push(p);
      y = A4.alto - MARGEN;
    }
    cols.forEach((c, i) => {
      p.drawRectangle({ x: xs[i], y: y - h, width: c.w * ANCHO, height: h, borderColor: COLORES.negro, borderWidth: 0.5 });
      const maxw = c.w * ANCHO - 6;
      linies[i].forEach((l, k) => {
        const yy = y - 12 - k * 10;
        if ("dreta" in c && c.dreta) text(l, xs[i] + c.w * ANCHO - 3, yy, { font: f.cuerpoFuerte, size: 9, dreta: true, max: maxw });
        else text(l, xs[i] + 3, yy, { font: f.cuerpoFuerte, size: 9, max: maxw });
      });
    });
    y -= h;
  };
  capçalera();

  let totalKg = 0;
  let totalImport = 0;
  for (const l of lineas) {
    const kg = kgDeLinea(l);
    if (kg != null) totalKg += kg;
    const imp = importDeLinea(l);
    if (imp != null) totalImport += imp;
    const producte = [l.producte, ambEuros ? l.varietat : null].filter(Boolean).join(" ");
    filaGraella(ambEuros
      ? [numero, dataLinia, producte, kg == null ? "" : num(kg, kg % 1 === 0 ? 0 : 1),
        l.valor_kg == null ? "—" : num(l.valor_kg, 2), imp == null ? "—" : `${num(imp, 2)} €`]
      : [numero, dataLinia, l.producte ?? "", l.varietat ?? "", kg == null ? "" : num(kg, kg % 1 === 0 ? 0 : 1)]);
  }
  // Las filas vacías del modelo: ocho en total. En la de euros, «– €» como en el original.
  for (let i = lineas.length; i < FILAS_FIJAS; i++) {
    filaGraella(ambEuros ? ["", "", "", "", "", "–  €"] : ["", "", "", "", ""]);
  }
  filaGraella(ambEuros
    ? ["", "", t.total, num(totalKg, totalKg % 1 === 0 ? 0 : 1), t.total, `${num(totalImport, 2)} €`]
    : ["", "", t.total, "", num(totalKg, totalKg % 1 === 0 ? 0 : 1)], { negreta: true });
  y -= 14;

  // ------------------------------------------------------ lo que pasó
  // Lo mínimo de la entrega, en una o dos líneas: cuándo y dónde, el origen del ENT (D3:
  // municipio y comarca, nunca la finca ni el donante) y las incidencias si las hubo.
  const rec = datos.recollida ?? {};
  const origen = partes.origen ?? null;
  const on = tipo === "ENT"
    ? [origen?.municipio, origen?.comarca].filter(Boolean).join(", ")
    : (rec.lugar ?? (partes.entrega as Record<string, unknown> | null)?.lugar_recogida as string | null ?? "");
  const detalls = [
    `${t.recollida}: ${[fecha(rec.fecha_hora, true), on].filter(Boolean).join(" · ") || "—"}`,
    tipo === "ENT" && origen?.codigo_lote ? `${t.lot} ${origen.codigo_lote}` : null,
    textoIncidencias(datos.incidencies) ? `${t.incidencies}: ${textoIncidencias(datos.incidencies)}` : null,
    datos.observacions ? `${t.observacions}: ${datos.observacions}` : null,
  ].filter((v): v is string => !!v);
  for (const d of detalls) y = parrafo(d, MARGEN, y, ANCHO, { size: 8.5 }) - 2;
  y -= 8;

  // ------------------------------------------------------- nota legal
  if (ambEuros) {
    const any = String(datos.ejercici ?? new Date().getFullYear());
    const plantilla = textDePlantilla(op.plantilla?.cuerpo);
    y = parrafo((plantilla ?? t.nota_valor).replace("{any}", any), MARGEN, y, ANCHO, { size: 7.5, centre: true });
    if (!plantilla) y = parrafo(t.provisional, MARGEN, y - 1, ANCHO, { size: 6.5, centre: true, color: COLORES.verdeGris });
    y -= 10;
  }

  // ------------------------------------------- pie: gracias y la firma
  const fund = datos.fundacio ?? (tipo === "REC" ? partes.recibe : partes.entrega) ?? {};
  const fundObj = fund as Record<string, unknown>;
  const hPeu = 98;
  if (y - hPeu < 40) {
    p = doc.addPage([A4.ancho, A4.alto]);
    pagines.push(p);
    y = A4.alto - MARGEN;
  }
  let yy = y - 4;
  for (const [l, negreta] of [
    [t.gracies, false], [t.atentament, false], ["", false], [t.equip, true],
    [fundObj.razon_social, true], [fundObj.domicilio, true], [fundObj.nif, true],
  ] as [unknown, boolean][]) {
    if (l) text(l, MARGEN, yy, { size: 7.5, font: negreta ? f.cuerpoFuerte : f.cuerpo, max: ANCHO * 0.48 });
    yy -= 11;
  }
  // La caja de la firma: una (REC, ENT) o dos (OPE, confirman las dos partes). Dentro, la
  // confirmación registrada, si la hay: por quién, cuándo y por qué vía.
  const confs = [...(op.confirmaciones ?? [])];
  const caixesFirma: { titol: string; rol: "entrega" | "recibe" | null }[] = tipo === "OPE"
    ? [{ titol: t.firma_entrega, rol: "entrega" }, { titol: t.firma_recibe, rol: "recibe" }]
    : [{ titol: tipo === "REC" ? t.firma_rec : t.firma_ent, rol: null }];
  const xF = MARGEN + ANCHO * 0.52;
  const wF = ANCHO * 0.48;
  const hF = tipo === "OPE" ? 44 : 64;
  let yF = y;
  for (const c of caixesFirma) {
    caixa(xF, yF, wF, hF, COLORES.crema100);
    text(c.titol, xF + wF / 2, yF - 12, { font: f.cuerpoFuerte, size: 8.5, centre: true });
    const conf: ConfirmacionAlbaran | undefined = c.rol
      ? confs.find((x) => x.rol === c.rol)
      : confs[confs.length - 1];
    if (conf) {
      const via = conf.canal === "asistido" ? t.via_assistit : conf.canal === "panel" ? t.via_panell
        : conf.canal === "whatsapp" ? t.via_whatsapp : t.via_enllac;
      text(`${t.confirmat} ${[conf.nombre, conf.cargo].filter(Boolean).join(" · ")}`, xF + 6, yF - 26, { size: 8, max: wF - 12 });
      text(`${fecha(conf.at, true)} · ${via}${conf.referencia ? ` · ${t.ref} ${conf.referencia}` : ""}`, xF + 6, yF - 37, { size: 7.5, color: COLORES.verdeGris, max: wF - 12 });
    } else {
      text(t.pendent, xF + wF / 2, yF - hF / 2 - 6, { size: 8, centre: true, color: COLORES.verdeGris });
    }
    yF -= hF + 4;
  }

  // ----------------------------------------- pie de página y filigrana
  const total = pagines.length;
  pagines.forEach((pg, i) => {
    if (op.modo === "prueba") filigrana(pg, f.tituloFuerte, t.prova);
    pg.drawLine({ start: { x: MARGEN, y: 34 }, end: { x: A4.ancho - MARGEN, y: 34 }, thickness: 0.5, color: COLORES.crema300 });
    pg.drawText(`${t.verificacio} ${codigoVerificacion(op.sha256Datos)} · ${numero}`, { x: MARGEN, y: 22, size: 7, font: f.cuerpo, color: COLORES.verdeGris });
    const pag = t.pagina(i + 1, total);
    pg.drawText(pag, { x: A4.ancho - MARGEN - f.cuerpo.widthOfTextAtSize(pag, 7), y: 22, size: 7, font: f.cuerpo, color: COLORES.verdeGris });
  });

  const bytes = await doc.save();
  return { bytes, paginas: total };
}

/** El texto plano de una plantilla legal de `plantillas_documento` (bloques `{text}`). */
function textDePlantilla(cuerpo: unknown): string | null {
  if (!Array.isArray(cuerpo)) return null;
  const t = cuerpo.map((b) => (b && typeof b === "object" ? String((b as { text?: unknown }).text ?? "") : ""))
    .filter(Boolean).join(" ");
  return t.trim() || null;
}

/** La marca de agua de los documentos de prueba: diagonal, coral y muy tenue. */
function filigrana(p: PDFPage, font: PDFFont, texto: string) {
  const size = 90;
  const w = font.widthOfTextAtSize(texto, size);
  const rad = (45 * Math.PI) / 180;
  p.drawText(texto, {
    x: A4.ancho / 2 - (w / 2) * Math.cos(rad) + (size / 3) * Math.sin(rad),
    y: A4.alto / 2 - (w / 2) * Math.sin(rad) - (size / 3) * Math.cos(rad),
    size, font, color: COLORES.coral, opacity: 0.14, rotate: degrees(45),
  });
}
