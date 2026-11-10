// El diagnóstico operativo, del lado de la pantalla: qué se pregunta, qué aplica, qué falta,
// cómo se pinta su estado y cómo se lee lo contestado. Puro y sin red, como `procesOferta.ts`.
//
// 🔴 LA GRAMÁTICA DE LAS CONDICIONES ESTÁ AQUÍ **POR SEGUNDA VEZ**, y eso es lo primero que
//    hay que saber de este fichero. La primera vive en SQL (`avaluar_regla`,
//    20270328101400) y es la que manda: decide qué obligatorias faltan y, por tanto, si el
//    diagnóstico está completo. Esta copia existe para una sola cosa que SQL no puede hacer —
//    **ocultar una pregunta mientras se rellena el formulario**, sin una ida y vuelta por
//    cada tecla.
//
//    El precio, y por eso hay test: **divergir no falla, MIENTE**. Si esta copia oculta una
//    pregunta que el servidor considera aplicable, esa pregunta cuenta como obligatoria sin
//    contestar y el diagnóstico no queda nunca completo sin que nada explique cuál falta. Al
//    revés es peor: se enseña una pregunta que no aplica y el documento sale con una
//    respuesta que sobra.
//    `tests/diagnostic.test.ts` recorre los ocho operadores y los casos de borde que SQL
//    declara explícitamente (el `buit` de cuatro formas, el tipo que no cuadra → `false`).
//
// ⚠️ ANTE UN TIPO QUE NO CUADRA, `false`, NUNCA UNA EXCEPCIÓN. Es literalmente lo que dice
//    la cabecera de `avaluar_regla`: una condición mal configurada produce una pregunta de
//    menos, que se ve y se arregla; una excepción dejaría a la organización sin poder
//    rellenar su diagnóstico por un dato de configuración.

import type {
  CondicioPregunta, EstatDiagnostic, OpcioPregunta, OperadorRegla, PreguntaDiagnostic,
  RespostaDiagnostic, TextBilingue, TipusPregunta,
} from '../types'

/** El mapa plano `{pregunta_id: valor}` — lo natural de un formulario y lo que pide la RPC. */
export type Respostes = Record<string, unknown>

// ---------------------------------------------------------------------------
// 1. La gramática de las condiciones (espejo de `avaluar_regla`)
// ---------------------------------------------------------------------------

/**
 * ¿Esto cuenta como «sin contestar»?
 *
 * Las cuatro formas que SQL declara iguales: el null de la base, el null de JSON, la cadena
 * en blanco y el array vacío. En JavaScript hay una quinta, `undefined`, que es lo que
 * devuelve un objeto al que se le pide una clave que no tiene — o sea el caso normal de una
 * pregunta todavía sin tocar.
 */
export function esBuit(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true
  if (typeof valor === 'string') return valor.trim() === ''
  if (Array.isArray(valor)) return valor.length === 0
  // Desde la fase 9 SQL cuenta también el objeto vacío: las respuestas por producto son
  // objetos `{producte: valor}`.
  if (typeof valor === 'object') return Object.keys(valor as object).length === 0
  return false
}

