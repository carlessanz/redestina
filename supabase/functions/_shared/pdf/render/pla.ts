// Plan de prevención básico (PLA) — línea 5 del funcional, diagnóstico y prevención.
//
// ⚠️ ESTE RENDERIZADOR NO SABE NI UNA SOLA PREGUNTA, Y SIGUE SIN SABERLA. El cuestionario
//    ya existe (F2: `questionaris_diagnostic`, 12 preguntas por tipo de organización) pero
//    vive en la base, versionado, y viaja **autocontenido** dentro del snapshot: cada
//    respuesta trae el texto de su pregunta y el de la opción elegida, en ca y es. Aquí se
//    pinta lo que venga, en el orden en que venga, y no se interpreta nada.
//
//    Inventarse aquí unas preguntas de negocio sería peor que no tener ninguna: quedarían
//    sembradas en el código, alguien las daría por válidas y el día que llegue el anexo B
//    habría que migrar respuestas reales. El mismo argumento vale para las medidas, que
//    llegan **ya resueltas al idioma del plan** desde `plan_datos()`: el catálogo puede
//    cambiar mañana y un plan emitido tiene que seguir imprimiéndose como se emitió.
//
// 🔴 `pregunta` ES `{ca, es}`, NO UNA CADENA (F2). Hasta la fase anterior era texto plano;
//    desde que `compondre_respostes()` la compone, es un objeto bilingüe. Cualquier cosa
//    que la imprima sin pasar por `textoIdioma()` escribe `[object Object]` en un papel con
//    el sello de la Fundación, y no falla ni avisa. Los planes emitidos ANTES de F2 la
//    siguen trayendo como cadena, así que se admiten las dos formas.
//
// 🔴 Y LA CAJA DE AVISO YA NO SE DECIDE CON `versio_questionari === 0`. El cuestionario
//    sembrado ES la versión 0 y SÍ tiene preguntas, así que decir «el qüestionari encara no
//    està definit» pasó a ser falso el día que se aplicó el seed. El marcador correcto es
//    `questionari_provisional`, que viene del sobre congelado, y lo que el papel dice ahora
//    es lo que es cierto: que ese cuestionario es texto de trabajo que la Fundació y su
//    asesoría todavía no han validado. Mismo criterio que los convenios (§12.77) y que la
//    plantilla del certificado de recepción.
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

/**
 * Texto bilingüe tal como lo guardan las tablas del diagnóstico: `{ca, es}`. Se imprime
 * con `textoIdioma()`, nunca directamente (ver cabecera).
 */
export interface TextoBilingue {
  ca?: string | null;
  es?: string | null;
}

/**
 * Una respuesta del cuestionario, autocontenida (`compondre_respostes()`).
 *
 * `valor` sigue siendo `unknown` a propósito: es lo que tecleó la persona, y su forma
 * depende del `tipus` de la pregunta. Lo que se imprime, cuando existe, es `etiqueta`
 * (opción única y sí/no) o `etiquetes` (selección múltiple) —el texto de verdad—; `valor`
 * es el respaldo para los tipos que no tienen opciones (`text`, `numero`) y para los
 * planes anteriores a F2, que no traían ninguna etiqueta.
 */
export interface RespuestaPlan {
  id?: string | null;
  /** `opcio` · `multi` · `boolea` · `numero` · `text`. Informativo: aquí no se interpreta. */
  tipus?: string | null;
  /** Bloque del cuestionario, mismo vocabulario que `mesures_prevencio.bloc`. */
  seccio?: string | null;
  /** Desde F2, `{ca, es}`. Los planes anteriores la traen como cadena. */
  pregunta?: string | TextoBilingue | null;
  valor?: unknown;
  /** El texto de la opción elegida (`opcio`, `boolea`). */
  etiqueta?: string | TextoBilingue | null;
  /** Los textos de las opciones marcadas (`multi`). */
  etiquetes?: (string | TextoBilingue | null)[] | null;
}

export interface CuestionarioPlan {
  /** El código interno del cuestionario (`diagnostic_productor`). No es su título. */
  questionari?: string | null;
  questionari_id?: string | null;
  versio_questionari?: number | string | null;
  questionari_provisional?: boolean | null;
  /** El título que lee una persona. Bilingüe desde F2. */
  titol?: string | TextoBilingue | null;
  respostes?: RespuestaPlan[] | null;
  notes?: string | null;
}

