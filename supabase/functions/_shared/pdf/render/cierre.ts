// Esqueleto común del cierre anual: el resumen (RES) y el certificado (CD) — anexo B.
//
// Los dos documentos hablan del MISMO acumulado de un donante en un ejercicio y por eso
// comparten el snapshot (`cierre_datos_resumen` / `cierre_datos_certificado`), las partes
// —quién emite y quién dona— y el vocabulario. Lo que cambia es a qué se dedica cada uno:
// el resumen pide la factura, el certificado la cita.
//
// ⚠️ ESTOS SÍ LLEVAN IMPORTES, y son los únicos junto con el CT. Es la regla contraria a
//    la de los albaranes (`comu.ts`): allí un euro impreso convierte el papel en una
//    factura; aquí el euro ES el documento. La separación no es de estilo: `albaran_datos()`
//    no devuelve ninguna cifra en euros y `cierre_datos_*` sí, así que cada renderizador
//    solo puede imprimir lo que su snapshot le da.
//
// Mismo contrato que el resto de renderizadores: NO leen ficheros ni hablan con la base.
// Reciben los activos ya leídos (`generar-documento`), el snapshot congelado y —solo el
// certificado— la firma, el sello y el DNI de la apoderada, que la función lee con
// `service_role` porque `documentos.datos` NO los lleva (el donante lee ese jsonb).

import { PDFDocument, type PDFImage } from "npm:pdf-lib@1";
import { type BytesActivos, embeberFuentes, embeberLogo } from "../fuentes.ts";
import { COLORES, Maquetador } from "../maquetador.ts";
import { type Bloque, esCuerpo, interpolarCuerpo, pintarCuerpo } from "../plantilla.ts";
import { type PlantillaLegal } from "./comu.ts";

// ---------------------------------------------------------------------------
// El snapshot
// ---------------------------------------------------------------------------
// Todo opcional (es un jsonb) y con las claves TAL COMO las escribe SQL, acento incluido:
// `raó_social` viene así de `cierre_datos_resumen()` y de `datos_fiscales`. Renombrarla
// aquí sería inventarse un segundo vocabulario que un día dejaría de coincidir.

export interface OrganizacionCierre {
  "raó_social"?: string | null;
  nif?: string | null;
  cif?: string | null;
  domicili?: string | null;
  codi_postal?: string | null;
  poblacio?: string | null;
  provincia?: string | null;
  inscripcio?: string | null;
  email?: string | null;
  dades_provisionals?: boolean | null;
}

export interface LineaDetalle {
  producte?: string | null;
  mes?: number | string | null;
  kg?: number | string | null;
  cost_kg?: number | string | null;
  valor?: number | string | null;
}

export interface Bloqueo {
  codigo?: string | null;
  detall?: string | null;
  bloqueja?: boolean | null;
}

export interface DatosCierre {
  tipus?: string | null;
  mode?: string | null;
  exercici?: number | null;
  numero?: string | null;
  fundacio?: OrganizacionCierre | null;
  donant?: OrganizacionCierre | null;
  detall?: LineaDetalle[] | null;
  bloquejos?: Bloqueo[] | null;

  // --- resumen
  kg_total?: number | null;
  valor_total?: number | null;
  destinacions?: { entitat?: string | null }[] | null;
  factura?: {
    a_nom_de?: string | null;
    import?: number | null;
    data_operacio?: string | null;
    concepte?: string | null;
    // en el certificado, la factura que se cita
    numero?: string | null;
    data?: string | null;
  } | null;
  enllac_factura?: string | null;

  // --- certificado
  data_generacio?: string | null;
  lloc?: string | null;
  apoderada?: { nom?: string | null; carrec?: string | null } | null;
  periode?: { des_de?: string | null; fins_a?: string | null } | null;
  kg?: number | null;
  import?: number | null;
  excepcio_sense_factura?: boolean | null;
  excepcio_motiu?: string | null;
  rectificacions?: number | null;
  motiu_rectificacio?: string | null;
}