/** Igualdad al nivel del JSON, que es como compara `jsonb`. */
function mateixValor(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== 'object' && typeof b !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** El espejo de `avaluar_regla(operador, valor, resposta)`. Ver la cabecera del fichero. */
export function avaluarCondicio(
  operador: OperadorRegla,
  valor: unknown,
  resposta: unknown,
): boolean {
  if (operador === 'sempre') return true
  if (operador === 'buit') return esBuit(resposta)

  // Sin respuesta no se dispara nada más. Es la diferencia entre «ha dicho que no» y «no ha
  // dicho nada», y confundirlas metería medidas en el plan de quien no contestó.
  if (resposta === null || resposta === undefined) return false

  switch (operador) {
    case '=':
      return mateixValor(resposta, valor)
    case '!=':
      return !mateixValor(resposta, valor)
    case 'in':
      // El array es el de la REGLA: «¿la respuesta es una de estas?»
      return Array.isArray(valor) && valor.some((v) => mateixValor(v, resposta))
    case 'conte':
      // Y aquí al revés, para las preguntas `multi`: «¿la respuesta incluye esto?»
      return Array.isArray(resposta) && resposta.some((v) => mateixValor(v, valor))
    case '>=':
    case '<=': {
      // `jsonb_typeof(...) <> 'number'` → false. Una respuesta numérica que viaja como
      // cadena («5») NO es un número en jsonb, así que tampoco lo es aquí: si se aceptara,
      // la pantalla enseñaría una pregunta que el servidor descarta.
      if (typeof resposta !== 'number' || typeof valor !== 'number') return false
      if (!Number.isFinite(resposta) || !Number.isFinite(valor)) return false
      return operador === '>=' ? resposta >= valor : resposta <= valor
    }
    default:
      return false
  }
}

/** ¿Esta pregunta condicional aplica, dadas las respuestas? Espejo de `pregunta_aplica()`. */
export function preguntaAplica(pregunta: PreguntaDiagnostic, respostes: Respostes): boolean {
  const c: CondicioPregunta | null | undefined = pregunta.aplica_a
  if (!c || typeof c !== 'object' || !c.pregunta) return true
  // Un solo nivel, igual que SQL: si la pregunta padre tampoco aplicaba, su respuesta no
  // está, y cualquier operador que no sea `buit` devuelve false — la hija tampoco aplica,
  // que es el resultado correcto sin necesidad de recursión.
  return avaluarCondicio(c.operador ?? '=', c.valor, respostes[c.pregunta])
}

/**
 * Preguntas cuyas opciones son un SUBCONJUNTO de lo marcado en otra (28-09-2026).
 * «Quins són els principals?» dice «dels que has marcat», pero el motor no sabe construir
 * opciones a partir de otra respuesta (una de las cuatro adaptaciones de la versión 1, §4),
 * así que ofrecía las once familias. Filtrarlo aquí es solo PANTALLA: el servidor sigue
 * aceptando cualquier opción del cuestionario, y por eso no hace falta tocar SQL.
 */
export const OPCIONS_DERIVADES: Readonly<Record<string, string>> = {
  productes_principals: 'productes',
  productes_excedent: 'productes',
}

/**
 * Las opciones que se enseñan de una pregunta. Si deriva de otra que ya tiene respuesta,
 * solo las marcadas allí — más las que esta ya tenga elegidas, para que desmarcar arriba
 * no deje una respuesta escondida que no se puede quitar.
 */
export function opcionsVisibles(pregunta: PreguntaDiagnostic, respostes: Respostes): OpcioPregunta[] {
  const opcions = pregunta.opcions ?? []
  const origen = OPCIONS_DERIVADES[pregunta.id]
  if (!origen) return opcions
  const marcats = respostes[origen]
  if (!Array.isArray(marcats) || marcats.length === 0) return opcions
  const propis = respostes[pregunta.id]
  const triats = Array.isArray(propis) ? propis : []
  return opcions.filter((o) => marcats.includes(o.valor) || triats.includes(o.valor))
}

// ---------------------------------------------------------------------------
// 1bis. Los tipos de la ficha viva (fase 9): productos, por producto, meses, lugares
// ---------------------------------------------------------------------------

/** Lo contestado en una pregunta de lista, como array de cadenas (vacío si nada). */
export function llistaDe(respostes: Respostes, id: string | null | undefined): string[] {
  if (!id) return []
  const v = respostes[id]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Los productos que se ofrecen en una pregunta `productes`.
 *
 * - Con `opcions_de`: lo contestado en esa otra pregunta («els principals, dels que has marcat»).
 * - Con `familia_de`: el catálogo filtrado por las familias contestadas; sin ninguna
 *   contestada, nada (la pantalla pide marcar primero las familias).
 * - Sin ninguna de las dos: el catálogo entero.
 *
 * Siempre se añaden los que ya están marcados, para que desmarcar arriba no deje una
 * respuesta escondida que no se puede quitar (el mismo criterio que `opcionsVisibles`).
 */
export function opcionsProductes(
  pregunta: PreguntaDiagnostic,
  respostes: Respostes,
  cataleg: readonly { nombre: string; familia: string | null }[],
): string[] {
  const triats = llistaDe(respostes, pregunta.id)
  let base: string[]
  if (pregunta.opcions_de) {
    base = llistaDe(respostes, pregunta.opcions_de)
  } else if (pregunta.familia_de) {
    const families = new Set(llistaDe(respostes, pregunta.familia_de))
    base = cataleg.filter((p) => p.familia !== null && families.has(p.familia)).map((p) => p.nombre)
  } else {
    base = cataleg.map((p) => p.nombre)
  }
  const fora = [...base]
  for (const t of triats) if (!fora.includes(t)) fora.push(t)
  return fora
}

/**
 * Quita de las respuestas por producto lo que ya no toca: un producto que ha salido de la
 * lista de la que dependen (`productes_de`), un número vacío o un mes fuera de 1..12. Se
 * aplica al guardar, para que lo impreso no cite un producto que ya no está.
 */
export function netejaRespostes(preguntes: PreguntaDiagnostic[], respostes: Respostes): Respostes {
  const fora: Respostes = { ...respostes }
  for (const p of preguntes) {
    const v = fora[p.id]
    if (v === undefined) continue
    if (p.tipus === 'per_producte_num' || (p.tipus === 'mesos' && p.productes_de)) {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) { delete fora[p.id]; continue }
      const valids = new Set(llistaDe(fora, p.productes_de))
      const net: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (!valids.has(k)) continue
        if (p.tipus === 'per_producte_num') {
          if (typeof x === 'number' && Number.isFinite(x)) net[k] = x
        } else {
          const mesos = mesosValids(x)
          if (mesos.length > 0) net[k] = mesos
        }
      }
      if (Object.keys(net).length === 0) delete fora[p.id]
      else fora[p.id] = net
    } else if (p.tipus === 'mesos') {
      const mesos = mesosValids(v)
      if (mesos.length === 0) delete fora[p.id]
      else fora[p.id] = mesos
    } else if (p.tipus === 'productes' && p.max && Array.isArray(v) && v.length > p.max) {
      fora[p.id] = v.slice(0, p.max)
    }
  }
  return fora
}

