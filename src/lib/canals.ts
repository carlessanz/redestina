// Los interruptores de notificaciones (§8) vistos desde la interfaz. PURO, con test.
//
// Tres claves de `app_settings` —el general (`notificacions_actives`) y una por canal—, que
// llegan ya EFECTIVAS en el contexto de sesión: con el general apagado, `email` y `whatsapp`
// son falsos aunque sus claves digan otra cosa.
//
// La regla de la interfaz, en dos frases:
//   · un APARTADO de un canal apagado desaparece (Missatgeria es WhatsApp);
//   · un BOTÓN que envía por un canal apagado se queda gris, con el motivo al lado.
// Lo que manda de verdad es el servidor (`sendEmail`, `enviar()`): esto es para no ofrecer
// lo que va a fallar.

export interface Canals {
  notificacions: boolean
  email: boolean
  whatsapp: boolean
}

export type Canal = 'email' | 'whatsapp'

/** Todo encendido: el estado de fábrica y el de cualquier duda. */
export const CANALS_ACTIUS: Canals = { notificacions: true, email: true, whatsapp: true }

/**
 * Por qué no se puede enviar por ese canal, como clave i18n; null si se puede. El general va
 * primero: con todo apagado, decir «el correu està desactivat» escondería el motivo real.
 */
export function motiuCanal(canals: Canals, canal: Canal): string | null {
  if (!canals.notificacions) return 'canal.motiu_notificacions'
  if (canal === 'email' && !canals.email) return 'canal.motiu_email'
  if (canal === 'whatsapp' && !canals.whatsapp) return 'canal.motiu_whatsapp'
  return null
}

/** ¿Se puede enviar por algún canal? */
export function algunCanal(canals: Canals): boolean {
  return canals.email || canals.whatsapp
}

/**
 * Las entradas de menú que exigen un canal se quitan si ese canal está apagado. Genérica
 * para que valga para `NavItem` sin acoplar este módulo al menú.
 */
export function filtraPerCanals<T extends { requereix?: Canal }>(items: readonly T[], canals: Canals): T[] {
  return items.filter((i) => !i.requereix || canals[i.requereix])
}

/** El código de un corte del servidor (§8), traducido. Null si no es un corte. */
export function motiuTallServidor(code: unknown): string | null {
  if (code === 'notificacions_desactivades') return 'canal.motiu_notificacions'
  if (code === 'email_desactivat') return 'canal.motiu_email'
  if (code === 'whatsapp_desactivat') return 'canal.motiu_whatsapp'
  return null
}
