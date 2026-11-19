// Los albaranes de una RECOGIDA (fase 3 de los puntos 4-6, 20270608100100): qué ENT y qué REC
// son de cada canalización, y cuál representa a la oferta entera.
//
// Hasta esta fase había UN REC por oferta, que esperaba a todas las recogidas, y las pantallas
// lo buscaban con un `find(tipo === 'REC')`. Ahora una donación tiene, por cada recogida, su ENT
// y SU PROPIO REC (`albaranes.canalizacion_id` = la canalización), que nacen en borrador al
// asignar y salen emitidos y conciliados al validar la recogida. Una oferta con un REC HEREDADO
// (uno por oferta, `canalizacion_id is null`) sigue el modelo viejo, y la base garantiza que una
// oferta no mezcla los dos. Venta y maquila no tienen albarán de Redestina.
//
// ⚠️ El mismo `find` por `canalizacion_id` de antes ahora puede devolver el REC en vez del ENT:
//    por eso la salida se busca SIEMPRE con el tipo (`sortidaDe`).
//
// Puro y con pruebas (`tests/albaransRecollida.test.ts`): sin React ni Supabase.

/** Lo mínimo de un albarán para casarlo con su recogida. */
export interface AlbaraMinim {
  id: string
  tipo: string
  estado: string
  canalizacion_id: string | null
  espigolada_id?: string | null
}

/** Un albarán anulado o rectificado ya no es el de nadie: el bueno es otro. */
export function albaraViu(a: Pick<AlbaraMinim, 'estado'>): boolean {
  return a.estado !== 'anulado' && a.estado !== 'rectificado'
}

/** Cuánto ha avanzado un albarán, para comparar entre varios (borrador = 0). */
const AVANC: Record<string, number> = {
  borrador: 0, emitido: 1, entregado: 2, confirmado: 3, conciliado: 4,
}
export function avancAlbara(a: Pick<AlbaraMinim, 'estado'> | null | undefined): number {
  if (!a || !albaraViu(a)) return -1
  return AVANC[a.estado] ?? 0
}

/** La salida (ENT u OPE) de una canalización: la viva; si no hay ninguna viva, la última. */
export function sortidaDe<T extends AlbaraMinim>(albarans: readonly T[], canalitzacio: string): T | null {
  const propies = albarans.filter((a) => (a.tipo === 'ENT' || a.tipo === 'OPE') && a.canalizacion_id === canalitzacio)
  return propies.find(albaraViu) ?? propies[0] ?? null
}

/** ¿Esta oferta sigue el modelo nuevo (algún REC con su canalización)? */
export function teRecPerRecollida(albarans: readonly AlbaraMinim[]): boolean {
  return albarans.some((a) => a.tipo === 'REC' && a.canalizacion_id != null)
}

/** El REC heredado de la oferta (uno por oferta, sin canalización ni jornada), si vive. */
export function recHeretat<T extends AlbaraMinim>(albarans: readonly T[]): T | null {
  return albarans.find((a) => a.tipo === 'REC' && a.canalizacion_id == null && albaraViu(a)) ?? null
}

/**
 * El REC de una recogida: el SUYO (por `canalizacion_id`) o, si no lo hay, el heredado de la
 * oferta. Es lo mismo que hace la base en `operacio_detall()` y `validar_recollida()`.
 */
export function recDe<T extends AlbaraMinim>(albarans: readonly T[], canalitzacio: string): T | null {
  const propis = albarans.filter((a) => a.tipo === 'REC' && a.canalizacion_id === canalitzacio)
  return propis.find(albaraViu) ?? recHeretat(albarans) ?? propis[0] ?? null
}

/**
 * El REC que cuenta la etapa de la OFERTA entera: el vivo MENOS avanzado (con varios REC por
 * oferta, la oferta va al ritmo de la recogida más atrasada; es el mismo criterio que
 * `canalitzacions_actives()` en la base).
 *
 * `canals`, si se pasan: un REC por recogida no existe para quien no lo puede ver todavía (el
 * productor no ve los borradores), así que con alguna recogida viva sin conciliar la oferta NO
 * puede estar «tancada» por mucho que todos los REC visibles estén conciliados. En ese caso se
 * devuelve el menos avanzado de los que no están conciliados, o null.
 */
export function recDeLOferta<T extends AlbaraMinim>(
  albarans: readonly T[],
  canals?: readonly { id: string; estado?: string | null }[],
): T | null {
  const vius = albarans.filter((a) => a.tipo === 'REC' && albaraViu(a))
  if (vius.length === 0) return null
  const ordenats = [...vius].sort((a, b) => avancAlbara(a) - avancAlbara(b))
  const pendents = (canals ?? []).some((c) => c.estado !== 'anulada' && c.estado !== 'conciliada')
  if (pendents && teRecPerRecollida(vius)) {
    return ordenats.find((a) => a.estado !== 'conciliado') ?? null
  }
  return ordenats[0]
}

/** Venta o maquila: sin albarán de Redestina desde la fase 3 (salvo un OPE heredado ya emitido). */
export function esVendaOMaquila(valorizacion: string | null | undefined): boolean {
  return valorizacion === 'venda' || valorizacion === 'maquila'
}

/**
 * Los albaranes de una recogida en el orden en que se leen: primero la salida (ENT/OPE) y
 * después el REC (el suyo o el heredado). Lo que no existe no sale.
 */
export function albaransDeLaRecollida<T extends AlbaraMinim>(albarans: readonly T[], canalitzacio: string): T[] {
  const s = sortidaDe(albarans, canalitzacio)
  const r = recDe(albarans, canalitzacio)
  return [s, r].filter((a): a is T => a != null)
}

/** Lo que hace falta de una canalización para saber si su recogida ya es trabajo del equipo. */
export interface CanalPerRegistrar {
  id: string
  estado: string | null
  valorizacion: string | null
  data_hora_recollida: string | null
  created_at: string
  recollida_registrada_at: string | null
  recollida_validada_at: string | null
  recollida_retornada_at: string | null
}

const DOS_DIES = 2 * 86_400_000

/**
 * La cola `recollides_equip` de `pendents_equip()` (20270608100100), en cliente: una venta o
 * maquila viva y sin conciliar, sin registro ni validación (o devuelta hace más de dos días),
 * con la hora de recogida pasada (o sin hora y asignada hace más de dos días), y sin ningún
 * ENT/OPE vivo. Tiene que dar la MISMA lista que cuenta la base: el badge y la cola no pueden
 * discrepar.
 */
export function esRecollidaDelEquip(
  c: CanalPerRegistrar,
  albarans: readonly AlbaraMinim[],
  ara: number = Date.now(),
): boolean {
  if (!esVendaOMaquila(c.valorizacion)) return false
  if (c.estado === 'anulada' || c.estado === 'conciliada') return false
  if (c.recollida_registrada_at != null || c.recollida_validada_at != null) return false
  if (c.recollida_retornada_at != null && new Date(c.recollida_retornada_at).getTime() >= ara - DOS_DIES) return false
  const vencuda = c.data_hora_recollida != null
    ? new Date(c.data_hora_recollida).getTime() <= ara
    : new Date(c.created_at).getTime() < ara - DOS_DIES
  if (!vencuda) return false
  return !albarans.some((a) => (a.tipo === 'ENT' || a.tipo === 'OPE') && a.canalizacion_id === c.id && albaraViu(a))
}