/** Los meses válidos de un valor, ordenados y sin repetir. */
export function mesosValids(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const s = new Set<number>()
  for (const m of v) if (typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= 12) s.add(m)
  return [...s].sort((a, b) => a - b)
}

/** Las preguntas visibles ahora mismo, en el orden del cuestionario. */
export function preguntesQueApliquen(
  preguntes: PreguntaDiagnostic[],
  respostes: Respostes,
): PreguntaDiagnostic[] {
  return preguntes.filter((p) => preguntaAplica(p, respostes))
}

/**
 * Los ids de las obligatorias que aplican y siguen sin contestar. Espejo de
 * `diagnostic_falten()`: devuelve los ids y no un booleano porque la pantalla tiene que
 * poder señalar **cuáles**.
 */
export function obligatoriesQueFalten(
  preguntes: PreguntaDiagnostic[],
  respostes: Respostes,
): string[] {
  return preguntes
    .filter((p) => p.obligatoria === true && preguntaAplica(p, respostes) && esBuit(respostes[p.id]))
    .map((p) => p.id)
}

/** Cuánto hay hecho, sobre las que aplican. Solo para el indicador; no decide nada. */
export function progresDiagnostic(
  preguntes: PreguntaDiagnostic[],
  respostes: Respostes,
): { contestades: number; total: number; pct: number } {
  const apliquen = preguntesQueApliquen(preguntes, respostes)
  const contestades = apliquen.filter((p) => !esBuit(respostes[p.id])).length
  const total = apliquen.length
  return { contestades, total, pct: total === 0 ? 0 : Math.round((contestades / total) * 100) }
}

// ---------------------------------------------------------------------------
// 2. Secciones
// ---------------------------------------------------------------------------
// `seccio` es texto libre dentro del jsonb del cuestionario. Por eso una sección desconocida
// se pinta con su texto crudo en vez de con su identificador i18n: el día que la Fundación
// publique su anexo B puede traer secciones que aquí nadie ha previsto, y eso no puede
// dejar un título ilegible en la pantalla.

