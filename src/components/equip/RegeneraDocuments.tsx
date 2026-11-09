// Regenerar los documentos ya emitidos con los datos actuales de la Fundació (09-11-2026,
// `regenerar_documents_fundacio()`, 20270516100100). Va debajo de Configuració › Fundació y solo
// lo ve el super_admin.
//
// Los documentos NUEVOS ya salen con lo que hay guardado arriba (cada emisor lo copia al emitir).
// Esto es para lo YA emitido, que es inmutable: se emite la versión siguiente (mismo número) con
// los datos de ahora, y la anterior se conserva. Solo en MODO TEST: con el modo test apagado
// (producción) la base lo rechaza y aquí se explica por qué, porque un documento con valor legal
// no se reescribe. Los firmados no se tocan (perderían la firma).
//
// Primero se enseña cuántos cambiarían (la misma RPC sin aceptar) y se pide aceptar en un diálogo
// con el aviso; no hay forma de lanzarlo sin pasar por él.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { useConfirma } from '../DialegConfirma'
import { Button } from '@/components/ui/button'

interface InfoRegeneracio {
  mode_test: boolean
  executat: boolean
  total: number
  signats: number
  detall: { tipo: string; n: number }[]
}

export default function RegeneraDocuments({ refresc }: { refresc: number }) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [info, setInfo] = useState<InfoRegeneracio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)

  const carrega = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('regenerar_documents_fundacio', { p_accepto: false })
    setError(err ? err.message : null)
    setInfo(err ? null : (data as InfoRegeneracio))
  }, [])

  useEffect(() => { void carrega() }, [carrega, refresc])

  const llista = (info?.detall ?? []).map((d) => t('cfgf.regen_linia', { tipus: t(`doc.tipus_${d.tipo}`), n: d.n })).join(' · ')

  async function regenera() {
    if (!info || !info.mode_test || info.total === 0 || ocupat) return
    const ok = await confirma({
      titol: t('cfgf.regen_c_t', { n: info.total }),
      descripcio: [t('cfgf.regen_c_d'), llista, info.signats > 0 ? t('cfgf.regen_signats', { n: info.signats }) : ''].filter(Boolean).join('\n\n'),
      confirmar: t('cfgf.regen_c_go'),
      destructiu: true,
    })
    if (!ok) return
    setOcupat(true)
    const { data, error: err } = await supabase.rpc('regenerar_documents_fundacio', { p_accepto: true })
    setOcupat(false)
    if (err) {
      toast.error(err.message.includes('nomes_en_mode_test') ? t('cfgf.regen_prod') : textError(t, err.message))
    } else {
      toast.success(t('cfgf.regen_ok', { n: (data as InfoRegeneracio).total }))
    }
    await carrega()
  }

  return (
    <div className="space-y-2 border-t pt-4" data-testid="regen-docs">
      <div className="text-sm font-semibold">{t('cfgf.regen_t')}</div>
      <p className="text-xs text-muted-foreground">{t('cfgf.regen_help')}</p>
      {error && <p className="text-sm text-error" role="alert">{textError(t, error)}</p>}
      {info && !info.mode_test && (
        <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground" data-testid="regen-prod">
          {t('cfgf.regen_prod')}
        </p>
      )}
      {info && info.mode_test && (
        <>
          <p className="rounded-md border border-aviso/30 bg-aviso-fondo p-3 text-sm text-aviso">{t('cfgf.regen_avis')}</p>
          <p className="text-sm" data-testid="regen-resum">
            {info.total === 0 ? t('cfgf.regen_cap') : t('cfgf.regen_n', { n: info.total })}
            {llista && <span className="block text-xs text-muted-foreground">{llista}</span>}
          </p>
          {info.signats > 0 && <p className="text-xs text-muted-foreground">{t('cfgf.regen_signats', { n: info.signats })}</p>}
          <Button
            variant="outline" className="h-11 whitespace-normal md:h-8"
            disabled={ocupat || info.total === 0} onClick={() => void regenera()} data-testid="regen-go"
          >
            <RefreshCw className="size-4" aria-hidden />
            {ocupat ? t('c.saving') : t('cfgf.regen_go', { n: info.total })}
          </Button>
        </>
      )}
      {dialeg}
    </div>
  )
}
