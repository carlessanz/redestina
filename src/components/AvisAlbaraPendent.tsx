// El aviso BLOQUEANTE de albarán sin confirmar (reunión del 06-10-2026).
//
// Regla acordada: con un albarán entregado y sin confirmar por su parte desde hace más de
// 48 h, el productor no publica ofertas nuevas y la receptora no muestra interés en nuevas.
// La impone la base (`albarans_bloquejants()`, el trigger de `oferta_respuestas` y
// `crear-oferta`); esto lo dice ANTES de intentarlo y lleva directamente a confirmar.
//
// Motivo, dicho por la Fundació: sin albarán confirmado no hay trazabilidad alimentaria ni
// soporte fiscal de la donación, y Espigoladors queda expuesta. Las 48 h dejan margen para
// tener dos o tres recogidas en paralelo.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { albaransBloquejants } from '../lib/ofertes'
import type { AlbaraBloquejant } from '../lib/ofertes'
import { acunarEnllacPropi } from '../lib/pendents'
import type { Pendent } from '../lib/pendents'
import { dataCurta } from '../lib/albarans'
import { Button } from '@/components/ui/button'

export default function AvisAlbaraPendent({
  tipusOrg, orgId, tornarA, onCanvi,
}: {
  tipusOrg: 'productor' | 'entidad'
  orgId: string | null
  /** A dónde vuelve tras confirmar. */
  tornarA: string
  /** Se avisa al padre para que apague su acción (publicar, «M'interessa»). */
  onCanvi?: (bloquejat: boolean) => void
}) {
  const { t } = useT()
  const navigate = useNavigate()
  const [llista, setLlista] = useState<AlbaraBloquejant[]>([])
  const [obrint, setObrint] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return
    let viu = true
    void albaransBloquejants(tipusOrg, orgId).then((l) => {
      if (!viu) return
      setLlista(l)
      onCanvi?.(l.length > 0)
    })
    return () => { viu = false }
    // `onCanvi` puede cambiar en cada render del padre; lo que decide recargar es la organización.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipusOrg, orgId])

  if (llista.length === 0) return null

  async function confirma(a: AlbaraBloquejant) {
    setObrint(a.albaran_id)
    const p = {
      proposito: 'confirmacion_albaran',
      objeto_tipo: 'albaran',
      objeto_id: a.albaran_id,
      rol_parte: tipusOrg === 'productor' ? 'entrega' : 'recibe',
    } as unknown as Pendent
    const r = await acunarEnllacPropi(p)
    setObrint(null)
    if (!r.ok) { toast.error(t(r.missatge)); return }
    navigate(r.data.url_path || `/confirmar/${r.data.token}`, { state: { tornar: tornarA } })
  }

  return (
    <div role="alert" className="space-y-2 rounded-lg border border-error/30 bg-error-fondo p-3">
      <p className="text-sm font-medium text-error">
        {t(tipusOrg === 'productor' ? 'bloq.banner_productor' : 'bloq.banner_receptor', { n: llista.length })}
      </p>
      <p className="text-sm">{t('bloq.per_que')}</p>
      <div className="flex flex-wrap gap-2">
        {llista.map((a) => (
          <Button key={a.albaran_id} className="h-11 w-full whitespace-normal sm:w-auto md:h-9"
            disabled={obrint === a.albaran_id} onClick={() => void confirma(a)}>
            {t('bloq.confirma', { num: a.numero ?? a.tipo, data: dataCurta(a.entregado_at) })}
          </Button>
        ))}
      </div>
    </div>
  )
}
