// Los intereses de la entidad receptora y su histórico.
//
// Son las mismas filas de `oferta_respuestas` y `canalizaciones` que gestiona el
// equipo, filtradas por RLS a las de su organización: el receptor ve el estado real de
// su solicitud, incluida la decisión del equipo, sin que haya que replicar nada.
//
// ⚠️ UN SOLO BADGE, Y NO DOS. Hasta hoy cada fila pintaba a la vez lo que dijo la entidad
// (`od.rs_*`) y lo que decidió el equipo (`od.ap_*`): dos ejes que solo se entienden si ya
// te sabes el modelo de datos, y «Acceptada + Per aprovar» a la vez se lee como una
// contradicción. Ahora los dos ejes —más el albarán de entrega, que es quien cuenta el
// final— los resuelve `puntInteres()` en UNA etapa, y debajo va qué toca hacer. La
// traducción de estados a frases vive en `procesOferta.ts` y la comparten los tres paneles.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { puntInteres, ETAPES_INTERES } from '../../lib/procesOferta'
import type { EtapaProces } from '../../lib/procesOferta'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { EstadoAlbaran, EstadoExcedente, OfertaRespuesta } from '../../types'
import LlegendaEstats from '../../components/proces/LlegendaEstats'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type AmbOferta = OfertaRespuesta & {
  excedentes: { id_excedente: string | null; producto: string | null; estado: EstadoExcedente } | null
}

/** Lo único que hace falta del albarán de entrega para contar la etapa. */
type AlbaraEnt = Pick<AlbaranBandeja, 'id' | 'numero_completo' | 'estado' | 'canalizacion_id'>

interface CanalAmbOferta {
  id: string
  kg_confirmados: number | null
  kg_reales: number | null
  data_hora_recollida: string | null
  created_at: string
  excedentes: { id_excedente: string | null; producto: string | null; estado: string } | null
}

/** Un albarán anulado o rectificado no cuenta: la entrega vuelve a estar donde estaba. */
const ALBARA_VIU: EstadoAlbaran[] = ['emitido', 'entregado', 'confirmado', 'conciliado']

/**
 * El color del badge de una etapa del interés.
 *
 * La regla es la de `PendentsDeTu` y `QueTocaAra`: **ámbar significa «et toca a tu»**, y
 * nada más. Verde son las etapas en las que la oferta ya es tuya (o ya está cerrada); el
 * resto —interés enviado, entrega en marcha, y las tres salidas— es neutro informativo.
 *
 * Se exporta porque el Mercat pinta el mismo badge sobre las ofertas ya solicitadas: dos
 * copias de un mapa de estados son dos sitios donde una etapa nueva cae en el color
 * equivocado. Si algún día lo necesita un tercer sitio, su casa es `procesOferta.ts`.
 */
export function classeEtapaInteres(etapa: EtapaProces, emToca: boolean): string {
  if (emToca) return 'bg-aviso-fondo text-aviso'
  if (etapa === 'assignada' || etapa === 'confirmada' || etapa === 'tancada') {
    return 'bg-exito-fondo text-exito'
  }
  return 'bg-secondary text-secondary-foreground'
}

export function Interessos() {
  const { t } = useT()
  const organitzacio = useOrganitzacio('entidad')
  const [files, setFiles] = useState<AmbOferta[]>([])
  const [albarans, setAlbarans] = useState<Record<string, AlbaraEnt>>({})
  const [carregant, setCarregant] = useState(true)
  const entidadId = organitzacio?.id ?? null

  const carrega = useCallback(async () => {
    if (!entidadId) { setCarregant(false); return }
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    // `ENT` y `R-ENT`: una entrega rectificada sigue siendo la entrega de ese interés, y
    // mirar solo el original dejaría la etapa colgada en «Assignada» para siempre.
    const [resp, alb] = await Promise.all([
      supabase
        .from('oferta_respuestas')
        .select('*, excedentes(id_excedente, producto, estado)')
        .eq('entidad_id', entidadId)
        .order('enviado_at', { ascending: false }),
      supabase
        .from('v_albaranes_bandeja')
        .select('id, numero_completo, estado, canalizacion_id')
        .in('tipo', ['ENT', 'R-ENT']),
    ])

    // El interés aprobado y su albarán de entrega comparten `canalizacion_id`: es lo único
    // que los une, porque el albarán cuelga de la canalización y no de la respuesta.
    const per: Record<string, AlbaraEnt> = {}
    for (const a of ((alb.data as AlbaraEnt[] | null) ?? [])) {
      if (!a.canalizacion_id) continue
      const actual = per[a.canalizacion_id]
      const viu = ALBARA_VIU.includes(a.estado as EstadoAlbaran)
      if (!actual || (viu && !ALBARA_VIU.includes(actual.estado as EstadoAlbaran))) {
        per[a.canalizacion_id] = a
      }
    }
    setAlbarans(per)
    setFiles((resp.data as unknown as AmbOferta[]) ?? [])
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

  // Las seis etapas con su color y su frase: lo que el badge de cada fila NO cabe explicando.
  // `oferta_rebuda` y `entrega` se pintan en ámbar porque son las dos etapas cuya acción es
  // de la entidad; en una fila concreta eso lo decide `punt.emToca`, que sabe además si el
  // albarán ya está entregado o solo emitido.
  const llegenda = ETAPES_INTERES.map((etapa) => ({
    key: `proc.pasi_${etapa}`,
    clase: classeEtapaInteres(etapa, etapa === 'oferta_rebuda' || etapa === 'entrega'),
    descKey: `proc.llegenda_interes_${etapa}`,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('int.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('int.subtitle')}</p>
        <LlegendaEstats items={llegenda} />
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('int.empty')}</p>
        )}
        {files.map((f) => {
          const alb = f.canalizacion_id ? albarans[f.canalizacion_id] : undefined
          const punt = puntInteres({
            estado: f.estado,
            aprovacio: f.aprovacio,
            kg: f.kg_solicitados,
            ofertaEstado: f.excedentes?.estado ?? 'publicada',
            albaraEnt: alb ? { estado: alb.estado as EstadoAlbaran, numero: alb.numero_completo } : null,
            motiu: f.motiu_aprovacio,
          })
          // Una línea que resuelve a «—» no se pinta: un hueco con su margen se lee como un
          // fallo de carga. Mismo criterio que `QueTocaAra`.
          const toca = t(punt.claus.toca, punt.vars).trim()
          return (
            <div key={f.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{f.excedentes?.producto ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">
                    <code>{f.excedentes?.id_excedente ?? '—'}</code>
                    {f.kg_solicitados != null ? ` · ${f.kg_solicitados} ${t('od.rs_kg')}` : ''}
                    {f.preu_ofert != null ? ` · ${f.preu_ofert} ${t('od.rs_preu')}` : ''}
                  </div>
                </div>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  classeEtapaInteres(punt.etapa, punt.emToca),
                )}>
                  {t(punt.claus.titol, punt.vars)}
                </span>
              </div>
              {toca && toca !== '—' && toca !== punt.claus.toca && (
                <p className={cn(
                  'mt-2 text-sm',
                  punt.emToca ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}>
                  {toca}
                </p>
              )}
            </div>
          )
        })}
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
            {/* Claves propias y no las del productor: aquí los kilos se RECIBEN, y
                «canalitzats» es la palabra de quien los entrega. */}
            <span>
              {f.kg_reales != null
                ? t('hist.kg_reals', { n: Number(f.kg_reales) })
                : t('hist.kg_assignats', { n: Number(f.kg_confirmados ?? 0) })}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
