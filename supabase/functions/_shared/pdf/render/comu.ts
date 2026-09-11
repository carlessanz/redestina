// Esqueleto común de los tres albaranes (REC, ENT, OPE) — anexo A del plan funcional.
//
// Los tres documentos son el mismo papel con distinto reparto de partes y distintas
// columnas de kilos: identificación arriba, quién entrega y quién recibe, los datos de
// la recogida, la tabla de líneas, el cierre (envases, observaciones, incidencias,
// rechazo), el texto legal y el espacio de conformidad. Escribir tres veces esa
// estructura garantizaba que en tres meses divergieran; lo que cambia de verdad
// —el título, las columnas y un par de bloques— es lo que cada renderizador aporta.
//
// ⚠️ NINGUNA CIFRA EN EUROS, EN NINGUNO DE LOS TRES. No es una convención de estilo: un
//    albarán con importe es una factura a ojos de cualquiera que lo lea, y la donación
//    a Espigoladors no la lleva. La garantía es estructural —`albaran_lineas` no tiene
//    ni una columna de importe y `albaran_datos()` no devuelve ninguna—, así que aquí
//    no hay nada que filtrar: no hay de dónde sacar un euro. Lo único que podría colar
//    uno es el texto libre que escribe una persona (observaciones, motivo de rechazo),
//    y ese no se toca: falsear lo que alguien escribió sería peor que el símbolo.
//
// El renderizador NO lee ficheros ni habla con la base (mismo contrato que `prova.ts`):
// recibe los activos ya leídos y el snapshot `documentos.datos` ya congelado. Eso es lo
// que hace que un PDF de hace dos años se pueda regenerar idéntico.

import { PDFDocument } from "npm:pdf-lib@1";
import { type BytesActivos, embeberFuentes, embeberLogo } from "../fuentes.ts";
import { COLORES, type Columna, Maquetador } from "../maquetador.ts";
import { type Bloque, esCuerpo, interpolarCuerpo, pintarCuerpo } from "../plantilla.ts";

// ---------------------------------------------------------------------------
// El snapshot, tal como lo compone `albaran_datos()` (20261012100500)
// ---------------------------------------------------------------------------
// Todo opcional: es un jsonb, y un renderizador que asume campos obligatorios sobre un
// jsonb es un renderizador que un día no genera el documento.

export interface ParteAlbaran {
  razon_social?: string | null;
  nombre_comercial?: string | null;
  nif?: string | null;
  domicilio?: string | null;
  lugar_recogida?: string | null;
  contacto?: string | null;
  inscripcion?: string | null;
}

export interface OrigenAlbaran {
  municipio?: string | null;
  comarca?: string | null;
  codigo_lote?: string | null;
}

export interface RecogidaAlbaran {
  fecha_hora?: string | null;
  responsable_origen?: string | null;
  quien_recoge?: string | null;
  transportista?: string | null;
  matricula?: string | null;
  temperatura?: string | number | null;
  lugar?: string | null;
}

export interface LineaAlbaran {
  ordre?: number | null;
  producte?: string | null;
  varietat?: string | null;
  familia?: string | null;
  causa?: string | null;
  caixes?: number | null;
  tipus_caixa?: string | null;
  kg_brut?: number | null;
  tara_kg?: number | null;
  kg_net?: number | null;
  kg_previstos?: number | null;
  kg_confirmats?: number | null;
  kg_validats?: number | null;
  lot_origen?: string | null;
}

export interface ExternoCitado {
  tipus?: string | null;
  numero?: string | null;
  data?: string | null;
}

export interface DatosAlbaran {
  tipus?: string | null;
  numero?: string | null;
  ejercici?: number | null;
  idioma?: string | null;
  emes_at?: string | null;
  partes?: {
    entrega?: ParteAlbaran | null;
    recibe?: ParteAlbaran | null;
    origen?: OrigenAlbaran | null;
  } | null;
  recollida?: RecogidaAlbaran | null;
  retorn_envasos?: string | null;
  observacions?: string | null;
  incidencies?: unknown;
  rebuig?: { tipus?: string | null; motiu?: string | null } | null;
  referencies?: {
    registre?: string | null;
    espigolada?: string | null;
    rectifica?: string | null;
    externs?: ExternoCitado[] | null;
  } | null;
  linies?: LineaAlbaran[] | null;
  /** Lo aporta la canalización; el ENT lo imprime junto al origen (D3). */
  nota_lot?: string | null;
  /** Tipo de entrada del REC: `donacio` o `espigolament`. */
  tipus_entrada?: string | null;
  /** Tipología de transformación (solo maquila, OPE). */
  transformacio?: string | null;
}

/** Lo que `generar-documento` saca de `plantillas_documento` por `documentos.plantilla_id`. */
export interface PlantillaLegal {
  titulo?: string | null;
  cuerpo?: unknown;
}

