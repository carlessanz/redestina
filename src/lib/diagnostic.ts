// El diagnóstico de prevención, del lado de la pantalla: qué se pregunta, qué aplica, qué
// falta y en qué punto está. Puro y sin red, como `procesOferta.ts` y `priorizacion.ts`.
//
// 🔴 LA GRAMÁTICA DE LAS CONDICIONES ESTÁ AQUÍ **POR SEGUNDA VEZ**, y eso es lo primero que
//    hay que saber de este fichero. La primera vive en SQL (`avaluar_regla`,
//    20270328101400) y es la que manda: decide qué medidas entran en el plan y qué
//    obligatorias faltan. Esta copia existe para una sola cosa que SQL no puede hacer —
//    **ocultar una pregunta mientras se rellena el formulario**, sin una ida y vuelta por
//    cada tecla.
//
//    El precio, y por eso hay test: **divergir no falla, MIENTE**. Si esta copia oculta una
//    pregunta que el servidor considera aplicable, esa pregunta cuenta como obligatoria sin
//    contestar y el plan no se genera nunca; la pantalla diría «ja està» y el botón de
//    emitir respondería `falten_obligatories` sin que nada explicara cuál. Al revés es peor:
//    se enseña una pregunta que no aplica y el plan sale con una respuesta que sobra.
//    `tests/diagnostic.test.ts` recorre los ocho operadores y los casos de borde que SQL
//    declara explícitamente (el `buit` de cuatro formas, el tipo que no cuadra → `false`).
//
// ⚠️ ANTE UN TIPO QUE NO CUADRA, `false`, NUNCA UNA EXCEPCIÓN. Es literalmente lo que dice
//    la cabecera de `avaluar_regla`: una condición mal configurada produce una pregunta de
//    menos, que se ve y se arregla; una excepción dejaría a la organización sin poder
//    rellenar su diagnóstico por un dato de configuración.

import type {
  BlocMesura, CondicioPregunta, MesuraPla, OpcioPregunta, OperadorRegla, PreguntaDiagnostic,
  TextBilingue, TipusPregunta,
} from '../types'
import type { PuntProces } from './procesOferta'

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
// 2. Secciones y bloques
// ---------------------------------------------------------------------------
// Los dos vocabularios son el mismo por diseño —la sección de una pregunta y el bloque de
// una medida se llaman igual— pero NO son la misma columna: `seccio` es texto libre dentro
// del jsonb del cuestionario y `bloc` tiene un CHECK. Por eso una sección desconocida se
// pinta con su texto crudo en vez de con su identificador i18n: el día que la Fundación
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

export const BLOCS_MESURA: readonly BlocMesura[] = [
  'planificacio', 'collita', 'conservacio', 'canalitzacio', 'seguiment',
] as const

/** La clave i18n de una sección, o `null` si no la conocemos (entonces se pinta tal cual). */
export function clauSeccio(seccio: string): string | null {
  return SECCIONS_CONEGUDES.includes(seccio) ? `diag.sec_${seccio}` : null
}

