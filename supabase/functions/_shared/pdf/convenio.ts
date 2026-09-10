// El convenio como DATOS: el snapshot, los valores de sus marcadores y el texto plano.
//
// Este fichero **no importa nada** (ni pdf-lib, ni el maquetador, ni la base) y esa es su
// razón de ser. El convenio tiene dos salidas y las dos tienen que decir exactamente lo
// mismo:
//
//   1. El **PDF** (`render/conv.ts`, dentro de `generar-documento`).
//   2. La **página de firma** (`enlace-publico`), que enseña el texto completo antes de
//      firmar y guarda su sha256 en `evidencias.sha256_texto`.
//
// Si cada una compusiera el texto por su cuenta, la huella de la evidencia describiría
// una redacción y el papel archivado otra, y la firma dejaría de acreditar qué se firmó
// —que es justamente lo único que tiene que acreditar—. Por eso el mapeo de marcadores
// (`valoresConvenio`) y el aplanado a texto (`textoConvenioPla`) viven aquí, en un módulo
// que las dos pueden importar sin arrastrar 1,8 MB de `pdf-lib` a una función pública.

import { type Bloque, cuerpoATexto, esCuerpo, interpolarCuerpo } from "./bloques.ts";

export type IdiomaConvenio = "ca" | "es";
export type TipoConvenio = "don_gen" | "don_rec" | "com";

export function idiomaConvenio(idioma: string | null | undefined): IdiomaConvenio {
  return idioma === "es" ? "es" : "ca";
}

// ---------------------------------------------------------------------------
// El snapshot
// ---------------------------------------------------------------------------
// Las claves son las que escribe `convenio_emet_document()` (20270111100100), tal cual,
// incluidos el `ç` de `traç_ruta` y el `raso_social` sin acento. Renombrarlas aquí sería
// inventar un segundo vocabulario que un día dejaría de coincidir con el de SQL.

export interface OrganizacionConvenio {
  tipus_org?: string | null;
  org_id?: string | null;
  raso_social?: string | null;
  nom?: string | null;
  nom_comercial?: string | null;
  nif?: string | null;
  domicili?: string | null;
  codi_postal?: string | null;
  poblacio?: string | null;
  comarca?: string | null;
  email?: string | null;
  telefon?: string | null;
  representant?: string | null;
  carrec?: string | null;
}

export interface FirmanteConvenio {
  nombre?: string | null;
  cargo?: string | null;
  email?: string | null;
}

export interface FundacionConvenio {
  raso_social?: string | null;
  cif?: string | null;
  domicili?: string | null;
  codi_postal?: string | null;
  poblacio?: string | null;
  inscripcio?: string | null;
  apoderada_nom?: string | null;
  apoderada_carrec?: string | null;
  /** Solo en la contrafirma: rutas del bucket privado `activos`. */
  firma_ruta?: string | null;
  segell_ruta?: string | null;
}

/** Una fila de `evidencias`, tal como la copia el snapshot. **Sin DNI**. */
export interface EvidenciaConvenio {
  tipus?: string | null;
  nom?: string | null;
  carrec?: string | null;
  declaracio?: boolean | null;
  "traç_ruta"?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  sha256_texte?: string | null;
  assistit_per?: string | null;
  created_at?: string | null;
}

export interface DatosConvenio {
  tipus?: string | null;
  subtipus?: string | null;
  numero?: string | null;
  ejercici?: number | null;
  idioma?: string | null;
  roles_com?: string[] | null;
  organitzacio?: OrganizacionConvenio | null;
  firmant?: FirmanteConvenio | null;
  firmat_at?: string | null;
  contrafirmat_at?: string | null;
  fundacio?: FundacionConvenio | null;
  dades_provisionals?: boolean | null;
  evidencies?: EvidenciaConvenio[] | null;
}

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

