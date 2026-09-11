// Asegurar un contacto de WhatsApp antes de abrir la mensajería.
//
// Vivía dentro de App.tsx (`openMessagingWithContact`), donde estaba atado al estado
// raíz. Al pasar a rutas, la parte de datos se queda aquí y la navegación la pone cada
// pantalla: así los listados de productores y entidades siguen con la misma prop.

import { supabase } from './supabase'

/** Crea el `wa_contact` si no existe y sincroniza su nombre. Nunca lanza. */
export async function assegurarContacte(phone: string, name: string | null): Promise<void> {
  if (!phone) return
  const { error } = await supabase.from('wa_contacts').upsert(
    { phone, name, opt_in: true, opt_in_at: new Date().toISOString() },
    { onConflict: 'phone', ignoreDuplicates: true },
  )
  if (error) console.error('wa_contacts upsert:', error.message)
  if (name) {
    const { error: nameError } = await supabase.from('wa_contacts').update({ name }).eq('phone', phone)
    if (nameError) console.error('wa_contacts nombre:', nameError.message)
  }
}

/**
 * Mensajes sin contestar por teléfono, **contados en la base**.
 *
 * Antes esto era `select contact_phone, direction, created_at from wa_messages` sin filtro ni
 * paginación, en tres pantallas distintas y en cada login del equipo, todo para pintar un
 * número (deuda §12.5). La regla en sí —entrantes posteriores al último saliente— sigue
 * escrita y probada en `mensajes.ts`; aquí está la consulta.
 *
 * **Nunca lanza**, como el resto de este fichero: si la RPC falla —típicamente porque la
 * migración no está aplicada en esa base— devuelve un objeto vacío. Un contador a cero es
 * mejor que una pantalla que no carga.
 */
export async function pendentsPerTelefon(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('missatges_sense_contestar')
  if (error || !data) return {}
  const counts: Record<string, number> = {}
  for (const fila of data as { contact_phone: string; pendents: number | string }[]) {
    counts[fila.contact_phone] = Number(fila.pendents)
  }
  return counts
}