/**
 * Una medida del plan. `titol` y `descripcio` llegan **ya resueltos al idioma del plan**
 * (`generar_pla_des_de_diagnostic()` las copia con el `->> pl.idioma` dentro), así que aquí
 * son cadenas; se aceptan igualmente bilingües por si algún día dejaran de serlo.
 */
export interface MesuraPlan {
  codi?: string | null;
  /** `planificacio` · `collita` · `conservacio` · `canalitzacio` · `seguiment`. */
  bloc?: string | null;
  titol?: string | TextoBilingue | null;
  descripcio?: string | TextoBilingue | null;
  obligatoria?: boolean | null;
  /** `regla` (la produjo el motor) o `manual` (la añadió el equipo). */
  origen?: string | null;
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
  questionari_id?: string | null;
  questionari_versio?: number | string | null;
  /** Lo que decide la caja de aviso. Ausente = se asume `true` (ver cabecera). */
  questionari_provisional?: boolean | null;
  /** El contenido del plan. Vacío en los planes anteriores a F2. */
  mesures?: MesuraPlan[] | null;
  mesures_observacions?: string | null;
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
  provisional_q_titol: string;
  provisional_q_text: string;
  mesures_titol: string;
  mesures_intro: string;
  mesures_resum: (obligatories: number, recomanades: number) => string;
  sense_mesures: string;
  obligatoria: string;
  recomanada: string;
  observacions_titol: string;
  questionari_titol: string;
  questionari_meta: (nom: string, versio: string) => string;
  sense_respostes: string;
  notes_titol: string;
  /** Los cinco bloques, que el cuestionario y el catálogo de medidas comparten. */
  blocs: Record<string, string>;
  bloc_altres: string;
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
  provisional_q_titol: "Qüestionari i mesures pendents de validació",
  provisional_q_text:
    "El qüestionari amb què s'ha fet aquest diagnòstic és text de treball: encara no l'han validat la Fundació Espigoladors ni l'assessoria (annex B del document funcional). Les mesures que se'n deriven són, per tant, una proposta inicial i no acrediten el compliment de cap obligació. El contingut és el que consta al sistema i serveix per començar a treballar; quan hi hagi la versió validada, aquesta organització rebrà un pla nou que substituirà aquest.",
  mesures_titol: "Pla de mesures",
  mesures_intro:
    "Les mesures surten de les respostes del diagnòstic. Les obligatòries són les que la Fundació demana per poder mesurar; la resta són recomanacions.",
  mesures_resum: (obligatories, recomanades) =>
    `Obligatòries: ${obligatories} · Recomanades: ${recomanades}`,
  sense_mesures:
    "Aquest pla no porta cap mesura: es va emetre abans que el diagnòstic les generés.",
  obligatoria: "OBLIGATÒRIA",
  recomanada: "RECOMANADA",
  observacions_titol: "Observacions",
  questionari_titol: "Respostes del diagnòstic",
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
  blocs: {
    planificacio: "Planificació",
    collita: "Collita",
    conservacio: "Conservació",
    canalitzacio: "Canalització",
    seguiment: "Seguiment i registre",
  },
  bloc_altres: "Altres",
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
  provisional_q_titol: "Cuestionario y medidas pendientes de validación",
  provisional_q_text:
    "El cuestionario con el que se ha hecho este diagnóstico es texto de trabajo: todavía no lo han validado la Fundació Espigoladors ni la asesoría (anexo B del documento funcional). Las medidas que se derivan de él son, por tanto, una propuesta inicial y no acreditan el cumplimiento de ninguna obligación. El contenido es el que consta en el sistema y sirve para empezar a trabajar; cuando exista la versión validada, esta organización recibirá un plan nuevo que sustituirá a este.",
  mesures_titol: "Plan de medidas",
  mesures_intro:
    "Las medidas salen de las respuestas del diagnóstico. Las obligatorias son las que la Fundación pide para poder medir; el resto son recomendaciones.",
  mesures_resum: (obligatories, recomanades) =>
    `Obligatorias: ${obligatories} · Recomendadas: ${recomanades}`,
  sense_mesures:
    "Este plan no lleva ninguna medida: se emitió antes de que el diagnóstico las generara.",
  obligatoria: "OBLIGATORIA",
  recomanada: "RECOMENDADA",
  observacions_titol: "Observaciones",
  questionari_titol: "Respuestas del diagnóstico",
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
  blocs: {
    planificacio: "Planificación",
    collita: "Recolección",
    conservacio: "Conservación",
    canalitzacio: "Canalización",
    seguiment: "Seguimiento y registro",
  },
  bloc_altres: "Otros",
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
 * `valor` es `unknown` a propósito (ver cabecera): su forma la decide el `tipus` de la
 * pregunta —sí/no, número, texto o lista— y este módulo no conoce ninguna pregunta. Esto
 * lo convierte en algo legible **sin interpretarlo**, y es el respaldo de
 * `respuestaLegible()` para los tipos que no traen etiqueta:
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

/**
 * 🔴 EL ANTÍDOTO CONTRA `[object Object]`. Todo lo que viene del diagnóstico —preguntas,
 * etiquetas de opción, títulos— es `{ca, es}` desde F2, y era una cadena antes. Las dos
 * formas entran por aquí y salen como texto.
 *
 * El respaldo NO es el idioma del documento: si falta la lengua pedida se usa la otra,
 * porque un texto en el idioma equivocado sigue diciendo lo que dice, y un hueco no.
 */
export function textoIdioma(valor: unknown, lengua: "ca" | "es"): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    for (const clave of [lengua, "ca", "es"]) {
      const v = o[clave];
      if (typeof v === "string" && v.trim() !== "") return v.trim();
    }
    return "";
  }
  return String(valor).trim();
}

