// Ofertas MULTIPRODUCTO (proceso 3.3, fase 6b-6c del plan DIC 26, 25-11-2026): la parte PURA de
// las pantallas que piden, aprueban y registran la recogida de VARIOS productos de una misma
// disponibilidad en un acto. Sin red: lo prueba `tests/sollicitudMultiproducte.test.ts`.
//
// 🔴 Ninguna regla de negocio vive aquí. La autoridad es la base: cada línea pasa por la puerta de
//    siempre (`manifestar_interes`, `aprova_resposta_intern`, `registrar_recollida`…) y, si UNA
//    falla, no queda nada (todo o nada). Esto solo ordena el formulario, avisa antes de pulsar de
//    lo evidente y lee de vuelta QUÉ línea falló (`error.details` = JSON `{"linia": n, …}`) para
//    marcarla en pantalla.

import { normalitzaDies } from './diesRecollida'
import { hhmm } from './franja'
import { llegeixKg, validaRegistre, type ErrorRegistre } from './registreRecollida'
import type { Modalitat } from '../types'

// ---------------------------------------------------------------------------------------
// 1. Qué línea falló
// ---------------------------------------------------------------------------------------

/** El `detail` de un error de línea de las RPC multiproducto. */
export interface DetallLinia {
  /** La posición (1-based) de la línea en `p_linies`. */
  linia: number | null
  excedente_id?: string | null
  resposta_id?: string | null
  canalizacion_id?: string | null
}

/** Lee el `details` de un error de PostgREST. Lo que no es ese JSON da `null`. */
export function llegeixDetall(details: string | null | undefined): DetallLinia | null {
  if (!details) return null
  try {
    const v = JSON.parse(details) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    const o = v as Record<string, unknown>
    const id = (k: string) => (typeof o[k] === 'string' && o[k] ? (o[k] as string) : null)
    const n = typeof o.linia === 'number' && Number.isInteger(o.linia) ? o.linia : null
    const d: DetallLinia = { linia: n }
    if (id('excedente_id')) d.excedente_id = id('excedente_id')
    if (id('resposta_id')) d.resposta_id = id('resposta_id')
    if (id('canalizacion_id')) d.canalizacion_id = id('canalizacion_id')
    return n == null && !d.excedente_id && !d.resposta_id && !d.canalizacion_id ? null : d
  } catch {
    return null
  }
}

/**
 * El id de la línea que falló: el que trae el detalle o, si no, el que ocupaba esa posición en
 * lo que se envió (`enviats`, en el mismo orden que `p_linies`).
 */
export function idLiniaFallida(detall: DetallLinia | null, enviats: readonly string[]): string | null {
  if (!detall) return null
  const id = detall.excedente_id ?? detall.resposta_id ?? detall.canalizacion_id ?? null
  if (id) return id
  if (detall.linia != null && detall.linia >= 1 && detall.linia <= enviats.length) return enviats[detall.linia - 1]
  return null
}

/**
 * Los rechazos PROPIOS de las RPC multiproducto, con su clave. Lo demás (los de las puertas de
 * siempre: `kg_maxim`, `sense_conveni`, `dia_fora_dies`…) lo traducen las funciones de siempre
 * (`clauErrorInteres`, `clauErrorBase`, `clauErrorValidacio`) y por eso aquí se devuelve null.
 *
 * ⚠️ El orden importa (`includes()`): `linia_ja_resolta` antes que cualquier `linia_`.
 */
export const ERRORS_MULTIPLE: [string, string][] = [
  ['sollicitud_pendent', 'smp.err_sollicitud_pendent'],
  ['cal_recollida', 'smp.err_cal_recollida'],
  ['cal_entitat', 'smp.err_cal_entitat'],
  ['cal_linies', 'smp.err_cap_linia'],
  ['falten_linies', 'smp.err_falten'],
  ['linia_ja_resolta', 'smp.err_ja_resolta'],
  ['accio_invalida', 'smp.err_linia'],
  ['linia_fora_disponibilitat', 'smp.err_linia'],
  ['linia_fora_sollicitud', 'smp.err_linia'],
  ['linia_duplicada', 'smp.err_linia'],
  ['linia_invalida', 'smp.err_linia'],
  ['disponibilitat_inexistent', 'smp.err_inexistent'],
  ['sollicitud_inexistent', 'smp.err_inexistent'],
  ['entitat_inexistent', 'smp.err_inexistent'],
]

