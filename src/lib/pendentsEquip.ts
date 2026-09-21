// Lo que el EQUIPO tiene pendiente, en un solo sitio.
//
// POR QUÉ EXISTE (14-09-2026). Hasta hoy los badges del menú los calculaba `AppShell` con
// cinco consultas en cliente, una vez por sesión, y no se refrescaban nunca: aprobar un
// registro bajaba la cola pero el número del menú seguía igual hasta recargar. Y el
// tablero no enseñaba ninguno de esos números —tenía KPIs de volumen y las whitelists de
// prueba—, así que «qué tengo que hacer hoy» no estaba en ninguna parte. Lo pendiente
// quedaba repartido en ocho sitios sin conexión (§12.5, y la auditoría de UX).
//
// AHORA HAY UNA FUENTE: la RPC `pendents_equip()` (`20270323100000`), que devuelve siempre
// las trece colas con su cifra, y ESTE módulo la guarda en un store de módulo del que
// leen los dos consumidores —los badges del menú y la tarjeta «Pendent de l'equip» del
// tablero— con `useSyncExternalStore` (el mismo patrón que `useInstalacio`). Así las dos
// cifras no pueden discrepar, porque son la misma.
//
// CUÁNDO SE REFRESCA, y por qué no con Realtime: `AppShell` lo relanza en cada cambio de
// ruta (cubre «actúo y navego»), y las pantallas llaman a `refrescaComptadors()` tras
// cada acción que resuelve algo (cubre «actúo y me quedo»). Un canal de Realtime más por
// sesión para unos números que solo tienen que ser correctos cuando se miran no compensa.
// Coste: una llamada RPC por navegación, frente a las cinco consultas por login de antes.
//
// NUNCA LANZA: contrato de `albarans.ts`. Si la RPC no existe todavía (la migración va a
// producción antes que el frontend, §11) el store se queda vacío y los badges no salen,
// que es lo mismo que pasaba antes con una migración sin aplicar.

import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import type { ResultatRpc } from './albarans'
import type { Comptador } from './nav'

/**
 * Las trece colas que devuelve `pendents_equip()`, en su orden de proceso.
 *
 * ⚠️ ESTA UNIÓN ES UN FILTRO, no una etiqueta. `comptadorsDePendents()` y la tarjeta del
 *    tablero buscan por `cua`, así que una cola que la base devuelva y que no esté aquí no
 *    da ningún error de tipos —la fila llega igual dentro del array— pero **no la enseña
 *    nadie**: es una cifra que se descarta en silencio. Al añadir una cola en SQL hay que
 *    añadirla también aquí.
 */
export type CuaEquip =
  | 'registres' | 'convenis_contrasignar' | 'respostes' | 'missatges'
  | 'ofertes_sense_enviar' | 'ofertes_vencudes'
  | 'albarans_esborrany' | 'albarans_conciliar' | 'albarans_esperant'
  | 'costos' | 'tancament' | 'documents_error'
  // F3: ofertas que declaran producto sin cosechar y todavía no son una jornada.
  | 'espigolades_per_convertir'

export interface PendentEquip {
  cua: CuaEquip
  n: number
  /** Solo `tancament`: el id del cierre abierto más reciente. */
  ref: string | null
  /** Solo `tancament`: `{ ejercicio, modo, estado, bloquejats }`. */
  detall: Record<string, unknown> | null
}

export async function carregaPendentsEquip(): Promise<ResultatRpc<PendentEquip[]>> {
  try {
    const { data, error } = await supabase.rpc('pendents_equip')
    if (error) return { ok: false, missatge: error.message || 'pe.err_generic', codi: error.code ?? null }
    return { ok: true, data: (data as PendentEquip[] | null) ?? [] }
  } catch {
    return { ok: false, missatge: 'pe.err_generic', codi: null }
  }
}

// ---------------------------------------------------------------------------
// El store
// ---------------------------------------------------------------------------

let pendents: PendentEquip[] = []
let carregat = false
const oients = new Set<() => void>()

function subscriu(f: () => void) {
  oients.add(f)
  return () => { oients.delete(f) }
}
function avisa() { for (const f of oients) f() }

function llegeix() { return pendents }
function llegeixCarregat() { return carregat }

/**
 * Vuelve a pedir las cifras. La llaman `AppShell` al cambiar de ruta y cualquier pantalla
 * que acabe de resolver algo (`toast.success` → `refrescaComptadors()`).
 *
 * Concurrencia: si llegan dos llamadas seguidas, solo la última escribe. Es lo que evita
 * que una respuesta lenta pise a una más nueva al navegar rápido.
 */
let ultimaPeticio = 0
export async function refrescaComptadors(): Promise<void> {
  const meva = ++ultimaPeticio
  const r = await carregaPendentsEquip()
  if (meva !== ultimaPeticio) return
  pendents = r.ok ? r.data : []
  carregat = true
  avisa()
}

/** Para las pruebas y para vaciar el store al salir del panel de equipo. */
export function buidaComptadors(): void {
  pendents = []
  carregat = false
  avisa()
}

/**
 * De las trece colas a los cinco badges del menú. Es una función pura y está aquí, no en
 * `AppShell`, para que el tablero pueda enseñar la misma cifra que el badge sin recalcular.
 */
export function comptadorsDePendents(p: PendentEquip[]): Partial<Record<Comptador, number>> {
  const n = (cua: CuaEquip) => p.find((x) => x.cua === cua)?.n ?? 0
  return {
    // Las tres colas de la pantalla Aprovacions, sumadas: el desglose va en el tablero
    // y en el título de cada cola, no en el badge.
    aprovacions: n('registres') + n('convenis_contrasignar') + n('respostes'),
    missatges: n('missatges'),
    // Lo que espera al EQUIPO: borradores por emitir y REC por conciliar. Los que esperan
    // la confirmación de la otra parte (`albarans_esperant`) no cuentan aquí.
    albarans: n('albarans_esborrany') + n('albarans_conciliar'),
    costos: n('costos'),
    // Solo PDFs con error, como antes: es lo único de Documents que necesita una persona.
    documents: n('documents_error'),
  }
}

export function usePendentsEquip(): { pendents: PendentEquip[]; carregat: boolean } {
  const p = useSyncExternalStore(subscriu, llegeix, () => [] as PendentEquip[])
  const c = useSyncExternalStore(subscriu, llegeixCarregat, () => false)
  return { pendents: p, carregat: c }
}