export const SECCIONS_CONEGUDES: readonly string[] = [
  // Las de la versión 0 (siguen haciendo falta: los diagnósticos ya hechos las citan)…
  'planificacio', 'collita', 'conservacio', 'canalitzacio', 'seguiment',
  // …las cuatro de la versión 1 del productor (20270403100000), las de la revisión…
  'produccio', 'generacio', 'gestio', 'necessitats',
  // …y las de la versión 2, el «Diagnòstic operatiu» (fase 9, 20270423100000).
  'productes', 'temporalitat', 'excedents', 'previsio', 'gestio_actual', 'causes', 'sortides', 'ubicacio',
  'logistica', 'relacio',
] as const

/** La clave i18n de una sección, o `null` si no la conocemos (entonces se pinta tal cual). */
export function clauSeccio(seccio: string): string | null {
  return SECCIONS_CONEGUDES.includes(seccio) ? `diag.sec_${seccio}` : null
}

export interface SeccioDiagnostic {
  seccio: string
  /** Clave i18n del título, o `null` si la sección no es una de las conocidas. */
  clau: string | null
  preguntes: PreguntaDiagnostic[]
}

/**
 * Las preguntas que aplican, agrupadas por sección y **en el orden en que la sección
 * aparece por primera vez**, no en el de `SECCIONS_CONEGUDES`.
 *
 * ⚠️ Es deliberado: el cuestionario es un array ordenado y quien lo redacta decide ese
 *    orden. Reordenar por una lista nuestra haría que publicar una versión nueva no
 *    cambiara lo que se ve, que es justo lo contrario de tener el texto en la base.
 */
export function agrupaPerSeccio(
  preguntes: PreguntaDiagnostic[],
  respostes: Respostes,
): SeccioDiagnostic[] {
  const fora: SeccioDiagnostic[] = []
  const index = new Map<string, SeccioDiagnostic>()
  for (const p of preguntesQueApliquen(preguntes, respostes)) {
    const seccio = p.seccio || 'altres'
    let grup = index.get(seccio)
    if (!grup) {
      grup = { seccio, clau: clauSeccio(seccio), preguntes: [] }
      index.set(seccio, grup)
      fora.push(grup)
    }
    grup.preguntes.push(p)
  }
  return fora
}

/** El `id` del título de una sección del formulario: el destino de su chip. */
export function idSeccio(seccio: string): string {
  return `diag-sec-${seccio}`
}

/** Una sección con su estado, para los chips de navegación del formulario (T3). */
export interface EstatSeccio {
  seccio: string
  /** Clave i18n del título, o `null` si la sección no es una de las conocidas. */
  clau: string | null
  /** Preguntas que aplican en la sección */
  n: number
  /** Cuántas de ellas tienen respuesta */
  contestades: number
  /** Obligatorias que aplican y siguen sin contestar */
  falten: number
  /** Sin obligatorias pendientes y con algo contestado: el punto del chip va lleno */
  completa: boolean
}

/**
 * El estado de cada sección, en el mismo orden que `agrupaPerSeccio()` (que ya trae solo las
 * preguntas que aplican).
 *
 * ⚠️ «Completa» exige ALGO contestado, no solo cero obligatorias pendientes: una sección de
 *    preguntas opcionales sin tocar no está hecha, está sin empezar, y un punto lleno ahí
 *    diría lo contrario.
 */
export function seccionsAmbEstat(seccions: SeccioDiagnostic[], respostes: Respostes): EstatSeccio[] {
  return seccions.map((s) => {
    const contestades = s.preguntes.filter((p) => !esBuit(respostes[p.id])).length
    const falten = s.preguntes.filter((p) => p.obligatoria === true && esBuit(respostes[p.id])).length
    return {
      seccio: s.seccio,
      clau: s.clau,
      n: s.preguntes.length,
      contestades,
      falten,
      completa: falten === 0 && contestades > 0,
    }
  })
}

