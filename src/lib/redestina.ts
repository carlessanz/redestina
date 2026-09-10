// Llamada a la Edge Function priorizar-entidades, firmada con la sesión.
// Igual que sendWhatsApp: nunca lanza, devuelve el error en el resultado.

import { supabase, supabaseUrl } from './supabase'

/** Canal por el que se contacta. Lo decide el servidor (_shared/canal.ts). */
export type Canal = 'whatsapp' | 'email' | 'cap'

/** Códigos estables del motivo; los traduce `motiuCanal()` en i18n. */
export type MotivoCanal =
  | 'finestra_oberta' | 'opt_in' | 'sense_telefon' | 'telefon_no_mobil'
  | 'sense_optin_ni_finestra' | 'sense_correu' | 'sense_canal'

export interface EntidadPuntuada {
  id: string
  nombre: string
  poblacion: string | null
  telefono: string | null
  opt_in: boolean
  puntuacion: number
  motivos: string[]
  pendiente: boolean
  // --- Canal recomendado, decidido en el servidor -------------------------
  email: string | null
  es_test: boolean
  canal: Canal
  motiu_canal: MotivoCanal
  whatsapp_possible: boolean
  email_possible: boolean
}

export interface PriorizacionResult {
  ok: boolean
  ranking: EntidadPuntuada[]
  /** Modo test global tal y como lo ve el servidor (fuente de verdad). */
  modoTest: boolean
  error: string | null
}

export async function priorizarEntidades(excedenteId: string): Promise<PriorizacionResult> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      return { ok: false, ranking: [], modoTest: true, error: 'Sesión caducada. Vuelve a entrar.' }
    }
    const res = await fetch(`${supabaseUrl}/functions/v1/priorizar-entidades`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ excedente_id: excedenteId }),
    })
    const body = (await res.json().catch(() => null)) as
      | { ranking?: EntidadPuntuada[]; modo_test?: boolean; error?: string }
      | null
    if (!res.ok) {
      return { ok: false, ranking: [], modoTest: true, error: body?.error ?? `Error ${res.status}` }
    }
    // Fail-safe, igual que el servidor: ante la duda, modo test activo.
    return { ok: true, ranking: body?.ranking ?? [], modoTest: body?.modo_test !== false, error: null }
  } catch (err) {
    return {
      ok: false,
      ranking: [],
      modoTest: true,
      error: `No se pudo priorizar: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
