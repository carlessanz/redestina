// El marco de los actos asistidos: confirmar un albarán o subir una factura SIN salir del
// panel, con la persona al teléfono (modelo asistido, §1bis).
//
// POR QUÉ UNO SOLO PARA LOS DOS. Es el mismo gesto —acuñar un enlace de un solo uso, abrir
// el formulario público dentro de un diálogo y avisar al panel de detrás— y lo único que
// cambia es qué propósito se acuña y qué formulario va dentro. Dos componentes idénticos
// salvo dos líneas es la forma más fácil de que dentro de un mes solo uno esté arreglado.
// Es el hermano de `DialegFirmaConveni`, que se queda aparte porque su enlace lo acuña otra
// RPC (`signar_conveni_propi` / `iniciar_firma_asistida`) y lleva segundo factor.
//
// ⚠️ **EL CIRCUITO NO CAMBIA NI UN PASO.** Dentro va el MISMO formulario que pinta la
//    página pública: el mismo acta compuesta por el servidor, la misma huella recalculada
//    en el POST y la misma evidencia. `enllacPublic.ts` no manda `Authorization` en ninguno
//    de sus `fetch`, así que embeberlo en el panel **no lo convierte en una acción con
//    sesión**: lo que autoriza sigue siendo el token.
//
// ⚠️ **EL TOKEN SE ACUÑA AL ABRIR, no al montar la pantalla.** `acunar_enllac_assistit()`
//    REVOCA el enlace activo anterior de ese objeto, así que acuñarlo de más le rompería a
//    esa persona el enlace que tiene en el correo (§12.97). Se paga solo cuando alguien
//    abre el diálogo de verdad.
//
// ⚠️ **NO SE CIERRA AL PINCHAR FUERA.** Con los kilos tecleados y a media llamada, un clic
//    despistado en el fondo sería caro. Solo el botón o Escape.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { enllacAssistit } from '../../lib/canalitzacio'
import FormulariConfirmacio from '../FormulariConfirmacio'
import FormulariFactura from '../FormulariFactura'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  /** `albara` confirma una entrega; `factura` sube la factura de un cierre de donante. */
  que: 'albara' | 'factura'
  /** El objeto sobre el que se acuña: el albarán, o el `cierres_donante`. */
  objecteId: string
  /** Solo en el OPE, que tiene DOS enlaces —quien entrega y quien recibe— (20270304100200). */
  rolPart?: 'entrega' | 'recibe' | null
  onTancar: () => void
  /** Tras el acto: la pantalla de detrás tiene que releer su estado. */
  onFet?: () => void
}

export default function DialegAssistit(
  { obert, que, objecteId, rolPart = null, onTancar, onFet }: Props,
) {
  const { t } = useT()
  const [token, setToken] = useState<string | null>(null)
  const [destinatari, setDestinatari] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!obert) { setToken(null); setDestinatari(null); setError(null); return }
    let viu = true
    void (async () => {
      const r = await enllacAssistit(
        que === 'albara' ? 'confirmacion_albaran' : 'subida_factura',
        que === 'albara' ? 'albaran' : 'cierre_donante',
        objecteId,
        rolPart,
      )
      if (!viu) return
      if (!r.ok) {
        // El mensaje de la base es el útil («aquest albarà no està entregat»): un «ha
        // habido un error» no deja hacer nada.
        setError(r.missatge === 'canalz.err_enllac' ? t('c.error') : r.missatge)
        return
      }
      setToken(r.data.token)
      setDestinatari(r.data.destinatari)
    })()
    return () => { viu = false }
  }, [obert, que, objecteId, rolPart, t])

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
      {/* 80 % de ancho y 88 % de alto, como `DialegFirmaConveni`. El `max-w-none` es
          imprescindible: `DialogContent` trae un `max-w` estrecho de serie. */}
      <DialogContent
        className="flex h-[88vh] w-[80vw] max-w-none flex-col gap-4 p-6 sm:max-w-none"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t(que === 'albara' ? 'canalz.dlg_confirmar' : 'canalz.dlg_factura')}</DialogTitle>
          {/* A quién se está acompañando. Sale de la ficha de la parte, no del perfil de
              quien acuña —el equipo no es parte— y puede venir vacío: una ficha sin correo
              ahora SÍ puede confirmar, que es medio motivo de que esto exista. */}
          <DialogDescription>
            {destinatari
              ? t('canalz.dlg_amb', { qui: destinatari })
              : t('canalz.dlg_sense_correu')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error ? (
            <p className="rounded-md bg-error-fondo p-3 text-sm text-error">{error}</p>
          ) : token ? (
            que === 'albara' ? (
              <FormulariConfirmacio
                token={token}
                ample
                onConfirmat={() => { onFet?.(); toast.success(t('conf.done_title')) }}
              />
            ) : (
              <FormulariFactura
                token={token}
                ample
                onPujada={() => { onFet?.(); toast.success(t('fact.done_title')) }}
              />
            )
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