// ---------------------------------------------------------------------------
// 3. Prefill: proponer, nunca decidir
// ---------------------------------------------------------------------------
// `prefill` es `"<taula>.<columna>"` y **el servidor no lo lee nunca**: si lo leyera, el
// diagnóstico contendría algo que la persona no ha dicho (20270328101600 §prefill).
//
// 🔴 LA REGLA DE ESTA FUNCIÓN: solo se propone un valor que la pregunta pueda aceptar de
//    verdad. Cuatro de los cinco `prefill` sembrados NO se pueden mapear —
//    `productores.productos_habituales` es una lista de nombres de producto («Poma») y las
//    opciones son familias (`fruita_dolca`); `entidades.productes_frescos` es un booleano y
//    la pregunta es de selección múltiple— y ahí lo correcto es **no proponer nada**.
//    Inventar la correspondencia produciría una respuesta plausible y falsa dentro de un
//    documento que se emite con el sello de la Fundación.

/** Los valores válidos de una `opcio`/`multi`. Vacío si la pregunta no tiene opciones. */
function valorsOpcio(pregunta: PreguntaDiagnostic): string[] {
  return (pregunta.opcions ?? []).map((o) => o.valor)
}

/** El valor que se puede proponer para esta pregunta, o `undefined` si ninguno. */
export function prefillPregunta(pregunta: PreguntaDiagnostic, brut: unknown): unknown {
  if (esBuit(brut)) return undefined

  const tipus: TipusPregunta = pregunta.tipus
  if (tipus === 'boolea') return typeof brut === 'boolean' ? brut : undefined
  if (tipus === 'numero') {
    if (typeof brut === 'number' && Number.isFinite(brut)) return brut
    // Una columna numérica de Postgres puede llegar como cadena (`numeric` lo hace).
    if (typeof brut === 'string' && brut.trim() !== '' && Number.isFinite(Number(brut))) {
      return Number(brut)
    }
    return undefined
  }
  if (tipus === 'text') return typeof brut === 'string' ? brut : undefined
  // `productes`: la ficha guarda nombres del catálogo (`productos_habituales`), que es
  // justo lo que esta pregunta contesta. Solo cadenas no vacías.
  if (tipus === 'productes') {
    if (!Array.isArray(brut)) return undefined
    const noms = brut.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    return noms.length > 0 ? noms : undefined
  }
  if (tipus === 'per_producte_num' || tipus === 'mesos' || tipus === 'ubicacio') return undefined

  const valids = valorsOpcio(pregunta)
  if (valids.length === 0) return undefined
  if (tipus === 'opcio') {
    return typeof brut === 'string' && valids.includes(brut) ? brut : undefined
  }
  // `multi`: se quedan solo los que existen como opción. Si no queda ninguno, no se propone
  // nada — una lista vaciada por el filtro no es una respuesta, es un descarte.
  if (!Array.isArray(brut)) return undefined
  const triats = brut.filter((v): v is string => typeof v === 'string' && valids.includes(v))
  return triats.length > 0 ? triats : undefined
}

/**
 * Lo que se puede proponer desde la ficha de la organización. Devuelve **solo** las
 * preguntas con propuesta: quien llama decide qué hacer con ellas y qué marcar como
 * «proposat», que es lo que impide que pase por una respuesta dada.
 */
export function prefillDesDeFitxa(
  preguntes: PreguntaDiagnostic[],
  fitxa: Record<string, unknown> | null,
): Respostes {
  if (!fitxa) return {}
  const fora: Respostes = {}
  for (const p of preguntes) {
    if (!p.prefill) continue
    const columna = p.prefill.includes('.') ? p.prefill.split('.').slice(1).join('.') : p.prefill
    const valor = prefillPregunta(p, fitxa[columna])
    if (valor !== undefined) fora[p.id] = valor
  }
  return fora
}

// ---------------------------------------------------------------------------
// 4. El estado
// ---------------------------------------------------------------------------
// Desde A1 (`20270520100000`) solo hay cuatro: el plan básico y sus `a_punt`/`emes` se
// retiraron de la pantalla (el plan es el expediente). El estado lo calcula SIEMPRE el
// servidor (`diagnostic_estat`, `diagnostics_equip`); aquí solo se pinta.

