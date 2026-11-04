// Envíos MANUALES con las notificaciones apagadas (04-11-2026, §8). Los interruptores cortan
// lo automático; unos pocos botones del equipo (consentimiento RGPD, convenio a firmar,
// «Reenvia» de un documento, «Dona-li accés» y «Envia per correu» del albarán) pueden mandar
// igualmente si quien pulsa lo acepta en el momento. La lista cerrada vive en el servidor
// (`supabase/functions/_shared/enviamentManual.ts`); aquí solo se pregunta.
//
// Con el correo encendido no cambia nada: el botón hace lo de siempre (con su confirmación, si
// la tenía) y el envío va sin `manual`.

import type { OpcionsConfirma } from '../components/DialegConfirma'

type Traductor = (clau: string, params?: Record<string, string | number>) => string

/**
 * Pide la confirmación y dice cómo mandar: `{ manual }` si sigue adelante, `null` si se cancela.
 * · Correo encendido: la confirmación propia del botón si la hay (`base`), o ninguna.
 * · Correo apagado (`motiuCorreu`, la clave de `motiuCanal()`): siempre un diálogo, con el
 *   aviso de que las notificaciones están apagadas y el correo saldrá porque lo manda la persona.
 */
export async function acceptaEnviament(
  confirma: (o: OpcionsConfirma) => Promise<boolean>,
  t: Traductor,
  motiuCorreu: string | null | undefined,
  base?: OpcionsConfirma,
): Promise<{ manual: boolean } | null> {
  if (!motiuCorreu) {
    if (!base) return { manual: false }
    return (await confirma(base)) ? { manual: false } : null
  }
  const ok = await confirma({
    titol: base?.titol ?? t('man.titol'),
    descripcio: [base?.descripcio, t('man.avis', { motiu: t(motiuCorreu) })].filter(Boolean).join('\n\n'),
    confirmar: base?.confirmar ?? t('man.envia'),
  })
  return ok ? { manual: true } : null
}
