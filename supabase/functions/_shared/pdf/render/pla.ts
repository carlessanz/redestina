// Plan de prevención básico (PLA) — línea 5 del funcional, diagnóstico y prevención.
//
// ⚠️ EL CUESTIONARIO NO EXISTE TODAVÍA. Es el **anexo B del funcional**, material de la
//    fase 0 que la Fundación aún no ha cerrado, exactamente igual que los textos legales
//    de los albaranes y de los certificados. Por eso este renderizador **no sabe ni una
//    sola pregunta**: pinta lo que venga en `questionari.respostes[]` en forma de
//    pregunta → respuesta, en el orden en que llegue, y no interpreta nada.
//
//    Inventarse aquí unas preguntas de negocio sería peor que no tener ninguna: quedarían
//    sembradas en el código, alguien las daría por válidas y el día que llegue el anexo B
//    habría que migrar respuestas reales. La base tomó la misma decisión —`respuestas` es
//    un sobre sin vocabulario de preguntas (20270301100000)— y aquí se obedece.
//
//    Y como el papel sí sale de la impresora, el documento **dice que está incompleto**:
//    la caja «Contingut pendent de definir» es obligatoria mientras `versio_questionari`
//    valga 0. Un plan de prevención con aspecto de plan de prevención y sin medidas de
//    prevención, si no avisara, sería lo único indefendible de todo esto —el mismo
//    criterio que la caja de «text provisional» de los albaranes—.
//
// POR QUÉ NO CUELGA DE `cierre.ts`. Un plan no es un acumulado anual de dos partes: no
// hay donante ni generador, no hay período, no hay firma de la apoderada y no hay ni un
// euro. Comparte con los certificados el maquetador y el formato de fechas, y eso es lo
// que se reutiliza; el esqueleto de dos partes, no, porque aquí solo hay una.
//
// Contrato de siempre: no lee ficheros ni habla con la base. Recibe los activos ya leídos
// y el snapshot `documentos.datos` congelado (`plan_datos()`).

import { PDFDocument } from "npm:pdf-lib@1";
import { type BytesActivos, embeberFuentes, embeberLogo } from "../fuentes.ts";
import { COLORES, type Columna, Maquetador } from "../maquetador.ts";
import { num } from "./comu.ts";
import type { PlantillaLegal } from "./comu.ts";
import { type Bloque, esCuerpo, interpolarCuerpo, pintarCuerpo } from "../plantilla.ts";
import {
  codigoVerificacion,
  domicilioCompleto,
  fechaLarga,
  type OrganizacionCierre,
  paresLlenos,
  type Renderizado,
} from "./cierre.ts";

// ---------------------------------------------------------------------------
// El snapshot (`plan_datos()`)
// ---------------------------------------------------------------------------
// Todo opcional, y con las claves TAL COMO las escribe SQL, acento incluido (§cierre.ts).

/** Una respuesta del cuestionario. `valor` es deliberadamente `unknown`: ver cabecera. */
export interface RespuestaPlan {
  id?: string | null;
  pregunta?: string | null;
  valor?: unknown;
}

export interface CuestionarioPlan {
  questionari?: string | null;
  versio_questionari?: number | string | null;
  respostes?: RespuestaPlan[] | null;
  notes?: string | null;
}

export interface OrganizacionPlan {
  tipus?: string | null;
  nom?: string | null;
  nif?: string | null;
  poblacio?: string | null;
  comarca?: string | null;
  email?: string | null;
}

export interface DatosPlan {
  tipus?: string | null;
  nivell?: string | null;
  numero?: string | null;
  versio?: number | null;
  exercici?: number | null;
  data_generacio?: string | null;
  lloc?: string | null;
  idioma?: string | null;
  fundacio?: OrganizacionCierre | null;
  organitzacio?: OrganizacionPlan | null;
  questionari?: CuestionarioPlan | null;
}

export interface OpcionesPlan {
  datos: DatosPlan;
  sha256Datos?: string | null;
  /** Plantilla legal vigente. Sin ella se imprime el texto provisional, marcado. */
  plantilla?: PlantillaLegal | null;
  /** `prueba` estampa filigrana. Hoy `plan_emet_document()` emite siempre en `real`. */
  modo?: "real" | "prueba";
}

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

