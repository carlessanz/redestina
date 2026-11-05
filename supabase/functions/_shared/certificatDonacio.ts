// El texto del certificado de donación (CD), según el modelo de la Fundació
// (`Certificat_Donacio_Tabaquet.pdf`, Drive › 1. Fuentes › Certificats donacio).
//
// Módulo HOJA (§7, `tests/puresa.test.ts`): no importa nada y no usa `Deno.`, porque lo
// usan a la vez el renderizador del PDF (`_shared/pdf/render/cd.ts`) y el panel, que
// enseña el mismo periodo y la misma naturaleza del donante que se imprimirán.
//
// Lo que hace es una sola cosa: convertir el snapshot del certificado (`documentos.datos`)
// en el diccionario de marcadores `{{…}}` de la plantilla `CD` de `plantillas_documento`.
// La plantilla —el texto legal— vive en la base; aquí solo se decide CÓMO se escribe cada
// dato dentro de ese texto: fechas dd/mm/aaaa en el periodo, kilos con punto de millar,
// el importe en mayúsculas, «persona jurídica/física» según el NIF y la frase de la factura
// solo si la hay.
//
// 🔴 Lo que NO decide este módulo es qué kilos entran: eso es la base
//    (`cierre_base_periodo`: solo donación conciliada a una entidad `social`). Aquí llegan
//    ya sumados y no se vuelven a filtrar.

export type IdiomaCertificat = "ca" | "es";
export type AbastCertificat = "exercici" | "periode" | "oferta";

/** El título del documento, como en el modelo. */
export const TITOL_CERTIFICAT: Record<IdiomaCertificat, string> = {
  ca: "CERTIFICAT DE DONACIÓ",
  es: "CERTIFICADO DE DONACIÓN",
};

/**
 * Los marcadores que usa la plantilla `CD` (anual y `parcial`). La migración que la carga
 * y este módulo tienen que coincidir: `tests/certificatDonacio.test.ts` lo comprueba
 * contra el SQL.
 */
export const MARCADORS_CERTIFICAT = [
  "apoderada.nom",
  "apoderada.dni",
  "apoderada.carrec",
  "fundacio.rao_social",
  "fundacio.rao_social_maj",
  "fundacio.cif",
  "fundacio.domicili",
  "fundacio.codi_postal",
  "fundacio.poblacio",
  "fundacio.inscripcio",
  "periode.text",
  "donant.naturalesa",
  "donant.rao_social_maj",
  "donant.nif",
  "kg",
  "factura.frase",
  "import_lletres_maj",
  "import_xifres",
  "lloc",
  "data_expedicio",
] as const;

/**
 * Marcadores que pueden quedar vacíos A PROPÓSITO. `bloques.ts` trata un valor vacío como
 * «falta» y deja el `{{…}}` impreso (mejor un hueco visible que un silencio legal), así
 * que estos se quitan del texto antes de interpolar con `treureOpcionalsBuits`.
 */
export const MARCADORS_OPCIONALS = ["factura.frase"] as const;

/** Quita del texto los marcadores opcionales cuyo valor es vacío. */
export function treureOpcionalsBuits(text: string, valors: Record<string, unknown>): string {
  let out = text;
  for (const ruta of MARCADORS_OPCIONALS) {
    const valor = ruta.split(".").reduce<unknown>(
      (a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined),
      valors,
    );
    if (valor === undefined || valor === null || valor === "") {
      out = out.replace(new RegExp(`\\{\\{\\s*${ruta.replace(".", "\\.")}\\s*\\}\\}`, "g"), "");
    }
  }
  return out;
}