export interface OpcionesAlbaran {
  /** Snapshot congelado (`documentos.datos`). */
  datos: DatosAlbaran;
  /** `documentos.sha256_datos`: la huella que se imprime como código de verificación. */
  sha256Datos?: string | null;
  /** Plantilla legal vigente para este tipo e idioma. Sin ella se imprime el provisional. */
  plantilla?: PlantillaLegal | null;
  /** `prueba` estampa filigrana; los albaranes reales no la llevan. */
  modo?: "real" | "prueba";
  /** Marca de rectificativo: cambia el título y cita el documento rectificado. */
  rectificativo?: boolean;
  /** Versión del documento; la 2ª es la que se emite al conciliar. */
  subtipo?: string | null;
  /**
   * Espacios de conformidad, en orden. Vacío = uno solo, sin rótulo (REC y ENT: confirma
   * quien recibe). El OPE pasa dos, porque confirman las dos partes (§3.3.2 del
   * funcional), y cada uno dice **de qué parte es** para poder casarlo con su
   * confirmación (`enlaces_token.rol_parte`).
   */
  conformidades?: EspacioConformidad[];
  /**
   * Las confirmaciones ya registradas por enlace, si las hay (deuda §12.60).
   *
   * ⚠️ NO SALEN DEL SNAPSHOT, y no pueden salir. `documentos.datos` se congela **al
   *    emitir**, y `marcar_entregado()` exige que el albarán esté ya `emitido`: cuando
   *    alguien confirma, el snapshot lleva rato siendo inmutable. Así que esto lo lee
   *    `generar-documento` de `evidencias` con `service_role` —el mismo camino que ya
   *    usa el convenio para el trazo y el DNI— y lo entrega ya resuelto. El
   *    renderizador sigue sin hablar con la base.
   */
  confirmaciones?: ConfirmacionAlbaran[];
}

/** Un espacio de firma: su rótulo y, si se sabe, de qué parte del albarán es. */
export interface EspacioConformidad {
  rotulo: string;
  /** Vocabulario de `albaran_partes()`: `entrega` o `recibe`. */
  rol?: RolParte | null;
}

export type RolParte = "entrega" | "recibe";

/**
 * Una confirmación registrada. Lo que se imprime y lo que NO:
 *
 *   · Sí: quién dijo ser, su cargo, cuándo, por qué vía y una referencia auditable.
 *   · No: **la IP ni el user-agent**. El texto legal ya dice que quedan registrados, y
 *     un albarán lo descarga también la otra parte: la dirección desde la que alguien
 *     confirmó es un dato personal que no tiene por qué viajar en el papel. Está en
 *     `evidencias`, que es donde se consulta si alguna vez hay que probar algo.
 */
export interface ConfirmacionAlbaran {
  /** `evidencias.nombre`: quién declaró ser. */
  nombre?: string | null;
  /** `evidencias.cargo`. */
  cargo?: string | null;
  /** `evidencias.created_at`. */
  at?: string | null;
  /** `enlaces_token.canal`: `email` (enlace) o `asistido`. */
  canal?: string | null;
  /**
   * `enlaces_token.rol_parte`. **Nullable a propósito**: los enlaces anteriores a
   * `20270304100200` no lo tienen y no se rellena a posteriori. Sin rol, una confirmación
   * no se atribuye a ninguna parte: se lista aparte.
   */
  rol?: RolParte | null;
  /** Referencia corta de la evidencia, para poder encontrarla sin publicar su uuid entero. */
  referencia?: string | null;
}

export interface Renderizado {
  bytes: Uint8Array;
  paginas: number;
}

// ---------------------------------------------------------------------------
// Textos — catalán por defecto, castellano por `documentos.idioma`
// ---------------------------------------------------------------------------
// Los textos del documento NO pasan por el i18n del frontend (`src/lib/i18n.tsx`): eso
// vive en el navegador y esto se ejecuta en el servidor sobre un idioma congelado en la
// fila. Son dos cosas distintas y se quedan separadas a propósito.

type Idioma = "ca" | "es";

export interface Diccionario {
  rec: string;
  ent: string;
  ope: string;
  rec_sub: string;
  ent_sub: string;
  ope_sub: string;
  rectificatiu: string;
  identificacio: string;
  numero: string;
  data_emissio: string;
  exercici: string;
  tipus_entrada: string;
  donacio: string;
  espigolament: string;
  referencia_registre: string;
  referencia_espigolada: string;
  rectifica_a: string;
  document_extern: string;
  codi_verificacio: string;
  entrega: string;
  rep: string;
  rao_social: string;
  nom_comercial: string;
  nif: string;
  domicili: string;
  lloc_recollida: string;
  persona_contacte: string;
  inscripcio: string;
  origen: string;
  municipi: string;
  comarca: string;
  codi_lot: string;
  nota_lot: string;
  recollida: string;
  data_hora: string;
  responsable_origen: string;
  qui_recull: string;
  transportista: string;
  matricula: string;
  temperatura: string;
  lloc: string;
  transformacio: string;
  linies: string;
  sense_linies: string;
  total: string;
  tancament: string;
  retorn_envasos: string;
  observacions: string;
  incidencies: string;
  rebuig: string;
  rebuig_cap: string;
  rebuig_parcial: string;
  rebuig_total: string;
  motiu: string;
  conformitat: string;
  conformitat_text: string;
  nom_cognoms: string;
  carrec: string;
  data_signatura: string;
  signatura: string;
  confirmat_enllac: string;
  confirmat_assistit: string;
  confirmacions: string;
  referencia: string;
  pendent_signatura: string;
  legal: string;
  provisional_titol: string;
  provisional_avis: string;
  peu: string;
  pagina: (n: number, total: number) => string;
  col: Record<string, string>;
}