export interface OpcionesCierre {
  /** Snapshot congelado (`documentos.datos`). */
  datos: DatosCierre;
  /** `documentos.sha256_datos`: el código de verificación impreso. */
  sha256Datos?: string | null;
  /** Plantilla legal vigente. Sin ella se imprime el texto provisional, marcado. */
  plantilla?: PlantillaLegal | null;
  /** `prueba` estampa la filigrana «PROVA, SENSE VALIDESA FISCAL». */
  modo?: "real" | "prueba";
  /** `provisional` | `definitiu` (RES) — el certificado siempre es definitivo. */
  subtipo?: string | null;
  /** El enlace completo para subir la factura (lo compone `generar-documento`). */
  enlaceFactura?: string | null;
  /** Días que dura ese enlace, para decirlo en el papel. */
  enlaceDias?: number | null;
  /** Solo CD: el DNI de la apoderada, que NO viaja en el snapshot. */
  apoderadaDni?: string | null;
  /** Solo CD: PNG de la firma y del sello, del bucket privado `activos`. */
  firmaPng?: Uint8Array | null;
  selloPng?: Uint8Array | null;
  /** Marca de rectificativo (rectificar_certificado). */
  rectificativo?: boolean;
}

export interface Renderizado {
  bytes: Uint8Array;
  paginas: number;
}

export type IdiomaCierre = "ca" | "es";

export function idiomaDe(idioma: string | null | undefined): IdiomaCierre {
  return idioma === "es" ? "es" : "ca";
}

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------
// Un solo diccionario para los dos documentos, como en `comu.ts` para los tres albaranes:
// comparten la mitad de las etiquetas y separarlos garantizaría que un día «Donant» se
// escriba de dos maneras distintas en dos papeles del mismo sobre.

export interface DiccionarioCierre {
  res: string;
  res_sub: string;
  res_provisional: string;
  cd: string;
  cd_sub: string;
  rectificatiu: string;
  motiu_rectificacio: string;
  numero: string;
  exercici: string;
  periode: string;
  data_emissio: string;
  codi_verificacio: string;
  emet: string;
  donant: string;
  rao_social: string;
  nif: string;
  cif: string;
  domicili: string;
  provincia: string;
  inscripcio: string;
  correu: string;
  qui_certifica: string;
  carrec: string;
  dni: string;
  total_exercici: string;
  total_kg: string;
  total_valor: string;
  detall: string;
  detall_cd: string;
  sense_detall: string;
  destinacions: string;
  destinacions_text: string;
  sense_destinacions: string;
  factura_titol: string;
  factura_a_nom: string;
  factura_import: string;
  factura_data: string;
  factura_data_ajuda: string;
  factura_concepte: string;
  factura_avis_titol: string;
  factura_avis: string;
  enllac_titol: string;
  enllac_text: (dies: number) => string;
  enllac_sense: string;
  bloquejos_titol: string;
  bloquejos_text: string;
  certifica: string;
  import_titol: string;
  import_xifres: string;
  import_lletres: string;
  quilos: string;
  factura_citada: string;
  factura_citada_sense: string;
  excepcio_titol: string;
  excepcio_text: string;
  signatura_titol: string;
  legal: string;
  provisional_titol: string;
  provisional_avis: string;
  peu: string;
  pagina: (n: number, total: number) => string;
  mesos: string[];
  col: Record<string, string>;
}

