// El ALTA MULTIPRODUCTO en el formulario (plan DIC 26, fase 6a, proceso 3.3). PURO, con test
// (`tests/altaMultiproducte.test.ts`).
//
// El formulario de alta sigue preguntando UN producto en sus campos de siempre (producto,
// variedad, kilos, cajas, coste): ese es el PRIMER producto. «Afegir un altre producte» añade
// filas con lo que cambia de un producto a otro —producto, variedad, kilos y, si el formulario
// los pide, cajas y precio mínimo—. Todo lo demás (lugar, fechas, días y franja, modalidades,
// causa, fotos, envases, observaciones) se contesta una vez y vale para todos.
//
// 🔴 Con UN solo producto el cuerpo que se manda es EXACTAMENTE el de siempre: sin `productes`.
//    Con dos o más, el contrato de `crear-oferta` (`_shared/disponibilitat.ts`): lo común en
//    `datos` y la lista en `datos.productes`, el primero sacado de los campos de siempre.
//
// Qué es de cada producto y qué es común, decidido aquí (el servidor solo dice que una clave
// vacía de un producto toma el valor común):
//   · producto, variedad, kilos, familia, cajas y coste declarado: de CADA producto. No se
//     heredan: la variedad de un tomate no es la de un pimiento, el número de cajas tampoco, y el
//     coste parte de la referencia de SU producto (sin declarar, la del mes del albarán, D2).
//   · precio mínimo: si una fila lo deja vacío, HEREDA el del primer producto (se queda en lo
//     común). Es lo único que tiene sentido repetir y lo que más se repite.

import { CLAUS_PER_PRODUCTE, MAX_PRODUCTES } from '../../supabase/functions/_shared/disponibilitat.ts'

export { MAX_PRODUCTES }

type Datos = Record<string, unknown>

/** Una fila de «un altre producte». Los números, como texto del `<input>` (vacío = sin valor). */
export interface FilaProducte {
  /** Para la `key` de React: no viaja. */
  clau: string
  producte: string
  varietat: string
  kg: string
  caixes: string
  preu_minim: string
}

/** Las claves que son de cada producto y NO se heredan (el precio mínimo sí, ver la cabecera). */
const CLAUS_NO_HERETADES = ['producte', 'varietat', 'kg', 'familia', 'caixes', 'cost_kg'] as const

let comptador = 0
/** Una clave estable para la fila (no hace falta que sea aleatoria: solo única en la página). */
function novaClau(): string {
  comptador += 1
  return `fp-${Date.now().toString(36)}-${comptador}`
}

export function filaBuida(): FilaProducte {
  return { clau: novaClau(), producte: '', varietat: '', kg: '', caixes: '', preu_minim: '' }
}