export function clauErrorMultiple(missatge: string | null | undefined, codi: string | null | undefined): string | null {
  const m = missatge ?? ''
  for (const [c, clau] of ERRORS_MULTIPLE) if (m === c || m.includes(c)) return clau
  if (codi === '42501') return 'smp.err_permis'
  return null
}

// ---------------------------------------------------------------------------------------
// 2. La solicitud del receptor (Mercat, `?disponibilitat=`)
// ---------------------------------------------------------------------------------------

/** Lo mínimo de una fila de `ofertes_disponibilitat()` que hace falta aquí. */
export interface OfertaDelGrup {
  excedente_id: string
  estado: string
  kg_total: number | null
  kg_lliures: number | null
  modalitat: Modalitat | null
  modalitats: Modalitat[] | null
  modalitats_meves: Modalitat[] | null
  disponible_hasta: string | null
  hora_recollida_inici: string | null
  hora_recollida_fi: string | null
  dies_recollida: number[] | null
}

/** Viva para pedir: publicada o parcial. */
export function ofertaViva(o: Pick<OfertaDelGrup, 'estado'>): boolean {
  return o.estado === 'publicada' || o.estado === 'parcial'
}

/**
 * Las modalidades que ESTA entidad puede pedir de la oferta: las suyas (`modalitats_meves`, que
 * ya cruza compatibilidad y P8) y, si se pasa `potDemanar`, solo las que tienen su convenio.
 * `modalitats_meves = null` (equipo o productor) = todas las de la oferta.
 */
export function modalitatsDemanables(
  o: Pick<OfertaDelGrup, 'modalitat' | 'modalitats' | 'modalitats_meves'>,
  potDemanar?: (m: Modalitat) => boolean,
): Modalitat[] {
  const base = o.modalitats_meves ?? o.modalitats ?? (o.modalitat ? [o.modalitat] : [])
  return potDemanar ? base.filter(potDemanar) : [...base]
}

/** Las que se pueden pedir: vivas y con alguna modalidad posible para esta entidad. */
export function ofertesDemanables<T extends OfertaDelGrup>(ofertes: readonly T[]): T[] {
  return ofertes.filter((o) => ofertaViva(o) && modalitatsDemanables(o).length > 0)
}

/**
 * Los días de recogida comunes a las ofertas elegidas (ISO 1-7):
 *   · ninguna limita → `cap` (cualquier día);
 *   · las que limitan comparten alguno → `interseccio`, esos días;
 *   · no comparten ninguno → `primera`, los de la primera que limita: la base rechazará con
 *     `dia_fora_dies` la línea que no se recoja ese día, y la pantalla lo explica.
 */
export function diesComuns(ofertes: readonly Pick<OfertaDelGrup, 'dies_recollida'>[]): {
  dies: number[]
  motiu: 'cap' | 'interseccio' | 'primera'
} {
  const limitades = ofertes.map((o) => normalitzaDies(o.dies_recollida)).filter((d) => d.length > 0)
  if (limitades.length === 0) return { dies: [], motiu: 'cap' }
  const inter = limitades.reduce((acc, d) => acc.filter((x) => d.includes(x)))
  if (inter.length > 0) return { dies: inter, motiu: 'interseccio' }
  return { dies: limitades[0], motiu: 'primera' }
}

/**
 * La franja común (la más estrecha que cabe en todas). Sin franja en ninguna, sin límites; si no
 * se solapan, la de la primera (la base dirá cuál no cuadra). `comuna=false` en ese caso.
 */