/**
 * Lo que se imprime en la columna «Resposta».
 *
 * Primero las etiquetas, que son el texto que la persona vio y eligió; `valor` solo cuando
 * no hay ninguna —un número, un texto libre, o un plan anterior a F2—. Imprimir `valor`
 * habiendo etiqueta pondría el código interno (`mes_20000`) en el papel.
 */
function respuestaLegible(r: RespuestaPlan, t: DiccionarioPlan, lengua: "ca" | "es"): string {
  if (Array.isArray(r.etiquetes)) {
    const partes = r.etiquetes.map((e) => textoIdioma(e, lengua)).filter((x) => x !== "");
    if (partes.length > 0) return partes.join(", ");
  }
  const etiqueta = textoIdioma(r.etiqueta, lengua);
  if (etiqueta !== "") return etiqueta;
  return valorLegible(r.valor, t);
}

/** El orden de los bloques es el del proceso, no el alfabético. */
const ORDEN_BLOQUES = [
  "planificacio",
  "collita",
  "conservacio",
  "canalitzacio",
  "seguiment",
] as const;

interface GrupoBloque<T> {
  bloc: string;
  items: T[];
}

/**
 * Agrupa por bloque respetando `ORDEN_BLOQUES` y dejando al final lo que no reconozca
 * —incluido el bloque vacío de los planes anteriores a F2, que no traían `seccio`—. Un
 * bloque desconocido se imprime con su código: inventarle un nombre sería peor.
 */
function agruparPorBloque<T>(items: T[], bloque: (x: T) => string): GrupoBloque<T>[] {
  const mapa = new Map<string, T[]>();
  for (const item of items) {
    const clave = bloque(item);
    const lista = mapa.get(clave);
    if (lista) lista.push(item);
    else mapa.set(clave, [item]);
  }
  const salida: GrupoBloque<T>[] = [];
  for (const bloc of ORDEN_BLOQUES) {
    const lista = mapa.get(bloc);
    if (lista) {
      salida.push({ bloc, items: lista });
      mapa.delete(bloc);
    }
  }
  for (const [bloc, items2] of mapa) salida.push({ bloc, items: items2 });
  return salida;
}

