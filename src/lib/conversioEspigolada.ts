// Los rechazos de convertir una oferta «producte al camp» en espigolada (F3), traducidos.
//
// `crear_espigolada(..., p_excedente => …)` se niega con SQLSTATE `22023` y el CÓDIGO al
// principio del mensaje, seguido de `: ` y de la frase en catalán — el mismo formato que
// `bloqueig_esborrat` (§4, deuda 108).
//
// POR QUÉ AQUÍ NO SE ENSEÑA EL MENSAJE DE LA BASE, al revés que en todo `albarans.ts`. Allí
// la frase de Postgres es lo más útil que hay («Encara no ha vencut el termini de
// confirmació»): dice exactamente qué regla se ha incumplido. Estos siete son distintos por
// dos motivos. Uno, van **siempre en catalán**, y quien convierte una oferta puede estar
// trabajando en castellano. Dos, dicen qué pasa pero no qué hacer, y lo que hace falta saber
// es si la oferta se puede recuperar o si hay que mirar otra cosa.
//
// ⚠️ ESTE MÓDULO ES PURO Y ESTÁ SEPARADO DE `albarans.ts` A PROPÓSITO: aquel importa el
//    cliente de Supabase, y un fichero que lo importe **no se puede cargar desde Vitest**
//    (`createClient` revienta al construir el `RealtimeClient` en Node). Las claves
//    `conv_esp.err_*` se componen, así que `cobertura.test.ts` tampoco las ve: sin esta
//    separación no habría ninguna red que dijera que existen en los dos idiomas.

/**
 * Los siete rechazos de la conversión, con el nombre exacto que usa
 * `20260921221806_producte_al_camp.sql`.
 *
 * Están ordenados como las guardas de la RPC, que es el orden en que se pueden dar.
 */
export const MOTIUS_CONVERSIO = [
  'oferta_inexistent',
  'productor_no_coincideix',
  'sense_producte_al_camp',
  'ja_es_espigolada',
  'ja_te_canalitzacions',
  'ja_te_albarans',
  'massa_linies',
] as const

export type MotiuConversio = (typeof MOTIUS_CONVERSIO)[number]

/**
 * La clave i18n del rechazo que trae este mensaje, o `null` si no trae ninguno.
 *
 * `null` no es un fallo: significa «esto no es uno de los siete», y entonces manda el
 * contrato de siempre —se enseña lo que dijo la base—. Fingir un motivo conocido ante un
 * error de permisos o de red sería peor que no traducir nada.
 *
 * ⚠️ Se busca `<codi>:` con los dos puntos, no el código suelto: sin ellos,
 * `sense_producte_al_camp` casaría dentro de cualquier frase que lo nombrara de pasada.
 */
export function motiuConversio(missatge: string): string | null {
  const codi = MOTIUS_CONVERSIO.find((c) => missatge.includes(`${c}:`))
  return codi ? `conv_esp.err_${codi}` : null
}