const CA: DiccionarioCierre = {
  res: "Resum anual de donacions",
  res_sub: "Aliments fora del circuit de venda habitual lliurats a la Fundació Espigoladors",
  res_provisional: "Resum provisional",
  cd: "Certificat de donació",
  cd_sub: "Article 16 de la Llei 49/2002, de règim fiscal de les entitats sense fins lucratius",
  rectificatiu: "Rectificatiu",
  motiu_rectificacio: "Motiu de la rectificació",
  numero: "Número",
  exercici: "Exercici",
  periode: "Període",
  data_emissio: "Data",
  codi_verificacio: "Codi de verificació",
  emet: "Emet",
  donant: "Donant",
  rao_social: "Raó social",
  nif: "NIF",
  cif: "CIF",
  domicili: "Domicili",
  provincia: "Província",
  inscripcio: "Inscripció",
  correu: "Correu",
  qui_certifica: "Qui certifica",
  carrec: "Càrrec",
  dni: "DNI",
  total_exercici: "Total de l'exercici",
  total_kg: "Quilos nets conciliats",
  total_valor: "Valor",
  detall: "Detall per producte i mes",
  detall_cd: "Detall per producte",
  sense_detall: "No hi ha cap línia conciliada en aquest exercici.",
  destinacions: "On ha anat el producte",
  destinacions_text:
    "Aquestes són les entitats socials que han rebut el producte que vas lliurar. Els quilos de cada entitat no hi consten: el document que ho detalla és cada albarà d'entrega.",
  sense_destinacions: "Encara no hi ha cap entrega conciliada amb entitat.",
  factura_titol: "Com ens has de facturar",
  factura_a_nom: "A nom de",
  factura_import: "Import",
  factura_data: "Data de l'operació",
  factura_data_ajuda: "31 de desembre de l'exercici",
  factura_concepte: "Concepte",
  factura_avis_titol: "Per què cal la factura",
  factura_avis:
    "La donació d'aliments es documenta amb una factura teva a nom de la Fundació Espigoladors per l'import valorat, sense repercussió d'IVA i sense cap pagament: no s'ha de cobrar ni es cobrarà. Amb la factura registrada i coincident amb aquest import, la Fundació emet el certificat de donació que et dona dret a la deducció de l'article 16 de la Llei 49/2002.",
  enllac_titol: "Puja la factura",
  enllac_text: (dies) =>
    `Obre aquest enllaç des del mòbil o de l'ordinador i adjunta la factura en PDF, JPG o PNG. L'enllaç és personal i caduca en ${dies} dies.`,
  enllac_sense:
    "L'enllaç per pujar la factura va al correu amb què t'hem enviat aquest resum. També la pots pujar des del teu panell a Redestina.",
  bloquejos_titol: "Falta alguna cosa abans del certificat",
  bloquejos_text: "Mentre no es resolgui, el certificat de donació no es pot emetre.",
  certifica: "Certifica",
  import_titol: "Valor de la donació",
  import_xifres: "En xifres",
  import_lletres: "En lletres",
  quilos: "Quilos donats",
  factura_citada: "Factura del donant",
  factura_citada_sense: "Sense factura del donant",
  excepcio_titol: "Emès sense factura coincident",
  excepcio_text: "Motiu:",
  signatura_titol: "Signatura i segell",
  legal: "Condicions",
  provisional_titol: "Text provisional, pendent de validació",
  provisional_avis:
    "Aquest text encara no ha estat validat per la Fundació Espigoladors ni per l'assessoria. S'imprimeix perquè el document sigui llegible mentre no hi hagi la plantilla definitiva; no substitueix el text legal.",
  peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n, total) => `pàg. ${n} de ${total}`,
  mesos: [
    "gener", "febrer", "març", "abril", "maig", "juny",
    "juliol", "agost", "setembre", "octubre", "novembre", "desembre",
  ],
  col: {
    producte: "Producte",
    mes: "Mes",
    kg: "Quilos",
    cost_kg: "Cost €/kg",
    valor: "Valor",
    entitat: "Entitat receptora",
  },
};