export function franjaComuna(ofertes: readonly Pick<OfertaDelGrup, 'hora_recollida_inici' | 'hora_recollida_fi'>[]): {
  inici: string | null
  fi: string | null
  comuna: boolean
} {
  const amb = ofertes
    .map((o) => ({ inici: hhmm(o.hora_recollida_inici), fi: hhmm(o.hora_recollida_fi) }))
    .filter((f) => f.inici && f.fi)
  if (amb.length === 0) return { inici: null, fi: null, comuna: true }
  const inici = amb.map((f) => f.inici).sort().at(-1)!
  const fi = amb.map((f) => f.fi).sort()[0]
  if (inici <= fi) return { inici, fi, comuna: true }
  return { inici: amb[0].inici, fi: amb[0].fi, comuna: false }
}

/** El último día que se puede elegir: el más temprano de los `disponible_hasta`. */
export function disponibleFinsComu(ofertes: readonly Pick<OfertaDelGrup, 'disponible_hasta'>[]): string | null {
  const dies = ofertes.map((o) => o.disponible_hasta?.slice(0, 10)).filter((d): d is string => Boolean(d)).sort()
  return dies[0] ?? null
}

/** Una línea del formulario de solicitud (o de asignación directa) tal como está en pantalla. */
export interface LiniaSollicitud {
  excedente_id: string
  triada: boolean
  /** Lo que escribe la persona (admite coma decimal). */
  kg: string
  /** Las modalidades posibles para esta entidad; con más de una, hay que elegir. */
  modalitats: readonly Modalitat[]
  modalitat: Modalitat | ''
  /** El tope (`kg_total`): no se puede pedir más de lo que hay. */
  kgMax: number | null
  /** Solo venta. */
  preu: string
  /** Solo nivel 1 en venta: el ofertante ha aceptado el precio. */
  preuAcceptat?: boolean
}

/** La modalidad que se enviará: la elegida o, si solo hay una, esa. */
export function modalitatTriada(l: Pick<LiniaSollicitud, 'modalitat' | 'modalitats'>): Modalitat | '' {
  if (l.modalitat && l.modalitats.includes(l.modalitat)) return l.modalitat
  return l.modalitats.length === 1 ? l.modalitats[0] : ''
}

export interface ErrorLinia {
  clau: string
  vars?: Record<string, string>
}

/**
 * El primer problema de cada línea elegida (por `excedente_id`) y el general. Vacío y `null` =
 * se puede enviar. `nivell1` exige además el precio en venta (`assignar_directe` lo pide).
 */
export function validaLiniesSollicitud(
  linies: readonly LiniaSollicitud[],
  opts: { nivell1?: boolean; fmtKg?: (n: number) => string } = {},
): { perLinia: Record<string, ErrorLinia>; general: string | null } {
  const perLinia: Record<string, ErrorLinia> = {}
  const triades = linies.filter((l) => l.triada)
  if (triades.length === 0) return { perLinia, general: 'smp.err_cap_linia' }
  const fmt = opts.fmtKg ?? ((n: number) => String(n))
  for (const l of triades) {
    const kg = llegeixKg(l.kg)
    if (kg == null || kg <= 0) { perLinia[l.excedente_id] = { clau: 'mk.need_kg' }; continue }
    if (l.kgMax != null && kg > l.kgMax) {
      perLinia[l.excedente_id] = { clau: 'mk.max_kg', vars: { n: fmt(l.kgMax) } }
      continue
    }
    const m = modalitatTriada(l)
    if (!m) { perLinia[l.excedente_id] = { clau: 'mk.need_mode' }; continue }
    if (m === 'venda' && l.preu.trim() !== '') {
      const p = Number(l.preu.replace(',', '.'))
      if (!Number.isFinite(p) || p < 0) { perLinia[l.excedente_id] = { clau: 'asg.err_cal_preu' }; continue }
    }
    if (opts.nivell1 && m === 'venda') {
      if (l.preu.trim() === '') { perLinia[l.excedente_id] = { clau: 'asg.err_cal_preu' }; continue }
      if (!l.preuAcceptat) { perLinia[l.excedente_id] = { clau: 'asg.err_cal_acceptat' }; continue }
    }
  }
  return { perLinia, general: null }
}

