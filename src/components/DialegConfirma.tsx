// Diálogo de «¿seguro?», el hermano de `DialegMotiu` para cuando no hay motivo que pedir.
//
// POR QUÉ EXISTE (deuda §12.35). Quedaban ocho `window.confirm()` y el argumento para
// tolerarlos era que su bloqueo se comporta como «cancelar», que es el lado seguro. Eso es
// cierto y no basta: en `RecordDetail` y en `Conversation` ese diálogo es la puerta de un
// borrado irreversible, así que si el navegador integrado lo bloquea —los de WhatsApp e
// Instagram lo hacen, y son muy probables en este público— no pasa nada **y la persona no
// recibe ninguna señal de por qué**. Es exactamente el fallo que motivó retirar `prompt()`:
// una acción que se pierde en silencio.
//
// POR QUÉ UN HOOK CON PROMESA Y NO UN COMPONENTE SUELTO. `window.confirm` es síncrono y se
// usa en línea (`if (!window.confirm(…)) return`), en medio de funciones que siguen con la
// escritura. Un diálogo normal obliga a partir cada una en dos —guardar la acción pendiente
// en estado y ejecutarla en el `onConfirma`—, que es donde se cuelan los errores. Con una
// promesa la forma del código no cambia: `if (!(await confirma({…}))) return`.
//
// ⚠️ Cerrar por Escape o pulsando fuera resuelve `false`, igual que cancelar: si no, una
// promesa se quedaría colgada para siempre y con ella la función que la espera.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export interface OpcionsConfirma {
  /** El título es la pregunta. Corto y concreto: «Esborrar la fitxa de X?» */
  titol: string
  /** Lo que conviene saber antes de decidir: qué se pierde, a cuántos afecta. */
  descripcio?: string
  /** Texto del botón que confirma. Por defecto, «D'acord». */
  confirmar?: string
  /** Rojo para lo irreversible (borrar, cancelar una oferta). */
  destructiu?: boolean
}

export function useConfirma() {
  const { t } = useT()
  const [opcions, setOpcions] = useState<OpcionsConfirma | null>(null)
  const resol = useRef<((v: boolean) => void) | null>(null)

  const confirma = useCallback((o: OpcionsConfirma) => new Promise<boolean>((resolve) => {
    resol.current = resolve
    setOpcions(o)
  }), [])

  const tanca = useCallback((valor: boolean) => {
    setOpcions(null)
    // Se limpia la referencia ANTES de resolver: quien espera la promesa suele abrir otro
    // diálogo a continuación, y si la referencia siguiera apuntando aquí el siguiente
    // `confirma()` se resolvería con esta respuesta.
    const r = resol.current
    resol.current = null
    r?.(valor)
  }, [])

  // Si el componente que lo usa se desmonta con el diálogo abierto, la promesa tiene que
  // resolverse igual (como «cancelar»), o deja colgada la función que la espera.
  useEffect(() => () => { resol.current?.(false); resol.current = null }, [])

  const dialeg = (
    <Dialog open={opcions !== null} onOpenChange={(v) => { if (!v) tanca(false) }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{opcions?.titol}</DialogTitle>
          {opcions?.descripcio && (
            <DialogDescription className="whitespace-pre-line">{opcions.descripcio}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="h-11 whitespace-normal md:h-9" onClick={() => tanca(false)}>
            {t('c.cancel')}
          </Button>
          <Button
            variant={opcions?.destructiu ? 'destructive' : 'default'}
            className="h-11 whitespace-normal md:h-9"
            onClick={() => tanca(true)}
          >
            {opcions?.confirmar ?? t('c.ok')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirma, dialeg }
}
