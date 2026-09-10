// Diálogo de «dime por qué».
//
// Existe para no seguir agrandando la deuda §12.35: `window.prompt()` está bloqueado en
// los navegadores integrados de WhatsApp e Instagram —muy probables en este público— y
// cuando lo está devuelve `null` EN SILENCIO, así que la acción no pasa y nadie se entera.
// Anular un albarán, rectificarlo, conciliar fuera de tolerancia y rechazar una entrega
// piden todos un motivo, y los cuatro son actos que quedan escritos para siempre en un
// documento numerado: perder uno por un diálogo que no aparece no es aceptable.
//
// Es controlado desde fuera (`obert` / `onObert`) porque casi siempre lo abre la fila de
// una tabla, no un botón que esté al lado del diálogo.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export default function DialegMotiu({
  obert,
  onObert,
  titol,
  descripcio,
  etiqueta,
  confirmar,
  destructiu = false,
  ocupat = false,
  extra,
  onConfirma,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  titol: string
  descripcio?: string
  etiqueta: string
  confirmar: string
  /** Anular y rechazar son irreversibles: el botón va en rojo (`destructive`). */
  destructiu?: boolean
  ocupat?: boolean
  /** Campos añadidos encima del motivo (p. ej. el destino final al conciliar). */
  extra?: ReactNode
  onConfirma: (motiu: string) => void
}) {
  const { t } = useT()
  const [motiu, setMotiu] = useState('')

  // Al cerrarse, el texto se va con él: si no, reabrirlo para otra fila enseñaría el
  // motivo de la anterior, que es la forma más fácil de anular la cosa equivocada.
  useEffect(() => { if (!obert) setMotiu('') }, [obert])

  const buit = motiu.trim() === ''

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titol}</DialogTitle>
          {descripcio && <DialogDescription>{descripcio}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-3">
          {extra}
          <div className="space-y-1.5">
            <Label htmlFor="dialeg-motiu">{etiqueta}</Label>
            {/* `Textarea` de shadcn ya trae `text-base md:text-sm`: en iOS un control por
                debajo de 16px amplía la página al enfocarlo y no lo deshace (§2). */}
            <Textarea
              id="dialeg-motiu"
              rows={3}
              value={motiu}
              onChange={(e) => setMotiu(e.target.value)}
              autoFocus
            />
            {buit && <p className="text-xs text-muted-foreground">{t('alb.reason_required')}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onObert(false)} disabled={ocupat}>
            {t('c.cancel')}
          </Button>
          <Button
            variant={destructiu ? 'destructive' : 'default'}
            className="whitespace-normal"
            disabled={buit || ocupat}
            onClick={() => onConfirma(motiu.trim())}
          >
            {confirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
