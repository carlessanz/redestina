import { supabase, supabaseUrl } from './supabase'

export type SendPayload =
  | { to: string; type: 'text'; body: string }
  /**
   * Texto con respuestas rápidas (1-3). Mismas reglas de ventana que `text`: es una
   * respuesta de servicio, no una plantilla.
   *
   * Existe para la oferta al receptor. Mandarla en texto plano obligaba a la entidad a
   * **adivinar** que había que contestar «Sí»; cualquier otra cosa no la clasificaba el
   * webhook y el mensaje caía al intake, que le ofrecía publicar una oferta suya. Los `id`
   * son el contrato con `_shared/respuestas.ts`: solo consume los que empiezan por `accept:`.
   */
  | { to: string; type: 'botones'; body: string; botones: { id: string; titulo: string }[] }
  | {
      to: string
      type: 'template'
      template: string
      language: string
      components: unknown[]
    }

export interface SendResult {
  ok: boolean
  status: number
  data: unknown
}

// Llama a la Edge Function whatsapp-send. Nunca lanza: devuelve el error en `data`.
// Va firmada con el token de la sesión de Supabase Auth: la función se despliega
// con verificación de JWT y rechaza cualquier petición sin sesión.
export async function sendWhatsApp(payload: SendPayload): Promise<SendResult> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      return {
        ok: false,
        status: 401,
        data: {
          code: 'unauthorized',
          error: 'Tu sesión ha caducado. Vuelve a entrar para enviar mensajes.',
        },
      }
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const body: unknown = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data: body }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: {
        error: `No se pudo contactar con la Edge Function: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
    }
  }
}
