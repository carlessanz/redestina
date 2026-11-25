// Las notas internas del CRM mínimo (plan 1, rebanada 1F, D4): el vocabulario y los cálculos
// de la pantalla, sin React ni Supabase (prueba en `tests/notesInternes.test.ts`).
//
// La tabla es `notes_internes` (20270502100000): solo la lee el equipo, se escribe por
// `afegir_nota_interna()` y se borra por `esborrar_nota_interna()` (super_admin). 🔴 Las notas
// nunca salen por ningún canal (AGENTS §8).
//
// Proceso 1.2 («Interaccions i seguiment», 20270616100000): la interacción gana el tipo
// `prospeccio`, el RESULTADO del próximo paso (se escribe al darlo por hecho) y una PREVISIÓN de
// producto (producto, kg y fecha, los tres o ninguno; lugar opcional). Las mismas filas las lee la
// ficha y la sección global `/equip/interaccions`.

/** El CHECK de `notes_internes.canal`, en el orden del desplegable. */
export const CANALS_NOTA = ['telefon', 'whatsapp', 'email', 'visita', 'reunio', 'altres'] as const
export type CanalNota = (typeof CANALS_NOTA)[number]

/**
 * Los tipos que se OFRECEN al crear una interacción (proceso 1.2, 20270616100000), en el orden
 * del desplegable. `seguiment` (de 1F/1.5) sigue en la base como valor heredado: se lee y se
 * rotula, pero ya no se ofrece.
 */
export const TIPUS_NOTA = ['prospeccio', 'captacio', 'operativa', 'incidencia', 'documentacio', 'altres'] as const
export type TipusNota = (typeof TIPUS_NOTA)[number]

/** Todo lo que puede venir en `notes_internes.tipus` (lo que se pinta y se filtra). */
export const TIPUS_NOTA_LLEGITS = [...TIPUS_NOTA, 'seguiment'] as const
export type TipusNotaLlegit = (typeof TIPUS_NOTA_LLEGITS)[number]

/** El tipo con el que abre el formulario (el valor por defecto de la RPC). */
export const TIPUS_PER_DEFECTE: TipusNota = 'operativa'

/** El tope de la RPC (`nota_massa_llarga`). */
export const MAX_TEXT_NOTA = 2000

/** El tope de la próxima acción (`propera_accio_massa_llarga`). */
export const MAX_ACCIO = 500

/** El tope del resultado de un seguimiento hecho (`resultat_massa_llarg`, 20270616100000). */
export const MAX_RESULTAT = 1000

/** El tope del lugar de una previsión en texto libre (`previsio_ubicacio_massa_llarga`). */
export const MAX_PREVISIO_UBICACIO = 200

/**
 * Cómo va un seguimiento (la próxima acción de una nota): `fet` si se dio por hecho, y si no,
 * `vencut` (la fecha ya pasó), `avui` o `previst`. Por días de calendario: `data` y `avui` son
 * `AAAA-MM-DD`, que se comparan como texto.
 */
export function estatSeguiment(data: string, avui: string, fet: boolean): 'fet' | 'vencut' | 'avui' | 'previst' {
  if (fet) return 'fet'
  if (data < avui) return 'vencut'
  return data === avui ? 'avui' : 'previst'
}

/**
 * La próxima acción que se manda con la nota: las dos cosas o ninguna (la RPC rechaza una sin
 * la otra). `null` = sin seguimiento; `'incompleta'` = falta una de las dos.
 */
export function seguimentPerEnviar(accio: string, data: string): { accio: string; data: string } | null | 'incompleta' {
  const a = accio.trim()
  if (!a && !data) return null
  if (!a || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'incompleta'
  return { accio: a, data }
}

/**
 * «Fa 3 dies»: la clave i18n y el número, por días de calendario LOCALES (una nota de ayer a
 * las 23:00 es «ahir» aunque solo hayan pasado dos horas). Una fecha futura —el reloj del
 * navegador adelantado— cuenta como hoy.
 */
export function faTemps(iso: string, ara: Date = new Date()): { clau: string; n: number } {
  const d = new Date(iso)
  const dia = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())
  const dies = Math.max(0, Math.round((dia(ara) - dia(d)) / 86_400_000))
  if (dies === 0) return { clau: 'ni.avui', n: 0 }
  if (dies === 1) return { clau: 'ni.ahir', n: 1 }
  if (dies < 31) return { clau: 'ni.fa_dies', n: dies }
  if (dies < 365) return { clau: 'ni.fa_mesos', n: Math.floor(dies / 30) }
  return { clau: 'ni.fa_anys', n: Math.floor(dies / 365) }
}

