// Convenio de colaboración (CONV) — §3.2 del plan funcional, fase 2.
//
// Es el documento más largo del sistema y el único que **una persona firma de su puño**
// (con el dedo, en el móvil). Eso le da tres particularidades que no tiene ningún otro:
//
//   1. **El cuerpo es texto largo paginado**, no una tabla de líneas. Sale entero de
//      `plantillas_documento` con la `variante` del modelo (don_gen · don_rec · com), así
//      que el articulado lo escribe la Fundación y no este fichero. Lo que este fichero
//      decide es la maquetación, nunca el contenido.
//   2. **Lleva una última página de evidencias**: quién firmó, con qué cargo, qué
//      documento declaró, si declaró tener representación, cuándo, desde qué IP y con qué
//      navegador, la huella SHA-256 del texto que aceptó y el trazo de su firma. Sin esa
//      página, el PDF sería un contrato con un garabato: la firma electrónica simple vale
//      por lo que se puede demostrar de su contexto, y el contexto es esta página.
//   3. **Se emite dos veces**: `firmat` (lo que firma la organización) y `contrafirmat`
//      (con la firma y el sello de la apoderada estampados, igual que en `cd.ts`). El
//      segundo es una versión nueva del mismo documento y apaga al primero.
//
// ⚠️ EL DNI DE QUIEN FIRMA NO ESTÁ EN `documentos.datos`. `evidencias.documento_identidad`
//    está fuera del GRANT de SELECT de `authenticated` (20260928100300) y el snapshot no
//    lo copia a propósito: ese jsonb lo puede leer la propia organización. Llega aquí por
//    parámetro, leído con `service_role` por `generar-documento`, y solo para imprimirlo
//    en la página que lo exige. Precio conocido y aceptado: `sha256_datos` no lo cubre.
//
// ⚠️ EL AVISO DE BORRADOR SE RESPETA Y SE AMPLIFICA. Las seis plantillas sembradas
//    (20270111100200) llevan el aviso de «pendent de validació» como primer y último
//    bloque de su cuerpo, y aquí se imprimen tal cual. Además, cuando el título de la
//    plantilla empieza por `[ESBORRANY]`/`[BORRADOR]`, el documento sale con **filigrana
//    en todas las páginas** y una caja arriba: un párrafo en la primera página de diez se
//    pasa por alto, y un convenio de trabajo que parezca firmable es lo único que este
//    renderizador no puede permitirse.
//
// Contrato de siempre: este fichero NO lee ficheros ni habla con la base. Recibe los
// activos ya leídos, el snapshot congelado y los PNG que haya que estampar.

import { PDFDocument, type PDFImage } from "npm:pdf-lib@1";
import { type BytesActivos, embeberFuentes, embeberLogo } from "../fuentes.ts";
import { COLORES, Maquetador } from "../maquetador.ts";
import { pintarCuerpo } from "../plantilla.ts";
import {
  codigoVerificacionConvenio,
  cuerpoConvenio,
  type DatosConvenio,
  type DiccionarioConvenio,
  diccionarioConvenio,
  domicilioConvenio,
  type EvidenciaConvenio,
  esPlantillaProvisional,
  fechaHoraConvenio,
  fechaLargaConvenio,
  type IdiomaConvenio,
  idiomaConvenio,
  rolesEnTexto,
  tipoConvenio,
  tituloSinMarca,
} from "../convenio.ts";
import type { PlantillaLegal, Renderizado } from "./comu.ts";

/** El DNI de una evidencia, que el snapshot no lleva. Se casa por `created_at`. */
export interface IdentidadEvidencia {
  /** `evidencias.created_at`, tal como sale de la base. */
  at: string | null;
  documento: string | null;
}

