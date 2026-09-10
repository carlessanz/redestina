// El importe en letras, en catalán y en castellano.
//
// POR QUÉ EXISTE. El certificado de donación dice el valor «en letras y en cifras»
// (anexo B.2): es la garantía clásica contra un dígito cambiado a mano en un documento
// con efecto fiscal. Las dos formas tienen que decir lo mismo, así que se generan las
// dos desde el MISMO número y en el mismo sitio.
//
// FUNCIÓN PURA, sin red, sin `Intl` y sin locale del sistema (mismo criterio que
// `priorizacion.ts` y `canal.ts`): el mismo importe da siempre el mismo texto, aquí y
// dentro de dos años, corra donde corra. `Intl.NumberFormat` con estilo `unit` no sabe
// escribir números en letra en catalán, y depender de los datos de ICU del runtime para
// un documento legal sería depender de una versión de Deno.
//
// ⚠️ LOS SITIOS DONDE ESTO SE ROMPE, y por eso están todos probados:
//   · 16 y 17 — en catalán son `setze` y `disset`, no «deu-i-sis»; en castellano,
//     `dieciséis` con acento.
//   · 21 — `vint-i-un` (ca) y `veintiún` (es, apocopado ante nombre): «veintiuno euros»
//     es el error clásico.
//   · 100 — `cent` / `cien` a secas, nunca «un cent»; y 101 es `cent un` / `ciento uno`,
//     donde el castellano cambia la palabra («cien» → «ciento») y el catalán no.
//   · 1.000 — `mil` a secas, nunca «un mil»; pero 1.000.000 sí es `un milió` / `un millón`.
//   · 200 — `dos-cents` con guion en catalán; 500/700/900 son irregulares en castellano
//     (`quinientos`, `setecientos`, `novecientos`).
//
// APÓCOPE (castellano). `uno` pierde la `o` delante de un nombre masculino, y todos los
// números de aquí van seguidos de uno (`euros`, `céntimos`, `mil`, `millones`): 21.000 es
// `veintiún mil` y 1.001 € son `mil un euros`. Se genera apocopado por defecto; el número
// suelto (`absoluto: true`) es el caso raro, no el normal. En catalán no hay apócope: `un`
// es la forma masculina y ya está.

export type IdiomaLletres = "ca" | "es";

// ---------------------------------------------------------------------------
// Catalán
// ---------------------------------------------------------------------------

const CA_UNIDADES = [
  "zero", "un", "dos", "tres", "quatre", "cinc", "sis", "set", "vuit", "nou",
  "deu", "onze", "dotze", "tretze", "catorze", "quinze", "setze", "disset", "divuit", "dinou",
];

const CA_DECENAS = [
  "", "", "vint", "trenta", "quaranta", "cinquanta", "seixanta", "setanta", "vuitanta", "noranta",
];

const CA_CENTENAS = [
  "", "cent", "dos-cents", "tres-cents", "quatre-cents", "cinc-cents",
  "sis-cents", "set-cents", "vuit-cents", "nou-cents",
];

/** 0–99 en catalán. `vint-i-` con guiones; de 30 en adelante, `desena-unitat`. */
function caHastaCien(n: number): string {
  if (n < 20) return CA_UNIDADES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (u === 0) return CA_DECENAS[d];
  if (d === 2) return `vint-i-${CA_UNIDADES[u]}`;
  return `${CA_DECENAS[d]}-${CA_UNIDADES[u]}`;
}

/** 1–999 en catalán. `cent` sin «un» delante; el resto, con espacio. */
function caHastaMil(n: number): string {
  if (n < 100) return caHastaCien(n);
  const c = Math.floor(n / 100);
  const r = n % 100;
  const centenas = CA_CENTENAS[c];
  return r === 0 ? centenas : `${centenas} ${caHastaCien(r)}`;
}

function caEntero(n: number): string {
  if (n === 0) return "zero";
  if (n < 1000) return caHastaMil(n);

  if (n < 1_000_000) {
    const miles = Math.floor(n / 1000);
    const resto = n % 1000;
    // `mil`, nunca «un mil». A partir de dos, el multiplicador sí se escribe.
    const cabeza = miles === 1 ? "mil" : `${caHastaMil(miles)} mil`;
    return resto === 0 ? cabeza : `${cabeza} ${caHastaMil(resto)}`;
  }

  // Los millones se resuelven por recursión: el multiplicador puede ser a su vez un
  // número de hasta seis cifras («dos-cents mil milions»), y así no hay que enumerar
  // escalas que en Redestina no van a aparecer nunca.
  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  const cabeza = millones === 1 ? "un milió" : `${caEntero(millones)} milions`;
  return resto === 0 ? cabeza : `${cabeza} ${caEntero(resto)}`;
}

// ---------------------------------------------------------------------------
// Castellano
// ---------------------------------------------------------------------------

const ES_UNIDADES = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince",
  "dieciséis", "diecisiete", "dieciocho", "diecinueve",
];