/** Lo que viaja en `p_linies` de `manifestar_interes_multiple` / `assignar_directe_multiple`. */
export interface LiniaEnviada {
  excedente_id: string
  kg: number
  modalitat?: Modalitat
  preu?: number
  preu_acceptat?: boolean
}

export function liniesPerEnviar(linies: readonly LiniaSollicitud[], opts: { nivell1?: boolean } = {}): LiniaEnviada[] {
  return linies.filter((l) => l.triada).map((l) => {
    const out: LiniaEnviada = { excedente_id: l.excedente_id, kg: llegeixKg(l.kg) ?? 0 }
    const m = modalitatTriada(l)
    if (m) out.modalitat = m
    // Solo la venta lleva precio: ni la donación ni la maquila (deuda 180).
    if (m === 'venda' && l.preu.trim() !== '') out.preu = Number(l.preu.replace(',', '.'))
    if (opts.nivell1 && m === 'venda') out.preu_acceptat = Boolean(l.preuAcceptat)
    return out
  })
}

// ---------------------------------------------------------------------------------------
// 3. La aprobación conjunta (Aprovacions)
// ---------------------------------------------------------------------------------------

/**
 * Agrupa las filas por `sollicitud_id`, en el orden en que aparece cada grupo; las que no tienen
 * solicitud quedan sueltas, en su orden. Es lo que pinta una tarjeta por solicitud.
 */
export function agrupaPerSollicitud<T extends { sollicitud_id?: string | null }>(files: readonly T[]): {
  grups: { sollicitudId: string; files: T[] }[]
  soltes: T[]
} {
  const grups: { sollicitudId: string; files: T[] }[] = []
  const idx = new Map<string, number>()
  const soltes: T[] = []
  for (const f of files) {
    const s = f.sollicitud_id
    if (!s) { soltes.push(f); continue }
    let i = idx.get(s)
    if (i == null) { i = grups.length; idx.set(s, i); grups.push({ sollicitudId: s, files: [] }) }
    grups[i].files.push(f)
  }
  return { grups, soltes }
}

/** Una línea de la tarjeta de aprobación tal como está en pantalla. */
export interface LiniaResolucio {
  resposta_id: string
  accio: 'aprova' | 'rebutja'
  kg: string
  modalitats: readonly Modalitat[]
  modalitat: Modalitat | ''
  preu: string
  preuAcceptat: boolean
  motiu: string
}

/** El primer problema de cada línea (por `resposta_id`). Vacío = se puede confirmar. */
export function validaResolucio(linies: readonly LiniaResolucio[]): Record<string, ErrorLinia> {
  const out: Record<string, ErrorLinia> = {}
  for (const l of linies) {
    if (l.accio === 'rebutja') {
      if (l.motiu.trim().length > 1000) out[l.resposta_id] = { clau: 'rrec.err_motiu_llarg' }
      continue
    }
    const kg = llegeixKg(l.kg)
    if (kg == null || kg <= 0) { out[l.resposta_id] = { clau: 'appr.need_kg' }; continue }
    const m = modalitatTriada(l)
    if (!m) { out[l.resposta_id] = { clau: 'appr.cal_modalitat' }; continue }
    if (m === 'venda' && l.preuAcceptat && l.preu.trim() === '') out[l.resposta_id] = { clau: 'asg.err_cal_preu' }
  }
  return out
}

