// Fase 5 · la recogida y los albaranes (`lliurament`). Cuatro cosas, sin líneas a mano:
//
// 1. la HORA de cada entrega, en línea (`fixar_hora_recollida`): informativa, no bloquea;
// 2. «Registra la recollida (en nom de X)» por entrega (`DialegRegistraRecollida`): el mismo
//    formulario que ve la receptora, que registra y valida en una llamada; si la receptora ya
//    la registró, lo que se abre es validarla;
// 3. los ALBARANES que han salido, con su número y su PDF: los emite la validación, no aquí;
// 4. CONCILIAR lo que no se haya conciliado solo —un REC fuera de tolerancia, una salida
//    confirmada por el circuito anterior—, en la misma pantalla (`DialegConciliarAlbara`).
//
// ⚠️ Una espigolada no tiene receptora que registre: sus albaranes de salida los emite el
//    equipo desde la ficha de cada uno (el editor de líneas vive allí, y un segundo editor es
//    un segundo sitio donde los kilos pueden acabar siendo otros).

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useT } from '../../../lib/i18n'
import { kg as fmtKg, dataHora } from '../../../lib/format'
import { localDateTime } from '../../../lib/franja'
import { estilEstatAlbara } from '../../../lib/albarans'
import { fixaHoraRecollida } from '../../../lib/operacio'
import { canalitzacionsVives, recollidaPerValidar, recollidaRegistrada } from '../../../lib/passosCanalitzacio'
import type { CanalitzacioCanal } from '../../../lib/passosCanalitzacio'
import { clauErrorHora } from '../../../lib/registreRecollida'
import { textError } from '../../../lib/textError'
import { supabase } from '../../../lib/supabase'
import { useDescarregaDocument } from '../../../hooks/useDescarregaDocument'
import MissatgesDelPunt from '../../MissatgesDelPunt'
import BotoAmbMotiu from '../../proces/BotoAmbMotiu'
import DialegAssistit from '../DialegAssistit'
import { DialegConciliarAlbara } from '../DialegConciliar'
import DialegRegistraRecollida from '../DialegRegistraRecollida'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ContextFase } from './tipus'

/** En qué punto está la recogida de una entrega, para su badge. */
function estatEntrega(c: ContextFase, ca: CanalitzacioCanal): 'validada' | 'per_validar' | 'retornada' | 'confirmada' | 'pendent' {
  if (ca.recollida_validada_at || ca.kg_conciliados != null) return 'validada'
  if (recollidaPerValidar(ca)) return 'per_validar'
  if (recollidaRegistrada(c.fets, ca)) return 'confirmada'
  if (ca.recollida_retornada_at) return 'retornada'
  return 'pendent'
}

const COLOR_ENTREGA: Record<ReturnType<typeof estatEntrega>, string> = {
  validada: 'bg-exito-fondo text-exito',
  confirmada: 'bg-exito-fondo text-exito',
  per_validar: 'bg-aviso-fondo text-aviso',
  retornada: 'bg-aviso-fondo text-aviso',
  pendent: 'bg-secondary text-secondary-foreground',
}

