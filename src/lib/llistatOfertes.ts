// El listado de ofertas del equipo (`OffersList`): lo que se puede decidir sin red.
//
// POR QUÉ UN MÓDULO (19-11-2026, puntos 4-6, fase 1). El listado dejó de enseñar solo el
// estado crudo del excedente («Coberta», «Parcial») y cuenta en qué punto del PROCESO está
// cada oferta («Recollida per validar», «Esperant recollida»…). Ese cálculo cruza tres
// tablas por fila —canalizaciones, respuestas y el REC— y vive aquí, con prueba, en vez de
// dentro del componente. Lo mismo las pestañas (con su alias antiguo), la paginación del
// Històric y el texto del buscador que va al servidor.
//
// ⚠️ EL PUNTO LO DECIDE `puntOferta()` (`procesOferta.ts`), el mismo que la ficha de la
//    oferta: el listado y el detalle no pueden contar dos historias del mismo lote. Aquí
//    solo se reúnen los hechos y se elige una frase CORTA para la fila; la única etapa que
//    se precisa es «assignada», que el modelo no distingue por canalización (esperando la
//    recogida o devuelta al receptor).
//
// ⚠️ LAS CANALIZACIONES ANULADAS NO CUENTAN para nada: ni kilos ni recogidas. Hasta hoy el
//    listado las sumaba, y una oferta con una entrega anulada salía más canalizada de lo que
//    estaba.
//
// Puro y sin red: se prueba desde Vitest (`tests/llistatOfertes.test.ts`).

import type { EstadoAlbaran, EstadoExcedente } from '../types'
import { puntOferta, type FetsOferta, type PuntProces } from './procesOferta'
import { estatValidacio } from './registreRecollida'

// --- Pestañas ----------------------------------------------------------------------------

export type PestanyaOfertes = 'validar' | 'actives' | 'esborranys' | 'historic'

/**
 * Las que siguen pidiendo algo. `no_colocada` está aquí y no en el Històric: todavía falta
 * decir qué pasó con el producto (revisión del 08-10-2026), y cuando se dice pasa a `cerrada`.
 * `borrador` es la oferta convertida en espigolada mientras se cosecha.
 */
export const ESTATS_ACTIUS: readonly EstadoExcedente[] = [
  'borrador', 'pendent_validacio', 'publicada', 'parcial', 'bloqueada', 'no_colocada',
] as const

/** Las terminadas: el archivo, que se pagina en el servidor. */
export const ESTATS_HISTORIC: readonly EstadoExcedente[] = ['cerrada', 'cancelada'] as const

/**
 * La pestaña de `?tab=`. `tancades` es el nombre de antes del 19-11-2026 (puede seguir en un
 * enlace guardado) y lleva al Històric. Lo desconocido o ausente, a Actives.
 */
export function llegeixPestanya(valor: string | null | undefined): PestanyaOfertes {
  switch (valor) {
    case 'validar':
    case 'esborranys':
    case 'historic':
      return valor
    case 'tancades':
      return 'historic'
    default:
      return 'actives'
  }
}

// --- Los hechos de cada oferta ----------------------------------------------------------

/** Las columnas de `canalizaciones` que hacen falta (el `select` vive en el componente). */
export interface CanalLlistat {
  excedente_id: string | null
  estado: string | null
  kg_confirmados: number | string | null
  recollida_registrada_at?: string | null
  recollida_validada_at?: string | null
  recollida_retornada_at?: string | null
}

export interface RespostaLlistat {
  excedente_id: string | null
  estado: string | null
  aprovacio: string | null
}

export interface RecLlistat {
  excedente_id: string | null
  estado: string
  numero_completo: string | null
  entregado_at: string | null
}

