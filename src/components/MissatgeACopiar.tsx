// Un mensaje del ciclo de una oferta: a quién va, si salió, el WhatsApp exacto para copiar y,
// plegado, el correo (27-10-2026). Para el equipo lleva botones de copiar; en los paneles de
// ofertante y receptor (`nomesLectura`) solo se lee: es el texto íntegro que se les dirigió.

import { Mail, MessageCircle } from 'lucide-react'
import { useT } from '../lib/i18n'
import { motiuTallServidor } from '../lib/canals'
import { dataHora } from '../lib/format'
import { cn } from '../lib/utils'
import type { Missatge } from '../lib/missatgesOferta'
import BotoCopiar from './BotoCopiar'

interface Props {
  missatge: Missatge
  nomesLectura?: boolean
  className?: string
}

/** El estado de un mensaje en una línea: si salió, por dónde y cuándo, o por qué no. */
function useEstat(m: Missatge, nomesLectura: boolean): { text: string; to: 'exito' | 'aviso' | 'neutre' } {
  const { t } = useT()
  if (m.estat === 'enviat') {
    const data = m.enviatAt ? dataHora(m.enviatAt) : ''
    return {
      text: t(m.canalEnviat === 'whatsapp' ? 'msg.estat_enviat_whatsapp' : 'msg.estat_enviat_email', { data }),
      to: 'exito',
    }
  }
  if (m.estat === 'no_enviat') {
    // A la organización no se le habla de interruptores ni de «avisar a mà»: eso es del equipo.
    if (nomesLectura) return { text: t('msg.estat_no_enviat_lectura'), to: 'aviso' }
    const tall = motiuTallServidor(m.motiuNoEnviat)
    return { text: tall ? `${t('msg.estat_no_enviat')} ${t(tall)}` : t('msg.estat_no_enviat'), to: 'aviso' }
  }
  if (m.estat === 'pendent') return { text: t('msg.estat_pendent'), to: 'neutre' }
  return { text: t('msg.estat_compost'), to: 'neutre' }
}

export default function MissatgeACopiar({ missatge: m, nomesLectura = false, className }: Props) {
  const { t } = useT()
  const estat = useEstat(m, nomesLectura)
  // A ofertante y receptor no se les dice «text per enviar a mà»: eso es del equipo.
  const ambEstat = !(nomesLectura && m.estat === 'compost')
  return (
    <div className={cn('min-w-0 space-y-2 rounded-lg border bg-card p-3', className)}
      data-testid="missatge" data-estat={m.estat} data-clau={m.clau}>
      {(!nomesLectura || ambEstat) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {!nomesLectura && (
            <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
              {t(`msg.dest_${m.destinatari}`)}{m.destinatariNom ? ` · ${m.destinatariNom}` : ''}
            </span>
          )}
          {ambEstat && (
            <span className={cn(
              estat.to === 'exito' && 'text-exito',
              estat.to === 'aviso' && 'text-aviso',
              estat.to === 'neutre' && 'text-muted-foreground',
            )}>
              {estat.text}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MessageCircle className="size-3.5" aria-hidden /> {t('msg.whatsapp')}
      </div>
      <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">{m.whatsapp}</pre>
      {!nomesLectura && (
        <BotoCopiar text={m.whatsapp} etiqueta={t('msg.copia_whatsapp')} className="w-full sm:w-auto" />
      )}

      {m.correu && (
        <details className="group rounded-md border px-3 py-2">
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Mail className="size-3.5" aria-hidden /> {t('msg.correu')}
          </summary>
          <div className="mt-2 space-y-2">
            <p className="text-sm"><span className="text-muted-foreground">{t('msg.assumpte')}: </span>{m.correu.assumpte}</p>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">{m.correu.text}</pre>
            {!nomesLectura && (
              <BotoCopiar text={`${m.correu.assumpte}\n\n${m.correu.text}`} etiqueta={t('msg.copia_correu')}
                className="w-full sm:w-auto" />
            )}
          </div>
        </details>
      )}
    </div>
  )
}