const ES_VEINTI = [
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro",
  "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];

const ES_DECENAS = [
  "", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa",
];

const ES_CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/** 0–99 en castellano. Los veinti- van soldados; de 30 en adelante, con `y`. */
function esHastaCien(n: number): string {
  if (n < 20) return ES_UNIDADES[n];
  if (n < 30) return ES_VEINTI[n - 20];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? ES_DECENAS[d] : `${ES_DECENAS[d]} y ${ES_UNIDADES[u]}`;
}

/** 1–999 en castellano. 100 exacto es `cien`; 101 en adelante, `ciento …`. */
function esHastaMil(n: number): string {
  if (n < 100) return esHastaCien(n);
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const r = n % 100;
  return r === 0 ? ES_CENTENAS[c] : `${ES_CENTENAS[c]} ${esHastaCien(r)}`;
}

function esEntero(n: number): string {
  if (n === 0) return "cero";
  if (n < 1000) return esHastaMil(n);

  if (n < 1_000_000) {
    const miles = Math.floor(n / 1000);
    const resto = n % 1000;
    // `mil`, nunca «un mil»; y el multiplicador va apocopado («veintiún mil»).
    const cabeza = miles === 1 ? "mil" : `${apocopar(esHastaMil(miles))} mil`;
    return resto === 0 ? cabeza : `${cabeza} ${esHastaMil(resto)}`;
  }

  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  const cabeza = millones === 1 ? "un millón" : `${apocopar(esEntero(millones))} millones`;
  return resto === 0 ? cabeza : `${cabeza} ${esEntero(resto)}`;
}

/**
 * `uno` → `un`, `veintiuno` → `veintiún`, `… y uno` → `… y un`. Solo toca el FINAL del
 * texto: «veintiuno» dentro de «veintiún mil doscientos veintiuno» ya lo resolvió la
 * recursión, y aquí solo queda la última palabra, que es la que roza el nombre.
 */
function apocopar(texto: string): string {
  if (texto.endsWith("veintiuno")) return `${texto.slice(0, -"veintiuno".length)}veintiún`;
  if (texto.endsWith("uno")) return `${texto.slice(0, -3)}un`;
  return texto;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Un entero no negativo en letras.
 *
 * `absoluto` deja el número tal cual («veintiuno»); por defecto se devuelve apocopado
 * («veintiún»), que es la forma que pide el castellano delante de un nombre y la única
 * que se usa en los documentos. En catalán el parámetro no cambia nada.
 */
export function numeroEnLletres(
  n: number,
  idioma: IdiomaLletres = "ca",
  op: { absoluto?: boolean } = {},
): string {
  if (!isFinite(n)) return "";
  const entero = Math.floor(Math.abs(n));
  const signo = n < 0 ? (idioma === "es" ? "menos " : "menys ") : "";
  if (idioma === "es") {
    const texto = esEntero(entero);
    return signo + (op.absoluto ? texto : apocopar(texto));
  }
  return signo + caEntero(entero);
}

export interface ImporteEnLetras {
  /** El texto completo: «vuit-cents cinquanta euros amb zero cèntims». */
  texto: string;
  /** La parte entera, en letras y sin la palabra `euros`. */
  euros: string;
  /** Los céntimos, en letras y sin la palabra `cèntims`. */
  centimos: string;
  /** Los céntimos redondeados, por si el llamante quiere imprimir la cifra. */
  centimosNum: number;
  /** La parte entera de euros, ya redondeada igual que el texto. */
  eurosNum: number;
}

/**
 * El importe partido en euros y céntimos, redondeado a dos decimales.
 *
 * ⚠️ Se redondea con `toFixed(2)` y se vuelve a leer, no con `Math.round(v * 100)`: el
 * segundo arrastra el error binario del producto y hay importes (los que acaban en `.005`)
 * en los que la cifra impresa y la letra dejarían de coincidir. Que coincidan es todo el
 * motivo por el que esto existe.
 */
function partir(valor: number): { euros: number; centimos: number; negativo: boolean } {
  const n = isFinite(valor) ? valor : 0;
  const negativo = n < 0;
  const fijo = Math.abs(n).toFixed(2);
  const [enteraTxt, decimalTxt] = fijo.split(".");
  return { euros: Number(enteraTxt), centimos: Number(decimalTxt), negativo };
}

/**
 * El importe en letras, como se imprime en el certificado:
 *
 *   `importEnLletres(850, 'ca')` → «vuit-cents cinquanta euros amb zero cèntims»
 *   `importEnLletres(850, 'es')` → «ochocientos cincuenta euros con cero céntimos»
 *
 * Los céntimos SIEMPRE se dicen, aunque sean cero: un importe legal en letras que calla
 * la parte decimal deja abierto qué pasa con ella.
 */
export function importEnLletres(
  valor: number,
  idioma: IdiomaLletres = "ca",
): ImporteEnLetras {
  const { euros, centimos, negativo } = partir(valor);
  const es = idioma === "es";

  const letraEuros = numeroEnLletres(euros, idioma);
  const letraCentimos = numeroEnLletres(centimos, idioma);

  const palabraEuros = euros === 1 ? (es ? "euro" : "euro") : "euros";
  const palabraCentimos = centimos === 1
    ? (es ? "céntimo" : "cèntim")
    : (es ? "céntimos" : "cèntims");
  const nexo = es ? "con" : "amb";
  const signo = negativo ? (es ? "menos " : "menys ") : "";

  return {
    texto: `${signo}${letraEuros} ${palabraEuros} ${nexo} ${letraCentimos} ${palabraCentimos}`,
    euros: letraEuros,
    centimos: letraCentimos,
    centimosNum: centimos,
    eurosNum: euros,
  };
}

/**
 * El importe en cifras, con coma decimal, punto de millar y el símbolo: `850,00 €`.
 *
 * Es el mismo formato que `num()` de `render/comu.ts` —del que no se puede tirar aquí sin
 * arrastrar el módulo de los albaranes, que a propósito no sabe nada de euros— con dos
 * decimales fijos y el símbolo pegado con espacio fino de verdad (uno normal: los
 * tipográficos no están en el subconjunto de las TTF, §fuentes.ts).
 */
export function importEnXifres(valor: number): string {
  const { euros, centimos, negativo } = partir(valor);
  const conMillares = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${conMillares},${String(centimos).padStart(2, "0")} €`;
}