/** Lo que se sabe de una oferta para pintar su fila. */
export interface ResumOferta {
  kgCanalitzats: number
  /** Registradas por el receptor y esperando a un admin. */
  nPerValidar: number
  /** Con kilos asignados y sin registro de recogida todavía. */
  nEsperantRecollida: number
  /** Devueltas por el equipo al receptor para que las vuelva a registrar. */
  nRetornades: number
  nEnviades: number
  nInteressades: number
  nPerAprovar: number
  rec: RecLlistat | null
}

const RESUM_BUIT: ResumOferta = {
  kgCanalitzats: 0, nPerValidar: 0, nEsperantRecollida: 0, nRetornades: 0,
  nEnviades: 0, nInteressades: 0, nPerAprovar: 0, rec: null,
}

/** Una canalización anulada no existe a efectos del listado. */
export function canalViva(c: Pick<CanalLlistat, 'estado'>): boolean {
  return c.estado !== 'anulada'
}

/** Kilos canalizados por oferta, sin las anuladas. */
export function kgPerOferta(canals: readonly CanalLlistat[]): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const c of canals) {
    if (!c.excedente_id || !canalViva(c)) continue
    acc[c.excedente_id] = (acc[c.excedente_id] ?? 0) + Number(c.kg_confirmados ?? 0)
  }
  return acc
}

/**
 * Los estados de un REC que cuentan: la misma regla que `puntOferta` (`REC_VIU`). Un
 * borrador todavía no dice nada —nace con la canalización— y uno anulado o rectificado ya no.
 */
export const ESTATS_REC_VIU: readonly EstadoAlbaran[] = ['emitido', 'entregado', 'confirmado', 'conciliado'] as const

/**
 * Reúne, por oferta, lo que hace falta para decir en qué punto está. Las tres listas pueden
 * traer filas de ofertas que no se van a pintar: no molestan.
 */
export function resumPerOferta(
  canals: readonly CanalLlistat[],
  respostes: readonly RespostaLlistat[],
  recs: readonly RecLlistat[],
): Record<string, ResumOferta> {
  const out: Record<string, ResumOferta> = {}
  const de = (id: string) => (out[id] ??= { ...RESUM_BUIT })

  for (const c of canals) {
    if (!c.excedente_id || !canalViva(c)) continue
    const r = de(c.excedente_id)
    r.kgCanalitzats += Number(c.kg_confirmados ?? 0)
    // Conciliada = la recogida ya se cerró por el circuito de albaranes, aunque no tenga
    // las fechas del registro (las de antes del 17-10-2026 no las tienen).
    if (c.estado === 'conciliada') continue
    const v = estatValidacio(c)
    if (v === 'pendent_validacio') r.nPerValidar++
    else if (v === 'retornada') r.nRetornades++
    else if (v === 'sense_registre') r.nEsperantRecollida++
  }
  for (const p of respostes) {
    if (!p.excedente_id) continue
    const r = de(p.excedente_id)
    r.nEnviades++
    if (p.estado === 'acceptada') {
      r.nInteressades++
      if (p.aprovacio === 'pendent') r.nPerAprovar++
    }
  }
  for (const a of recs) {
    if (!a.excedente_id || !(ESTATS_REC_VIU as readonly string[]).includes(a.estado)) continue
    // Con más de uno vivo (no debería), el más reciente en la lista: se queda el primero.
    const r = de(a.excedente_id)
    if (!r.rec) r.rec = a
  }
  return out
}

/** Las columnas de la oferta que mira el punto del proceso. */
export interface OfertaLlistat {
  id: string
  estado: EstadoExcedente
  kg_total: number | string | null
  disponible_hasta: string | null
  motivo_no_colocada: string | null
  producte_al_camp: boolean
  espigolada_id: string | null
  desti_reclamat_at?: string | null
}

