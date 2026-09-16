// Firmar el convenio SIN salir de la aplicación.
//
// POR QUÉ EXISTE (16-09-2026). El botón del aviso navegaba a `/signar/:token`, que es la
// página pública: fondo verde a pantalla completa y una tarjeta de 28rem. Para alguien que
// ya estaba dentro del panel eso es salir de él —pierde el contexto, el menú y el sitio
// donde estaba— y leer un convenio entero por una rendija. El cliente lo pidió así: «un
// modal que apareciera en la misma pantalla, de un 80 de ancho por 80 o 90 de alto, y que
// los campos estuvieran mejor distribuidos para no generar scroll».
//
// ⚠️ EL CIRCUITO DE FIRMA NO CAMBIA NI UN PASO. Dentro va el MISMO `FirmaConveni` que pinta
//    la página pública: el mismo texto compuesto por el servidor, la misma huella
//    (`sha256_texto`) recalculada en el POST y la misma evidencia. Lo único distinto es el
//    marco, y `ample` es lo que le dice que tiene sitio para dos columnas.
//
// ⚠️ EL TOKEN SE ACUÑA AL ABRIR, no antes. `signar_conveni_propi()` prepara el convenio si
//    hace falta, lo pasa a `pendent_firma` y devuelve el token en claro — que es la única
//    vez que existe—. Acuñarlo al montar la pantalla gastaría un enlace (y revocaría el que
//    la persona pueda tener en el correo, §12.97) cada vez que alguien pasa por el panel.
//
// ⚠️ NO SE PIERDE LO ESCRITO AL CERRAR SIN QUERER. El diálogo solo se cierra por el botón o
//    por Escape, no al pinchar fuera: con nueve campos rellenados y un trazo hecho, un clic
//    despistado en el fondo sería caro. Firmado ya, se cierra solo.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { signarConveniPropi } from '../lib/pendents'
import FirmaConveni from './FirmaConveni'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  /** La ficha de la que se firma el convenio, y de qué tipo es. */
  tipusOrg: 'productor' | 'entidad'
  orgId: string
  onTancar: () => void
  /** Tras firmar: el panel de detrás tiene que releer su estado de convenio. */
  onFirmat?: () => void
}

export default function DialegFirmaConveni(
  { obert, tipusOrg, orgId, onTancar, onFirmat }: Props,
) {
  const { t } = useT()
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!obert) { setToken(null); setError(null); return }
    let viu = true
    void (async () => {
      const r = await signarConveniPropi(tipusOrg, orgId)
      if (!viu) return
      if (!r.ok) {
        // El mensaje del servidor es el útil («ja l'has signat, falta la contrasignatura»,
        // «no hi ha plantilla vigent»): un «ha habido un error» no deja hacer nada.
        setError(r.missatge === 'pend.err_generic' ? t('c.error') : r.missatge)
        return
      }
      // De `/signar/<token>` solo interesa el token: la página no se visita.
      setToken(r.data.url_path.replace('/signar/', ''))
    })()
    return () => { viu = false }
  }, [obert, tipusOrg, orgId, t])

  return (
    <Dialog
      open={obert}
      onOpenChange={(v) => { if (!v) onTancar() }}
    >
      {/* 80 % de ancho y 88 % de alto, como se pidió. El `max-w-none` es imprescindible:
          `DialogContent` trae un `max-w` estrecho de serie y sin quitarlo el 80 % no se
          aplica. `flex flex-col` + `min-h-0` en el cuerpo es lo que hace que scrollee el
          contenido y no el diálogo entero. */}
      <DialogContent
        className="flex h-[88vh] w-[80vw] max-w-none flex-col gap-4 p-6 sm:max-w-none"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('sig.title')}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {error ? (
            <p className="rounded-md bg-error-fondo p-3 text-sm text-error">{error}</p>
          ) : token ? (
            <FirmaConveni
              token={token}
              ample
              onFirmat={() => {
                onFirmat?.()
                toast.success(t('sig.done_title'))
              }}
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
