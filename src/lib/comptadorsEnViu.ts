// Los contadores en vivo (fase 5 de los puntos 4-6): qué tabla de Realtime refresca qué. PURO,
// con test (`tests/comptadorsEnViu.test.ts`); el canal lo abre `hooks/useComptadorsEnViu.ts`.
//
// Hasta aquí los badges se refrescaban al cambiar de ruta y tras cada acción propia: una entidad
// que mostraba interés no movía el badge de Aprovacions del equipo hasta que alguien navegaba.
// Ahora un solo canal por sesión escucha las tablas que alimentan los contadores y, con un
// debounce, pide de nuevo SOLO los contadores —nunca una pantalla entera—:
//
//   · `equip`    → `refrescaComptadors()` (la RPC `pendents_equip()`: los badges del menú del
//                  equipo y la tarjeta del tablero);
//   · `pendents` → `pendents_meus()` del panel externo (badges de Documents e Interessos);
//   · `avisos`   → la campana y los badges de avisos sin leer;
//   · `mercat`   → el badge «noves» del Mercat del receptor.
//
// ⚠️ Las tablas tienen que estar en la publicación `supabase_realtime` (20270610100200): una que
//    no esté no da error, simplemente no llega ningún evento y el contador se queda como antes
//    (se refresca al navegar). Realtime aplica la RLS de quien escucha y filtra las columnas por
//    el GRANT: cada cuenta solo recibe lo que ya podía leer.

export type Refresc = 'equip' | 'pendents' | 'avisos' | 'mercat'

/** Quién mira: decide qué tablas se escuchan. Doble rol = las de los dos paneles. */
export interface QuiMira {
  intern: boolean
  extern: boolean
  receptor: boolean
}

/** Lo que tarda en pedir de nuevo los contadores tras el primer cambio (los siguientes se juntan). */
export const DEBOUNCE_MS = 1000

/**
 * Las colas de `pendents_equip()` y de qué tabla sale cada una: registros (`membresias`),
 * convenios por contrafirmar, ofertas por validar, modificadas o sin enviar (`excedentes`,
 * `excedentes_canvis`, `oferta_respuestas`), intereses por aprobar, recogidas por validar o por
 * registrar (`canalizaciones`), mensajes sin leer (`wa_messages`), albaranes, firmas subidas y
 * documentos con error.
 */
export const TAULES_EQUIP: readonly string[] = [
  'excedentes', 'canalizaciones', 'oferta_respuestas', 'membresias', 'wa_messages',
  'convenios', 'albaranes', 'firmes_document', 'excedentes_canvis', 'documentos',
] as const

/**
 * Las de los paneles externos: lo que alimenta `pendents_meus()` (convenios y albaranes por
 * firmar o confirmar, documentos por firmar, propuestas de cambios por responder), los avisos y,
 * para el receptor, las ofertas nuevas del Mercat.
 */
const TAULES_EXTERN: Readonly<Record<string, readonly Refresc[]>> = {
  avisos: ['avisos'],
  convenios: ['pendents'],
  albaranes: ['pendents'],
  firmes_document: ['pendents'],
  documentos: ['pendents'],
  oferta_respuestas: ['pendents'],
}

/** Las tablas a las que suscribirse, sin repetir. */
export function taulesASubscriure(qui: QuiMira): string[] {
  const s = new Set<string>()
  if (qui.intern) for (const t of TAULES_EQUIP) s.add(t)
  if (qui.extern) for (const t of Object.keys(TAULES_EXTERN)) s.add(t)
  if (qui.receptor) s.add('excedentes')
  return [...s].sort()
}

/** Qué hay que refrescar cuando cambia una fila de esa tabla. */
export function refrescosDe(taula: string, qui: QuiMira): Refresc[] {
  const r = new Set<Refresc>()
  if (qui.intern && TAULES_EQUIP.includes(taula)) r.add('equip')
  if (qui.extern) for (const x of TAULES_EXTERN[taula] ?? []) r.add(x)
  if (qui.receptor && taula === 'excedentes') r.add('mercat')
  return [...r].sort()
}

/** Lo justo de un aviso para no contar dos veces una propuesta. */
export interface AvisMinim {
  tipus: string
  objecte_id: string
  llegit_at: string | null
}

/**
 * El badge de «Els meus interessos»: los avisos sin leer (`noLlegitsPerPanell`) más las
 * propuestas de cambios que la entidad tiene por responder. Una propuesta con su aviso
 * `canvis_proposats` todavía sin leer ya está contada en los avisos: no se suma otra vez. Así el
 * badge no baja al abrir la pantalla (que marca los avisos como leídos) mientras quede una
 * propuesta por responder, y no marca 2 por una sola.
 */
export function comptaInteressos(noLlegits: number, avisos: readonly AvisMinim[], propostes: readonly string[]): number {
  const ambAvis = new Set(avisos
    .filter((a) => a.llegit_at == null && a.tipus === 'canvis_proposats')
    .map((a) => a.objecte_id))
  return noLlegits + propostes.filter((id) => !ambAvis.has(id)).length
}
