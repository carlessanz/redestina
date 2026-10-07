// Lista de correos de prueba para el canal de email (Resend). Análogo a metaTest.ts.
// Ver AGENTS.md §4/§8.

import { supabase } from './supabase'

export interface EmailTestRecipient {
  email: string
  etiqueta: string | null
  created_at: string
}

export async function listarEmailsTest(): Promise<EmailTestRecipient[]> {
  const { data, error } = await supabase
    .from('email_test_recipients')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('email_test_recipients list:', error.message)
    return []
  }
  return data ?? []
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Clave i18n si falla, o `null`. Mismo contrato que `anadirNumeroTest`. */
export async function anadirEmailTest(email: string, etiqueta: string): Promise<string | null> {
  const limpio = email.trim().toLowerCase()
  if (!EMAIL_RE.test(limpio)) return 'wl.bad_email'
  const { error } = await supabase
    .from('email_test_recipients')
    .insert({ email: limpio, etiqueta: etiqueta.trim() || null })
  if (error) {
    if (error.code === '23505') return 'wl.dup_email'
    return error.code === '42501' ? 'wl.no_perm' : 'c.error'
  }
  return null
}

/** Clave i18n si no se borró, o `null`. Mismo contrato que `borrarNumeroTest`. */
export async function borrarEmailTest(email: string): Promise<string | null> {
  const { data, error } = await supabase.from('email_test_recipients').delete().eq('email', email).select('email')
  if (error) { console.error('email_test_recipients delete:', error.message); return 'c.error' }
  return data && data.length > 0 ? null : 'wl.no_perm'
}
