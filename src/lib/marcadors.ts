// Rellenar los `{{marcadors}}` del convenio con lo que la persona va escribiendo.
//
// POR QUÉ EXISTE (16-09-2026). El texto que compone el servidor lleva los marcadores sin
// resolver —`{{organitzacio.nif}}`, `{{firmant.nombre}}`, `{{numero}}`…— porque esos datos
// **no existen todavía**: los teclea quien firma, y el número se asigna al firmar. Así que
// en pantalla se leía «D'una banda… amb NIF {{organitzacio.nif}} i domicili a
// {{organitzacio.domicili}}», que para quien va a firmar un documento legal parece un error
// del sistema. El cliente lo dijo así: «aparecen unas llaves que quizás deberían rellenarse
// en el momento en que haces el formulario, o que se vayan rellenando de forma automática».
//
// 🔴 ESTO ES SOLO PARA MIRAR, Y ESA DISTINCIÓN ES TODO EL ASUNTO. Lo que se firma —y lo que
//    viaja de vuelta como `sha256_texto`— es el texto **con los marcadores puestos**, tal y
//    como lo compuso el servidor, y esta función NO lo toca: recibe una copia y devuelve
//    otra. Sustituir lo que se envía rompería la comprobación del POST
//    (`409 document_canviat`), que existe precisamente para que nadie pueda firmar un texto
//    distinto del que el servidor emitió.
//
// ⚠️ Y no es una laxitud del modelo, es su diseño: la huella cubre **el articulado y las dos
//    declaraciones, no los datos que la persona teclea** (AGENTS §9). Si los cubriera,
//    cambiaría con cada tecla y el guardián dejaría de distinguir un cambio real. Lo
//    tecleado se congela aparte, en `evidencias.payload` y en `convenios.datos_org`.
//
// ⚠️ LO QUE SE VE AQUÍ ES LO QUE SALDRÁ EN EL PDF, que es el motivo de hacerlo: el
//    renderizador resuelve estos mismos marcadores con estos mismos datos. Si algún día las
//    dos listas se separan, lo que la persona lea antes de firmar dejará de ser lo que firma.

/** Lo que no se sabe todavía se dibuja así: se lee como un hueco, no como un fallo. */
export const BUIT = '__________'

/**
 * Sustituye `{{clau}}` por su valor. Las claves que no se conocen —o que llegan vacías—
 * quedan como un hueco visible; **nunca se dejan las llaves**, que es lo que se veía como
 * un error.
 *
 * Tolera espacios dentro de las llaves (`{{ nif }}`) porque el texto lo escribe una
 * persona en la pantalla de plantillas, no un programa.
 */
export function omplirMarcadors(text: string, valors: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, clau: string) => {
    const v = valors[clau]
    return v !== undefined && v.trim() !== '' ? v.trim() : BUIT
  })
}

/**
 * El diccionario, a partir de lo que hay en el formulario.
 *
 * ⚠️ LAS CLAVES MEZCLAN CATALÁN Y CASTELLANO (`firmant.nombre`, `firmant.cargo`) y no es un
 *    descuido de aquí: son las que trae el texto sembrado en `plantillas_documento`. Se
 *    aceptan **las dos formas** de cada una en vez de «arreglar» la plantilla, porque
 *    editar una plantilla que ya ha emitido algo está prohibido por trigger (§4) y porque
 *    una plantilla nueva podría usar cualquiera de las dos.
 */
export function marcadorsDelFormulari(
  // `Readonly<Record<...>>` y no el tipo concreto de la ficha: esta función no sabe ni
  // tiene por qué saber qué campos existen, solo los recorre. Así, añadir un campo al
  // convenio no obliga a tocar esto.
  org: Readonly<Record<string, string>>,
  firmantNom: string,
  firmantCarrec: string,
): Record<string, string> {
  const d: Record<string, string> = {}
  for (const [k, v] of Object.entries(org)) {
    d[`organitzacio.${k}`] = v
    d[`organizacion.${k}`] = v
  }
  d['firmant.nombre'] = firmantNom
  d['firmant.nom'] = firmantNom
  d['firmante.nombre'] = firmantNom
  d['firmant.cargo'] = firmantCarrec
  d['firmant.carrec'] = firmantCarrec
  d['firmante.cargo'] = firmantCarrec
  // `numero` y `ejercici` se asignan AL FIRMAR (`siguiente_numero`, dentro de la misma
  // transacción): antes de eso no existen y no se pueden adivinar. Se dejan como hueco a
  // propósito — inventar un número en un documento legal es peor que no ponerlo.
  return d
}
