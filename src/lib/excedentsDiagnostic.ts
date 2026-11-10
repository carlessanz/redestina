// Los EXCEDENTES del diagnóstico en EDICIÓN (Plan 2, A3, `20270522100000`): el estado del
// formulario del equipo, las operaciones sobre él, el payload de `desar_excedents_diagnostic()`
// y lo que falta antes de guardar. Puro y sin red (test en `tests/excedentsDiagnostic.test.ts`);
// la LECTURA (textos, filas) vive en `excedentsLlegible.ts`, que comparte el PDF.
//
// El modelo: un BLOQUE por producto principal de la Operativa (columna
// `productores.productes_principals`), que dice «sense excedent» o lista CAUSAS del catálogo
// `causas` (el código de las ofertas, D7). Cada causa: frecuencia, kg aproximados cada vez (P7),
// gestión actual, destinos de interés (= modalidades) y, por destino marcado, UNA acción
// (decisión b).
//
// 🔴 Los principales que valen son los VIVOS del formulario (lo que hay marcado en la Operativa,
//    aunque no se haya guardado): `sincronitzaPrincipals()` pone un bloque vacío para cada
//    principal nuevo, marca como «conservat» (ja no és principal) el bloque guardado de un
//    producto que ha dejado de serlo —decisión a: se conserva con sus acciones, no cuenta para
//    `complet`— y hace desaparecer el bloque NO guardado de un no-principal (no existe en la
//    base y el servidor lo rechazaría: `producte_fora_principals`).
//
// 🔴 `faltenLocal()` es el ESPEJO de `diagnostic_falten_productor()` (SQL): mismos códigos y
//    mismo orden. Solo sirve para señalar lo pendiente mientras se escribe; lo que manda es el
//    `falten` que devuelve el servidor al guardar.

import { DESTINS, blocsExcedents, type BlocExcedentsLlegible } from './excedentsLlegible'
import type { EstatSeccio } from './diagnostic'
import type {
  CausaCataleg, PayloadBlocDiagnostic, PayloadCausaDiagnostic,
} from '../types'

/** Una causa en edición. Los textos van tal cual se teclean; el payload los limpia. */
export interface CausaEdicio {
  /** Código del catálogo `causas`. */
  causa: string
  causa_nom: { ca: string; es: string } | null
  /** `''` = sin contestar. */
  frequencia: string
  /** El texto del campo de kilos (`''` = sin contestar). */
  volum: string
  gestio: string[]
  destins: string[]
  detall: string
  /** Destino → texto de la acción. Solo cuentan los destinos marcados. */
  accions: Record<string, string>
}

/** Un bloque de producto en edición. */
export interface BlocEdicio {
  producte: string
  /** Principal HOY en el formulario (vivo). Un bloque no principal es un «conservat». */
  principal: boolean
  /** Existe en la base (venía de `diagnostic_datos().excedents`). */
  persistit: boolean
  sense_excedent: boolean
  observacions: string
  causes: CausaEdicio[]
}

export type EstatExcedents = BlocEdicio[]

const net = (s: string | null | undefined): string => (s ?? '').trim()