/**
 * Lo que se manda como `p_data` desde el campo de fecha (`AAAA-MM-DD`, hoy por defecto).
 * Hoy → `undefined`: la RPC pone `now()` y dos notas del mismo día quedan en el orden en que
 * se escribieron. Otro día → ese día a las 12:00 locales (lejos de los cambios de día por
 * zona horaria). Una fecha mal formada también cae a `now()`.
 */
export function dataPerEnviar(dia: string, avui: string): string | undefined {
  if (!dia || dia === avui || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return undefined
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(a, m - 1, d, 12, 0, 0).toISOString()
}

/** El texto se puede enviar: no vacío y dentro del tope. */
export function textValid(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && t.length <= MAX_TEXT_NOTA
}

/** ¿Es un tipo que la base conoce? (los seis de ahora más el heredado). */
export function esTipusNota(v: unknown): v is TipusNotaLlegit {
  return typeof v === 'string' && (TIPUS_NOTA_LLEGITS as readonly string[]).includes(v)
}

/** Lo que se escribe en el bloque «Previsió de producte» del formulario. */
export interface PrevisioEscrita {
  producte: string
  /** Tal cual del campo: admite coma decimal («12,5»). */
  kg: string
  /** `AAAA-MM-DD` o ''. */
  data: string
  /** Un lugar de la ficha (su id) o '' si no se ha elegido ninguno. */
  ubicacioId: string
  /** El lugar en texto libre («el camp de dalt»), cuando no es uno de la ficha. */
  ubicacioText: string
}

/** Los argumentos de previsión de `afegir_nota_interna()`. */
export interface ArgsPrevisio {
  p_previsio_producte: string
  p_previsio_kg: number
  p_previsio_data: string
  p_previsio_ubicacio_id?: string
  p_previsio_ubicacio?: string
}

/** Por qué no se puede mandar la previsión (clave i18n del aviso). */
export type ErrorPrevisio = 'incompleta' | 'kg' | 'ubicacio_llarga'

/** Kilos de un campo de texto: «12,5» → 12.5; vacío o no numérico → null. */
export function kgDeText(s: string): number | null {
  const net = s.trim().replace(',', '.')
  if (!net || !/^\d+(\.\d+)?$/.test(net)) return null
  const n = Number(net)
  return Number.isFinite(n) ? n : null
}

/**
 * La previsión que se manda con la interacción, con las reglas de la base (CHECK
 * `notes_internes_previsio_check` y `afegir_nota_interna()`):
 *   · nada escrito → `null` (sin previsión);
 *   · producto, kg y fecha, los tres o ninguno; un lugar sin los otros tres tampoco vale
 *     → `'incompleta'`;
 *   · kg > 0 → si no, `'kg'`;
 *   · el texto libre del lugar, ≤ 200 → si no, `'ubicacio_llarga'`.
 * Si hay un lugar de la ficha elegido, el texto libre no se manda (uno u otro).
 */
export function previsioPerEnviar(p: PrevisioEscrita): ArgsPrevisio | null | ErrorPrevisio {
  const producte = p.producte.trim()
  const kgText = p.kg.trim()
  const data = p.data.trim()
  const lloc = p.ubicacioText.trim()
  const ubicacioId = p.ubicacioId.trim()
  if (!producte && !kgText && !data && !lloc && !ubicacioId) return null
  if (!producte || !kgText || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'incompleta'
  const kg = kgDeText(kgText)
  if (kg === null || kg <= 0) return 'kg'
  if (!ubicacioId && lloc.length > MAX_PREVISIO_UBICACIO) return 'ubicacio_llarga'
  return {
    p_previsio_producte: producte,
    p_previsio_kg: kg,
    p_previsio_data: data,
    ...(ubicacioId ? { p_previsio_ubicacio_id: ubicacioId } : lloc ? { p_previsio_ubicacio: lloc } : {}),
  }
}

/** El resultado se puede mandar: vacío (sin resultado) o dentro del tope. */
export function resultatValid(text: string): boolean {
  return text.trim().length <= MAX_RESULTAT
}
