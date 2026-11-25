// El diálogo de «Tens canvis sense desar» (Taula mestra 1.1, 25-11-2026). Lo abre
// `useCanvisPendents` cuando una navegación interna se detiene con cambios pendientes.
// Componente de módulo (nunca dentro de otro: `tests/componentsNiats.test.ts`).
//
// Tres salidas: guardar y salir (la acción principal), salir sin guardar (se pierde lo
// escrito: botón de contorno, no rojo, porque no borra nada guardado) y seguir editando.
// Cerrar por Escape o pulsando fuera = seguir editando, el lado seguro.

import { useT } from '../lib/i18n'
import type { PropsDialegCanvisPendents } from '../hooks/useCanvisPendents'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export default function DialegCanvisPendents({ obert, n, desant, onDesa, onSurt, onContinua }: PropsDialegCanvisPendents) {
  const { t } = useT()
  const boto = 'h-auto min-h-11 whitespace-normal md:min-h-8'
  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v && !desant) onContinua() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" data-testid="dialeg-canvis-pendents">
        <DialogHeader>
          <DialogTitle>{t('csd.titol')}</DialogTitle>
          <DialogDescription>{t('csd.descripcio', { n })}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="ghost" className={boto} onClick={onContinua} disabled={desant}>
            {t('csd.continua')}
          </Button>
          <Button variant="outline" className={boto} onClick={onSurt} disabled={desant}>
            {t('csd.surt')}
          </Button>
          <Button className={boto} onClick={onDesa} disabled={desant}>
            {desant ? t('c.saving') : t('csd.desa_i_surt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
