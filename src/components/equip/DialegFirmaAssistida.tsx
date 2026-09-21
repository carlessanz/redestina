// Firmar el convenio CON LA PERSONA DELANTE, desde el panel del equipo (§3.2.5).
//
// Es el hermano de `DialegFirmaConveni` —que es el del titular, con su propia sesión— y se
// queda aparte por una diferencia que no es de marco sino de quién autoriza: aquí el enlace
// lo acuña `iniciar_firma_asistida()`, que exige sesión de equipo, y el acto queda marcado
// `canal = 'asistido'` con `asistido_por` = la cuenta del dinamizador. Eso es lo que
// después distingue las tres vías en la página de evidencias del PDF.
//
// ⚠️ **AQUÍ NO SE ENSEÑA NINGÚN CÓDIGO, y ese es el cambio de `20270401100000`.** La RPC
//    generaba el segundo factor y se lo devolvía a quien conduce la firma, que ya tiene el
//    enlace: dos factores en la misma mano no son dos factores. El único código que existe
//    ahora es el que la persona pide **desde su propia pantalla**, dentro del formulario, y
//    ahí sí se le manda a su correo.
//
// ⚠️ El formulario de dentro es el MISMO que la página pública: mismo texto compuesto por
//    el servidor, misma huella, misma evidencia. Lo único distinto es el marco.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { iniciarFirmaAssistida } from '../../lib/convenis'
import FirmaConveni from '../FirmaConveni'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  /** El convenio que se firma. Tiene que estar ya preparado (`preparar_convenio`). */
  conveniId: string
  onTancar: () => void
  onFirmat?: () => void
}

export default function DialegFirmaAssistida(
  { obert, conveniId, onTancar, onFirmat }: Props,
) {
  const { t } = useT()
  const [token, setToken] = useState<string | null>(null)
  const [potDemanarCodi, setPotDemanarCodi] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!obert) { setToken(null); setPotDemanarCodi(false); setError(null); return }
    let viu = true
    void (async () => {
      const r = await iniciarFirmaAssistida(conveniId)
      if (!viu) return
      if (!r.ok) {
        setError(r.missatge === 'conv.err_generic' ? t('c.error') : r.missatge)
        return
      }
      setToken(r.data.enllac.token)
      setPotDemanarCodi(r.data.pot_demanar_codi === true)
    })()
    return () => { viu = false }
  }, [obert, conveniId, t])

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
      <DialogContent
        className="flex h-[88vh] w-[80vw] max-w-none flex-col gap-4 p-6 sm:max-w-none"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('conv.assisted')}</DialogTitle>
          <DialogDescription>
            {t(potDemanarCodi ? 'conv.assisted_code_self' : 'conv.assisted_no_code')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error ? (
            <p className="rounded-md bg-error-fondo p-3 text-sm text-error">{error}</p>
          ) : token ? (
            <FirmaConveni
              token={token}
              ample
              onFirmat={() => { onFirmat?.(); toast.success(t('sig.done_title')) }}
            />
          ) : (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />{t('c.loading')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