export default function FaseRecollida({ c }: { c: ContextFase }) {
  const { t } = useT()
  const { fets, extra } = c
  const espigolada = fets.oferta.origen === 'espigolament'
  const vives = canalitzacionsVives(fets)
  const [dlgRecollida, setDlgRecollida] = useState<{ id: string; entitat: string | null } | null>(null)
  const [dlgConciliar, setDlgConciliar] = useState<string | null>(null)
  const [dlgAssistit, setDlgAssistit] = useState<string | null>(null)
  // El documento vigente de cada albarán con número: para enseñar el PDF sin salir.
  const [docs, setDocs] = useState<Record<string, string>>({})
  const descarregador = useDescarregaDocument()

  const ambNumero = extra.albarans.filter((a) => a.numero).map((a) => a.id)
  const clauDocs = ambNumero.join(',')
  useEffect(() => {
    const ids = clauDocs ? clauDocs.split(',') : []
    if (ids.length === 0) { setDocs({}); return }
    let viu = true
    void (async () => {
      const { data } = await supabase.from('documentos')
        .select('id, objeto_id')
        .eq('objeto_tipo', 'albaran').eq('vigente', true).in('objeto_id', ids)
      if (!viu) return
      setDocs(Object.fromEntries(((data as { id: string; objeto_id: string }[] | null) ?? [])
        .map((d) => [d.objeto_id, d.id])))
    })()
    return () => { viu = false }
  }, [clauDocs])

  return (
    <div className="space-y-4">
      {/* ── Las entregas, una por canalización viva ── */}
      {!espigolada && vives.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('cfase.entregues')}</p>
          {vives.map((ca) => (
            <Entrega
              key={ca.id}
              c={c}
              ca={ca}
              onRegistra={() => setDlgRecollida({ id: ca.id, entitat: ca.entitat ?? null })}
            />
          ))}
        </div>
      )}

      {/* ── Los albaranes que han salido ── */}
      {extra.albarans.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('cfase.albarans')}</p>
          {extra.albarans.map((a) => {
            const docId = docs[a.id]
            const perConciliar = a.estado === 'confirmado'
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border p-2">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm tabular-nums">
                    {a.tipo} · {a.numero ?? t('canalz.sense_numero')}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge className={estilEstatAlbara(a.estado)}>{t(`alb.st_${a.estado}`)}</Badge>
                    {a.fora_tolerancia && <Badge className="bg-error-fondo text-error">{t('cfase.fora_tolerancia')}</Badge>}
                  </div>
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  {docId && (
                    <Button size="sm" variant="outline" className="h-11 whitespace-normal md:h-8"
                      disabled={descarregador.ocupat === docId}
                      onClick={() => void descarregador.mostra(docId)}>
                      {t('cfase.veure_pdf')}
                    </Button>
                  )}
                  {perConciliar && (
                    <Button size="sm" className="h-11 whitespace-normal md:h-8" onClick={() => setDlgConciliar(a.id)}>
                      {t('alb.reconcile')}
                    </Button>
                  )}
                  {/* Una confirmación del circuito anterior que quedó esperando: se conduce
                      por teléfono con la persona (`acunar_enllac_assistit`). */}
                  {a.estado === 'entregado' && (
                    <Button size="sm" variant="outline" className="h-11 whitespace-normal md:h-8"
                      onClick={() => setDlgAssistit(a.id)}>
                      {t('canalz.b_confirmacio_assistida')}
                    </Button>
                  )}
                  <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
                    <Link to={`/equip/albarans/${a.id}`}>{t('canalz.b_obre')}</Link>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <MissatgesDelPunt missatges={c.missatges} fase="lliurament" />

      <DialegRegistraRecollida
        canalitzacio={dlgRecollida?.id ?? null}
        entitat={dlgRecollida?.entitat ?? null}
        onTancar={() => setDlgRecollida(null)}
        onFet={c.onCanvi}
      />
      <DialegConciliarAlbara albaraId={dlgConciliar} onTancar={() => setDlgConciliar(null)} onFet={c.onCanvi} />
      {dlgAssistit && (
        <DialegAssistit
          obert
          que="albara"
          objecteId={dlgAssistit}
          onTancar={() => setDlgAssistit(null)}
          onFet={() => { setDlgAssistit(null); c.onCanvi() }}
        />
      )}
      {descarregador.visor}
    </div>
  )
}

/** Una entrega: a quién, cuánto, su hora y su recogida. */
function Entrega({ c, ca, onRegistra }: { c: ContextFase; ca: CanalitzacioCanal; onRegistra: () => void }) {
  const { t } = useT()
  const estat = estatEntrega(c, ca)
  const registrada = estat !== 'pendent' && estat !== 'retornada'
  const [hora, setHora] = useState(localDateTime(ca.data_hora_recollida))
  const [desant, setDesant] = useState(false)
  const nom = ca.entitat ?? '—'

  async function fixaHora() {
    if (!hora) { toast.error(t('rrec.err_cal_hora')); return }
    setDesant(true)
    const r = await fixaHoraRecollida(ca.id, new Date(hora).toISOString())
    setDesant(false)
    if (!r.ok) {
      const clau = clauErrorHora(r.missatge, r.codi)
      toast.error(clau ? t(clau) : textError(t, r))
      return
    }
    toast.success(t('cfase.hora_ok'))
    c.onCanvi()
  }

  const kgAssignats = ca.kg_confirmados != null ? fmtKg(ca.kg_confirmados) : '—'
  const kgReals = ca.kg_declarats ?? null

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="entrega-canalitzacio">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm">
          <span className="font-medium">{nom}</span>
          <span className="tabular-nums"> · {t('cfase.kg_assignats', { kg: kgAssignats })}</span>
          {kgReals != null && <span className="tabular-nums"> · {t('cfase.kg_declarats', { kg: fmtKg(kgReals) })}</span>}
          {ca.valorizacion ? ` · ${t(`od.mod_${ca.valorizacion}`)}` : ''}
        </span>
        <Badge className={`max-w-full whitespace-normal text-left ${COLOR_ENTREGA[estat]}`}>
          {t(`cfase.ent_${estat}`)}
        </Badge>
      </div>

      {/* La hora: solo mientras no esté registrada (después la base no la deja cambiar). */}
      {!registrada && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-56">
            <Label htmlFor={`cd-hora-${ca.id}`} className="mb-1.5 block text-xs text-muted-foreground">
              {t('cfase.hora')}
            </Label>
            <Input id={`cd-hora-${ca.id}`} type="datetime-local" value={hora}
              onChange={(e) => setHora(e.target.value)} />
          </div>
          <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-9"
            disabled={desant || !hora || hora === localDateTime(ca.data_hora_recollida)}
            onClick={() => void fixaHora()}>
            {t('cfase.fixa_hora')}
          </Button>
        </div>
      )}
      {registrada && ca.data_hora_recollida && (
        <p className="text-xs text-muted-foreground">{t('cfase.hora_acordada', { quan: dataHora(ca.data_hora_recollida) })}</p>
      )}

      {/* Registrar en su nombre, o validar lo que ella registró. Genera los albaranes: es de
          admin (la base lo exige con `pot_aprovar()`). */}
      {(estat === 'pendent' || estat === 'retornada' || estat === 'per_validar') && (
        <BotoAmbMotiu
          className="h-11 w-full whitespace-normal sm:w-auto md:h-9"
          disabled={!c.potAprovar}
          motiu={c.potAprovar ? undefined : t('recol.need_admin')}
          onClick={onRegistra}
        >
          {estat === 'per_validar' ? t('rrec.as_btn_validar') : t('cfase.registra_en_nom', { entitat: nom })}
        </BotoAmbMotiu>
      )}
    </div>
  )
}