export function clauBloc(bloc: BlocMesura): string {
  return `diag.bloc_${bloc}`
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

export interface GrupMesures {
  bloc: BlocMesura
  clau: string
  mesures: MesuraPla[]
}

/** Las medidas del plan por bloque, en el orden de `BLOCS_MESURA` y sin bloques vacíos. */
export function mesuresPerBloc(llista: MesuraPla[]): GrupMesures[] {
  return BLOCS_MESURA
    .map((bloc) => ({
      bloc,
      clau: clauBloc(bloc),
      mesures: llista.filter((m) => m.bloc === bloc),
    }))
    .filter((g) => g.mesures.length > 0)
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
// 4. El punto del proceso
// ---------------------------------------------------------------------------
// Mismo contrato que `procesOferta.ts`: de los estados reales a «etapa + què passa + què
// toca + qui», en CLAVES i18n, para que las tres pantallas cuenten lo mismo y el test pueda
// exigir que existan en los dos idiomas (las claves se componen; `cobertura.test.ts` solo
// ve literales).

/**
 * Las etapas del diagnóstico, en orden.
 *
 * 🔴 Desde la fase 9 (revisión del 08-10-2026) la ORGANIZACIÓN solo recorre las tres
 *    primeras: el diagnóstico es una ficha viva y ya no genera un plan. `a_punt` y `emes`
 *    son del equipo, que prepara el plan de prevención cuando es un servicio contratado.
 */
export type EtapaDiagnostic = 'comencar' | 'responent' | 'complet' | 'a_punt' | 'emes'

export const ETAPES_DIAGNOSTIC_ORG: readonly EtapaDiagnostic[] = [
  'comencar', 'responent', 'complet',
] as const

export const ETAPES_DIAGNOSTIC: readonly EtapaDiagnostic[] = [
  'comencar', 'responent', 'complet', 'a_punt', 'emes',
] as const

/** Los pasos que se pintan, según quién mira. */
export function passosDiagnostic(rol: RolDiagnostic): string[] {
  return (rol === 'org' ? ETAPES_DIAGNOSTIC_ORG : ETAPES_DIAGNOSTIC).map((e) => `diag.pas_${e}`)
}

/** Todas las claves de paso (para el test). */
export const PASSOS_DIAGNOSTIC_CLAUS: readonly string[] =
  ETAPES_DIAGNOSTIC.map((e) => `diag.pas_${e}`)

/** Quién mira: la propia organización (segunda persona) o el equipo (tercera). */
export type RolDiagnostic = 'org' | 'equip'

/**
 * Como `PuntProces` pero con el vocabulario de etapas de este módulo.
 *
 * ⚠️ No se amplía `EtapaProces` (que es una unión cerrada a propósito, §procesOferta): eso
 *    obligaría a tocar un módulo compartido para meterle estados de otra máquina. Lo que se
 *    hizo en su lugar fue estrechar lo que `QueTocaAra` PIDE (`PuntPintable`, sin `etapa`),
 *    que es lo que de verdad lee. Así las dos máquinas se pintan con el mismo componente y
 *    ninguna tiene que fingir ser la otra.
 */
export type PuntDiagnostic = Omit<PuntProces, 'etapa'> & { etapa: EtapaDiagnostic | 'sense_questionari' }

/** Lo mínimo que hace falta saber. Es un subconjunto de `DiagnosticEstat` a propósito:
 *  así la fila del listado del equipo (`DiagnosticEquip`) también sirve. */
export interface FetsDiagnostic {
  estat: 'sense_questionari' | 'sense_comencar' | 'incomplet' | 'complet' | 'a_punt' | 'emes'
  faltenN: number
  mesuresN: number
  numero?: string | null
  provisional?: boolean
}

function claus(prefix: string): PuntProces['claus'] {
  return { titol: `${prefix}_t`, passa: `${prefix}_passa`, toca: `${prefix}_toca`, qui: `${prefix}_qui` }
}

/**
 * En qué punto está el diagnóstico de una organización y qué toca hacer.
 *
 * ⚠️ `sense_questionari` NO es culpa de nadie que mire esta pantalla: significa que no hay
 *    cuestionario vigente para ese tipo de organización, o sea un problema de
 *    configuración. Por eso sale como salida del camino y **nunca** en `aviso`: pintarlo en
 *    ámbar le diría a la organización que le toca algo que no puede hacer.
 */
export function puntDiagnostic(fets: FetsDiagnostic, rol: RolDiagnostic): PuntDiagnostic {
  const p = rol === 'org' ? 'o' : 'e'
  const vars = {
    n: fets.faltenN,
    m: fets.mesuresN,
    numero: fets.numero ?? '—',
  }

  const fes = (
    etapa: PuntDiagnostic['etapa'],
    index: number,
    emToca: boolean,
    enllac?: string,
  ): PuntDiagnostic => ({
    etapa,
    index,
    variant: null,
    claus: claus(`diag.${p}_${etapa}`),
    vars,
    emToca,
    enllac,
  })

  if (fets.estat === 'sense_questionari') return fes('sense_questionari', -1, false)
  if (fets.estat === 'sense_comencar') return fes('comencar', 0, true)
  if (fets.estat === 'incomplet') return fes('responent', 1, true)
  // Para la organización, contestado es el final: lo que pase con un plan es del equipo.
  if (rol === 'org') return fes('complet', 2, false)
  if (fets.estat === 'emes') return fes('emes', 4, false)
  if (fets.estat === 'a_punt') return fes('a_punt', 3, true)
  // `complet` visto por el equipo: no le toca nada salvo que la organización haya
  // contratado el plan de prevención.
  return fes('complet', 2, false)
}

/** El estado que se enseña a la ORGANIZACIÓN: los del plan son, para ella, «contestat». */
export function estatPerOrganitzacio(estat: FetsDiagnostic['estat']): FetsDiagnostic['estat'] {
  return estat === 'a_punt' || estat === 'emes' ? 'complet' : estat
}

/** El badge de estado. Mismo criterio que el resto: `aviso` = te toca, `exito` = hecho. */
export function estilEstatDiagnostic(estat: FetsDiagnostic['estat']): string {
  switch (estat) {
    case 'emes': return 'bg-exito-fondo text-exito'
    case 'complet': return 'bg-exito-fondo text-exito'
    case 'a_punt': return 'bg-aviso-fondo text-aviso'
    case 'incomplet': return 'bg-aviso-fondo text-aviso'
    case 'sense_comencar': return 'bg-secondary text-secondary-foreground'
    default: return 'bg-muted text-muted-foreground'
  }
}

/** Los seis estados, para los filtros del listado del equipo. */
export const ESTATS_DIAGNOSTIC: readonly FetsDiagnostic['estat'][] = [
  'sense_comencar', 'incomplet', 'complet', 'a_punt', 'emes', 'sense_questionari',
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
