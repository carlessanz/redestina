// Enviar a alguien el enlace de acceso a su panel.
//
// POR QUÉ EXISTE (16-09-2026). Al aprobar un alta del registro público **no se avisaba a
// nadie**: la persona se enteraba de que ya podía entrar entrando a probar. Es la deuda 27,
// y el cliente la pidió cerrada con estas palabras: «en el momento en que el superadmin
// acepta una organización, se debería mandar un correo con el acceso directo a su panel».
//
// NO SE INVENTA NINGÚN CIRCUITO: llama a `enviar-acceso`, que ya existía (§9) y que genera
// el enlace con la Admin API y lo manda por Resend. Lo único que faltaba era llamarla desde
// la cola de aprobaciones.
//
// ⚠️ NUNCA LANZA, como `sendWhatsApp()`. Aprobar y avisar son dos cosas distintas y la
//    primera ya ha ocurrido cuando esto se ejecuta: si el correo falla, lo que NO puede
//    pasar es que la pantalla dé la aprobación por fallida y alguien la repita.
//
// ⚠️ Y EL FALLO SE CUENTA, NO SE TRAGA. Con el modo test activo, una organización recién
//    aprobada **no pasa el gate** (`esCuentaPermitida`: nace `es_test = false`), así que el
//    correo se descarta con `403 no_test_user`. Ese es exactamente el motivo por el que el
//    registro nunca mandó nada — y tragárselo aquí repetiría el error con otra cara: el
//    equipo creería que ha avisado. Por eso se devuelve el código y la pantalla lo dice.

import { supabase, supabaseUrl } from './supabase'

export interface ResultatAcces {
  ok: boolean
  /** Código del servidor cuando no se ha enviado: `no_test_user`, `forbidden`… */
  codi: string | null
  /** Por qué canal salió, cuando salió. */
  canal: string | null
}

/**
 * Manda el enlace mágico de acceso a `email`. Restringida al equipo por la propia función
 * (`exigirEquipo`), así que se llama con el JWT de la sesión.
 *
 * `canal: 'email'` y no `'auto'` a propósito: por WhatsApp `enviar-acceso` manda **solo el
 * código de 6 cifras**, no el enlace (un enlace mágico quedaría publicado en la consola de
 * Mensajería, §9), y lo que aquí se promete es «el acceso directo a su panel».
 */
export async function enviarAcces(email: string): Promise<ResultatAcces> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { ok: false, codi: 'unauthorized', canal: null }

    const res = await fetch(`${supabaseUrl}/functions/v1/enviar-acceso`, {
      method: 'POST',
      // Solo `Authorization`, como el resto de llamadas a Edge Functions del repo
      // (`email.ts`, `redestina.ts`): lo que autoriza es el JWT de la sesión.
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email, canal: 'email' }),
    })
    const dades = (await res.json().catch(() => null)) as
      { ok?: boolean; code?: string; canal?: string } | null
    if (!res.ok) return { ok: false, codi: dades?.code ?? `http_${res.status}`, canal: null }
    return { ok: true, codi: null, canal: dades?.canal ?? 'email' }
  } catch {
    return { ok: false, codi: 'xarxa', canal: null }
  }
}
