// Una tarjeta de interruptor de Configuració: banda de estado + «Activat / Desactivat» + ayuda.
// Era el mismo bloque copiado tres veces en `Settings.tsx` (modo test, validación, WhatsApp);
// con los interruptores de notificaciones habrían sido seis.

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  titol: string
  /** `null` mientras carga. */
  actiu: boolean | null
  /** Banda de estado: título y texto en cada estado. Sin ellos, no hay banda. */
  estat?: {
    on: string
    onDesc: string
    off: string
    offDesc: string
    iconaOn: LucideIcon
    iconaOff: LucideIcon
    /** Apagado en rojo (`error`) o en ámbar (`aviso`). */
    toOff: 'error' | 'aviso'
  }
  /** Texto suelto cuando no hay banda. */
  descripcio?: string
  onCanvia: (actiu: boolean) => void
  /** Los dos botones grises, con el motivo en el tooltip y debajo. */
  bloquejat?: boolean
  motiu?: string
  /** Solo el «Activat» gris (p. ej. un canal con el general apagado). */
  motiuActivar?: string
  ajuda?: ReactNode
  children?: ReactNode
}

export default function Interruptor({
  titol, actiu, estat, descripcio, onCanvia, bloquejat = false, motiu, motiuActivar, ajuda, children,
}: Props) {
  const { t } = useT()
  const toOff = estat?.toOff ?? 'aviso'
  const IconaOn = estat?.iconaOn
  const IconaOff = estat?.iconaOff

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{titol}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {actiu === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {t('c.loading')}
          </p>
        ) : (
          <>
            {estat && IconaOn && IconaOff ? (
              <div className={cn('flex items-start gap-3 rounded-lg border p-3',
                actiu ? 'border-exito/30 bg-exito-fondo'
                  : toOff === 'error' ? 'border-error/30 bg-error-fondo' : 'border-aviso/30 bg-aviso-fondo')}>
                {actiu
                  ? <IconaOn className="mt-0.5 size-5 shrink-0 text-exito" aria-hidden />
                  : <IconaOff className={cn('mt-0.5 size-5 shrink-0', toOff === 'error' ? 'text-error' : 'text-aviso')} aria-hidden />}
                <div className="min-w-0 text-sm">
                  <div className={cn('font-semibold', actiu ? 'text-exito' : toOff === 'error' ? 'text-error' : 'text-aviso')}>
                    {actiu ? estat.on : estat.off}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{actiu ? estat.onDesc : estat.offDesc}</p>
                </div>
              </div>
            ) : descripcio ? (
              <p className="text-sm text-muted-foreground">{descripcio}</p>
            ) : null}

            <div className="inline-flex rounded-md border p-0.5">
              <BotoAmbMotiu type="button" variant="ghost" size="sm"
                disabled={bloquejat || (!!motiuActivar && !actiu)} motiu={motiu ?? motiuActivar}
                onClick={() => onCanvia(true)}
                className={cn('rounded px-4 font-medium disabled:opacity-60',
                  actiu ? 'bg-exito text-white hover:bg-exito hover:text-white' : 'text-muted-foreground hover:bg-muted')}>
                {t('set.on')}
              </BotoAmbMotiu>
              <BotoAmbMotiu type="button" variant="ghost" size="sm" disabled={bloquejat} motiu={motiu}
                onClick={() => onCanvia(false)}
                className={cn('rounded px-4 font-medium disabled:opacity-60',
                  !actiu
                    ? toOff === 'error' ? 'bg-error text-white hover:bg-error hover:text-white' : 'bg-aviso text-white hover:bg-aviso hover:text-white'
                    : 'text-muted-foreground hover:bg-muted')}>
                {t('set.off')}
              </BotoAmbMotiu>
            </div>

            {motiu && <p className="text-xs text-aviso">{motiu}</p>}
            {!motiu && motiuActivar && !actiu && <p className="text-xs text-aviso">{motiuActivar}</p>}
            {ajuda && <div className="text-xs text-muted-foreground">{ajuda}</div>}
            {children}
          </>
        )}
      </CardContent>
    </Card>
  )
}