/** `2025-12-31` → `31/12/2025`. Lo que no es una fecha ISO se devuelve tal cual. */
export function dataCurta(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * «jurídica» o «física» según el NIF.
 *
 * Un DNI (8 cifras y letra) o un NIE (X/Y/Z…) es una persona física; un NIF que empieza
 * por letra de sociedad o entidad (A, B, C, D, E, F, G, H, J, N, P, Q, R, S, U, V, W) es
 * una persona jurídica. Las letras K, L y M son NIF especiales de personas físicas. Sin
 * NIF reconocible se dice «jurídica», que es el caso del modelo y el de casi todos los
 * donantes (la base valida el NIF al activar la ficha, `trg_fitxa_estat`).
 */
export function naturalesaPerNif(nif: unknown, idioma: IdiomaCertificat): string {
  const n = typeof nif === "string" ? nif.replace(/[\s.-]/g, "").toUpperCase() : "";
  const fisica = /^\d/.test(n) || /^[XYZKLM]/.test(n);
  if (idioma === "es") return fisica ? "física" : "jurídica";
  return fisica ? "física" : "jurídica";
}

/**
 * «l'exercici 01/01/2025 a 31/12/2025» o «el període 01/03/2026 a 15/03/2026».
 *
 * El modelo dice «durant l'exercici …» porque es anual; un certificado de un intervalo o
 * de una oferta no puede llamar «exercici» a quince días, así que dice «període». Si las
 * dos fechas coinciden (una oferta recogida en un solo día) se dice «el dia …».
 */
export function textPeriode(
  abast: AbastCertificat,
  desDe: unknown,
  finsA: unknown,
  idioma: IdiomaCertificat,
): string {
  const a = dataCurta(desDe);
  const b = dataCurta(finsA);
  const es = idioma === "es";
  if (abast !== "exercici" && a && a === b) return es ? `el día ${a}` : `el dia ${a}`;
  const nom = abast === "exercici"
    ? (es ? "el ejercicio" : "l'exercici")
    : (es ? "el periodo" : "el període");
  return `${nom} ${a} a ${b}`;
}

/**
 * Los kilos como en el modelo: «2.969». Punto de millar siempre (también con cuatro
 * cifras, que `Intl` en ca/es no agrupa) y un decimal solo si lo hay.
 */
export function kgText(kg: unknown): string {
  const n = typeof kg === "number" ? kg : Number(kg ?? 0);
  if (!isFinite(n)) return "0";
  const fijo = Math.abs(n).toFixed(1);
  const [ent, dec] = fijo.split(".");
  const conMillares = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}${conMillares}${dec && dec !== "0" ? `,${dec}` : ""}`;
}

export interface FacturaCertificat {
  numero?: string | null;
  data?: string | null;
}

/**
 * «, segons la factura núm. X, amb data 31/12/2025», o nada.
 *
 * El modelo la cita. En una donación lo normal es que no haya factura (solo albaranes), y
 * desde el 21-09-2026 no es condición para certificar: sin número, la frase desaparece y
 * el párrafo sigue siendo correcto.
 */
export function fraseFactura(
  factura: FacturaCertificat | null | undefined,
  idioma: IdiomaCertificat,
): string {
  const numero = factura?.numero?.trim();
  if (!numero) return "";
  const data = dataCurta(factura?.data ?? "");
  if (idioma === "es") {
    return `, según la factura núm. ${numero}${data ? `, con fecha ${data}` : ""}`;
  }
  return `, segons la factura núm. ${numero}${data ? `, amb data ${data}` : ""}`;
}

/** Mayúsculas con las reglas del idioma (la «ç», la «l·l»). */
export function majuscules(text: unknown, idioma: IdiomaCertificat): string {
  return typeof text === "string" ? text.toLocaleUpperCase(idioma === "es" ? "es" : "ca") : "";
}

/** «Apoderada» → «apoderada»: el cargo va en minúscula dentro de la frase. */
export function carrecEnFrase(carrec: unknown): string {
  if (typeof carrec !== "string" || !carrec.trim()) return "";
  const c = carrec.trim();
  return c.charAt(0).toLocaleLowerCase("ca") + c.slice(1);
}

/**
 * La inscripción registral tal como la dice el modelo: «inscrita en el Registre de
 * Fundacions de la Generalitat de Catalunya». El campo de Configuració › Fundació puede
 * traer la frase entera (se respeta) o solo el número (se pone detrás).
 */
export function fraseInscripcio(inscripcio: unknown, idioma: IdiomaCertificat): string {
  const base = idioma === "es"
    ? "inscrita en el Registro de Fundaciones de la Generalitat de Catalunya"
    : "inscrita en el Registre de Fundacions de la Generalitat de Catalunya";
  const t = typeof inscripcio === "string" ? inscripcio.trim().replace(/\.$/, "") : "";
  if (!t) return base;
  if (/^inscrit/i.test(t)) return t;
  return idioma === "es" ? `${base} con el número ${t}` : `${base} amb el número ${t}`;
}

/** Lo que el renderizador le pasa: el snapshot y lo que no está en él. */
export interface EntradaCertificat {
  idioma: IdiomaCertificat;
  abast: AbastCertificat;
  /** El snapshot (`documentos.datos`). Se lee con tolerancia: los antiguos no traen todo. */
  // deno-lint-ignore no-explicit-any
  datos: Record<string, any>;
  /** El DNI de la apoderada: no está en el snapshot (lo lee `generar-documento`). */
  apoderadaDni: string | null | undefined;
  /** El importe en letras (`importEnLletres(...).texto`) y en cifras (`importEnXifres`). */
  importLletres: string;
  importXifres: string;
  /** La fecha de expedición en largo («31 de desembre de 2025»), ya formateada. */
  dataExpedicioLlarga: string;
}

/** El diccionario de marcadores de la plantilla `CD`. Claves ASCII, como exige `bloques.ts`. */
export function valorsCertificat(e: EntradaCertificat): Record<string, unknown> {
  const { datos, idioma } = e;
  const fundacio = datos.fundacio ?? {};
  const donant = datos.donant ?? {};
  const periode = datos.periode ?? {};
  const raoFundacio = fundacio["raó_social"] ?? fundacio.rao_social ?? "";
  const raoDonant = donant["raó_social"] ?? donant.rao_social ?? "";
  return {
    apoderada: {
      nom: datos.apoderada?.nom ?? "",
      dni: e.apoderadaDni ?? "",
      carrec: carrecEnFrase(datos.apoderada?.carrec),
    },
    fundacio: {
      rao_social: raoFundacio,
      rao_social_maj: majuscules(raoFundacio, idioma),
      cif: fundacio.cif ?? "",
      domicili: fundacio.domicili ?? "",
      codi_postal: fundacio.codi_postal ?? "",
      poblacio: fundacio.poblacio ?? "",
      inscripcio: fraseInscripcio(fundacio.inscripcio, idioma),
    },
    periode: { text: textPeriode(e.abast, periode.des_de, periode.fins_a, idioma) },
    donant: {
      naturalesa: naturalesaPerNif(donant.nif, idioma),
      rao_social_maj: majuscules(raoDonant, idioma),
      nif: donant.nif ?? "",
    },
    kg: kgText(datos.kg),
    factura: { frase: fraseFactura(datos.factura, idioma) },
    import_lletres_maj: majuscules(e.importLletres, idioma),
    import_xifres: e.importXifres,
    lloc: datos.lloc ?? fundacio.poblacio ?? "",
    data_expedicio: e.dataExpedicioLlarga,
  };
}

/**
 * El ámbito de un snapshot. Lo antiguo no trae `abast`: un CD anual (`cierre_donante`)
 * es `exercici` y uno a demanda, `periode`.
 */
// deno-lint-ignore no-explicit-any
export function abastDe(datos: Record<string, any> | null | undefined): AbastCertificat {
  const a = datos?.abast;
  if (a === "exercici" || a === "periode" || a === "oferta") return a;
  return datos?.periode && datos?.cierre_periodo_id ? "periode" : "exercici";
}