export interface OpcionesConvenio {
  /** Snapshot congelado (`documentos.datos`), tal como lo compone `convenio_emet_document`. */
  datos: DatosConvenio;
  /** `documentos.sha256_datos`: el código de verificación impreso. */
  sha256Datos?: string | null;
  /** Plantilla con la que se emitió, congelada por `documentos.plantilla_id`. */
  plantilla?: PlantillaLegal | null;
  /** Versión de esa plantilla, para poder decir con qué redacción se firmó. */
  plantillaVersion?: number | null;
  /** `firmat` | `contrafirmat`. */
  subtipo?: string | null;
  /** PNG del trazo de la firma, del bucket `documentos`. */
  trazoPng?: Uint8Array | null;
  /** Solo en la contrafirma: firma y sello de la apoderada, del bucket `activos`. */
  firmaPng?: Uint8Array | null;
  selloPng?: Uint8Array | null;
  /** Los DNI declarados, que viven solo en `evidencias` (ver cabecera). */
  identidades?: IdentidadEvidencia[] | null;
  /**
   * `enlaces_token.canal` del enlace con el que se firmó: `email` o `asistido`.
   *
   * ⚠️ No se deduce de `assistit_per`, aunque lo parezca. Una firma asistida conducida
   *    por el servidor (la campaña por tandas) deja `asistido_por` a null porque no hay
   *    `auth.uid()`, y entonces la página de evidencias diría «enllaç enviat per correu»
   *    de un acto que ocurrió con una persona del equipo delante. El canal es un dato de
   *    la fila, no una inferencia.
   */
  canal?: string | null;
}

/** Pares etiqueta/valor sin los vacíos (misma regla que en el resto de renderizadores). */
function paresLlenos(pares: [string, unknown][]): [string, string][] {
  return pares
    .map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)] as [string, string])
    .filter(([, v]) => v.trim() !== "");
}

/** Trocea una huella hexadecimal para que quepa y se pueda leer/comparar a ojo. */
function huellaLegible(sha: string | null | undefined): string {
  const limpio = (sha ?? "").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (!limpio) return "";
  return limpio.match(/.{1,8}/g)?.join(" ") ?? limpio;
}

/** El DNI que corresponde a una evidencia, casado por instante de creación. */
function documentoDe(
  ev: EvidenciaConvenio,
  identidades: IdentidadEvidencia[] | null | undefined,
): string | null {
  const lista = (identidades ?? []).filter((i) => (i.documento ?? "").trim() !== "");
  if (lista.length === 0) return null;
  const objetivo = ev.created_at ? Date.parse(ev.created_at) : NaN;
  if (!isNaN(objetivo)) {
    const exacta = lista.find((i) => i.at && Date.parse(i.at) === objetivo);
    if (exacta) return exacta.documento;
  }
  // Un solo documento y una sola firma: no hay ambigüedad posible. Es el caso normal;
  // el casado por fecha existe para los convenios devueltos y vueltos a firmar.
  return lista.length === 1 ? lista[0].documento : null;
}

