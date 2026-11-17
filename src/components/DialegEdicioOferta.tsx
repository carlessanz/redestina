// Editar una oferta ya publicada con el MISMO formulario que el alta (fase C del punto 3,
// 17-11-2026, filas 3.7.3 y 3.7.4 del Excel de la Fundació). Sustituye a `DialegEditaOferta`,
// que tenía su propio formulario de ocho campos: ahora se edita todo menos el producto y la
// entidad, con los mismos controles y las mismas comprobaciones que al publicar.
//
// La regla sigue en la base (`editar_oferta()`): los kilos no bajan de lo ya canalizado, no se
// quita una modalidad con entregas aprobadas, y si el PRODUCTOR cambia kilos o modalidades la
// oferta vuelve a validación (D4); el formulario lo avisa antes de guardar. Guardar recompone el
// texto de la oferta en el servidor y nunca toca la ficha de la entidad ni sus lugares (salvo
// «Afegir un lloc nou», que crea uno).
//
// Diálogo grande (80 × 88, como el alta asistida) y sin cerrar al pinchar fuera: es un formulario
// largo y un clic despistado sería caro.

import { useT } from '../lib/i18n'
import FormulariNovaOferta from './FormulariNovaOferta'
import type { Excedente } from '../types'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export default function DialegEdicioOferta({
  obert, onObert, oferta, kgCanalitzats, esEquip, onFet,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  oferta: Excedente
  /** Lo ya canalizado: los kilos no pueden bajar de aquí. */
  kgCanalitzats: number
  /** El equipo no revalida (es quien valida). */
  esEquip: boolean
  onFet: () => void | Promise<unknown>
}) {
  const { t } = useT()
  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent
        className="flex h-[92dvh] w-[96vw] max-w-none flex-col gap-4 p-4 sm:max-w-none sm:p-6 md:h-[88dvh] md:w-[80vw]"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('edit.titol')}</DialogTitle>
          <DialogDescription>{t('edit.desc', { producte: oferta.producto ?? '—' })}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden" data-testid="dialeg-edicio">
          {obert && oferta.productor_id && (
            <FormulariNovaOferta
              key={oferta.id}
              mode="editar"
              oferta={oferta}
              productorId={oferta.productor_id}
              esEquip={esEquip}
              kgCanalitzats={kgCanalitzats}
              onEditada={async () => { onObert(false); await onFet() }}
              onCancel={() => onObert(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