const ES: DiccionarioCierre = {
  res: "Resumen anual de donaciones",
  res_sub: "Alimentos fuera del circuito de venta habitual entregados a la Fundació Espigoladors",
  res_provisional: "Resumen provisional",
  cd: "Certificado de donación",
  cd_sub: "Artículo 16 de la Ley 49/2002, de régimen fiscal de las entidades sin fines lucrativos",
  rectificatiu: "Rectificativo",
  motiu_rectificacio: "Motivo de la rectificación",
  numero: "Número",
  exercici: "Ejercicio",
  periode: "Periodo",
  data_emissio: "Fecha",
  codi_verificacio: "Código de verificación",
  emet: "Emite",
  donant: "Donante",
  rao_social: "Razón social",
  nif: "NIF",
  cif: "CIF",
  domicili: "Domicilio",
  provincia: "Provincia",
  inscripcio: "Inscripción",
  correu: "Correo",
  qui_certifica: "Quien certifica",
  carrec: "Cargo",
  dni: "DNI",
  total_exercici: "Total del ejercicio",
  total_kg: "Kilos netos conciliados",
  total_valor: "Valor",
  detall: "Detalle por producto y mes",
  detall_cd: "Detalle por producto",
  sense_detall: "No hay ninguna línea conciliada en este ejercicio.",
  destinacions: "Adónde ha ido el producto",
  destinacions_text:
    "Estas son las entidades sociales que han recibido el producto que entregaste. Los kilos de cada entidad no constan aquí: el documento que lo detalla es cada albarán de entrega.",
  sense_destinacions: "Todavía no hay ninguna entrega conciliada con entidad.",
  factura_titol: "Cómo tienes que facturarnos",
  factura_a_nom: "A nombre de",
  factura_import: "Importe",
  factura_data: "Fecha de la operación",
  factura_data_ajuda: "31 de diciembre del ejercicio",
  factura_concepte: "Concepto",
  factura_avis_titol: "Por qué hace falta la factura",
  factura_avis:
    "La donación de alimentos se documenta con una factura tuya a nombre de la Fundació Espigoladors por el importe valorado, sin repercusión de IVA y sin ningún pago: no se ha de cobrar ni se cobrará. Con la factura registrada y coincidente con este importe, la Fundación emite el certificado de donación que da derecho a la deducción del artículo 16 de la Ley 49/2002.",
  enllac_titol: "Sube la factura",
  enllac_text: (dies) =>
    `Abre este enlace desde el móvil o el ordenador y adjunta la factura en PDF, JPG o PNG. El enlace es personal y caduca en ${dies} días.`,
  enllac_sense:
    "El enlace para subir la factura va en el correo con el que te hemos enviado este resumen. También la puedes subir desde tu panel en Redestina.",
  bloquejos_titol: "Falta algo antes del certificado",
  bloquejos_text: "Mientras no se resuelva, el certificado de donación no se puede emitir.",
  certifica: "Certifica",
  import_titol: "Valor de la donación",
  import_xifres: "En cifras",
  import_lletres: "En letras",
  quilos: "Kilos donados",
  factura_citada: "Factura del donante",
  factura_citada_sense: "Sin factura del donante",
  excepcio_titol: "Emitido sin factura coincidente",
  excepcio_text: "Motivo:",
  signatura_titol: "Firma y sello",
  legal: "Condiciones",
  provisional_titol: "Texto provisional, pendiente de validación",
  provisional_avis:
    "Este texto todavía no ha sido validado por la Fundació Espigoladors ni por la asesoría. Se imprime para que el documento sea legible mientras no exista la plantilla definitiva; no sustituye al texto legal.",
  peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n, total) => `pág. ${n} de ${total}`,
  mesos: [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ],
  col: {
    producte: "Producto",
    mes: "Mes",
    kg: "Kilos",
    cost_kg: "Coste €/kg",
    valor: "Valor",
    entitat: "Entidad receptora",
  },
};

export function diccionarioCierre(idioma: string | null | undefined): DiccionarioCierre {
  return idioma === "es" ? ES : CA;
}

/**
 * La filigrana del modo prueba. **Es lo que impide que un ensayo se confunda con un
 * certificado real**, así que dice las dos cosas: que es una prueba y que no tiene valor
 * fiscal. No basta con la serie `P-CD`: un número no se lee de un vistazo y una filigrana
 * cruzando la página, sí.
 */