const CA: Diccionario = {
  rec: "Albarà de recepció",
  ent: "Albarà d'entrega",
  ope: "Albarà d'operació",
  rec_sub: "Entrada d'aliments fora del circuit de venda habitual",
  ent_sub: "Entrega a entitat receptora",
  ope_sub: "Operació entre el generador i el receptor",
  rectificatiu: "Rectificatiu",
  identificacio: "Identificació",
  numero: "Número",
  data_emissio: "Data d'emissió",
  exercici: "Exercici",
  tipus_entrada: "Tipus d'entrada",
  donacio: "Donació",
  espigolament: "Espigolada",
  referencia_registre: "Referència del registre",
  referencia_espigolada: "Referència de l'espigolada",
  rectifica_a: "Rectifica l'albarà",
  document_extern: "Albarà del productor",
  codi_verificacio: "Codi de verificació",
  entrega: "Entrega",
  rep: "Rep",
  rao_social: "Raó social",
  nom_comercial: "Nom comercial",
  nif: "NIF",
  domicili: "Domicili",
  lloc_recollida: "Lloc de recollida",
  persona_contacte: "Persona de contacte",
  inscripcio: "Inscripció",
  origen: "Origen del producte",
  municipi: "Municipi",
  comarca: "Comarca",
  codi_lot: "Codi de lot",
  nota_lot: "Nota del lot",
  recollida: "Recollida",
  data_hora: "Data i hora",
  responsable_origen: "Responsable a l'origen",
  qui_recull: "Qui recull",
  transportista: "Transportista",
  matricula: "Matrícula",
  temperatura: "Temperatura de càrrega",
  lloc: "Lloc",
  transformacio: "Tipologia de transformació",
  linies: "Detall del producte",
  sense_linies: "Aquest albarà no té cap línia de producte.",
  total: "Total",
  tancament: "Tancament",
  retorn_envasos: "Retorn d'envasos",
  observacions: "Observacions",
  incidencies: "Incidències",
  rebuig: "Rebuig",
  rebuig_cap: "Cap",
  rebuig_parcial: "Parcial",
  rebuig_total: "Total",
  motiu: "Motiu",
  conformitat: "Conformitat",
  conformitat_text:
    "Qui rep signa la conformitat amb el producte i els quilos que consten en aquest albarà. La confirmació també es pot fer des de l'enllaç que Redestina envia per correu; en aquest cas queda registrada amb la data, l'hora i l'adreça des de la qual es va fer.",
  nom_cognoms: "Nom i cognoms",
  carrec: "Càrrec",
  data_signatura: "Data",
  signatura: "Signatura",
  confirmat_enllac: "Confirmat des de l'enllaç",
  confirmat_assistit: "Confirmat amb acompanyament de l'equip",
  confirmacions: "Confirmacions registrades",
  referencia: "Referència",
  pendent_signatura: "Pendent de signatura",
  legal: "Condicions",
  provisional_titol: "Text provisional, pendent de validació",
  provisional_avis:
    "Aquest text encara no ha estat validat per la Fundació Espigoladors ni per l'assessoria. S'imprimeix perquè el document sigui llegible mentre no hi hagi la plantilla definitiva; no substitueix el text legal.",
  peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n, total) => `pàg. ${n} de ${total}`,
  col: {
    n: "#",
    producte: "Producte",
    varietat: "Varietat",
    familia: "Família",
    causa: "Motiu fora de circuit",
    caixes: "Caixes",
    tipus_caixa: "Tipus",
    kg_brut: "Kg bruts",
    tara: "Tara",
    kg_net: "Kg nets",
    kg_previstos: "Kg previstos",
    kg_entregats: "Kg entregats",
    kg_confirmats: "Kg confirmats",
    lot: "Lot",
  },
};