/** Los hechos que `puntOferta` sabe leer, a partir de la fila y su resumen. */
export function fetsDeLlistat(o: OfertaLlistat, r: ResumOferta | undefined, ara: Date = new Date()): FetsOferta {
  const res = r ?? RESUM_BUIT
  const total = Number(o.kg_total ?? 0)
  const falten = Math.max(0, total - res.kgCanalitzats)
  const diesEsperant = res.rec?.entregado_at
    ? Math.floor((ara.getTime() - new Date(res.rec.entregado_at).getTime()) / 86_400_000)
    : null
  return {
    estado: o.estado,
    kgTotal: total,
    kgCanalitzats: res.kgCanalitzats,
    nEnviades: res.nEnviades,
    nInteressades: res.nInteressades,
    nPerAprovar: res.nPerAprovar,
    albaraRec: res.rec
      ? { estado: res.rec.estado as EstadoAlbaran, numero: res.rec.numero_completo, diesEsperant }
      : null,
    motiu: o.motivo_no_colocada,
    // La misma regla que la ficha (`OfferDetail`): pasada la fecha con kilos sin cubrir.
    vencuda: o.disponible_hasta != null && new Date(o.disponible_hasta) < ara && falten > 0,
    producteAlCamp: o.producte_al_camp,
    espigoladaId: o.espigolada_id,
    id: o.id,
    destiReclamat: Boolean(o.desti_reclamat_at),
    nRecollidesPerValidar: res.nPerValidar,
  }
}

// --- Qué enseña cada columna (20-11-2026) ------------------------------------------------
//
// El listado se lee de izquierda a derecha como una pregunta: ¿cuál es la oferta (referencia),
// cuándo entró (fecha), quién la hizo (ofertante), qué es y cuánto había (producto y kilos
// ofrecidos), cuánto se ha colocado (barra), en qué estado está. Los receptores NO van en el
// listado: una oferta se reparte entre varios y eso se ve en su detalle, no aquí.

/** La productora tal y como la devuelve el embebido `productores(name, empresa)`. */
export interface OfertantLlistat {
  name: string | null
  empresa: string | null
}

/** El nombre que se ve: la empresa y, si no hay, la persona; «—» sin ninguna. */
export function nomOfertant(p: OfertantLlistat | null | undefined): string {
  return p?.empresa?.trim() || p?.name?.trim() || '—'
}

/** Los kilos de la barra: ofrecidos, con salida, pendientes y el porcentaje (0–100, entero). */
export interface KgOferta {
  total: number
  canalitzats: number
  falten: number
  pct: number
}

/**
 * Kilos ofrecidos frente a los que ya tienen salida (canalizaciones vivas: `kgPerOferta`).
 * Lo pendiente nunca es negativo y el porcentaje no pasa del 100 aunque se asigne de más.
 */
export function kgDeLaFila(total: number | string | null | undefined, canalitzats: number): KgOferta {
  const t = Number(total ?? 0)
  const c = Math.max(0, canalitzats)
  return {
    total: t,
    canalitzats: c,
    falten: Math.max(0, t - c),
    pct: t > 0 ? Math.min(100, Math.round((c / t) * 100)) : 0,
  }
}

/** El sentido de la fecha: `recent` = lo último arriba, `antiga` = lo primero arriba. */
export type OrdreData = 'recent' | 'antiga'

/**
 * Ordena por una fecha ISO. Las filas sin fecha van SIEMPRE al final (no se mezclan con las
 * más antiguas ni con las más recientes) y, a igual fecha, `desempat` decide para que el
 * orden sea estable entre recargas. No toca el original.
 */
export function ordenaPerData<T>(
  files: readonly T[],
  data: (f: T) => string | null | undefined,
  ordre: OrdreData,
  desempat: (f: T) => string = () => '',
): T[] {
  const sentit = ordre === 'antiga' ? 1 : -1
  return [...files].sort((a, b) => {
    const da = data(a) ?? ''
    const db = data(b) ?? ''
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return sentit * (da.localeCompare(db) || desempat(a).localeCompare(desempat(b)))
  })
}

// --- La frase de la fila ----------------------------------------------------------------