export async function renderConv(
  activos: BytesActivos,
  op: OpcionesConvenio,
  idioma?: string | null,
): Promise<Renderizado> {
  const lengua = idiomaConvenio(idioma ?? op.datos.idioma);
  const t = diccionarioConvenio(lengua);
  const datos = op.datos;
  const tipo = tipoConvenio(datos.tipus);
  const contrafirmado = op.subtipo === "contrafirmat";
  const esBorrador = esPlantillaProvisional(op.plantilla?.titulo);

  const numero = datos.numero ?? "";
  const tituloPlantilla = tituloSinMarca(op.plantilla?.titulo) ||
    `${t.titulo} · ${t.subtitulo[tipo]}`;

  const doc = await PDFDocument.create();
  doc.setTitle(`${numero} · ${t.modelo[tipo]}`);
  doc.setProducer("Redestina");
  doc.setCreator("Redestina");
  const fuentes = await embeberFuentes(doc, activos);
  const logo = await embeberLogo(doc, activos);

  const m = new Maquetador(doc, {
    fuentes,
    logo,
    cabecera: numero,
    subcabecera: `${t.modelo[tipo]} · ${t.exercici} ${datos.ejercici ?? ""}`.trim(),
    pie: `${t.peu} · ${numero || t.modelo[tipo]}`,
    // La filigrana solo cuando el texto es de trabajo. Un convenio con el articulado
    // validado NO la lleva: es un contrato, no un borrador.
    marcaAgua: esBorrador ? { texto: t.esborrany_marca } : null,
    paginacion: t.pagina,
  });

  // ------------------------------------------------------------------ portada
  m.titulo(t.titulo, 1);
  m.parrafo(tituloPlantilla, { color: COLORES.verdeGris, tamano: 10.5, despues: 8 });

  if (esBorrador) {
    m.caja(t.esborrany_avis, {
      titulo: t.esborrany_titol,
      fondo: COLORES.crema100,
      barra: COLORES.coral,
    });
    m.espacio(8);
  }

  m.campos(
    paresLlenos([
      [t.model, t.modelo[tipo]],
      // Con qué redacción se firmó. `documentos.plantilla_id` se congela al emitir, así
      // que esto no es «la versión de hoy» sino la de aquel día.
      [t.redaccio, op.plantillaVersion ? `${tituloPlantilla} · v${op.plantillaVersion}` : null],
      [t.numero, numero],
      [t.exercici, datos.ejercici],
      [t.rols, tipo === "com" ? rolesEnTexto(datos.roles_com, t) : null],
      [t.data_firma, fechaLargaConvenio(datos.firmat_at, t, lengua)],
      [t.data_contrafirma, contrafirmado ? fechaLargaConvenio(datos.contrafirmat_at, t, lengua) : null],
      [t.codi_verificacio, codigoVerificacionConvenio(op.sha256Datos)],
    ]),
    { anchoEtiqueta: 150, despues: 8 },
  );

  if (datos.dades_provisionals) {
    m.espacio(4);
    m.caja(t.dades_prov_avis, { titulo: t.dades_prov_titol, fondo: COLORES.crema });
    m.espacio(4);
  }

  // -------------------------------------------------------------------- partes
  m.filete();
  m.espacio(6);
  m.titulo(t.parts, 2);

  const fun = datos.fundacio ?? {};
  m.titulo(t.fundacio, 3);
  m.campos(
    paresLlenos([
      [t.rao_social, fun.raso_social],
      [t.cif, fun.cif],
      [t.domicili, domicilioConvenio(fun)],
      [t.inscripcio, fun.inscripcio],
      [t.apoderada, [fun.apoderada_nom, fun.apoderada_carrec].filter(Boolean).join(" · ")],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );

  const org = datos.organitzacio ?? {};
  m.espacio(4);
  m.titulo(t.organitzacio, 3);
  m.campos(
    paresLlenos([
      [t.rao_social, org.raso_social ?? org.nom],
      [t.nom_comercial, org.nom_comercial],
      [t.nif, org.nif],
      [t.domicili, domicilioConvenio(org)],
      [t.comarca, org.comarca],
      [t.correu, org.email],
      [t.telefon, org.telefon],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );

  const fir = datos.firmant ?? {};
  m.espacio(4);
  m.titulo(t.firmant, 3);
  m.campos(
    paresLlenos([
      [t.representant, fir.nombre ?? org.representant],
      [t.carrec, fir.cargo ?? org.carrec],
      [t.correu, fir.email],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );

  // ----------------------------------------------------------------- articulado
  m.espacio(6);
  m.filete();
  m.espacio(6);
  const cuerpo = cuerpoConvenio(datos, op.plantilla?.cuerpo, t, lengua);
  if (cuerpo.sinPlantilla) {
    m.titulo(t.clausules, 2);
    pintarCuerpo(m, cuerpo.bloques);
    m.espacio(4);
    m.caja(t.provisional_avis, { titulo: t.provisional_titol });
  } else {
    // El cuerpo de la plantilla trae sus propios títulos (h1/h2/h3): no se le pone otro
    // encima, que duplicaría el rótulo del convenio en mitad del documento.
    pintarCuerpo(m, cuerpo.bloques);
  }
  if (cuerpo.faltan.length) {
    console.warn("conv: marcadores sin resolver:", cuerpo.faltan.join(", "));
  }

  // ------------------------------------------------------------------- firmas
  await pintarFirmas(m, doc, t, datos, op, lengua, contrafirmado);

  // ------------------------------------------------------- página de evidencias
  await pintarEvidencias(m, doc, t, datos, op, lengua);

  m.finalizar();
  const bytes = await doc.save();
  return { bytes, paginas: m.numPaginas };
}

/**
 * Las dos firmas, una al lado de la otra. La de la organización es el trazo que la
 * persona dibujó con el dedo; la de la Fundación, la firma y el sello escaneados de la
 * apoderada, y **solo aparece en la contrafirma** (D11): mientras el convenio está
 * `firmat`, el documento tiene que enseñar que le falta esa validación, no fingirla.
 *
 * Un PNG que no se puede embeber no impide emitir: se deja el hueco con su filete, como
 * en `cd.ts`. Un convenio sin la imagen de la firma se sigue sosteniendo en la página de
 * evidencias; uno que no se genera, no.
 */
async function pintarFirmas(
  m: Maquetador,
  doc: PDFDocument,
  t: DiccionarioConvenio,
  datos: DatosConvenio,
  op: OpcionesConvenio,
  lengua: IdiomaConvenio,
  contrafirmado: boolean,
): Promise<void> {
  const ALTO_TRAZO = 56;
  const ALTO_SELLO = 70;
  const alto = Math.max(ALTO_TRAZO, ALTO_SELLO);

  let trazo: PDFImage | null = null;
  let firma: PDFImage | null = null;
  let sello: PDFImage | null = null;
  try {
    if (op.trazoPng && op.trazoPng.length > 0) trazo = await doc.embedPng(op.trazoPng);
    if (contrafirmado && op.firmaPng && op.firmaPng.length > 0) {
      firma = await doc.embedPng(op.firmaPng);
    }
    if (contrafirmado && op.selloPng && op.selloPng.length > 0) {
      sello = await doc.embedPng(op.selloPng);
    }
  } catch (e) {
    console.warn("conv: firma/segell/traç no embebibles:", e instanceof Error ? e.message : String(e));
  }

  m.espacio(10);
  m.titulo(t.signatures, 2);
  // El bloque entero no se parte: dos firmas repartidas entre dos páginas no se leen
  // como una firma conjunta.
  m.asegurar(alto + 70);

  const y = m.y;
  const mitad = m.anchoUtil / 2;
  const fun = datos.fundacio ?? {};
  const org = datos.organitzacio ?? {};
  const fir = datos.firmant ?? {};

  if (trazo) {
    const ancho = Math.min((trazo.width / trazo.height) * ALTO_TRAZO, mitad - 20);
    m.paginaActual.drawImage(trazo, {
      x: m.x,
      y: y - ALTO_TRAZO,
      width: ancho,
      height: ALTO_TRAZO,
    });
  }
  if (firma) {
    const ancho = Math.min((firma.width / firma.height) * ALTO_TRAZO, mitad - 90);
    m.paginaActual.drawImage(firma, {
      x: m.x + mitad,
      y: y - ALTO_TRAZO,
      width: ancho,
      height: ALTO_TRAZO,
    });
  }
  if (sello) {
    const ancho = Math.min((sello.width / sello.height) * ALTO_SELLO, 110);
    m.paginaActual.drawImage(sello, {
      x: m.x + m.anchoUtil - ancho,
      y: y - ALTO_SELLO,
      width: ancho,
      height: ALTO_SELLO,
    });
  }

  m.espacio(alto + 6);
  const yLinea = m.y;
  for (const x of [m.x, m.x + mitad]) {
    m.paginaActual.drawLine({
      start: { x, y: yLinea },
      end: { x: x + mitad - 20, y: yLinea },
      thickness: 0.75,
      color: COLORES.crema300,
    });
  }
  m.espacio(6);

  const escribir = (x: number, lineas: [string, boolean][]) => {
    let cursor = m.y;
    for (const [texto, fuerte] of lineas) {
      if (!texto) continue;
      const [primera] = m.cortar(
        texto,
        fuerte ? m.fuentes.cuerpoFuerte : m.fuentes.cuerpo,
        9,
        mitad - 20,
      );
      m.paginaActual.drawText(primera, {
        x,
        y: cursor - 9,
        size: 9,
        font: fuerte ? m.fuentes.cuerpoFuerte : m.fuentes.cuerpo,
        color: fuerte ? COLORES.negro : COLORES.verdeGris,
      });
      cursor -= 12;
    }
    return cursor;
  };

  const izquierda = escribir(m.x, [
    [t.signa_org, true],
    [fir.nombre ?? org.representant ?? "", false],
    [fir.cargo ?? org.carrec ?? "", false],
    [org.raso_social ?? org.nom ?? "", false],
    [fechaLargaConvenio(datos.firmat_at, t, lengua), false],
  ]);
  const derecha = escribir(m.x + mitad, [
    [t.signa_fundacio, true],
    [contrafirmado ? (fun.apoderada_nom ?? "") : "", false],
    [contrafirmado ? (fun.apoderada_carrec ?? "") : "", false],
    [fun.raso_social ?? "", false],
    [contrafirmado ? fechaLargaConvenio(datos.contrafirmat_at, t, lengua) : "", false],
  ]);
  m.espacio(m.y - Math.min(izquierda, derecha));

  if (!contrafirmado) {
    m.espacio(8);
    m.caja(t.pendent_contrafirma, { fondo: COLORES.crema, barra: COLORES.coral });
  }
}

/**
 * LA ÚLTIMA PÁGINA. Va en página propia y siempre, incluso sin ninguna evidencia
 * registrada (entonces lo dice): que exista la página es parte de la forma del documento,
 * y una firma sin su contexto es un garabato.
 */
async function pintarEvidencias(
  m: Maquetador,
  doc: PDFDocument,
  t: DiccionarioConvenio,
  datos: DatosConvenio,
  op: OpcionesConvenio,
  _lengua: IdiomaConvenio,
): Promise<void> {
  m.saltoPagina();
  m.titulo(t.evidencies_titol, 1);
  m.parrafo(t.evidencies_intro, { color: COLORES.verdeGris, tamano: 9.5, despues: 10 });

  const todas = (datos.evidencies ?? []).filter(Boolean);
  const firmas = todas.filter((e) => e.tipus === "firma");
  const codigos = todas.filter((e) => e.tipus === "codigo");
  const aperturas = todas.filter((e) => e.tipus === "apertura");

  if (firmas.length === 0) {
    m.caja(t.ev_sense, { fondo: COLORES.crema100 });
    return;
  }

  // Un segundo factor válido en cualquier momento del enlace es el que autorizó la firma:
  // `firmar_convenio_por_enlace()` exige que exista antes de dejar firmar.
  const huboCodigo = codigos.length > 0;
  const asistida = op.canal === "asistido" || firmas.some((e) => (e.assistit_per ?? "") !== "");

  for (const ev of firmas) {
    m.campos(
      paresLlenos([
        [t.ev_qui, ev.nom],
        [t.ev_carrec, ev.carrec],
        [t.ev_document, documentoDe(ev, op.identidades)],
        [t.ev_declaracio, ev.declaracio ? t.ev_declaracio_si : null],
        [t.ev_data, fechaHoraConvenio(ev.created_at)],
        [t.ev_ip, ev.ip],
        [t.ev_canal, asistida ? t.ev_canal_assistit : t.ev_canal_email],
        [t.ev_assistit_per, ev.assistit_per],
        [t.ev_codi, huboCodigo ? t.ev_codi_si : t.ev_codi_no],
      ]),
      { anchoEtiqueta: 170, tamano: 9.5, despues: 4 },
    );

    // El navegador y la huella van aparte porque son largos y `campos()` los mete en una
    // columna estrecha: en dos líneas propias se leen y se pueden comparar a mano.
    if (ev.user_agent) {
      m.espacio(2);
      m.parrafo(t.ev_navegador, { fuente: m.fuentes.cuerpoFuerte, tamano: 9, color: COLORES.verdeGris });
      m.parrafo(ev.user_agent, { tamano: 8.5, despues: 4 });
    }
    if (ev.sha256_texte) {
      m.parrafo(t.ev_petjada, { fuente: m.fuentes.cuerpoFuerte, tamano: 9, color: COLORES.verdeGris });
      m.parrafo(huellaLegible(ev.sha256_texte), { tamano: 8.5, despues: 6 });
    }

    // El trazo, otra vez y a tamaño de lectura: en la página de firmas está maquetado
    // dentro del contrato; aquí es la evidencia en sí.
    m.espacio(2);
    m.parrafo(t.ev_trac, { fuente: m.fuentes.cuerpoFuerte, tamano: 9, color: COLORES.verdeGris });
    let trazo: PDFImage | null = null;
    try {
      if (op.trazoPng && op.trazoPng.length > 0) trazo = await doc.embedPng(op.trazoPng);
    } catch {
      trazo = null;
    }
    if (trazo) {
      m.imagen(trazo, { alto: 52, antes: 4, despues: 6 });
    } else {
      m.parrafo(t.ev_sense_trac, { color: COLORES.verdeGris, tamano: 9, despues: 6 });
    }
    m.filete();
    m.espacio(6);
  }

  if (aperturas.length > 0) {
    const primera = aperturas[0];
    m.campos(
      paresLlenos([[t.ev_apertura, fechaHoraConvenio(primera.created_at)]]),
      { anchoEtiqueta: 170, tamano: 9.5, despues: 6 },
    );
  }

  m.espacio(4);
  m.caja(t.ev_nota, { titulo: t.ev_nota_titol, fondo: COLORES.crema });
}