/** El badge de estado. Mismo criterio que el resto: `aviso` = a medias, `exito` = hecho. */
export function estilEstatDiagnostic(estat: EstatDiagnostic): string {
  switch (estat) {
    case 'complet': return 'bg-exito-fondo text-exito'
    case 'incomplet': return 'bg-aviso-fondo text-aviso'
    case 'sense_comencar': return 'bg-secondary text-secondary-foreground'
    default: return 'bg-muted text-muted-foreground'
  }
}

/** Los cuatro estados, para los filtros del listado del equipo. */
export const ESTATS_DIAGNOSTIC: readonly EstatDiagnostic[] = [
  'sense_comencar', 'incomplet', 'complet', 'sense_questionari',
] as const

// ---------------------------------------------------------------------------
// 5. Textos bilingües
// ---------------------------------------------------------------------------

/**
 * El texto de una etiqueta del cuestionario en el idioma de la interfaz.
 *
 * ⚠️ Cae al catalán y no a la clave: `questionari_problemes()` exige las dos lenguas al
 *    publicar, así que un hueco aquí solo puede venir de una fila sembrada antes de ese
 *    CHECK. Enseñar el catalán es peor que enseñar el castellano y mucho mejor que enseñar
 *    un hueco en medio de un formulario.
 */
export function textBilingue(text: TextBilingue | null | undefined, lang: 'ca' | 'es'): string {
  if (!text) return ''
  return text[lang] || text.ca || text.es || ''
}

// ---------------------------------------------------------------------------
// 6. El resumen (lectura)
// ---------------------------------------------------------------------------

/**
 * Lo que se enseña como respuesta en el resumen, a partir del sobre que compone el servidor.
 *
 * Mismo criterio que el PDF (`respuestaLegible` de `_shared/pdf/render/pla.ts`): primero las
 * etiquetas —el texto que la persona vio y eligió—; `valor` solo cuando no hay ninguna (un
 * número, un texto libre). Enseñar `valor` habiendo etiqueta pondría el código interno
 * (`mes_20000`) en la pantalla. Devuelve `''` si no hay nada que decir: quien pinta decide el
 * guion.
 */
export function respostaLlegible(r: Pick<RespostaDiagnostic, 'valor' | 'etiqueta' | 'etiquetes'>, lang: 'ca' | 'es'): string {
  if (Array.isArray(r.etiquetes)) {
    const parts = r.etiquetes.map((e) => textBilingue(e, lang).trim()).filter((x) => x !== '')
    if (parts.length > 0) return parts.join(', ')
  }
  const etiqueta = textBilingue(r.etiqueta ?? null, lang).trim()
  if (etiqueta !== '') return etiqueta
  return valorLlegible(r.valor, lang)
}

/** Un valor crudo como texto: el espejo de `valorLegible` del PDF. */
function valorLlegible(valor: unknown, lang: 'ca' | 'es'): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return ''
    return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'ca-ES', { maximumFractionDigits: 2 }).format(valor)
  }
  if (typeof valor === 'string') return valor.trim()
  if (Array.isArray(valor)) {
    return valor.map((v) => valorLlegible(v, lang)).filter((x) => x !== '').join(', ')
  }
  if (typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>)
      .map(([k, v]) => [k, valorLlegible(v, lang)] as const)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ')
  }
  return String(valor)
}

/** Una sección del resumen: sus respuestas, en el orden en que llegan del servidor. */
export interface SeccioResum {
  seccio: string
  clau: string | null
  respostes: RespostaDiagnostic[]
}

/**
 * Las respuestas del sobre agrupadas por sección, en el orden en que aparece cada sección
 * (el del cuestionario: el servidor las compone en ese orden). Mismo criterio que
 * `agrupaPerSeccio()`.
 */
export function agrupaRespostes(respostes: RespostaDiagnostic[]): SeccioResum[] {
  const fora: SeccioResum[] = []
  const index = new Map<string, SeccioResum>()
  for (const r of respostes) {
    if (!r || typeof r !== 'object') continue
    const seccio = r.seccio || 'altres'
    let grup = index.get(seccio)
    if (!grup) {
      grup = { seccio, clau: clauSeccio(seccio), respostes: [] }
      index.set(seccio, grup)
      fora.push(grup)
    }
    grup.respostes.push(r)
  }
  return fora
}
