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
import { estatSimpleInteres, llegendaSimpleInteres, puntInteres } from '../../lib/procesOferta'
import { dataCurta } from '../../lib/albarans'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { EstadoAlbaran, EstadoExcedente, OfertaRespuesta } from '../../types'
import LlegendaEstats from '../../components/proces/LlegendaEstats'
import BadgeEstat from '../../components/proces/BadgeEstat'
import CarregantSeccio from '../../components/CarregantSeccio'
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

/** «23/09»: en una píldora el año sobra, y la lista va del más reciente al más antiguo. */
function dataCurtaSenseAny(iso: string | null | undefined): string | null {
  if (!iso) return null
  // Montada a mano: con `toLocaleDateString` algunos navegadores ignoran el `2-digit` del
  // mes en esta combinación y pintan «21/9».
  const parts = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Madrid' })
    .formatToParts(new Date(iso))
  const v = (tipus: string) => parts.find((p) => p.type === tipus)?.value ?? ''
  return `${v('day').padStart(2, '0')}/${v('month').padStart(2, '0')}`
}

/** Un albarán anulado o rectificado no cuenta: la entrega vuelve a estar donde estaba. */
const ALBARA_VIU: EstadoAlbaran[] = ['emitido', 'entregado', 'confirmado', 'conciliado']

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

  // Los estados simples con su frase (revisión del 23-09-2026): cuatro que se distinguen de
  // un vistazo —asignada, interés enviado, cerrada, no disponible— más los dos que solo
  // salen a veces. La etapa fina sigue viva en la frase de «qué toca» de cada fila.
  const llegenda = llegendaSimpleInteres()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('int.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('int.subtitle')}</p>
        <LlegendaEstats items={llegenda} ambPunt />
      </CardHeader>
      <CardContent className="space-y-2">
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
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
          const est = estatSimpleInteres(punt)
          // La fecha de lo último que ha hecho la entidad: cuándo contestó o, si todavía
          // no lo ha hecho, cuándo le llegó la oferta.
          const data = dataCurtaSenseAny(f.respondido_at ?? f.enviado_at)
          const detall = [
            f.kg_solicitados != null ? `${f.kg_solicitados} ${t('od.rs_kg')}` : null,
            f.preu_ofert != null ? `${f.preu_ofert} ${t('od.rs_preu')}` : null,
          ].filter(Boolean).join(' · ')
          return (
            <div key={f.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  {/* Sin el código interno (E-AAMMDD-…): es del ERP y a la entidad no le dice
                      nada (revisión del 23-09-2026). */}
                  <div className="font-medium">{f.excedentes?.producto ?? '—'}</div>
                  {detall && <div className="text-xs text-muted-foreground">{detall}</div>}
                </div>
                <BadgeEstat clase={est.clase}>
                  {t(est.key)}{data ? ` · ${data}` : ''}
                </BadgeEstat>
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
        {carregant && <CarregantSeccio files={3} ambCapcalera={false} />}
        {!carregant && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('hist.empty')}</p>
        )}
        {files.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <div>
              <div className="font-medium">{f.excedentes?.producto ?? '—'}</div>
              {/* Siempre una fecha, y nunca el código interno: la de recogida si ya la hay,
                  y si no, cuándo se asignó. */}
              <div className="text-xs text-muted-foreground">
                {f.data_hora_recollida
                  ? t('hist.collected_on', { date: dataCurta(f.data_hora_recollida) })
                  : t('hist.assigned_on', { date: dataCurta(f.created_at) })}
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
