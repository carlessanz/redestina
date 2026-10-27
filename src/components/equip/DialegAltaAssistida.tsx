// «Nova organització amb compte»: el alta asistida (27-10-2026). El equipo da de alta una
// organización CON SU CUENTA y contraseña inicial, ya aprobada, y con los consentimientos
// RGPD que declara en nombre de la persona. Es el mismo formulario de `/registre`
// (`FormulariAlta`, modo `assistit`) contra la función `alta-assistida`.
//
// Después, si se pidió, manda el acceso (`enviar-acceso`): es TRANSACCIONAL (§8), así que
// sale aunque las notificaciones estén apagadas — salvo el gate de pruebas, que se dice.

import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { enviarAcces } from '../../lib/acces'
import FormulariAlta, { type AltaFeta, type RolRegistre } from '../FormulariAlta'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  onTancar: () => void
  /** El papel que se preselecciona según desde dónde se abre. */
  rolInicial?: RolRegistre
  /** Para recargar el listado de quien lo abrió. */
  onCreada?: () => void
}

export default function DialegAltaAssistida({ obert, onTancar, rolInicial = 'productor', onCreada }: Props) {
  const { t } = useT()

  async function fet(r: AltaFeta) {
    onTancar()
    onCreada?.()
    if (r.revisio) toast.info(t('alta.ok_revisio'))
    if (!r.enviaAcces) { toast.success(t('alta.ok')); return }
    const enviat = await enviarAcces(r.email)
    if (enviat.ok) toast.success(t('alta.ok_mail', { email: r.email }))
    // Creada, pero hay que avisar a mano: un solo aviso ámbar (como en Aprovacions).
    else toast.warning(t(enviat.codi === 'no_test_user' ? 'appr.mail_test' : 'appr.mail_ko'))
  }

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
      {/* Sin cerrar al pinchar fuera: diez campos y una contraseña, como los otros asistidos. */}
      <DialogContent
        className="flex max-h-[88dvh] w-[92vw] max-w-2xl flex-col gap-4 p-6 sm:max-w-2xl"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('alta.title')}</DialogTitle>
          <DialogDescription>{t('alta.hint')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {/* `key`: al reabrirlo, formulario limpio (no la contraseña de la anterior). */}
          {obert && (
            <FormulariAlta key={rolInicial} mode="assistit" idPrefix="alta" rolsInicials={[rolInicial]}
              onFet={(r) => void fet(r)} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
