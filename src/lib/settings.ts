// Configuración global de la app (tabla `app_settings`). Dos interruptores hoy:
//
//   · **modo test** — a QUIÉN se envía: activo, solo a las fichas marcadas `es_test`.
//   · **WhatsApp activo** — POR DÓNDE: apagado, no sale ni un mensaje por WhatsApp y
//     todo lo que tiene equivalente va por correo (§8, §8bis).
//
// Los dos son fail-safe, pero en sentidos contrarios y a propósito: la duda debe CORTAR un
// envío a alguien que no es de prueba, y NO debe dejar la plataforma muda. Mismo criterio
// que en el servidor (`_shared/gate.ts`).
//
// ⚠️ Escribir aquí exige `es_super_admin()` (RLS de `app_settings`): cualquier miembro del
//    equipo ve la pantalla, pero solo el super_admin consigue guardar.

import { supabase } from './supabase'

/** Lee una clave. `null` si no está o no se puede leer. */
async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', key).maybeSingle()
  return (data as { value: string | null } | null)?.value ?? null
}

/** Escribe una clave. Devuelve el mensaje de error o null. */
async function setSetting(key: string, value: string): Promise<string | null> {
  const { error } = await supabase.from('app_settings').upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  return error?.message ?? null
}

/** ¿Modo test activo? Solo un `'false'` explícito lo apaga (default ON). */
export async function getTestMode(): Promise<boolean> {
  return (await getSetting('test_mode')) !== 'false'
}

/** Guarda el modo test. Devuelve el mensaje de error o null. */
export async function setTestMode(activo: boolean): Promise<string | null> {
  return setSetting('test_mode', activo ? 'true' : 'false')
}

/** ¿WhatsApp activo? Solo un `'false'` explícito lo apaga (default ON). */
export async function getWhatsappActiu(): Promise<boolean> {
  return (await getSetting('whatsapp_activo')) !== 'false'
}

/** Guarda el interruptor de WhatsApp. Devuelve el mensaje de error o null. */
export async function setWhatsappActiu(activo: boolean): Promise<string | null> {
  return setSetting('whatsapp_activo', activo ? 'true' : 'false')
}

/**
 * Cuántas fichas se quedarían INCONTACTABLES al apagar WhatsApp: las que tienen teléfono
 * y no tienen correo. Es el precio de apagarlo y hay que verlo antes de pulsar, no después
 * — de 345 productores, la mayoría llegó del import de ARA sin correo.
 *
 * Ante un error de lectura devuelve ceros: el aviso se queda corto, pero no bloquea una
 * decisión que el servidor va a aplicar igual.
 */
export async function fitxesSenseCorreuAmbTelefon(): Promise<{ productors: number; entitats: number }> {
  const senseCorreu = 'email.is.null,email.eq.'
  const [prod, ent] = await Promise.all([
    supabase.from('productores').select('id', { count: 'exact', head: true })
      .not('phone', 'is', null).or(senseCorreu),
    supabase.from('entidades').select('id', { count: 'exact', head: true })
      .not('telefono', 'is', null).or(senseCorreu),
  ])
  return { productors: prod.count ?? 0, entitats: ent.count ?? 0 }
}
