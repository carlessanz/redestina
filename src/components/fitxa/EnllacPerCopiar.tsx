// El texto con el enlace, listo para pegar en un correo propio (04-11-2026). Es lo que sale en
// la ficha cuando el correo de la plataforma está apagado (§8): el enlace ya existe y queda
// registrado igual cuando la persona responde; solo cambia quién lo manda.
//
// Se intenta copiar solo al crearlo, pero el texto se queda a la vista con su botón: después
// de una llamada a la base, algunos navegadores (Safari) ya no dejan escribir en el
// portapapeles sin un clic nuevo.

import { useT } from '../../lib/i18n'
import BotoCopiar from '../BotoCopiar'

export default function EnllacPerCopiar({ text, correu, testid }: {
  text: string
  /** A quién hay que mandarlo: el correo que queda en el enlace. */
  correu: string
  testid: string
}) {
  const { t } = useT()
  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3" data-testid={testid}>
      <p className="text-sm [overflow-wrap:anywhere]">{t('epc.h', { correu })}</p>
      <p className="whitespace-pre-wrap text-xs text-muted-foreground [overflow-wrap:anywhere]">{text}</p>
      <BotoCopiar text={text} className="h-11 w-full sm:w-auto md:h-8" />
    </div>
  )
}
