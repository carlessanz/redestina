// «Envia per correu» de un documento firmable, con la casilla «Inclou l'enllaç per signar en
// línia» (05-11-2026).
//
// Es `acceptaEnviament()` (`lib/enviamentManual.ts`) con una casilla más. La regla del envío
// manual no cambia (§8): con las notificaciones apagadas, la confirmación lo dice y viaja
// `{manual:true}`; con el correo encendido, se pregunta igual porque sale a una organización.
// La casilla solo aparece cuando el documento está pendiente de firma con trazo, y entonces
// viene MARCADA: es lo que se quiere casi siempre (que lo firme sin entrar al panel).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { FilaCasella } from './Casella'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export interface OpcionsEnviament {
  titol: string
  descripcio?: string
  confirmar?: string
  /** Ofrecer la casilla del enlace de firma (documento pendiente de firma con trazo). */
  ambCasellaSignatura?: boolean
}

export interface RespostaEnviament {
  manual: boolean
  ambEnllacSignatura: boolean
}

export function useConfirmaEnviament() {
  const { t } = useT()
  const [obert, setObert] = useState<(OpcionsEnviament & { motiuCorreu: string | null }) | null>(null)
  const [enllac, setEnllac] = useState(true)
  const resol = useRef<((v: RespostaEnviament | null) => void) | null>(null)

  const pregunta = useCallback((
    motiuCorreu: string | null | undefined,
    o: OpcionsEnviament,
  ) => new Promise<RespostaEnviament | null>((resolve) => {
    resol.current = resolve
    setEnllac(true)
    setObert({ ...o, motiuCorreu: motiuCorreu ?? null })
  }), [])

  const tanca = useCallback((v: RespostaEnviament | null) => {
    setObert(null)
    const r = resol.current
    resol.current = null
    r?.(v)
  }, [])

  useEffect(() => () => { resol.current?.(null); resol.current = null }, [])

  const descripcio = obert
    ? [obert.descripcio, obert.motiuCorreu ? t('man.avis', { motiu: t(obert.motiuCorreu) }) : null]
      .filter(Boolean).join('\n\n')
    : ''

  const dialeg = (
    <Dialog open={obert !== null} onOpenChange={(v) => { if (!v) tanca(null) }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="whitespace-normal">{obert?.titol}</DialogTitle>
          {descripcio && <DialogDescription className="whitespace-pre-line">{descripcio}</DialogDescription>}
        </DialogHeader>
        {obert?.ambCasellaSignatura && (
          <div className="space-y-1">
            <FilaCasella checked={enllac} onChange={setEnllac}>{t('sgn.casella_enllac')}</FilaCasella>
            <p className="text-xs text-muted-foreground">{t('sgn.casella_enllac_hint')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="h-11 whitespace-normal md:h-8" onClick={() => tanca(null)}>
            {t('c.cancel')}
          </Button>
          <Button
            className="h-11 whitespace-normal md:h-8"
            data-testid="enviament-confirma"
            onClick={() => tanca({
              manual: obert?.motiuCorreu != null,
              ambEnllacSignatura: obert?.ambCasellaSignatura === true && enllac,
            })}
          >
            {obert?.confirmar ?? (obert?.motiuCorreu ? t('man.envia') : t('c.ok'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { pregunta, dialeg }
}