export interface DiccionarioConvenio {
  titulo: string;
  subtitulo: Record<TipoConvenio, string>;
  modelo: Record<TipoConvenio, string>;
  rol: Record<string, string>;
  firmat: string;
  contrafirmat: string;
  numero: string;
  exercici: string;
  model: string;
  redaccio: string;
  data_firma: string;
  data_contrafirma: string;
  codi_verificacio: string;
  rols: string;
  parts: string;
  fundacio: string;
  organitzacio: string;
  firmant: string;
  rao_social: string;
  nom_comercial: string;
  nif: string;
  cif: string;
  domicili: string;
  poblacio: string;
  comarca: string;
  correu: string;
  telefon: string;
  inscripcio: string;
  representant: string;
  carrec: string;
  apoderada: string;
  clausules: string;
  signatures: string;
  signa_org: string;
  signa_fundacio: string;
  pendent_contrafirma: string;
  evidencies_titol: string;
  evidencies_intro: string;
  ev_qui: string;
  ev_carrec: string;
  ev_document: string;
  ev_declaracio: string;
  ev_declaracio_si: string;
  ev_data: string;
  ev_ip: string;
  ev_navegador: string;
  ev_petjada: string;
  ev_canal: string;
  ev_canal_email: string;
  ev_canal_assistit: string;
  ev_assistit_per: string;
  ev_codi: string;
  ev_codi_si: string;
  ev_codi_no: string;
  ev_trac: string;
  ev_sense_trac: string;
  ev_apertura: string;
  ev_sense: string;
  ev_nota_titol: string;
  ev_nota: string;
  esborrany_titol: string;
  esborrany_avis: string;
  esborrany_marca: string;
  provisional_titol: string;
  provisional_avis: string;
  dades_prov_titol: string;
  dades_prov_avis: string;
  declaracio_titol: string;
  declaracio_representacio: string;
  declaracio_acceptacio: string;
  peu: string;
  pagina: (n: number, total: number) => string;
  mesos: string[];
}

const CA: DiccionarioConvenio = {
  titulo: "Conveni de col·laboració",
  subtitulo: {
    don_gen: "Donació d'aliments fora del circuit de venda habitual",
    don_rec: "Entitat receptora amb servei de distribució d'aliments",
    com: "Compravenda i maquila",
  },
  modelo: {
    don_gen: "Conveni de donació de la part generadora",
    don_rec: "Conveni d'entitat receptora",
    com: "Conveni de compravenda i maquila",
  },
  rol: { venedora: "part venedora", compradora: "part compradora", obrador: "obrador" },
  firmat: "Firmat per l'organització",
  contrafirmat: "Firmat i contrasignat",
  numero: "Número",
  exercici: "Exercici",
  model: "Model",
  redaccio: "Redacció del text",
  data_firma: "Data de la firma",
  data_contrafirma: "Data de la contrasignatura",
  codi_verificacio: "Codi de verificació",
  rols: "Rols",
  parts: "Parts",
  fundacio: "Fundació",
  organitzacio: "Organització",
  firmant: "Qui firma per l'organització",
  rao_social: "Raó social",
  nom_comercial: "Nom comercial",
  nif: "NIF",
  cif: "CIF",
  domicili: "Domicili",
  poblacio: "Població",
  comarca: "Comarca",
  correu: "Correu",
  telefon: "Telèfon",
  inscripcio: "Inscripció",
  representant: "Representant",
  carrec: "Càrrec",
  apoderada: "Apoderada",
  clausules: "Clàusules",
  signatures: "Signatures",
  signa_org: "Per l'organització",
  signa_fundacio: "Per la Fundació Espigoladors",
  pendent_contrafirma:
    "Pendent de contrasignatura per part de la Fundació Espigoladors. Quan es validi s'emetrà la versió definitiva d'aquest document.",
  evidencies_titol: "Evidències de la signatura electrònica",
  evidencies_intro:
    "Aquesta pàgina forma part del conveni i recull què va passar en el moment de firmar-lo. Es genera automàticament a partir del registre del sistema i no es pot modificar.",
  ev_qui: "Qui va firmar",
  ev_carrec: "Càrrec declarat",
  ev_document: "Document d'identitat declarat",
  ev_declaracio: "Declaració de representació",
  ev_declaracio_si:
    "Declara tenir poders suficients per obligar l'organització en aquest conveni.",
  ev_data: "Data i hora",
  ev_ip: "Adreça IP",
  ev_navegador: "Navegador",
  ev_petjada: "Empremta del text acceptat (SHA-256)",
  ev_canal: "Via",
  ev_canal_email: "Enllaç enviat per correu",
  ev_canal_assistit: "Firma assistida, amb una persona de l'equip present",
  ev_assistit_per: "Conduïda per",
  ev_codi: "Segon factor",
  ev_codi_si: "Codi de 6 xifres enviat per correu i validat",
  ev_codi_no: "Sense segon factor",
  ev_trac: "Traç de la firma",
  ev_sense_trac: "El traç de la firma no s'ha pogut recuperar per imprimir-lo aquí.",
  ev_apertura: "Obertura de l'enllaç",
  ev_sense: "No consta cap evidència registrada per a aquest conveni.",
  ev_nota_titol: "Què acredita aquesta pàgina",
  ev_nota:
    "És una signatura electrònica simple: acredita qui va firmar, quan, des d'on i —per l'empremta SHA-256— quin text exacte va acceptar. El document d'identitat és el que la persona va declarar; el sistema no el verifica contra cap registre oficial.",
  esborrany_titol: "Esborrany de treball · sense valor contractual",
  esborrany_avis:
    "El text d'aquest conveni encara no l'ha validat l'assessoria jurídica de la Fundació Espigoladors. S'imprimeix perquè el document es pugui llegir i provar, però NO té valor contractual i no s'ha d'enviar a firmar.",
  esborrany_marca: "Esborrany · sense valor contractual",
  provisional_titol: "Text provisional, pendent de validació",
  provisional_avis:
    "Aquest conveni s'ha emès sense cap plantilla carregada, així que el text que hi consta és un resum del sistema i no l'articulat definitiu. No substitueix el text legal.",
  dades_prov_titol: "Dades de la Fundació pendents de confirmar",
  dades_prov_avis:
    "Les dades identificatives de la Fundació que apareixen en aquest document encara són provisionals.",
  declaracio_titol: "Declaracions de qui firma",
  declaracio_representacio:
    "Declaro que tinc poders suficients per representar l'organització i obligar-la en aquest conveni.",
  declaracio_acceptacio:
    "He llegit el text complet del conveni i l'accepto. Accepto també rebre comunicacions de REDESTINA per correu i per WhatsApp relacionades amb aquest conveni.",
  peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n, total) => `pàg. ${n} de ${total}`,
  mesos: [
    "gener", "febrer", "març", "abril", "maig", "juny",
    "juliol", "agost", "setembre", "octubre", "novembre", "desembre",
  ],
};