function buit(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

/** Una fila que no lleva nada escrito: se ignora al enviar (se añadió y no se usó). */
export function filaEnBlanc(f: FilaProducte): boolean {
  return !f.producte.trim() && !f.varietat.trim() && !f.kg.trim() && !f.caixes.trim() && !f.preu_minim.trim()
}

/** Las filas que cuentan: las que tienen algo escrito. */
export function filesUtils(files: readonly FilaProducte[]): FilaProducte[] {
  return files.filter((f) => !filaEnBlanc(f))
}

function numero(v: string): number | null {
  const s = v.trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Una fila como línea de `productes[]`: solo lo escrito, con la familia del catálogo. */
function liniaDeFila(f: FilaProducte, familiaDe: (producte: string) => string | null): Datos {
  const l: Datos = { producte: f.producte.trim() }
  if (f.varietat.trim()) l.varietat = f.varietat.trim()
  const kg = numero(f.kg)
  if (kg !== null) l.kg = kg
  const caixes = numero(f.caixes)
  if (caixes !== null) l.caixes = caixes
  const preu = numero(f.preu_minim)
  if (preu !== null) l.preu_minim = preu
  const familia = l.producte ? familiaDe(String(l.producte)) : null
  if (familia) l.familia = familia
  return l
}

/**
 * El cuerpo que se manda a `crear-oferta` (alta, esborrany o publicar). `datos` es lo que el
 * formulario ya prepara para un producto (`preparaEnviament`); `extres`, las filas añadidas.
 *
 * Sin filas útiles devuelve el MISMO objeto: el alta de un producto no puede notar que este
 * módulo existe.
 */
export function cosAmbProductes(
  datos: Datos,
  extres: readonly FilaProducte[],
  familiaDe: (producte: string) => string | null,
): Datos {
  const utils = filesUtils(extres)
  if (utils.length === 0) return datos
  const comuns: Datos = {}
  const primer: Datos = {}
  for (const [k, v] of Object.entries(datos)) {
    if (k === 'productes') continue
    if ((CLAUS_NO_HERETADES as readonly string[]).includes(k)) {
      if (!buit(v)) primer[k] = v
    } else {
      comuns[k] = v
    }
  }
  return { ...comuns, productes: [primer, ...utils.map((f) => liniaDeFila(f, familiaDe))] }
}

function text(v: unknown): string {
  return buit(v) ? '' : String(v).trim()
}

/**
 * Al revés: lo guardado (un esborrany del servidor o la red local) → los campos del formulario
 * y las filas añadidas. Sin `productes` (o con uno), lo guardado tal cual y ninguna fila.
 */
export function desDeCos(cos: Datos): { datos: Datos; extres: FilaProducte[] } {
  if (!('productes' in cos)) return { datos: cos, extres: [] }
  const comuns: Datos = {}
  for (const [k, v] of Object.entries(cos)) if (k !== 'productes') comuns[k] = v
  const llista = Array.isArray(cos.productes) ? cos.productes : []
  const linies = llista.filter((l): l is Datos => !!l && typeof l === 'object' && !Array.isArray(l))
  if (linies.length === 0) return { datos: comuns, extres: [] }
  const primer: Datos = {}
  for (const k of CLAUS_PER_PRODUCTE) {
    if (!buit(linies[0][k])) primer[k] = linies[0][k]
  }
  const extres = linies.slice(1).map((l) => ({
    clau: novaClau(),
    producte: text(l.producte),
    varietat: text(l.varietat),
    kg: text(l.kg),
    caixes: text(l.caixes),
    preu_minim: text(l.preu_minim),
  }))
  return { datos: { ...comuns, ...primer }, extres }
}

/** Qué le pasa a una fila, como clave i18n. */
export type ErrorFila =
  | 'mp.err_falta_producte'
  | 'mp.err_kg'
  | 'mp.err_repetit'
  | 'mp.err_caixes'
  | 'mp.err_preu'

/** Producto + variedad normalizados (el mismo criterio que `agrupaProductes()` del servidor). */
function clauProducte(producte: unknown, varietat: unknown): string {
  const n = (v: unknown) => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return `${n(producte)}|${n(varietat)}`
}

/**
 * Lo que está mal en las filas, por su `clau`. `publicar` exige kilos (> 0); al guardar un
 * esborrany basta con el producto, pero lo escrito tiene que tener buen formato. Las filas en
 * blanco no cuentan. Un producto repetido (mismo producto y variedad que el primero o que otra
 * fila) tampoco se puede: serían dos ofertas iguales.
 */
export function errorsFiles(
  principal: { producte: unknown; varietat: unknown },
  extres: readonly FilaProducte[],
  opcions: { publicar: boolean },
): Record<string, ErrorFila> {
  const out: Record<string, ErrorFila> = {}
  const vistes = new Set<string>()
  if (!buit(principal.producte)) vistes.add(clauProducte(principal.producte, principal.varietat))
  for (const f of filesUtils(extres)) {
    if (!f.producte.trim()) { out[f.clau] = 'mp.err_falta_producte'; continue }
    const k = clauProducte(f.producte, f.varietat)
    if (vistes.has(k)) { out[f.clau] = 'mp.err_repetit'; continue }
    vistes.add(k)
    const kg = numero(f.kg)
    if ((opcions.publicar && kg === null) || (f.kg.trim() && !(kg !== null && kg > 0))) {
      out[f.clau] = 'mp.err_kg'; continue
    }
    const caixes = numero(f.caixes)
    if (f.caixes.trim() && !(caixes !== null && Number.isInteger(caixes) && caixes > 0)) {
      out[f.clau] = 'mp.err_caixes'; continue
    }
    const preu = numero(f.preu_minim)
    if (f.preu_minim.trim() && !(preu !== null && preu > 0)) { out[f.clau] = 'mp.err_preu'; continue }
  }
  return out
}

/** ¿Cabe otra fila? El primer producto cuenta: como mucho `MAX_PRODUCTES` en total. */
export function caben(extres: readonly FilaProducte[]): boolean {
  return extres.length + 1 < MAX_PRODUCTES
}

/**
 * Un rechazo de `crear-oferta` con `producte_index` (0 = el primer producto, los campos de
 * siempre): a qué fila apunta. `enviades` son las filas útiles que se mandaron, en orden.
 * Null si es el primero o si el índice no casa.
 */
export function filaDelIndex(index: unknown, enviades: readonly FilaProducte[]): FilaProducte | null {
  const i = typeof index === 'number' ? index : Number(index)
  if (!Number.isInteger(i) || i < 1) return null
  return enviades[i - 1] ?? null
}

/** El código de un rechazo de la lista de productos, como clave i18n (literal, sin componer). */
export function clauErrorProductes(code: string | null | undefined): string | null {
  switch (code) {
    case 'productes_invalid': return 'mp.err_productes_invalid'
    case 'massa_productes': return 'mp.err_massa_productes'
    case 'falta_producte': return 'mp.err_falta_producte'
    case 'producte_repetit': return 'mp.err_repetit'
    case 'producte_invalid': return 'mp.err_producte_invalid'
    case 'kg_invalid': return 'mp.err_kg'
    default: return null
  }
}