export const MARCA_PRUEBA: Record<IdiomaCierre, string> = {
  ca: "Prova · sense validesa fiscal",
  es: "Prueba · sin validez fiscal",
};

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** `2026-09-10` → `10 de setembre de 2026` (con `d'` ante vocal en catalán). */
export function fechaLarga(
  valor: unknown,
  t: DiccionarioCierre,
  idioma: IdiomaCierre,
): string {
  if (typeof valor !== "string" || !valor) return "";
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return valor;
  const dia = Number(m[3]);
  const mes = t.mesos[Number(m[2]) - 1] ?? "";
  const preposicion = idioma === "ca" && /^[aeiouàèéíòóú]/i.test(mes) ? "d'" : "de ";
  return `${dia} ${preposicion}${mes} de ${m[1]}`;
}

/**
 * La misma fecha con su artículo delante, para meterla en una frase: `l'1 de gener de
 * 2026`, `el 31 de desembre de 2026`.
 *
 * ⚠️ En catalán el artículo se apostrofa ante los días que se leen empezando por vocal:
 *    l'1 («l'u») y l'11 («l'onze»). El 8 y el 18 NO (`vuit`, `divuit`). Sin esto, el
 *    certificado dice «entre el 1 de gener», que es justo la falta que se ve primero en
 *    un documento que alguien se lleva a la gestoría. En castellano no hay elisión.
 */
export function fechaLargaConArticulo(
  valor: unknown,
  t: DiccionarioCierre,
  idioma: IdiomaCierre,
): string {
  const larga = fechaLarga(valor, t, idioma);
  if (!larga) return "";
  if (idioma === "es") return `el ${larga}`;
  const dia = Number(larga.split(" ")[0]);
  return dia === 1 || dia === 11 ? `l'${larga}` : `el ${larga}`;
}

/** El nombre del mes por su número (1–12). Vacío si no lo es. */
export function nombreMes(valor: unknown, t: DiccionarioCierre): string {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!isFinite(n) || n < 1 || n > 12) return "";
  return t.mesos[n - 1];
}

/** «Carrer de Prova, 1 · 08850 Gavà». Los huecos no dejan rastro. */
export function domicilioCompleto(o: OrganizacionCierre | null | undefined): string {
  if (!o) return "";
  const localidad = [o.codi_postal, o.poblacio].filter((x) => x && String(x).trim()).join(" ");
  return [o.domicili, localidad].filter((x) => x && String(x).trim()).join(" · ");
}

// ---------------------------------------------------------------------------
// El documento
// ---------------------------------------------------------------------------

export interface ContextoCierre {
  doc: PDFDocument;
  m: Maquetador;
  t: DiccionarioCierre;
  idioma: IdiomaCierre;
  datos: DatosCierre;
  op: OpcionesCierre;
  logo: PDFImage | null;
}

/** Abre el PDF, embebe fuentes y logo y pinta el título. */
export async function abrirCierre(
  activos: BytesActivos,
  op: OpcionesCierre,
  rotulo: { titulo: string; subtitulo: string; idioma: IdiomaCierre },
): Promise<ContextoCierre> {
  const datos = op.datos;
  const idioma = rotulo.idioma;
  const t = diccionarioCierre(idioma);
  const numero = datos.numero ?? "";

  const doc = await PDFDocument.create();
  doc.setTitle(`${numero} · ${rotulo.titulo}`);
  doc.setProducer("Redestina");
  doc.setCreator("Redestina");
  const fuentes = await embeberFuentes(doc, activos);
  const logo = await embeberLogo(doc, activos);

  const m = new Maquetador(doc, {
    fuentes,
    logo,
    cabecera: numero,
    subcabecera: `${rotulo.titulo} · ${t.exercici} ${datos.exercici ?? ""}`.trim(),
    pie: `${t.peu} · ${numero}`,
    marcaAgua: op.modo === "prueba" ? { texto: MARCA_PRUEBA[idioma] } : null,
    paginacion: t.pagina,
  });

  m.titulo(rotulo.titulo, 1);
  m.parrafo(rotulo.subtitulo, { color: COLORES.verdeGris, tamano: 10, despues: 10 });

  return { doc, m, t, idioma, datos, op, logo };
}