/** Una lista de textos limpia, sin vacíos ni repetidos, en el orden en que llega. */
export function llistaTextos(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') continue
    const s = x.trim()
    if (s !== '' && !out.includes(s)) out.push(s)
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. El estado: de lo guardado + los principales vivos
// ---------------------------------------------------------------------------

function textKg(kg: number | null): string {
  return typeof kg === 'number' && Number.isFinite(kg) ? String(kg) : ''
}

/** Lo guardado (`blocsExcedents()`) en forma de edición: todo `persistit`. */
export function blocsAEdicio(blocs: readonly BlocExcedentsLlegible[]): EstatExcedents {
  return blocs.map((b) => ({
    producte: b.producte,
    principal: b.principal,
    persistit: true,
    sense_excedent: b.sense_excedent,
    observacions: b.observacions ?? '',
    causes: b.causes.map((c) => ({
      causa: c.causa,
      causa_nom: c.causa_nom,
      frequencia: c.frequencia ?? '',
      volum: textKg(c.volum_kg),
      gestio: [...c.gestio_actual],
      destins: [...c.destins],
      detall: c.detall ?? '',
      accions: Object.fromEntries(c.accions.map((a) => [a.desti, a.descripcio])),
    })),
  }))
}

function blocBuit(producte: string): BlocEdicio {
  return { producte, principal: true, persistit: false, sense_excedent: false, observacions: '', causes: [] }
}

/**
 * Los bloques que se enseñan, según los principales VIVOS (ver la cabecera): primero los
 * principales en su orden (el guardado o uno vacío), después los conservados (guardados y ya
 * no principales) por nombre, como los ordena el servidor. Un bloque no guardado de un
 * no-principal desaparece.
 */
export function sincronitzaPrincipals(estat: EstatExcedents, principals: readonly string[]): EstatExcedents {
  const pri = llistaTextos(principals)
  const perNom = new Map(estat.map((b) => [b.producte, b]))
  const out: EstatExcedents = pri.map((p) => {
    const b = perNom.get(p)
    return b ? { ...b, principal: true } : blocBuit(p)
  })
  const conservats = estat
    .filter((b) => !pri.includes(b.producte) && b.persistit)
    .map((b) => ({ ...b, principal: false }))
    .sort((a, b) => (a.producte < b.producte ? -1 : a.producte > b.producte ? 1 : 0))
  return [...out, ...conservats]
}

/** El estado inicial: lo que llega de `diagnostic_datos().excedents` con los principales vivos. */
export function estatInicial(excedents: unknown, principals: readonly string[]): EstatExcedents {
  return sincronitzaPrincipals(blocsAEdicio(blocsExcedents(excedents)), principals)
}

// ---------------------------------------------------------------------------
// 2. Operaciones (inmutables; crean el bloque si todavía no estaba)
// ---------------------------------------------------------------------------

function ambBloc(estat: EstatExcedents, producte: string, fn: (b: BlocEdicio) => BlocEdicio): EstatExcedents {
  if (!estat.some((b) => b.producte === producte)) return [...estat, fn(blocBuit(producte))]
  return estat.map((b) => (b.producte === producte ? fn(b) : b))
}

function ambCausa(
  estat: EstatExcedents, producte: string, causa: string, fn: (c: CausaEdicio) => CausaEdicio,
): EstatExcedents {
  return ambBloc(estat, producte, (b) => ({
    ...b, causes: b.causes.map((c) => (c.causa === causa ? fn(c) : c)),
  }))
}

/**
 * «Sense excedent». Las causas se quedan en memoria (si se desmarca, vuelven); el payload no
 * las manda mientras esté marcado.
 */
export function posaSenseExcedent(estat: EstatExcedents, producte: string, valor: boolean): EstatExcedents {
  return ambBloc(estat, producte, (b) => ({ ...b, sense_excedent: valor }))
}

/** Las causas marcadas: conserva las que siguen, añade vacías las nuevas, por código. */
export function posaCauses(
  estat: EstatExcedents, producte: string, codis: readonly string[], cataleg: readonly CausaCataleg[] = [],
): EstatExcedents {
  const triats = llistaTextos(codis)
  return ambBloc(estat, producte, (b) => {
    const causes = triats.map((codi) => {
      const ja = b.causes.find((c) => c.causa === codi)
      if (ja) return ja
      const cat = cataleg.find((c) => c.codigo === codi)
      return {
        causa: codi,
        causa_nom: cat ? { ca: cat.nombre, es: cat.nombre_es || cat.nombre } : null,
        frequencia: '', volum: '', gestio: [], destins: [], detall: '', accions: {},
      }
    })
    causes.sort((a, c) => (a.causa < c.causa ? -1 : a.causa > c.causa ? 1 : 0))
    return { ...b, causes }
  })
}

/** Añade o quita una causa. */
export function alternaCausa(
  estat: EstatExcedents, producte: string, codi: string, cataleg: readonly CausaCataleg[] = [],
): EstatExcedents {
  const b = estat.find((x) => x.producte === producte)
  const actuals = (b?.causes ?? []).map((c) => c.causa)
  const seg = actuals.includes(codi) ? actuals.filter((c) => c !== codi) : [...actuals, codi]
  return posaCauses(estat, producte, seg, cataleg)
}

export type CampCausa = 'frequencia' | 'volum' | 'detall'

export function posaCampCausa(
  estat: EstatExcedents, producte: string, causa: string, camp: CampCausa, valor: string,
): EstatExcedents {
  return ambCausa(estat, producte, causa, (c) => ({ ...c, [camp]: valor }))
}

export function posaGestio(
  estat: EstatExcedents, producte: string, causa: string, gestio: readonly string[],
): EstatExcedents {
  return ambCausa(estat, producte, causa, (c) => ({ ...c, gestio: llistaTextos(gestio) }))
}

/** Los destinos marcados, en el orden de `DESTINS`. Quitar un destino quita su acción. */
export function posaDestins(
  estat: EstatExcedents, producte: string, causa: string, destins: readonly string[],
): EstatExcedents {
  const triats = DESTINS.filter((d) => destins.includes(d)) as string[]
  return ambCausa(estat, producte, causa, (c) => ({
    ...c,
    destins: triats,
    accions: Object.fromEntries(Object.entries(c.accions).filter(([d]) => triats.includes(d))),
  }))
}

export function posaAccio(
  estat: EstatExcedents, producte: string, causa: string, desti: string, text: string,
): EstatExcedents {
  return ambCausa(estat, producte, causa, (c) => ({ ...c, accions: { ...c.accions, [desti]: text } }))
}

export function posaObservacions(estat: EstatExcedents, producte: string, text: string): EstatExcedents {
  return ambBloc(estat, producte, (b) => ({ ...b, observacions: text }))
}

/**
 * Quita un bloque («Treu-lo»). La pantalla solo lo ofrece en los CONSERVADOS: un principal no se
 * quita, se desmarca en la Operativa (y si se quitara, `sincronitzaPrincipals()` lo devolvería
 * vacío). Al guardar, sus excedentes y acciones se borran (y `perdues()` lo avisa).
 */
export function treuBloc(estat: EstatExcedents, producte: string): EstatExcedents {
  return estat.filter((b) => b.producte !== producte)
}

// ---------------------------------------------------------------------------
// 3. El payload de `desar_excedents_diagnostic()`
// ---------------------------------------------------------------------------

/** Los kilos del campo: número ≥ 0, `null` si vacío; un texto no numérico se manda tal cual (el servidor lo rechaza). */
export function volumDeText(text: string): number | null | string {
  const s = net(text).replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : text
}

/** ¿Los kilos cuentan como contestados? (número ≥ 0) */
export function volumValid(text: string): boolean {
  const v = volumDeText(text)
  return typeof v === 'number' && v >= 0
}

/** ¿Un bloque está vacío del todo? (no se manda: si estaba guardado, se borra) */
function blocBuidDelTot(b: BlocEdicio): boolean {
  return !b.sense_excedent && b.causes.length === 0 && net(b.observacions) === ''
}

/**
 * Lo que se manda: los bloques que se enseñan (principales y conservados), sin los vacíos del
 * todo; con «sense excedent», sin causas; las acciones solo de destinos marcados y con texto.
 * Textos limpios (vacío = `null`).
 */
export function payloadExcedents(estat: EstatExcedents): PayloadBlocDiagnostic[] {
  return estat
    .filter((b) => (b.principal || b.persistit) && !blocBuidDelTot(b))
    .map((b) => ({
      producte: b.producte,
      sense_excedent: b.sense_excedent,
      observacions: net(b.observacions) || null,
      causes: b.sense_excedent ? [] : b.causes.map((c): PayloadCausaDiagnostic => ({
        causa: c.causa,
        frequencia: c.frequencia || null,
        // Un texto no numérico viaja tal cual: el servidor responde `volum_negatiu` y se dice.
        volum_kg: volumDeText(c.volum) as number | null,
        gestio_actual: [...c.gestio],
        destins: [...c.destins],
        detall: net(c.detall) || null,
        accions: c.destins
          .filter((d) => net(c.accions[d]) !== '')
          .map((d) => ({ desti: d, descripcio: net(c.accions[d]) })),
      })),
    }))
}

/**
 * Cuántas acciones GUARDADAS se borrarían al guardar este payload (con su estado y su nota):
 * las de un bloque, una causa o un destino que ya no viaja, o cuyo texto se ha vaciado.
 */
export function perdues(abans: readonly BlocExcedentsLlegible[], despres: readonly PayloadBlocDiagnostic[]): number {
  const queden = new Set<string>()
  for (const b of despres) {
    for (const c of b.causes) for (const a of c.accions) queden.add(`${b.producte}\u0000${c.causa}\u0000${a.desti}`)
  }
  let n = 0
  for (const b of abans) {
    for (const c of b.causes) {
      for (const a of c.accions) if (!queden.has(`${b.producte}\u0000${c.causa}\u0000${a.desti}`)) n++
    }
  }
  return n
}

// ---------------------------------------------------------------------------
// 4. Lo que falta: espejo de `diagnostic_falten_productor()`
// ---------------------------------------------------------------------------

export interface OperativaFalten {
  habituals: readonly string[]
  principals: readonly string[]
  /** Hay un lugar principal con días o franjas (lo dice el servidor: los lugares se guardan al momento). */
  llocOk: boolean
}

/**
 * Los códigos, en el MISMO orden que SQL (`order by g, o, c`): los tres de la Operativa;
 * después, por principal en su orden, `excedents:<p>` y los `dades:<p>:<causa>` por código.
 * Solo cuentan los principales (los conservados, no: decisión a).
 */
export function faltenLocal(estat: EstatExcedents, op: OperativaFalten): string[] {
  const out: string[] = []
  const pri = llistaTextos(op.principals)
  if (llistaTextos(op.habituals).length === 0) out.push('operativa_productes')
  if (pri.length === 0) out.push('operativa_principals')
  if (!op.llocOk) out.push('operativa_lloc')
  for (const p of pri) {
    const b = estat.find((x) => x.producte === p)
    if (!b || (!b.sense_excedent && b.causes.length === 0)) {
      out.push(`excedents:${p}`)
      continue
    }
    if (b.sense_excedent) continue
    const causes = [...b.causes].sort((a, c) => (a.causa < c.causa ? -1 : a.causa > c.causa ? 1 : 0))
    for (const c of causes) {
      if (c.frequencia === '' || !volumValid(c.volum) || c.gestio.length === 0) out.push(`dades:${p}:${c.causa}`)
    }
  }
  return out
}

/** Un código de `falten` partido: tipo y, si los lleva, producto y causa. */
export function parteixFalta(codi: string): { tipus: string; producte?: string; causa?: string } {
  if (codi.startsWith('excedents:')) return { tipus: 'excedents', producte: codi.slice('excedents:'.length) }
  if (codi.startsWith('dades:')) {
    const resta = codi.slice('dades:'.length)
    const i = resta.lastIndexOf(':')
    return i < 0 ? { tipus: 'dades', producte: resta } : { tipus: 'dades', producte: resta.slice(0, i), causa: resta.slice(i + 1) }
  }
  return { tipus: codi }
}

type Traductor = (clau: string, vars?: Record<string, string | number>) => string

/**
 * Un código de `falten` en texto (`dexc.falta_*`). `nomCausa` traduce el código de la causa
 * (el catálogo, en el idioma). Un código desconocido sale tal cual, nunca una clave cruda.
 */
export function textFalta(codi: string, t: Traductor, nomCausa: (codi: string) => string = (c) => c): string {
  const f = parteixFalta(codi)
  const clau = `dexc.falta_${f.tipus}`
  const s = t(clau, { producte: f.producte ?? '', causa: f.causa ? nomCausa(f.causa) : '' })
  return s === clau ? codi : s
}

// ---------------------------------------------------------------------------
// 5. Los chips de sección del formulario (T3): operativa · excedents · accions
// ---------------------------------------------------------------------------

export const SECCIONS_FORMULARI = ['operativa', 'excedents', 'accions'] as const

export function seccionsDiagnostic(
  falten: readonly string[],
  o: { operativa: { n: number; contestades: number }; principals: number; accions: number },
): EstatSeccio[] {
  const fOp = falten.filter((c) => c.startsWith('operativa_')).length
  const productesAmbFalta = new Set(
    falten.filter((c) => c.startsWith('excedents:') || c.startsWith('dades:')).map((c) => parteixFalta(c).producte),
  )
  const fExc = falten.filter((c) => c.startsWith('excedents:') || c.startsWith('dades:')).length
  return [
    {
      seccio: 'operativa', clau: 'diag.sec_operativa', n: o.operativa.n, contestades: o.operativa.contestades,
      falten: fOp, completa: fOp === 0 && o.operativa.contestades > 0,
    },
    {
      seccio: 'excedents', clau: 'dexc.titol', n: o.principals,
      contestades: Math.max(0, o.principals - productesAmbFalta.size),
      falten: fExc, completa: fExc === 0 && o.principals > 0,
    },
    {
      seccio: 'accions', clau: 'dexc.accions', n: o.accions, contestades: o.accions,
      falten: 0, completa: o.accions > 0,
    },
  ]
}

// ---------------------------------------------------------------------------
// 6. El badge del estado de una acción (tokens del sistema de diseño)
// ---------------------------------------------------------------------------

export function estilEstatAccio(estat: string): string {
  switch (estat) {
    case 'pendent': return 'bg-aviso-fondo text-aviso'
    case 'en_curs': return 'bg-secondary text-secondary-foreground'
    case 'feta': return 'bg-exito-fondo text-exito'
    default: return 'bg-muted text-muted-foreground'
  }
}
