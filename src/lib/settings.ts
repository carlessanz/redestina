// Configuración global de la app (tabla `app_settings`). Los interruptores de envío:
//
//   · **modo test** — a QUIÉN se envía: activo, solo a las fichas marcadas `es_test`.
//   · **notificaciones** (27-10-2026) — el general, más uno por canal (correo y WhatsApp):
//     POR DÓNDE se envía, y si se envía. Apagar el general apaga los dos canales; encenderlo
//     no los enciende. Se escriben por RPC (`fixar_notificacions`, `fixar_canal_notificacio`)
//     para que esa regla la imponga la base y no esta pantalla (§8).
//
// Los dos son fail-safe, pero en sentidos contrarios y a propósito: la duda debe CORTAR un
// envío a alguien que no es de prueba, y NO debe dejar la plataforma muda. Mismo criterio
// que en el servidor (`_shared/gate.ts`).
//
// ⚠️ Escribir aquí exige `es_super_admin()` (RLS de `app_settings`): cualquier miembro del
//    equipo ve la pantalla, pero solo el super_admin consigue guardar.

import { supabase } from './supabase'
import type { Canal, Canals } from './canals'

/** Lee una clave. `null` si no está o no se puede leer. */
async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', key).maybeSingle()
  return (data as { value: string | null } | null)?.value ?? null
}

/**
 * Escribe una clave. Devuelve una CLAVE i18n de error o null.
 *
 * ⚠️ A quien no es super_admin la RLS no le da error: responde 200 con cero filas, y la
 * pantalla decía «desat». Por eso se piden las filas escritas (`.select`) y cero filas se
 * trata como denegación (el argumento de §12.48).
 */
async function setSetting(key: string, value: string): Promise<string | null> {
  const { data, error } = await supabase.from('app_settings').upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  ).select('key')
  if (error) return 'c.error'
  if (!data || data.length === 0) return 'set.denied'
  return null
}

/** ¿Modo test activo? Solo un `'false'` explícito lo apaga (default ON). */
export async function getTestMode(): Promise<boolean> {
  return (await getSetting('test_mode')) !== 'false'
}

/** Guarda el modo test. Devuelve una clave i18n de error o null. */
export async function setTestMode(activo: boolean): Promise<string | null> {
  return setSetting('test_mode', activo ? 'true' : 'false')
}

/**
 * Los tres interruptores, ya EFECTIVOS (con el general apagado, los canales también lo
 * están), con la misma regla que `resolCanals()` del servidor. Solo lo puede leer el equipo;
 * el resto de la aplicación los recibe en el contexto de sesión (`useCanals`).
 */
export async function getCanals(): Promise<Canals> {
  const { data } = await supabase.from('app_settings').select('key, value')
    .in('key', ['notificacions_actives', 'email_activo', 'whatsapp_activo'])
  const files = (data ?? []) as { key: string; value: string | null }[]
  const v = (k: string) => files.find((f) => f.key === k)?.value !== 'false'
  const notificacions = v('notificacions_actives')
  return { notificacions, email: notificacions && v('email_activo'), whatsapp: notificacions && v('whatsapp_activo') }
}

/** El código de error de una de las dos RPC, como clave i18n. */
function errorRpc(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null
  if (error.code === '42501') return 'set.denied'
  if ((error.message ?? '').includes('notificacions_desactivades')) return 'canal.motiu_notificacions'
  return 'c.error'
}

/** El general. Con `false` apaga también los dos canales; con `true` solo el general. */
export async function fixarNotificacions(actives: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('fixar_notificacions', { p_actives: actives })
  return errorRpc(error)
}

/** Un canal. Encenderlo con el general apagado lo rechaza la base. */
export async function fixarCanal(canal: Canal, actiu: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('fixar_canal_notificacio', { p_canal: canal, p_actiu: actiu })
  return errorRpc(error)
}

/** ¿WhatsApp activo (efectivo)? */
export async function getWhatsappActiu(): Promise<boolean> {
  return (await getCanals()).whatsapp
}

/** Guarda el interruptor de WhatsApp. Devuelve una clave i18n de error o null. */
export async function setWhatsappActiu(activo: boolean): Promise<string | null> {
  return fixarCanal('whatsapp', activo)
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

/**
 * Cuántas fichas EMPEZARÍAN a recibir notificaciones al abrir el modo test a todos: las que no
 * son de prueba. Es la cifra que hay que ver antes de pulsar, sobre todo después de una
 * importación masiva. Ante un error, ceros (como las de abajo).
 */
export async function fitxesNoProva(): Promise<{ productors: number; entitats: number }> {
  const [prod, ent] = await Promise.all([
    supabase.from('productores').select('id', { count: 'exact', head: true }).eq('es_test', false),
    supabase.from('entidades').select('id', { count: 'exact', head: true }).eq('es_test', false),
  ])
  return { productors: prod.count ?? 0, entitats: ent.count ?? 0 }
}

/**
 * La simétrica para el correo: las fichas con correo y SIN teléfono se quedan sin vía al
 * apagarlo. Mismo criterio ante un error (ceros).
 */
export async function fitxesSenseTelefonAmbCorreu(): Promise<{ productors: number; entitats: number }> {
  const senseTelefon = (col: string) => `${col}.is.null,${col}.eq.`
  const [prod, ent] = await Promise.all([
    supabase.from('productores').select('id', { count: 'exact', head: true })
      .not('email', 'is', null).neq('email', '').or(senseTelefon('phone')),
    supabase.from('entidades').select('id', { count: 'exact', head: true })
      .not('email', 'is', null).neq('email', '').or(senseTelefon('telefono')),
  ])
  return { productors: prod.count ?? 0, entitats: ent.count ?? 0 }
}

/**
 * ¿Las ofertas nuevas esperan a que el equipo las valide? (05-10-2026). Fail-safe hacia
 * VALIDAR, como `validacio_ofertes_activa()` en la base: solo un `'false'` explícito lo apaga.
 */
export async function getValidacioOfertes(): Promise<boolean> {
  return (await getSetting('validacio_ofertes')) !== 'false'
}

/** Guarda el interruptor de validación. Devuelve una clave i18n de error o null. */
export async function setValidacioOfertes(activa: boolean): Promise<string | null> {
  return setSetting('validacio_ofertes', activa ? 'true' : 'false')
}