const ES: Diccionario = {
  rec: "Albarán de recepción",
  ent: "Albarán de entrega",
  ope: "Albarán de operación",
  rec_sub: "Entrada de alimentos fuera del circuito de venta habitual",
  ent_sub: "Entrega a entidad receptora",
  ope_sub: "Operación entre el generador y el receptor",
  rectificatiu: "Rectificativo",
  identificacio: "Identificación",
  numero: "Número",
  data_emissio: "Fecha de emisión",
  exercici: "Ejercicio",
  tipus_entrada: "Tipo de entrada",
  donacio: "Donación",
  espigolament: "Espigueo",
  referencia_registre: "Referencia del registro",
  referencia_espigolada: "Referencia del espigueo",
  rectifica_a: "Rectifica el albarán",
  document_extern: "Albarán del productor",
  codi_verificacio: "Código de verificación",
  entrega: "Entrega",
  rep: "Recibe",
  rao_social: "Razón social",
  nom_comercial: "Nombre comercial",
  nif: "NIF",
  domicili: "Domicilio",
  lloc_recollida: "Lugar de recogida",
  persona_contacte: "Persona de contacto",
  inscripcio: "Inscripción",
  origen: "Origen del producto",
  municipi: "Municipio",
  comarca: "Comarca",
  codi_lot: "Código de lote",
  nota_lot: "Nota del lote",
  recollida: "Recogida",
  data_hora: "Fecha y hora",
  responsable_origen: "Responsable en origen",
  qui_recull: "Quién recoge",
  transportista: "Transportista",
  matricula: "Matrícula",
  temperatura: "Temperatura de carga",
  lloc: "Lugar",
  transformacio: "Tipología de transformación",
  linies: "Detalle del producto",
  sense_linies: "Este albarán no tiene ninguna línea de producto.",
  total: "Total",
  tancament: "Cierre",
  retorn_envasos: "Retorno de envases",
  observacions: "Observaciones",
  incidencies: "Incidencias",
  rebuig: "Rechazo",
  rebuig_cap: "Ninguno",
  rebuig_parcial: "Parcial",
  rebuig_total: "Total",
  motiu: "Motivo",
  conformitat: "Conformidad",
  conformitat_text:
    "Quien recibe firma la conformidad con el producto y los kilos que constan en este albarán. La confirmación también puede hacerse desde el enlace que Redestina envía por correo; en ese caso queda registrada con la fecha, la hora y la dirección desde la que se hizo.",
  nom_cognoms: "Nombre y apellidos",
  carrec: "Cargo",
  data_signatura: "Fecha",
  signatura: "Firma",
  confirmat_enllac: "Confirmado desde el enlace",
  confirmat_assistit: "Confirmado con acompañamiento del equipo",
  confirmacions: "Confirmaciones registradas",
  referencia: "Referencia",
  pendent_signatura: "Pendiente de firma",
  legal: "Condiciones",
  provisional_titol: "Texto provisional, pendiente de validación",
  provisional_avis:
    "Este texto todavía no ha sido validado por la Fundació Espigoladors ni por la asesoría. Se imprime para que el documento sea legible mientras no exista la plantilla definitiva; no sustituye al texto legal.",
  peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n, total) => `pág. ${n} de ${total}`,
  col: {
    n: "#",
    producte: "Producto",
    varietat: "Variedad",
    familia: "Familia",
    causa: "Motivo fuera de circuito",
    caixes: "Cajas",
    tipus_caixa: "Tipo",
    kg_brut: "Kg brutos",
    tara: "Tara",
    kg_net: "Kg netos",
    kg_previstos: "Kg previstos",
    kg_entregats: "Kg entregados",
    kg_confirmats: "Kg confirmados",
    lot: "Lote",
  },
};

export function diccionario(idioma: string | null | undefined): Diccionario {
  return idioma === "es" ? ES : CA;
}

export function idiomaDe(datos: DatosAlbaran): Idioma {
  return datos.idioma === "es" ? "es" : "ca";
}

// ---------------------------------------------------------------------------
// Textos legales PROVISIONALES
// ---------------------------------------------------------------------------
// La fase 0 del plan tiene que entregar los textos de REC y ENT (semana 1) y el de OPE
// (semana 4), validados. Mientras no lleguen, `plantillas_documento` no tiene fila para
// estos tipos —ninguna migración siembra texto legal sin validar, y hace bien— y el
// documento se quedaría mudo justo en el bloque que le da sentido.
//
// Estos textos son de trabajo y se imprimen SIEMPRE dentro de una caja que dice que lo
// son. La alternativa —imprimir un texto de aspecto legal sin avisar— es la que no se
// puede tomar: quien firma no tiene forma de saber que lo que acepta es un borrador.