interface DiccionarioPlan {
  titulo: string;
  subtitulo: string;
  numero: string;
  versio: string;
  exercici: string;
  nivell: string;
  nivell_basic: string;
  nivell_personalitzat: string;
  data_emissio: string;
  codi_verificacio: string;
  organitzacio: string;
  productor: string;
  entitat: string;
  nom: string;
  nif: string;
  poblacio: string;
  comarca: string;
  correu: string;
  emet: string;
  rao_social: string;
  cif: string;
  domicili: string;
  inscripcio: string;
  pendent_titol: string;
  pendent_text: string;
  questionari_titol: string;
  questionari_meta: (nom: string, versio: string) => string;
  sense_respostes: string;
  notes_titol: string;
  legal: string;
  provisional_titol: string;
  provisional_avis: string;
  si: string;
  no: string;
  buit: string;
  marca_prova: string;
  peu: string;
  pagina: (n: number, total: number) => string;
  col: { pregunta: string; resposta: string };
}

const CA: DiccionarioPlan = {
  titulo: "Pla de prevenció",
  subtitulo: "Diagnòstic i prevenció de pèrdues alimentàries",
  numero: "Número",
  versio: "Versió del pla",
  exercici: "Exercici",
  nivell: "Nivell",
  nivell_basic: "Bàsic",
  nivell_personalitzat: "Personalitzat",
  data_emissio: "Data",
  codi_verificacio: "Codi de verificació",
  organitzacio: "Organització",
  productor: "Organització generadora",
  entitat: "Entitat receptora",
  nom: "Nom",
  nif: "NIF",
  poblacio: "Població",
  comarca: "Comarca",
  correu: "Correu",
  emet: "Emet",
  rao_social: "Raó social",
  cif: "CIF",
  domicili: "Domicili",
  inscripcio: "Inscripció",
  pendent_titol: "Contingut pendent de definir",
  pendent_text:
    "El qüestionari de diagnòstic i les mesures de prevenció que se'n deriven encara no estan definits per la Fundació Espigoladors (annex B del document funcional). Aquest document recull, tal com es van registrar, les respostes que consten al sistema; no conté encara ni la valoració del diagnòstic ni el pla de mesures. Quan el qüestionari estigui definit, aquesta organització rebrà un pla nou que substituirà aquest.",
  questionari_titol: "Respostes registrades",
  questionari_meta: (nom, versio) => `Qüestionari: ${nom} · versió ${versio}`,
  sense_respostes: "Encara no hi ha cap resposta registrada.",
  notes_titol: "Notes",
  legal: "Condicions",
  provisional_titol: "Text provisional, pendent de validació",
  provisional_avis:
    "Aquest text encara no ha estat validat per la Fundació Espigoladors. S'imprimeix perquè el document sigui llegible mentre no hi hagi la plantilla definitiva.",
  si: "Sí",
  no: "No",
  buit: "—",
  marca_prova: "Prova · document sense validesa",
  peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n, total) => `pàg. ${n} de ${total}`,
  col: { pregunta: "Pregunta", resposta: "Resposta" },
};

const ES: DiccionarioPlan = {
  titulo: "Plan de prevención",
  subtitulo: "Diagnóstico y prevención de pérdidas alimentarias",
  numero: "Número",
  versio: "Versión del plan",
  exercici: "Ejercicio",
  nivell: "Nivel",
  nivell_basic: "Básico",
  nivell_personalitzat: "Personalizado",
  data_emissio: "Fecha",
  codi_verificacio: "Código de verificación",
  organitzacio: "Organización",
  productor: "Organización generadora",
  entitat: "Entidad receptora",
  nom: "Nombre",
  nif: "NIF",
  poblacio: "Población",
  comarca: "Comarca",
  correu: "Correo",
  emet: "Emite",
  rao_social: "Razón social",
  cif: "CIF",
  domicili: "Domicilio",
  inscripcio: "Inscripción",
  pendent_titol: "Contenido pendiente de definir",
  pendent_text:
    "El cuestionario de diagnóstico y las medidas de prevención que se derivan de él todavía no están definidos por la Fundació Espigoladors (anexo B del documento funcional). Este documento recoge, tal como se registraron, las respuestas que constan en el sistema; todavía no contiene ni la valoración del diagnóstico ni el plan de medidas. Cuando el cuestionario esté definido, esta organización recibirá un plan nuevo que sustituirá a este.",
  questionari_titol: "Respuestas registradas",
  questionari_meta: (nom, versio) => `Cuestionario: ${nom} · versión ${versio}`,
  sense_respostes: "Todavía no hay ninguna respuesta registrada.",
  notes_titol: "Notas",
  legal: "Condiciones",
  provisional_titol: "Texto provisional, pendiente de validación",
  provisional_avis:
    "Este texto todavía no ha sido validado por la Fundació Espigoladors. Se imprime para que el documento sea legible mientras no exista la plantilla definitiva.",
  si: "Sí",
  no: "No",
  buit: "—",
  marca_prova: "Prueba · documento sin validez",
  peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n, total) => `pág. ${n} de ${total}`,
  col: { pregunta: "Pregunta", resposta: "Respuesta" },
};