const ES: DiccionarioConvenio = {
  titulo: "Convenio de colaboración",
  subtitulo: {
    don_gen: "Donación de alimentos fuera del circuito de venta habitual",
    don_rec: "Entidad receptora con servicio de distribución de alimentos",
    com: "Compraventa y maquila",
  },
  modelo: {
    don_gen: "Convenio de donación de la parte generadora",
    don_rec: "Convenio de entidad receptora",
    com: "Convenio de compraventa y maquila",
  },
  rol: { venedora: "parte vendedora", compradora: "parte compradora", obrador: "obrador" },
  firmat: "Firmado por la organización",
  contrafirmat: "Firmado y contrafirmado",
  numero: "Número",
  exercici: "Ejercicio",
  model: "Modelo",
  redaccio: "Redacción del texto",
  data_firma: "Fecha de la firma",
  data_contrafirma: "Fecha de la contrafirma",
  codi_verificacio: "Código de verificación",
  rols: "Roles",
  parts: "Partes",
  fundacio: "Fundación",
  organitzacio: "Organización",
  firmant: "Quien firma por la organización",
  rao_social: "Razón social",
  nom_comercial: "Nombre comercial",
  nif: "NIF",
  cif: "CIF",
  domicili: "Domicilio",
  poblacio: "Población",
  comarca: "Comarca",
  correu: "Correo",
  telefon: "Teléfono",
  inscripcio: "Inscripción",
  representant: "Representante",
  carrec: "Cargo",
  apoderada: "Apoderada",
  clausules: "Cláusulas",
  signatures: "Firmas",
  signa_org: "Por la organización",
  signa_fundacio: "Por la Fundació Espigoladors",
  pendent_contrafirma:
    "Pendiente de contrafirma por parte de la Fundació Espigoladors. Cuando se valide se emitirá la versión definitiva de este documento.",
  evidencies_titol: "Evidencias de la firma electrónica",
  evidencies_intro:
    "Esta página forma parte del convenio y recoge qué ocurrió en el momento de firmarlo. Se genera automáticamente a partir del registro del sistema y no se puede modificar.",
  ev_qui: "Quién firmó",
  ev_carrec: "Cargo declarado",
  ev_document: "Documento de identidad declarado",
  ev_declaracio: "Declaración de representación",
  ev_declaracio_si:
    "Declara tener poderes suficientes para obligar a la organización en este convenio.",
  ev_data: "Fecha y hora",
  ev_ip: "Dirección IP",
  ev_navegador: "Navegador",
  ev_petjada: "Huella del texto aceptado (SHA-256)",
  ev_canal: "Vía",
  ev_canal_email: "Enlace enviado por correo",
  ev_canal_assistit: "Firma asistida, con una persona del equipo presente",
  ev_assistit_per: "Conducida por",
  ev_codi: "Segundo factor",
  ev_codi_si: "Código de 6 cifras enviado por correo y validado",
  ev_codi_no: "Sin segundo factor",
  ev_trac: "Trazo de la firma",
  ev_sense_trac: "El trazo de la firma no se ha podido recuperar para imprimirlo aquí.",
  ev_apertura: "Apertura del enlace",
  ev_sense: "No consta ninguna evidencia registrada para este convenio.",
  ev_nota_titol: "Qué acredita esta página",
  ev_nota:
    "Es una firma electrónica simple: acredita quién firmó, cuándo, desde dónde y —por la huella SHA-256— qué texto exacto aceptó. El documento de identidad es el que la persona declaró; el sistema no lo verifica contra ningún registro oficial.",
  esborrany_titol: "Borrador de trabajo · sin valor contractual",
  esborrany_avis:
    "El texto de este convenio todavía no lo ha validado la asesoría jurídica de la Fundació Espigoladors. Se imprime para que el documento se pueda leer y probar, pero NO tiene valor contractual y no debe enviarse a firmar.",
  esborrany_marca: "Borrador · sin valor contractual",
  provisional_titol: "Texto provisional, pendiente de validación",
  provisional_avis:
    "Este convenio se ha emitido sin ninguna plantilla cargada, así que el texto que consta es un resumen del sistema y no el articulado definitivo. No sustituye al texto legal.",
  dades_prov_titol: "Datos de la Fundación pendientes de confirmar",
  dades_prov_avis:
    "Los datos identificativos de la Fundación que aparecen en este documento todavía son provisionales.",
  declaracio_titol: "Declaraciones de quien firma",
  declaracio_representacio:
    "Declaro que tengo poderes suficientes para representar a la organización y obligarla en este convenio.",
  declaracio_acceptacio:
    "He leído el texto completo del convenio y lo acepto. Acepto también recibir comunicaciones de REDESTINA por correo y por WhatsApp relacionadas con este convenio.",
  peu: "Fundació Espigoladors · REDESTINA",
  pagina: (n, total) => `pág. ${n} de ${total}`,
  mesos: [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ],
};