const LEGAL_PROVISIONAL: Record<string, Record<Idioma, Bloque[]>> = {
  REC: {
    ca: [
      {
        tipo: "p",
        text:
          "El generador lliura a la Fundació Espigoladors, amb NIF {{recibe.nif}}, els aliments que consten en aquest albarà, que queden fora del circuit de venda habitual. El lliurament es fa a títol de donació: no comporta cap contraprestació econòmica i aquest document no recull cap import.",
      },
      {
        tipo: "p",
        text:
          "Els quilos que consten aquí són els pesats en el moment de la recepció. Els quilos oficials de l'operació són els conciliats posteriorment; cap certificat s'emet abans de la conciliació.",
      },
      {
        tipo: "p",
        text:
          "El generador declara que els aliments són aptes per al consum humà en el moment del lliurament i que s'han conservat en les condicions adequades fins a la recollida.",
      },
    ],
    es: [
      {
        tipo: "p",
        text:
          "El generador entrega a la Fundació Espigoladors, con NIF {{recibe.nif}}, los alimentos que constan en este albarán, que quedan fuera del circuito de venta habitual. La entrega se hace a título de donación: no comporta ninguna contraprestación económica y este documento no recoge ningún importe.",
      },
      {
        tipo: "p",
        text:
          "Los kilos que constan aquí son los pesados en el momento de la recepción. Los kilos oficiales de la operación son los conciliados posteriormente; ningún certificado se emite antes de la conciliación.",
      },
      {
        tipo: "p",
        text:
          "El generador declara que los alimentos son aptos para el consumo humano en el momento de la entrega y que se han conservado en las condiciones adecuadas hasta la recogida.",
      },
    ],
  },
  ENT: {
    ca: [
      {
        tipo: "p",
        text:
          "La Fundació Espigoladors entrega gratuïtament a l'entitat receptora els aliments que consten en aquest albarà. L'entrega no comporta cap contraprestació econòmica i aquest document no recull cap import.",
      },
      {
        tipo: "p",
        text:
          "L'entitat receptora es compromet a destinar els aliments a la seva finalitat social i a conservar-los i manipular-los d'acord amb la normativa d'higiene alimentària que li és aplicable.",
      },
      {
        tipo: "p",
        text:
          "Els quilos confirmats per l'entitat són els que es fan servir per conciliar l'operació. Qualsevol incidència o rebuig ha de constar en aquest document amb el seu motiu.",
      },
    ],
    es: [
      {
        tipo: "p",
        text:
          "La Fundació Espigoladors entrega gratuitamente a la entidad receptora los alimentos que constan en este albarán. La entrega no comporta ninguna contraprestación económica y este documento no recoge ningún importe.",
      },
      {
        tipo: "p",
        text:
          "La entidad receptora se compromete a destinar los alimentos a su finalidad social y a conservarlos y manipularlos de acuerdo con la normativa de higiene alimentaria que le es aplicable.",
      },
      {
        tipo: "p",
        text:
          "Los kilos confirmados por la entidad son los que se usan para conciliar la operación. Cualquier incidencia o rechazo debe constar en este documento con su motivo.",
      },
    ],
  },
  OPE: {
    ca: [
      {
        tipo: "p",
        text:
          "Aquest albarà documenta el lliurament físic del producte entre les dues parts. Les condicions econòmiques de l'operació no formen part d'aquest document i es liquiden pels seus propis mitjans: aquí no hi consta cap import ni cap preu.",
      },
      {
        tipo: "p",
        text:
          "En les operacions de maquila, el generador conserva la propietat del producte durant tot el procés de transformació. L'obrador el custodia i el retorna transformat en els termes acordats.",
      },
      {
        tipo: "p",
        text:
          "Les dues parts confirmen aquest albarà: qui entrega, els quilos lliurats; qui rep, els quilos rebuts. La conciliació es fa sobre els quilos confirmats per totes dues.",
      },
    ],
    es: [
      {
        tipo: "p",
        text:
          "Este albarán documenta la entrega física del producto entre las dos partes. Las condiciones económicas de la operación no forman parte de este documento y se liquidan por sus propios medios: aquí no consta ningún importe ni ningún precio.",
      },
      {
        tipo: "p",
        text:
          "En las operaciones de maquila, el generador conserva la propiedad del producto durante todo el proceso de transformación. El obrador lo custodia y lo devuelve transformado en los términos acordados.",
      },
      {
        tipo: "p",
        text:
          "Las dos partes confirman este albarán: quien entrega, los kilos entregados; quien recibe, los kilos recibidos. La conciliación se hace sobre los kilos confirmados por ambas.",
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** Número con coma decimal y punto de millar, sin depender de `Intl` ni de la locale. */
export function num(valor: unknown, decimales = 1): string {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (valor === null || valor === undefined || valor === "" || !isFinite(n)) return "";
  const [entera, decimal] = n.toFixed(decimales).split(".");
  const conMillares = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `${conMillares},${decimal}` : conMillares;
}

/** Entero, sin decimales (cajas). Vacío si no hay valor: un 0 inventado miente. */
export function ent(valor: unknown): string {
  return num(valor, 0);
}

/** `2026-10-14T09:30:00` → `14/10/2026 09:30`. Lo que no sea fecha se devuelve tal cual. */
export function fecha(valor: unknown, conHora = true): string {
  if (typeof valor !== "string" || !valor) return "";
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return valor;
  const dia = `${m[3]}/${m[2]}/${m[1]}`;
  return conHora && m[4] ? `${dia} ${m[4]}:${m[5]}` : dia;
}

/**
 * El código de verificación que se imprime: los 16 primeros caracteres del sha256 del
 * snapshot, en grupos de cuatro. Entero no lo lee nadie y en el papel ocupa dos líneas;
 * 16 hexadecimales (64 bits) es de sobra para cotejar a mano contra la base, que es
 * para lo único que sirve.
 */
export function codigoVerificacion(sha: string | null | undefined): string {
  if (!sha) return "—";
  const limpio = sha.replace(/[^0-9a-fA-F]/g, "").slice(0, 16).toUpperCase();
  return limpio.match(/.{1,4}/g)?.join("-") ?? limpio;
}

/** Pares etiqueta/valor descartando los vacíos: una ficha llena de guiones no se lee. */
export function paresLlenos(pares: [string, unknown][]): [string, string][] {
  return pares
    .map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)] as [string, string])
    .filter(([, v]) => v.trim() !== "");
}

/** Las incidencias llegan como jsonb libre; se imprimen legibles pase lo que pase. */
export function textoIncidencias(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) {
    return valor
      .map((i) =>
        i && typeof i === "object"
          ? String((i as Record<string, unknown>).texto ?? (i as Record<string, unknown>).descripcio ?? JSON.stringify(i))
          : String(i)
      )
      .filter(Boolean)
      .join(" · ");
  }
  if (typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    return String(o.texto ?? o.descripcio ?? JSON.stringify(o));
  }
  return String(valor);
}

// ---------------------------------------------------------------------------
// El esqueleto
// ---------------------------------------------------------------------------

export interface Contexto {
  doc: PDFDocument;
  m: Maquetador;
  t: Diccionario;
  idioma: Idioma;
  datos: DatosAlbaran;
  op: OpcionesAlbaran;
}