/**
 * El texto de cierre MIENTRAS la fase 0 no entregue el validado. Dice lo que el plan es y
 * lo que todavía no es, que es lo único que hoy se puede afirmar con certeza.
 */
const LEGAL_PROVISIONAL: Record<"ca" | "es", Bloque[]> = {
  ca: [
    {
      tipo: "p",
      text:
        "Aquest pla de prevenció l'emet {{fundacio.rao_social}} a partir de les respostes que {{organitzacio.nom}} va registrar a Redestina. Les respostes són les de qui les va contestar: la Fundació no les ha verificat sobre el terreny.",
    },
    {
      tipo: "p",
      text:
        "El pla no té efectes contractuals ni certifica el compliment de cap obligació legal en matèria de prevenció de pèrdues alimentàries.",
    },
    {
      tipo: "p",
      text:
        "Codi de verificació d'aquest document: {{codi}}. Si el contingut canviés, el codi deixaria de coincidir.",
    },
  ],
  es: [
    {
      tipo: "p",
      text:
        "Este plan de prevención lo emite {{fundacio.rao_social}} a partir de las respuestas que {{organitzacio.nom}} registró en Redestina. Las respuestas son las de quien las contestó: la Fundación no las ha verificado sobre el terreno.",
    },
    {
      tipo: "p",
      text:
        "El plan no tiene efectos contractuales ni certifica el cumplimiento de ninguna obligación legal en materia de prevención de pérdidas alimentarias.",
    },
    {
      tipo: "p",
      text:
        "Código de verificación de este documento: {{codi}}. Si el contenido cambiara, el código dejaría de coincidir.",
    },
  ],
};

/**
 * Los meses, para poder usar `fechaLarga()` de `cierre.ts` sin arrastrar su diccionario
 * entero: esa función solo toca `t.mesos`. Duplicar los nombres aquí sería garantizar que
 * un día «març» se escriba de dos maneras.
 */
const MESES: Record<"ca" | "es", string[]> = {
  ca: [
    "gener", "febrer", "març", "abril", "maig", "juny",
    "juliol", "agost", "setembre", "octubre", "novembre", "desembre",
  ],
  es: [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ],
};

// ---------------------------------------------------------------------------
// Formato de un valor que no sabemos qué es
// ---------------------------------------------------------------------------

/**
 * `valor` es `unknown` a propósito (ver cabecera): el anexo B decidirá si una respuesta es
 * un sí/no, un número, un texto o una lista, y hasta entonces puede ser cualquiera de las
 * cuatro. Esto lo convierte en algo legible **sin interpretarlo**:
 *
 *   · `null`/vacío → «—», nunca un 0 ni un «No»: no contestado no es contestado que no.
 *   · booleano → Sí/No en el idioma del documento.
 *   · número → con separador de millares y coma decimal, como el resto del sistema.
 *   · lista → sus elementos separados por comas, cada uno formateado igual.
 *   · objeto → `clau: valor` separados por « · », que es lo más honesto que se puede hacer
 *     con una forma que todavía no está definida. Un `JSON.stringify` con sus llaves y
 *     comillas sería ilegible en un papel que va a leer una persona.
 */