/** `p_linies` de `resoldre_sollicitud`. */
export function liniesResolucio(linies: readonly LiniaResolucio[]): Record<string, unknown>[] {
  return linies.map((l) => {
    const motiu = l.motiu.trim()
    if (l.accio === 'rebutja') return motiu ? { resposta_id: l.resposta_id, accio: 'rebutja', motiu } : { resposta_id: l.resposta_id, accio: 'rebutja' }
    const out: Record<string, unknown> = { resposta_id: l.resposta_id, accio: 'aprova', kg: llegeixKg(l.kg) }
    const m = modalitatTriada(l)
    if (m) out.modalitat = m
    if (m === 'venda') {
      if (l.preu.trim() !== '') out.preu = Number(l.preu.replace(',', '.'))
      out.preu_acceptat = l.preuAcceptat
    }
    if (motiu) out.motiu = motiu
    return out
  })
}

// ---------------------------------------------------------------------------------------
// 4. La recogida real conjunta (6c)
// ---------------------------------------------------------------------------------------

/** `''` = esta línea no se registra ahora (se puede cerrar lo recogido y dejar lo demás). */
export type ResultatLinia = '' | 'coincideix' | 'inferior' | 'superior' | 'no_recollit'

export interface LiniaRecollida {
  canalizacion_id: string
  resultat: ResultatLinia
  kg: string
  /** Lo asignado a esa canalización. */
  kgAssignats: number | null
  motiu: string
}

/** El primer problema de cada línea marcada (por `canalizacion_id`) y el general. */
export function validaRecollidaMultiple(
  linies: readonly LiniaRecollida[],
  quan: string | null,
  ara: Date = new Date(),
): { perLinia: Record<string, ErrorRegistre | 'rrec.err_motiu_llarg'>; general: string | null } {
  const perLinia: Record<string, ErrorRegistre | 'rrec.err_motiu_llarg'> = {}
  const marcades = linies.filter((l) => l.resultat !== '')
  if (marcades.length === 0) return { perLinia, general: 'smp.err_cap_resultat' }
  for (const l of marcades) {
    if (l.resultat === 'no_recollit') {
      if (l.motiu.trim().length > 1000) perLinia[l.canalizacion_id] = 'rrec.err_motiu_llarg'
      continue
    }
    const e = validaRegistre({
      resultat: l.resultat === 'inferior' ? 'menys' : l.resultat === 'superior' ? 'mes' : 'coincideix',
      kg: l.kg, kgAssignats: l.kgAssignats, observacions: l.motiu, data: quan, ara,
    })
    if (e) perLinia[l.canalizacion_id] = e
  }
  return { perLinia, general: null }
}

/** `p_linies` de `registrar_recollida_multiple` (solo las marcadas, en su orden). */
export function liniesRecollida(linies: readonly LiniaRecollida[]): Record<string, unknown>[] {
  return linies.filter((l) => l.resultat !== '').map((l) => {
    const out: Record<string, unknown> = { canalizacion_id: l.canalizacion_id, resultat: l.resultat }
    if (l.resultat === 'inferior' || l.resultat === 'superior') out.kg_reals = llegeixKg(l.kg)
    const motiu = l.motiu.trim()
    if (motiu) {
      // Si coincide, es una observación. Con diferencia es a la vez lo que guarda el registro y
      // el motivo de la validación (como `campsAssistit`: un solo hecho, un solo campo). Sin
      // recoger, el motivo de la anulación.
      if (l.resultat === 'coincideix') out.observacions = motiu
      else if (l.resultat === 'no_recollit') out.motiu = motiu
      else { out.observacions = motiu; out.motiu = motiu }
    }
    return out
  })
}

/**
 * «Valida totes» pide un motivo común si alguna de las recogidas declaradas difiere de lo
 * asignado (la base: `cal_motiu_validacio`).
 */
export function validaTotesCalMotiu(files: readonly { kgAssignats: number | null; kgDeclarats: number | null }[]): boolean {
  return files.some((f) => f.kgAssignats != null && f.kgDeclarats != null && Math.abs(f.kgAssignats - f.kgDeclarats) > 0.001)
}
