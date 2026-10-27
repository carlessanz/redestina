// Fase 3 · la distribución. Con las notificaciones apagadas —o porque la entidad prefiere el
// teléfono— el equipo le pasa el texto de la oferta por su cuenta: aquí está el texto para
// copiarlo, las diez primeras entidades que propone la priorización y, en cada una, «Copia i
// marca com a enviada», que deja la fila `pendent` con `canal = 'manual'`
// (`registrar_envio_manual`). El ranking completo, con sus filtros, sigue en el detalle.
//
// ⚠️ La priorización se pide al ABRIR la fase (el contenido de un desplegable no se monta
//    cerrado): es una Edge Function de ~1 s y no hace falta en cada visita al ciclo.

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../../lib/i18n'
import { textError } from '../../../lib/textError'
import { registrarEnviamentManual } from '../../../lib/canalitzacio'
import { priorizarEntidades } from '../../../lib/redestina'
import type { EntidadPuntuada } from '../../../lib/redestina'
import { supabase } from '../../../lib/supabase'
import MissatgesDelPunt from '../../MissatgesDelPunt'
import BotoCopiar from '../../BotoCopiar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { ContextFase } from './tipus'

/** Cuántas entidades del ranking se enseñan aquí: las demás, en el detalle de la oferta. */
const PRIMERES = 10

export default function FaseDistribucio({ c }: { c: ContextFase }) {
  const { t } = useT()
  const { fets, extra, oferta } = c
  const [ranking, setRanking] = useState<EntidadPuntuada[] | null>(null)
  const [errorRanking, setErrorRanking] = useState(false)
  const [entitats, setEntitats] = useState<{ id: string; nombre: string }[]>([])
  const [entitatManual, setEntitatManual] = useState('')
  const [ocupat, setOcupat] = useState(false)

  const id = extra.oferta.id
  useEffect(() => {
    let viu = true
    void (async () => {
      const [r, e] = await Promise.all([
        priorizarEntidades(id),
        // Para mandarla a una entidad que la priorización no propone (la ha pedido por
        // teléfono, o está fuera de las diez primeras).
        supabase.from('entidades').select('id, nombre').order('nombre').limit(500),
      ])
      if (!viu) return
      if (r.ok) setRanking(r.ranking)
      else { setRanking([]); setErrorRanking(true) }
      setEntitats((e.data as { id: string; nombre: string }[] | null) ?? [])
    })()
    return () => { viu = false }
  }, [id])

  const disponible = ['publicada', 'parcial'].includes(fets.oferta.estado)
  const resposta = (entitat: string) => extra.respostes.find((r) => r.entidad_id === entitat)
  /** Ya mostró interés o está aprobada: la base no deja volver a marcarla (`ja_resposta`). */
  const jaResposta = (entitat: string) => {
    const r = resposta(entitat)
    return r != null && (r.estado === 'acceptada' || r.aprovacio === 'aprovada')
  }

  async function marca(entitatId: string) {
    setOcupat(true)
    const r = await registrarEnviamentManual(extra.oferta.id, entitatId)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('manual.ok'))
    setEntitatManual('')
    c.onCanvi()
  }

  const text = oferta?.texto_oferta ?? null

  return (
    <div className="space-y-3">
      {/* El texto que se manda, entero, para copiarlo tal cual. */}
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">{t('manual.title')}</p>
        <p className="text-xs text-muted-foreground">{t('manual.hint')}</p>
        {text
          ? (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-sans text-sm">{text}</pre>
              <BotoCopiar text={text} etiqueta={t('cfase.copia_text')} size="default"
                className="h-11 w-full whitespace-normal sm:w-auto md:h-9" />
            </>
          )
          : <p className="text-sm text-muted-foreground">{t('od.no_text')}</p>}
        {!disponible && <p className="text-sm text-aviso">{t('cfase.no_disponible')}</p>}
      </div>

      {/* Las diez primeras de la priorización, con tipo y convenio. */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('cfase.primeres', { n: PRIMERES })}</p>
        {ranking === null
          ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />{t('c.loading')}
            </p>
          )
          : errorRanking
            ? <p className="text-sm text-error">{t('od.rank_error')}</p>
            : ranking.length === 0
              ? <p className="text-sm text-muted-foreground">{t('cfase.ranking_buit')}</p>
              : (
                <ul className="space-y-2">
                  {ranking.slice(0, PRIMERES).map((e) => {
                    const r = resposta(e.id)
                    return (
                      <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-2">
                        <div className="min-w-0 flex-1 basis-60">
                          <p className="text-sm font-medium">{e.nombre}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {e.tipo_receptor && <Badge variant="outline">{t(`org.tr_${e.tipo_receptor}`)}</Badge>}
                            {r && (
                              <Badge className="bg-secondary text-secondary-foreground">
                                {r.canal ? t(`od.ch_${r.canal}`) : t('cfase.enviada')}
                                {` · ${t(`od.rs_${r.estado}`)}`}
                              </Badge>
                            )}
                          </div>
                          {e.sense_conveni && <p className="mt-1 text-xs text-aviso">{t('od.sense_conveni')}</p>}
                        </div>
                        {text && (
                          <BotoCopiar
                            text={text}
                            etiqueta={t('manual.copy_mark')}
                            size="sm"
                            className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
                            disabled={ocupat || !disponible || jaResposta(e.id)}
                            onCopiat={() => void marca(e.id)}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
        <Button asChild variant="outline" className="h-11 whitespace-normal md:h-9">
          <Link to={`/equip/ofertes/${extra.oferta.id}`}>{t('cfase.ranking_complet')}</Link>
        </Button>
      </div>

      {/* Cualquier otra entidad: la que la ha pedido por teléfono, o una de más abajo. */}
      {text && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="min-w-0 flex-1 basis-64">
            <Label htmlFor="cd-manual-entitat" className="mb-1.5 block text-xs text-muted-foreground">
              {t('cfase.altra_entitat')}
            </Label>
            <select
              id="cd-manual-entitat"
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base md:h-9 md:text-sm"
              value={entitatManual}
              onChange={(ev) => setEntitatManual(ev.target.value)}
            >
              <option value="">—</option>
              {entitats.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </div>
          <BotoCopiar
            text={text}
            etiqueta={t('manual.copy_mark')}
            size="default"
            className="h-11 w-full whitespace-normal sm:w-auto md:h-9"
            disabled={ocupat || !entitatManual || !disponible || jaResposta(entitatManual)}
            onCopiat={() => void marca(entitatManual)}
          />
        </div>
      )}

      {/* A quién consta que se le ha enviado, y por dónde. */}
      {extra.respostes.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('cfase.destinataris')}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {extra.respostes.map((r) => (
              <li key={r.id}>
                {r.entitat}
                {r.canal ? ` · ${t(`od.ch_${r.canal}`)}` : ''}
                {` · ${t(`od.rs_${r.estado}`)}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <MissatgesDelPunt missatges={c.missatges} fase="distribucio" />
    </div>
  )
}