export function valorLegible(valor: unknown, t: DiccionarioPlan): string {
  if (valor === null || valor === undefined) return t.buit;
  if (typeof valor === "boolean") return valor ? t.si : t.no;
  if (typeof valor === "number") {
    return Number.isInteger(valor) ? num(valor, 0) : num(valor, 2);
  }
  if (typeof valor === "string") return valor.trim() === "" ? t.buit : valor.trim();
  if (Array.isArray(valor)) {
    const partes = valor.map((v) => valorLegible(v, t)).filter((x) => x !== t.buit);
    return partes.length === 0 ? t.buit : partes.join(", ");
  }
  if (typeof valor === "object") {
    const partes = Object.entries(valor as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${valorLegible(v, t)}`);
    return partes.length === 0 ? t.buit : partes.join(" · ");
  }
  return String(valor);
}

// ---------------------------------------------------------------------------
// El documento
// ---------------------------------------------------------------------------

/**
 * ⚠️ El idioma NO sale del snapshot aunque `plan_datos()` lo lleve: sale de
 * `documentos.idioma`, como en el resto de renderizadores. Los dos valen lo mismo hoy —los
 * escribe la misma fila—, pero la fuente de verdad de con qué idioma se emitió un
 * documento es la fila del documento.
 */
export async function renderPla(
  activos: BytesActivos,
  op: OpcionesPlan,
  idioma?: string | null,
): Promise<Renderizado> {
  const lengua: "ca" | "es" = idioma === "es" ? "es" : "ca";
  const t = lengua === "es" ? ES : CA;
  const datos = op.datos;
  const numero = datos.numero ?? "";

  const doc = await PDFDocument.create();
  doc.setTitle(`${numero} · ${t.titulo}`.trim());
  doc.setProducer("Redestina");
  doc.setCreator("Redestina");
  const fuentes = await embeberFuentes(doc, activos);
  const logo = await embeberLogo(doc, activos);

  const m = new Maquetador(doc, {
    fuentes,
    logo,
    cabecera: numero,
    subcabecera: `${t.titulo} · ${t.exercici} ${datos.exercici ?? ""}`.trim(),
    pie: `${t.peu}${numero ? ` · ${numero}` : ""}`,
    marcaAgua: op.modo === "prueba" ? { texto: t.marca_prova } : null,
    paginacion: t.pagina,
  });

  m.titulo(t.titulo, 1);
  m.parrafo(t.subtitulo, { color: COLORES.verdeGris, tamano: 10, despues: 10 });

  // ------------------------------------------------------------ identificación
  const nivel = datos.nivell === "personalitzat" ? t.nivell_personalitzat : t.nivell_basic;
  m.campos(
    paresLlenos([
      [t.numero, numero],
      [t.nivell, nivel],
      [t.versio, datos.versio],
      [t.exercici, datos.exercici],
      [t.data_emissio, fechaLarga(datos.data_generacio, { mesos: MESES[lengua] }, lengua)],
      [t.codi_verificacio, codigoVerificacion(op.sha256Datos)],
    ]),
    { anchoEtiqueta: 150, despues: 8 },
  );

  // ------------------------------------------------------------------- partes
  m.filete();
  m.espacio(6);
  pintarOrganizacionPlan(m, t, datos.organitzacio);
  m.espacio(4);
  pintarFundacion(m, t, datos.fundacio);

  // ------------------------------------------------- el aviso que hace honesto el papel
  // Va ARRIBA, antes de las respuestas: quien abra el PDF tiene que leer que esto todavía
  // no es un plan de medidas antes de leer nada que lo parezca. Y en coral, que en el
  // sistema de diseño no significa error sino atención (§AGENTS.md 2bis).
  const cuestionario = datos.questionari ?? {};
  const versionCuestionario = Number(cuestionario.versio_questionari ?? 0);
  if (!isFinite(versionCuestionario) || versionCuestionario < 1) {
    m.espacio(8);
    m.caja(t.pendent_text, { titulo: t.pendent_titol, fondo: COLORES.crema, barra: COLORES.coral });
  }

  // ----------------------------------------------------------------- respuestas
  m.espacio(10);
  m.titulo(t.questionari_titol, 2);
  m.parrafo(
    t.questionari_meta(
      (cuestionario.questionari ?? "").trim() || t.buit,
      String(cuestionario.versio_questionari ?? 0),
    ),
    { color: COLORES.verdeGris, tamano: 9, despues: 6 },
  );

  const respuestas = (Array.isArray(cuestionario.respostes) ? cuestionario.respostes : [])
    .filter((r) => r && (r.pregunta || r.id));
  if (respuestas.length === 0) {
    m.parrafo(t.sense_respostes, { color: COLORES.verdeGris, tamano: 10, despues: 6 });
  } else {
    // Tabla y no `campos()`: una respuesta puede ser larga y la tabla parte las celdas y
    // repite la cabecera al cambiar de página. La pregunta se imprime tal cual llega; si
    // no la hay, el `id`, que es lo único que identifica esa fila.
    const columnas: Columna[] = [
      { titulo: t.col.pregunta, ancho: 55 },
      { titulo: t.col.resposta, ancho: 45 },
    ];
    m.tabla({
      columnas,
      filas: respuestas.map((r) => [
        (r.pregunta ?? "").trim() || String(r.id ?? ""),
        valorLegible(r.valor, t),
      ]),
      cebra: true,
      despues: 6,
    });
  }

  // --------------------------------------------------------------------- notas
  const notas = (cuestionario.notes ?? "").trim();
  if (notas) {
    m.espacio(4);
    m.titulo(t.notes_titol, 3);
    m.parrafo(notas, { tamano: 9.5, despues: 6 });
  }

  // ---------------------------------------------------------------- texto legal
  pintarLegalPlan(m, t, lengua, op, {
    numero,
    codi: codigoVerificacion(op.sha256Datos),
    exercici: datos.exercici ?? "",
    nivell: nivel,
    organitzacio: {
      nom: datos.organitzacio?.nom ?? "",
      nif: datos.organitzacio?.nif ?? "",
      poblacio: datos.organitzacio?.poblacio ?? "",
    },
    fundacio: {
      rao_social: datos.fundacio?.["raó_social"] ?? "",
      cif: datos.fundacio?.cif ?? "",
      domicili: domicilioCompleto(datos.fundacio),
    },
  });

  // ------------------------------------------------------------- lugar y fecha
  const lugar = (datos.lloc ?? "").trim();
  const fecha = fechaLarga(datos.data_generacio, { mesos: MESES[lengua] }, lengua);
  if (lugar || fecha) {
    m.espacio(10);
    m.parrafo([lugar, fecha].filter(Boolean).join(", "), {
      color: COLORES.verdeGris,
      tamano: 9.5,
      despues: 4,
    });
  }

  m.finalizar();
  const bytes = await doc.save();
  return { bytes, paginas: m.numPaginas };
}

/** La organización del plan: la única parte que hay. */
function pintarOrganizacionPlan(
  m: Maquetador,
  t: DiccionarioPlan,
  org: OrganizacionPlan | null | undefined,
): void {
  const rotulo = org?.tipus === "entitat" ? t.entitat : t.productor;
  m.titulo(rotulo, 3);
  if (!org) {
    m.parrafo(t.buit, { color: COLORES.verdeGris, tamano: 10, despues: 4 });
    return;
  }
  m.campos(
    paresLlenos([
      [t.nom, org.nom],
      [t.nif, org.nif],
      [t.poblacio, org.poblacio],
      [t.comarca, org.comarca],
      [t.correu, org.email],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );
}

/** Quién lo emite. */
function pintarFundacion(
  m: Maquetador,
  t: DiccionarioPlan,
  org: OrganizacionCierre | null | undefined,
): void {
  m.titulo(t.emet, 3);
  if (!org) {
    m.parrafo(t.buit, { color: COLORES.verdeGris, tamano: 10, despues: 4 });
    return;
  }
  m.campos(
    paresLlenos([
      [t.rao_social, org["raó_social"]],
      [t.cif, org.cif ?? org.nif],
      [t.domicili, domicilioCompleto(org)],
      [t.inscripcio, org.inscripcio],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );
}

/**
 * La plantilla congelada si la hay, y si no el provisional dentro de la caja que dice que
 * lo es. Mismo criterio que `pintarLegal()` de `cierre.ts`; no se reutiliza aquella
 * porque exige un `ContextoCierre`, y un plan no tiene ninguno.
 */
function pintarLegalPlan(
  m: Maquetador,
  t: DiccionarioPlan,
  lengua: "ca" | "es",
  op: OpcionesPlan,
  valores: Record<string, unknown>,
): void {
  const cuerpo = op.plantilla?.cuerpo;
  m.espacio(6);
  m.filete();
  m.espacio(6);
  m.titulo(op.plantilla?.titulo || t.legal, 2);

  if (esCuerpo(cuerpo)) {
    const { bloques, faltan } = interpolarCuerpo(cuerpo, valores);
    pintarCuerpo(m, bloques);
    if (faltan.length) console.warn("pla: marcadores sin resolver:", faltan.join(", "));
    return;
  }
  const { bloques } = interpolarCuerpo(LEGAL_PROVISIONAL[lengua], valores);
  pintarCuerpo(m, bloques);
  m.espacio(4);
  m.caja(t.provisional_avis, { titulo: t.provisional_titol });
}