/** El código de verificación impreso: 16 hex del sha256 del snapshot, en grupos de 4. */
export function codigoVerificacion(sha: string | null | undefined): string {
  if (!sha) return "—";
  const limpio = sha.replace(/[^0-9a-fA-F]/g, "").slice(0, 16).toUpperCase();
  return limpio.match(/.{1,4}/g)?.join("-") ?? limpio;
}

/** Pares etiqueta/valor sin los vacíos (misma regla que en los albaranes). */
export function paresLlenos(pares: [string, unknown][]): [string, string][] {
  return pares
    .map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)] as [string, string])
    .filter(([, v]) => v.trim() !== "");
}

/** Bloque de una organización (la Fundación o el donante). */
export function pintarOrganizacion(
  ctx: ContextoCierre,
  rotuloTexto: string,
  org: OrganizacionCierre | null | undefined,
  op: { esFundacion?: boolean } = {},
): void {
  const { m, t } = ctx;
  m.titulo(rotuloTexto, 3);
  if (!org) {
    m.parrafo("—", { color: COLORES.verdeGris, tamano: 10, despues: 4 });
    return;
  }
  m.campos(
    paresLlenos([
      [t.rao_social, org["raó_social"]],
      [op.esFundacion ? t.cif : t.nif, op.esFundacion ? (org.cif ?? org.nif) : (org.nif ?? org.cif)],
      [t.domicili, domicilioCompleto(org)],
      [t.provincia, op.esFundacion ? null : org.provincia],
      [t.inscripcio, org.inscripcio],
    ]),
    { anchoEtiqueta: 150, tamano: 9.5, despues: 4 },
  );
}

/**
 * El texto legal: la plantilla congelada si la hay, y si no el provisional del propio
 * renderizador dentro de una caja que dice que lo es. Misma decisión que en `comu.ts`:
 * imprimir un texto de aspecto legal sin avisar de que es un borrador es lo único que no
 * se puede hacer.
 */
export function pintarLegal(
  ctx: ContextoCierre,
  provisional: Bloque[],
  valores: Record<string, unknown>,
  op: { titulo?: string; conAvisoProvisional?: boolean } = {},
): void {
  const { m, t } = ctx;
  const cuerpo = ctx.op.plantilla?.cuerpo;
  const titulo = ctx.op.plantilla?.titulo || op.titulo || t.legal;
  m.espacio(4);
  m.filete();
  m.espacio(6);
  m.titulo(titulo, 2);

  if (esCuerpo(cuerpo)) {
    const { bloques, faltan } = interpolarCuerpo(cuerpo, valores);
    pintarCuerpo(m, bloques);
    if (faltan.length) console.warn("cierre: marcadores sin resolver:", faltan.join(", "));
    return;
  }
  const { bloques } = interpolarCuerpo(provisional, valores);
  pintarCuerpo(m, bloques);
  if (op.conAvisoProvisional !== false) {
    m.espacio(4);
    m.caja(t.provisional_avis, { titulo: t.provisional_titol });
  }
}

/** Los bloqueos del cálculo, si los hay. Solo el resumen los imprime. */
export function pintarBloqueos(ctx: ContextoCierre): void {
  const { m, t, datos } = ctx;
  const lista = (datos.bloquejos ?? []).filter((b) => b && b.detall);
  if (lista.length === 0) return;
  m.espacio(6);
  m.caja(
    lista.map((b) => `· ${b.detall}`).join("\n") + `\n${t.bloquejos_text}`,
    { titulo: t.bloquejos_titol, fondo: COLORES.crema100 },
  );
}

/** Cierra el documento (pie y filigrana en todas las páginas) y devuelve los bytes. */
export async function cerrarCierre(ctx: ContextoCierre): Promise<Renderizado> {
  ctx.m.finalizar();
  const bytes = await ctx.doc.save();
  return { bytes, paginas: ctx.m.numPaginas };
}
