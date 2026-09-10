// Los intereses de la entidad receptora y su histórico.
//
// Son las mismas filas de `oferta_respuestas` y `canalizaciones` que gestiona el
// equipo, filtradas por RLS a las de su organización: el receptor ve el estado real de
// su solicitud, incluida la decisión del equipo, sin que haya que replicar nada.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import type { OfertaRespuesta } from '../../types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type AmbOferta = OfertaRespuesta & {
  excedentes: { id_excedente: string | null; producto: string | null; estado: string } | null
}

interface CanalAmbOferta {
  id: string
  kg_confirmados: number | null
  kg_reales: number | null
  data_hora_recollida: string | null
  created_at: string
  excedentes: { id_excedente: string | null; producto: string | null; estado: string } | null
}

function classeEstat(estado: string): string {
  switch (estado) {
    case 'acceptada': return 'bg-exito-fondo text-exito'
    case 'rebutjada': return 'bg-error-fondo text-error'
    default: return 'bg-muted text-muted-foreground'
  }
}

function classeAprovacio(a: string): string {
  switch (a) {
    case 'aprovada': return 'bg-primary/15 text-primary'
    case 'rebutjada': return 'bg-error-fondo text-error'
    default: return 'bg-aviso-fondo text-aviso'
  }
}

export function Interessos() {
  const { t } = useT()
  const organitzacio = useOrganitzacio('entidad')
  const [files, setFiles] = useState<AmbOferta[]>([])
  const [carregant, setCarregant] = useState(true)
  const entidadId = organitzacio?.id ?? null

  const carrega = useCallback(async () => {
    if (!entidadId) { setCarregant(false); return }
    const { data } = await supabase
      .from('oferta_respuestas')
      .select('*, excedentes(id_excedente, producto, estado)')
      .eq('entidad_id', entidadId)
      .order('enviado_at', { ascending: false })
    setFiles((data as unknown as AmbOferta[]) ?? [])
    setCarregant(false)
  }, [entidadId])

  useEffect(() => {
    void carrega()
    if (!entidadId) return
    const canal = supabase
      .channel(`meus-interessos-${entidadId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'oferta_respuestas', filter: `entidad_id=eq.${entidadId}` },
        () => void carrega())
      .subscribe()
    return () => { void supabase.removeChannel(canal) }
  }, [carrega, entidadId])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('int.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('int.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('int.empty')}</p>
        )}
        {files.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <div className="font-medium">{f.excedentes?.producto ?? '—'}</div>
              <div className="text-xs text-muted-foreground">
                <code>{f.excedentes?.id_excedente ?? '—'}</code>
                {f.kg_solicitados != null ? ` · ${f.kg_solicitados} ${t('od.rs_kg')}` : ''}
                {f.preu_ofert != null ? ` · ${f.preu_ofert} ${t('od.rs_preu')}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', classeEstat(f.estado))}>
                {t(`od.rs_${f.estado}`)}
              </span>
              {f.estado === 'acceptada' && (
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', classeAprovacio(f.aprovacio))}>
                  {t(`od.ap_${f.aprovacio}`)}
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function Historic() {
  const { t } = useT()
  const organitzacio = useOrganitzacio('entidad')
  const [files, setFiles] = useState<CanalAmbOferta[]>([])
  const [carregant, setCarregant] = useState(true)
  const entidadId = organitzacio?.id ?? null

  useEffect(() => {
    if (!entidadId) { setCarregant(false); return }
    let viu = true
    void supabase
      .from('canalizaciones')
      .select('id, kg_confirmados, kg_reales, data_hora_recollida, created_at, ' +
        'excedentes(id_excedente, producto, estado)')
      .eq('entidad_id', entidadId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!viu) return
        setFiles((data as unknown as CanalAmbOferta[]) ?? [])
        setCarregant(false)
      })
    return () => { viu = false }
  }, [entidadId])

  const totalKg = files.reduce((s, f) => s + Number(f.kg_reales ?? f.kg_confirmados ?? 0), 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hist.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('hist.subtitle', { n: totalKg })}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('hist.empty')}</p>
        )}
        {files.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <div>
              <div className="font-medium">{f.excedentes?.producto ?? '—'}</div>
              <div className="text-xs text-muted-foreground">
                <code>{f.excedentes?.id_excedente ?? '—'}</code>
                {f.data_hora_recollida ? ` · ${f.data_hora_recollida.slice(0, 10)}` : ''}
              </div>
            </div>
            <span>
              {f.kg_reales != null
                ? t('po.real_kg', { n: Number(f.kg_reales) })
                : t('po.channeled_kg', { n: Number(f.kg_confirmados ?? 0) })}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
