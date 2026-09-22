// Llamada a la Edge Function priorizar-entidades, firmada con la sesión.
// Igual que sendWhatsApp: nunca lanza, devuelve el error en el resultado.

import { supabase, supabaseUrl } from './supabase'

/** Canal por el que se contacta. Lo decide el servidor (_shared/canal.ts). */
export type Canal = 'whatsapp' | 'email' | 'cap'

/** Códigos estables del motivo; los traduce `motiuCanal()` en i18n. */
export type MotivoCanal =
  | 'finestra_oberta' | 'opt_in' | 'sense_telefon' | 'telefon_no_mobil'
  | 'sense_optin_ni_finestra' | 'sense_correu' | 'sense_canal'
  // La organización ha pedido este canal y era viable (§12.22).
  | 'preferencia_whatsapp' | 'preferencia_email'
  // El interruptor global está apagado (§8): WhatsApp no es viable para nadie.
  | 'whatsapp_desactivat'

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
  /** Lo que la organización pidió (`organizaciones.canal_preferido`), o null. */
  canal_preferit: 'whatsapp' | 'email' | null
  /** false = se le ha cambiado el canal porque el pedido no era viable. */
  preferencia_respectada: boolean | null
  /**
   * A esta entidad le falta el convenio que esta oferta exige, así que aprobar su
   * interés fallará con `42501 sense_conveni` desde la fecha de corte (§4bis).
   *
   * ⚠️ NO es «no tiene convenio»: es «no tiene EL de esta oferta». Depende de la
   * modalidad (`convenios_exigidos`), así que una entidad con `com` vigente sale
   * marcada en una donación, que necesita `don_rec`.
   *
   * Lo calcula `priorizar-entidades` (su `index.ts:186`) y llegaba a la pantalla sin
   * que nadie lo declarara aquí, o sea que se descartaba en silencio: el equipo enviaba
   * la oferta y el fallo aparecía al final, al aprobar. Mismo patrón que la deuda 38.
   */
  sense_conveni: boolean
}

export interface PriorizacionResult {
  ok: boolean
  ranking: EntidadPuntuada[]
  /** Modo test global tal y como lo ve el servidor (fuente de verdad). */
  modoTest: boolean
  /** Interruptor global de WhatsApp (§8), también tal y como lo ve el servidor. */
  whatsappActiu: boolean
  error: string | null
}

export async function priorizarEntidades(excedenteId: string): Promise<PriorizacionResult> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      return { ok: false, ranking: [], modoTest: true, whatsappActiu: true, error: 'Sesión caducada. Vuelve a entrar.' }
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
      | { ranking?: EntidadPuntuada[]; modo_test?: boolean; whatsapp_actiu?: boolean; error?: string }
      | null
    if (!res.ok) {
      return { ok: false, ranking: [], modoTest: true, whatsappActiu: true, error: body?.error ?? `Error ${res.status}` }
    }
    // Fail-safe, igual que el servidor y en los dos sentidos: ante la duda, modo test
    // activo (no enviar a quien no toca) y WhatsApp activo (no esconder un canal que sí
    // está). Los dos defectos van hacia lo que la aplicación ha hecho siempre.
    return {
      ok: true,
      ranking: body?.ranking ?? [],
      modoTest: body?.modo_test !== false,
      whatsappActiu: body?.whatsapp_actiu !== false,
      error: null,
    }
  } catch (err) {
    return {
      ok: false,
      ranking: [],
      modoTest: true,
      whatsappActiu: true,
      error: `No se pudo priorizar: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
