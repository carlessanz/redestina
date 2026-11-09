// «Pantalla de protecció prèvia a la home» (la cortina de contraseña; 09-11-2026). Configuració ›
// General, solo super_admin. Tres operaciones:
//   · leer     — `cortina_config()`: estado, contraseña (en claro, para que la vea) y último cambio;
//   · activar  — `cortina_activar()`: encender/apagar;
//   · contraseña nueva — Edge Function `cortina-config`, porque la huella (PBKDF2) la calcula el servidor.
// Todos devuelven una CLAVE i18n de error o null/dato; nunca lanzan.

import { supabase, supabaseUrl } from './supabase'
import { motiuContrasenyaInvalida } from '../../supabase/functions/_shared/cortinaHash.ts'

export { MIN_CONTRASENYA, MAX_CONTRASENYA } from '../../supabase/functions/_shared/cortinaHash.ts'

export interface ConfigCortina {
  activa: boolean
  /** En claro; `null` = la vigente es anterior a esta pantalla y no se puede mostrar. */
  contrasenya: string | null
  propia: boolean
  updated_at: string | null
  updated_by: string | null
}

/** Lo que tarda un cambio en notarse en la web (la caché del middleware, `TTL_ESTAT_MS`). */
export const SEGONS_PROPAGACIO = 30

/** Clave i18n del motivo por el que la contraseña escrita no vale, o null si vale. */
export function claveContrasenyaInvalida(contrasenya: string): string | null {
  const m = motiuContrasenyaInvalida(contrasenya)
  return m === 'curta' ? 'cor.err_curta' : m === 'llarga' ? 'cor.err_llarga' : m ? 'cor.err_invalida' : null
}

const CODIS_FUNCIO: Record<string, string> = {
  contrasenya_curta: 'cor.err_curta',
  contrasenya_llarga: 'cor.err_llarga',
  contrasenya_invalida: 'cor.err_invalida',
  forbidden: 'set.only_super',
  unauthorized: 'c.error',
}

export async function llegeixCortina(): Promise<ConfigCortina | null> {
  const { data, error } = await supabase.rpc('cortina_config')
  if (error || !data) return null
  return data as ConfigCortina
}

/** Enciende o apaga. Devuelve la configuración nueva o una clave de error. */
export async function fixaCortinaActiva(activa: boolean): Promise<{ config: ConfigCortina } | { error: string }> {
  const { data, error } = await supabase.rpc('cortina_activar', { p_activa: activa })
  if (error || !data) return { error: error?.code === '42501' ? 'set.denied' : 'c.error' }
  return { config: data as ConfigCortina }
}

/** Cambia la contraseña. Devuelve null si ha ido bien o una clave i18n de error. */
export async function canviaContrasenyaCortina(contrasenya: string): Promise<string | null> {
  const local = claveContrasenyaInvalida(contrasenya)
  if (local) return local
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return 'c.error'
    const res = await fetch(`${supabaseUrl}/functions/v1/cortina-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contrasenya }),
    })
    if (res.ok) return null
    const cos = (await res.json().catch(() => null)) as { code?: string } | null
    return CODIS_FUNCIO[cos?.code ?? ''] ?? 'c.error'
  } catch {
    return 'c.error'
  }
}