/** La línea corta bajo el badge: una clave, lo que interpola y si le toca al equipo. */
export interface PasLlistat {
  clau: string
  vars: Record<string, string | number>
  /** `true` = la acción es del equipo: se pinta en `aviso` (§6ter, «lo que te toca»). */
  emToca: boolean
}

/**
 * Todas las claves que puede devolver `pasLlistat`. La prueba exige que existan en `ca` y en
 * `es`: el componente las pinta con `t(clau)` y `cobertura.test.ts` no las ve. Las que
 * cuentan llevan `n` y su singular `<clau>_1`, que `t()` elige sola cuando n = 1 (§7).
 */
export const CLAUS_PAS_LLISTAT: readonly string[] = [
  'off.pas_sense_enviar',
  'off.pas_esperant_interes',
  'off.pas_per_aprovar',
  'off.pas_busca_resta',
  'off.pas_esperant_recollida',
  'off.pas_recollida_retornada',
  'off.pas_per_conciliar',
  'proc.e_recollida_validacio_t',
  'proc.e_recollida_emes_t',
  'proc.e_recollida_entregat_t',
  'proc.e_tancada_t',
  'proc.e_vencuda_t',
  'proc.e_sense_desti_t',
] as const

/**
 * En qué punto del proceso está la oferta, en una frase corta para la fila.
 *
 * `null` cuando no hay nada que añadir al badge: la oferta en espigolada (lo cuenta su
 * propia etiqueta), la que espera validación (el badge ya dice «Per validar»), la coberta
 * sin nada pendiente que se sepa y las del Històric (el badge es el final).
 */
export function pasLlistat(punt: PuntProces, fets: FetsOferta, r: ResumOferta | undefined): PasLlistat | null {
  const res = r ?? RESUM_BUIT
  const fes = (clau: string, emToca: boolean, vars: Record<string, string | number> = {}): PasLlistat =>
    ({ clau, vars, emToca })

  if (fets.estado === 'borrador') return null

  // Entre el reparto y la recogida, el modelo solo sabe «assignada»: aquí se precisa con lo
  // que dice cada canalización. Primero lo que espera al receptor; si no, lo que queda.
  const enReparto = punt.etapa === 'assignada' || punt.etapa === 'publicada'
  if (enReparto && punt.variant !== 'validacio') {
    if (res.nRetornades > 0) return fes('off.pas_recollida_retornada', false)
    if (res.nEsperantRecollida > 0) {
      return fes('off.pas_esperant_recollida', false, { n: res.nEsperantRecollida })
    }
  }

  switch (punt.etapa) {
    case 'publicada':
      if (punt.variant === 'validacio') return null
      if (res.nPerAprovar > 0) return fes('off.pas_per_aprovar', true, { n: res.nPerAprovar })
      if (punt.variant === 'gestio') return fes('off.pas_esperant_interes', false)
      return fes('off.pas_sense_enviar', true)
    case 'assignada':
      if (res.nPerAprovar > 0) return fes('off.pas_per_aprovar', true, { n: res.nPerAprovar })
      return punt.variant === 'parcial' ? fes('off.pas_busca_resta', true) : null
    case 'vencuda':
      return fes('proc.e_vencuda_t', true)
    case 'recollida':
      if (punt.variant === 'validacio') return fes('proc.e_recollida_validacio_t', true)
      if (punt.variant === 'emes') return fes('proc.e_recollida_emes_t', punt.emToca)
      return fes('proc.e_recollida_entregat_t', punt.emToca)
    case 'confirmada':
      return fes('off.pas_per_conciliar', punt.emToca)
    case 'tancada':
      // Una que todavía no es `cerrada` pero ya tiene el REC conciliado (le falta el destino
      // de algún kilo): se dice; las del Històric no llevan línea.
      return fets.estado === 'cerrada' ? null : fes('proc.e_tancada_t', false)
    case 'sense_desti':
      return fes('proc.e_sense_desti_t', punt.emToca)
    default:
      return null
  }
}

