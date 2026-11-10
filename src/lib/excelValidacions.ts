// Desplegables (validación de datos de tipo lista) en un .xlsx de `write-excel-file` (Plan 2 B2, 10-11-2026).
//
// `write-excel-file` 4.1.1 no sabe hacer validación de datos, pero acepta «features» que transforman el
// XML de cada hoja antes de comprimirlo. Este módulo construye el elemento `<dataValidations>` y una
// feature que lo inserta en la hoja que toca, en el sitio que exige el esquema OOXML (ECMA-376,
// `CT_Worksheet`): después de `<sheetData>` y de lo que va entre los dos (`mergeCells`,
// `conditionalFormatting`…), y antes de `<hyperlinks>`, `<pageMargins>`, `<drawing>`… Si se pone en otro
// sitio, Excel dice que el fichero está dañado y lo «repara» quitándolo.
//
// Cada lista se referencia como RANGO de otra hoja (`Llistes!$G$2:$G$948`), no como texto literal: así no
// hay tope de 255 caracteres y caben los 947 municipios. Excel lo admite desde 2010; LibreOffice y
// Numbers también lo leen.
//
// PURO: sin DOM ni red. Lo usan la plantilla del importador (B2) y la exportación de entidades (B3).

import type { Feature } from 'write-excel-file/browser'

export interface ValidacioLlista {
  /** Columna de la hoja de datos, desde 0 (A = 0). */
  columna: number
  /** El rango con los valores admitidos, con hoja y absoluto: `Llistes!$C$2:$C$12` (ver `rangLlista`). */
  rang: string
  /**
   * La celda admite varios valores separados por coma: el desplegable ayuda a escoger uno pero no
   * avisa si lo escrito no está en la lista (`showErrorMessage="0"`).
   */
  multiple: boolean
}

export interface OpcionsValidacions {
  /** Primera y última fila (desde 1, como en Excel) que llevan el desplegable. */
  primeraFila: number
  ultimaFila: number
  /**
   * Aviso al escribir algo que no está en la lista (solo en las de un valor). Es un aviso, no un
   * bloqueo (`errorStyle="warning"`): el importador entiende variantes que la lista no tiene (el otro
   * idioma, sin acentos), y quien escribe puede seguir. Excel corta el título a 32 caracteres y el
   * mensaje a 255.
   */
  avisTitol?: string
  avis?: string
}

/** Letra de una columna desde 0: 0 → A, 25 → Z, 26 → AA. */
export function lletraColumna(i: number): string {
  if (!Number.isInteger(i) || i < 0) throw new Error(`columna_invalida: ${i}`)
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** El nombre de una hoja tal como va en una fórmula: entre comillas simples si hace falta. */
export function nomFullaFormula(fulla: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(fulla) ? fulla : `'${fulla.replaceAll("'", "''")}'`
}

/**
 * El rango absoluto de una lista que ocupa `n` celdas de la columna `columna` de la hoja `fulla`,
 * empezando en la fila `primeraFila` (la 1 suele ser la cabecera). `null` si la lista está vacía.
 */
export function rangLlista(fulla: string, columna: number, n: number, primeraFila = 2): string | null {
  if (n <= 0) return null
  const c = lletraColumna(columna)
  return `${nomFullaFormula(fulla)}!$${c}$${primeraFila}:$${c}$${primeraFila + n - 1}`
}

function escapaXml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/** El elemento `<dataValidations>` completo, o cadena vacía si no hay ninguna validación. */
export function xmlValidacions(validacions: readonly ValidacioLlista[], o: OpcionsValidacions): string {
  if (validacions.length === 0) return ''
  if (!(o.primeraFila >= 1 && o.ultimaFila >= o.primeraFila)) throw new Error('files_invalides')
  const items = validacions.map((v) => {
    const c = lletraColumna(v.columna)
    const avis = !v.multiple && !!o.avis
    const attrs = [
      'type="list"',
      'errorStyle="warning"',
      'allowBlank="1"',
      // OJO: `showDropDown="1"` ESCONDE la flecha (el nombre engaña); no se escribe.
      `showErrorMessage="${avis ? 1 : 0}"`,
      ...(avis && o.avisTitol ? [`errorTitle="${escapaXml(o.avisTitol.slice(0, 32))}"`] : []),
      ...(avis ? [`error="${escapaXml(o.avis!.slice(0, 255))}"`] : []),
      `sqref="${c}${o.primeraFila}:${c}${o.ultimaFila}"`,
    ]
    return `<dataValidation ${attrs.join(' ')}><formula1>${escapaXml(v.rang)}</formula1></dataValidation>`
  })
  return `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`
}

/**
 * Elementos de `CT_Worksheet` que van DESPUÉS de `dataValidations` (ECMA-376, parte 1, §18.3.1.99).
 * La validación se inserta justo antes del primero que aparezca; si no hay ninguno, al final.
 */
const DESPRES_DE_VALIDACIONS = [
  'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
  'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing',
  'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst',
] as const

/**
 * Inserta `<dataValidations>` en el XML de una hoja, en su sitio. Falla si la hoja ya tiene uno (no
 * se mezclan: dos serían un fichero inválido) o si no tiene `<sheetData>`.
 */
export function insereixValidacions(sheetXml: string, validacionsXml: string): string {
  if (!validacionsXml) return sheetXml
  if (/<dataValidations[\s>/]/.test(sheetXml)) throw new Error('validacions_ja_existeixen')
  // Lo que viene detrás de los datos: se busca solo ahí, nunca dentro de una celda.
  const tancat = sheetXml.indexOf('</sheetData>')
  const buit = sheetXml.search(/<sheetData\s*\/>/)
  const fiDades = tancat >= 0 ? tancat + '</sheetData>'.length
    : buit >= 0 ? sheetXml.indexOf('>', buit) + 1 : -1
  if (fiDades < 0) throw new Error('sense_sheetData')
  const resta = sheetXml.slice(fiDades)
  let pos = -1
  for (const tag of DESPRES_DE_VALIDACIONS) {
    const m = resta.search(new RegExp(`<${tag}[\\s>/]`))
    if (m >= 0 && (pos < 0 || m < pos)) pos = m
  }
  if (pos < 0) pos = resta.indexOf('</worksheet>')
  if (pos < 0) throw new Error('sense_worksheet')
  return sheetXml.slice(0, fiDades) + resta.slice(0, pos) + validacionsXml + resta.slice(pos)
}

/**
 * La feature de `write-excel-file` que pone los desplegables en la hoja `fullaIndex` (desde 0; por
 * defecto la primera). Se pasa como `writeXlsxFile(fulles, { features: [feature] })`.
 */
export function featureValidacions<F = unknown>(
  validacions: readonly ValidacioLlista[], o: OpcionsValidacions, fullaIndex = 0,
): Feature<F> {
  const xml = xmlValidacions(validacions, o)
  return {
    files: {
      transform: {
        'xl/worksheets/sheet{id}.xml': {
          transform: (contingut, _opcions, { sheetIndex }) =>
            sheetIndex === fullaIndex ? insereixValidacions(contingut, xml) : contingut,
        },
      },
    },
  }
}