/** Título y subtítulo por tipo, con la marca de rectificativo si toca. */
function rotulo(t: Diccionario, tipo: string, rectificativo: boolean): [string, string] {
  const base = tipo === "REC"
    ? [t.rec, t.rec_sub]
    : tipo === "ENT"
    ? [t.ent, t.ent_sub]
    : [t.ope, t.ope_sub];
  return [rectificativo ? `${base[0]} · ${t.rectificatiu}` : base[0], base[1]];
}

/** Abre el documento y pinta identificación, partes y recogida. */
export async function abrirAlbaran(
  activos: BytesActivos,
  op: OpcionesAlbaran,
): Promise<Contexto> {
  const datos = op.datos;
  const idioma = idiomaDe(datos);
  const t = diccionario(idioma);
  const tipo = (datos.tipus ?? "REC").replace(/^R-/, "");
  const numero = datos.numero ?? "";
  const emitido = fecha(datos.emes_at, false);
  const [titulo, subtitulo] = rotulo(t, tipo, op.rectificativo === true);

  const doc = await PDFDocument.create();
  doc.setTitle(`${numero} · ${titulo}`);
  doc.setProducer("Redestina");
  doc.setCreator("Redestina");
  const fuentes = await embeberFuentes(doc, activos);
  const logo = await embeberLogo(doc, activos);

  const m = new Maquetador(doc, {
    fuentes,
    logo,
    cabecera: numero,
    subcabecera: `${titulo} · ${emitido}`,
    pie: `${t.peu} · ${numero}`,
    marcaAgua: op.modo === "prueba" ? { texto: idioma === "es" ? "Prueba" : "Prova" } : null,
    paginacion: t.pagina,
  });

  m.titulo(titulo, 1);
  m.parrafo(subtitulo, { color: COLORES.verdeGris, tamano: 10, despues: 10 });

  // ------------------------------------------------------------- identificación
  const refs = datos.referencies ?? {};
  const externo = (refs.externs ?? []).find((x) => x && x.numero);
  m.titulo(t.identificacio, 2);
  m.campos(
    paresLlenos([
      [t.numero, numero],
      [t.data_emissio, emitido],
      [t.exercici, datos.ejercici],
      [
        t.tipus_entrada,
        tipo === "REC"
          ? (datos.tipus_entrada === "espigolament" ? t.espigolament : t.donacio)
          : null,
      ],
      // ⚠️ D3: en el ENT **no se imprime la referencia del registro**. Parece inocua y no
      //    lo es: `id_excedente` tiene el formato `E-AAMMDD-XXX-YYY-N`, donde `XXX` son
      //    las tres primeras letras del nombre del productor (`siglas()` en
      //    `_shared/oferta.ts`). Imprimirla en el documento que recibe la entidad
      //    entregaría, con la fecha, media identidad del generador — justo lo que D3
      //    quita del resto del papel. La trazabilidad de la entidad es el CÓDIGO DE
      //    LOTE, que es opaco y ya sale en el bloque de origen.
      [t.referencia_registre, tipo === "ENT" ? null : refs.registre],
      [t.referencia_espigolada, refs.espigolada],
      [t.rectifica_a, refs.rectifica],
      [
        t.document_extern,
        externo ? [externo.numero, fecha(externo.data, false)].filter(Boolean).join(" · ") : null,
      ],
      [t.codi_verificacio, codigoVerificacion(op.sha256Datos)],
    ]),
    { anchoEtiqueta: 150, despues: 8 },
  );

  // ------------------------------------------------------------------- partes
  const partes = datos.partes ?? {};
  m.filete();
  m.espacio(6);
  pintarParte(m, t, t.entrega, partes.entrega ?? null);
  m.espacio(4);
  pintarParte(m, t, t.rep, partes.recibe ?? null);

  return { doc, m, t, idioma, datos, op };
}

