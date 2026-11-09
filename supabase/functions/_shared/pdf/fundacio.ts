// El nombre de la Fundació en un documento, sacado del PROPIO documento.
//
// Por qué: los datos de la Fundació se editan en Configuració › Fundació
// (`parametros_documentales`) y se congelan en `documentos.datos` al emitir. Si un texto
// con valor legal escribe «Fundació Espigoladors» a mano, cambiar la razón social en
// Configuració no llega al papel, y el documento dice una cosa en el bloque de datos y
// otra en la cláusula. Aquí se decide **una sola vez** de dónde sale el nombre.
//
// Las claves cambian según qué SQL compuso el snapshot, y no se renombran (cada
// renderizador lee las suyas tal cual):
//   · CD, CR, CT, RES, PLA, expediente: `fundacio["raó_social"]` (`cierre_datos_*`, `datos_fiscales`).
//   · CONV: `fundacio.raso_social` (`convenio_emet_document`).
//   · Albarán de una página: `fundacio.razon_social`.
//   · Albaranes antiguos (sin `fundacio`): la parte que es la Fundació —`partes.recibe` en el
//     REC, `partes.entrega` en el ENT— con `razon_social` (`albaran_partes()`). En el OPE la
//     Fundació no es parte: no hay de dónde sacarla.
//
// Sin ninguna de ellas (documentos antiguos), «Fundació Espigoladors».
//
// ⚠️ Este módulo NO importa nada, como `bloques.ts` y `convenio.ts`: lo puede usar
//    cualquier función sin arrastrar `pdf-lib`.

export const FUNDACIO_PER_DEFECTE = "Fundació Espigoladors";

type Obj = Record<string, unknown>;

function esObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** La razón social de un objeto organización, en cualquiera de los vocabularios del SQL. */
function razonDe(o: unknown): string | null {
  if (!esObj(o)) return null;
  return texto(o["raó_social"]) ?? texto(o.raso_social) ?? texto(o.razon_social) ??
    texto(o.rao_social);
}

/** La razón social de la Fundació según el snapshot del documento (`documentos.datos`). */
export function nomFundacio(datos: unknown): string {
  if (!esObj(datos)) return FUNDACIO_PER_DEFECTE;
  const propia = razonDe(datos.fundacio);
  if (propia) return propia;
  const tipo = typeof datos.tipus === "string" ? datos.tipus.replace(/^R-/, "") : "";
  const partes = esObj(datos.partes) ? datos.partes : null;
  if (partes) {
    const parte = tipo === "REC" ? razonDe(partes.recibe) : tipo === "ENT" ? razonDe(partes.entrega) : null;
    if (parte) return parte;
  }
  return FUNDACIO_PER_DEFECTE;
}

/** El pie de página de los documentos del maquetador: «<razón social> · REDESTINA». */
export function peuFundacio(datos: unknown): string {
  return `${nomFundacio(datos)} · REDESTINA`;
}