function etiquetaBloque(t: DiccionarioPlan, bloc: string): string {
  return t.blocs[bloc] ?? (bloc !== "" ? bloc : t.bloc_altres);
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
  // Va ARRIBA, antes del plan: quien abra el PDF tiene que leer con qué se ha hecho antes
  // de leer lo que dice. En coral, que en el sistema de diseño no significa error sino
  // atención (§AGENTS.md 2bis).
  //
  // ⚠️ El marcador es `questionari_provisional` y se compara con `!== false`, no con
  //    `=== true`: los planes emitidos antes de F2 no traen la clave, y ante la duda el
  //    aviso se imprime. Decir que un documento está validado cuando no lo está es el
  //    único error caro de los dos. (Para aquellos planes la frase también es cierta: se
  //    hicieron sin ningún cuestionario validado.)
  const cuestionario = datos.questionari ?? {};
  const versionCuestionario = String(
    datos.questionari_versio ?? cuestionario.versio_questionari ?? 0,
  );
  const provisional = datos.questionari_provisional !== false &&
    cuestionario.questionari_provisional !== false;
  if (provisional) {
    m.espacio(8);
    m.caja(t.provisional_q_text, {
      titulo: t.provisional_q_titol,
      fondo: COLORES.crema,
      barra: COLORES.coral,
    });
  }

  // ------------------------------------------------------------ el plan de medidas
  // Antes de las respuestas: quien abre un «Pla de prevenció» busca qué tiene que hacer.
  // Las respuestas son el diagnóstico que lo justifica, y van después.
  pintarMesures(
    m,
    t,
    lengua,
    Array.isArray(datos.mesures) ? datos.mesures : [],
    (datos.mesures_observacions ?? "").trim(),
  );

  // ----------------------------------------------------------------- respuestas
  m.espacio(10);
  m.titulo(t.questionari_titol, 2);
  m.parrafo(
    t.questionari_meta(
      textoIdioma(cuestionario.titol, lengua) || (cuestionario.questionari ?? "").trim() ||
        t.buit,
      versionCuestionario,
    ),
    { color: COLORES.verdeGris, tamano: 9, despues: 6 },
  );

  const respuestas = (Array.isArray(cuestionario.respostes) ? cuestionario.respostes : [])
    .filter((r) => r && (r.pregunta || r.id));
  if (respuestas.length === 0) {
    m.parrafo(t.sense_respostes, { color: COLORES.verdeGris, tamano: 10, despues: 6 });
  } else {
    // Tabla y no `campos()`: una respuesta puede ser larga y la tabla parte las celdas y
    // repite la cabecera al cambiar de página. Una tabla POR SECCIÓN, porque el
    // cuestionario viene agrupado y doce filas seguidas no se leen; si ninguna respuesta
    // trae `seccio` —los planes anteriores a F2— sale una sola tabla sin rótulo, que es
    // exactamente lo que se imprimía antes.
    const columnas: Columna[] = [
      { titulo: t.col.pregunta, ancho: 55 },
      { titulo: t.col.resposta, ancho: 45 },
    ];
    const grupos = agruparPorBloque(respuestas, (r) => (r.seccio ?? "").trim());
    const sinSeccion = grupos.length === 1 && grupos[0].bloc === "";
    for (const grupo of grupos) {
      if (!sinSeccion) m.titulo(etiquetaBloque(t, grupo.bloc), 3);
      m.tabla({
        columnas,
        filas: grupo.items.map((r) => [
          // 🔴 `textoIdioma`, no `r.pregunta` a secas: desde F2 es `{ca, es}` y un
          //    `String()` implícito imprimiría `[object Object]`.
          textoIdioma(r.pregunta, lengua) || String(r.id ?? ""),
          respuestaLegible(r, t, lengua),
        ]),
        cebra: true,
        despues: 6,
      });
    }
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
 * El contenido del plan: las medidas, agrupadas por bloque y en el orden del proceso.
 *
 * ⚠️ LA PROPORCIÓN TIENE QUE LEERSE. Hoy solo las medidas de registro nacen obligatorias
 *    (decisión del 22-09-2026), así que el plan normal es **una obligatoria y varias
 *    recomendadas**. Si las dos clases se imprimieran igual, la organización leería una
 *    lista de diez deberes y no haría ninguno; por eso cada medida lleva su distintivo y
 *    la sección abre con el recuento.
 */
function pintarMesures(
  m: Maquetador,
  t: DiccionarioPlan,
  lengua: "ca" | "es",
  mesures: MesuraPlan[],
  observacions: string,
): void {
  m.espacio(8);
  m.titulo(t.mesures_titol, 2);

  if (mesures.length === 0) {
    // Solo alcanzable en planes anteriores a F2: desde entonces `emitir_plan_basico()` se
    // niega a emitir un plan sin ninguna medida (`22023 sense_mesures`). Se dice lo que
    // pasa en vez de dejar un hueco.
    m.parrafo(t.sense_mesures, { color: COLORES.verdeGris, tamano: 10, despues: 6 });
    return;
  }

  const obligatories = mesures.filter((x) => x.obligatoria === true).length;
  m.parrafo(t.mesures_intro, { tamano: 9.5, despues: 4 });
  m.parrafo(t.mesures_resum(obligatories, mesures.length - obligatories), {
    color: COLORES.verdeGris,
    tamano: 9,
    despues: 6,
  });

  for (const grupo of agruparPorBloque(mesures, (x) => (x.bloc ?? "").trim())) {
    m.titulo(etiquetaBloque(t, grupo.bloc), 3);
    for (const mesura of grupo.items) pintarMesura(m, t, lengua, mesura);
  }

  if (observacions) {
    m.espacio(2);
    m.titulo(t.observacions_titol, 3);
    m.parrafo(observacions, { tamano: 9.5, despues: 6 });
  }
}

/**
 * Una medida: el distintivo, el título en su línea y la descripción debajo, sangrada a la
 * altura del título.
 *
 * ⚠️ El distintivo se dibuja a mano porque el maquetador no tiene esa primitiva, y NO se
 *    le añade una: ese módulo lo importan los nueve renderizadores y tocarlo obligaría a
 *    revisarlos todos por una etiqueta que hoy usa uno.
 * ⚠️ Los colores salen de `COLORES`, que son los tokens: coral con texto NEGRO —coral solo
 *    da 2,67:1 sobre blanco, así que encima nunca va texto claro (§2bis)— y verde suave con
 *    verde oscuro para lo recomendado. El coral aquí no significa error, significa atención.
 * ⚠️ `asegurar()` reserva el título y dos líneas de descripción ANTES de leer `m.y`: si
 *    saltara de página entremedias, el distintivo se quedaría en una hoja y su título en la
 *    siguiente.
 */
function pintarMesura(
  m: Maquetador,
  t: DiccionarioPlan,
  lengua: "ca" | "es",
  mesura: MesuraPlan,
): void {
  const tamano = 10;
  const altoLinea = tamano * 1.35;
  const obligatoria = mesura.obligatoria === true;
  const distintivo = obligatoria ? t.obligatoria : t.recomanada;

  const tamanoDistintivo = 7.5;
  const relleno = 5;
  const anchoDistintivo = m.medir(distintivo, m.fuentes.cuerpoFuerte, tamanoDistintivo) +
    relleno * 2;
  const sangria = anchoDistintivo + 8;

  const titulo = textoIdioma(mesura.titol, lengua) || (mesura.codi ?? "").trim() || t.buit;
  const lineas = m.cortar(titulo, m.fuentes.cuerpoFuerte, tamano, m.anchoUtil - sangria);
  m.asegurar(lineas.length * altoLinea + 9.5 * 1.35 * 2);

  const y = m.y;
  m.paginaActual.drawRectangle({
    x: m.x,
    y: y - altoLinea,
    width: anchoDistintivo,
    height: altoLinea,
    color: obligatoria ? COLORES.coral : COLORES.verdeSuave,
  });
  m.paginaActual.drawText(distintivo, {
    x: m.x + relleno,
    // Misma línea base que el título: los dos se leen como una sola línea.
    y: y - tamano,
    size: tamanoDistintivo,
    font: m.fuentes.cuerpoFuerte,
    color: obligatoria ? COLORES.negro : COLORES.verdeOscuro,
  });

  let cursor = y;
  for (const linea of lineas) {
    if (linea) {
      m.paginaActual.drawText(linea, {
        x: m.x + sangria,
        y: cursor - tamano,
        size: tamano,
        font: m.fuentes.cuerpoFuerte,
        color: COLORES.negro,
      });
    }
    cursor -= altoLinea;
  }
  // El cursor del maquetador es privado: se consume lo dibujado con `espacio()`, que
  // además comprueba el límite inferior como lo haría `parrafo()`.
  m.espacio(lineas.length * altoLinea);

  const descripcion = textoIdioma(mesura.descripcio, lengua);
  if (descripcion) {
    m.parrafo(descripcion, {
      tamano: 9.5,
      color: COLORES.verdeGris,
      sangria,
      despues: 7,
    });
  } else {
    m.espacio(7);
  }
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