/** Una parte (quién entrega / quién recibe) como bloque de campos. */
export function pintarParte(
  m: Maquetador,
  t: Diccionario,
  rotulo: string,
  parte: ParteAlbaran | null,
): void {
  m.titulo(rotulo, 3);
  if (!parte) {
    m.parrafo("—", { color: COLORES.verdeGris, tamano: 10, despues: 4 });
    return;
  }
  m.campos(
    paresLlenos([
      [t.rao_social, parte.razon_social],
      // El nombre comercial solo se imprime si aporta algo distinto de la razón social.
      [
        t.nom_comercial,
        parte.nombre_comercial && parte.nombre_comercial !== parte.razon_social
          ? parte.nombre_comercial
          : null,
      ],
      [t.nif, parte.nif],
      [t.domicili, parte.domicilio],
      [t.inscripcio, parte.inscripcion],
      [t.persona_contacte, parte.contacto],
      [t.lloc_recollida, parte.lugar_recogida],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );
}

/**
 * Bloque de la recogida. Lo comparten los tres tipos, con una diferencia que no es
 * cosmética: en el ENT se **oculta el origen** (D3).
 *
 * ⚠️ Ocultar el origen son DOS campos, no uno. El obvio es `lugar` («Finca de Prova»),
 *    que nombra la explotación. El que se olvida es `responsable_origen`: es la persona
 *    que estaba en la finca, o sea el generador o alguien suyo, con nombre y apellidos.
 *    Dar ese nombre a la entidad receptora deshace D3 igual de bien que dar el de la
 *    empresa, y el anexo A.2 no lo pide entre los campos del ENT — solo está en A.1, el
 *    REC, donde el generador sí es parte del documento.
 */
export function pintarRecogida(
  m: Maquetador,
  t: Diccionario,
  recogida: RecogidaAlbaran | null | undefined,
  op: { ocultarOrigen?: boolean; municipio?: string | null } = {},
): void {
  const r = recogida ?? {};
  const pares = paresLlenos([
    [t.data_hora, fecha(r.fecha_hora)],
    [t.responsable_origen, op.ocultarOrigen ? null : r.responsable_origen],
    [t.qui_recull, r.quien_recoge],
    [t.transportista, r.transportista],
    [t.matricula, r.matricula],
    [t.temperatura, r.temperatura],
    // En el ENT el lugar exacto de la finca no puede salir (D3): solo el municipio.
    [t.lloc, op.ocultarOrigen ? (op.municipio ?? null) : r.lugar],
  ]);
  if (pares.length === 0) return;
  m.espacio(4);
  m.filete();
  m.espacio(6);
  m.titulo(t.recollida, 2);
  m.campos(pares, { anchoEtiqueta: 150, despues: 6 });
}

/**
 * La tabla de líneas. Las columnas las decide cada renderizador: es la única diferencia
 * real entre los tres documentos y por eso no se intenta generalizar aquí.
 */
export function pintarLineas(
  m: Maquetador,
  t: Diccionario,
  lineas: LineaAlbaran[],
  columnas: Columna[],
  filas: (string | number | null | undefined)[][],
  totales?: { etiqueta: string; valor: string },
): void {
  m.espacio(4);
  m.filete();
  m.espacio(6);
  m.titulo(t.linies, 2);
  if (lineas.length === 0) {
    m.parrafo(t.sense_linies, { color: COLORES.verdeGris, tamano: 10, despues: 8 });
    return;
  }
  m.tabla({ columnas, filas, cebra: true, padding: 5, despues: 8 });
  if (totales) {
    m.parrafo(`${totales.etiqueta}: ${totales.valor}`, {
      fuente: m.fuentes.cuerpoFuerte,
      alinear: "derecha",
      despues: 6,
    });
  }
}

/**
 * Cierre, texto legal y espacio de conformidad, y guarda. Es lo último que se llama.
 *
 * El bloque de conformidad ya NO se imprime siempre en blanco (deuda §12.60): si el
 * albarán se ha confirmado por enlace, `op.confirmaciones` trae quién, cuándo y por qué
 * vía, y el bloque se rellena. Dos reglas que conviene tener a la vista:
 *
 *   · **Con un solo espacio de conformidad** (REC y ENT: confirma quien recibe) la
 *     confirmación se imprime DENTRO de él. No hay ambigüedad posible: un espacio, una
 *     parte, una confirmación.
 *   · **Con varios** (el OPE, que confirman las dos partes) se casa cada confirmación con
 *     su espacio por `enlaces_token.rol_parte`. La que no traiga rol —los enlaces
 *     anteriores a `20270304100200` no lo tienen— NO se atribuye a nadie: se lista
 *     aparte, bajo «Confirmacions registrades». Se dice lo que consta, y no se dice de
 *     quién no consta.
 */
export async function cerrarAlbaran(ctx: Contexto): Promise<Renderizado> {
  const { m, t, datos, op } = ctx;
  const tipo = (datos.tipus ?? "REC").replace(/^R-/, "");

  // ------------------------------------------------------------------- cierre
  const rebuig = datos.rebuig ?? {};
  const etiquetaRebuig = rebuig.tipus === "total"
    ? t.rebuig_total
    : rebuig.tipus === "parcial"
    ? t.rebuig_parcial
    : null;
  const paresCierre = paresLlenos([
    [t.retorn_envasos, datos.retorn_envasos],
    [t.observacions, datos.observacions],
    [t.incidencies, textoIncidencias(datos.incidencies)],
    [t.rebuig, etiquetaRebuig],
    [t.motiu, etiquetaRebuig ? rebuig.motiu : null],
  ]);
  if (paresCierre.length > 0) {
    m.espacio(4);
    m.filete();
    m.espacio(6);
    m.titulo(t.tancament, 2);
    m.campos(paresCierre, { anchoEtiqueta: 150, despues: 6 });
  }

  // -------------------------------------------------------------- texto legal
  const valores = {
    numero: datos.numero ?? "",
    data: fecha(datos.emes_at, false),
    exercici: datos.ejercici ?? "",
    entrega: datos.partes?.entrega ?? {},
    recibe: datos.partes?.recibe ?? {},
    origen: datos.partes?.origen ?? {},
    codi: codigoVerificacion(op.sha256Datos),
  };

  const cuerpoPlantilla = op.plantilla?.cuerpo;
  m.espacio(4);
  m.filete();
  m.espacio(6);
  m.titulo(op.plantilla?.titulo || t.legal, 2);

  if (esCuerpo(cuerpoPlantilla)) {
    const { bloques, faltan } = interpolarCuerpo(cuerpoPlantilla, valores);
    pintarCuerpo(m, bloques);
    if (faltan.length) console.warn("albarà: marcadores sin resolver:", faltan.join(", "));
  } else {
    // Sin plantilla validada: texto de trabajo, y se dice que lo es.
    const provisional = LEGAL_PROVISIONAL[tipo]?.[ctx.idioma] ?? [];
    const { bloques } = interpolarCuerpo(provisional, valores);
    pintarCuerpo(m, bloques);
    m.espacio(4);
    m.caja(t.provisional_avis, { titulo: t.provisional_titol });
  }

  // ------------------------------------------------------------- conformidad
  m.espacio(10);
  m.titulo(t.conformitat, 2);
  m.parrafo(t.conformitat_text, { tamano: 9.5, despues: 12 });
  const espacios: EspacioConformidad[] = op.conformidades && op.conformidades.length > 0
    ? op.conformidades
    : [{ rotulo: "" }];
  const confirmaciones = [...(op.confirmaciones ?? [])].filter(Boolean);

  // A quién le toca cada confirmación:
  //   · Un solo espacio (REC, ENT): la última confirmación es la suya, sin más. Ahí no
  //     hay ambigüedad posible, y además los enlaces anteriores a `rol_parte` tampoco la
  //     tenían nunca.
  //   · Varios espacios (OPE): solo se casa por `rol`. Una confirmación sin rol NO se
  //     atribuye —se lista aparte—, porque ponerla bajo «Entrega» sin saberlo sería
  //     inventarse quién firmó qué en un documento legal.
  const sueltas: ConfirmacionAlbaran[] = [];
  const asignadas = new Map<number, ConfirmacionAlbaran>();
  if (espacios.length === 1) {
    if (confirmaciones.length > 0) asignadas.set(0, confirmaciones[confirmaciones.length - 1]);
    sueltas.push(...confirmaciones.slice(0, Math.max(0, confirmaciones.length - 1)));
  } else {
    for (const c of confirmaciones) {
      const i = c.rol ? espacios.findIndex((e) => e.rol === c.rol) : -1;
      if (i >= 0 && !asignadas.has(i)) asignadas.set(i, c);
      else sueltas.push(c);
    }
  }

  espacios.forEach((e, i) => pintarConformidad(m, t, e.rotulo, asignadas.get(i)));

  if (sueltas.length > 0) {
    m.espacio(6);
    m.titulo(t.confirmacions, 3);
    for (const c of sueltas) {
      m.campos(lineasConfirmacion(t, c), { anchoEtiqueta: 150, despues: 8 });
    }
  }

  m.finalizar();
  const bytes = await ctx.doc.save();
  return { bytes, paginas: m.numPaginas };
}

/**
 * Las cuatro líneas de una confirmación ya registrada. La cuarta ocupa el sitio de la
 * firma manuscrita y dice **por qué vía** se confirmó y con qué referencia: una firma
 * electrónica simple no deja trazo que dibujar, lo que la acredita es la evidencia.
 */
function lineasConfirmacion(t: Diccionario, c: ConfirmacionAlbaran): [string, string][] {
  const via = c.canal === "asistido" ? t.confirmat_assistit : t.confirmat_enllac;
  const referencia = c.referencia ? ` · ${t.referencia} ${c.referencia}` : "";
  return [
    [t.nom_cognoms, (c.nombre ?? "").trim()],
    [t.carrec, (c.cargo ?? "").trim()],
    [t.data_signatura, fecha(c.at, true)],
    [t.signatura, `${via}${referencia}`],
  ];
}

/**
 * Un espacio de conformidad: en blanco si nadie ha confirmado todavía, o relleno con la
 * confirmación registrada.
 */
export function pintarConformidad(
  m: Maquetador,
  t: Diccionario,
  rotulo = "",
  confirmacion?: ConfirmacionAlbaran,
): void {
  // El rótulo y sus cuatro campos son un bloque: sin esto, «Rep · Obrador de Prova SL»
  // se quedaba solo al pie de una página y su espacio de firma empezaba en la siguiente.
  m.asegurar(rotulo ? 90 : 74);
  if (rotulo) {
    m.parrafo(rotulo, { fuente: m.fuentes.cuerpoFuerte, tamano: 10, despues: 6 });
  }
  m.campos(
    confirmacion ? lineasConfirmacion(t, confirmacion) : [
      [t.nom_cognoms, ""],
      [t.carrec, ""],
      [t.data_signatura, ""],
      [t.signatura, ""],
    ],
    { anchoEtiqueta: 150, despues: 14 },
  );
}

/** Suma de una columna de kilos de las líneas, para el total al pie de la tabla. */
export function sumaKg(lineas: LineaAlbaran[], campo: keyof LineaAlbaran): number {
  return lineas.reduce((s, l) => {
    const v = l[campo];
    return s + (typeof v === "number" && isFinite(v) ? v : 0);
  }, 0);
}

/** Las líneas del snapshot, saneadas a array y ordenadas. */
export function lineasDe(datos: DatosAlbaran): LineaAlbaran[] {
  const l = Array.isArray(datos.linies) ? datos.linies : [];
  return [...l].sort((a, b) => (a?.ordre ?? 0) - (b?.ordre ?? 0));
}
