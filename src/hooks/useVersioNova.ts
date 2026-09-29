import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { toast } from 'sonner'
import { useT } from '@/lib/i18n'
import { VERSIO, versioPublicada } from '@/lib/versio'

const CADA_MS = 5 * 60 * 1000

/**
 * Detecta que se ha publicado una versión nueva mientras la pestaña estaba abierta, y la
 * carga sola en el primer momento seguro: **al cambiar de pantalla**. Recargar en mitad
 * de una pantalla podría llevarse un formulario a medias (una oferta, una firma); al
 * navegar ya no hay nada escrito que perder. Mientras tanto, un aviso con «Actualitza».
 *
 * Se comprueba al montar, al volver a la pestaña y cada 5 minutos. Vive en `ArrelApp`,
 * así que cubre la parte pública y la privada.
 */
export function useVersioNova() {
  const { t } = useT()
  const { pathname } = useLocation()
  const nova = useRef(false)
  const rutaAlDetectar = useRef<string | null>(null)

  useEffect(() => {
    if (!VERSIO) return
    let viu = true
    const comprova = async () => {
      if (nova.current || document.visibilityState !== 'visible') return
      const publicada = await versioPublicada()
      if (!viu || !publicada || publicada === VERSIO) return
      nova.current = true
      rutaAlDetectar.current = window.location.pathname
      toast(t('app.new_version'), {
        id: 'versio-nova',
        duration: Infinity,
        action: { label: t('app.new_version_go'), onClick: () => window.location.reload() },
      })
    }
    void comprova()
    const interval = window.setInterval(() => void comprova(), CADA_MS)
    const visible = () => void comprova()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    return () => {
      viu = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('focus', visible)
    }
  }, [t])

  useEffect(() => {
    if (nova.current && rutaAlDetectar.current !== null && pathname !== rutaAlDetectar.current) {
      window.location.reload()
    }
  }, [pathname])
}