export function diccionarioConvenio(idioma: string | null | undefined): DiccionarioConvenio {
  return idioma === "es" ? ES : CA;
}

export function tipoConvenio(valor: unknown): TipoConvenio {
  return valor === "don_rec" || valor === "com" ? valor : "don_gen";
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** `2027-01-11` → `11 de gener de 2027` (con `d'` ante vocal en catalán). */
export function fechaLargaConvenio(
  valor: unknown,
  t: DiccionarioConvenio,
  idioma: IdiomaConvenio,
): string {
  if (typeof valor !== "string" || !valor) return "";
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return valor;
  const dia = Number(m[3]);
  const mes = t.mesos[Number(m[2]) - 1] ?? "";
  const preposicion = idioma === "ca" && /^[aeiouàèéíòóú]/i.test(mes) ? "d'" : "de ";
  return `${dia} ${preposicion}${mes} de ${m[1]}`;
}

/** La misma fecha con la hora, en el huso de Madrid. Para las evidencias. */
export function fechaHoraConvenio(valor: unknown): string {
  if (typeof valor !== "string" || !valor) return "";
  const d = new Date(valor);
  if (isNaN(d.getTime())) return valor;
  return new Intl.DateTimeFormat("ca-ES", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d).replace(",", " ·");
}

/** El código de verificación impreso: 16 hex del sha256, en grupos de 4. */
export function codigoVerificacionConvenio(sha: string | null | undefined): string {
  if (!sha) return "—";
  const limpio = sha.replace(/[^0-9a-fA-F]/g, "").slice(0, 16).toUpperCase();
  return limpio.match(/.{1,4}/g)?.join("-") ?? limpio;
}

/** «Carrer de Prova, 1 · 08850 Gavà». Los huecos no dejan rastro. */
export function domicilioConvenio(
  o: OrganizacionConvenio | FundacionConvenio | null | undefined,
): string {
  if (!o) return "";
  const localidad = [o.codi_postal, o.poblacio].filter((x) => x && String(x).trim()).join(" ");
  return [o.domicili, localidad].filter((x) => x && String(x).trim()).join(" · ");
}

/** Los roles de un convenio de compraventa, en palabras. */
export function rolesEnTexto(
  roles: string[] | null | undefined,
  t: DiccionarioConvenio,
): string {
  const lista = (roles ?? []).map((r) => t.rol[r] ?? r).filter(Boolean);
  return lista.join(", ");
}

// ---------------------------------------------------------------------------
// Los valores de los marcadores
// ---------------------------------------------------------------------------
/**
 * El mapeo `{{marcador}}` → valor, y **el único que hay**: lo usan el PDF y la página de
 * firma. Las claves son exactamente las que declaran las seis plantillas sembradas
 * (20270111100200); un marcador que no esté aquí se queda visible en el texto, que es lo
 * que quiere `interpolar()`.
 *
 * `numero` puede ser null todavía: el número se pide **al firmar** y en la página de
 * firma el convenio aún no lo tiene. En ese caso el marcador se queda a la vista, y eso
 * es correcto —el texto que se enseña no lleva número porque todavía no existe—.
 */
export function valoresConvenio(
  datos: DatosConvenio,
  t: DiccionarioConvenio,
  idioma: IdiomaConvenio,
): Record<string, unknown> {
  const org = datos.organitzacio ?? {};
  const fun = datos.fundacio ?? {};
  const fir = datos.firmant ?? {};
  return {
    numero: datos.numero ?? "",
    ejercici: datos.ejercici ?? "",
    firmat_at: fechaLargaConvenio(datos.firmat_at, t, idioma),
    roles: rolesEnTexto(datos.roles_com, t),
    organitzacio: {
      raso_social: org.raso_social ?? org.nom ?? "",
      nom_comercial: org.nom_comercial ?? "",
      nif: org.nif ?? "",
      domicili: org.domicili ?? "",
      codi_postal: org.codi_postal ?? "",
      poblacio: org.poblacio ?? "",
      comarca: org.comarca ?? "",
      email: org.email ?? "",
      telefon: org.telefon ?? "",
    },
    firmant: {
      nombre: fir.nombre ?? org.representant ?? "",
      cargo: fir.cargo ?? org.carrec ?? "",
      email: fir.email ?? "",
    },
    fundacio: {
      raso_social: fun.raso_social ?? "",
      cif: fun.cif ?? "",
      domicili: fun.domicili ?? "",
      codi_postal: fun.codi_postal ?? "",
      poblacio: fun.poblacio ?? "",
      inscripcio: fun.inscripcio ?? "",
      apoderada_nom: fun.apoderada_nom ?? "",
      apoderada_carrec: fun.apoderada_carrec ?? "",
    },
  };
}

// ---------------------------------------------------------------------------
// El cuerpo: plantilla o provisional
// ---------------------------------------------------------------------------

/**
 * ¿Es una plantilla de las sembradas sin validar? Se detecta por el `[ESBORRANY]` /
 * `[BORRADOR]` del título, que es la marca que puso el seed **a propósito** para que se
 * pueda distinguir sin consultar nada (20270111100200).
 *
 * Importa porque no basta con reimprimir el aviso que el propio cuerpo lleva dentro: un
 * documento de diez páginas se hojea, y un párrafo en la primera se pasa por alto. Con
 * esto el PDF sale además con filigrana en TODAS las páginas.
 */
export function esPlantillaProvisional(titulo: string | null | undefined): boolean {
  return /^\s*\[\s*(ESBORRANY|BORRADOR)\s*\]/i.test(titulo ?? "");
}

/** El título de la plantilla sin el `[ESBORRANY]` de delante. */
export function tituloSinMarca(titulo: string | null | undefined): string {
  return (titulo ?? "").replace(/^\s*\[\s*(ESBORRANY|BORRADOR)\s*\]\s*/i, "").trim();
}

/**
 * El cuerpo mínimo cuando **no hay ninguna plantilla cargada**. No pretende ser un
 * convenio: dice qué es el documento, quiénes son las partes y que el articulado falta.
 * Imprimir algo con aspecto de articulado sin serlo es lo único que no se puede hacer.
 */
export function cuerpoProvisional(t: DiccionarioConvenio): Bloque[] {
  return [
    { tipo: "p", text: t.provisional_avis },
    {
      tipo: "p",
      text:
        "{{organitzacio.raso_social}} — NIF {{organitzacio.nif}} — i {{fundacio.raso_social}} — CIF {{fundacio.cif}} — subscriuen aquest conveni número {{numero}} de l'exercici {{ejercici}}.",
    },
  ];
}

export interface CuerpoConvenio {
  bloques: Bloque[];
  faltan: string[];
  /** `true` si sale del provisional de arriba y no de `plantillas_documento`. */
  sinPlantilla: boolean;
}

/**
 * El cuerpo del convenio, ya interpolado. Fuente única para el PDF y para la página de
 * firma: las dos llaman aquí con el mismo `datos` y obtienen los mismos bloques.
 */
export function cuerpoConvenio(
  datos: DatosConvenio,
  plantillaCuerpo: unknown,
  t: DiccionarioConvenio,
  idioma: IdiomaConvenio,
): CuerpoConvenio {
  const valores = valoresConvenio(datos, t, idioma);
  if (esCuerpo(plantillaCuerpo)) {
    const { bloques, faltan } = interpolarCuerpo(plantillaCuerpo, valores);
    return { bloques, faltan, sinPlantilla: false };
  }
  const { bloques, faltan } = interpolarCuerpo(cuerpoProvisional(t), valores);
  return { bloques, faltan, sinPlantilla: true };
}

/**
 * EL TEXTO QUE SE FIRMA. Es lo que la página de firma enseña literalmente y lo que se
 * hashea en `evidencias.sha256_texto`.
 *
 * ⚠️ Qué lleva y qué NO, porque de eso depende que la evidencia signifique algo:
 *   · Lleva el **articulado completo** ya interpolado y las **dos declaraciones** que la
 *     persona marca. Eso es lo que acepta.
 *   · NO lleva los datos que la persona rellena en el formulario (NIF, domicilio,
 *     representante). Eso no es texto aceptado, es información aportada: viaja en
 *     `evidencias.payload` y se congela en `convenios.datos_org`. Meterlo aquí haría que
 *     la huella cambiara con cada tecla y el guardia de «el document ha canviat» dejaría
 *     de poder distinguir un cambio real de la escritura del propio formulario.
 *   · NO lleva el número: al firmar todavía no existe (lo asigna la propia firma).
 *
 * La cabecera incluye el título de la plantilla **y su versión**, que es lo que permite
 * responder «con qué redacción se firmó» sin depender de que nadie recuerde nada.
 */
export function textoConvenioPla(
  datos: DatosConvenio,
  plantilla: { titulo?: string | null; cuerpo?: unknown; version?: number | null } | null,
  t: DiccionarioConvenio,
  idioma: IdiomaConvenio,
): string {
  const tipo = tipoConvenio(datos.tipus);
  const { bloques } = cuerpoConvenio(datos, plantilla?.cuerpo, t, idioma);
  const titulo = tituloSinMarca(plantilla?.titulo) || `${t.titulo} · ${t.subtitulo[tipo]}`;
  const version = plantilla?.version ? `v${plantilla.version}` : "";
  const cabecera = [t.modelo[tipo], titulo, version].filter(Boolean).join(" · ");
  const aviso = esPlantillaProvisional(plantilla?.titulo) ? `${t.esborrany_titol}\n` : "";
  return [
    cabecera,
    "",
    aviso + cuerpoATexto(bloques),
    "",
    t.declaracio_titol,
    `· ${t.declaracio_representacio}`,
    `· ${t.declaracio_acceptacio}`,
  ].join("\n");
}
