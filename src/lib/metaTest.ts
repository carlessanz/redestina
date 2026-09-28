// Lista de números de prueba de Meta (whitelist de destinatarios).
//
// El entorno de test de la Cloud API solo entrega a ≤5 números dados de alta a
// mano en el panel de Meta; no hay API para consultarlos, así que la app guarda
// su propia copia en `meta_test_recipients` y la usa para saber quién puede
// recibir. Ver AGENTS.md §9/§12.

import { supabase } from './supabase'

export interface MetaTestRecipient {
  phone: string
  etiqueta: string | null
  created_at: string
}

// Devuelve los números de la lista como Set, para comprobar pertenencia en O(1).
export async function cargarNumerosTest(): Promise<Set<string>> {
  const { data, error } = await supabase.from('meta_test_recipients').select('phone')
  if (error) {
    console.error('meta_test_recipients select:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.phone))
}

// Lista completa (con etiqueta y fecha) para el gestor del Dashboard.
export async function listarNumerosTest(): Promise<MetaTestRecipient[]> {
  const { data, error } = await supabase
    .from('meta_test_recipients')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('meta_test_recipients list:', error.message)
    return []
  }
  return data ?? []
}

/**
 * Devuelve una CLAVE i18n si falla (la traduce quien pinta), o `null` si fue bien. Antes
 * devolvía texto en castellano escrito a mano y, ante cualquier otro error, el mensaje crudo
 * de Postgres —«new row violates row-level security policy…» a un técnico—.
 */
export async function anadirNumeroTest(phone: string, etiqueta: string): Promise<string | null> {
  const limpio = phone.replace(/\D/g, '')
  if (!/^[1-9]\d{6,14}$/.test(limpio)) return 'wl.bad_phone'
  const { error } = await supabase
    .from('meta_test_recipients')
    .insert({ phone: limpio, etiqueta: etiqueta.trim() || null })
  if (error) {
    if (error.code === '23505') return 'wl.dup_phone'
    return error.code === '42501' ? 'wl.no_perm' : 'c.error'
  }
  return null
}

/**
 * Clave i18n si no se borró, o `null`. Un DELETE que la RLS no deja pasar no da error: borra
 * cero filas, así que se piden las filas borradas (§12.48).
 */
export async function borrarNumeroTest(phone: string): Promise<string | null> {
  const { data, error } = await supabase.from('meta_test_recipients').delete().eq('phone', phone).select('phone')
  if (error) { console.error('meta_test_recipients delete:', error.message); return 'c.error' }
  return data && data.length > 0 ? null : 'wl.no_perm'
}
