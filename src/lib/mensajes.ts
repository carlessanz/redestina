// La REGLA de «sin contestar», y nada más.
//
// ⚠️ Este módulo no importa nada a propósito, y conviene que siga así: es lo que permite
// probarlo desde Vitest en Node sin levantar un cliente de Supabase. La consulta que lo
// calcula en la base vive en `contactes.ts`, con las demás consultas.

export interface MessageRow {
  contact_phone: string
  direction: 'inbound' | 'outbound'
  created_at: string
}

/**
 * Cuenta, por teléfono, los mensajes entrantes posteriores al último saliente:
 * los que están "sin contestar". Devuelve { phone: nº pendientes }.
 *
 * ⚠️ **No es el camino normal desde el 11-09-2026**: para saber esto había que traerse
 * `wa_messages` ENTERA al navegador, en tres sitios distintos y en cada login (deuda §12.5).
 * Ahora lo agrega la base con `missatges_sense_contestar()`. Esta función se queda porque
 * sigue siendo la especificación legible de la regla —y la que tiene pruebas—, y porque es el
 * respaldo si la RPC no está disponible (una base sin la migración aplicada).
 */
export function countUnanswered(rows: MessageRow[]): Record<string, number> {
  const lastOutbound: Record<string, string> = {}
  for (const row of rows) {
    if (row.direction === 'outbound' && (lastOutbound[row.contact_phone] ?? '') < row.created_at) {
      lastOutbound[row.contact_phone] = row.created_at
    }
  }
  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (row.direction !== 'inbound') continue
    const last = lastOutbound[row.contact_phone]
    if (!last || row.created_at > last) counts[row.contact_phone] = (counts[row.contact_phone] ?? 0) + 1
  }
  return counts
}