/** Atajo para la fila: los hechos, el punto y la frase en una llamada. */
export function pasDeLaFila(o: OfertaLlistat, r: ResumOferta | undefined, ara: Date = new Date()): PasLlistat | null {
  const fets = fetsDeLlistat(o, r, ara)
  return pasLlistat(puntOferta(fets, 'equip'), fets, r)
}

// --- El Històric: paginación y filtros en el servidor -----------------------------------

export const MIDA_PAGINA_HISTORIC = 25

/** El `range()` de PostgREST (inclusivo) de una página que empieza en 0. */
export function rangPagina(pagina: number, mida = MIDA_PAGINA_HISTORIC): { des: number; fins: number } {
  const p = Math.max(0, Math.floor(pagina))
  return { des: p * mida, fins: p * mida + mida - 1 }
}

/** Cuántas páginas hay (como mínimo una, aunque esté vacía). */
export function nombrePagines(total: number, mida = MIDA_PAGINA_HISTORIC): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / mida))
}

/** «n–m de total»: lo que se ve en la página. Con 0 filas, `a = b = 0`. */
export function textPagina(pagina: number, nFiles: number, total: number, mida = MIDA_PAGINA_HISTORIC): { a: number; b: number; total: number } {
  if (nFiles <= 0) return { a: 0, b: 0, total }
  const a = rangPagina(pagina, mida).des + 1
  return { a, b: a + nFiles - 1, total }
}

/**
 * El valor de un `ilike` dentro de un `.or()` de PostgREST, o `null` si no hay nada que buscar.
 *
 * Dos capas de escape, en este orden:
 *   1. LIKE: `\`, `%` y `_` del texto se buscan tal cual (barra delante). El `*`, que
 *      PostgREST traduce a `%`, se quita: no aporta nada a una búsqueda.
 *   2. PostgREST: el valor va ENTRE COMILLAS, así que `,`, `(` y `)` ya no parten el filtro;
 *      dentro de las comillas, `\` y `"` llevan barra.
 * Comprobado contra el clon (19-11-2026): «a,b(c)» y «"x» dan 0 filas sin error, y `\%` busca
 * un `%` literal en vez de casar con todo.
 */
export function patroIlike(text: string): string | null {
  const net = text.replace(/\*/g, '').trim()
  if (!net) return null
  const like = net.replace(/[\\%_]/g, (c) => `\\${c}`)
  const cometes = like.replace(/[\\"]/g, (c) => `\\${c}`)
  return `"*${cometes}*"`
}

/** Las columnas en las que busca el Històric. */
export const CAMPS_CERCA_HISTORIC = ['id_excedente', 'producto', 'variedad'] as const

/** La expresión completa del `.or()` del buscador, o `null` sin texto. */
export function filtreCercaHistoric(text: string): string | null {
  const p = patroIlike(text)
  if (!p) return null
  return CAMPS_CERCA_HISTORIC.map((c) => `${c}.ilike.${p}`).join(',')
}

/**
 * Los límites de un rango de días (`aaaa-mm-dd`, inclusivos) en instantes: desde el principio
 * del primer día y hasta ANTES del principio del día siguiente al último, en la hora local de
 * quien mira. Así «fins al 30» incluye lo que se cerró el 30 a las 23:59, y un cierre a las
 * 00:30 en Barcelona (22:30 UTC del día anterior) cae en el día que se ve en pantalla.
 */
export function limitsDies(desDe: string, finsA: string): { gte: string | null; lt: string | null } {
  const dia = (s: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    // `new Date` desborda en silencio (el 45 de un mes es otro día): eso no es una fecha.
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null
  }
  const ini = dia(desDe)
  const fi = dia(finsA)
  if (fi) fi.setDate(fi.getDate() + 1)
  return { gte: ini ? ini.toISOString() : null, lt: fi ? fi.toISOString() : null }
}
